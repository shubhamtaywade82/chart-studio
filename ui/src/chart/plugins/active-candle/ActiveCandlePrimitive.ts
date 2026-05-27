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

  setEnabled(enabled: boolean): void {
    this.overlay.enabled = enabled;
    this.engine?.scheduler.requestContinuousRender();
    this.requestUpdate?.();
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
   * Record a live trade for the pulse ring and footprint.
   * @param price   Raw trade price
   * @param priceY  Y coordinate in **media (logical) pixels** at the trade price
   * @param qty     Trade quantity
   * @param isBuy   true = buyer-initiated trade
   */
  recordTrade(price: number, priceY: number, qty: number, isBuy: boolean): void {
    // Store in renderer so the canvas pass can consume it synchronously
    this.renderer.lastTradePrice = price;
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

    // Resolve bidsY / asksY coordinates for actual price depth aura
    const bidLevels = this.overlay['bids'] as DepthLevel[];
    const askLevels = this.overlay['asks'] as DepthLevel[];
    const bidsY = bidLevels.map(b => b.price > 0 ? (this.series!.priceToCoordinate(b.price) ?? null) : null);
    const asksY = askLevels.map(a => a.price > 0 ? (this.series!.priceToCoordinate(a.price) ?? null) : null);

    // Resolve rolling average volume of past 10 candles
    let avgVolume = 0;
    if (candles.length > 1) {
      const historical = candles.slice(-11, -1);
      const sum = historical.reduce((acc, c) => acc + c.volume, 0);
      avgVolume = sum / historical.length;
    }

    const isEnabled = this.overlay.enabled;
    const isBullish = animatedPrice >= last.open;
    let fillStyle = '';
    let borderColor = '';
    let glowBlur = 0;

    if (isEnabled) {
      const volumeRatio = avgVolume > 0 ? last.volume / avgVolume : 0.5;

      // Calculate depth imbalance
      const bidQtyTotal = bidLevels.reduce((acc, b) => acc + b.qty, 0);
      const askQtyTotal = askLevels.reduce((acc, a) => acc + a.qty, 0);
      const totalQty = bidQtyTotal + askQtyTotal;
      const imbalance = totalQty > 0 ? (bidQtyTotal - askQtyTotal) / totalQty : 0; // -1..+1

      let baseColor = '';
      if (isBullish) {
        if (imbalance >= 0) {
          baseColor = this._interpolateColor([14, 203, 129], [0, 255, 120], imbalance);
        } else {
          baseColor = this._interpolateColor([14, 203, 129], [220, 195, 15], -imbalance);
        }
      } else {
        if (imbalance <= 0) {
          baseColor = this._interpolateColor([246, 70, 93], [255, 10, 60], -imbalance);
        } else {
          baseColor = this._interpolateColor([246, 70, 93], [255, 130, 20], imbalance);
        }
      }

      borderColor = baseColor;
      const alpha = Math.max(0.35, Math.min(0.85, 0.45 + (volumeRatio - 0.5) * 0.25));
      fillStyle = baseColor.replace('rgb', 'rgba').replace(')', `, ${alpha.toFixed(2)})`);
      glowBlur = Math.round(Math.min(2.5, volumeRatio) * 6);
    } else {
      borderColor = isBullish
        ? (this.engine.theme.options.upColor   || '#2ebd85')
        : (this.engine.theme.options.downColor || '#f6465d');
      fillStyle = borderColor;
      glowBlur = 0;
    }

    // Keep pulse rings animating even without new trades
    if (isEnabled && this.overlay.hasActivePulses()) {
      this.engine.scheduler.requestContinuousRender();
    }

    Object.assign(this.renderer, {
      x,
      openY,
      highY,
      lowY,
      closeY:      y,
      candleWidth: this.engine.getCandleWidth(),
      color:       fillStyle,
      borderColor,
      glowBlur,
      askY,
      bidY,
      bidsY,
      asksY,
      highPrice:   last.high,
      lowPrice:    last.low,
      currentVolume: last.volume,
      avgVolume,
      openTime:    last.openTime,
    });

    this.requestUpdate?.();
  }

  private _interpolateColor(color1: number[], color2: number[], t: number): string {
    const r = Math.round(color1[0] + (color2[0] - color1[0]) * t);
    const g = Math.round(color1[1] + (color2[1] - color1[1]) * t);
    const b = Math.round(color1[2] + (color2[2] - color1[2]) * t);
    return `rgb(${r},${g},${b})`;
  }

  paneViews(): IPrimitivePaneView[] {
    return [
      { renderer: () => this.renderer },
    ];
  }
}
