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

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart as IChartApi;
    this.series = param.series as ISeriesApi<SeriesType>;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setLtp(price: number | null, color: string, startTime: UTCTimestamp | null): void {
    this.price = price;
    this.color = color;
    this.startTime = startTime;
    this.requestUpdate?.();
  }

  updateAllViews(): void {}

  paneViews(): IPrimitivePaneView[] {
    return [new LtpPaneView(this)];
  }

  priceAxisViews(): ISeriesPrimitiveAxisView[] {
    if (this.price === null) return [];
    return [new LtpPriceAxisView(this)];
  }

  _state(): { chart: IChartApi | null; series: ISeriesApi<SeriesType> | null; price: number | null; color: string; startTime: UTCTimestamp | null } {
    return { chart: this.chart, series: this.series, price: this.price, color: this.color, startTime: this.startTime };
  }
}

class LtpPaneView implements IPrimitivePaneView {
  constructor(private readonly p: LtpPrimitive) {}

  renderer(): IPrimitivePaneRenderer {
    const { chart, series, price, color, startTime } = this.p._state();
    return {
      // target is CanvasRenderingTarget2D from fancy-canvas
      draw: (target: any) => {
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
    const precision = (series?.options() as any)?.priceFormat?.precision ?? 2;
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
