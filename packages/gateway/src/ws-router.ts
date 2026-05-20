import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';
import type { RedisBridge } from './redis-bridge';
import type { Channel, DataEnvelope } from '@chart-studio/adapter-core';

interface ClientSub {
  id: string;
  provider: string;
  symbol: string;
  channel: Channel;
  key?: string;
  /** Returns true while the upstream sub remains active. */
  unsub: () => void;
}

interface InboundSub {
  op: 'sub';
  id: string;
  provider: string;
  symbol: string;
  channel: Channel;
  /** Required for `candle`. */
  interval?: string;
}

interface InboundUnsub {
  op: 'unsub';
  id: string;
}

type Inbound = InboundSub | InboundUnsub;

interface OutboundFrame {
  id: string;
  type: 'snapshot' | 'update' | 'error';
  provider: string;
  symbol: string;
  channel: Channel;
  key?: string;
  data?: unknown;
  error?: string;
}

/**
 * One ClientSession per browser WS. Multiplexes (provider, symbol, channel)
 * subscriptions onto the shared Redis bridge.
 */
export class ClientSession {
  private readonly subs = new Map<string, ClientSub>();

  constructor(
    private readonly socket: WebSocket,
    private readonly bridge: RedisBridge,
  ) {
    console.log('[gateway] ClientSession connected');
    socket.on('message', (raw) => this.onMessage(raw.toString()));
    socket.on('close', () => {
      console.log('[gateway] ClientSession disconnected');
      this.dispose();
    });
    socket.on('error', (err) => {
      console.error('[gateway] ClientSession socket error:', err);
      this.dispose();
    });
  }

  private send(frame: OutboundFrame): void {
    if (this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(frame));
  }

  private onMessage(raw: string): void {
    let msg: Inbound;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.op === 'sub') this.subscribe(msg);
    else if (msg.op === 'unsub') this.unsubscribe(msg.id);
  }

  private subscribe(msg: InboundSub): void {
    const key = msg.channel === 'candle' ? (msg.interval ?? '1m') : undefined;
    console.log(`[gateway] Client sub: id=${msg.id} provider=${msg.provider} symbol=${msg.symbol} channel=${msg.channel} key=${key}`);
    const reqId = randomUUID();

    let receivedAny = false;
    const listener = (env: DataEnvelope): void => {
      receivedAny = true;
      this.send({
        id: msg.id,
        type: env.kind,
        provider: env.provider,
        symbol: env.symbol,
        channel: env.channel,
        key: env.key,
        data: env.data,
      });
    };

    const unsubBridge = this.bridge.onData({
      provider: msg.provider,
      symbol: msg.symbol,
      channel: msg.channel,
      key,
      listener,
    });

    this.bridge.publishCtrl(msg.provider, {
      op: 'sub',
      channel: msg.channel,
      symbol: msg.symbol,
      key,
      reqId,
    });

    // If no snapshot or update arrives within 8s, surface an error frame to
    // the client so the UI can show a stale/offline indicator instead of
    // spinning forever. Channels that have no REST snapshot (trade/ticker/
    // analytics/signal/annotation) still typically deliver an update tick
    // within seconds during market hours.
    const stallTimer = setTimeout(() => {
      if (receivedAny) return;
      this.send({
        id: msg.id,
        type: 'error',
        provider: msg.provider,
        symbol: msg.symbol,
        channel: msg.channel,
        key,
        error: `provider ${msg.provider} offline or no data for ${msg.symbol}/${msg.channel} within 8s`,
      });
    }, 8000);

    this.subs.set(msg.id, {
      id: msg.id,
      provider: msg.provider,
      symbol: msg.symbol,
      channel: msg.channel,
      key,
      unsub: () => {
        clearTimeout(stallTimer);
        unsubBridge();
        this.bridge.publishCtrl(msg.provider, {
          op: 'unsub',
          channel: msg.channel,
          symbol: msg.symbol,
          key,
          reqId,
        });
      },
    });
  }

  private unsubscribe(id: string): void {
    const s = this.subs.get(id);
    if (!s) return;
    s.unsub();
    this.subs.delete(id);
  }

  private dispose(): void {
    for (const s of this.subs.values()) s.unsub();
    this.subs.clear();
  }
}
