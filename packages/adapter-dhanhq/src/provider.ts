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
  findInstrumentAsync,
  loadInstruments,
  fetchInstrumentsFromApi,
  searchInstruments,
  toInstrumentMeta,
  toSymbolRef,
  type DhanInstrument,
} from './instruments';
import { createClient, fetchCandles, fetchMarketDepth } from './rest';
import { fetchOptionChain, calculateMaxPain, GreeksEngine } from './option-chain';
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
    const ins = await findInstrumentAsync(symbol, this.cfg.scripMasterUrl);
    if (!ins) return null;
    return toInstrumentMeta(this.id, ins);
  }

  // ── Snapshots ────────────────────────────────────────────────────────

  async getCandles(symbol: string, interval: string, opts: { limit?: number; startTime?: number; endTime?: number } = {}): Promise<Candle[]> {
    const ins = await findInstrumentAsync(symbol, this.cfg.scripMasterUrl);
    if (!ins) return [];
    return fetchCandles(this.client, ins, interval, opts);
  }

  async getOrderBook(symbol: string, limit?: number): Promise<OrderBookSnapshot | null> {
    const ins = await findInstrumentAsync(symbol, this.cfg.scripMasterUrl);
    if (!ins) return null;
    return fetchMarketDepth(this.client, ins);
  }

  async getOptionChain(symbol: string): Promise<any> {
    const ins = await findInstrumentAsync(symbol, this.cfg.scripMasterUrl);
    if (!ins) return null;

    // Greeks need the underlying price (S). We'll try to get it from the pool's last tick.
    const underlyingTick = this.pool.getLastTick(symbol);
    const S = underlyingTick?.ltp || 0;

    const items = await fetchOptionChain(this.client, ins);
    const maxPain = calculateMaxPain(items);

    const engine = new GreeksEngine();
    const now = Date.now();

    const strikesWithGreeks = items.map(item => {
      // Find the specific option instruments to get exact expiry dates
      const callOpt = this.instrumentCache.find(i => 
        i.symbolName.startsWith(ins.symbolName) && 
        (i.instrumentType.startsWith('OPT') || i.instrumentType === 'OP') &&
        i.strikePrice === item.strikePrice &&
        i.optionType === 'CE'
      );
      
      const putOpt = this.instrumentCache.find(i => 
        i.symbolName.startsWith(ins.symbolName) && 
        (i.instrumentType.startsWith('OPT') || i.instrumentType === 'OP') &&
        i.strikePrice === item.strikePrice &&
        i.optionType === 'PE'
      );

      // Default to 7 days if exact expiry not found
      let callT = 7 / 365;
      if (callOpt?.expiryDate) {
        const expiryTs = Date.parse(callOpt.expiryDate);
        callT = Math.max(0.5, (expiryTs - now) / (1000 * 60 * 60 * 24)) / 365;
      }
      
      let putT = 7 / 365;
      if (putOpt?.expiryDate) {
        const expiryTs = Date.parse(putOpt.expiryDate);
        putT = Math.max(0.5, (expiryTs - now) / (1000 * 60 * 60 * 24)) / 365;
      }

      let callIV = item.callIV;
      if (!callIV || callIV <= 0) {
        callIV = engine.calculateIV(S, item.strikePrice, callT, item.callLTP, true);
        item.callIV = callIV; // Update item so it shows in UI
      }

      let putIV = item.putIV;
      if (!putIV || putIV <= 0) {
        putIV = engine.calculateIV(S, item.strikePrice, putT, item.putLTP, false);
        item.putIV = putIV; // Update item so it shows in UI
      }

      const callGreeks = engine.calculate(S, item.strikePrice, callT, callIV || 0.15, true);
      const putGreeks = engine.calculate(S, item.strikePrice, putT, putIV || 0.15, false);
      
      return {
        ...item,
        callDelta: callGreeks.delta,
        callGamma: callGreeks.gamma,
        callTheta: callGreeks.theta,
        callVega: callGreeks.vega,
        putDelta: putGreeks.delta,
        putGamma: putGreeks.gamma,
        putTheta: putGreeks.theta,
        putVega: putGreeks.vega,
      };
    });

    // Calculate S/R based on highest OI
    let supportOI = 0;
    let resistanceOI = 0;
    let highPutOI = 0;
    let highCallOI = 0;

    for (const item of items) {
      if (item.putOI > highPutOI) {
        highPutOI = item.putOI;
        supportOI = item.strikePrice;
      }
      if (item.callOI > highCallOI) {
        highCallOI = item.callOI;
        resistanceOI = item.strikePrice;
      }
    }

    return {
      underlying: symbol,
      timestamp: Date.now(),
      strikes: strikesWithGreeks,
      maxPain,
      supportOI,
      resistanceOI,
      spotPrice: S
    };
  }


  // ── Streams ──────────────────────────────────────────────────────────


  /**
   * Resolves the instrument synchronously when possible, async otherwise.
   * Returns a deferred-subscription Unsub so callers can `unsubs.push(...)`
   * immediately even if the scrip master hasn't loaded yet.
   */
  private deferredSubscribe(symbol: string, attach: (ins: DhanInstrument) => Unsub): Unsub {
    const cached = findInstrument(symbol);
    if (cached) return attach(cached);

    let realUnsub: Unsub | null = null;
    let cancelled = false;
    void findInstrumentAsync(symbol, this.cfg.scripMasterUrl).then((ins) => {
      if (cancelled || !ins) {
        if (!ins) console.warn(`[dhanhq] instrument not found: ${symbol}`);
        return;
      }
      realUnsub = attach(ins);
    });
    return () => {
      cancelled = true;
      if (realUnsub) try { realUnsub(); } catch { /* noop */ }
    };
  }

  streamCandles(symbol: string, interval: string, onCandle: (c: Candle, isFinal: boolean) => void): Unsub {
    const ms = INTERVAL_MS[interval] ?? 60_000;
    let current: Candle | null = null;
    /** Day cumulative volume at the exact moment THIS candle started. */
    let candleStartDayVol: number | null = null;
    /** Last seen day cumulative volume to carry over as base for next candle. */
    let lastDayVol: number | null = null;

    return this.deferredSubscribe(symbol, (ins) => this.pool.subscribe(
      { exchangeSegment: ins.exchangeSegment, securityId: ins.securityId },
      (tick: DhanTick) => {
        if (typeof tick.ltp !== 'number') return;
        
        // Use exchange-provided tick time (ltt) if available, fallback to local now.
        const tsMs = tick.ltt ? tick.ltt * 1000 : tick.ts;
        const openTime = Math.floor(tsMs / ms) * ms;
        const dayCumVol = (typeof tick.volume === 'number' && tick.volume > 0) ? tick.volume : null;

        if (!current || current.openTime !== openTime) {
          if (current) onCandle(current, true);
          
          // Carry over last seen volume as the base for the new candle.
          // If we haven't seen any volume yet, this first tick's volume becomes the base (initVol=0).
          candleStartDayVol = (dayCumVol !== null) ? (lastDayVol ?? dayCumVol) : null;
          
          const initVol = (dayCumVol !== null && candleStartDayVol !== null)
            ? Math.max(0, dayCumVol - candleStartDayVol)
            : (tick.ltq ?? 0);

          current = {
            openTime,
            open: tick.ltp,
            high: tick.ltp,
            low: tick.ltp,
            close: tick.ltp,
            volume: initVol,
          };
        } else {
          let candleVol = current.volume;
          if (dayCumVol !== null) {
            if (candleStartDayVol === null) {
              candleStartDayVol = dayCumVol;
            }
            candleVol = Math.max(0, dayCumVol - candleStartDayVol);
          } else if (typeof tick.ltq === 'number' && tick.ltq > 0) {
            candleVol += tick.ltq;
          }
          current = {
            ...current,
            high: Math.max(current.high, tick.ltp),
            low: Math.min(current.low, tick.ltp),
            close: tick.ltp,
            volume: candleVol,
          };
        }
        
        if (dayCumVol !== null) lastDayVol = dayCumVol;
        onCandle(current, false);
      },
    ));
  }

  streamDepth(symbol: string, onDelta: (d: DepthDelta) => void): Unsub {
    // Depth requires Full mode (RequestCode 21). Warn loudly if misconfigured —
    // ticker/quote feeds will never carry depth and the panel will stay empty.
    if (this.cfg.feedMode && this.cfg.feedMode !== 'full') {
      console.warn(`[dhanhq] streamDepth requires feedMode='full' (got '${this.cfg.feedMode}'); depth panel will be empty.`);
    }
    let counter = 0;
    return this.deferredSubscribe(symbol, (ins) => this.pool.subscribe(
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
    ));
  }

  streamTrades(symbol: string, onTrade: (t: Trade) => void): Unsub {
    let lastLtt: number | undefined;
    let lastLtp: number | undefined;
    let lastVol: number | undefined;
    return this.deferredSubscribe(symbol, (ins) => this.pool.subscribe(
      { exchangeSegment: ins.exchangeSegment, securityId: ins.securityId },
      (tick: DhanTick) => {
        if (typeof tick.ltp !== 'number') return;
        if (
          tick.ltt === lastLtt &&
          tick.ltp === lastLtp &&
          (tick.volume === undefined || tick.volume === lastVol)
        ) {
          return;
        }
        lastLtt = tick.ltt;
        lastLtp = tick.ltp;
        if (tick.volume !== undefined) lastVol = tick.volume;

        onTrade({
          price: tick.ltp,
          qty: tick.ltq ?? 0,
          ts: tick.ltt ? tick.ltt * 1000 : tick.ts,
          makerSide: false,
        });
      },
    ));
  }

  streamBookTicker(symbol: string, onTicker: (t: BookTicker) => void): Unsub {
    if (this.cfg.feedMode && this.cfg.feedMode !== 'full') {
      console.warn(`[dhanhq] streamBookTicker needs feedMode='full' for top-of-book; current='${this.cfg.feedMode}'.`);
    }
    return this.deferredSubscribe(symbol, (ins) => this.pool.subscribe(
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
    ));
  }

  streamAnalytics(
    symbol: string,
    onData: (data: AnalyticsPayload) => void,
  ): Unsub {
    const state = { dayOpen: 0, dayHigh: 0, dayLow: 0, dayClose: 0, prevClose: 0, prevOi: 0 };
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const unsub = this.deferredSubscribe(symbol, (ins) => {
      // Start option chain polling if it's an FNO instrument
      if (ins.exchangeSegment === 'NSE_FNO') {
        const poll = async () => {
          try {
            const chain = await this.getOptionChain(symbol);
            if (chain) onData({ optionChain: chain } as any);
          } catch (err) {
            console.warn(`[dhanhq] option chain poll error for ${symbol}`, err);
          }
        };
        void poll();
        pollTimer = setInterval(poll, 2000); // 2s polling for chain (NSE FNO)
      }

      return this.pool.subscribe(
        { exchangeSegment: ins.exchangeSegment, securityId: ins.securityId },
        (tick: DhanTick) => {
          if (typeof tick.ltp !== 'number') return;

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
    });

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      unsub();
    };
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
