import type { OllamaClient } from './ollama-client';
import type { MicrostructureSnapshot } from './types';

const BRIEF_MODEL = process.env.AI_NARRATIVE_MODEL ?? 'llama3.2:3b';

export interface BriefRequest {
  symbol: string;
  provider: string;
  interval: string;
  snap: MicrostructureSnapshot | null;
}

export interface BriefSection {
  heading: string;
  body: string;
}

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

/**
 * Build a structured, markdown-compatible AI brief for the sidebar panel.
 * Uses Ollama if available; falls back to a heuristic-only brief.
 */
export async function generateBrief(req: BriefRequest, ollama: OllamaClient): Promise<BriefResult> {
  const { symbol, interval, snap } = req;
  const ts = Date.now();

  const heuristicResult = buildHeuristicBrief(symbol, interval, snap, ts);

  if (!ollama.isAvailable() || !snap) {
    return heuristicResult;
  }

  const prompt = buildPrompt(symbol, interval, snap);

  try {
    const raw = await ollama.generate({
      model: BRIEF_MODEL,
      prompt,
      temperature: 0.25,
      numPredict: 600,
      timeoutMs: 25_000,
      system: `You are a senior Indian equity and F&O prop desk analyst. Write concise, institutional-quality market analysis. Be direct, use numbers, avoid filler words. Never give explicit buy/sell advice — frame everything as observations and probabilities.`,
    });

    if (raw && raw.trim().length > 40) {
      return parseLLMBrief(symbol, interval, raw.trim(), snap, ts);
    }
  } catch {
    // fall through to heuristic
  }

  return heuristicResult;
}

// ── Prompt Builder ────────────────────────────────────────────────────────────

function buildPrompt(symbol: string, interval: string, snap: MicrostructureSnapshot): string {
  const t = snap.tick;
  const d = snap.derived;
  const c = snap.candles;
  const last5 = c.slice(-5);

  const candleStr = last5.length > 0
    ? last5.map((x) =>
        `  [${new Date(x.openTime).toISOString().slice(11, 16)}] O:${x.open} H:${x.high} L:${x.low} C:${x.close} V:${x.volume}`,
      ).join('\n')
    : '  (no candle history)';

  const vwapPct = (d.vwapDeviation * 100).toFixed(2);
  const imbalPct = (d.depthImbalance * 100).toFixed(1);
  const change = t.dayOpen > 0 ? (((t.ltp - t.dayOpen) / t.dayOpen) * 100).toFixed(2) : '?';

  return `Symbol: ${symbol} | Interval: ${interval} | Time: ${new Date(snap.timestamp).toISOString()}

MARKET SNAPSHOT
  LTP: ${t.ltp}  |  ATP (VWAP): ${t.atp}  |  Day: ${t.dayOpen} → ${t.dayHigh}/${t.dayLow} (${change}%)
  OI: ${t.openInterest}  OI-chg vs prev: ${d.oiChange}  |  Volume: ${t.volume}
  TotalBuy: ${t.totalBuyQty}  TotalSell: ${t.totalSellQty}  |  CVD: ${d.cvd}
  VWAP deviation: ${vwapPct}%  |  Depth imbalance: ${imbalPct}%
  Toxicity: ${d.toxicity.toFixed(2)}  |  Vol regime: ${d.volatilityRegime}  |  Trade intensity: ${d.tradeIntensity.toFixed(1)} t/s

LAST 5 CANDLES
${candleStr}

Write a structured market brief in 4 sections. Use plain English, no markdown headers.

1. BIAS: One word (Bullish/Bearish/Neutral) and confidence 0-100%. One sentence rationale.
2. STRUCTURE: 2-3 sentences on price structure, key levels, and VWAP position.
3. ORDER FLOW: 2-3 sentences on CVD, OI, depth imbalance, and what smart money appears to be doing.
4. WATCH: 1-2 specific price levels or events to monitor in the next session.

End with this exact line:
Advisory only — not financial advice.`;
}

// ── LLM Output Parser ─────────────────────────────────────────────────────────

