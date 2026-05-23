import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesAttachedParameter,
  PrimitivePaneViewZOrder,
} from 'lightweight-charts';

export interface FootprintBar {
  openTime: number;
  /** Accumulated buy volume at this price level */
  bidVolume: number;
  /** Accumulated sell volume at this price level */
  askVolume: number;
}

export interface FootprintData {
  /** Map from openTime (ms) → bid/ask breakdown */
  bars: Map<number, FootprintBar>;
}

interface RenderPoint {
  x: number;
  yOpen: number;
  yClose: number;
  barWidthPx: number;
  bidVol: number;
  askVol: number;
  maxVol: number;
}

class FootprintRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(private readonly rp: RenderPoint[]) {}

  draw(target: { context: CanvasRenderingContext2D }): void {
    const ctx = target.context;
    ctx.save();
    ctx.font = '9px monospace';
    ctx.textBaseline = 'middle';

    for (const p of this.rp) {
      if (p.maxVol === 0) continue;
      const barH = Math.abs(p.yClose - p.yOpen);
      const midY = (p.yOpen + p.yClose) / 2;
      const half = p.barWidthPx / 2;

      // Buy bar (right half, green)
      const askW = (p.askVol / p.maxVol) * half;
      ctx.fillStyle = 'rgba(76,175,80,0.35)';
      ctx.fillRect(p.x, p.yOpen, askW, barH);

      // Sell bar (left half, red)
      const bidW = (p.bidVol / p.maxVol) * half;
      ctx.fillStyle = 'rgba(244,67,54,0.35)';
      ctx.fillRect(p.x - bidW, p.yOpen, bidW, barH);

      // Delta label
      const delta = p.askVol - p.bidVol;
      ctx.fillStyle = delta >= 0 ? '#4CAF50' : '#F44336';
      ctx.textAlign = 'center';
      ctx.fillText(fmtVol(Math.abs(delta)), p.x, midY);
    }
    ctx.restore();
  }
}

class FootprintPaneView implements ISeriesPrimitivePaneView {
  private points: RenderPoint[] = [];

  update(points: RenderPoint[]): void { this.points = points; }
  zOrder(): PrimitivePaneViewZOrder { return 'normal'; }
  renderer(): ISeriesPrimitivePaneRenderer { return new FootprintRenderer(this.points); }
}

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

/**
 * Footprint chart primitive: renders per-candle bid/ask volume breakdown
 * as colored half-bars with delta text overlay.
 *
 * Usage:
 *   const fp = new FootprintPrimitive();
 *   candleSeries.attachPrimitive(fp);
 *   fp.setData(footprintData);
 */
export class FootprintPrimitive implements ISeriesPrimitive {
  private view = new FootprintPaneView();
  private data: FootprintData = { bars: new Map() };
  private attachedParams: SeriesAttachedParameter<'Candlestick'> | null = null;

  setData(data: FootprintData): void {
    this.data = data;
    this.updateAllViews();
  }

  /** Accumulate a trade: side 'buy' or 'sell', at candle openTime. */
  addTrade(openTime: number, side: 'buy' | 'sell', volume: number): void {
    let bar = this.data.bars.get(openTime);
    if (!bar) {
      bar = { openTime, bidVolume: 0, askVolume: 0 };
      this.data.bars.set(openTime, bar);
    }
    if (side === 'buy') bar.askVolume += volume;
    else bar.bidVolume += volume;
  }

  attached(params: SeriesAttachedParameter<'Candlestick'>): void {
    this.attachedParams = params;
  }

  detached(): void { this.attachedParams = null; }

  paneViews(): ISeriesPrimitivePaneView[] { return [this.view]; }

  updateAllViews(): void {
    if (!this.attachedParams) return;
    const series = this.attachedParams.series;
    const chart = this.attachedParams.chart;
    const ts = chart.timeScale();
    const ps = series.priceScale();

    const barData = series.data() as Array<{ time: unknown; open: number; close: number }>;
    const points: RenderPoint[] = [];

    let maxVol = 0;
    for (const [, fb] of this.data.bars) {
      maxVol = Math.max(maxVol, fb.bidVolume, fb.askVolume);
    }

    const logRange = ts.getVisibleLogicalRange();
    if (!logRange) { this.view.update([]); return; }

    // Estimate bar width from spacing between consecutive visible bars
    const barCount = Math.max(1, logRange.to - logRange.from);
    const chartW = (chart as unknown as { chartElement(): HTMLElement }).chartElement?.()?.clientWidth ?? 800;
    const barWidthPx = (chartW / barCount) * 0.8;

    for (const bar of barData) {
      const x = ts.timeToCoordinate(bar.time as never);
      const yOpen = ps.priceToCoordinate(bar.open);
      const yClose = ps.priceToCoordinate(bar.close);
      if (x === null || yOpen === null || yClose === null) continue;

      const openTimeMs = (bar.time as number) * 1000;
      const fb = this.data.bars.get(openTimeMs);
      if (!fb) continue;

      points.push({
        x: x as number,
        yOpen: Math.min(yOpen as number, yClose as number),
        yClose: Math.max(yOpen as number, yClose as number),
        barWidthPx,
        bidVol: fb.bidVolume,
        askVol: fb.askVolume,
        maxVol,
      });
    }
    this.view.update(points);
  }
}
