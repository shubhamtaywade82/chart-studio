import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesAttachedParameter,
  PrimitivePaneViewZOrder,
} from 'lightweight-charts';
import type { Candle } from '../../provider-client';

export interface VolumeProfileOptions {
  /** Number of price levels to distribute volume across */
  levels?: number;
  /** Width of the profile as fraction of chart width (0–1) */
  widthFraction?: number;
  /** Color for bullish (close >= open) volume bars */
  upColor?: string;
  /** Color for bearish (close < open) volume bars */
  downColor?: string;
  /** Align profile to left or right edge */
  align?: 'left' | 'right';
}

interface ProfileBand {
  priceLow: number;
  priceHigh: number;
  upVol: number;
  downVol: number;
}

interface RenderBand {
  y1: number;
  y2: number;
  upW: number;
  downW: number;
}

class VolumeProfileRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(
    private readonly bands: RenderBand[],
    private readonly x0: number,
    private readonly upColor: string,
    private readonly downColor: string,
    private readonly align: 'left' | 'right',
  ) {}

  draw(target: { context: CanvasRenderingContext2D }): void {
    const ctx = target.context;
    ctx.save();
    ctx.globalAlpha = 0.7;

    for (const b of this.bands) {
      const y = Math.min(b.y1, b.y2);
      const h = Math.max(1, Math.abs(b.y2 - b.y1));
      const totalW = b.upW + b.downW;

      if (this.align === 'right') {
        // down vol on left part, up vol on right
        ctx.fillStyle = this.downColor;
        ctx.fillRect(this.x0 - totalW, y, b.downW, h);
        ctx.fillStyle = this.upColor;
        ctx.fillRect(this.x0 - totalW + b.downW, y, b.upW, h);
      } else {
        ctx.fillStyle = this.downColor;
        ctx.fillRect(this.x0, y, b.downW, h);
        ctx.fillStyle = this.upColor;
        ctx.fillRect(this.x0 + b.downW, y, b.upW, h);
      }
    }
    ctx.restore();
  }
}

class VolumeProfilePaneView implements ISeriesPrimitivePaneView {
  private bands: RenderBand[] = [];
  private x0 = 0;
  private opts: Required<VolumeProfileOptions>;

  constructor(opts: Required<VolumeProfileOptions>) { this.opts = opts; }

  update(bands: RenderBand[], x0: number): void { this.bands = bands; this.x0 = x0; }

  zOrder(): PrimitivePaneViewZOrder { return 'bottom'; }

  renderer(): ISeriesPrimitivePaneRenderer {
    return new VolumeProfileRenderer(
      this.bands,
      this.x0,
      this.opts.upColor,
      this.opts.downColor,
      this.opts.align,
    );
  }
}

/**
 * Volume Profile primitive: renders a horizontal volume histogram
 * at the left or right edge of the chart pane, showing where the
 * most volume traded across the visible price range.
 *
 * Usage:
 *   const vp = new VolumeProfilePrimitive();
 *   candleSeries.attachPrimitive(vp);
 *   vp.setCandles(candles); // call whenever data changes
 */
export class VolumeProfilePrimitive implements ISeriesPrimitive {
  private readonly resolvedOpts: Required<VolumeProfileOptions>;
  private view: VolumeProfilePaneView;
  private profile: ProfileBand[] = [];
  private attachedParams: SeriesAttachedParameter<'Candlestick'> | null = null;

  constructor(opts: VolumeProfileOptions = {}) {
    this.resolvedOpts = {
      levels: opts.levels ?? 48,
      widthFraction: opts.widthFraction ?? 0.12,
      upColor: opts.upColor ?? 'rgba(76,175,80,0.8)',
      downColor: opts.downColor ?? 'rgba(244,67,54,0.8)',
      align: opts.align ?? 'right',
    };
    this.view = new VolumeProfilePaneView(this.resolvedOpts);
  }

  setCandles(candles: Candle[]): void {
    this.profile = buildProfile(candles, this.resolvedOpts.levels);
    this.updateAllViews();
  }

  attached(params: SeriesAttachedParameter<'Candlestick'>): void {
    this.attachedParams = params;
  }

  detached(): void { this.attachedParams = null; }

  paneViews(): ISeriesPrimitivePaneView[] { return [this.view]; }

  updateAllViews(): void {
    if (!this.attachedParams || this.profile.length === 0) return;
    const series = this.attachedParams.series;
    const chart = this.attachedParams.chart;
    const ps = series.priceScale();
    const el = (chart as unknown as { chartElement(): HTMLElement }).chartElement?.();
    const chartW = el?.clientWidth ?? 800;
    const maxW = chartW * this.resolvedOpts.widthFraction;

    let maxVol = 0;
    for (const b of this.profile) {
      const total = b.upVol + b.downVol;
      if (total > maxVol) maxVol = total;
    }
    if (maxVol === 0) { this.view.update([], 0); return; }

    const bands: RenderBand[] = [];
    for (const b of this.profile) {
      const y1 = ps.priceToCoordinate(b.priceLow);
      const y2 = ps.priceToCoordinate(b.priceHigh);
      if (y1 === null || y2 === null) continue;
      const total = b.upVol + b.downVol;
      const totalW = (total / maxVol) * maxW;
      bands.push({
        y1: y1 as number,
        y2: y2 as number,
        upW: maxVol > 0 ? (b.upVol / maxVol) * maxW : 0,
        downW: maxVol > 0 ? (b.downVol / maxVol) * maxW : 0,
      });
    }

    const x0 = this.resolvedOpts.align === 'right' ? chartW : 0;
    this.view.update(bands, x0);
  }
}

function buildProfile(candles: Candle[], levels: number): ProfileBand[] {
  if (candles.length === 0) return [];
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const c of candles) {
    if (c.low < minPrice) minPrice = c.low;
    if (c.high > maxPrice) maxPrice = c.high;
  }
  if (minPrice === maxPrice) return [];

  const step = (maxPrice - minPrice) / levels;
  const bands: ProfileBand[] = Array.from({ length: levels }, (_, i) => ({
    priceLow: minPrice + i * step,
    priceHigh: minPrice + (i + 1) * step,
    upVol: 0,
    downVol: 0,
  }));

  for (const c of candles) {
    const isUp = c.close >= c.open;
    const volPerTick = c.volume / Math.max(1, (c.high - c.low) / step);
    const lo = Math.floor((c.low - minPrice) / step);
    const hi = Math.ceil((c.high - minPrice) / step);
    for (let i = Math.max(0, lo); i < Math.min(levels, hi); i++) {
      if (isUp) bands[i]!.upVol += volPerTick;
      else bands[i]!.downVol += volPerTick;
    }
  }
  return bands;
}
