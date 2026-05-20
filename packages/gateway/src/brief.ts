import type { IncomingMessage, ServerResponse } from 'http';

/**
 * In-memory cache of the most recent per-symbol microstructure snapshot
 * received from the AI engine via Redis annotations.
 *
 * The RedisBridge feeds these via `cacheAnalytics()`.
 */

interface TickData {
  ltp: number; atp: number; ltq: number; ltt: number;
  volume: number; totalBuyQty: number; totalSellQty: number;
  oi?: number; dayOpen: number; dayHigh: number; dayLow: number; dayClose: number;
  prevClose?: number; prevOi?: number;
  depthBids?: Array<{ price: number; qty: number; orders: number }>;
  depthAsks?: Array<{ price: number; qty: number; orders: number }>;
}

interface DerivedData {
  vwapDeviation: number; cvd: number; oiChange: number;
  depthImbalance: number; tradeIntensity: number;
  volatilityRegime: 'low' | 'normal' | 'high' | 'extreme';
  toxicity: number;
}

interface CandleData {
  openTime: number; open: number; high: number; low: number; close: number; volume: number;
}

export interface CachedSymbolState {
  provider: string;
  symbol: string;
  ts: number;
  tick: TickData;
  derived: DerivedData;
  candles: CandleData[];
}

export interface BriefSection { heading: string; body: string; }

export interface BriefResult {
  symbol: string;
  interval: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  sections: BriefSection[];
  disclaimer: string;
  ts: number;
  heuristic: boolean;
}

// ── State Cache ───────────────────────────────────────────────────────────────

const snapshots = new Map<string, CachedSymbolState>();
const candleCache = new Map<string, CandleData[]>();

export function cacheAnalytics(provider: string, symbol: string, tick: TickData, derived: DerivedData, ts: number): void {
  const key = `${provider}:${symbol.toUpperCase()}`;
  const candles = candleCache.get(key) ?? [];
  snapshots.set(key, { provider, symbol: symbol.toUpperCase(), ts, tick, derived, candles });
}

export function cacheCandle(provider: string, symbol: string, candle: CandleData): void {
  const key = `${provider}:${symbol.toUpperCase()}`;
  const arr = candleCache.get(key) ?? [];
  const last = arr[arr.length - 1];
  if (last && last.openTime === candle.openTime) {
    arr[arr.length - 1] = candle;
  } else {
    arr.push(candle);
    if (arr.length > 100) arr.shift();
  }
  candleCache.set(key, arr);
  const snap = snapshots.get(key);
  if (snap) snap.candles = arr;
}

function getState(provider: string, symbol: string): CachedSymbolState | null {
  return snapshots.get(`${provider}:${symbol.toUpperCase()}`) ?? null;
}

// ── Ollama Client (inline, no dep) ────────────────────────────────────────────

const OLLAMA_HOST = (process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_DISABLE = process.env.OLLAMA_DISABLE === '1';
const BRIEF_MODEL = process.env.AI_NARRATIVE_MODEL ?? 'llama3.2:3b';

let ollamaFailures = 0;
let ollamaCircuitUntil = 0;

function ollamaAvailable(): boolean {
  if (OLLAMA_DISABLE) return false;
  if (Date.now() < ollamaCircuitUntil) return false;
  return true;
}

async function ollamaGenerate(prompt: string, system: string): Promise<string | null> {
  if (!ollamaAvailable()) return null;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: BRIEF_MODEL,
        prompt,
        system,
        stream: false,
        options: { temperature: 0.25, num_predict: 600, num_ctx: 4096 },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const json = await res.json() as { response?: string };
    ollamaFailures = 0;
    return json.response ?? null;
  } catch (err) {
    ollamaFailures += 1;
    if (ollamaFailures >= 3) {
      ollamaCircuitUntil = Date.now() + 30_000;
      ollamaFailures = 0;
      console.warn('[gateway/brief] ollama circuit opened for 30s:', err instanceof Error ? err.message : err);
    }
    return null;
  } finally {
    clearTimeout(tid);
  }
}

// ── Prompt Builder ────────────────────────────────────────────────────────────

