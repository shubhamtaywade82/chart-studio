import type { CandleTheme } from '../candle-themes';
import type { Candle } from '../../provider-client';
// Crosshair type will be defined later
import type { LogicalRange } from 'lightweight-charts';

export type EventCallback<T> = (payload: T) => void;

/**
 * A strictly typed EventBus for decoupled communication across
 * the ChartEngine, plugins, overlays, and data streams.
 */
export class EventBus {
  private listeners: Record<string, Set<EventCallback<any>>> = {};

  private on<T>(event: string, callback: EventCallback<T>): () => void {
    if (!this.listeners[event]) this.listeners[event] = new Set();
    this.listeners[event].add(callback);
    return () => this.listeners[event]?.delete(callback);
  }

  private emit<T>(event: string, payload: T): void {
    if (!this.listeners[event]) return;
    for (const fn of this.listeners[event]) {
      try { fn(payload); } catch (e) { console.error(`[EventBus] Error in ${event} listener:`, e); }
    }
  }

  // --- Strongly Typed Publishers & Subscribers ---

  // Market Data
  public emitTick(payload: { price: number; timestampMs?: number; qty?: number }) { this.emit('tick', payload); }
  public onTick(cb: EventCallback<{ price: number; timestampMs?: number; qty?: number }>) { return this.on('tick', cb); }

  public emitCandle(payload: Candle) { this.emit('candle', payload); }
  public onCandle(cb: EventCallback<Candle>) { return this.on('candle', cb); }

  // Chart Layout & State
  public emitVisibleRangeChanged(payload: { range: LogicalRange | null; candleWidth: number }) { this.emit('visibleRange', payload); }
  public onVisibleRangeChanged(cb: EventCallback<{ range: LogicalRange | null; candleWidth: number }>) { return this.on('visibleRange', cb); }

  public emitLiveStateChanged(atLive: boolean) { this.emit('liveState', atLive); }
  public onLiveStateChanged(cb: EventCallback<boolean>) { return this.on('liveState', cb); }

  // User Interaction
  public emitCrosshairMove(payload: any) { this.emit('crosshair', payload); }
  public onCrosshairMove(cb: EventCallback<any>) { return this.on('crosshair', cb); }

  // Global Config
  public emitThemeChanged(theme: CandleTheme) { this.emit('theme', theme); }
  public onThemeChanged(cb: EventCallback<CandleTheme>) { return this.on('theme', cb); }
}
