/**
 * Backend computer for the UI's Strategy Signals panel.
 *
 * Inputs: chart-TF candles (already cached by engine.ts), an aggregator that
 * can synthesize HTF candles by bucketing the same chart TF.
 *
 * Output: structured payload covering Verdict, HTF Bias, Trend, Confidence,
 * Ref price, SMC stats (sweep, OB, FVG, BOS, CHoCH), MTF stack (×3/×12/×48),
 * and a Trend Matrix (EMA/MACD/RSI/ST/STRUCT/VOL).
 */

export interface StrategySignalCandle {
  openTime: number; open: number; high: number; low: number;
  close: number; volume: number; sealed: boolean;
}

type MtfAggregator = (intervalMs: number, multiplier: number) => StrategySignalCandle[] | null;

export interface StrategySignalPayload {
  verdict: 'bullish' | 'bearish' | 'neutral';
  htfBias: 'bullish' | 'bearish' | 'neutral';
  trend: 'up' | 'down' | 'flat';
  confidence: number; // 0..1
  refPrice: number;
  smc: {
    score: number;
    sweep: 'bullish' | 'bearish' | 'none';
    orderBlock: 'bullish' | 'bearish' | 'none';
    fvg: 'bullish' | 'bearish' | 'none';
    bos: 'bullish' | 'bearish' | 'none';
    choch: 'bullish' | 'bearish' | 'none';
  };
  mtf: {
    direction: 'bullish' | 'bearish' | 'neutral';
    pass: number; // legs voting same direction (0..3)
    legs: Array<{ label: string; trend: 'up' | 'down' | 'flat' }>;
    reasons: string[];
  };
  matrix: {
    ema: 'bull' | 'bear' | 'flat';
    macd: 'bull' | 'bear' | 'flat';
    rsi: 'bull' | 'bear' | 'flat';
    st: 'bull' | 'bear' | 'flat';
    struct: 'bull' | 'bear' | 'flat';
    vol: 'bull' | 'bear' | 'flat';
  };
}

const parseIntervalMs = (s: string): number => {
  const m = /^(\d+)([smhdw])$/.exec(s);
  if (!m) return 60_000;
  const n = Number(m[1]);
  const unit = m[2];
  switch (unit) {
    case 's': return n * 1000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    case 'd': return n * 86_400_000;
    case 'w': return n * 7 * 86_400_000;
    default: return 60_000;
  }
};

// ── TA primitives ───────────────────────────────────────────────────────────

function ema(values: number[], period: number): number[] {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    prev = i === 0 ? v : v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const d = closes[i]! - closes[i - 1]!;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function macdSign(closes: number[]): 'bull' | 'bear' | 'flat' {
  if (closes.length < 35) return 'flat';
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const line: number[] = e12.map((v, i) => v - (e26[i] ?? 0));
  const sig = ema(line, 9);
  const last = line[line.length - 1]! - (sig[sig.length - 1] ?? 0);
  if (Math.abs(last) < 1e-6) return 'flat';
  return last > 0 ? 'bull' : 'bear';
}

function atr(candles: StrategySignalCandle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i]!, p = candles[i - 1]!;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
}

function superTrendSign(candles: StrategySignalCandle[]): 'bull' | 'bear' | 'flat' {
  if (candles.length < 20) return 'flat';
  const period = 10, mult = 3;
  let prevUpper = 0, prevLower = 0, prevTrend: 1 | -1 = 1, prevClose = candles[period]!.close;
  const a = atr(candles.slice(0, period + 1), period);
  const mid0 = (candles[period]!.high + candles[period]!.low) / 2;
  prevUpper = mid0 + mult * a;
  prevLower = mid0 - mult * a;
  for (let i = period + 1; i < candles.length; i += 1) {
    const c = candles[i]!;
    const slice = candles.slice(i - period, i + 1);
    const a2 = atr(slice, period);
    const mid = (c.high + c.low) / 2;
    let upper = mid + mult * a2;
    let lower = mid - mult * a2;
    if (upper > prevUpper && prevClose <= prevUpper) upper = prevUpper;
    if (lower < prevLower && prevClose >= prevLower) lower = prevLower;
    let trend: 1 | -1 = prevTrend;
    if (prevTrend === 1 && c.close < prevLower) trend = -1;
    else if (prevTrend === -1 && c.close > prevUpper) trend = 1;
    prevUpper = upper; prevLower = lower; prevTrend = trend; prevClose = c.close;
  }
  return prevTrend === 1 ? 'bull' : 'bear';
}

