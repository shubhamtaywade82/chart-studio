import { PropDeskAI } from './engine';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

const main = async (): Promise<void> => {
  const engine = new PropDeskAI(REDIS_URL);
  await engine.start();

  process.once('SIGTERM', () => void engine.stop());
  process.once('SIGINT', () => void engine.stop());
};

main().catch((err) => {
  console.error('[ai-engine] fatal', err);
  process.exit(1);
});

export { PropDeskAI } from './engine';
export { OllamaClient } from './ollama-client';
export { reflex } from './reflex';
export { tactical } from './tactical';
export { narrate } from './narrative';
export { assessRisk } from './risk';
export { morningBrief } from './morning-brief';
export { MarginCalculator } from './margin-calculator';
export { PortfolioGreeksEngine } from './portfolio-greeks';
export { VarEngine } from './var-engine';
export { VectorStore } from './vector-store';
export { CorrelationTracker } from './correlation';
export { generateBrief } from './brief';
export type { BriefResult, BriefRequest } from './brief';
export * from './types';
