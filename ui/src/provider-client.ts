/**
 * Thin client for the chart-studio gateway. One WebSocket, multiplexed
 * by stream id; REST helpers for federated search.
 *
 * Wire format mirrors packages/gateway/src/ws-router.ts.
 */

export interface Candle {
  openTime: number; open: number; high: number; low: number; close: number; volume: number; closeTime?: number; sealed?: boolean;
}

export interface DepthDelta {
  firstUpdateId: number; finalUpdateId: number; prevUpdateId?: number;
  bids: [number, number][]; asks: [number, number][]; ts: number; replacement?: boolean;
}

export interface OrderBookSnapshot {
  lastUpdateId: number; bids: [number, number][]; asks: [number, number][]; ts: number;
}

export interface Trade { price: number; qty: number; ts: number; makerSide: boolean; tradeId?: number }
export interface BookTicker { bestBidPrice: number; bestBidQty: number; bestAskPrice: number; bestAskQty: number; ts: number }

export interface DepthLevel { price: number; qty: number; orders: number }

export interface AnalyticsData {
  ltp: number; atp: number; ltq: number; ltt: number;
  volume: number; totalBuyQty: number; totalSellQty: number;
  oi: number | undefined; highOi: number | undefined; lowOi: number | undefined;
  dayOpen: number; dayHigh: number; dayLow: number; dayClose: number;
  depthBids: DepthLevel[] | undefined; depthAsks: DepthLevel[] | undefined;
  prevClose: number | undefined; prevOi: number | undefined;
  optionChain: OptionChainData | undefined;
  cryptoMetrics?: {
    fundingRate: number;
    fundingRateAPR: number;
    nextFundingTime: number;
    longShortRatio: number;
    openInterestUsd: number;
    basisPct: number;
    liquidations?: { long: number; short: number; cascadeDetected?: boolean };
  };
}

export type Urgency = 'none' | 'watch_only' | 'next_5min' | 'this_candle' | 'immediate' | 'critical';

export interface AISignal {
  layer: 'reflex' | 'tactical';
  type: string;
  urgency: Urgency;
  confidence: number;
  narrative: string;
  ts: number;
}

export interface AIAnnotation {
  kind: 'tactical' | 'reflex' | 'narrative' | 'risk' | 'morning_brief' | 'correlation' | 'historical_echo' | 'confluence' | 'strategy_signal';
  ts: number;
  data: unknown;
}

export interface OptionChainItem {
  strikePrice: number;
  callOI: number;
  callOIChange: number;
  callVolume: number;
  callLTP: number;
  callIV: number;
  putOI: number;
  putOIChange: number;
  putVolume: number;
  putLTP: number;
  putIV: number;
  // Greeks (calculated by adapter)
  callDelta?: number;
  callGamma?: number;
  callTheta?: number;
  callVega?: number;
  putDelta?: number;
  putGamma?: number;
  putTheta?: number;
  putVega?: number;
}

export interface OptionChainData {
  underlying: string;
  timestamp: number;
  strikes: OptionChainItem[];
  maxPain: number;
  supportOI: number;
  resistanceOI: number;
  spotPrice: number;
}

export interface ProviderInfo { provider: string; displayName: string; online: boolean; lastSeen: number }
export interface SymbolRef { provider: string; symbol: string; label?: string; segment?: string }

export type Channel = 'candle' | 'depth' | 'trade' | 'ticker' | 'analytics' | 'signal' | 'annotation';

type FrameKind = 'snapshot' | 'update' | 'error';

interface Frame {
  id: string; type: FrameKind; provider: string; symbol: string; channel: Channel; key?: string;
  data?: unknown; error?: string;
}

interface Pending {
  onSnapshot: (data: unknown) => void;
  onUpdate: (data: unknown) => void;
  onError?: (err: string) => void;
}

const wsUrlFromLocation = (): string => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
};

export class ProviderClient {
  private ws: WebSocket | null = null;
  private readonly subs = new Map<string, Pending>();
  /** Queue of frames to send once the WS opens. */
  private outbox: string[] = [];
  private nextId = 1;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(connected: boolean) => void>();

  constructor(private readonly wsUrl: string = wsUrlFromLocation()) {
    this.connect();
  }

