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

  constructor(redisUrl: string) {
    this.sub = new Redis(redisUrl);
    this.pub = new Redis(redisUrl);
    this.ollama = new OllamaClient();
    this.vectors = new VectorStore(this.pub, this.ollama);
  }

  async start(): Promise<void> {
    this.sub.on('pmessage', (_pattern, channel, raw) => {
      if (!channel.endsWith('.analytics')) return;
      try {
        const env = JSON.parse(raw) as DataEnvelope<unknown>;
        if (env.kind !== 'update') return;
        void this.onAnalytics(env);
      } catch { /* ignore malformed */ }
    });
    await this.sub.psubscribe('chart.data.*.analytics');

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

interface AnalyticsPayload {
  ltp: number; atp: number; ltq: number; ltt: number;
  volume: number; totalBuyQty: number; totalSellQty: number;
  oi: number | undefined;
  dayOpen: number; dayHigh: number; dayLow: number; dayClose: number;
  depthBids: Array<{ price: number; qty: number; orders: number }> | undefined;
  depthAsks: Array<{ price: number; qty: number; orders: number }> | undefined;
  prevClose: number | undefined; prevOi: number | undefined;
}
