import type { Candle } from '../../provider-client';

export interface DataEngineOptions {
  maxCandlesPerKey?: number;
  gatewayBase?: string;
}

interface UdfResponse {
  s: 'ok' | 'no_data' | 'error';
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
  errmsg?: string;
}

const INTERVAL_TO_RESOLUTION: Record<string, string> = {
  '1m': '1', '3m': '3', '5m': '5', '10m': '10', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '1d': 'D', '1w': 'W',
};

/**
 * Central data engine: owns the authoritative candle cache per
 * (provider, symbol, interval) key, handles REST backfill via the
 * gateway UDF endpoint, and merges live candles with history.
 *
 * All components that need candle data should go through DataEngine
 * instead of fetching independently.
 */
export class DataEngine {
  private readonly cache = new Map<string, Candle[]>();
  private readonly maxCandles: number;
  private readonly base: string;

  constructor(opts: DataEngineOptions = {}) {
    this.maxCandles = opts.maxCandlesPerKey ?? 5000;
    this.base = opts.gatewayBase?.replace(/\/$/, '') ?? '';
  }

  cacheKey(provider: string, symbol: string, interval: string): string {
    return `${provider}:${symbol}:${interval}`;
  }

  // ── REST fetch ───────────────────────────────────────────────────────

  /**
   * Fetch historical candles from the gateway /udf/history endpoint.
   * Returns an empty array on network or parse errors (never throws).
   */
  async fetchHistory(
    provider: string,
    symbol: string,
    interval: string,
    opts: { limit?: number; endTime?: number; startTime?: number } = {},
  ): Promise<Candle[]> {
    const resolution = INTERVAL_TO_RESOLUTION[interval] ?? '1';
    const to = Math.floor((opts.endTime ?? Date.now()) / 1000);
    const params = new URLSearchParams({
      symbol: `${provider}:${symbol}`,
      resolution,
      to: String(to),
      countback: String(opts.limit ?? 500),
    });
    if (opts.startTime) params.set('from', String(Math.floor(opts.startTime / 1000)));

    try {
      const res = await fetch(`${this.base}/udf/history?${params}`);
      if (!res.ok) return [];
      const data = await res.json() as UdfResponse;
      if (data.s !== 'ok' || !data.t?.length) return [];
      return data.t.map((ts, i) => ({
        openTime: ts * 1000,
        open:   data.o![i]!,
        high:   data.h![i]!,
        low:    data.l![i]!,
        close:  data.c![i]!,
        volume: data.v![i]!,
      }));
    } catch {
      return [];
    }
  }

  // ── Cache read/write ─────────────────────────────────────────────────

  get(provider: string, symbol: string, interval: string): Candle[] {
    return this.cache.get(this.cacheKey(provider, symbol, interval)) ?? [];
  }

  set(provider: string, symbol: string, interval: string, candles: Candle[]): void {
    const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
    this.cache.set(
      this.cacheKey(provider, symbol, interval),
      sorted.length > this.maxCandles ? sorted.slice(-this.maxCandles) : sorted,
    );
  }

  /**
   * Merge incoming candles (backfill or live snapshot) into the cache.
   * Deduplicates by openTime; incoming values override existing ones.
   * Returns the merged, sorted array.
   */
  merge(provider: string, symbol: string, interval: string, incoming: Candle[]): Candle[] {
    const map = new Map<number, Candle>();
    for (const c of this.get(provider, symbol, interval)) map.set(c.openTime, c);
    for (const c of incoming) map.set(c.openTime, c);
    const merged = [...map.values()].sort((a, b) => a.openTime - b.openTime);
    const trimmed = merged.length > this.maxCandles ? merged.slice(-this.maxCandles) : merged;
    this.cache.set(this.cacheKey(provider, symbol, interval), trimmed);
    return trimmed;
  }

  /** Apply a single live candle update to the cache. Returns the updated array. */
  updateCandle(provider: string, symbol: string, interval: string, candle: Candle): Candle[] {
    const key = this.cacheKey(provider, symbol, interval);
    const candles = this.get(provider, symbol, interval);
    const last = candles[candles.length - 1];
    if (last && last.openTime === candle.openTime) {
      candles[candles.length - 1] = candle;
    } else if (!last || candle.openTime > last.openTime) {
      candles.push(candle);
      if (candles.length > this.maxCandles) candles.shift();
    }
    this.cache.set(key, candles);
    return candles;
  }

  evict(provider: string, symbol: string, interval: string): void {
    this.cache.delete(this.cacheKey(provider, symbol, interval));
  }

  evictAll(): void {
    this.cache.clear();
  }
}
