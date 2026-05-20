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

  // Request a larger batch from adapters to allow for cross-segment ranking.
  const internalLimit = Math.max(limit * 5, 100);

  const results = await Promise.all(
    providers.map((p) => bridge.discover<SymbolRef[]>(p.provider, 'search', { query, limit: internalLimit })),
  );

  const merged: SymbolRef[] = [];
  for (const list of results) {
    if (!Array.isArray(list)) continue;
    for (const item of list) merged.push(item);
  }

  // Sort strictly by segment hierarchy first, then by match quality score.
  const q = query.trim().toUpperCase();
  merged.sort((a, b) => {
    const tierA = getSegmentTier(a);
    const tierB = getSegmentTier(b);
    
    // Lower tier number = higher priority
    if (tierA !== tierB) return tierA - tierB;
    
    // Within the same tier, sort by match quality score
    return scoreMatchQuality(b, q) - scoreMatchQuality(a, q);
  });

  return merged.slice(0, limit);
};

/**
 * Returns a numerical tier for strict grouping.
 * 1: Indices (IDX_I)
 * 2: Equity/Spot (NSE_EQ, BSE_EQ, Binance Spot)
 * 3: F&O/Futures (NSE_FNO, BSE_FNO, Binance USD-M)
 * 4: Commodity (MCX)
 * 5: Options
 * 6: Others
 */
const getSegmentTier = (ref: SymbolRef): number => {
  const s = (ref.symbol || '').toUpperCase();
  const seg = (ref.segment || '').toLowerCase();
  const prov = (ref.provider || '').toLowerCase();

  // 1. Indices
  if (seg === 'index' || s.startsWith('IDX_I:')) return 1;

  // 2. Equity/Spot (including Crypto Spot)
  if (seg === 'equity' || seg === 'spot' || s.startsWith('NSE_EQ:') || s.startsWith('BSE_EQ:')) return 2;

  // 3. Futures (Indian & Crypto)
  if (seg === 'futures' || (prov.includes('binance') && seg === 'futures')) return 3;
  
  // F&O bucket in Dhan might contain both, so we check for option indicators
  if (s.startsWith('NSE_FNO:') || s.startsWith('BSE_FNO:')) {
    if (seg === 'option' || s.includes(' CALL') || s.includes(' PUT') || / \d{4} [CP]E$/.test(s)) return 5;
    return 3; // default to futures for FNO segment if not an option
  }

  // 4. Commodity
  if (seg === 'commodity' || s.startsWith('MCX_COMM:')) return 4;

  // 5. Options
  if (seg === 'option') return 5;

  return 6;
};

const scoreMatchQuality = (ref: SymbolRef, q: string): number => {
  if (!q) return 0;
  const s = ref.symbol.toUpperCase();
  const l = (ref.label || '').toUpperCase();
  
  if (s === q || l === q) return 1000;
  if (s.startsWith(q) || l.startsWith(q)) return 500;
  if (l.split(/\s+/).some(word => word.startsWith(q))) return 400;
  if (s.includes(q) || l.includes(q)) return 100;
  
  return 0;
};

export const federatedListSymbols = async (
  bridge: RedisBridge,
  provider: string,
  filter?: { segment?: string },
): Promise<InstrumentMeta[]> => {
  const data = await bridge.discover<InstrumentMeta[]>(provider, 'list', { filter });
  return Array.isArray(data) ? data : [];
};
