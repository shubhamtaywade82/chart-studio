import {
  createChart,
  createTextWatermark,
  type IChartApi,
  type ISeriesApi,
  type ITextWatermarkPluginApi,
  type Time,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  LineStyle,
  type UTCTimestamp,
  type MouseEventParams,
  type LogicalRange,
} from 'lightweight-charts';
import type { Candle } from './provider-client';
import { CANDLE_THEMES, loadCandleTheme, saveCandleTheme, type CandleTheme } from './chart/candle-themes';
import { LtpPrimitive } from './chart/ltp-primitive';
import { SmoothPriceAnimator } from './chart/smooth-price';
import { ema, sma, macd, rsi, bollinger } from './indicators/math';
import type { ActiveIndicator } from './indicators/registry';
import { AnalyticsRenderer, type AnalyticsState } from './chart/analytics';
import { AlertSystem } from './chart/alerts';
import { LatencyMonitor, DepthHeatmap, VolumeProfilePanel } from './chart/market-monitor';

export class ChartView {
  private chart: IChartApi;
  private series: ISeriesApi<'Candlestick'>;
  private volume: ISeriesApi<'Histogram'>;
  private ltp: LtpPrimitive;
  private ltpAnimator: SmoothPriceAnimator;
  private candles: Candle[] = [];
  private theme: CandleTheme = loadCandleTheme();
  private resizeObs: ResizeObserver;
  private crosshairListeners = new Set<(c: CrosshairInfo | null) => void>();
  private liveListeners = new Set<(atLive: boolean) => void>();
  private atLive = true;
  private intervalMs = 0;
  private watermark: ITextWatermarkPluginApi<Time> | null = null;
  private indicatorSeries = new Map<string, Array<ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>>();
  private analytics: AnalyticsRenderer | null = null;
  private alertSystem: AlertSystem;
  private latencyMonitor: LatencyMonitor;
  private depthHeatmap: DepthHeatmap;
  private volumeProfile: VolumeProfilePanel;
  private alertListeners = new Set<(alerts: any[]) => void>();

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
          enableResize: true,
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
          style: LineStyle.LargeDashed,
          labelBackgroundColor: '#131722',
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: LineStyle.LargeDashed,
          labelBackgroundColor: '#131722',
        },
      },
      autoSize: false,
    });

    this.series = this.chart.addSeries(CandlestickSeries, {
      ...this.theme.options,
      priceLineVisible: false,
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

    this.ltpAnimator = new SmoothPriceAnimator(0.01, (p) => this.onSmoothPriceUpdate(p));

    const pane0 = this.chart.panes()[0];
    if (pane0) {
      this.watermark = createTextWatermark(pane0, {
        lines: [{ text: 'CHART STUDIO', color: 'rgba(255, 255, 255, 0.03)', fontSize: 48 }],
      });
    }

    this.resizeObs = new ResizeObserver(() => {
      this.chart.resize(container.clientWidth, container.clientHeight);
    });
    this.resizeObs.observe(container);

    this.chart.subscribeClick((p) => this.handleClick(p));
    this.chart.subscribeCrosshairMove((p) => this.handleCrosshair(p));
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => this.handleRangeChange(r));

    this.analytics = new AnalyticsRenderer(this.chart, this.series);
    this.analytics.setupSeries();

    this.alertSystem = new AlertSystem();
    this.alertSystem.onAlertsChange((alerts) => {
      for (const fn of this.alertListeners) fn(alerts);
    });

    this.latencyMonitor = new LatencyMonitor();
    this.depthHeatmap = new DepthHeatmap();
    this.volumeProfile = new VolumeProfilePanel();
  }

  setSymbol(symbol: string): void {
    this.watermark?.applyOptions({
      lines: [{ text: symbol.toUpperCase(), color: 'rgba(255, 255, 255, 0.03)', fontSize: 48 }],
    });
  }

  setIntervalMs(ms: number): void {
    this.intervalMs = ms;
  }

  // ── Data ────────────────────────────────────────────────────────────

  setHistory(candles: Candle[]): void {
    this.candles = [...candles].sort((a, b) => a.openTime - b.openTime);
    this.ltpAnimator.flush();

    let precision = 2;
    if (this.candles.length > 0) {
      const sample = this.candles[0]!.close.toString();
      if (sample.includes('.')) {
        precision = Math.max(2, sample.split('.')[1]!.length);
      }
    }
    const tickSize = 1 / Math.pow(10, precision);
    this.ltpAnimator.setTickSize(tickSize);

    this.series.applyOptions({
      priceFormat: {
        type: 'price',
        precision,
        minMove: tickSize,
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

    const last = this.candles[this.candles.length - 1];
    if (last) this.setLastTradePrice(last.close);
  }

  updateCandle(c: Candle): void {
    this.ltpAnimator.flush();
    const t = (c.openTime / 1000) as UTCTimestamp;
    this.series.update({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
    this.volume.update({
      time: t,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(46, 189, 133, 0.35)' : 'rgba(246, 70, 93, 0.35)',
    });

    const last = this.candles[this.candles.length - 1];
    if (last && last.openTime === c.openTime) this.candles[this.candles.length - 1] = c;
    else this.candles.push(c);

    this.ltpAnimator.snapTo(c.close);
  }

  setLastTradePrice(price: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    const last = this.candles[this.candles.length - 1];

    // Interval rollover: create a new candle when the current interval expires.
    if (this.intervalMs > 0 && last && Date.now() >= last.openTime + this.intervalMs) {
      this.ltpAnimator.flush();
      const newOpenTime = Math.floor(Date.now() / this.intervalMs) * this.intervalMs;
      const newCandle: Candle = { openTime: newOpenTime, open: price, high: price, low: price, close: price, volume: 0 };
      this.candles.push(newCandle);
      const t = (newOpenTime / 1000) as UTCTimestamp;
      this.series.update({ time: t, open: price, high: price, low: price, close: price });
      this.volume.update({ time: t, value: 0, color: 'rgba(255, 255, 255, 0.18)' });
      this.ltpAnimator.snapTo(price);
      return;
    }

    // Update real candle data immediately; the animator drives visual updates.
    if (last) {
      this.candles[this.candles.length - 1] = {
        ...last,
        high: Math.max(last.high, price),
        low: Math.min(last.low, price),
        close: price,
      };
    }

    this.ltpAnimator.snapTo(price);
  }

  private onSmoothPriceUpdate(animatedPrice: number): void {
    const last = this.candles[this.candles.length - 1];
    if (!last) return;
    const t = (last.openTime / 1000) as UTCTimestamp;
    // Use real high/low; only close is animated for visual smoothness.
    this.series.update({ time: t, open: last.open, high: last.high, low: last.low, close: animatedPrice });
    const color = animatedPrice >= last.open ? '#2ebd85' : '#f6465d';
    this.ltp.setLtp(animatedPrice, color, t);
  }

  clearLastTradePrice(): void {
    this.ltpAnimator.flush();
    this.ltp.setLtp(null, '#2ebd85', null);
  }

  // ── Indicators ──────────────────────────────────────────────────────

  updateAnalytics(data: {
    ltp: number; atp: number; ltq: number; ltt: number;
    volume: number; totalBuyQty: number; totalSellQty: number;
    oi: number | undefined; highOi: number | undefined; lowOi: number | undefined;
    dayOpen: number; dayHigh: number; dayLow: number; dayClose: number;
    bidOrders: number[] | undefined; askOrders: number[] | undefined;
    prevClose: number | undefined; prevOi: number | undefined;
  }): void {
    if (!this.analytics) return;
    const last = this.candles[this.candles.length - 1];
    if (!last) return;

    const state: AnalyticsState = {
      ltp: data.ltp,
      atp: data.atp,
      volume: data.volume,
      totalBuyQty: data.totalBuyQty,
      totalSellQty: data.totalSellQty,
      oi: data.oi,
      highOi: data.highOi,
      lowOi: data.lowOi,
      dayOpen: data.dayOpen,
      dayHigh: data.dayHigh,
      dayLow: data.dayLow,
      dayClose: data.dayClose,
      prevClose: data.prevClose,
      prevOi: data.prevOi,
      bidOrders: data.bidOrders,
      askOrders: data.askOrders,
      ltq: data.ltq,
      ltt: data.ltt,
      time: (last.openTime / 1000) as UTCTimestamp,
    };

    this.analytics.update(state);
    this.depthHeatmap.update(data.bidOrders, data.askOrders);
    this.volumeProfile.update(data.ltp, 1 / Math.pow(10, this.getPrecision()), data.ltq);

    // Latency monitoring
    if (data.ltt > 0) {
      this.latencyMonitor.recordTick(data.ltt);
    }

    // Alert checking
    const expectedVolume = (data.volume / (Date.now() / 1000 - (last.openTime / 1000))) * 86400;
    this.alertSystem.check({
      ltp: data.ltp,
      atp: data.atp,
      oi: data.oi,
      dayHigh: data.dayHigh,
      dayLow: data.dayLow,
      volume: data.volume,
      totalBuyQty: data.totalBuyQty,
      totalSellQty: data.totalSellQty,
      bidOrders: data.bidOrders,
      askOrders: data.askOrders,
      ltt: data.ltt,
      ltq: data.ltq,
      expectedVolume,
    });
  }

  onAlertsChange(fn: (alerts: any[]) => void): () => void {
    this.alertListeners.add(fn);
    return () => this.alertListeners.delete(fn);
  }

  getLatencyStats() {
    return this.latencyMonitor.getStats();
  }

  renderVolumeProfile(): void {
    this.volumeProfile.render();
  }

  setIndicators(list: ActiveIndicator[]): void {
    for (const seriesList of this.indicatorSeries.values()) {
      for (const s of seriesList) {
        try { this.chart.removeSeries(s); } catch { /* ignore */ }
      }
    }
    this.indicatorSeries.clear();

    if (this.candles.length === 0) return;

    const closes = this.candles.map((c) => c.close);
    const times = this.candles.map((c) => (c.openTime / 1000) as UTCTimestamp);
    const toLineData = (vals: number[]) =>
      times.map((t, i) => ({ time: t, value: vals[i]! })).filter((p) => Number.isFinite(p.value));

    const MA_COLORS  = ['#ff9800', '#2196f3', '#9c27b0', '#4caf50'];
    const EMA_COLORS = ['#ff5722', '#03a9f4', '#8bc34a', '#ffc107'];
    let nextSubPane = 1;

    for (const ind of list) {
      const added: Array<ISeriesApi<'Line'> | ISeriesApi<'Histogram'>> = [];

      switch (ind.defId) {
        case 'MA': {
          ind.params.forEach((period, i) => {
            if (!period) return;
            const s = this.chart.addSeries(LineSeries, {
              color: MA_COLORS[i % MA_COLORS.length]!,
              lineWidth: 1,
              lastValueVisible: false,
              priceLineVisible: false,
              title: `MA${period}`,
            });
            s.setData(toLineData(sma(closes, period)));
            added.push(s);
          });
          break;
        }
        case 'EMA': {
          ind.params.forEach((period, i) => {
            if (!period) return;
            const s = this.chart.addSeries(LineSeries, {
              color: EMA_COLORS[i % EMA_COLORS.length]!,
              lineWidth: 1,
              lastValueVisible: false,
              priceLineVisible: false,
              title: `EMA${period}`,
            });
            s.setData(toLineData(ema(closes, period)));
            added.push(s);
          });
          break;
        }
        case 'BOLL': {
          const [period = 20, mult = 2] = ind.params;
          const { upper, middle, lower } = bollinger(closes, period, mult);
          const midS = this.chart.addSeries(LineSeries, {
            color: '#ff9800', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: `BB(${period})`,
          });
          const upS = this.chart.addSeries(LineSeries, {
            color: 'rgba(255, 152, 0, 0.5)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false,
          });
          const loS = this.chart.addSeries(LineSeries, {
            color: 'rgba(255, 152, 0, 0.5)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false,
          });
          midS.setData(toLineData(middle));
          upS.setData(toLineData(upper));
          loS.setData(toLineData(lower));
          added.push(midS, upS, loS);
          break;
        }
        case 'RSI': {
          const pane = nextSubPane++;
          const [period = 14] = ind.params;
          const s = this.chart.addSeries(LineSeries, {
            color: '#7b1fa2', lineWidth: 1, lastValueVisible: true, priceLineVisible: false, title: `RSI(${period})`,
          }, pane);
          s.setData(toLineData(rsi(closes, period)));
          s.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
          added.push(s);
          break;
        }
        case 'MACD': {
          const pane = nextSubPane++;
          const [fast = 12, slow = 26, signal = 9] = ind.params;
          const { macd: macdLine, signal: sigLine, hist } = macd(closes, fast, slow, signal);
          const histS = this.chart.addSeries(HistogramSeries, {
            lastValueVisible: false, priceLineVisible: false,
          }, pane);
          const macdS = this.chart.addSeries(LineSeries, {
            color: '#2196f3', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: 'MACD',
          }, pane);
          const sigS = this.chart.addSeries(LineSeries, {
            color: '#ff9800', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: 'Signal',
          }, pane);
          histS.setData(
            times
              .map((t, i) => ({ time: t, value: hist[i]!, color: hist[i]! >= 0 ? 'rgba(46, 189, 133, 0.6)' : 'rgba(246, 70, 93, 0.6)' }))
              .filter((p) => Number.isFinite(p.value)),
          );
          macdS.setData(toLineData(macdLine));
          sigS.setData(toLineData(sigLine));
          histS.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
          added.push(histS, macdS, sigS);
          break;
        }
        default:
          break;
      }

      this.indicatorSeries.set(ind.uid, added);
    }
  }

  // ── Theme ───────────────────────────────────────────────────────────

  themes(): readonly CandleTheme[] { return CANDLE_THEMES; }
  currentTheme(): CandleTheme { return this.theme; }
  getPrecision(): number {
    return (this.series.options() as any).priceFormat?.precision ?? 2;
  }

  setTheme(id: string): void {
    const next = CANDLE_THEMES.find((t) => t.id === id);
    if (!next) return;
    this.theme = next;
    saveCandleTheme(id);
    this.series.applyOptions(next.options);
  }

  // ── Drawing layer stubs (klinecharts-style API, no-op until ported) ──

  createOverlay(_opts: unknown): void { /* reserved */ }
  removeAllOverlays(): void { /* reserved */ }

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
    const precision = this.getPrecision();
    const f = (n: number): string =>
      n.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision });
    const info: CrosshairInfo = {
      time: p.time as number,
      open: data.open, high: data.high, low: data.low, close: data.close,
      volume: volData?.value ?? null,
      formattedPrice: f(data.close),
    };
    for (const fn of this.crosshairListeners) fn(info);
  }

  private handleClick(_p: MouseEventParams): void { /* reserved */ }

  private handleRangeChange(range: LogicalRange | null): void {
    if (!range) return;
    const atLive = range.to >= this.candles.length - 1;
    if (atLive !== this.atLive) {
      this.atLive = atLive;
      for (const fn of this.liveListeners) fn(atLive);
    }
  }

  dispose(): void {
    this.ltpAnimator.flush();
    this.resizeObs.disconnect();
    this.depthHeatmap.dispose();
    this.volumeProfile.dispose();
    this.chart.remove();
  }
}

export interface CrosshairInfo {
  time: number;
  open: number; high: number; low: number; close: number;
  volume: number | null;
  formattedPrice: string;
}
