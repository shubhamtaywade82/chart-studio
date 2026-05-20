import type { MicrostructureSnapshot, TacticalAnalysis, TradeSetup, AILevel, AIDivergence } from './types';
import type { OllamaClient } from './ollama-client';

const TACTICAL_MODEL = process.env.AI_TACTICAL_MODEL ?? 'mistral:7b';

/**
 * Tactical layer: ~120ms inference per call. Runs at most once every 5s or
 * on candle close. Builds a structured prompt and parses JSON output.
 *
 * If Ollama is unavailable, returns a heuristic-derived fallback so the
 * UI doesn't go blank.
 */
export async function tactical(
  snap: MicrostructureSnapshot,
  ollama: OllamaClient,
): Promise<TacticalAnalysis> {
  const prompt = buildTacticalPrompt(snap);

  const result = await ollama.generateJson<Omit<TacticalAnalysis, 'layer' | 'ts'>>({
    model: TACTICAL_MODEL,
    prompt,
    temperature: 0.05,
    numPredict: 700,
    timeoutMs: 10_000,
  });

  if (result) {
    return { layer: 'tactical', ts: snap.timestamp, ...sanitize(result) };
  }
  return heuristicFallback(snap);
}

function buildTacticalPrompt(s: MicrostructureSnapshot): string {
  const c = s.candles;
  const t = s.tick;
  const d = s.derived;
  const recent = c.slice(-5).map((x) =>
    `T:${new Date(x.openTime).toISOString().slice(11, 19)} O:${x.open} H:${x.high} L:${x.low} C:${x.close} V:${x.volume}`,
  ).join('\n');

  return `You are a senior prop desk trader analyzing Indian F&O markets.
You have access to microstructure data unavailable to retail traders.

CURRENT MARKET STATE:
Symbol: ${s.symbol}
Time: ${new Date(s.timestamp).toISOString()}
Price: ${t.ltp} | ATP: ${t.atp} | Deviation: ${(d.vwapDeviation * 100).toFixed(3)}%
Day Range: ${t.dayLow} - ${t.dayHigh}
OI: ${t.openInterest} (change vs prev: ${d.oiChange})
Volume: ${t.volume}
Cumulative Buy Qty: ${t.totalBuyQty} | Sell Qty: ${t.totalSellQty} | CVD (per-tick accum): ${d.cvd}
Depth Imbalance: ${(d.depthImbalance * 100).toFixed(1)}%
Toxicity (VPIN-style 0..1): ${d.toxicity.toFixed(2)}
Volatility regime: ${d.volatilityRegime} | Trade intensity: ${d.tradeIntensity.toFixed(1)} ticks/sec

LAST 5 CANDLES:
${recent}

TOP 3 DEPTH LEVELS:
Bids: ${JSON.stringify(t.bids.slice(0, 3))}
Asks: ${JSON.stringify(t.asks.slice(0, 3))}

INSTRUCTION:
Analyze this as a senior prop desk trader would. Identify:
1. Market regime (accumulation, distribution, trending-up, trending-down, breakout, failed_breakout, range-bound)
2. Key structural levels with confidence 0..1
3. Divergences (price vs OI, price vs CVD, price vs ATP)
4. Trade setup if any, with entry, stop, target, sizing
5. Invalidation: what would invalidate this in the next 3 candles?

Respond ONLY with JSON matching this schema:
{
  "regime": "accumulation|distribution|trending-up|trending-down|breakout|failed_breakout|range-bound",
  "regimeConfidence": number,
  "levels": [{"price": number, "type": "support|resistance|poc|invalidation", "confidence": number, "rationale": string}],
  "divergences": [{"type": "price-oi|price-cvd|price-atp", "strength": number, "description": string}],
  "setup": {"exists": boolean, "direction": "long|short|none", "entry": number, "stop": number, "target": number, "confidence": number, "riskReward": number, "positionSizePct": number, "rationale": string, "invalidation": string},
  "narrative": string,
  "urgency": "immediate|this_candle|next_5min|watch_only"
}`;
}

