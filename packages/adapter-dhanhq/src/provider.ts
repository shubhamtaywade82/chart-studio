import type { AxiosInstance } from 'axios';
import type {
  BookTicker,
  Candle,
  DepthDelta,
  InstrumentMeta,
  MarketDataProvider,
  OrderBookSnapshot,
  SymbolRef,
  Trade,
  Unsub,
} from '@chart-studio/adapter-core';
import {
  findInstrument,
  loadInstruments,
  fetchInstrumentsFromApi,
  searchInstruments,
  toInstrumentMeta,
  toSymbolRef,
  type DhanInstrument,
} from './instruments';
import { createClient, fetchCandles, fetchMarketDepth } from './rest';
import { DhanStreamPool, type DhanTick } from './ws';
import type { TokenProvider } from './token-provider';

const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000, '12h': 43_200_000,
  '1d': 86_400_000,
};

export interface DhanProviderConfig {
  id?: string;
  displayName?: string;
  tokens: TokenProvider;
  /** Override the scrip master URL (e.g. for testing). */
  scripMasterUrl?: string;
  /** "ticker" | "quote" | "full" — default "full" for depth + LTP. */
  feedMode?: 'ticker' | 'quote' | 'full';
}

export class DhanProvider implements MarketDataProvider {
  readonly id: string;
  readonly displayName: string;
  private client: AxiosInstance;
  private pool: DhanStreamPool;
  private instrumentCache: DhanInstrument[] = [];

  constructor(private readonly cfg: DhanProviderConfig) {
    this.id = cfg.id ?? 'dhanhq';
    this.displayName = cfg.displayName ?? 'DhanHQ';
    this.client = createClient(cfg.tokens);
    this.pool = new DhanStreamPool(cfg.tokens, cfg.feedMode ?? 'full');
  }

  async init(): Promise<void> {
    const segments = ['NSE_EQ', 'NSE_FNO', 'NSE_CURRENCY', 'BSE_EQ', 'BSE_FNO', 'MCX_COMM'];
    try {
      this.instrumentCache = await fetchInstrumentsFromApi(this.client, segments);
    } catch (err) {
      console.warn('[dhanhq] failed to fetch instruments from API, falling back to CSV', err);
    }

    if (this.instrumentCache.length === 0) {
      this.instrumentCache = await loadInstruments(this.cfg.scripMasterUrl).catch(() => []);
    }
  }

  async shutdown(): Promise<void> {
    this.pool.shutdown();
    this.cfg.tokens.shutdown();
  }

  // ── Discovery ────────────────────────────────────────────────────────

  async searchSymbols(query: string, limit = 20): Promise<SymbolRef[]> {
    const rows = this.instrumentCache.length > 0 ? this.instrumentCache : await loadInstruments(this.cfg.scripMasterUrl);
    return searchInstruments(rows, query, limit).map((r) => toSymbolRef(this.id, r));
  }

  async listSymbols(filter?: { segment?: string }): Promise<InstrumentMeta[]> {
    const rows = this.instrumentCache.length > 0 ? this.instrumentCache : await loadInstruments(this.cfg.scripMasterUrl);
    const out = rows.map((r) => toInstrumentMeta(this.id, r));
    if (!filter?.segment) return out;
    const seg = filter.segment.toLowerCase();
    return out.filter((m) => m.segment === seg);
  }

  async getInstrumentMeta(symbol: string): Promise<InstrumentMeta | null> {
    const ins = findInstrument(symbol);
    if (!ins) return null;
    return toInstrumentMeta(this.id, ins);
  }

  // ── Snapshots ────────────────────────────────────────────────────────

  async getCandles(symbol: string, interval: string, opts: { limit?: number; startTime?: number; endTime?: number } = {}): Promise<Candle[]> {
    const ins = findInstrument(symbol);
    if (!ins) return [];
    return fetchCandles(this.client, ins, interval, opts);
  }

  async getOrderBook(symbol: string): Promise<OrderBookSnapshot | null> {
    const ins = findInstrument(symbol);
    if (!ins) return null;
    return fetchMarketDepth(this.client, ins);
  }

  // ── Streams ──────────────────────────────────────────────────────────

  streamCandles(symbol: string, interval: string, onCandle: (c: Candle, isFinal: boolean) => void): Unsub {
    const ins = findInstrument(symbol);
    if (!ins) return () => undefined;

    const ms = INTERVAL_MS[interval] ?? 60_000;
    let current: Candle | null = null;

    return this.pool.subscribe(
      { exchangeSegment: ins.exchangeSegment, securityId: ins.securityId },
      (tick: DhanTick) => {
        if (typeof tick.ltp !== 'number') return;
        const now = Date.now();
        const openTime = Math.floor(now / ms) * ms;

        if (!current || current.openTime !== openTime) {
          if (current) onCandle(current, true);
          current = {
            openTime,
            open: tick.ltp,
            high: tick.ltp,
            low: tick.ltp,
            close: tick.ltp,
            volume: typeof tick.volume === 'number' ? tick.volume : 0,
          };
        } else {
          current = {
            ...current,
            high: Math.max(current.high, tick.ltp),
            low: Math.min(current.low, tick.ltp),
            close: tick.ltp,
            volume: typeof tick.volume === 'number' ? tick.volume : current.volume,
          };
        }
        onCandle(current, false);
      },
    );
  }

