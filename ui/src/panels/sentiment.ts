import type { Trade } from '../provider-client';

/**
 * Rolling order-flow imbalance over the last N seconds.
 */
export class SentimentPanel {
  private readonly windowMs = 60_000;
  private trades: Trade[] = [];
  private buySum = 0;
  private sellSum = 0;
  private renderRequested = false;

  constructor(private readonly root: HTMLElement) {
    this.renderSync(0.5, 0, 0);
  }

  push(t: Trade): void {
    // 1. Add new trade and update running sums
    this.trades.push(t);
    if (t.makerSide) {
      this.sellSum += t.qty;
    } else {
      this.buySum += t.qty;
    }

    // 2. Remove expired trades and subtract from running sums
    const cutoff = t.ts - this.windowMs; // Use trade timestamp for reliability
    while (this.trades.length > 0 && this.trades[0]!.ts < cutoff) {
      const expired = this.trades.shift()!;
      if (expired.makerSide) {
        this.sellSum -= expired.qty;
      } else {
        this.buySum -= expired.qty;
      }
    }

    // 3. Prevent floating-point drift below zero
    if (this.buySum < 0.0001) this.buySum = 0;
    if (this.sellSum < 0.0001) this.sellSum = 0;

    // 4. Request throttled render via requestAnimationFrame
    this.requestRender();
  }

  reset(): void {
    this.trades = [];
    this.buySum = 0;
    this.sellSum = 0;
    this.renderSync(0.5, 0, 0);
  }

  private requestRender(): void {
    if (this.renderRequested) return;
    this.renderRequested = true;
    requestAnimationFrame(() => {
      this.renderRequested = false;
      const total = this.buySum + this.sellSum;
      const ratio = total > 0 ? this.buySum / total : 0.5;
      this.renderSync(ratio, this.buySum, this.sellSum);
    });
  }

  private renderSync(ratio: number, buy: number, sell: number): void {
    const left = Math.max(0, 0.5 - ratio) * 100; // sell pushes left of midpoint
    const right = Math.max(0, ratio - 0.5) * 100;
    this.root.innerHTML = `
      <div class="label"><span>Sell ${sell.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span><span>${(ratio * 100).toFixed(1)}%</span><span>Buy ${buy.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
      <div class="bar">
        <div class="fill sell" style="left: ${50 - left}%; width: ${left}%;"></div>
        <div class="fill buy" style="left: 50%; width: ${right}%;"></div>
      </div>
    `;
  }
}

