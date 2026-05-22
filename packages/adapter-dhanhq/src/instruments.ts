import axios, { type AxiosInstance } from 'axios';
import type { InstrumentMeta, SymbolRef } from '@chart-studio/adapter-core';

const SCRIP_MASTER_URL = 'https://images.dhan.co/api-data/api-scrip-master-detailed.csv';
const REFRESH_MS = 12 * 60 * 60 * 1000; // 12h

export interface DhanInstrument {
  /** "NSE_EQ", "NSE_FNO", "BSE_EQ", "MCX_COMM", etc. */
  exchangeSegment: string;
  securityId: string;
  symbolName: string;
  displayName: string;
  instrumentType: string;
  /** "EQUITY" | "FUTSTK" | "OPTSTK" | "FUTIDX" | "OPTIDX" | ... */
  segment: string;
  exchId: string;
  lotSize: number;
  tickSize: number;
  expiryDate?: string;
  strikePrice?: number;
  optionType?: string;
  isin?: string;
}

const segmentLabelFor = (instrumentType: string): string => {
  const type = instrumentType.toUpperCase();
  if (type === 'EQUITY' || type === 'EQ') return 'equity';
  if (type === 'INDEX' || type === 'IDX') return 'index';
  if (type.startsWith('FUT') || type === 'FT') return 'futures';
  if (type.startsWith('OPT') || type === 'OP') return 'option';
  if (type === 'COMMODITY' || type === 'COM') return 'commodity';
  if (type === 'CURRENCY' || type === 'CUR') return 'currency';
  return type.toLowerCase();
};

const segmentFromRow = (exchId: string, instrumentType: string, raw?: string): string => {
  if (raw && raw.includes('_')) return raw;
  
  const type = instrumentType.toUpperCase();
  const exch = exchId.toUpperCase();

  if (type === 'INDEX' || type === 'IDX') return 'IDX_I';
  
  if (type === 'EQUITY' || type === 'EQ' || type === 'ES') {
    if (exch === 'NSE') return 'NSE_EQ';
    if (exch === 'BSE') return 'BSE_EQ';
  }
  
  if (type.startsWith('FUT') || type === 'FT' || type.startsWith('OPT') || type === 'OP') {
    if (exch === 'NSE') return 'NSE_FNO';
    if (exch === 'BSE') return 'BSE_FNO';
    if (exch === 'MCX') return 'MCX_COMM';
  }
  
  if (type === 'CURRENCY' || type === 'CUR') {
    if (exch === 'NSE') return 'NSE_CURRENCY';
    if (exch === 'BSE') return 'BSE_CURRENCY';
  }
  
  if (exch === 'MCX') return 'MCX_COMM';
  return `${exch}_${type || 'EQ'}`;
};

const parseCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === ',' && !inQuote) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
};

const parseScripMaster = (csv: string): DhanInstrument[] => {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toUpperCase());
  const idx = (name: string): number => header.indexOf(name);

  const cExch = idx('EXCH_ID');
  const cSegment = idx('SEGMENT');
  const cSecurityId = idx('SECURITY_ID') !== -1 ? idx('SECURITY_ID') : idx('SEM_SMST_SECURITY_ID');
  const cSymbol = idx('SYMBOL_NAME') !== -1 ? idx('SYMBOL_NAME') : idx('SEM_TRADING_SYMBOL');
  const cDisplay = idx('DISPLAY_NAME') !== -1 ? idx('DISPLAY_NAME') : idx('SM_SYMBOL_NAME');
  const cInstrumentType = idx('INSTRUMENT_TYPE') !== -1 ? idx('INSTRUMENT_TYPE') : idx('SEM_INSTRUMENT_NAME');
  const cExchangeSegment = idx('EXCHANGE_SEGMENT') !== -1 ? idx('EXCHANGE_SEGMENT') : idx('SEM_EXM_EXCH_ID');
  const cLotSize = idx('LOT_SIZE') !== -1 ? idx('LOT_SIZE') : idx('SEM_LOT_UNITS');
  const cTickSize = idx('TICK_SIZE') !== -1 ? idx('TICK_SIZE') : idx('SEM_TICK_SIZE');
  const cExpiry = idx('EXPIRY_DATE') !== -1 ? idx('EXPIRY_DATE') : idx('SEM_EXPIRY_DATE');
  const cStrike = idx('STRIKE_PRICE') !== -1 ? idx('STRIKE_PRICE') : idx('SEM_STRIKE_PRICE');
  const cOptionType = idx('OPTION_TYPE') !== -1 ? idx('OPTION_TYPE') : idx('SEM_OPTION_TYPE');
  const cIsin = idx('ISIN');
  const cUnderlyingSymbol = idx('UNDERLYING_SYMBOL');

  const required = [cExch, cSecurityId, cSymbol, cInstrumentType];
  if (required.some((i) => i === -1)) return [];

  const out: DhanInstrument[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]!);
    const exchId = (row[cExch] ?? '').trim();
    const securityId = (row[cSecurityId] ?? '').trim();
    const symbol = (row[cSymbol] ?? '').trim();
    const instrumentType = (row[cInstrumentType] ?? '').trim();
    if (!exchId || !securityId || !symbol || !instrumentType) continue;

    let resolvedSymbol = symbol;
    if (cUnderlyingSymbol !== -1 && (instrumentType.toUpperCase() === 'ES' || instrumentType.toUpperCase() === 'EQUITY')) {
      const underlying = (row[cUnderlyingSymbol] ?? '').trim();
      if (underlying) {
        resolvedSymbol = underlying;
      }
    }

    const exchangeSegment = segmentFromRow(exchId, instrumentType, cExchangeSegment !== -1 ? (row[cExchangeSegment] ?? '').trim() : undefined);
    out.push({
      exchangeSegment,
      securityId,
      symbolName: resolvedSymbol,
      displayName: cDisplay !== -1 ? (row[cDisplay] ?? symbol).trim() || symbol : symbol,
      instrumentType,
      segment: cSegment !== -1 ? (row[cSegment] ?? '').trim() : '',
      exchId,
      lotSize: cLotSize !== -1 ? Number(row[cLotSize]) || 1 : 1,
      tickSize: cTickSize !== -1 ? Number(row[cTickSize]) || 0.05 : 0.05,
      expiryDate: cExpiry !== -1 && row[cExpiry] ? row[cExpiry] : undefined,
      strikePrice: cStrike !== -1 && row[cStrike] ? Number(row[cStrike]) : undefined,
      optionType: cOptionType !== -1 && row[cOptionType] ? row[cOptionType] : undefined,
      isin: cIsin !== -1 && row[cIsin] ? row[cIsin] : undefined,
    });
  }
  return out;
};

