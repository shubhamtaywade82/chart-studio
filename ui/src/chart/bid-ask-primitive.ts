import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { ChartPlugin } from './engine/PluginRuntime';
import type { ChartEngine } from './engine/ChartEngine';
import { MotionEngine } from './engine/MotionEngine';

/**
 * Custom Ask/Bid price line primitive that animates smoothly on the canvas
 * using MotionEngines, replacing the expensive and laggy built-in price lines.
 *
 * Design notes:
 * - `askPrice` / `bidPrice` hold the raw received prices (used for axis visibility gating).
 * - `askMotion` / `bidMotion` hold the spring-interpolated positions (used for drawing).
 * - `priceAxisViews()` is gated on the raw prices being non-null, NOT the animated values,
 *   so labels appear immediately on first tick regardless of animation state.
 */
export class BidAskPlugin implements ChartPlugin, ISeriesPrimitive<Time> {
  public readonly id = 'bid-ask';

  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private engine?: ChartEngine;

  // Spring-interpolated values for smooth animation
  private askMotion = new MotionEngine(0.12);
  private bidMotion = new MotionEngine(0.12);

  // Raw prices — used for visibility gating (not animation positions)
  private askPrice: number | null = null;
  private bidPrice: number | null = null;

  // ──────────────────────────────────────────────────────────────────────────
  // ChartPlugin lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  attachEngine(engine: ChartEngine): void {
    this.engine = engine;
  }

  getPrimitive(): ISeriesPrimitive<Time> {
    return this;
  }

  onAttached(_api: IChartApi, _series: ISeriesApi<'Candlestick'>): void {
    // Nothing needed here — `attached()` is called by LightweightCharts
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ISeriesPrimitive lifecycle
  // ──────────────────────────────────────────────────────────────────────────

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

  // ──────────────────────────────────────────────────────────────────────────
  // Animation loop — called by PluginRuntime.updatePlugins() each RAF frame
  // ──────────────────────────────────────────────────────────────────────────

  onAnimationFrame(timeMs: number): void {
    if (this.askPrice === null && this.bidPrice === null) return;

    const askPrev = this.askMotion.getCurrent();
    const bidPrev = this.bidMotion.getCurrent();

    this.askMotion.update(timeMs);
    this.bidMotion.update(timeMs);

    const askNow = this.askMotion.getCurrent();
    const bidNow = this.bidMotion.getCurrent();

    // Request redraw only when the animated position has changed
    const askMoved = askNow !== askPrev;
    const bidMoved = bidNow !== bidPrev;

    if (askMoved || bidMoved) {
      this.requestUpdate?.();
    }

    // Keep running until both motions reach their targets
    const askAtRest = this.askMotion.getCurrent() === this.askMotion.getTarget();
    const bidAtRest = this.bidMotion.getCurrent() === this.bidMotion.getTarget();
    if (!askAtRest || !bidAtRest) {
      this.engine?.scheduler.requestContinuousRender();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  setPrices(bestBid: number | null, bestAsk: number | null): void {
    if (bestAsk !== null && bestAsk > 0 && Number.isFinite(bestAsk)) {
      this.askPrice = bestAsk;
      this.askMotion.setTarget(bestAsk);
    } else {
      this.askPrice = null;
      this.askMotion.reset();
    }

    if (bestBid !== null && bestBid > 0 && Number.isFinite(bestBid)) {
      this.bidPrice = bestBid;
      this.bidMotion.setTarget(bestBid);
    } else {
      this.bidPrice = null;
      this.bidMotion.reset();
    }

    // Wake up the scheduler so onAnimationFrame starts firing
    this.engine?.scheduler.requestContinuousRender();

    // Force an immediate repaint so the axis label shows up without waiting
    // for the next animation frame.
    this.requestUpdate?.();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ISeriesPrimitive rendering
  // ──────────────────────────────────────────────────────────────────────────

  paneViews(): IPrimitivePaneView[] {
    return [new BidAskPaneView(this)];
  }

  /**
   * Returns axis views gated on the *raw* prices, not the animated values.
   * This means the label appears on the first tick, without waiting for
   * the motion engine to produce a non-null animated value.
   */
  priceAxisViews(): ISeriesPrimitiveAxisView[] {
    const views: ISeriesPrimitiveAxisView[] = [];
    if (this.askPrice !== null) {
      views.push(new BidAskPriceAxisView(this, 'ask'));
    }
    if (this.bidPrice !== null) {
      views.push(new BidAskPriceAxisView(this, 'bid'));
    }
    return views;
  }

  updateAllViews(): void {
    // Intentionally empty — we handle updates via requestUpdate()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal state snapshot for views
  // ──────────────────────────────────────────────────────────────────────────

  _state() {
    const seriesOptions = this.series?.options() as any;
    const p = seriesOptions?.priceFormat?.precision ?? 2;
    const precision = Math.min(20, Math.max(0, typeof p === 'number' ? p : 2));

    // Use animated position if available, fall back to raw price
    const askAnimated = this.askMotion.getCurrent();
    const bidAnimated = this.bidMotion.getCurrent();

    return {
      chart: this.chart,
      series: this.series,
      // For drawing: use animated position (smooth movement)
      askDraw: askAnimated ?? this.askPrice,
      bidDraw: bidAnimated ?? this.bidPrice,
      // For axis label: use animated position for coordinate, raw price for text
      askRaw: this.askPrice,
      bidRaw: this.bidPrice,
      precision,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Pane view — draws the dashed lines on the chart canvas
// ────────────────────────────────────────────────────────────────────────────

class BidAskPaneView implements IPrimitivePaneView {
  constructor(private readonly p: BidAskPlugin) {}

  renderer(): IPrimitivePaneRenderer {
    return {
      draw: (target: any) => {
        const { chart, series, askDraw, bidDraw } = this.p._state();
        if (!chart || !series) return;

        target.useBitmapCoordinateSpace((scope: any) => {
          const ctx: CanvasRenderingContext2D = scope.context;
          const dpr: number = scope.bitmapSize.width / scope.mediaSize.width;
          const bXEnd: number = scope.bitmapSize.width;

          ctx.save();

          const drawLine = (price: number, color: string, label: string, position: 'top' | 'bottom') => {
            const y = series.priceToCoordinate(price);
            if (y === null || y === undefined) return;
            const bY = Math.round(y * dpr);

            // Draw dashed line across full width
            ctx.beginPath();
            const dash = Math.round(3 * dpr);
            const gap = Math.round(5 * dpr);
            ctx.setLineDash([dash, gap]);
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1, Math.round(dpr));
            ctx.globalAlpha = 0.65;
            ctx.moveTo(0, bY);
            ctx.lineTo(bXEnd, bY);
            ctx.stroke();

            // Draw label on the left edge of the pane
            ctx.setLineDash([]);
            ctx.globalAlpha = 0.85;
            const fontSize = Math.round(10 * dpr);
            ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
            ctx.fillStyle = color;
            if (position === 'top') {
              ctx.textBaseline = 'bottom';
              ctx.fillText(label, Math.round(8 * dpr), bY - Math.round(2 * dpr));
            } else {
              ctx.textBaseline = 'top';
              ctx.fillText(label, Math.round(8 * dpr), bY + Math.round(2 * dpr));
            }
          };

          if (askDraw !== null && bidDraw !== null) {
            if (askDraw >= bidDraw) {
              drawLine(askDraw, '#f6465d', 'Ask', 'top');
              drawLine(bidDraw, '#0ecb81', 'Bid', 'bottom');
            } else {
              drawLine(bidDraw, '#0ecb81', 'Bid', 'top');
              drawLine(askDraw, '#f6465d', 'Ask', 'bottom');
            }
          } else {
            if (askDraw !== null) drawLine(askDraw, '#f6465d', 'Ask', 'top');
            if (bidDraw !== null) drawLine(bidDraw, '#0ecb81', 'Bid', 'bottom');
          }

          ctx.restore();
        });
      },
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Price axis view — draws the colored label on the right price scale
// ────────────────────────────────────────────────────────────────────────────

class BidAskPriceAxisView implements ISeriesPrimitiveAxisView {
  constructor(
    private readonly p: BidAskPlugin,
    private readonly type: 'ask' | 'bid'
  ) {}

  coordinate(): number {
    const { series, askDraw, bidDraw } = this.p._state();
    if (!series) return -1;
    // Use the animated draw position for the coordinate so the label glides
    const price = this.type === 'ask' ? askDraw : bidDraw;
    if (price === null || price === undefined) return -1;
    const coord = series.priceToCoordinate(price);
    return coord ?? -1;
  }

  text(): string {
    // Display the raw (non-interpolated) price in the label so it's accurate
    const { askRaw, bidRaw, precision } = this.p._state();
    const price = this.type === 'ask' ? askRaw : bidRaw;
    if (price === null || price === undefined) return '';
    return price.toLocaleString(undefined, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }

  textColor(): string {
    return '#ffffff';
  }

  backColor(): string {
    return this.type === 'ask' ? '#f6465d' : '#0ecb81';
  }

  visible(): boolean {
    const { askRaw, bidRaw } = this.p._state();
    const price = this.type === 'ask' ? askRaw : bidRaw;
    return price !== null && price !== undefined;
  }

  tickVisible(): boolean {
    return true;
  }
}