  onConnectionChange(fn: (connected: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private connect(): void {
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      for (const msg of this.outbox) ws.send(msg);
      this.outbox = [];
      // Re-subscribe to all active streams.
      for (const [id, ] of this.subs) {
        const meta = this.subMeta.get(id);
        if (meta) ws.send(JSON.stringify({ op: 'sub', id, ...meta }));
      }
      for (const fn of this.listeners) fn(true);
    });
    ws.addEventListener('message', (ev) => {
      let frame: Frame;
      try { frame = JSON.parse(ev.data); } catch { return; }
      const sub = this.subs.get(frame.id);
      if (!sub) return;
      if (frame.type === 'snapshot') sub.onSnapshot(frame.data);
      else if (frame.type === 'update') sub.onUpdate(frame.data);
      else if (frame.type === 'error' && sub.onError) sub.onError(frame.error ?? 'unknown error');
    });
    ws.addEventListener('close', () => {
      for (const fn of this.listeners) fn(false);
      this.ws = null;
      const attempt = ++this.reconnectAttempts;
      const delay = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
    ws.addEventListener('error', () => { /* close handler will reconnect */ });
  }

  private subMeta = new Map<string, { provider: string; symbol: string; channel: Channel; interval?: string }>();

  private send(obj: unknown): void {
    const msg = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(msg);
    else this.outbox.push(msg);
  }

  private subscribe<S, U>(
    meta: { provider: string; symbol: string; channel: Channel; interval?: string },
    onSnapshot: (data: S) => void,
    onUpdate: (data: U) => void,
  ): () => void {
    const id = String(this.nextId++);
    this.subs.set(id, {
      onSnapshot: (d) => onSnapshot(d as S),
      onUpdate: (d) => onUpdate(d as U),
    });
    this.subMeta.set(id, meta);
    this.send({ op: 'sub', id, ...meta });
    return () => {
      this.subs.delete(id);
      this.subMeta.delete(id);
      this.send({ op: 'unsub', id });
    };
  }

  streamCandles(provider: string, symbol: string, interval: string, onSnapshot: (c: Candle[]) => void, onUpdate: (c: { candle: Candle; isFinal: boolean }) => void): () => void {
    return this.subscribe({ provider, symbol, channel: 'candle', interval }, onSnapshot, onUpdate);
  }

  streamDepth(provider: string, symbol: string, onSnapshot: (s: OrderBookSnapshot | null) => void, onUpdate: (d: DepthDelta) => void): () => void {
    return this.subscribe({ provider, symbol, channel: 'depth' }, onSnapshot, onUpdate);
  }

  streamTrades(provider: string, symbol: string, onTrade: (t: Trade) => void): () => void {
    return this.subscribe<unknown, Trade>({ provider, symbol, channel: 'trade' }, () => undefined, onTrade);
  }

  streamBookTicker(provider: string, symbol: string, onTicker: (t: BookTicker) => void): () => void {
    return this.subscribe<unknown, BookTicker>({ provider, symbol, channel: 'ticker' }, () => undefined, onTicker);
  }

  streamAnalytics(provider: string, symbol: string, onData: (data: AnalyticsData) => void): () => void {
    return this.subscribe<unknown, AnalyticsData>({ provider, symbol, channel: 'analytics' }, () => undefined, onData);
  }

  streamAISignals(provider: string, symbol: string, onSig: (sig: AISignal) => void): () => void {
    return this.subscribe<unknown, AISignal>({ provider, symbol, channel: 'signal' }, () => undefined, onSig);
  }

  streamAIAnnotation(provider: string, symbol: string, onAnn: (ann: AIAnnotation) => void): () => void {
    return this.subscribe<unknown, AIAnnotation>({ provider, symbol, channel: 'annotation' }, () => undefined, onAnn);
  }

  async listProviders(): Promise<ProviderInfo[]> {
    const r = await fetch('/api/providers');
    if (!r.ok) return [];
    return r.json();
  }

  async searchSymbols(q: string, limit = 20): Promise<SymbolRef[]> {
    const r = await fetch(`/api/symbols/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    if (!r.ok) return [];
    return r.json();
  }
}