function buildPrompt(state: CachedSymbolState, interval: string): string {
  const { tick: t, derived: d, candles: c, symbol } = state;
  const last5 = c.slice(-5);
  const candleStr = last5.length > 0
    ? last5.map((x) =>
        `  [${new Date(x.openTime).toISOString().slice(11, 16)}] O:${x.open} H:${x.high} L:${x.low} C:${x.close} V:${x.volume}`,
      ).join('\n')
    : '  (no candle history)';

  const change = t.dayOpen > 0 ? (((t.ltp - t.dayOpen) / t.dayOpen) * 100).toFixed(2) : '?';
  const vwapPct = (d.vwapDeviation * 100).toFixed(2);
  const imbalPct = (d.depthImbalance * 100).toFixed(1);

  return `Symbol: ${symbol} | Interval: ${interval} | Time: ${new Date(state.ts).toISOString()}

MARKET SNAPSHOT
  LTP: ${t.ltp}  |  ATP (VWAP): ${t.atp}  |  Day: ${t.dayOpen} → ${t.dayHigh}/${t.dayLow} (${change}%)
  OI: ${t.oi ?? '?'}  OI-chg vs prev: ${d.oiChange}  |  Volume: ${t.volume}
  TotalBuy: ${t.totalBuyQty}  TotalSell: ${t.totalSellQty}  |  CVD: ${d.cvd}
  VWAP deviation: ${vwapPct}%  |  Depth imbalance: ${imbalPct}%
  Toxicity: ${d.toxicity.toFixed(2)}  |  Vol regime: ${d.volatilityRegime}  |  Trade intensity: ${d.tradeIntensity.toFixed(1)} t/s

LAST 5 CANDLES
${candleStr}

Write a structured market brief in 4 sections. Use plain English, NO markdown headers, no asterisks, no bullet symbols.

1. BIAS: One word (Bullish/Bearish/Neutral) and confidence 0-100%. One sentence rationale.
2. STRUCTURE: 2-3 sentences on price structure, key levels, and VWAP position.
3. ORDER FLOW: 2-3 sentences on CVD, OI, depth imbalance, and what institutional money appears to be doing.
4. WATCH: 1-2 specific price levels or events to monitor in the next session.

End with this exact line:
Advisory only — not financial advice.`;
}

// ── LLM Output Parser ─────────────────────────────────────────────────────────

function parseLLMBrief(raw: string, symbol: string, interval: string): BriefResult {
  const biasMatch = raw.match(/\b(bullish|bearish|neutral)\b/i);
  const biasWord = (biasMatch?.[1] ?? 'neutral').toLowerCase();
  const bias: BriefResult['bias'] = biasWord === 'bullish' ? 'bullish' : biasWord === 'bearish' ? 'bearish' : 'neutral';

  const confMatch = raw.match(/(\d{1,3})%/);
  const confidence = confMatch ? Math.min(100, parseInt(confMatch[1]!, 10)) / 100 : 0.5;

  // Strip disclaimer from body before parsing sections
  const bodyRaw = raw.replace(/Advisory only[^\n]*/gi, '').trim();

  // Parse numbered sections
  const sections: BriefSection[] = [];
  const headingMap: Record<string, string> = { '1': 'BIAS', '2': 'STRUCTURE', '3': 'ORDER FLOW', '4': 'WATCH' };
  const sectionRx = /(?:^|\n)\s*(\d)\.\s*(BIAS|STRUCTURE|ORDER FLOW|WATCH)[:\s]*/gi;
  const found: Array<{ index: number; num: string }> = [];
  let m: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((m = sectionRx.exec(bodyRaw)) !== null) {
    found.push({ index: m.index, num: m[1]! });
  }

  for (let i = 0; i < found.length; i++) {
    const start = found[i]!.index;
    const end = i + 1 < found.length ? found[i + 1]!.index : bodyRaw.length;
    const body = bodyRaw.slice(start, end)
      .replace(/^\s*\d\.\s*(BIAS|STRUCTURE|ORDER FLOW|WATCH)[:\s]*/i, '')
      .replace(/\*/g, '')
      .trim();
    if (body) sections.push({ heading: headingMap[found[i]!.num] ?? 'ANALYSIS', body });
  }

  if (sections.length === 0) {
    sections.push({ heading: 'ANALYSIS', body: bodyRaw.replace(/\*/g, '').trim() });
  }

  return { symbol, interval, bias, confidence, sections, disclaimer: 'Advisory only — not financial advice.', ts: Date.now(), heuristic: false };
}

