import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesAttachedParameter,
  PrimitivePaneViewZOrder,
} from 'lightweight-charts';

interface Point { x: number; y: number }

function catmullRomToBezier(pts: Point[]): void {
  // no-op for <2 points (handled in draw)
}

function drawCatmullRom(ctx: CanvasRenderingContext2D, pts: Point[]): void {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1]!.x, pts[1]!.y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    // Control points derived from Catmull-Rom tangent
    const cp1x = p1.x - (p2.x - p0.x) / 6;
    const cp1y = p1.y - (p2.y - p0.y) / 6;
    const cp2x = p1.x + (p2.x - p0.x) / 6;
    const cp2y = p1.y + (p2.y - p0.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p1.x, p1.y);
  }
  ctx.lineTo(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y);
}

class SmoothLineRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(
    private readonly points: Point[],
    private readonly color: string,
    private readonly lineWidth: number,
  ) {}

  draw(target: { context: CanvasRenderingContext2D; mediaSize: { width: number; height: number } }): void {
    const ctx = target.context;
    if (this.points.length < 2) return;
    ctx.save();
    ctx.beginPath();
    drawCatmullRom(ctx, this.points);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.lineWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }
}

class SmoothLinePaneView implements ISeriesPrimitivePaneView {
  private points: Point[] = [];

  constructor(
    private readonly color: string,
    private readonly lineWidth: number,
  ) {}

  update(points: Point[]): void {
    this.points = points;
  }

  zOrder(): PrimitivePaneViewZOrder { return 'normal'; }

  renderer(): ISeriesPrimitivePaneRenderer {
    return new SmoothLineRenderer(this.points, this.color, this.lineWidth);
  }
}

export interface SmoothLineOptions {
  color?: string;
  lineWidth?: number;
}

/**
 * ISeriesPrimitive that replaces the series' default straight-segment
 * polyline with a Catmull-Rom spline rendered via bezierCurveTo.
 * Attach with series.attachPrimitive(new SmoothLinePrimitive()).
 */
export class SmoothLinePrimitive implements ISeriesPrimitive {
  private view: SmoothLinePaneView;
  private attachedParams: SeriesAttachedParameter<'Line'> | null = null;

  constructor(opts: SmoothLineOptions = {}) {
    this.view = new SmoothLinePaneView(opts.color ?? '#2196F3', opts.lineWidth ?? 2);
  }

  attached(params: SeriesAttachedParameter<'Line'>): void {
    this.attachedParams = params;
  }

  detached(): void {
    this.attachedParams = null;
  }

  paneViews(): ISeriesPrimitivePaneView[] {
    return [this.view];
  }

  updateAllViews(): void {
    if (!this.attachedParams) return;
    const series = this.attachedParams.series;
    const chart = this.attachedParams.chart;
    const ts = chart.timeScale();
    const ps = series.priceScale();

    const data = series.data() as Array<{ time: unknown; value: number }>;
    const logicalRange = ts.getVisibleLogicalRange();
    if (!logicalRange) { this.view.update([]); return; }

    const pts: Point[] = [];
    for (const bar of data) {
      const coord = ts.logicalToCoordinate(ts.timeToCoordinate(bar.time as never) as unknown as number);
      const x = ts.timeToCoordinate(bar.time as never);
      const y = ps.priceToCoordinate(bar.value);
      if (x === null || y === null) continue;
      pts.push({ x: x as number, y: y as number });
    }
    this.view.update(pts);
  }
}
