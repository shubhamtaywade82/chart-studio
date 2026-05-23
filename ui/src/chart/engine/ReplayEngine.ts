import type { Candle } from '../../provider-client';
import type { EventBus, ReplayState } from './EventBus';

export type ReplaySpeed = 0.25 | 0.5 | 1 | 2 | 5 | 10 | 50;

/**
 * Deterministic replay engine: replays a candle array bar-by-bar,
 * emitting events through the EventBus so the chart renders exactly
 * as it would during a live session.
 *
 * Usage:
 *   const replay = new ReplayEngine(chart.engine.bus);
 *   replay.load(historicCandles);
 *   replay.onTick((candle, pos) => chart.updateCandle(candle));
 *   replay.play(2); // 2× speed
 */
export class ReplayEngine {
  private candles: Candle[] = [];
  private position = 0;
  private playing = false;
  private speed: ReplaySpeed = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tickListeners = new Set<(candle: Candle, position: number) => void>();

  constructor(private readonly bus?: EventBus) {}

  // ── Setup ─────────────────────────────────────────────────────────────

  load(candles: Candle[]): void {
    this.stop();
    this.candles = [...candles].sort((a, b) => a.openTime - b.openTime);
    this.position = 0;
    this.bus?.emitReplayState('idle');
  }

  onTick(fn: (candle: Candle, position: number) => void): () => void {
    this.tickListeners.add(fn);
    return () => { this.tickListeners.delete(fn); };
  }

  // ── Playback control ──────────────────────────────────────────────────

  play(speed: ReplaySpeed = this.speed): void {
    if (this.position >= this.candles.length) return;
    this.speed = speed;
    this.playing = true;
    this.bus?.emitReplayState('playing');
    this.scheduleNext();
  }

  pause(): void {
    this.playing = false;
    this.clearTimer();
    this.bus?.emitReplayState('paused');
  }

  stop(): void {
    this.playing = false;
    this.clearTimer();
    this.position = 0;
    this.bus?.emitReplayState('idle');
  }

  setSpeed(speed: ReplaySpeed): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.speed = speed;
    if (wasPlaying) this.play(speed);
  }

  /** Step forward by `n` bars immediately (works in paused mode). */
  step(n = 1): void {
    for (let i = 0; i < n && this.position < this.candles.length; i++) {
      this.emitCurrent();
      this.position++;
    }
    if (this.position >= this.candles.length) {
      this.playing = false;
      this.bus?.emitReplayState('ended');
    }
  }

  seek(position: number): void {
    this.position = Math.max(0, Math.min(this.candles.length - 1, position));
  }

  // ── State ─────────────────────────────────────────────────────────────

  get total(): number { return this.candles.length; }
  get current(): number { return this.position; }
  get isPlaying(): boolean { return this.playing; }
  get progress(): number { return this.candles.length === 0 ? 0 : this.position / this.candles.length; }

  /** Candles visible up to (not including) current replay head. */
  visibleCandles(): Candle[] { return this.candles.slice(0, this.position); }
  currentCandle(): Candle | null { return this.candles[this.position] ?? null; }

  // ── Internal ──────────────────────────────────────────────────────────

  private emitCurrent(): void {
    const candle = this.candles[this.position];
    if (!candle) return;
    for (const fn of this.tickListeners) fn(candle, this.position);
    this.bus?.emitReplayTick({ candle, position: this.position, total: this.candles.length });
  }

  private scheduleNext(): void {
    if (!this.playing || this.position >= this.candles.length) {
      if (this.position >= this.candles.length) {
        this.playing = false;
        this.bus?.emitReplayState('ended');
      }
      return;
    }
    const curr = this.candles[this.position];
    const next = this.candles[this.position + 1];
    const barDeltaMs = next && curr ? next.openTime - curr.openTime : 1000;
    const delay = Math.max(16, barDeltaMs / this.speed);

    this.timer = setTimeout(() => {
      if (!this.playing) return;
      this.emitCurrent();
      this.position++;
      this.scheduleNext();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}
