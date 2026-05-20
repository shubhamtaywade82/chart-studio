/**
 * Smoothly interpolates between real tick prices using micro-step quantization.
 * Each real tick triggers an animation toward the new price; subsequent ticks
 * restart the animation from the current interpolated position so there are no
 * jumps. Calls onUpdate on every rAF frame with the current interpolated price.
 */
export class SmoothPriceAnimator {
  private current = 0;
  private target = 0;
  private frameId: number | null = null;
  private startPrice = 0;
  private startTime = 0;

  constructor(
    private tickSize: number,
    private readonly onUpdate: (price: number) => void,
    private readonly durationMs = 250,
  ) {}

  setTickSize(tickSize: number): void {
    this.tickSize = tickSize;
  }

  /** Drive the animator toward a new real-tick price. */
  snapTo(price: number): void {
    if (this.current === 0) {
      this.current = price;
      this.target = price;
      this.onUpdate(price);
      return;
    }
    // Optimization: if we're already animating toward this price, don't reset
    // the timer, just let it continue.
    if (price === this.target && this.frameId !== null) {
      return;
    }

    // Restart from current animated position so in-flight animations don't jump.
    this.startPrice = this.current;
    this.startTime = performance.now();
    this.target = price;
    if (this.frameId === null) {
      this.frameId = requestAnimationFrame(this.step);
    }
  }

  /** Cancel any running animation and snap immediately to target. Returns settled price. */
  flush(): number {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.current = this.target;
    if (this.target !== 0) this.onUpdate(this.target);
    return this.target;
  }

  /** Cancel any running animation and reset state without triggering updates. */
  reset(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.current = 0;
    this.target = 0;
    this.startPrice = 0;
    this.startTime = 0;
  }

  getPrice(): number {
    return this.current;
  }

  private step = (now: number): void => {
    const elapsed = now - this.startTime;
    const t = Math.min(elapsed / this.durationMs, 1);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic

    const raw = this.startPrice + (this.target - this.startPrice) * eased;

    // Quantize to sub-tick grid (tickSize / 100 micro-steps); fall back to raw
    // interpolation when tickSize is unknown.
    const micro = this.tickSize > 0 ? this.tickSize / 100 : 0;
    const quantized = micro > 0 ? Math.round(raw / micro) * micro : raw;
    const clamped = this.target >= this.startPrice
      ? Math.min(quantized, this.target)
      : Math.max(quantized, this.target);

    this.current = clamped;
    this.onUpdate(clamped);

    if (t < 1) {
      this.frameId = requestAnimationFrame(this.step);
    } else {
      this.current = this.target;
      this.onUpdate(this.target);
      this.frameId = null;
    }
  };
}
