import Redis from 'ioredis';
import type { DataEnvelope } from '@chart-studio/adapter-core';
import type { MicrostructureSnapshot, AIAnnotation, ReflexSignal } from './types';
import { DerivedState } from './derived';
import { reflex } from './reflex';
import { tactical } from './tactical';
import { narrate } from './narrative';
import { OllamaClient } from './ollama-client';
import { VectorStore } from './vector-store';
import { CorrelationTracker } from './correlation';
import { computeStrategySignal, type StrategySignalCandle } from './strategy-signal';

interface SymbolState {
  derived: DerivedState;
  candles: MicrostructureSnapshot['candles'];
  prevSnap: MicrostructureSnapshot | null;
  lastTacticalMs: number;
  lastNarrativeMs: number;
  lastEmbedMs: number;
  lastReflexKey: string;
}

const TACTICAL_INTERVAL_MS = Number(process.env.AI_TACTICAL_INTERVAL_MS ?? 5000);
const NARRATIVE_INTERVAL_MS = Number(process.env.AI_NARRATIVE_INTERVAL_MS ?? 8000);
const EMBED_INTERVAL_MS = Number(process.env.AI_EMBED_INTERVAL_MS ?? 60_000);

export class PropDeskAI {
  private readonly sub: Redis;
  private readonly pub: Redis;
  private readonly ollama: OllamaClient;
  private readonly vectors: VectorStore;
  private readonly correlation = new CorrelationTracker();
  private readonly states = new Map<string, SymbolState>(); // key = provider:symbol
  /** provider:symbol:interval -> bars (cap 500) */
  private readonly candleCache = new Map<string, StrategySignalCandle[]>();
  /** key -> last publish ts */
  private readonly lastStrategyPubMs = new Map<string, number>();

  constructor(redisUrl: string) {
    this.sub = new Redis(redisUrl);
    this.pub = new Redis(redisUrl);
    this.ollama = new OllamaClient();
    this.vectors = new VectorStore(this.pub, this.ollama);
  }

  async start(): Promise<void> {
    this.sub.on('pmessage', (_pattern, channel, raw) => {
      try {
        if (channel.endsWith('.analytics')) {
          const env = JSON.parse(raw) as DataEnvelope<unknown>;
          if (env.kind !== 'update') return;
          void this.onAnalytics(env);
        } else if (channel.includes('.candle.')) {
          const env = JSON.parse(raw) as DataEnvelope<unknown>;
          this.onCandle(env);
        }
      } catch { /* ignore malformed */ }
    });
    await this.sub.psubscribe('chart.data.*.analytics', 'chart.data.*.candle.*');

    // Periodic correlation broadcast.
    setInterval(() => this.publishCorrelations(), 5_000);

    console.log('[ai-engine] online; ollama at', process.env.OLLAMA_HOST ?? 'http://localhost:11434');
  }

  async stop(): Promise<void> {
    await this.sub.quit();
    await this.pub.quit();
  }

  private getState(key: string): SymbolState {
    let s = this.states.get(key);
    if (!s) {
      s = {
        derived: new DerivedState(),
        candles: [],
        prevSnap: null,
        lastTacticalMs: 0,
        lastNarrativeMs: 0,
        lastEmbedMs: 0,
        lastReflexKey: '',
      };
      this.states.set(key, s);
    }
    return s;
  }