// ── SMC mini (ported from ui/src/chart/smc-primitive.ts) ────────────────────

interface Swing { type: 'high' | 'low'; index: number; price: number; broken: boolean }
interface SmcRollup {
  score: number;
  sweep: 'bullish' | 'bearish' | 'none';
  orderBlock: 'bullish' | 'bearish' | 'none';
  fvg: 'bullish' | 'bearish' | 'none';
  bos: 'bullish' | 'bearish' | 'none';
  choch: 'bullish' | 'bearish' | 'none';
  structuralTrend: 'bull' | 'bear' | 'flat';
}

function smc(candles: StrategySignalCandle[], period = 5): SmcRollup {
  const n = candles.length;
  if (n < period * 2 + 5) {
    return { score: 0, sweep: 'none', orderBlock: 'none', fvg: 'none', bos: 'none', choch: 'none', structuralTrend: 'flat' };
  }
  const swings: Swing[] = [];
  for (let i = period; i < n - period; i += 1) {
    const c = candles[i]!;
    let isHigh = true, isLow = true;
    for (let j = 1; j <= period; j += 1) {
      if (candles[i - j]!.high >= c.high || candles[i + j]!.high > c.high) isHigh = false;
      if (candles[i - j]!.low <= c.low || candles[i + j]!.low < c.low) isLow = false;
    }
    if (isHigh) swings.push({ type: 'high', index: i, price: c.high, broken: false });
    if (isLow)  swings.push({ type: 'low',  index: i, price: c.low,  broken: false });
  }

  let trend: 'bull' | 'bear' = 'bull';
  let lastBos: 'bullish' | 'bearish' | 'none' = 'none';
  let lastChoch: 'bullish' | 'bearish' | 'none' = 'none';
  let lastOb: 'bullish' | 'bearish' | 'none' = 'none';
  let lastSweep: 'bullish' | 'bearish' | 'none' = 'none';

  for (let i = 0; i < n; i += 1) {
    const c = candles[i]!;
    const highs = swings.filter((s) => s.type === 'high' && !s.broken && s.index <= i - period);
    const lows  = swings.filter((s) => s.type === 'low'  && !s.broken && s.index <= i - period);
    const aH = highs[highs.length - 1];
    const aL = lows[lows.length - 1];

    // Liquidity sweep: wick beyond swing but close reverses through.
    if (aH && c.high > aH.price && c.close < aH.price) lastSweep = 'bearish';
    if (aL && c.low  < aL.price && c.close > aL.price) lastSweep = 'bullish';

    if (trend === 'bull') {
      if (aH && c.close > aH.price) { lastBos = 'bullish'; aH.broken = true; lastOb = 'bullish'; }
      if (aL && c.close < aL.price) { lastChoch = 'bearish'; aL.broken = true; trend = 'bear'; lastOb = 'bearish'; }
    } else {
      if (aL && c.close < aL.price) { lastBos = 'bearish'; aL.broken = true; lastOb = 'bearish'; }
      if (aH && c.close > aH.price) { lastChoch = 'bullish'; aH.broken = true; trend = 'bull'; lastOb = 'bullish'; }
    }
  }

  // FVG: gap between candle[i-2].high and candle[i].low (bullish) or vice versa.
  let lastFvg: 'bullish' | 'bearish' | 'none' = 'none';
  for (let i = n - 1; i >= 2; i -= 1) {
    const p2 = candles[i - 2]!, c = candles[i]!;
    if (c.low > p2.high) { lastFvg = 'bullish'; break; }
    if (c.high < p2.low) { lastFvg = 'bearish'; break; }
  }

  const score = [
    lastBos === 'bullish' ? 1 : lastBos === 'bearish' ? -1 : 0,
    lastChoch === 'bullish' ? 1 : lastChoch === 'bearish' ? -1 : 0,
    lastOb === 'bullish' ? 1 : lastOb === 'bearish' ? -1 : 0,
    lastFvg === 'bullish' ? 1 : lastFvg === 'bearish' ? -1 : 0,
    lastSweep === 'bullish' ? 1 : lastSweep === 'bearish' ? -1 : 0,
  ].reduce((a, b) => a + b, 0);

  return {
    score,
    sweep: lastSweep,
    orderBlock: lastOb,
    fvg: lastFvg,
    bos: lastBos,
    choch: lastChoch,
    structuralTrend: trend === 'bull' ? 'bull' : 'bear',
  };
}

