import type { RedisBridge } from './redis-bridge';
import type { SymbolRef, InstrumentMeta } from '@chart-studio/adapter-core';

/**
 * Federated symbol search: query every online provider in parallel, merge
 * the results. Each result keeps its `provider` so the UI can route to the
 * right adapter.
 */
export const federatedSearchSymbols = async (
  bridge: RedisBridge,
  query: string,
  limit = 20,
): Promise<SymbolRef[]> => {
  const providers = bridge.snapshotPresence().filter((p) => p.online);
  if (providers.length === 0) return [];

  // Request a larger batch from adapters so we can rank the best matches
  // across segments (e.g. to ensure Cash/Equity isn't buried by F&O strikes).
  const internalLimit = Math.max(limit * 5, 100);

  const results = await Promise.all(
    providers.map((p) => bridge.discover<SymbolRef[]>(p.provider, 'search', { query, limit: internalLimit })),
  );

  const merged: SymbolRef[] = [];
  for (const list of results) {
    if (!Array.isArray(list)) continue;
    for (const item of list) merged.push(item);
  }

  // Sort: exact symbol or label match first, then prefix, then substring.
  const q = query.trim().toUpperCase();
  merged.sort((a, b) => score(b, q) - score(a, q));
  return merged.slice(0, limit);
};

const score = (ref: SymbolRef, q: string): number => {
  if (!q) return 0;
  const s = ref.symbol.toUpperCase();
  const l = (ref.label || '').toUpperCase();
  
  let points = 0;

  // 1. MATCH QUALITY (The foundation)
  if (s === q || l === q) points += 1000;
  else if (s.startsWith(q) || l.startsWith(q)) points += 500;
  else if (l.split(/\s+/).some(word => word.startsWith(q))) points += 400;
  else if (s.includes(q) || l.includes(q)) points += 100;

  if (points === 0) return 0;

  // 2. HIERARCHY RANKING (Tie-breaker within the same match quality)
  // Order: IDX_I -> NSE/BSE_EQ -> NSE/BSE_FNO -> MCX -> MCX_FNO
  const sUpper = s.toUpperCase();
  
  // High-level segment prioritization
  if (sUpper.startsWith('IDX_I:') || ref.segment === 'index') {
    points += 90;
  } else if (sUpper.startsWith('NSE_EQ:') || sUpper.startsWith('BSE_EQ:') || ref.segment === 'equity' || ref.segment === 'spot') {
    points += 80;
  } else if (sUpper.startsWith('NSE_FNO:') || sUpper.startsWith('BSE_FNO:') || ref.segment === 'futures') {
    points += 70;
  } else if (sUpper.startsWith('MCX_COMM:') || ref.segment === 'commodity') {
    // Note: MCX_COMM is used for both cash and futures in some Dhan segments
    points += 60;
  } else if (ref.segment === 'option') {
    points += 50;
  }

  // Slight preference for NSE over BSE when both exist
  if (sUpper.startsWith('NSE_')) points += 2;

  return points;
};

export const federatedListSymbols = async (
  bridge: RedisBridge,
  provider: string,
  filter?: { segment?: string },
): Promise<InstrumentMeta[]> => {
  const data = await bridge.discover<InstrumentMeta[]>(provider, 'list', { filter });
  return Array.isArray(data) ? data : [];
};
