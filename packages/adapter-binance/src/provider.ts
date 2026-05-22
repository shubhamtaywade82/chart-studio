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
import type { BinanceConfig } from './rest';
import {
  fetchDepthSnapshot,
  fetchKlines,
  fetchOpenInterest,
  fetchTicker24hr,
  loadExchangeInfo,
  toInstrumentMeta,
  toSymbolRef,
} from './rest';
import { BinanceStreamPool, parseKlineEvent } from './ws';
import { FundingRateTracker } from './funding-rate';
import { LiquidationFeed } from './liquidation-feed';
import { BasisTracker } from './basis-tracker';
import { OIDeltaTracker } from './oi-delta';

interface DepthRaw { U?: number; u?: number; pu?: number; E?: number; b?: [string, string][]; a?: [string, string][] }
interface AggTradeRaw { p?: string; q?: string; T?: number; m?: boolean; a?: number }
interface BookTickerRaw { u?: number; b?: string; B?: string; a?: string; A?: string }
interface TickerRaw { o?: string; h?: string; l?: string; c?: string; w?: string; v?: string; q?: string; Q?: string; x?: string; n?: number; E?: number }
interface PartialDepthRaw { bids?: [string, string][]; asks?: [string, string][]; b?: [string, string][]; a?: [string, string][] }
interface MarkPriceRaw { p?: string; i?: string; r?: string; T?: number; E?: number }

interface BinanceAnalyticsPayload {
  ltp: number; atp: number; ltq: number; ltt: number;
  volume: number; totalBuyQty: number; totalSellQty: number;
  oi: number | undefined; highOi: number | undefined; lowOi: number | undefined;
  dayOpen: number; dayHigh: number; dayLow: number; dayClose: number;
  depthBids: Array<{ price: number; qty: number; orders: number }> | undefined;
  depthAsks: Array<{ price: number; qty: number; orders: number }> | undefined;
  prevClose: number | undefined; prevOi: number | undefined;
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

const segmentLabel = (cfg: BinanceConfig): string => (cfg.product === 'spot' ? 'spot' : 'futures');

export class BinanceProvider implements MarketDataProvider {
  readonly id: string;
  readonly displayName: string;
  private readonly pool: BinanceStreamPool;
  
  private fundingTracker: FundingRateTracker;
  private liquidationFeed: LiquidationFeed;
  private basisTracker: BasisTracker;
  private oiTracker: OIDeltaTracker;

  constructor(private readonly cfg: BinanceConfig & { id?: string; displayName?: string }) {
    this.id = cfg.id ?? (cfg.product === 'spot' ? 'binance-spot' : 'binance-usdm');
    this.displayName = cfg.displayName ?? (cfg.product === 'spot' ? 'Binance Spot' : 'Binance USD-M Futures');
    this.pool = new BinanceStreamPool(cfg);
    this.fundingTracker = new FundingRateTracker(cfg);
    this.liquidationFeed = new LiquidationFeed();
    this.basisTracker = new BasisTracker();
    this.oiTracker = new OIDeltaTracker(cfg);
  }

  async init(): Promise<void> {
    // Preload exchange info so first-symbol-search is fast.
    await loadExchangeInfo(this.cfg, this.id).catch(() => undefined);
  }

  async shutdown(): Promise<void> {
    this.pool.shutdown();
  }

  // ── Discovery ────────────────────────────────────────────────────────

  async searchSymbols(query: string, limit = 20): Promise<SymbolRef[]> {
    const symbols = await loadExchangeInfo(this.cfg, this.id);
    const q = query.trim().toUpperCase();
    const seg = segmentLabel(this.cfg);
    if (!q) return symbols.slice(0, limit).map((s) => toSymbolRef(this.id, seg, s));
    const matches: SymbolRef[] = [];
    for (const s of symbols) {
      const ref = toSymbolRef(this.id, seg, s);
      const hay = `${ref.symbol} ${ref.label || ''}`.toUpperCase();
      if (hay.includes(q)) matches.push(ref);
      if (matches.length >= limit) break;
    }
    return matches;
  }

  async listSymbols(): Promise<InstrumentMeta[]> {
    const symbols = await loadExchangeInfo(this.cfg, this.id);
    const seg = segmentLabel(this.cfg);
    return symbols.map((s) => toInstrumentMeta(this.id, seg, s));
  }

  async getInstrumentMeta(symbol: string): Promise<InstrumentMeta | null> {
    const symbols = await loadExchangeInfo(this.cfg, this.id);
    const sym = symbol.toUpperCase();
    const match = symbols.find((s) => s.symbol.toUpperCase() === sym);
    if (!match) return null;
    return toInstrumentMeta(this.id, segmentLabel(this.cfg), match);
  }