// ── Compose ─────────────────────────────────────────────────────────────────

function trendOf(candles: StrategySignalCandle[]): 'up' | 'down' | 'flat' {
  if (candles.length < 50) return 'flat';
  const closes = candles.map((c) => c.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const last20 = e20[e20.length - 1]!;
  const last50 = e50[e50.length - 1]!;
  const diff = (last20 - last50) / last50;
  if (Math.abs(diff) < 0.0005) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

export function computeStrategySignal(
  interval: string,
  candles: StrategySignalCandle[],
  aggregate: MtfAggregator,
): StrategySignalPayload {
  const intervalMs = parseIntervalMs(interval);
  const closes = candles.map((c) => c.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const lastClose = closes[closes.length - 1] ?? 0;

  const matrix: StrategySignalPayload['matrix'] = {
    ema: e20[e20.length - 1]! > e50[e50.length - 1]! ? 'bull'
        : e20[e20.length - 1]! < e50[e50.length - 1]! ? 'bear' : 'flat',
    macd: macdSign(closes),
    rsi: (() => {
      const r = rsi(closes);
      if (r > 55) return 'bull';
      if (r < 45) return 'bear';
      return 'flat';
    })(),
    st: superTrendSign(candles),
    struct: 'flat',
    vol: (() => {
      if (candles.length < 21) return 'flat';
      const recent = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20;
      const v = candles[candles.length - 1]!.volume;
      if (v > recent * 1.2) return 'bull';
      if (v < recent * 0.8) return 'bear';
      return 'flat';
    })(),
  };

  const smcRollup = smc(candles);
  matrix.struct = smcRollup.structuralTrend;

  // MTF: × 3, × 12, × 48 multiples of chart TF
  const multipliers: Array<{ label: string; mult: number }> = [
    { label: '3×', mult: 3 },
    { label: '12×', mult: 12 },
    { label: '48×', mult: 48 },
  ];
  const legs: StrategySignalPayload['mtf']['legs'] = [];
  const reasons: string[] = [];
  for (const m of multipliers) {
    const agg = aggregate(intervalMs, m.mult);
    const t = agg ? trendOf(agg) : 'flat';
    legs.push({ label: m.label, trend: t });
    if (t !== 'flat') reasons.push(`${m.label}: ${t}`);
  }

  const ups = legs.filter((l) => l.trend === 'up').length;
  const downs = legs.filter((l) => l.trend === 'down').length;
  const mtfDir: 'bullish' | 'bearish' | 'neutral' = ups > downs ? 'bullish' : downs > ups ? 'bearish' : 'neutral';
  const mtfPass = Math.max(ups, downs);

  const matrixVals = Object.values(matrix);
  const bulls = matrixVals.filter((v) => v === 'bull').length;
  const bears = matrixVals.filter((v) => v === 'bear').length;
  const trend: 'up' | 'down' | 'flat' = bulls > bears + 1 ? 'up' : bears > bulls + 1 ? 'down' : 'flat';
  const htfBias = mtfDir;

  const verdictScore = (bulls - bears) / matrixVals.length + (mtfPass * (mtfDir === 'bullish' ? 1 : mtfDir === 'bearish' ? -1 : 0)) / 3 + smcRollup.score / 5;
  const verdict: 'bullish' | 'bearish' | 'neutral' = verdictScore > 0.4 ? 'bullish' : verdictScore < -0.4 ? 'bearish' : 'neutral';
  const confidence = Math.min(1, Math.abs(verdictScore));

  return {
    verdict, htfBias, trend, confidence, refPrice: lastClose,
    smc: {
      score: smcRollup.score,
      sweep: smcRollup.sweep,
      orderBlock: smcRollup.orderBlock,
      fvg: smcRollup.fvg,
      bos: smcRollup.bos,
      choch: smcRollup.choch,
    },
    mtf: { direction: mtfDir, pass: mtfPass, legs, reasons },
    matrix,
  };
}
