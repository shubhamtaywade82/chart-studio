import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IChartApi,
  ISeriesApi,
  UTCTimestamp
} from 'lightweight-charts';

import { RealtimeLineRenderer } from './RealtimeLineRenderer';
import type { ChartPlugin } from '../../engine/PluginRuntime';
import type { ChartEngine } from '../../engine/ChartEngine';

export class RealtimeLinePlugin implements ChartPlugin, ISeriesPrimitive {
  public readonly id = 'realtime-line';
  private renderer = new RealtimeLineRenderer();
  private requestUpdate?: () => void;
  private api?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private engine?: ChartEngine;

  public enabled = true;

  constructor(engine: ChartEngine) {
    this.engine = engine;
  }

  getPrimitive(): ISeriesPrimitive {
    return this;
  }

  attached({ requestUpdate }: { requestUpdate: () => void }) {
    this.requestUpdate = requestUpdate;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.engine?.scheduler.requestContinuousRender();
    this.requestUpdate?.();
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
    if (!this.enabled) return;
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

    let previousX = x - 20;
    let previousY = y;
    if (candles.length > 1) {
      const prev = candles[candles.length - 2]!;
      const prevT = Math.floor(prev.openTime / 1000) as UTCTimestamp;
      const pX = this.api.timeScale().timeToCoordinate(prevT);
      const pY = this.series.priceToCoordinate(prev.close);
      if (pX != null && pY != null) {
        previousX = pX;
        previousY = pY;
      }
    }

    const isBullish = animatedPrice >= last.open;
    const themeColor = isBullish 
      ? (this.engine.theme.options.upColor || '#2ebd85') 
      : (this.engine.theme.options.downColor || '#f6465d');
    const borderColor = isBullish
      ? (this.engine.theme.options.borderUpColor || themeColor)
      : (this.engine.theme.options.borderDownColor || themeColor);

    this.renderer.x = x;
    this.renderer.y = y;
    this.renderer.previousX = previousX;
    this.renderer.previousY = previousY;
    this.renderer.color = borderColor;
    
    this.requestUpdate?.();
  }

  paneViews(): IPrimitivePaneView[] {
    if (!this.enabled) return [];
    return [
      { renderer: () => this.renderer },
    ];
  }
}