  // ── Snapshots ────────────────────────────────────────────────────────

  getCandles(symbol: string, interval: string, opts: { limit?: number; startTime?: number; endTime?: number } = {}): Promise<Candle[]> {
    return fetchKlines(this.cfg, symbol, interval, opts);
  }

  getOrderBook(symbol: string, limit = 100): Promise<OrderBookSnapshot | null> {
    return fetchDepthSnapshot(this.cfg, symbol, limit);
  }

  // ── Streams ──────────────────────────────────────────────────────────

  streamCandles(symbol: string, interval: string, onCandle: (c: Candle, isFinal: boolean) => void): Unsub {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    const unsubWs = this.pool.subscribe(stream, (raw) => {
      const ev = parseKlineEvent(raw);
      if (ev) onCandle(ev.candle, ev.isFinal);
    });

    // REST poll fallback — binance futures market WS push is geo-blocked from
    // many networks (handshake succeeds, no frames arrive). Polling klines
    // keeps the chart's live bar moving regardless.
    let lastOpenTime = 0;
    const tick = async (): Promise<void> => {
      try {
        const bars = await fetchKlines(this.cfg, symbol, interval, { limit: 2 });
        const live = bars[bars.length - 1];
        const prev = bars.length > 1 ? bars[bars.length - 2] : undefined;
        if (!live) return;
        if (prev && prev.openTime > lastOpenTime) {
          lastOpenTime = prev.openTime;
          onCandle(prev, true);
        }
        const liveBar: Candle = {
          openTime: live.openTime, open: live.open, high: live.high,
          low: live.low, close: live.close, volume: live.volume,
          closeTime: live.closeTime, sealed: false,
        };
        onCandle(liveBar, false);
      } catch { /* swallow */ }
    };
    const timer = setInterval(() => { void tick(); }, 1500);
    void tick();

    return () => {
      clearInterval(timer);
      unsubWs();
    };
  }

  streamDepth(symbol: string, onDelta: (d: DepthDelta) => void): Unsub {
    const speed = this.cfg.product === 'spot' ? '' : '@100ms';
    const stream = `${symbol.toLowerCase()}@depth${speed}`;
    return this.pool.subscribe(stream, (raw) => {
      const r = raw as DepthRaw;
      if (typeof r.U !== 'number' || typeof r.u !== 'number') return;
      const bids = (r.b ?? []).map(([p, q]) => [Number(p), Number(q)] as [number, number]);
      const asks = (r.a ?? []).map(([p, q]) => [Number(p), Number(q)] as [number, number]);
      const delta: DepthDelta = {
        firstUpdateId: r.U,
        finalUpdateId: r.u,
        bids,
        asks,
        ts: typeof r.E === 'number' ? r.E : Date.now(),
        ...(typeof r.pu === 'number' ? { prevUpdateId: r.pu } : {}),
      };
      onDelta(delta);
    });
  }

  streamTrades(symbol: string, onTrade: (t: Trade) => void): Unsub {
    const stream = `${symbol.toLowerCase()}@aggTrade`;
    return this.pool.subscribe(stream, (raw) => {
      const r = raw as AggTradeRaw;
      const price = Number(r.p);
      const qty = Number(r.q);
      const ts = Number(r.T);
      if (![price, qty, ts].every(Number.isFinite)) return;
      onTrade({ price, qty, ts, makerSide: Boolean(r.m), tradeId: r.a });
    });
  }