  /** Bridge subscriber: also listen for upstream candle updates to enrich snapshots. */
  private async onAnalytics(env: DataEnvelope<unknown>): Promise<void> {
    const key = `${env.provider}:${env.symbol}`;
    const state = this.getState(key);

    const data = env.data as AnalyticsPayload;
    if (!data || typeof data.ltp !== 'number') return;

    const snap: MicrostructureSnapshot = {
      symbol: env.symbol,
      provider: env.provider,
      timestamp: env.ts,
      candles: state.candles,
      tick: {
        ltp: data.ltp,
        atp: data.atp,
        ltq: data.ltq,
        ltt: data.ltt,
        volume: data.volume,
        totalBuyQty: data.totalBuyQty,
        totalSellQty: data.totalSellQty,
        openInterest: data.oi ?? 0,
        dayOpen: data.dayOpen,
        dayHigh: data.dayHigh,
        dayLow: data.dayLow,
        dayClose: data.dayClose,
        prevClose: data.prevClose ?? 0,
        prevOi: data.prevOi ?? 0,
        bids: data.depthBids ?? [],
        asks: data.depthAsks ?? [],
      },
      derived: { vwapDeviation: 0, cvd: 0, oiChange: 0, depthImbalance: 0, tradeIntensity: 0, volatilityRegime: 'normal', toxicity: 0 },
    };
    snap.derived = state.derived.computeDerived(snap.tick, state.candles);

    // Track for correlation.
    this.correlation.observe(env.symbol, data.ltp);

    // ── 1. Reflex layer — every tick ──
    const sig = reflex(snap, state.prevSnap ?? undefined);
    if (sig.urgency !== 'none') {
      const dedupeKey = `${sig.type}:${Math.floor(env.ts / 5000)}`;
      if (dedupeKey !== state.lastReflexKey) {
        state.lastReflexKey = dedupeKey;
        await this.publishSignal(env.provider, env.symbol, sig);
      }
    }

    // Always publish the live derived snapshot for the UI gauges.
    await this.publishAnnotation(env.provider, env.symbol, {
      kind: 'reflex',
      ts: env.ts,
      data: {
        derived: snap.derived,
        regime: snap.derived.volatilityRegime,
        toxicity: snap.derived.toxicity,
        depthImbalance: snap.derived.depthImbalance,
        cvd: snap.derived.cvd,
      },
    });

    // ── 2. Tactical layer — throttled ──
    const now = Date.now();
    if (now - state.lastTacticalMs > TACTICAL_INTERVAL_MS) {
      state.lastTacticalMs = now;
      void tactical(snap, this.ollama).then(async (analysis) => {
        await this.publishAnnotation(env.provider, env.symbol, { kind: 'tactical', ts: analysis.ts, data: analysis });
        if (analysis.setup.exists && analysis.setup.confidence > 0.75 && analysis.setup.riskReward > 2) {
          await this.publishSignal(env.provider, env.symbol, {
            layer: 'reflex',
            type: 'neutral',
            urgency: analysis.urgency === 'immediate' ? 'immediate' : 'this_candle',
            confidence: analysis.setup.confidence,
            narrative: analysis.setup.rationale,
            ts: analysis.ts,
          });
        }
      }).catch((err) => console.error('[ai-engine] tactical', err));
    }

    // ── 3. Narrative — throttled ──
    if (now - state.lastNarrativeMs > NARRATIVE_INTERVAL_MS) {
      state.lastNarrativeMs = now;
      void narrate(snap, this.ollama).then((n) =>
        this.publishAnnotation(env.provider, env.symbol, { kind: 'narrative', ts: n.ts, data: n }),
      ).catch((err) => console.error('[ai-engine] narrative', err));
    }

    // ── 4. Pattern embedding — throttled ──
    if (now - state.lastEmbedMs > EMBED_INTERVAL_MS && snap.candles.length >= 20 && this.ollama.isAvailable()) {
      state.lastEmbedMs = now;
      void (async () => {
        const emb = await this.vectors.embed(snap);
        if (!emb) return;
        await this.vectors.store(snap, emb);
        const hits = await this.vectors.findSimilar(env.symbol, emb, 5);
        if (hits.length >= 3) {
          const resolved = hits.filter((h) => h.record.outcome !== null);
          const bullishCount = resolved.filter((h) => h.record.outcome?.direction === 'up').length;
          await this.publishAnnotation(env.provider, env.symbol, {
            kind: 'historical_echo',
            ts: now,
            data: { matches: resolved.length, bullishCount, bias: bullishCount > resolved.length / 2 ? 'bullish' : 'bearish' },
          });
        }
      })().catch(() => undefined);
    }

    state.prevSnap = snap;
  }

  private onCandle(env: DataEnvelope<unknown>): void {
    const interval = env.key || '1m';
    const key = `${env.provider}:${env.symbol.toUpperCase()}:${interval}`;
    const arr = this.candleCache.get(key) ?? [];

    const append = (c: StrategySignalCandle): void => {
      const last = arr[arr.length - 1];
      if (last && last.openTime === c.openTime) arr[arr.length - 1] = c;
      else {
        arr.push(c);
        if (arr.length > 500) arr.shift();
      }
    };
    const tryAppend = (raw: any): void => {
      if (!raw || typeof raw !== 'object') return;
      const c = raw.candle ?? raw;
      if (typeof c.openTime !== 'number') return;
      append({
        openTime: c.openTime, open: c.open, high: c.high, low: c.low,
        close: c.close, volume: c.volume, sealed: Boolean(c.sealed),
      });
    };

    if (env.kind === 'snapshot' && Array.isArray(env.data)) {
      for (const r of env.data) tryAppend(r);
    } else if (env.kind === 'update') {
      tryAppend(env.data);
    } else return;

    this.candleCache.set(key, arr);
    void this.publishStrategySignal(env.provider, env.symbol.toUpperCase(), interval);
  }

