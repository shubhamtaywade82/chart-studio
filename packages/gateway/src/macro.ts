import yahooFinance from 'yahoo-finance2';

export interface MacroSnapshot {
  spxChange: number;
  ndxChange: number;
  vix: number;
  usdinr: number;
  brent: number;
  yield10y: number;
  ts: number;
}

/**
 * Fetches real-time global macro data using Yahoo Finance.
 */
export async function fetchMacroSnapshot(): Promise<MacroSnapshot | null> {
  try {
    const symbols = ['^GSPC', '^IXIC', '^VIX', 'USDINR=X', 'BZ=F', '^TNX'];
    const results = await yahooFinance.quote(symbols) as any[];

    const find = (symbol: string) => results.find((r: any) => r.symbol === symbol);

    const spx = find('^GSPC');
    const ndx = find('^IXIC');
    const vix = find('^VIX');
    const usdinr = find('USDINR=X');
    const brent = find('BZ=F');
    const tnx = find('^TNX');

    return {
      spxChange: spx?.regularMarketChangePercent ?? 0,
      ndxChange: ndx?.regularMarketChangePercent ?? 0,
      vix: vix?.regularMarketPrice ?? 0,
      usdinr: usdinr?.regularMarketPrice ?? 0,
      brent: brent?.regularMarketPrice ?? 0,
      yield10y: tnx?.regularMarketPrice ?? 0,
      ts: Date.now(),
    };
  } catch (err) {
    console.error('[gateway/macro] failed to fetch macro data', err);
    return null;
  }
}
