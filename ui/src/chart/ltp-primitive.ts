import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  SeriesType,
  UTCTimestamp,
  Time,
} from 'lightweight-charts';

/**
 * Live-price ("LTP") primitive: draws a dashed horizontal line from the
 * latest bar's right edge to the chart's right edge, plus a colored
 * label on the price axis. Implemented against the v5 ISeriesPrimitive API.
 */
export class LtpPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private price: number | null = null;
  private color = '#2ebd85';
  private startTime: UTCTimestamp | null = null;
  private requestUpdate: (() => void) | null = null;
  private intervalMs = 0;
  private barStartMs = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart as IChartApi;
    this.series = param.series as ISeriesApi<SeriesType>;
    this.requestUpdate = param.requestUpdate;
    this.tickTimer = setInterval(() => {
      if (this.intervalMs > 0 && this.barStartMs > 0 && this.price !== null) this.requestUpdate?.();
    }, 1000);
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  setLtp(price: number | null, color: string, startTime: UTCTimestamp | null): void {
    this.price = price;
    this.color = color;
    this.startTime = startTime;
    this.requestUpdate?.();
  }

  setBarTiming(intervalMs: number, barStartMs: number): void {
    this.intervalMs = intervalMs;
    this.barStartMs = barStartMs;
    this.requestUpdate?.();
  }

  _countdown(): string | null {
    if (this.intervalMs <= 0 || this.barStartMs <= 0) return null;
    const remaining = Math.max(0, this.intervalMs - (Date.now() - this.barStartMs));
    const total = Math.ceil(remaining / 1000);
    if (total >= 3600) {
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      return `${h}h ${m.toString().padStart(2, '0')}m`;
    }
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  updateAllViews(): void {}

  paneViews(): IPrimitivePaneView[] {
    return [new LtpPaneView(this)];
  }

  priceAxisViews(): ISeriesPrimitiveAxisView[] {
    if (this.price === null) return [];
    const views: ISeriesPrimitiveAxisView[] = [new LtpPriceAxisView(this)];
    if (this._countdown() !== null) views.push(new LtpCountdownAxisView(this));
    return views;
  }

  _state(): { chart: IChartApi | null; series: ISeriesApi<SeriesType> | null; price: number | null; color: string; startTime: UTCTimestamp | null } {
    return { chart: this.chart, series: this.series, price: this.price, color: this.color, startTime: this.startTime };
  }
}

class LtpPaneView implements IPrimitivePaneView {
  constructor(private readonly p: LtpPrimitive) {}

  renderer(): IPrimitivePaneRenderer {
    return {
      // target is CanvasRenderingTarget2D from fancy-canvas
      draw: (target: any) => {
        const { chart, series, price, color, startTime } = this.p._state();
        if (!chart || !series || price === null) return;
        const y = series.priceToCoordinate(price);
        if (y === null) return;
        const ts = chart.timeScale();
        const xStart = startTime !== null ? ts.timeToCoordinate(startTime) ?? 0 : 0;

        target.useBitmapCoordinateSpace((scope: any) => {
          const ctx: CanvasRenderingContext2D = scope.context;
          const dpr: number = scope.bitmapSize.width / scope.mediaSize.width;
          const bY = y * dpr;
          const bXStart = Math.max(0, xStart * dpr);
          const bXEnd: number = scope.bitmapSize.width;

          ctx.save();

          ctx.beginPath();
          ctx.setLineDash([5 * dpr, 5 * dpr]);
          ctx.strokeStyle = color;
          ctx.lineWidth = dpr;
          ctx.globalAlpha = 0.8;
          ctx.moveTo(bXStart, bY);
          ctx.lineTo(bXEnd, bY);
          ctx.stroke();

          if (xStart > 0) {
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.arc(bXStart, bY, 4 * dpr, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;
            ctx.beginPath();
            ctx.arc(bXStart, bY, 2 * dpr, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.restore();
        });
      },
    };
  }
}

class LtpPriceAxisView implements ISeriesPrimitiveAxisView {
  constructor(private readonly p: LtpPrimitive) {}

  coordinate(): number {
    const { series, price } = this.p._state();
    if (!series || price === null) return -1;
    return series.priceToCoordinate(price) ?? -1;
  }

  text(): string {
    const { series, price } = this.p._state();
    if (price === null) return '';
    const p = (series?.options() as any)?.priceFormat?.precision ?? 2;
    const precision = Math.min(20, Math.max(0, p));
    return price.toLocaleString(undefined, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }

  textColor(): string { return '#ffffff'; }
  backColor(): string { return this.p._state().color; }
  visible(): boolean { return this.p._state().price !== null; }
  tickVisible(): boolean { return true; }
}

class LtpCountdownAxisView implements ISeriesPrimitiveAxisView {
  constructor(private readonly p: LtpPrimitive) {}

  coordinate(): number {
    const { series, price } = this.p._state();
    if (!series || price === null) return -1;
    const y = series.priceToCoordinate(price);
    if (y === null) return -1;
    // ~18px below the price label so the two stack on the axis.
    return y + 18;
  }

  text(): string { return this.p._countdown() ?? ''; }
  textColor(): string { return '#ffffff'; }
  backColor(): string { return this.p._state().color; }
  visible(): boolean { return this.p._countdown() !== null && this.p._state().price !== null; }
  tickVisible(): boolean { return false; }
}
