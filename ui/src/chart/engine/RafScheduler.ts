type RafCallback = (time: number) => void;

export class RafScheduler {
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;
  private callbacks: Set<RafCallback> = new Set();

  public subscribe(callback: RafCallback) {
    this.callbacks.add(callback);
    if (!this.isRunning && this.callbacks.size > 0) {
      this.start();
    }
  }

  public unsubscribe(callback: RafCallback) {
    this.callbacks.delete(callback);
    if (this.callbacks.size === 0) {
      this.stop();
    }
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.tick(performance.now());
  }

  public stop() {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private tick = (time: number) => {
    if (!this.isRunning) return;

    for (const callback of this.callbacks) {
      try {
        callback(time);
      } catch (error) {
        console.error("Error in RAF callback:", error);
      }
    }

    this.animationFrameId = requestAnimationFrame(this.tick);
  };
}
