import type { MicrostructureSnapshot } from './types';

/**
 * Holds rolling state per-symbol to compute deltas correctly from cumulative
 * Dhan packet fields. One DerivedState per symbol.
 */
export class DerivedState {
  private lastBuyQty = 0;
  private lastSellQty = 0;
  private buyInit = false;
  private cvd = 0;
  private tickTimes: number[] = [];

  /** Reset on instrument switch or end-of-session. */
  reset(): void {
    this.lastBuyQty = 0;
    this.lastSellQty = 0;
    this.buyInit = false;
    this.cvd = 0;
    this.tickTimes = [];
  }

  computeDerived(tick: MicrostructureSnapshot['tick'], candles: MicrostructureSnapshot['candles']): MicrostructureSnapshot['derived'] {
    // CVD: track per-tick delta of cumulative buy/sell qty.
    if (!this.buyInit) {
      this.lastBuyQty = tick.totalBuyQty;
      this.lastSellQty = tick.totalSellQty;
      this.buyInit = true;
    } else {
      const buyDelta = Math.max(0, tick.totalBuyQty - this.lastBuyQty);
      const sellDelta = Math.max(0, tick.totalSellQty - this.lastSellQty);
      this.cvd += buyDelta - sellDelta;
      this.lastBuyQty = tick.totalBuyQty;
      this.lastSellQty = tick.totalSellQty;
    }

    const vwapDeviation = tick.atp > 0 ? (tick.ltp - tick.atp) / tick.atp : 0;
    const oiChange = tick.openInterest && tick.prevOi
      ? tick.openInterest - tick.prevOi
      : 0;

    const bidQty = tick.bids.reduce((a, b) => a + b.qty, 0);
    const askQty = tick.asks.reduce((a, b) => a + b.qty, 0);
    const depthImbalance = (bidQty + askQty) > 0 ? (bidQty - askQty) / (bidQty + askQty) : 0;

    // Trade intensity over a 10-second window.
    const now = Date.now();
    this.tickTimes.push(now);
    while (this.tickTimes.length > 0 && this.tickTimes[0]! < now - 10_000) this.tickTimes.shift();
    const windowSec = this.tickTimes.length > 0
      ? Math.max(1, (now - this.tickTimes[0]!) / 1000)
      : 1;
    const tradeIntensity = this.tickTimes.length / windowSec;

    // Volatility regime: normalized true-range over last 20 candles.
    const volatilityRegime = classifyVolatility(candles);

    // Toxicity (VPIN-style): sign-adjusted CVD scaled by volume, dampened
    // by depth quality. Clamped to [0, 1].
    let toxicity = 0;
    if (tick.volume > 0) {
      const intensity = Math.abs(this.cvd) / (tick.volume + 1);
      const depthQuality = Math.max(0, 1 - Math.abs(depthImbalance));
      toxicity = Math.min(1, Math.sqrt(intensity * (1 - depthQuality)));
    }

    return {
      vwapDeviation,
      cvd: this.cvd,
      oiChange,
      depthImbalance,
      tradeIntensity,
      volatilityRegime,
      toxicity,
    };
  }
}

function classifyVolatility(candles: MicrostructureSnapshot['candles']): 'low' | 'normal' | 'high' | 'extreme' {
  if (candles.length < 5) return 'normal';
  const ranges = candles.slice(-20).map((c) => c.high - c.low);
  const sorted = [...ranges].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median === 0) return 'normal';
  const last = ranges[ranges.length - 1]!;
  const ratio = last / median;
  if (ratio < 0.5) return 'low';
  if (ratio < 1.5) return 'normal';
  if (ratio < 3) return 'high';
  return 'extreme';
}
