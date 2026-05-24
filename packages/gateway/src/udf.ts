import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import type { RedisBridge } from './redis-bridge';

/**
 * TradingView Universal Data Feed (UDF) endpoint handlers.
 *
 * Symbol format expected by callers: "provider:SYMBOL"
 *   e.g. "dhanhq:NSE_EQ:11536" or "binance:BTCUSDT"
 *
 * Spec: https://www.tradingview.com/charting-library-docs/latest/connecting_data/UDF/
 */

const RESOLUTION_TO_INTERVAL: Record<string, string> = {
  '1':   '1m',
  '3':   '3m',
  '5':   '5m',
  '10':  '10m',
  '15':  '15m',
  '30':  '30m',
  '60':  '1h',
  '120': '2h',
  '240': '4h',
  'D':   '1d',
  'W':   '1w',
  'M':   '1M',
};

const resolutionToInterval = (r: string): string => RESOLUTION_TO_INTERVAL[r] ?? '1m';

export const UDF_CONFIG = {
  supported_resolutions: ['1', '3', '5', '15', '30', '60', '120', '240', 'D', 'W'],
  supports_search: true,
  supports_group_request: false,
  supports_marks: false,
  supports_timescale_marks: false,
  supports_time: true,
  exchanges: [
    { value: '', name: 'All', desc: '' },
    { value: 'NSE',     name: 'NSE',     desc: 'National Stock Exchange of India' },
    { value: 'BSE',     name: 'BSE',     desc: 'Bombay Stock Exchange' },
    { value: 'MCX',     name: 'MCX',     desc: 'Multi Commodity Exchange' },
    { value: 'BINANCE', name: 'Binance', desc: 'Binance' },
  ],
  symbols_types: [
    { value: '',        name: 'All types' },
    { value: 'stock',   name: 'Stock'   },
    { value: 'futures', name: 'Futures' },
    { value: 'index',   name: 'Index'   },
    { value: 'crypto',  name: 'Crypto'  },
  ],
};

type CandleBar = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** GET /udf/config */
export const handleUdfConfig = (_req: IncomingMessage, res: ServerResponse): void => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(UDF_CONFIG));
};

/** GET /udf/time — returns current unix seconds */
export const handleUdfTime = (_req: IncomingMessage, res: ServerResponse): void => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(String(Math.floor(Date.now() / 1000)));
};

/** GET /udf/history?symbol=provider:SYM&resolution=1&from=&to=&countback= */
export const handleUdfHistory = async (
  bridge: RedisBridge,
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> => {
  const symbolParam = url.searchParams.get('symbol') ?? '';
  const resolution  = url.searchParams.get('resolution') ?? '1';
  const from        = Number(url.searchParams.get('from') ?? 0);
  const to          = Number(url.searchParams.get('to')   ?? Math.floor(Date.now() / 1000));
  const countback   = url.searchParams.get('countback');

  // Expect "provider:SYMBOL" — provider is everything before the first colon.
  const colonIdx = symbolParam.indexOf(':');
  if (colonIdx === -1) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ s: 'error', errmsg: 'symbol must be provider:SYMBOL format, e.g. dhanhq:NSE_EQ:11536' }));
    return;
  }

  const provider = symbolParam.slice(0, colonIdx);
  const symbol   = symbolParam.slice(colonIdx + 1);
  const interval = resolutionToInterval(resolution);
  const limit    = countback ? Math.min(5000, Number(countback)) : 1500;
  const endTime  = to * 1000; // UDF uses unix seconds; adapters use ms

  try {
    const bars = await bridge.discover<CandleBar[]>(
      provider, 'candles', { symbol, interval, endTime, limit }, 15_000,
    );

    if (!bars || bars.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ s: 'no_data' }));
      return;
    }

    // Filter by `from` if provided (UDF passes it as unix seconds).
    const fromMs   = from > 0 ? from * 1000 : 0;
    const filtered = fromMs > 0 ? bars.filter(b => b.openTime >= fromMs) : bars;

    if (filtered.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ s: 'no_data' }));
      return;
    }

    // UDF requires Structure-of-Arrays layout.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      s: 'ok',
      t: filtered.map(b => Math.floor(b.openTime / 1000)),
      o: filtered.map(b => b.open),
      h: filtered.map(b => b.high),
      l: filtered.map(b => b.low),
      c: filtered.map(b => b.close),
      v: filtered.map(b => b.volume),
    }));
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ s: 'error', errmsg: err instanceof Error ? err.message : String(err) }));
  }
};
