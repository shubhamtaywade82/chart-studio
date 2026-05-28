import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type ChartOptions,
  type DeepPartial,
  type LogicalRange,
  CandlestickSeries,
  HistogramSeries,
  LineStyle
} from 'lightweight-charts';
import { EventBus } from './EventBus';
import { PluginRuntime, type ChartPlugin } from './PluginRuntime';
import { RafScheduler } from './RafScheduler';
import { MotionEngine } from './MotionEngine';
import { loadCandleTheme, type CandleTheme } from '../candle-themes';
import type { Candle } from '../../provider-client';

export class ChartEngine {
  public readonly api: IChartApi;
  public readonly series: ISeriesApi<'Candlestick'>;
  public readonly volume: ISeriesApi<'Histogram'>;

  public readonly bus = new EventBus();
  public readonly plugins: PluginRuntime;
  public readonly scheduler = new RafScheduler();
  public readonly motion = new MotionEngine(0.08);
  public readonly volumeMotion = new MotionEngine(0.08);

  public theme: CandleTheme = loadCandleTheme();

  private resizeObs: ResizeObserver;
  private cachedCandleWidth = 8;
  private candles: Candle[] = [];
  private stateKey = 'ui-chart-scale';

  constructor(container: HTMLElement, options: DeepPartial<ChartOptions>) {
    this.api = createChart(container, options);

    // Core Series
    this.series = this.api.addSeries(CandlestickSeries, {
      ...this.theme.options,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    this.volume = this.api.addSeries(HistogramSeries, {
      color: 'rgba(255, 255, 255, 0.18)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    }, 0);

    this.api.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    this.plugins = new PluginRuntime(this.api, this.series);

    // Setup RafScheduler Loop
    this.scheduler.subscribe((time) => {
      this.onAnimationFrame(time);
    });

    // Handle Resize
    this.resizeObs = new ResizeObserver(() => {
      this.api.resize(container.clientWidth, container.clientHeight);
      this.updateLayoutCache();
    });
    this.resizeObs.observe(container);

    // Handle Scaling / Visible Range
    this.api.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) {
        this.updateLayoutCache(range);
        this.bus.emitVisibleRangeChanged({ range, candleWidth: this.cachedCandleWidth });

        const atLive = range.to >= this.candles.length - 1;
        this.bus.emitLiveStateChanged(atLive);

        // Save scale state
        if (this.candles.length > 0) {
          const candlesVisible = range.to - range.from;
          const candlesFromRight = this.candles.length - range.to;
          localStorage.setItem(this.stateKey, JSON.stringify({ candlesVisible, candlesFromRight }));
        }
      }
    });

    // Wake up scheduler when a new tick comes in
    this.bus.onTick(() => {
      this.scheduler.requestContinuousRender();
    });
  }

  private onAnimationFrame(timeMs: number): void {
    if (this.candles.length > 0) {
      // Evaluate LTP & Volume physics
      this.motion.update(timeMs);
      this.volumeMotion.update(timeMs);

      const targetVolume = this.volumeMotion.getTarget();
      const currentVolume = this.volumeMotion.getCurrent();
      const last = this.candles[this.candles.length - 1];

      // Native update of the volume bar with the smoothly interpolated value
      if (currentVolume !== null && targetVolume !== null && currentVolume !== targetVolume && last) {
        const t = Math.floor(last.openTime / 1000) as UTCTimestamp;
        this.volume.update({
          time: t,
          value: currentVolume,
          color: last.close >= last.open 
            ? (this.theme.volumeUp ?? 'rgba(46, 189, 133, 0.35)') 
            : (this.theme.volumeDown ?? 'rgba(246, 70, 93, 0.35)')
        });
      }
    }

    // Auto-suspend the loop if both LTP and Volume motion are completely at rest
    let ltpAtRest = true;
    if (this.candles.length > 0) {
      ltpAtRest = this.motion.getCurrent() === this.motion.getTarget() &&
                  this.volumeMotion.getCurrent() === this.volumeMotion.getTarget();
    }

    if (ltpAtRest) {
      this.scheduler.suspendContinuousRender();
    }

    // Always give plugins their animation frame, even when there are no candles.
    // (BidAskPlugin needs frames to animate the Bid/Ask lines independently of candle data.)
    // Running this AFTER the suspend continuous render check allows plugins to call
    // requestContinuousRender() to keep the animation loop running if they are not yet at rest.
    this.plugins.updatePlugins(timeMs);
  }

  private updateLayoutCache(range?: LogicalRange | null): void {
    const timeScale = this.api.timeScale();
    const visibleRange = range || timeScale.getVisibleLogicalRange();
    if (visibleRange && visibleRange.to > visibleRange.from) {
      const barSpacing = timeScale.width() / (visibleRange.to - visibleRange.from);
      let cw = Math.max(1, Math.floor(barSpacing * 0.75));
      if (cw % 2 !== 0 && cw > 1) cw += 1;
      this.cachedCandleWidth = cw;
    }
  }

  public getCandleWidth(): number {
    return this.cachedCandleWidth;
  }

  public getCandles(): Candle[] {
    return this.candles;
  }

  public setCandles(candles: Candle[]) {
    const isFirstLoad = this.candles.length === 0 && candles.length > 0;
    this.candles = candles;

    if (isFirstLoad) {
      try {
        const saved = localStorage.getItem(this.stateKey);
        if (saved) {
          const { candlesVisible, candlesFromRight } = JSON.parse(saved);
          if (typeof candlesVisible === 'number' && typeof candlesFromRight === 'number') {
            const to = candles.length - candlesFromRight;
            const from = to - candlesVisible;
            if (from >= 0 && to <= candles.length && from < to) {
              // Apply saved scale on next tick to ensure layout is ready
              setTimeout(() => {
                this.api.timeScale().setVisibleLogicalRange({ from, to });
              }, 50);
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }
  }

  public registerPlugin(plugin: ChartPlugin) {
    this.plugins.register(plugin);
    // Request a render immediately when a plugin is added
    this.scheduler.requestRender(5);
  }

  public unregisterPlugin(id: string) {
    this.plugins.unregister(id);
    this.scheduler.requestRender(5);
  }

  public applyTheme(theme: CandleTheme) {
    this.theme = theme;
    this.series.applyOptions(theme.options);
    this.bus.emitThemeChanged(theme);
    this.scheduler.requestRender(5);
  }

  public destroy() {
    this.resizeObs.disconnect();
    this.scheduler.stop();
    this.plugins.destroy();
    this.api.remove();
  }
}
