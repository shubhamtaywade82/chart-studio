import type { ChartView } from '../chart';

/**
 * Drawing toolbar wrapper over klinecharts overlays. Selecting a tool
 * sets klinecharts into "draw mode" for that overlay type — the next
 * click on the chart creates the overlay. We rely on klinecharts'
 * own overlay store; persistence per (provider, symbol) is shallow
 * (we just remember which type, not the points — klinecharts handles
 * geometry, persistence across symbol-switches is intentionally
 * dropped for simplicity).
 */

export type DrawingTool =
  | 'cursor'
  | 'horizontalStraightLine'
  | 'verticalStraightLine'
  | 'priceLine'
  | 'segment'
  | 'rayLine'
  | 'straightLine'
  | 'parallelStraightLine'
  | 'rectangle'
  | 'fibonacciLine'
  | 'priceChannelLine';

export class DrawingLayer {
  private tool: DrawingTool = 'cursor';
  private toolListeners = new Set<(t: DrawingTool) => void>();

  constructor(private readonly chart: ChartView, _container: HTMLElement) {}

  setTool(tool: DrawingTool): void {
    this.tool = tool;
    if (tool === 'cursor') {
      // No-op: klinecharts auto-exits draw mode after one overlay is placed.
    } else {
      // Create the overlay in draw-pending state: passing no points puts
      // klinecharts into draw mode for that type.
      this.chart.createOverlay({ name: tool });
    }
    for (const fn of this.toolListeners) fn(tool);
  }

  currentTool(): DrawingTool { return this.tool; }

  onToolChange(fn: (t: DrawingTool) => void): () => void {
    this.toolListeners.add(fn);
    return () => { this.toolListeners.delete(fn); };
  }

  setSymbol(_provider: string, _symbol: string): void {
    // klinecharts overlays are tied to the chart instance, not per-symbol.
    // Clear when symbol changes so we don't carry hand-drawn lines across.
    this.chart.removeAllOverlays();
  }

  clear(): void { this.chart.removeAllOverlays(); }
}
