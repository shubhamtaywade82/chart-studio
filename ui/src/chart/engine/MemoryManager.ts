import type { Candle } from '../../provider-client';

export interface MemoryManagerOptions {
  maxCandles?: number;
  warnThresholdMb?: number;
}

/**
 * Manages memory usage for long trading sessions:
 * - Evicts oldest candles when the buffer exceeds maxCandles
 * - Monitors JS heap usage via performance.memory (Chrome only)
 */
export class MemoryManager {
  private readonly maxCandles: number;
  private readonly warnThresholdMb: number;
  private lastWarnedAt = 0;

  constructor(opts: MemoryManagerOptions = {}) {
    this.maxCandles = opts.maxCandles ?? 5000;
    this.warnThresholdMb = opts.warnThresholdMb ?? 400;
  }

  /**
   * Evict oldest candles if the array exceeds maxCandles.
   * Mutates the input array in-place and returns it.
   */
  evict(candles: Candle[]): Candle[] {
    const excess = candles.length - this.maxCandles;
    if (excess > 0) candles.splice(0, excess);
    return candles;
  }

  /** Trim a generic array to maxCandles without mutation. */
  trim<T>(arr: T[]): T[] {
    return arr.length > this.maxCandles ? arr.slice(-this.maxCandles) : arr;
  }

  /** How many candles would be evicted from the given length. */
  evictCount(length: number): number {
    return Math.max(0, length - this.maxCandles);
  }

  /**
   * Returns true when the JS heap is above the warn threshold.
   * Only meaningful in Chromium-based browsers where performance.memory exists.
   */
  isUnderPressure(): boolean {
    const mem = (performance as any).memory;
    if (!mem) return false;
    const usedMb: number = mem.usedJSHeapSize / 1_048_576;
    if (usedMb > this.warnThresholdMb) {
      const now = Date.now();
      if (now - this.lastWarnedAt > 30_000) {
        console.warn(`[MemoryManager] heap ${usedMb.toFixed(0)} MB (limit ${this.warnThresholdMb} MB)`);
        this.lastWarnedAt = now;
      }
      return true;
    }
    return false;
  }

  get limit(): number { return this.maxCandles; }
}
