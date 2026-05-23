import type { CandleTheme } from '../candle-themes';
import type { Candle } from '../../provider-client';
import type { LogicalRange } from 'lightweight-charts';

export type EventCallback<T> = (payload: T) => void;

export type DrawingKind = 'hline' | 'trendline' | 'fib' | 'rectangle' | 'ray';
export type ReplayState = 'idle' | 'playing' | 'paused' | 'ended';
export interface DrawingEvent { id: string; kind: DrawingKind }

/**
 * Strictly typed EventBus for decoupled communication across
 * ChartEngine, plugins, overlays, data streams, and the replay system.
 */
export class EventBus {
  private listeners: Record<string, Set<EventCallback<any>>> = {};

  private on<T>(event: string, callback: EventCallback<T>): () => void {
    if (!this.listeners[event]) this.listeners[event] = new Set();
    this.listeners[event]!.add(callback);
    return () => this.listeners[event]?.delete(callback);
  }

  private emit<T>(event: string, payload: T): void {
    const set = this.listeners[event];
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.error('[EventBus] ' + event + ':', e); }
    }
  }

  // ── Market data ──────────────────────────────────────────────────────
  public emitTick(p: { price: number; timestampMs?: number; qty?: number }) { this.emit('tick', p); }
  public onTick(cb: EventCallback<{ price: number; timestampMs?: number; qty?: number }>) { return this.on('tick', cb); }

  public emitCandle(c: Candle) { this.emit('candle', c); }
  public onCandle(cb: EventCallback<Candle>) { return this.on('candle', cb); }

  // ── Chart layout & state ─────────────────────────────────────────────
  public emitVisibleRangeChanged(p: { range: LogicalRange | null; candleWidth: number }) { this.emit('visibleRange', p); }
  public onVisibleRangeChanged(cb: EventCallback<{ range: LogicalRange | null; candleWidth: number }>) { return this.on('visibleRange', cb); }

  public emitLiveStateChanged(atLive: boolean) { this.emit('liveState', atLive); }
  public onLiveStateChanged(cb: EventCallback<boolean>) { return this.on('liveState', cb); }

  // ── User interaction ─────────────────────────────────────────────────
  public emitCrosshairMove(payload: any) { this.emit('crosshair', payload); }
  public onCrosshairMove(cb: EventCallback<any>) { return this.on('crosshair', cb); }

  // ── Global config ────────────────────────────────────────────────────
  public emitThemeChanged(theme: CandleTheme) { this.emit('theme', theme); }
  public onThemeChanged(cb: EventCallback<CandleTheme>) { return this.on('theme', cb); }

  // ── Symbol ───────────────────────────────────────────────────────────
  public emitSymbolChange(p: { provider: string; symbol: string; interval: string }) { this.emit('symbol.change', p); }
  public onSymbolChange(cb: EventCallback<{ provider: string; symbol: string; interval: string }>) { return this.on('symbol.change', cb); }

  // ── Drawing tools ────────────────────────────────────────────────────
  public emitToolSelect(tool: string) { this.emit('tool.select', tool); }
  public onToolSelect(cb: EventCallback<string>) { return this.on('tool.select', cb); }

  public emitDrawingCreate(d: DrawingEvent) { this.emit('drawing.create', d); }
  public onDrawingCreate(cb: EventCallback<DrawingEvent>) { return this.on('drawing.create', cb); }

  public emitDrawingUpdate(d: DrawingEvent) { this.emit('drawing.update', d); }
  public onDrawingUpdate(cb: EventCallback<DrawingEvent>) { return this.on('drawing.update', cb); }

  public emitDrawingRemove(id: string) { this.emit('drawing.remove', id); }
  public onDrawingRemove(cb: EventCallback<string>) { return this.on('drawing.remove', cb); }

  // ── Timeframe ────────────────────────────────────────────────────────
  public emitTimeframeChange(p: { interval: string; intervalMs: number }) { this.emit('timeframe.change', p); }
  public onTimeframeChange(cb: EventCallback<{ interval: string; intervalMs: number }>) { return this.on('timeframe.change', cb); }

  // ── Indicators ───────────────────────────────────────────────────────
  public emitIndicatorAdd(p: { id: string; defId: string; params: number[] }) { this.emit('indicator.add', p); }
  public onIndicatorAdd(cb: EventCallback<{ id: string; defId: string; params: number[] }>) { return this.on('indicator.add', cb); }

  public emitIndicatorRemove(id: string) { this.emit('indicator.remove', id); }
  public onIndicatorRemove(cb: EventCallback<string>) { return this.on('indicator.remove', cb); }

  // ── Replay ───────────────────────────────────────────────────────────
  public emitReplayTick(p: { candle: Candle; position: number; total: number }) { this.emit('replay.tick', p); }
  public onReplayTick(cb: EventCallback<{ candle: Candle; position: number; total: number }>) { return this.on('replay.tick', cb); }

  public emitReplayState(state: ReplayState) { this.emit('replay.state', state); }
  public onReplayState(cb: EventCallback<ReplayState>) { return this.on('replay.state', cb); }
}
