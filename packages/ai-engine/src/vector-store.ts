import type { Redis } from 'ioredis';
import type { MicrostructureSnapshot } from './types';
import type { OllamaClient } from './ollama-client';

const EMBED_MODEL = process.env.AI_EMBED_MODEL ?? 'nomic-embed-text';
const KEY_PREFIX = 'ai:embed';

export interface PatternRecord {
  id: string;
  symbol: string;
  timestamp: number;
  embedding: number[];
  outcome: { maxMovePct: number; direction: 'up' | 'down' | 'flat' } | null;
  serialized: string;
}

export interface SimilarityHit {
  record: PatternRecord;
  similarity: number;
}

/**
 * Simple Redis-backed vector store with cosine similarity. Suitable for
 * up to ~5000 entries per symbol — beyond that, plug in pgvector or chroma.
 */
export class VectorStore {
  constructor(private redis: Redis, private ollama: OllamaClient) {}

  async embed(snap: MicrostructureSnapshot): Promise<number[] | null> {
    const serialized = serialize(snap);
    return this.ollama.embed({ model: EMBED_MODEL, prompt: serialized });
  }

  async store(snap: MicrostructureSnapshot, embedding: number[]): Promise<PatternRecord> {
    const id = `${snap.symbol}-${snap.timestamp}`;
    const record: PatternRecord = {
      id,
      symbol: snap.symbol,
      timestamp: snap.timestamp,
      embedding,
      outcome: null,
      serialized: serialize(snap),
    };
    await this.redis.set(`${KEY_PREFIX}:${snap.symbol}:${id}`, JSON.stringify(record), 'EX', 86400 * 7);
    await this.redis.zadd(`${KEY_PREFIX}:index:${snap.symbol}`, snap.timestamp, id);
    return record;
  }

  /** Update an existing record once outcome is known (5 candles later). */
  async setOutcome(symbol: string, id: string, outcome: PatternRecord['outcome']): Promise<void> {
    const raw = await this.redis.get(`${KEY_PREFIX}:${symbol}:${id}`);
    if (!raw) return;
    try {
      const rec = JSON.parse(raw) as PatternRecord;
      rec.outcome = outcome;
      await this.redis.set(`${KEY_PREFIX}:${symbol}:${id}`, JSON.stringify(rec), 'EX', 86400 * 7);
    } catch { /* corruption — drop */ }
  }

  async findSimilar(symbol: string, embedding: number[], k = 5): Promise<SimilarityHit[]> {
    const ids = await this.redis.zrange(`${KEY_PREFIX}:index:${symbol}`, 0, -1);
    if (ids.length === 0) return [];
    const records: PatternRecord[] = [];
    for (const id of ids) {
      const raw = await this.redis.get(`${KEY_PREFIX}:${symbol}:${id}`);
      if (!raw) continue;
      try { records.push(JSON.parse(raw) as PatternRecord); } catch { /* skip */ }
    }
    const scored = records
      .filter((r) => r.outcome !== null) // only resolved patterns inform analysis
      .map((r) => ({ record: r, similarity: cosine(r.embedding, embedding) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
    return scored;
  }
}

function serialize(s: MicrostructureSnapshot): string {
  const c = s.candles.slice(-20).map((x) =>
    `${x.openTime}|${x.open.toFixed(2)}|${x.high.toFixed(2)}|${x.low.toFixed(2)}|${x.close.toFixed(2)}|${x.volume}`,
  ).join(';');
  const d = s.derived;
  return [
    `sym=${s.symbol}`,
    `regime=${d.volatilityRegime}`,
    `vwapDev=${d.vwapDeviation.toFixed(4)}`,
    `cvd=${d.cvd}`,
    `oiChg=${d.oiChange}`,
    `depthImb=${d.depthImbalance.toFixed(3)}`,
    `tox=${d.toxicity.toFixed(3)}`,
    `bidDepth=${s.tick.bids.reduce((a, b) => a + b.qty, 0)}`,
    `askDepth=${s.tick.asks.reduce((a, b) => a + b.qty, 0)}`,
    `candles=${c}`,
  ].join('\n');
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
