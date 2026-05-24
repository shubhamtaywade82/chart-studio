import type { Candle } from '../../provider-client';

/**
 * Runtime timeframe aggregation: takes a base-interval candle array and
 * re-aggregates it into any higher multiple without refetching.
 *
 * Usage:
 *   const agg = new TimeframeAggregator(60_000); // 1m base
 *   agg.load(oneMCandles);
 *   const fiveMin    = agg.get(5 * 60_000);
 *   const fifteenMin = agg.get(15 * 60_000);
 */
export class TimeframeAggregator {
  private baseCandles: Candle[] = [];
  private readonly baseIntervalMs: number;
  private readonly cache = new Map<number, Candle[]>();

  constructor(baseIntervalMs: number) {
    this.baseIntervalMs = baseIntervalMs;
  }

  /** Replace the base candle set and invalidate aggregation cache. */
  load(candles: Candle[]): void {
    this.baseCandles = [...candles].sort((a, b) => a.openTime - b.openTime);
    this.cache.clear();
  }

  /**
   * Push a live base-interval candle update.
   * Invalidates the aggregation cache so next get() recomputes.
   */
  pushCandle(candle: Candle): void {
    const last = this.baseCandles[this.baseCandles.length - 1];
    if (last && last.openTime === candle.openTime) {
      this.baseCandles[this.baseCandles.length - 1] = candle;
    } else if (!last || candle.openTime > last.openTime) {
      this.baseCandles.push(candle);
    }
    this.cache.clear();
  }

  /**
   * Return aggregated candles for the given interval in milliseconds.
   * Results are memoized until the next pushCandle/load call.
   */
  get(targetIntervalMs: number): Candle[] {
    if (targetIntervalMs <= this.baseIntervalMs) return this.baseCandles;
    const cached = this.cache.get(targetIntervalMs);
    if (cached) return cached;
    const result = aggregate(this.baseCandles, targetIntervalMs);
    this.cache.set(targetIntervalMs, result);
    return result;
  }

  /** Common higher-timeframe multiples expressed in ms. */
  availableIntervals(): number[] {
    return [1, 3, 5, 15, 60, 240, 1440].map(m => m * this.baseIntervalMs);
  }

  get baseInterval(): number { return this.baseIntervalMs; }
}

function aggregate(candles: Candle[], intervalMs: number): Candle[] {
  if (candles.length === 0) return [];
  const result: Candle[] = [];
  let current: Candle | null = null;

  for (const c of candles) {
    const barOpen = Math.floor(c.openTime / intervalMs) * intervalMs;
    if (!current || barOpen !== current.openTime) {
      if (current) result.push(current);
      current = { ...c, openTime: barOpen };
    } else {
      current.high   = Math.max(current.high, c.high);
      current.low    = Math.min(current.low,  c.low);
      current.close  = c.close;
      current.volume = current.volume + c.volume;
      if (c.closeTime !== undefined) current.closeTime = c.closeTime;
    }
  }
  if (current) result.push(current);
  return result;
}