  private async publishStrategySignal(provider: string, symbol: string, interval: string): Promise<void> {
    const key = `${provider}:${symbol}:${interval}`;
    const now = Date.now();
    const last = this.lastStrategyPubMs.get(key) ?? 0;
    if (now - last < 1000) return;
    this.lastStrategyPubMs.set(key, now);

    const candles = this.candleCache.get(key);
    if (!candles || candles.length < 30) return;

    const sig = computeStrategySignal(interval, candles, (_intervalMs, multiplier) => {
      const baseKey = `${provider}:${symbol}:${interval}`;
      const base = this.candleCache.get(baseKey);
      if (!base) return null;
      return aggregateCandles(base, multiplier);
    });

    await this.publishAnnotation(provider, symbol, {
      kind: 'strategy_signal' as any,
      ts: now,
      data: { interval, ...sig },
    });
  }

  /** Push a candle into per-symbol state. Called externally if you wire a candle subscriber. */
  pushCandle(key: string, candle: MicrostructureSnapshot['candles'][number]): void {
    const state = this.getState(key);
    const last = state.candles[state.candles.length - 1];
    if (last && last.openTime === candle.openTime) {
      state.candles[state.candles.length - 1] = candle;
    } else {
      state.candles.push(candle);
      if (state.candles.length > 200) state.candles.shift();
    }
  }

  private async publishCorrelations(): Promise<void> {
    const syms = this.correlation.symbols();
    if (syms.length < 2) return;
    for (let i = 0; i < syms.length; i += 1) {
      for (let j = i + 1; j < syms.length; j += 1) {
        const corr = this.correlation.correlation(syms[i]!, syms[j]!);
        if (corr === null) continue;
        // Publish on a global topic; UI can pick relevant pairs.
        await this.pub.publish('chart.ai.correlation', JSON.stringify({
          a: syms[i], b: syms[j], correlation: corr, ts: Date.now(),
        })).catch(() => undefined);
      }
    }
  }

  private async publishSignal(provider: string, symbol: string, sig: ReflexSignal): Promise<void> {
    const env: DataEnvelope = {
      provider,
      symbol: symbol.toUpperCase(),
      channel: 'signal',
      kind: 'update',
      ts: sig.ts,
      data: sig,
    };
    await this.pub.publish(`chart.data.${provider}.${symbol.toUpperCase()}.signal`, JSON.stringify(env));
  }

  private async publishAnnotation(provider: string, symbol: string, ann: AIAnnotation): Promise<void> {
    const env: DataEnvelope = {
      provider,
      symbol: symbol.toUpperCase(),
      channel: 'annotation',
      kind: 'update',
      ts: ann.ts,
      data: ann,
    };
    await this.pub.publish(`chart.data.${provider}.${symbol.toUpperCase()}.annotation`, JSON.stringify(env));
  }
}

function aggregateCandles(base: StrategySignalCandle[], multiplier: number): StrategySignalCandle[] {
  if (multiplier <= 1) return base.slice();
  if (base.length === 0) return [];
  const baseMs = base.length > 1 ? base[1]!.openTime - base[0]!.openTime : 60_000;
  const groupMs = baseMs * multiplier;
  const out: StrategySignalCandle[] = [];
  let bucket: StrategySignalCandle | null = null;
  let bucketStart = 0;
  for (const c of base) {
    const start = Math.floor(c.openTime / groupMs) * groupMs;
    if (!bucket || start !== bucketStart) {
      if (bucket) out.push(bucket);
      bucket = { openTime: start, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, sealed: c.sealed };
      bucketStart = start;
    } else {
      bucket.high = Math.max(bucket.high, c.high);
      bucket.low = Math.min(bucket.low, c.low);
      bucket.close = c.close;
      bucket.volume += c.volume;
      bucket.sealed = c.sealed;
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

interface AnalyticsPayload {
  ltp: number; atp: number; ltq: number; ltt: number;
  volume: number; totalBuyQty: number; totalSellQty: number;
  oi: number | undefined;
  dayOpen: number; dayHigh: number; dayLow: number; dayClose: number;
  depthBids: Array<{ price: number; qty: number; orders: number }> | undefined;
  depthAsks: Array<{ price: number; qty: number; orders: number }> | undefined;
  prevClose: number | undefined; prevOi: number | undefined;
}
