import type { MicrostructureSnapshot } from './types';
import type { OllamaClient } from './ollama-client';

const RISK_MODEL = process.env.AI_RISK_MODEL ?? 'codellama:7b';

export interface PositionInput {
  symbol: string;
  qty: number;
  avgPrice: number;
  side: 'long' | 'short';
  stop?: number;
  target?: number;
}

export interface RiskAssessment {
  action: 'hold' | 'trim_25_pct' | 'trim_50_pct' | 'add' | 'exit' | 'tighten_stop';
  reason: string;
  mtmPct: number;
  stopHitProbability: number;
  /** "all_clear" | "yellow" | "red" — drives the header pill. */
  status: 'all_clear' | 'yellow' | 'red';
  ts: number;
}

export async function assessRisk(
  snap: MicrostructureSnapshot,
  position: PositionInput,
  ollama: OllamaClient,
): Promise<RiskAssessment> {
  const t = snap.tick;
  const d = snap.derived;
  const mtmPct = position.side === 'long'
    ? ((t.ltp - position.avgPrice) / position.avgPrice) * 100
    : ((position.avgPrice - t.ltp) / position.avgPrice) * 100;

  const prompt = `You are a prop desk risk manager.
Position: ${position.side === 'long' ? 'Long' : 'Short'} ${position.qty} ${position.symbol} @ ${position.avgPrice}
Current: ${t.ltp}. ATP: ${t.atp}. OI change: ${d.oiChange}.
Depth imbalance: ${(d.depthImbalance * 100).toFixed(0)}%. Toxicity: ${d.toxicity.toFixed(2)}.
Day high: ${t.dayHigh}, low: ${t.dayLow}.
Stop: ${position.stop ?? 'none'}, Target: ${position.target ?? 'none'}.
MTM: ${mtmPct.toFixed(2)}%.

JSON response only:
{"action":"hold|trim_25_pct|trim_50_pct|add|exit|tighten_stop","reason":string,"stopHitProbability":number,"status":"all_clear|yellow|red"}`;

  const result = await ollama.generateJson<Partial<RiskAssessment>>({
    model: RISK_MODEL,
    prompt,
    temperature: 0.05,
    numPredict: 250,
    timeoutMs: process.env.OLLAMA_MODE === 'cloud' ? 30_000 : 5_000,
  });

  if (result) {
    return {
      action: (result.action as RiskAssessment['action']) ?? 'hold',
      reason: String(result.reason ?? ''),
      mtmPct,
      stopHitProbability: typeof result.stopHitProbability === 'number' ? result.stopHitProbability : 0.5,
      status: (result.status as RiskAssessment['status']) ?? 'yellow',
      ts: snap.timestamp,
    };
  }

  // Heuristic fallback.
  const adverse = position.side === 'long' ? d.depthImbalance < -0.3 : d.depthImbalance > 0.3;
  let status: RiskAssessment['status'] = 'all_clear';
  if (mtmPct < -0.5 || (adverse && d.toxicity > 0.5)) status = 'red';
  else if (mtmPct < -0.2 || adverse) status = 'yellow';

  return {
    action: status === 'red' ? 'tighten_stop' : 'hold',
    reason: 'AI offline — heuristic risk check based on MTM and depth.',
    mtmPct,
    stopHitProbability: status === 'red' ? 0.65 : 0.3,
    status,
    ts: snap.timestamp,
  };
}
