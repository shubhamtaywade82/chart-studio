import type { OllamaClient } from './ollama-client';

const STRATEGIC_MODEL = process.env.AI_STRATEGIC_MODEL ?? 'mixtral:8x7b';

export interface MorningContext {
  spxChange?: number;
  ndxChange?: number;
  vix?: number;
  usdinr?: number;
  brent?: number;
  yield10y?: number;
  maxPain?: number;
  pcr?: number;
  fiiNetCr?: number;
  topOiAdds?: string[];
}

export interface MorningBriefOutput {
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  levels: Array<{ symbol: string; price: number; type: string; probability: number }>;
  scenarios: Array<{ trigger: string; outcome: string; probability: number }>;
  risks: string[];
  narrative: string;
}

export async function morningBrief(ctx: MorningContext, ollama: OllamaClient): Promise<MorningBriefOutput | null> {
  const prompt = `You are the head of prop desk at a Mumbai HFT firm.
Pre-market data:
- Global: S&P 500 ${ctx.spxChange ?? '?'}%, NDX ${ctx.ndxChange ?? '?'}%, VIX ${ctx.vix ?? '?'}
- India: USD/INR ${ctx.usdinr ?? '?'}, crude ${ctx.brent ?? '?'}, 10Y yield ${ctx.yield10y ?? '?'}
- F&O: Max pain ${ctx.maxPain ?? '?'}, PCR ${ctx.pcr ?? '?'}, FIIs net ${ctx.fiiNetCr ?? '?'}cr
- Top OI adds: ${ctx.topOiAdds?.join(', ') ?? '?'}

Output JSON ONLY:
{
  "bias": "bullish|bearish|neutral",
  "confidence": number,
  "levels": [{"symbol": "NIFTY|BANKNIFTY", "price": number, "type": "support|resistance", "probability": number}],
  "scenarios": [{"trigger": string, "outcome": string, "probability": number}],
  "risks": [string],
  "narrative": string
}`;

  return ollama.generateJson<MorningBriefOutput>({
    model: STRATEGIC_MODEL,
    prompt,
    temperature: 0.1,
    numPredict: 900,
    timeoutMs: 60_000,
  });
}
