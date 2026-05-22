import type { MicrostructureSnapshot, Urgency } from './types';
import type { OllamaClient } from './ollama-client';

const NARRATIVE_MODEL = process.env.AI_NARRATIVE_MODEL ?? 'llama3.2:3b';

export interface NarrativeMessage {
  text: string;
  urgency: Urgency;
  ts: number;
}

/**
 * Generate a 1-sentence terse market commentary in institutional style.
 * Uses the small narrative model. Falls back to a heuristic-built sentence
 * if Ollama is unavailable.
 */
export async function narrate(
  snap: MicrostructureSnapshot,
  ollama: OllamaClient,
): Promise<NarrativeMessage> {
  const d = snap.derived;
  const t = snap.tick;
  const isCrypto = snap.provider.includes('binance');

  const marketType = isCrypto ? 'Crypto Perpetuals' : 'Indian F&O and Equity';
  const specificMetrics = isCrypto 
    ? `Funding: ${t.fundingRate ? (t.fundingRate * 100).toFixed(4) + '%' : 'N/A'}`
    : `OI: ${t.openInterest}, Change: ${d.oiChange}`;

  const prompt = `You are a senior prop desk trader specializing in ${marketType}. 
Write ONE terse sentence (< 25 words) commenting on the current market state. NO emojis. Use institutional language.

Context:
Symbol: ${snap.symbol} (${snap.provider})
Price: LTP ${t.ltp}, ATP ${t.atp}, VWAP Dev: ${(d.vwapDeviation * 100).toFixed(2)}%
Order Flow: CVD ${d.cvd}, Imbalance: ${(d.depthImbalance * 100).toFixed(0)}%, Toxicity: ${d.toxicity.toFixed(2)}
${specificMetrics}

One sentence:`;

  const text = await ollama.generate({
    model: NARRATIVE_MODEL,
    prompt,
    temperature: 0.2,
    numPredict: 80,
    timeoutMs: 4_000,
  });

  if (text) {
    return {
      text: text.trim().replace(/^["']|["']$/g, '').split('\n')[0]!.slice(0, 220),
      urgency: pickUrgency(d.toxicity, Math.abs(d.depthImbalance)),
      ts: snap.timestamp,
    };
  }

  // Heuristic fallback narrative.
  const parts: string[] = [];
  if (Math.abs(d.vwapDeviation) > 0.002) {
    parts.push(`Price ${d.vwapDeviation > 0 ? 'above' : 'below'} ATP by ${(Math.abs(d.vwapDeviation) * 100).toFixed(2)}%`);
  }
  if (d.cvd !== 0) {
    parts.push(`order flow ${d.cvd > 0 ? 'bid' : 'ask'}-dominant`);
  }
  if (d.toxicity > 0.4) parts.push('toxicity elevated');
  if (Math.abs(d.depthImbalance) > 0.4) parts.push(`depth ${d.depthImbalance > 0 ? 'bid' : 'ask'}-skewed`);
  return {
    text: parts.length > 0 ? parts.join('; ') + '.' : 'Balanced tape; no edge.',
    urgency: pickUrgency(d.toxicity, Math.abs(d.depthImbalance)),
    ts: snap.timestamp,
  };
}

function pickUrgency(toxicity: number, absImbalance: number): Urgency {
  if (toxicity > 0.6 || absImbalance > 0.7) return 'immediate';
  if (toxicity > 0.4 || absImbalance > 0.5) return 'this_candle';
  if (toxicity > 0.2) return 'next_5min';
  return 'watch_only';
}