let cache: { ts: number; rows: DhanInstrument[]; byKey: Map<string, DhanInstrument> } | null = null;
let csvLoaded = false;

const buildIndex = (rows: DhanInstrument[]): Map<string, DhanInstrument> => {
  const m = new Map<string, DhanInstrument>();
  for (const r of rows) m.set(`${r.exchangeSegment}:${r.securityId}`, r);
  return m;
};

export const loadInstruments = async (overrideUrl?: string): Promise<DhanInstrument[]> => {
  if (csvLoaded && cache && Date.now() - cache.ts < REFRESH_MS) return cache.rows;
  const url = overrideUrl ?? SCRIP_MASTER_URL;
  try {
    const { data } = await axios.get<string>(url, { timeout: 60_000, responseType: 'text', validateStatus: (s) => s === 200 });
    const rows = parseScripMaster(data);
    cache = { ts: Date.now(), rows, byKey: buildIndex(rows) };
    csvLoaded = true;
    return rows;
  } catch (err) {
    console.error(`[dhanhq] failed to load instruments from ${url}`, err);
    return cache?.rows ?? [];
  }
};

/**
 * Fetch instruments from DhanHQ API (v2 segment-wise).
 * Requires an authenticated axios client.
 */
export const fetchInstrumentsFromApi = async (client: AxiosInstance, segments: string[]): Promise<DhanInstrument[]> => {
  const all: DhanInstrument[] = [];
  for (const seg of segments) {
    try {
      const { data } = await client.get<any[]>(`/v2/instrument/${seg}`);
      if (!Array.isArray(data)) continue;
      for (const item of data) {
        all.push({
          exchangeSegment: seg,
          securityId: String(item.SEM_SMST_SECURITY_ID || item.securityId),
          symbolName: item.SEM_TRADING_SYMBOL || item.symbolName,
          displayName: item.SEM_CUSTOM_SYMBOL || item.displayName || item.SEM_TRADING_SYMBOL || item.symbolName,
          instrumentType: item.SEM_INSTRUMENT_NAME || item.instrumentType,
          segment: item.SEM_SEGMENT || item.segment || '',
          exchId: item.SEM_EXM_EXCH_ID || item.exchId || seg.split('_')[0],
          lotSize: Number(item.SEM_LOT_UNITS || item.lotSize) || 1,
          tickSize: Number(item.SEM_TICK_SIZE || item.tickSize) || 0.05,
          expiryDate: item.SEM_EXPIRY_DATE || item.expiryDate,
          strikePrice: item.SEM_STRIKE_PRICE || item.strikePrice,
          optionType: item.SEM_OPTION_TYPE || item.optionType,
          isin: item.isin,
        });
      }
    } catch (err) {
      console.error(`[dhanhq] failed to fetch instruments for segment ${seg}`, err);
    }
  }
  if (all.length > 0) {
    cache = { ts: Date.now(), rows: all, byKey: buildIndex(all) };
    csvLoaded = false;
  }
  return all;
};

/**
 * Synchronous lookup against the in-memory cache. Returns null if cache
 * isn't populated yet. Prefer findInstrumentAsync() in code paths that may
 * run before the scrip master loads (e.g. ws sub on a fresh adapter boot).
 */
