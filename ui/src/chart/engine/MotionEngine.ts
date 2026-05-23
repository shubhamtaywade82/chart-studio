export class MotionEngine {
  private current: number | null = null;
  private target: number | null = null;
  private smoothingFactor: number;
  private lastTime: number = 0;

  /**
   * @param smoothingFactor - The factor by which to close the gap between current and target per frame (e.g. 0.1 for smooth, 1.0 for instant).
   */
  constructor(smoothingFactor: number = 0.01) {
    this.smoothingFactor = smoothingFactor;
  }

  public setTarget(value: number) {
    if (this.current === null) {
      this.current = value;
    }
    this.target = value;
  }

  public getCurrent(): number | null {
    return this.current;
  }

  public getTarget(): number | null {
    return this.target;
  }

  public update(time: number): number | null {
    if (this.current === null || this.target === null) {
      this.lastTime = time;
      return this.current;
    }

    // Delta time could be used for frame-independent smoothing, but for simplicity
    // we use a fixed multiplier since we aim for 60fps.
    // To make it frame-independent:
    // const dt = time - this.lastTime;
    // const factor = 1 - Math.exp(-this.smoothingFactor * dt / 16.66);
    // this.current += (this.target - this.current) * factor;

    const diff = this.target - this.current;

    if (Math.abs(diff) < 0.001) {
      this.current = this.target;
    } else {
      this.current += diff * this.smoothingFactor;
    }

    this.lastTime = time;
    return this.current;
  }

  public reset() {
    this.current = null;
    this.target = null;
  }
}