function parseLLMBrief(
  symbol: string,
  interval: string,
  raw: string,
  snap: MicrostructureSnapshot,
  ts: number,
): BriefResult {
  // Extract bias from first line that contains Bullish/Bearish/Neutral
  const biasMatch = raw.match(/\b(bullish|bearish|neutral)\b/i);
  const biasWord = biasMatch ? biasMatch[1]!.toLowerCase() : 'neutral';
  const bias = biasWord === 'bullish' ? 'bullish' : biasWord === 'bearish' ? 'bearish' : 'neutral';

  // Extract confidence percentage
  const confMatch = raw.match(/(\d{1,3})%/);
  const confidence = confMatch ? Math.min(100, parseInt(confMatch[1]!, 10)) / 100 : 0.5;

  // Split into sections by numbered prefix (1. 2. 3. 4.)
  const sectionPattern = /(?:^|\n)\s*(\d)\.\s*(BIAS|STRUCTURE|ORDER FLOW|WATCH)[:\s]*/gi;
  const sections: BriefSection[] = [];
  const headings = ['BIAS', 'STRUCTURE', 'ORDER FLOW', 'WATCH'];

  let lastIndex = 0;
  let lastHeading = '';
  const matches: Array<{ index: number; heading: string }> = [];

  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = sectionPattern.exec(raw)) !== null) {
    matches.push({ index: m.index, heading: headings[parseInt(m[1]!, 10) - 1] ?? m[2]! });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.index;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : raw.length;
    const body = raw.slice(start, end).replace(/^\s*\d\.\s*[A-Z ]+[:\s]*/i, '').replace(/Advisory only.*$/i, '').trim();
    if (body) {
      sections.push({ heading: matches[i]!.heading, body });
    }
  }

  // Fallback: if parsing failed, put the whole text as a single section
  if (sections.length === 0) {
    sections.push({ heading: 'ANALYSIS', body: raw.replace(/Advisory only.*$/i, '').trim() });
  }

  return {
    symbol, interval, bias, confidence, sections,
    disclaimer: 'Advisory only — not financial advice.',
    ts, heuristic: false,
  };

  void lastIndex; void lastHeading; // suppress unused warnings
}

// ── Heuristic Fallback ────────────────────────────────────────────────────────

function buildHeuristicBrief(
  symbol: string,
  interval: string,
  snap: MicrostructureSnapshot | null,
  ts: number,
): BriefResult {
  if (!snap) {
    return {
      symbol, interval, bias: 'neutral', confidence: 0,
      sections: [{ heading: 'STATUS', body: 'Awaiting market data. Connect a provider and select a symbol.' }],
      disclaimer: 'Advisory only — not financial advice.',
      ts, heuristic: true,
    };
  }

  const t = snap.tick;
  const d = snap.derived;
  const c = snap.candles;

  // Bias
  let bias: BriefResult['bias'] = 'neutral';
  let confidence = 0.4;

  if (d.cvd > 0 && d.depthImbalance > 0.2 && t.ltp > t.atp) {
    bias = 'bullish'; confidence = 0.55 + Math.min(0.3, d.depthImbalance / 2);
  } else if (d.cvd < 0 && d.depthImbalance < -0.2 && t.ltp < t.atp) {
    bias = 'bearish'; confidence = 0.55 + Math.min(0.3, Math.abs(d.depthImbalance) / 2);
  }

  const change = t.dayOpen > 0 ? ((t.ltp - t.dayOpen) / t.dayOpen * 100).toFixed(2) : '?';
  const vwapPos = t.ltp > t.atp ? 'above' : t.ltp < t.atp ? 'below' : 'at';
  const vwapPct = Math.abs(d.vwapDeviation * 100).toFixed(2);

  const sections: BriefSection[] = [
    {
      heading: 'BIAS',
      body: `${bias.charAt(0).toUpperCase() + bias.slice(1)} (${Math.round(confidence * 100)}% confidence). Day change ${change}%; CVD ${d.cvd > 0 ? 'positive (buy pressure)' : d.cvd < 0 ? 'negative (sell pressure)' : 'flat'}.`,
    },
    {
      heading: 'STRUCTURE',
      body: `Price is ${vwapPos} VWAP by ${vwapPct}%. Day range: ${t.dayLow}–${t.dayHigh}. Prev close: ${t.prevClose || 'N/A'}. OI change vs prev session: ${d.oiChange > 0 ? '+' : ''}${d.oiChange}.`,
    },
    {
      heading: 'ORDER FLOW',
      body: `Depth imbalance ${(d.depthImbalance * 100).toFixed(0)}% ${d.depthImbalance > 0 ? '(bid-heavy)' : '(ask-heavy)'}. Toxicity (VPIN) ${d.toxicity.toFixed(2)} — ${d.toxicity > 0.5 ? 'elevated, informed flow likely' : 'normal noise levels'}. Vol regime: ${d.volatilityRegime}.`,
    },
  ];

  if (c.length >= 2) {
    const last = c[c.length - 1]!;
    const support = Math.min(t.dayLow, last.low).toFixed(2);
    const resistance = Math.max(t.dayHigh, last.high).toFixed(2);
    sections.push({
      heading: 'WATCH',
      body: `Key levels: support ${support}, resistance ${resistance}. Watch ATP (${t.atp}) as intraday pivot. Volume spikes above ${(t.volume * 1.5).toFixed(0)} may signal breakout intent.`,
    });
  }

  return {
    symbol, interval, bias, confidence, sections,
    disclaimer: 'Advisory only — not financial advice.',
    ts, heuristic: true,
  };
}
