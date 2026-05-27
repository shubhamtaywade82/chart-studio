import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IChartApi,
  ISeriesApi,
  UTCTimestamp
} from 'lightweight-charts';
import { ActiveCandleRenderer } from './ActiveCandleRenderer';
import { CandleScopeOverlay, type DepthLevel } from './CandleScopeOverlay';
import type { ChartPlugin } from '../../engine/PluginRuntime';
import type { ChartEngine } from '../../engine/ChartEngine';

export class ActiveCandlePlugin implements ChartPlugin, ISeriesPrimitive {
  public readonly id = 'active-candle';

  private renderer = new ActiveCandleRenderer();
  private overlay  = new CandleScopeOverlay();

  private requestUpdate?: () => void;
  private api?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private engine?: ChartEngine;

  constructor(engine: ChartEngine) {
    this.engine = engine;
    // Wire overlay into renderer so it draws in the same canvas pass
    this.renderer.overlay = this.overlay;
  }

  getPrimitive(): ISeriesPrimitive {
    return this;
  }

  attached({ requestUpdate }: { requestUpdate: () => void }) {
    this.requestUpdate = requestUpdate;
  }

  updateAllViews(): void {
    if (this.engine) {
      this.engine.scheduler.requestContinuousRender();
      this.onAnimationFrame(performance.now());
    }
  }

  onAttached(api: IChartApi, series: ISeriesApi<'Candlestick'>) {
    this.api    = api;
    this.series = series;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Data feed setters (called from chart.ts)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Update order book depth levels (up to 5 each side).
   */
  setDepth(bids: DepthLevel[], asks: DepthLevel[]): void {
    this.overlay.setDepth(bids, asks);
    this.engine?.scheduler.requestContinuousRender();
    this.requestUpdate?.();
  }

  /**
   * Update best bid / ask prices and quantities (from BookTicker stream).
   */
  setBookTicker(bidPrice: number, bidQty: number, askPrice: number, askQty: number): void {
    this.overlay.setBookTicker(bidPrice, bidQty, askPrice, askQty);
    this.engine?.scheduler.requestContinuousRender();
    this.requestUpdate?.();
  }

  /**
   * Update cumulative session buy/sell quantities for the order flow bar.
   */
  setOrderFlow(totalBuyQty: number, totalSellQty: number): void {
    this.overlay.setOrderFlow(totalBuyQty, totalSellQty);
  }

  /**
   * Record a live trade for the pulse ring animation.
   * @param priceY  Y coordinate in **media (logical) pixels** at the trade price
   * @param qty     Trade quantity
   * @param isBuy   true = buyer-initiated trade
   */
  recordTrade(priceY: number, qty: number, isBuy: boolean): void {
    // Store in renderer so the canvas pass can consume it synchronously
    this.renderer.lastTradeY     = priceY;
    this.renderer.lastTradeQty   = qty;
    this.renderer.lastTradeIsBuy = isBuy;
    this.renderer.pendingTrade   = true;
    this.engine?.scheduler.requestContinuousRender();
    this.requestUpdate?.();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Animation frame
  // ──────────────────────────────────────────────────────────────────────────

  onAnimationFrame(timeMs: number): void {
    if (!this.api || !this.series || !this.engine) return;

    const candles = this.engine.getCandles();
    if (candles.length === 0) return;

    const last = candles[candles.length - 1];
    if (!last) return;

    const animatedPrice = this.engine.motion.getCurrent();
    if (animatedPrice === null) return;

    const t = Math.floor(last.openTime / 1000) as UTCTimestamp;
    const x = this.api.timeScale().timeToCoordinate(t);
    const y = this.series.priceToCoordinate(animatedPrice);

    if (x === null || y === null) return;

    const openY = this.series.priceToCoordinate(last.open);
    const highY = this.series.priceToCoordinate(last.high);
    const lowY  = this.series.priceToCoordinate(last.low);

    if (openY === null || highY === null || lowY === null) return;

    // Resolve ask / bid Y coordinates for the spread bracket
    const askPrice = this.overlay['bestAskPrice'] as number;
    const bidPrice = this.overlay['bestBidPrice'] as number;
    const askY = askPrice > 0 ? (this.series.priceToCoordinate(askPrice) ?? null) : null;
    const bidY = bidPrice > 0 ? (this.series.priceToCoordinate(bidPrice) ?? null) : null;

    const isBullish   = animatedPrice >= last.open;
    const themeColor  = isBullish
      ? (this.engine.theme.options.upColor   || '#2ebd85')
      : (this.engine.theme.options.downColor || '#f6465d');
    const borderColor = isBullish
      ? (this.engine.theme.options.borderUpColor   || themeColor)
      : (this.engine.theme.options.borderDownColor || themeColor);

    // Keep pulse rings animating even without new trades
    if (this.overlay.hasActivePulses()) {
      this.engine.scheduler.requestContinuousRender();
    }


    Object.assign(this.renderer, {
      x,
      openY,
      highY,
      lowY,
      closeY:      y,
      candleWidth: this.engine.getCandleWidth(),
      color:       themeColor,
      borderColor,
      askY,
      bidY,
    });

    this.requestUpdate?.();
  }

  paneViews(): IPrimitivePaneView[] {
    return [
      { renderer: () => this.renderer },
    ];
  }
}
