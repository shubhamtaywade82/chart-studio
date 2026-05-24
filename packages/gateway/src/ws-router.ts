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
 * Extracts the openTime from a candle data payload. Handles both update envelopes
 * ({ candle: { openTime }, isFinal }) and snapshot arrays (Candle[]).
 */
function extractCandleOpenTime(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data)) {
    const last = data[data.length - 1] as Record<string, unknown> | undefined;
    return last ? extractCandleOpenTime(last) : null;
  }
  const d = data as Record<string, unknown>;
  // Update payload: { candle: { openTime }, isFinal }
  const candle = d['candle'];
  if (candle && typeof candle === 'object') {
    const t = (candle as Record<string, unknown>)['openTime'];
    return typeof t === 'number' ? t : null;
  }
  // Direct candle object
  const t = d['openTime'];
  return typeof t === 'number' ? t : null;
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
    // Tracks the highest candle openTime seen so far; used to discard out-of-order
    // ticks that would cause LWC to throw "time must be greater than previous time".
    let lastCandleTs = 0;

    const listener = (env: DataEnvelope): void => {
      // Sequence validation for candle updates — prevents LWC assertion failures.
      if (env.channel === 'candle' && env.kind === 'update') {
        const ts = extractCandleOpenTime(env.data);
        if (ts !== null) {
          if (ts < lastCandleTs) return; // stale tick from a reordered or duplicate message
          lastCandleTs = ts;
        }
      }
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

    // Hydrate from gateway cache immediately so the client gets last-known state
    // without waiting for the adapter to re-send a snapshot (critical on reconnects).
    const cachedTopic = `chart.data.${msg.provider}.${msg.symbol.toUpperCase()}.${msg.channel}${key ? `.${key}` : ''}`;
    const cached = this.bridge.getCachedEnvelope(cachedTopic);
    if (cached) {
      receivedAny = true;
      this.send({
        id: msg.id,
        type: cached.kind,
        provider: cached.provider,
        symbol: cached.symbol,
        channel: cached.channel,
        key: cached.key,
        data: cached.data,
      });
      if (cached.channel === 'candle') {
        const ts = extractCandleOpenTime(cached.data);
        if (ts !== null) lastCandleTs = ts;
      }
    }

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
