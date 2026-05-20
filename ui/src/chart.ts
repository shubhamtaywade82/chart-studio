import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  CandlestickSeries,
  HistogramSeries,
  CrosshairMode,
  LineStyle,
  type UTCTimestamp,
  type MouseEventParams,
  type LogicalRange,
} from 'lightweight-charts';
import type { Candle } from './provider-client';
import { CANDLE_THEMES, loadCandleTheme, saveCandleTheme, type CandleTheme } from './chart/candle-themes';
import { LtpPrimitive } from './chart/ltp-primitive';

/**
 * v5 chart wrapper using lightweight-charts.
 * Optimized for Binance-style aesthetics and real-time synchronization.
 */
export class ChartView {
  private chart: IChartApi;
  private series: ISeriesApi<'Candlestick'>;
  private volume: ISeriesApi<'Histogram'>;
  private ltp: LtpPrimitive;
  private candles: Candle[] = [];
  private theme: CandleTheme = loadCandleTheme();
  private precision: number = 2;
  private resizeObs: ResizeObserver;
  private crosshairListeners = new Set<(c: CrosshairInfo | null) => void>();
  private liveListeners = new Set<(atLive: boolean) => void>();
  private atLive = true;

  constructor(container: HTMLElement) {
    this.chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { color: 'transparent' },
        textColor: '#8892a4',
        panes: { 
          separatorColor: 'rgba(255, 255, 255, 0.08)',
          separatorHoverColor: 'rgba(124, 77, 255, 0.25)',
          enableResize: true 
        },
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: 'rgba(255, 255, 255, 0.08)',
        rightOffset: 12,
        barSpacing: 10,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        autoScale: true,
        alignLabels: true,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: LineStyle.LargeDash,
          labelBackgroundColor: '#131722',
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: LineStyle.LargeDash,
          labelBackgroundColor: '#131722',
        },
      },
      watermark: {
        visible: true,
        fontSize: 48,
        horzAlign: 'center',
        vertAlign: 'center',
        color: 'rgba(255, 255, 255, 0.03)',
        text: 'CHART STUDIO',
      },
      autoSize: false,
    });

    this.series = this.chart.addSeries(CandlestickSeries, {
      ...this.theme.options,
      priceLineVisible: true,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
    });

    this.volume = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      color: 'rgba(255, 255, 255, 0.18)',
      priceScaleId: 'volume',
    }, 0);

    this.chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    this.ltp = new LtpPrimitive();
    this.series.attachPrimitive(this.ltp);

    this.resizeObs = new ResizeObserver(() => {
      this.chart.resize(container.clientWidth, container.clientHeight);
    });
    this.resizeObs.observe(container);

    this.chart.subscribeClick((p) => this.handleClick(p));
    this.chart.subscribeCrosshairMove((p) => this.handleCrosshair(p));
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => this.handleRangeChange(r));
  }

  setSymbol(symbol: string): void {
    this.chart.applyOptions({
      watermark: { text: symbol.toUpperCase() },
    });
  }

  // ── Data ────────────────────────────────────────────────────────────

  private autoDetectPrecision(prices: number[]): void {
    let p = this.precision;
    for (const val of prices) {
      const s = val.toString();
      if (s.includes('.')) {
        p = Math.max(p, s.split('.')[1].length);
      }
    }
    
    if (p > this.precision) {
      console.log(`[ChartView] Precision upgraded to ${p}`);
      this.precision = p;
      this.series.applyOptions({
        priceFormat: {
          type: 'price',
          precision: this.precision,
          minMove: 1 / Math.pow(10, this.precision),
        },
      });
    }
  }

  setHistory(candles: Candle[]): void {
    this.candles = [...candles].sort((a, b) => a.openTime - b.openTime);
    this.autoDetectPrecision(this.candles.map(c => c.close));
    
    // Apply price scale options (Margins)
    this.series.priceScale().applyOptions({
      scaleMargins: {
        top: 0.1,
        bottom: 0.2,
      },
    });

    const cs = this.candles.map((c) => ({
      time: (c.openTime / 1000) as UTCTimestamp,
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    const vs = this.candles.map((c) => ({
      time: (c.openTime / 1000) as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(46, 189, 133, 0.35)' : 'rgba(246, 70, 93, 0.35)',
    }));
    this.series.setData(cs);
    this.volume.setData(vs);
    
    // Set initial LTP
    const last = this.candles[this.candles.length - 1];
    if (last) {
      this.setLastTradePrice(last.close);
    }
  }

  updateCandle(c: Candle): void {
    this.autoDetectPrecision([c.close, c.high, c.low]);
    const t = (c.openTime / 1000) as UTCTimestamp;
    this.series.update({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
    this.volume.update({ time: t, value: c.volume, color: c.close >= c.open ? 'rgba(46, 189, 133, 0.35)' : 'rgba(246, 70, 93, 0.35)' });

    const last = this.candles[this.candles.length - 1];
    if (last && last.openTime === c.openTime) this.candles[this.candles.length - 1] = c;
    else this.candles.push(c);

    // Sync LTP with candle updates
    this.setLastTradePrice(c.close);
  }

  setLastTradePrice(price: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    this.autoDetectPrecision([price]);
    const last = this.candles[this.candles.length - 1];
    if (last) {
      const next: Candle = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
      this.candles[this.candles.length - 1] = next;
      const t = (next.openTime / 1000) as UTCTimestamp;
      this.series.update({ time: t, open: next.open, high: next.high, low: next.low, close: next.close });
    }
    const bullish = !last || price >= last.open;
    const color = bullish ? '#2ebd85' : '#f6465d';
    const startTime = last ? ((last.openTime / 1000) as UTCTimestamp) : null;
    this.ltp.setLtp(price, color, startTime);
  }

  clearLastTradePrice(): void {
    this.ltp.setLtp(null, '#2ebd85', null);
  }

  // ── Theme ───────────────────────────────────────────────────────────

  themes(): readonly CandleTheme[] { return CANDLE_THEMES; }
  currentTheme(): CandleTheme { return this.theme; }
  getPrecision(): number {
    return this.precision;
  }

  setTheme(id: string): void {
    const next = CANDLE_THEMES.find((t) => t.id === id);
    if (!next) return;
    this.theme = next;
    saveCandleTheme(id);
    this.series.applyOptions(next.options);
  }

  // ── Events ──────────────────────────────────────────────────────────

  onCrosshair(fn: (i: CrosshairInfo | null) => void): () => void {
    this.crosshairListeners.add(fn);
    return () => this.crosshairListeners.delete(fn);
  }

  onLiveStateChange(fn: (atLive: boolean) => void): () => void {
    this.liveListeners.add(fn);
    fn(this.atLive);
    return () => this.liveListeners.delete(fn);
  }

  scrollToRealtime(): void {
    this.chart.timeScale().scrollToRealTime();
  }

  api(): IChartApi { return this.chart; }

  private handleCrosshair(p: MouseEventParams): void {
    if (!p.time || p.point === undefined) {
      for (const fn of this.crosshairListeners) fn(null);
      return;
    }
    const data = p.seriesData.get(this.series) as { open: number; high: number; low: number; close: number } | undefined;
    const volData = p.seriesData.get(this.volume) as { value: number } | undefined;
    if (!data) {
      for (const fn of this.crosshairListeners) fn(null);
      return;
    }
    const f = (n: number): string => {
      const p = this.getPrecision();
      return n.toLocaleString(undefined, { minimumFractionDigits: p, maximumFractionDigits: p });
    };
    const info: CrosshairInfo = {
      time: p.time as number,
      open: data.open, high: data.high, low: data.low, close: data.close,
      volume: volData?.value ?? null,
      formattedPrice: f(data.close),
    };
    for (const fn of this.crosshairListeners) fn(info);
  }

  private handleClick(p: MouseEventParams): void {
    /* Click handling logic */
  }

  private handleRangeChange(range: LogicalRange | null): void {
    if (!range) return;
    const atLive = range.to >= this.candles.length - 1;
    if (atLive !== this.atLive) {
      this.atLive = atLive;
      for (const fn of this.liveListeners) fn(atLive);
    }
  }

  dispose(): void {
    this.resizeObs.disconnect();
    this.chart.remove();
  }
}

export interface CrosshairInfo {
  time: number;
  open: number; high: number; low: number; close: number;
  volume: number | null;
  formattedPrice?: string;
}
