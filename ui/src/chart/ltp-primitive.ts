import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  ISeriesPrimitiveAxisView,
  UTCTimestamp,
} from 'lightweight-charts';

/**
 * Live-price ("LTP") primitive: draws a dashed horizontal line from the
 * latest bar's right edge to the chart's right edge, plus a colored
 * label on the price axis. Modeled after binance UI's
 * chart-partial-price-lines.js but implemented against the v5
 * ISeriesPrimitive API.
 */
export class LtpPrimitive implements ISeriesPrimitive<'Candlestick'> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private price: number | null = null;
  private color = '#00e676';
  private startTime: UTCTimestamp | null = null;
  private requestUpdate: (() => void) | null = null;

  attached(param: { chart: IChartApi; series: ISeriesApi<'Candlestick'>; requestUpdate: () => void }): void {
    this.chart = param.chart;
    this.series = param.series;
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

  updateAllViews(): void {
    /* views read live fields directly */
  }

  paneViews(): ISeriesPrimitivePaneView[] {
    return [new LtpPaneView(this)];
  }

  priceAxisViews(): ISeriesPrimitiveAxisView[] {
    if (this.price === null) return [];
    return [new LtpPriceAxisView(this)];
  }

  // Internal accessors for the views.
  _state(): { chart: IChartApi | null; series: ISeriesApi<'Candlestick'> | null; price: number | null; color: string; startTime: UTCTimestamp | null } {
    return { chart: this.chart, series: this.series, price: this.price, color: this.color, startTime: this.startTime };
  }
}

class LtpPaneView implements ISeriesPrimitivePaneView {
  constructor(private readonly p: LtpPrimitive) {}
  renderer(): ISeriesPrimitivePaneRenderer {
    const { chart, series, price, color, startTime } = this.p._state();
    return {
      draw: (scope) => {
        if (!chart || !series || price === null) return;
        const y = series.priceToCoordinate(price);
        if (y === null) return;
        const ts = chart.timeScale();
        const xStart = startTime !== null ? ts.timeToCoordinate(startTime) ?? 0 : 0;
        const xEnd = scope.mediaSize.width;
        const ctx = scope.context;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.moveTo(Math.max(0, xStart), y);
        ctx.lineTo(xEnd, y);
        ctx.stroke();
        ctx.restore();
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
    const { price } = this.p._state();
    if (price === null) return '';
    return price.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  textColor(): string { return '#000000'; }
  backColor(): string { return this.p._state().color; }
  visible(): boolean { return this.p._state().price !== null; }
  tickVisible(): boolean { return true; }
}