  streamDepth(symbol: string, onDelta: (d: DepthDelta) => void): Unsub {
    const ins = findInstrument(symbol);
    if (!ins) return () => undefined;
    let counter = 0;
    return this.pool.subscribe(
      { exchangeSegment: ins.exchangeSegment, securityId: ins.securityId },
      (tick: DhanTick) => {
        if (!tick.bids || !tick.asks) return; // only Full packets carry depth
        counter += 1;
        const bids = tick.bids.filter(([p]) => Number.isFinite(p) && p > 0).map(([p, q]) => [p, q] as [number, number]);
        const asks = tick.asks.filter(([p]) => Number.isFinite(p) && p > 0).map(([p, q]) => [p, q] as [number, number]);
        onDelta({
          firstUpdateId: counter,
          finalUpdateId: counter,
          bids,
          asks,
          ts: tick.ts,
          replacement: true,
        });
      },
    );
  }

  streamTrades(symbol: string, onTrade: (t: Trade) => void): Unsub {
    const ins = findInstrument(symbol);
    if (!ins) return () => undefined;
    let lastLtt: number | undefined;
    return this.pool.subscribe(
      { exchangeSegment: ins.exchangeSegment, securityId: ins.securityId },
      (tick: DhanTick) => {
        if (typeof tick.ltp !== 'number') return;
        if (typeof tick.ltt === 'number' && tick.ltt === lastLtt) return;
        lastLtt = tick.ltt;
        onTrade({
          price: tick.ltp,
          qty: tick.ltq ?? 0,
          ts: tick.ltt ? tick.ltt * 1000 : tick.ts,
          makerSide: false,
        });
      },
    );
  }

  streamBookTicker(symbol: string, onTicker: (t: BookTicker) => void): Unsub {
    const ins = findInstrument(symbol);
    if (!ins) return () => undefined;
    return this.pool.subscribe(
      { exchangeSegment: ins.exchangeSegment, securityId: ins.securityId },
      (tick: DhanTick) => {
        const bid = tick.bids?.[0];
        const ask = tick.asks?.[0];
        if (!bid || !ask) return;
        onTicker({
          bestBidPrice: bid[0],
          bestBidQty: bid[1],
          bestAskPrice: ask[0],
          bestAskQty: ask[1],
          ts: tick.ts,
        });
      },
    );
  }

  streamAnalytics(
    symbol: string,
    onData: (data: AnalyticsPayload) => void,
  ): Unsub {
    const ins = findInstrument(symbol);
    if (!ins) return () => undefined;
    const state = { dayOpen: 0, dayHigh: 0, dayLow: 0, dayClose: 0, prevClose: 0, prevOi: 0 };
    return this.pool.subscribe(
      { exchangeSegment: ins.exchangeSegment, securityId: ins.securityId },
      (tick: DhanTick) => {
        if (typeof tick.ltp !== 'number') return;

        // Update day OHLC from packets that carry them (Quote=4 / Full=8).
        // Note: code 6 (PrevClose) does NOT set tick.close anymore — it sets
        // tick.prevClose, so dayClose stays stable across packet types.
        if (typeof tick.open === 'number') state.dayOpen = tick.open;
        if (typeof tick.high === 'number') state.dayHigh = tick.high;
        if (typeof tick.low === 'number') state.dayLow = tick.low;
        if (typeof tick.close === 'number') state.dayClose = tick.close;
        if (typeof tick.prevClose === 'number') state.prevClose = tick.prevClose;
        if (typeof tick.prevOi === 'number') state.prevOi = tick.prevOi;

        const depthBids = tick.bids
          ?.filter(([p]) => Number.isFinite(p) && p > 0)
          .map(([price, qty, orders]) => ({ price, qty, orders }));
        const depthAsks = tick.asks
          ?.filter(([p]) => Number.isFinite(p) && p > 0)
          .map(([price, qty, orders]) => ({ price, qty, orders }));

        onData({
          ltp: tick.ltp,
          atp: tick.atp ?? 0,
          ltq: tick.ltq ?? 0,
          ltt: tick.ltt ?? 0,
          volume: tick.volume ?? 0,
          totalBuyQty: tick.totalBuyQty ?? 0,
          totalSellQty: tick.totalSellQty ?? 0,
          oi: tick.openInterest,
          highOi: tick.highOi,
          lowOi: tick.lowOi,
          dayOpen: state.dayOpen,
          dayHigh: state.dayHigh,
          dayLow: state.dayLow,
          dayClose: state.dayClose,
          depthBids,
          depthAsks,
          prevClose: state.prevClose || undefined,
          prevOi: state.prevOi || undefined,
        });
      },
    );
  }
}

export interface AnalyticsPayload {
  ltp: number;
  atp: number;
  ltq: number;
  ltt: number;
  volume: number;
  totalBuyQty: number;
  totalSellQty: number;
  oi: number | undefined;
  highOi: number | undefined;
  lowOi: number | undefined;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  dayClose: number;
  depthBids: Array<{ price: number; qty: number; orders: number }> | undefined;
  depthAsks: Array<{ price: number; qty: number; orders: number }> | undefined;
  prevClose: number | undefined;
  prevOi: number | undefined;
}
