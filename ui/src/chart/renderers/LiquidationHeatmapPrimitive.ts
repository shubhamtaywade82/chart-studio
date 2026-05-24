import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesAttachedParameter,
  PrimitivePaneViewZOrder,
} from 'lightweight-charts';

export interface LiqEvent {
  time: number;   // unix seconds
  price: number;
  volume: number; // USD notional
  side: 'long' | 'short';
}

const BUCKET_PCT = 0.001; // 0.1% price bucket width
const MAX_LEVELS = 200;

interface HeatBand {
  priceLow: number;
  priceHigh: number;
  longVol: number;
  shortVol: number;
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function heatColor(intensity: number, side: 'long' | 'short'): string {
  const a = Math.min(0.85, intensity * 0.85 + 0.05);
  if (side === 'short') {
    const r = Math.round(lerp(255, 255, intensity));
    const g = Math.round(lerp(200, 50, intensity));
    const b = Math.round(lerp(200, 50, intensity));
    return `rgba(${r},${g},${b},${a.toFixed(2)})`;
  }
  const r = Math.round(lerp(200, 50, intensity));
  const g = Math.round(lerp(255, 255, intensity));
  const b2 = Math.round(lerp(200, 50, intensity));
  return `rgba(${r},${g},${b2},${a.toFixed(2)})`;
}

interface RenderBand {
  y1: number;
  y2: number;
  longIntensity: number;
  shortIntensity: number;
}

class HeatmapRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(
    private readonly bands: RenderBand[],
    private readonly chartWidth: number,
  ) {}

  draw(target: { context: CanvasRenderingContext2D }): void {
    const ctx = target.context;
    ctx.save();
    for (const b of this.bands) {
      const y = Math.min(b.y1, b.y2);
      const h = Math.abs(b.y2 - b.y1);
      if (h < 0.5) continue;

      if (b.shortIntensity > 0.01) {
        ctx.fillStyle = heatColor(b.shortIntensity, 'short');
        ctx.fillRect(0, y, this.chartWidth / 2, h);
      }
      if (b.longIntensity > 0.01) {
        ctx.fillStyle = heatColor(b.longIntensity, 'long');
        ctx.fillRect(this.chartWidth / 2, y, this.chartWidth / 2, h);
      }
    }
    ctx.restore();
  }
}

class HeatmapPaneView implements ISeriesPrimitivePaneView {
  private bands: RenderBand[] = [];
  private chartWidth = 800;

  update(bands: RenderBand[], chartWidth: number): void {
    this.bands = bands;
    this.chartWidth = chartWidth;
  }

  zOrder(): PrimitivePaneViewZOrder { return 'bottom'; }

  renderer(): ISeriesPrimitivePaneRenderer {
    return new HeatmapRenderer(this.bands, this.chartWidth);
  }
}

/**
 * Liquidation heatmap primitive: accumulates liquidation events into
 * 0.1%-wide price buckets and renders them as colored horizontal bands.
 * Green = long liquidations, Red = short liquidations.
 *
 * Usage:
 *   const hmap = new LiquidationHeatmapPrimitive();
 *   candleSeries.attachPrimitive(hmap);
 *   hmap.addEvent({ time, price, volume, side: 'long' });
 */
export class LiquidationHeatmapPrimitive implements ISeriesPrimitive {
  private view = new HeatmapPaneView();
  private buckets = new Map<number, HeatBand>(); // key = bucket index
  private refPrice = 0;
  private attachedParams: SeriesAttachedParameter<'Candlestick'> | null = null;

  addEvent(ev: LiqEvent): void {
    if (this.refPrice === 0) this.refPrice = ev.price;
    const bucketIdx = Math.round(Math.log(ev.price / this.refPrice) / BUCKET_PCT);
    if (Math.abs(bucketIdx) > MAX_LEVELS) return;

    let band = this.buckets.get(bucketIdx);
    if (!band) {
      const priceLow = this.refPrice * Math.exp(bucketIdx * BUCKET_PCT);
      const priceHigh = priceLow * (1 + BUCKET_PCT);
      band = { priceLow, priceHigh, longVol: 0, shortVol: 0 };
      this.buckets.set(bucketIdx, band);
    }
    if (ev.side === 'long') band.longVol += ev.volume;
    else band.shortVol += ev.volume;
  }

  clearEvents(): void {
    this.buckets.clear();
    this.refPrice = 0;
    this.updateAllViews();
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
    const ps = series.priceScale();
    const el = (chart as unknown as { chartElement(): HTMLElement }).chartElement?.();
    const chartWidth = el?.clientWidth ?? 800;

    let maxLong = 0;
    let maxShort = 0;
    for (const [, b] of this.buckets) {
      if (b.longVol > maxLong) maxLong = b.longVol;
      if (b.shortVol > maxShort) maxShort = b.shortVol;
    }
    if (maxLong === 0 && maxShort === 0) { this.view.update([], chartWidth); return; }

    const bands: RenderBand[] = [];
    for (const [, b] of this.buckets) {
      const y1 = ps.priceToCoordinate(b.priceLow);
      const y2 = ps.priceToCoordinate(b.priceHigh);
      if (y1 === null || y2 === null) continue;
      bands.push({
        y1: y1 as number,
        y2: y2 as number,
        longIntensity: maxLong > 0 ? b.longVol / maxLong : 0,
        shortIntensity: maxShort > 0 ? b.shortVol / maxShort : 0,
      });
    }
    this.view.update(bands, chartWidth);
  }
}