export const findInstrument = (symbol: string): DhanInstrument | null => {
  if (!cache) return null;
  const [seg, id] = symbol.split(':');
  if (seg && id) {
    const key = `${seg.toUpperCase()}:${id}`;
    const direct = cache.byKey.get(key);
    if (direct) return direct;

    // If id is not numeric (e.g., symbolName like NSE_EQ:SBIN)
    if (!/^\d+$/.test(id)) {
      const targetSeg = seg.toUpperCase();
      const targetIdNorm = id.toUpperCase().replace(/-EQ$/, '');
      const matches = cache.rows.filter(
        (r) =>
          r.exchangeSegment.toUpperCase() === targetSeg &&
          (r.symbolName.toUpperCase().replace(/-EQ$/, '') === targetIdNorm ||
           r.displayName.toUpperCase().replace(/-EQ$/, '') === targetIdNorm)
      );
      if (matches.length > 0) {
        return matches[0] ?? null;
      }
    }
  }

  const q = symbol.trim().toUpperCase();
  if (!q) return null;
  const qNorm = q.replace(/-EQ$/, '');

  const matches = cache.rows.filter(
    (r) =>
      r.symbolName.toUpperCase().replace(/-EQ$/, '') === qNorm ||
      r.displayName.toUpperCase().replace(/-EQ$/, '') === qNorm ||
      r.isin?.toUpperCase() === q
  );

  if (matches.length === 0) return null;

  // Prioritize segments: Index (IDX_I) -> Equity (NSE_EQ/BSE_EQ) -> Futures -> Options -> Others
  const getPriority = (r: DhanInstrument): number => {
    const s = r.exchangeSegment.toUpperCase();
    const type = r.instrumentType.toUpperCase();
    if (s === 'IDX_I') return 1;
    if (s === 'NSE_EQ' || s === 'BSE_EQ') return 2;
    if (type.startsWith('FUT') || type === 'FT') return 3;
    if (type.startsWith('OPT') || type === 'OP') return 4;
    return 5;
  };

  matches.sort((a, b) => getPriority(a) - getPriority(b));
  return matches[0] ?? null;
};

/**
 * Async lookup that auto-populates the cache on first miss. Use this from
 * provider stream methods to avoid silent null returns when the adapter
 * has just started and the scrip master hasn't loaded yet.
 */
export const findInstrumentAsync = async (symbol: string, scripMasterUrl?: string): Promise<DhanInstrument | null> => {
  const cached = findInstrument(symbol);
  if (cached) return cached;
  await loadInstruments(scripMasterUrl).catch(() => undefined);
  return findInstrument(symbol);
};

export const toSymbolRef = (providerId: string, ins: DhanInstrument): SymbolRef => ({
  provider: providerId,
  symbol: `${ins.exchangeSegment}:${ins.securityId}`,
  label: ins.displayName || ins.symbolName,
  segment: segmentLabelFor(ins.instrumentType),
});

export const toInstrumentMeta = (providerId: string, ins: DhanInstrument): InstrumentMeta => ({
  ...toSymbolRef(providerId, ins),
  precision: { tickSize: ins.tickSize, stepSize: 1, minQty: ins.lotSize },
  exchangeId: ins.securityId,
  contractType: ins.instrumentType,
  expiry: ins.expiryDate ? Date.parse(ins.expiryDate) : undefined,
  intervals: ['1', '5', '15', '25', '60', '1D'],
});

export const searchInstruments = (rows: DhanInstrument[], query: string, limit: number): DhanInstrument[] => {
  const q = query.trim().toUpperCase();
  if (!q) return rows.slice(0, limit);
  const qNorm = q.replace(/-EQ$/, '');
  
  // Two-pass search: first collect high-priority segments (Equity/Index),
  // then fill remaining slots with others (FNO/Commodity).
  const highPriority: DhanInstrument[] = [];
  const lowPriority: DhanInstrument[] = [];

  for (const r of rows) {
    const rSymbolNorm = r.symbolName.toUpperCase().replace(/-EQ$/, '');
    const isExactSymbol = rSymbolNorm === qNorm;
    
    const rDisplayNorm = r.displayName.toUpperCase().replace(/-EQ$/, '');
    const hay = `${rSymbolNorm} ${rDisplayNorm} ${r.exchangeSegment}`.toUpperCase();
    
    if (hay.includes(qNorm)) {
      const seg = r.exchangeSegment;
      const type = r.instrumentType.toUpperCase();
      // Only prioritize true Equity and Indices
      const isHigh = (seg === 'NSE_EQ' || seg === 'BSE_EQ' || seg === 'IDX_I') && 
                     (type === 'EQUITY' || type === 'EQ' || type === 'INDEX' || type === 'IDX');
      
      if (isHigh || isExactSymbol) {
        highPriority.push(r);
      } else {
        // Collect a limited amount of low priority to avoid massive memory usage
        // but enough to give the gateway something to rank.
        if (lowPriority.length < limit * 3) {
          lowPriority.push(r);
        }
      }
    }
    
    // If we have enough high priority, we can potentially stop early,
    // but usually we want to see all equity matches.
    if (highPriority.length > limit * 2) break;
  }

  // Combine and truncate
  const combined = [...highPriority, ...lowPriority];
  return combined.slice(0, limit);
};
