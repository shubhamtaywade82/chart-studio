/// <reference lib="webworker" />

export type IndicatorId = 'SMA' | 'EMA' | 'RSI' | 'MACD' | 'BB' | 'ATR' | 'OBV' | 'MFI';

export interface IndicatorWorkerRequest {
  reqId: string;
  indicator: IndicatorId;
  params: Record<string, number>;
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
}

export interface IndicatorWorkerResponse {
  reqId: string;
  ok: boolean;
  error?: string;
  result?: Record<string, number[]>;
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function sma(src: number[], period: number): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i]!;
    if (i >= period) sum -= src[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(src: number[], period: number): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < src.length; i++) {
    if (isNaN(src[i]!)) continue;
    if (isNaN(prev)) {
      // Seed with SMA of first `period` values
      if (i < period - 1) continue;
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += src[j]!;
      prev = s / period;
    } else {
      prev = src[i]! * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

function rsi(closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

function macd(closes: number[], fast: number, slow: number, signal: number): {
  macd: number[]; signal: number[]; histogram: number[];
} {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    isNaN(fastEma[i]!) || isNaN(slowEma[i]!) ? NaN : fastEma[i]! - slowEma[i]!,
  );
  const signalLine = ema(macdLine, signal);
  const histogram = macdLine.map((v, i) =>
    isNaN(v) || isNaN(signalLine[i]!) ? NaN : v - signalLine[i]!,
  );
  return { macd: macdLine, signal: signalLine, histogram };
}

function bollingerBands(closes: number[], period: number, stdMult: number): {
  upper: number[]; middle: number[]; lower: number[];
} {
  const middle = sma(closes, period);
  const upper = new Array<number>(closes.length).fill(NaN);
  const lower = new Array<number>(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i]!;
    const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + stdMult * sd;
    lower[i] = mean - stdMult * sd;
  }
  return { upper, middle, lower };
}

function atr(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  let avgTr = NaN;
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]! - closes[i - 1]!),
    );
    if (i < period) {
      if (isNaN(avgTr)) avgTr = 0;
      avgTr += tr / period;
      if (i === period - 1) out[i] = avgTr;
    } else {
      avgTr = (avgTr * (period - 1) + tr) / period;
      out[i] = avgTr;
    }
  }
  return out;
}

function obv(closes: number[], volumes: number[]): number[] {
  const out = new Array<number>(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    const dir = closes[i]! > closes[i - 1]! ? 1 : closes[i]! < closes[i - 1]! ? -1 : 0;
    out[i] = out[i - 1]! + dir * volumes[i]!;
  }
  return out;
}

function mfi(
  highs: number[], lows: number[], closes: number[], volumes: number[], period: number,
): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  const typicalPrices = closes.map((c, i) => (highs[i]! + lows[i]! + c) / 3);
  const rawMf = typicalPrices.map((tp, i) => tp * volumes[i]!);

  for (let i = period; i < closes.length; i++) {
    let posFlow = 0;
    let negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (typicalPrices[j]! > typicalPrices[j - 1]!) posFlow += rawMf[j]!;
      else negFlow += rawMf[j]!;
    }
    out[i] = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
  }
  return out;
}

// ── Message handler ───────────────────────────────────────────────────────────

self.addEventListener('message', (ev: MessageEvent<IndicatorWorkerRequest>) => {
  const req = ev.data;
  let result: Record<string, number[]> | undefined;
  let error: string | undefined;

  try {
    const p = req.params;
    switch (req.indicator) {
      case 'SMA':
        result = { values: sma(req.closes, p['period'] ?? 14) };
        break;
      case 'EMA':
        result = { values: ema(req.closes, p['period'] ?? 14) };
        break;
      case 'RSI':
        result = { values: rsi(req.closes, p['period'] ?? 14) };
        break;
      case 'MACD': {
        const m = macd(req.closes, p['fast'] ?? 12, p['slow'] ?? 26, p['signal'] ?? 9);
        result = { macd: m.macd, signal: m.signal, histogram: m.histogram };
        break;
      }
      case 'BB': {
        const bb = bollingerBands(req.closes, p['period'] ?? 20, p['stdDev'] ?? 2);
        result = { upper: bb.upper, middle: bb.middle, lower: bb.lower };
        break;
      }
      case 'ATR':
        result = { values: atr(req.highs, req.lows, req.closes, p['period'] ?? 14) };
        break;
      case 'OBV':
        result = { values: obv(req.closes, req.volumes) };
        break;
      case 'MFI':
        result = { values: mfi(req.highs, req.lows, req.closes, req.volumes, p['period'] ?? 14) };
        break;
      default:
        throw new Error(`Unknown indicator: ${String(req.indicator)}`);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const resp: IndicatorWorkerResponse = { reqId: req.reqId, ok: !error, error, result };
  (self as unknown as Worker).postMessage(resp);
});
