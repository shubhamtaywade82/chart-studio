import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IChartApi,
  ISeriesApi,
  UTCTimestamp
} from 'lightweight-charts';
import { ActiveCandleRenderer } from './ActiveCandleRenderer';
import type { ChartPlugin } from '../../engine/PluginRuntime';
import type { ChartEngine } from '../../engine/ChartEngine';

export class ActiveCandlePlugin implements ChartPlugin, ISeriesPrimitive {
  public readonly id = 'active-candle';
  private renderer = new ActiveCandleRenderer();
  private requestUpdate?: () => void;
  private api?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private engine?: ChartEngine;

  constructor(engine: ChartEngine) {
    this.engine = engine;
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
    this.api = api;
    this.series = series;
  }

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
    const lowY = this.series.priceToCoordinate(last.low);

    if (openY === null || highY === null || lowY === null) return;

    const isBullish = animatedPrice >= last.open;
    const themeColor = isBullish 
      ? (this.engine.theme.options.upColor || '#2ebd85') 
      : (this.engine.theme.options.downColor || '#f6465d');
    const borderColor = isBullish
      ? (this.engine.theme.options.borderUpColor || themeColor)
      : (this.engine.theme.options.borderDownColor || themeColor);

    Object.assign(this.renderer, {
      x, openY, highY, lowY, closeY: y,
      candleWidth: this.engine.getCandleWidth(),
      color: themeColor,
      borderColor
    });

    this.requestUpdate?.();
  }

  paneViews(): IPrimitivePaneView[] {
    return [
      { renderer: () => this.renderer },
    ];
  }
}