function sanitize(t: Omit<TacticalAnalysis, 'layer' | 'ts'>): Omit<TacticalAnalysis, 'layer' | 'ts'> {
  const levels: AILevel[] = (t.levels ?? []).filter((l) => Number.isFinite(l?.price) && l.price > 0).map((l) => ({
    price: l.price,
    type: l.type ?? 'support',
    confidence: clamp01(l.confidence ?? 0.5),
    rationale: String(l.rationale ?? ''),
  })).slice(0, 6);

  const divergences: AIDivergence[] = (t.divergences ?? []).filter(Boolean).map((d) => ({
    type: d.type ?? 'price-cvd',
    strength: clamp(d.strength ?? 0, -1, 1),
    description: String(d.description ?? ''),
  })).slice(0, 4);

  const setup: TradeSetup = t.setup ?? {
    exists: false, direction: 'none', entry: 0, stop: 0, target: 0,
    confidence: 0, riskReward: 0, positionSizePct: 0, rationale: '', invalidation: '',
  };

  return {
    regime: t.regime ?? 'range-bound',
    regimeConfidence: clamp01(t.regimeConfidence ?? 0.5),
    levels,
    divergences,
    setup,
    narrative: String(t.narrative ?? ''),
    urgency: t.urgency ?? 'watch_only',
  };
}

/**
 * Pure-heuristic fallback used when Ollama is offline. Produces a
 * reasonable best-effort analysis so the UI never goes blank.
 */
function heuristicFallback(snap: MicrostructureSnapshot): TacticalAnalysis {
  const d = snap.derived;
  const t = snap.tick;
  const c = snap.candles;
  const last = c[c.length - 1];

  let regime: TacticalAnalysis['regime'] = 'range-bound';
  if (d.volatilityRegime === 'high' || d.volatilityRegime === 'extreme') {
    regime = d.cvd > 0 ? 'trending-up' : 'trending-down';
  } else if (Math.abs(d.cvd) > t.volume * 0.1) {
    regime = d.cvd > 0 ? 'accumulation' : 'distribution';
  }

  const levels: AILevel[] = [];
  if (t.dayHigh > 0) levels.push({ price: t.dayHigh, type: 'resistance', confidence: 0.7, rationale: 'Day high' });
  if (t.dayLow > 0) levels.push({ price: t.dayLow, type: 'support', confidence: 0.7, rationale: 'Day low' });
  if (t.atp > 0) levels.push({ price: t.atp, type: 'poc', confidence: 0.6, rationale: 'ATP / fair value' });
  if (t.prevClose > 0) levels.push({ price: t.prevClose, type: 'support', confidence: 0.5, rationale: 'Prev close' });

  const divergences: AIDivergence[] = [];
  if (last && c.length >= 5) {
    const fiveAgo = c[c.length - 5]!;
    const priceDelta = last.close - fiveAgo.close;
    if (Math.sign(priceDelta) !== 0 && Math.sign(d.cvd) !== 0 && Math.sign(priceDelta) !== Math.sign(d.cvd)) {
      divergences.push({
        type: 'price-cvd',
        strength: -0.5,
        description: 'Price and CVD opposite sign over 5 candles',
      });
    }
  }

  return {
    layer: 'tactical',
    ts: snap.timestamp,
    regime,
    regimeConfidence: 0.5,
    levels,
    divergences,
    setup: { exists: false, direction: 'none', entry: 0, stop: 0, target: 0, confidence: 0, riskReward: 0, positionSizePct: 0, rationale: 'AI offline — heuristic only.', invalidation: '' },
    narrative: 'AI offline. Heuristic regime: ' + regime,
    urgency: 'watch_only',
  };
}

function clamp01(n: number): number { return clamp(n, 0, 1); }
function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo)); }