  /**
   * Synthesize an analytics payload (LTP, day OHLC, top-of-book depth, buy/sell
   * intensity) by combining @aggTrade + @ticker + @depth5 streams. Emits on
   * every aggTrade (sub-second cadence) so price line moves live.
   */
  streamAnalytics(symbol: string, onData: (data: BinanceAnalyticsPayload) => void): Unsub {
    const sym = symbol.toLowerCase();
    const state = {
      ltp: 0, atp: 0, ltq: 0, ltt: 0,
      volume: 0, totalBuyQty: 0, totalSellQty: 0,
      dayOpen: 0, dayHigh: 0, dayLow: 0, dayClose: 0,
      prevClose: 0 as number | undefined,
      oi: undefined as number | undefined,
      depthBids: undefined as Array<{ price: number; qty: number; orders: number }> | undefined,
      depthAsks: undefined as Array<{ price: number; qty: number; orders: number }> | undefined,
      fundingRate: 0, fundingRateAPR: 0, nextFundingTime: 0, longShortRatio: 0,
      liqLong: 0, liqShort: 0, cascade: false
    };

    let pollingTimer: ReturnType<typeof setInterval>;
    if (this.cfg.product === 'usdm') {
      const pollCrypto = async () => {
        try {
          const [funding, oiData, lsData] = await Promise.all([
            this.fundingTracker.getPremiumIndex(symbol),
            this.oiTracker.getOpenInterest(symbol),
            this.oiTracker.getLongShortRatio(symbol)
          ]);
          if (funding) {
            state.fundingRate = funding.fundingRate;
            state.fundingRateAPR = funding.fundingRateAPR;
            state.nextFundingTime = funding.nextFundingTime;
          }
          if (oiData) state.oi = oiData.openInterest;
          if (lsData) state.longShortRatio = lsData.longShortRatio;
          
          const liqStatus = this.liquidationFeed.getRecentCascades(symbol);
          state.cascade = liqStatus.cascadeDetected;
          
          // Assuming 1 min bucket is the latest
          const latestBucket = Array.from(this.liquidationFeed['buckets'].values()).sort((a,b) => b.timestamp - a.timestamp)[0];
          if (latestBucket) {
            state.liqLong = latestBucket.longLiqUsd;
            state.liqShort = latestBucket.shortLiqUsd;
          }
        } catch (e) {
          // ignore polling errors
        }
      };
      
      pollCrypto();
      pollingTimer = setInterval(pollCrypto, 30_000);
    }

    const emit = (): void => {
      if (state.ltp <= 0) return;
      
      const cryptoMetrics = this.cfg.product === 'usdm' ? {
        fundingRate: state.fundingRate,
        fundingRateAPR: state.fundingRateAPR,
        nextFundingTime: state.nextFundingTime,
        longShortRatio: state.longShortRatio,
        openInterestUsd: state.oi && state.ltp ? state.oi * state.ltp : 0,
        basisPct: this.basisTracker.getBasis(symbol)?.basisPct ?? 0,
        liquidations: {
          long: state.liqLong,
          short: state.liqShort,
          cascadeDetected: state.cascade
        }
      } : undefined;

      onData({
        ltp: state.ltp,
        atp: state.atp,
        ltq: state.ltq,
        ltt: state.ltt,
        volume: state.volume,
        totalBuyQty: state.totalBuyQty,
        totalSellQty: state.totalSellQty,
        oi: state.oi,
        highOi: undefined,
        lowOi: undefined,
        dayOpen: state.dayOpen,
        dayHigh: state.dayHigh,
        dayLow: state.dayLow,
        dayClose: state.dayClose,
        depthBids: state.depthBids,
        depthAsks: state.depthAsks,
        prevClose: state.prevClose && state.prevClose > 0 ? state.prevClose : undefined,
        prevOi: undefined,
        cryptoMetrics,
      });
    };

    const unsubAgg = this.pool.subscribe(`${sym}@aggTrade`, (raw) => {
      const r = raw as AggTradeRaw;
      const price = Number(r.p);
      const qty = Number(r.q);
      const ts = Number(r.T);
      if (![price, qty, ts].every(Number.isFinite)) return;
      state.ltp = price;
      state.ltq = qty;
      state.ltt = ts;
      if (r.m) state.totalSellQty += qty;
      else state.totalBuyQty += qty;
      if (this.cfg.product === 'usdm') {
        this.basisTracker.updatePerpPrice(symbol, price);
      } else {
        this.basisTracker.updateSpotPrice(symbol, price);
      }
      emit();
    });

    const unsubTicker = this.pool.subscribe(`${sym}@ticker`, (raw) => {
      const r = raw as TickerRaw;
      const o = Number(r.o); const h = Number(r.h); const l = Number(r.l); const c = Number(r.c);
      const w = Number(r.w); const v = Number(r.v); const x = Number(r.x);
      if (Number.isFinite(o)) state.dayOpen = o;
      if (Number.isFinite(h)) state.dayHigh = h;
      if (Number.isFinite(l)) state.dayLow = l;
      if (Number.isFinite(c)) state.dayClose = c;
      if (Number.isFinite(w)) state.atp = w;
      if (Number.isFinite(v)) state.volume = v;
      if (Number.isFinite(x) && x > 0) state.prevClose = x;
      if (state.ltp === 0 && Number.isFinite(c)) state.ltp = c;
      emit();
    });

    const depthStream = this.cfg.product === 'spot' ? `${sym}@depth20@100ms` : `${sym}@depth20@100ms`;
    const unsubDepth = this.pool.subscribe(depthStream, (raw) => {
      const r = raw as PartialDepthRaw;
      const bidsRaw = r.bids ?? r.b ?? [];
      const asksRaw = r.asks ?? r.a ?? [];
      state.depthBids = bidsRaw
        .map(([p, q]) => ({ price: Number(p), qty: Number(q), orders: 0 }))
        .filter((b) => Number.isFinite(b.price) && b.price > 0 && b.qty > 0);
      state.depthAsks = asksRaw
        .map(([p, q]) => ({ price: Number(p), qty: Number(q), orders: 0 }))
        .filter((a) => Number.isFinite(a.price) && a.price > 0 && a.qty > 0);
      emit();
    });

    const unsubMark = this.cfg.product === 'usdm'
      ? this.pool.subscribe(`${sym}@markPrice@1s`, (raw) => {
          const r = raw as MarkPriceRaw;
          const mark = Number(r.p);
          if (Number.isFinite(mark) && mark > 0 && state.ltp === 0) {
            state.ltp = mark;
            emit();
          }
        })
      : () => undefined;

    // REST poll fallback (fstream push is geo-blocked on many networks):
    // refresh day OHLC + depth + OI every ~1.5s and emit. Cheap, public.
    const pollTick = async (): Promise<void> => {
      try {
        const [t, depth, oi] = await Promise.all([
          fetchTicker24hr(this.cfg, symbol),
          fetchDepthSnapshot(this.cfg, symbol, 20),
          fetchOpenInterest(this.cfg, symbol),
        ]);
        if (t) {
          if (Number.isFinite(t.open)) state.dayOpen = t.open;
          if (Number.isFinite(t.high)) state.dayHigh = t.high;
          if (Number.isFinite(t.low)) state.dayLow = t.low;
          if (Number.isFinite(t.lastPrice) && t.lastPrice > 0) {
            state.dayClose = t.lastPrice;
            state.ltp = t.lastPrice;
            state.ltt = t.closeTime || Date.now();
          }
          if (Number.isFinite(t.weightedAvgPrice)) state.atp = t.weightedAvgPrice;
          if (Number.isFinite(t.volume)) {
            // Synthesize ltq from rolling-window volume delta so the vol
            // profile keeps building even when REST exposes a stale lastQty
            // (or when fstream aggTrade WS is geo-blocked).
            const delta = t.volume - state.volume;
            if (delta > 0 && state.volume > 0) state.ltq = delta;
            state.volume = t.volume;
          }
          if (Number.isFinite(t.lastQty) && t.lastQty > 0) state.ltq = t.lastQty;
          if (t.prevClosePrice) state.prevClose = t.prevClosePrice;
        }
        if (depth) {
          state.depthBids = depth.bids.slice(0, 20)
            .filter(([p, q]) => p > 0 && q > 0)
            .map(([p, q]) => ({ price: p, qty: q, orders: 0 }));
          state.depthAsks = depth.asks.slice(0, 20)
            .filter(([p, q]) => p > 0 && q > 0)
            .map(([p, q]) => ({ price: p, qty: q, orders: 0 }));
        }
        if (oi !== null) state.oi = oi;
        emit();
      } catch { /* swallow */ }
    };
    const pollTimer = setInterval(() => { void pollTick(); }, 1500);
    void pollTick();

    const unsubForce = this.cfg.product === 'usdm' ? this.pool.subscribe(`${sym}@forceOrder`, (raw) => {
      const payload = (raw as { o: any })?.o;
      if (payload) {
        this.liquidationFeed.processEvent({
          symbol: payload.s,
          side: payload.S as 'BUY' | 'SELL',
          price: Number(payload.p),
          qty: Number(payload.q),
          notionalUsd: Number(payload.p) * Number(payload.q),
          time: Number(payload.T)
        });
      }
    }) : () => {};

    return () => {
      unsubAgg();
      unsubTicker();
      unsubDepth();
      unsubMark();
      unsubForce();
      if (pollingTimer) clearInterval(pollingTimer);
      clearInterval(pollTimer);
    };
  }

  streamBookTicker(symbol: string, onTicker: (t: BookTicker) => void): Unsub {
    const stream = `${symbol.toLowerCase()}@bookTicker`;
    return this.pool.subscribe(stream, (raw) => {
      const r = raw as BookTickerRaw;
      const bp = Number(r.b);
      const bq = Number(r.B);
      const ap = Number(r.a);
      const aq = Number(r.A);
      if (![bp, bq, ap, aq].every(Number.isFinite)) return;
      onTicker({ bestBidPrice: bp, bestBidQty: bq, bestAskPrice: ap, bestAskQty: aq, ts: Date.now() });
    });
  }
}