// ── Heuristic Fallback ────────────────────────────────────────────────────────

function heuristicBrief(state: CachedSymbolState | null, symbol: string, interval: string): BriefResult {
  const ts = Date.now();
  if (!state) {
    return {
      symbol, interval, bias: 'neutral', confidence: 0,
      sections: [{ heading: 'STATUS', body: 'Awaiting market data. Connect a data provider and select a symbol to populate this panel.' }],
      disclaimer: 'Advisory only — not financial advice.', ts, heuristic: true,
    };
  }

  const { tick: t, derived: d, candles: c } = state;

  let bias: BriefResult['bias'] = 'neutral';
  let confidence = 0.4;
  if (d.cvd > 0 && d.depthImbalance > 0.15 && t.ltp > t.atp) {
    bias = 'bullish'; confidence = Math.min(0.85, 0.55 + d.depthImbalance / 2);
  } else if (d.cvd < 0 && d.depthImbalance < -0.15 && t.ltp < t.atp) {
    bias = 'bearish'; confidence = Math.min(0.85, 0.55 + Math.abs(d.depthImbalance) / 2);
  }

  const change = t.dayOpen > 0 ? ((t.ltp - t.dayOpen) / t.dayOpen * 100).toFixed(2) : '?';
  const vwapPos = t.ltp > t.atp ? 'above' : t.ltp < t.atp ? 'below' : 'at';
  const vwapPct = Math.abs(d.vwapDeviation * 100).toFixed(2);

  const sections: BriefSection[] = [
    {
      heading: 'BIAS',
      body: `${bias.charAt(0).toUpperCase() + bias.slice(1)} (${Math.round(confidence * 100)}% confidence). Day change: ${change}%. CVD is ${d.cvd > 0 ? 'positive — net buying pressure' : d.cvd < 0 ? 'negative — net selling pressure' : 'flat'}.`,
    },
    {
      heading: 'STRUCTURE',
      body: `Price is ${vwapPos} VWAP by ${vwapPct}%. Day range ${t.dayLow}–${t.dayHigh}. Prev close: ${t.prevClose ?? 'N/A'}. OI change vs prev session: ${d.oiChange > 0 ? '+' : ''}${d.oiChange}.`,
    },
    {
      heading: 'ORDER FLOW',
      body: `Depth imbalance ${(d.depthImbalance * 100).toFixed(0)}% ${d.depthImbalance > 0 ? '(bid-heavy)' : '(ask-heavy)'}. Toxicity (VPIN) ${d.toxicity.toFixed(2)} — ${d.toxicity > 0.5 ? 'elevated, informed order flow detected' : 'normal noise levels'}. Regime: ${d.volatilityRegime}.`,
    },
  ];

  if (c.length >= 2) {
    const last = c[c.length - 1]!;
    sections.push({
      heading: 'WATCH',
      body: `Key levels: support ${Math.min(t.dayLow, last.low).toFixed(2)}, resistance ${Math.max(t.dayHigh, last.high).toFixed(2)}. VWAP (${t.atp}) as intraday pivot. Volume spikes above ${Math.round(t.volume * 1.5)} may signal breakout intent.`,
    });
  }

  return { symbol, interval, bias, confidence, sections, disclaimer: 'Advisory only — not financial advice.', ts, heuristic: true };
}

// ── HTTP Handler ──────────────────────────────────────────────────────────────

export async function handleBriefRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }

  const provider = url.searchParams.get('provider') ?? '';
  const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase();
  const interval = url.searchParams.get('interval') ?? '1m';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!symbol) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'symbol is required' }));
    return;
  }

  const state = getState(provider, symbol);

  let result: BriefResult;

  if (ollamaAvailable() && state) {
    const prompt = buildPrompt(state, interval);
    const system = `You are a senior Indian equity and F&O prop desk analyst. Write concise institutional-quality market analysis. Be direct, use numbers, avoid filler words. Never give explicit buy/sell recommendations — frame everything as observations and probabilities.`;
    try {
      const raw = await ollamaGenerate(prompt, system);
      result = raw && raw.trim().length > 40
        ? parseLLMBrief(raw.trim(), symbol, interval)
        : heuristicBrief(state, symbol, interval);
    } catch {
      result = heuristicBrief(state, symbol, interval);
    }
  } else {
    result = heuristicBrief(state, symbol, interval);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}
