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
    this.isSleeping = false;
    this.renderFramesRequested = 2; // at least kick off a few frames
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

    if (this.renderFramesRequested > 0) {
      this.renderFramesRequested--;
      this.animationFrameId = requestAnimationFrame(this.tick);
    } else {
      this.isSleeping = true;
      this.animationFrameId = null;
    }
  };

  private isSleeping = false;
  private renderFramesRequested = 0;

  /**
   * Wakes up the scheduler to render the specified number of frames.
   * Useful when something changes but continuous animation isn't needed.
   */
  public requestRender(frames: number = 2) {
    this.renderFramesRequested = Math.max(this.renderFramesRequested, frames);
    if (this.isSleeping && this.isRunning) {
      this.isSleeping = false;
      this.animationFrameId = requestAnimationFrame(this.tick);
    }
  }

  /**
   * Forces the scheduler to run continuously until suspended.
   */
  public requestContinuousRender() {
    this.renderFramesRequested = 9999999;
    if (this.isSleeping && this.isRunning) {
      this.isSleeping = false;
      this.animationFrameId = requestAnimationFrame(this.tick);
    }
  }

  public suspendContinuousRender() {
    this.renderFramesRequested = 0;
  }
}
