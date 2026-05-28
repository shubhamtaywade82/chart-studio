import {
  createChart,
  createTextWatermark,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
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
  createSeriesMarkers,
} from 'lightweight-charts';
import type { Candle } from './provider-client';
import { CANDLE_THEMES, loadCandleTheme, saveCandleTheme, type CandleTheme } from './chart/candle-themes';
import { LtpPlugin } from './chart/ltp-primitive';
import { RealtimeLinePlugin } from './chart/plugins/realtime-line/RealtimeLinePrimitive';
import { ActiveCandlePlugin } from './chart/plugins/active-candle/ActiveCandlePrimitive';
import { PositionPlugin } from './chart/plugins/positions/PositionPlugin';
import { PriceAlertsPlugin } from './chart/plugins/alerts/PriceAlertsPlugin';
import { ChartEngine } from './chart/engine/ChartEngine';
import { BidAskPlugin } from './chart/bid-ask-primitive';
import { FootprintPlugin } from './chart/footprint-plugin';
import { vwap } from './indicators/math';
import {
  SMA, EMA, RSI, BollingerBands, MACD, ATR, ADX, Stochastic, CCI, OBV, MFI, Supertrend, IchimokuCloud
} from 'lightweight-charts-indicators';
import type { ActiveIndicator } from './indicators/registry';
import { SmcPrimitive } from './chart/smc-primitive';
import { AnalyticsRenderer, type AnalyticsState } from './chart/analytics';
import { AlertSystem } from './chart/alerts';
import { LatencyMonitor, DepthHeatmap, VolumeProfilePanel } from './chart/market-monitor';
import { AIOverlayManager, type AISignal as AISignalUI, type AILevel as AILevelUI, type TradeSetup as TradeSetupUI, type Urgency } from './chart/ai-overlay';
import { klinecharts } from './scripts/klinecharts';


interface AIAnnotationData {
  kind: string;
  ts: number;
  data: unknown;
}

export class ChartView {
  public engine: ChartEngine;
  private _api: IChartApi;
  private series: ISeriesApi<'Candlestick'>;
  private volume: ISeriesApi<'Histogram'>;

  public getMainSeries(): ISeriesApi<'Candlestick'> {
    return this.series;
  }

  public getApi(): IChartApi {
    return this._api;
  }
  
  private ltp: LtpPlugin;
  private realtimeLine: RealtimeLinePlugin;
  private activeCandle: ActiveCandlePlugin;
  private positionPlugin: PositionPlugin;
  private alertsPlugin: PriceAlertsPlugin;
  
  private candles: Candle[] = [];
  private theme: CandleTheme = loadCandleTheme();
  
  private precision: number = 2;
  private cachedCandleWidth = 8;
  private markersPlugin?: any;
  private crosshairListeners = new Set<(c: CrosshairInfo | null) => void>();
  private liveListeners = new Set<(atLive: boolean) => void>();
  private atLive = true;
  private intervalMs = 0;
  private watermark: ITextWatermarkPluginApi<Time> | null = null;
  private indicatorSeries = new Map<string, Array<ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>>();
  private mountedScripts = new Map<string, { lineSeries: Array<ISeriesApi<'Line'>>, histogramSeries: Array<ISeriesApi<'Histogram'>> }>();
  private smcPrimitives = new Set<SmcPrimitive>();
  private analytics: AnalyticsRenderer | null = null;
  private alertSystem: AlertSystem;
  private latencyMonitor: LatencyMonitor;
  private depthHeatmap: DepthHeatmap;
  private volumeProfile: VolumeProfilePanel;
  private aiOverlay: AIOverlayManager;
  private alertListeners = new Set<(alerts: any[]) => void>();
  private lastUpdatedTime: UTCTimestamp | null = null;
  private bidAskPlugin: BidAskPlugin;
  private footprintPlugin: FootprintPlugin;

  constructor(container: HTMLElement) {
    this.engine = new ChartEngine(container, {
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
        vertLines: { color: 'rgba(255, 255, 255, 0.03)', style: LineStyle.Dashed },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)', style: LineStyle.Dashed },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { width: 1, color: 'rgba(255, 255, 255, 0.2)', style: LineStyle.Dashed, labelBackgroundColor: '#1E222D' },
        horzLine: { width: 1, color: 'rgba(255, 255, 255, 0.2)', style: LineStyle.Dashed, labelBackgroundColor: '#1E222D' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        borderVisible: false,
        rightOffset: 8,
        barSpacing: 8,
        tickMarkFormatter: (time: UTCTimestamp) => {
          const d = new Date(time * 1000);
          return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.2 },
        alignLabels: true,
        minimumWidth: 80,
      },
    });

    this._api = this.engine.api;
    this.series = this.engine.series;
    this.volume = this.engine.volume;

    this.ltp = new LtpPlugin();
    this.ltp.attachEngine(this.engine);
    this.realtimeLine = new RealtimeLinePlugin(this.engine);
    this.activeCandle = new ActiveCandlePlugin(this.engine);
    this.positionPlugin = new PositionPlugin(this.engine);
    this.alertsPlugin = new PriceAlertsPlugin();
    this.bidAskPlugin = new BidAskPlugin();
    this.bidAskPlugin.attachEngine(this.engine);
    this.footprintPlugin = new FootprintPlugin();
    
    this.engine.registerPlugin(this.ltp);
    this.engine.registerPlugin(this.realtimeLine);
    this.engine.registerPlugin(this.activeCandle);
    this.engine.registerPlugin(this.positionPlugin);
    this.series.attachPrimitive(this.alertsPlugin);
    this.engine.registerPlugin(this.bidAskPlugin);
    this.series.attachPrimitive(this.footprintPlugin);

    const pane0 = this._api.panes()[0];
    if (pane0) {
      this.watermark = createTextWatermark(pane0, {
        lines: [{ text: 'CHART STUDIO', color: 'rgba(255, 255, 255, 0.03)', fontSize: 48 }],
      });
    }

    this._api.subscribeClick((p) => this.handleClick(p));
    this._api.subscribeCrosshairMove((p) => this.handleCrosshair(p));

    this.engine.bus.onVisibleRangeChanged(({ range }) => {
      this.handleRangeChange(range);
    });

    this.engine.bus.onLiveStateChanged((atLive) => {
      if (atLive !== this.atLive) {
        this.atLive = atLive;
        for (const fn of this.liveListeners) fn(atLive);
      }
    });

    this.analytics = new AnalyticsRenderer(this._api, this.series);
    this.analytics.setupAtpSeries();
    this.indicatorBasePane = 1;

    this.alertSystem = new AlertSystem();
    this.alertSystem.onAlertsChange((alerts) => {
      for (const fn of this.alertListeners) fn(alerts);
    });

    this.latencyMonitor = new LatencyMonitor();
    this.depthHeatmap = new DepthHeatmap();
    this.volumeProfile = new VolumeProfilePanel();
    this.aiOverlay = new AIOverlayManager(this._api, this.series, container);
  }

  public getAnalytics(): AnalyticsRenderer | null {
    return this.analytics;
  }

  /** Day open ms timestamp used to extrapolate expected volume. */
  private dayOpenMs = 0;
  private indicatorBasePane = 1;

  setSymbol(symbol: string): void {
    this.watermark?.applyOptions({
      lines: [{ text: symbol.toUpperCase(), color: 'rgba(255, 255, 255, 0.03)', fontSize: 48 }],
    });
    // Reset all analytics tick-state so a new symbol doesn't inherit deltas
    // from the previous one.
    this.analytics?.reset();
    this.alertSystem.reset();
    this.latencyMonitor.reset();
    this.volumeProfile.reset();
    this.aiOverlay.reset();
    this.positionPlugin.setSymbol(symbol);
    this.dayOpenMs = 0;
  }

  setPositions(positions: any[]): void {
    this.positionPlugin.setPositions(positions);
  }

  setAlerts(alerts: any[]): void {
    this.alertsPlugin.setAlerts(alerts.map(a => ({
      id: a.id,
      price: a.price,
      title: a.note || 'Alert',
      color: '#7c4dff',
    })));
  }

  onAlertMoved(fn: (id: string, price: number) => void): void {
    this.alertsPlugin.onAlertMoved = fn;
  }

  onAlertDeleted(fn: (id: string) => void): void {
    this.alertsPlugin.onAlertDeleted = fn;
  }

  // ── AI overlay wiring ───────────────────────────────────────────────

  applyAISignal(sig: AISignalUI): void {
    if (sig.urgency === 'immediate' || sig.urgency === 'critical') {
      this.aiOverlay.applyNarrative(`[${sig.type.toUpperCase()}] ${sig.narrative}`, sig.urgency as Urgency);
    }
  }

  applyAIAnnotation(ann: AIAnnotationData): void {
    if (!ann || !ann.kind) return;
    switch (ann.kind) {
      case 'tactical': {
        const data = ann.data as { focus_components?: any, regime?: string; levels?: AILevelUI[]; setup?: TradeSetupUI; divergences?: Array<{ type: string; strength: number; description: string }>; narrative?: string; urgency?: Urgency };
        if (data.regime) this.aiOverlay.applyRegime(data.regime);
        if (data.levels) this.aiOverlay.applyLevels(data.levels);
        if (data.setup) this.aiOverlay.applySetup(data.setup);
        if (data.divergences) this.aiOverlay.applyDivergences(data.divergences);
        if (data.narrative) this.aiOverlay.applyNarrative(data.narrative, data.urgency ?? 'watch_only');
        if (data.focus_components) this.aiOverlay.applyFocus(data.focus_components);
        break;
      }
      case 'reflex': {
        const data = ann.data as { regime?: string; toxicity?: number; depthImbalance?: number; derived?: { volatilityRegime?: string; toxicity?: number; cvd?: number } };
        const reg = data.regime ?? data.derived?.volatilityRegime;
        if (reg) this.aiOverlay.applyRegime(reg);
        const tox = data.toxicity ?? data.derived?.toxicity;
        if (typeof tox === 'number') this.aiOverlay.applyToxicity(tox);

        // OI matrix from derived (uses price delta vs prev close inferred locally).
        const last = this.candles[this.candles.length - 1];
        const prevClose = this.candles[Math.max(0, this.candles.length - 2)]?.close ?? 0;
        if (last && prevClose > 0) {
          const priceChange = last.close - prevClose;
          // OI change is in data.derived if we had it; pulled from prior tactical.
          this.aiOverlay.applyOiMatrix(priceChange, this.lastOiChange);
        }
        break;
      }
      case 'narrative': {
        const data = ann.data as { text?: string; urgency?: Urgency };
        if (data.text) this.aiOverlay.applyNarrative(data.text, data.urgency ?? 'watch_only');
        break;
      }
      case 'risk': {
        const data = ann.data as { status?: 'all_clear' | 'yellow' | 'red'; reason?: string };
        this.aiOverlay.applyRisk(data.status ?? 'all_clear', data.reason ?? '');
        break;
      }
      case 'historical_echo': {
        const data = ann.data as { matches?: number; bullishCount?: number };
        this.aiOverlay.applyHistoricalEcho(data.matches ?? 0, data.bullishCount ?? 0);
        break;
      }
      case 'confluence': {
        const data = ann.data as { badges?: Array<{ tf: string; signal: 'bullish' | 'bearish' | 'neutral' }> };
        if (data.badges) this.aiOverlay.applyConfluence(data.badges);
        break;
      }
      case 'correlation': {
        const data = ann.data as { pairs?: Array<{ a: string; b: string; correlation: number }> };
        if (data.pairs) this.aiOverlay.applyCorrelation(data.pairs);
        break;
      }
      case 'strategy_signal': {
        const data = ann.data as { htfBias?: string };
        if (data.htfBias) this.aiOverlay.applyHtfBias(data.htfBias);
        break;
      }
      default:
        break;
    }
  }

  /** Cache last OI change from tactical layer for use by reflex OI matrix render. */
  private lastOiChange = 0;
  setLastOiChange(v: number): void { this.lastOiChange = v; }

  setIntervalMs(ms: number): void {
    this.intervalMs = ms;
  }

  // ── Data ────────────────────────────────────────────────────────────

  private getDecimalPrecision(n: number): number {
    if (!Number.isFinite(n) || n === 0) return 2;
    const str = n.toString();
    if (str.includes('e-')) {
      const parts = str.split('e-');
      const baseDecimals = parts[0].includes('.') ? parts[0].split('.')[1].length : 0;
      return parseInt(parts[1], 10) + baseDecimals;
    }
    if (str.includes('.')) {
      return str.split('.')[1].length;
    }
    return 2;
  }

  private autoDetectPrecision(prices: number[]): void {
    let p = this.precision;
    for (const val of prices) {
      p = Math.max(p, this.getDecimalPrecision(val));
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

  setHistory(history: Candle[]): void {
    if (history.length === 0) {
      this.candles = [];
      this.series.setData([]);
      this.volume.setData([]);
      this.lastUpdatedTime = null;
      return;
    }

    // Merge history with existing candles to avoid losing recent live updates
    // if the history snapshot is slightly stale (common with CDN/cache delays).
    const map = new Map<number, Candle>();
    for (const c of this.candles) map.set(c.openTime, c);
    for (const c of history) map.set(c.openTime, c);

    this.candles = Array.from(map.values()).sort((a, b) => a.openTime - b.openTime);
    this.engine.setCandles(this.candles);
    
    this.engine.motion.reset();
    const last = this.candles[this.candles.length - 1];
    if (last) {
      this.lastUpdatedTime = Math.floor(last.openTime / 1000) as UTCTimestamp;
    }

    // Auto-detect precision based on first few candles
    let precision = 2;
    if (this.candles.length > 0) {
      precision = Math.max(2, Math.min(15, this.getDecimalPrecision(this.candles[0]!.close)));
    }
    const tickSize = 1 / Math.pow(10, precision);

    this.series.applyOptions({
      priceFormat: {
        type: 'price',
        precision,
        minMove: tickSize,
      },
    });

    const cs = this.candles.map((c, i) => ({
      time: Math.floor(c.openTime / 1000) as UTCTimestamp,
      open: c.open, high: c.high, low: c.low, close: c.close,
      ...(i === this.candles.length - 1 ? { color: 'rgba(0,0,0,0)', wickColor: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)' } : {})
    }));
    const vs = this.candles.map((c) => ({
      time: Math.floor(c.openTime / 1000) as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? (this.theme.volumeUp ?? 'rgba(46, 189, 133, 0.35)') : (this.theme.volumeDown ?? 'rgba(246, 70, 93, 0.35)'),
    }));
    
    this.series.setData(cs);
    this.volume.setData(vs);

    // Ensure price scale fits the new data
    this._api.priceScale('right').applyOptions({ autoScale: true });
    
    if (last) this.setLastTradePrice(last.close);

    for (const smc of this.smcPrimitives) {
      smc.setCandles(this.candles);
    }
  }

  private updateCandleState(c: Candle): void {
    const last = this.candles[this.candles.length - 1];
    if (last && last.openTime === c.openTime) {
      this.candles[this.candles.length - 1] = c;
    } else if (!last || c.openTime > last.openTime) {
      this.candles.push(c);
    } else {
      // Out of order update: find and replace or insert
      const idx = this.candles.findIndex((x) => x.openTime === c.openTime);
      if (idx >= 0) {
        this.candles[idx] = c;
      } else {
        this.candles.push(c);
        this.candles.sort((a, b) => a.openTime - b.openTime);
      }
    }
  }

  private lastSeriesUpdateTs = 0;

  updateCandle(c: Candle): void {
    const t = Math.floor(c.openTime / 1000) as UTCTimestamp;
    if (Number.isNaN(t)) return;

    // Check if we actually need a native update before mutating state
    const last = this.candles[this.candles.length - 1];
    const isLiveUpdate = last && c.openTime === last.openTime;
    let needsNativeUpdate = true;
    
    if (isLiveUpdate) {
      const boundsChanged = c.high !== last.high || c.low !== last.low;
      const now = Date.now();
      const timeSinceLastUpdate = now - this.lastSeriesUpdateTs;
      
      // Update natively if bounds expanded, or at most 5 times a second (200ms throttle)
      // to keep volume and scales reasonably up to date without choking the main thread.
      if (!boundsChanged && timeSinceLastUpdate < 200) {
        needsNativeUpdate = false;
      }
    }

    // Always update internal state for primitives immediately.
    this.updateCandleState(c);

    // Lightweight charts: update() can only add a new bar or update the LATEST one.
    // If t < lastUpdatedTime, it's an out-of-order update (e.g. sealed bar arrived late).
    if (!this.lastUpdatedTime || t >= this.lastUpdatedTime) {
      if (needsNativeUpdate) {
        try {
          // If a new bar started, finalize the PREVIOUS one first (reset its visibility).
          if (this.lastUpdatedTime && t > this.lastUpdatedTime) {
            const prevIndex = this.candles.findIndex(x => Math.floor(x.openTime / 1000) === this.lastUpdatedTime);
            const prev = prevIndex >= 0 ? this.candles[prevIndex] : null;
            if (prev) {
              this.series.update({
                time: this.lastUpdatedTime,
                open: prev.open, high: prev.high, low: prev.low, close: prev.close,
                color: undefined, wickColor: undefined, borderColor: undefined
              });
            }
          }

          // The most recent candle in state is always rendered "hidden" (transparent) 
          // because the Animator/Motion engine draws the visual representation.
          const isLatestInState = c.openTime === this.candles[this.candles.length - 1]?.openTime;
          const colorOpts = isLatestInState
            ? { color: 'rgba(0,0,0,0)', wickColor: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)' } 
            : { color: undefined, wickColor: undefined, borderColor: undefined };
          
          this.series.update({ time: t, open: c.open, high: c.high, low: c.low, close: c.close, ...colorOpts });
          
          const volValue = isLatestInState ? (this.engine.volumeMotion.getCurrent() ?? c.volume) : c.volume;
          this.volume.update({
            time: t,
            value: volValue,
            color: c.close >= c.open ? (this.theme.volumeUp ?? 'rgba(46, 189, 133, 0.35)') : (this.theme.volumeDown ?? 'rgba(246, 70, 93, 0.35)'),
          });
          
          this.lastUpdatedTime = t;
          this.lastSeriesUpdateTs = Date.now();
        } catch (e) {
          console.warn('[chart] failed to update bar', e);
        }
      }
    } else {
      // Historical or late update: refresh entire series to show the finalized previous bar.
      this.refreshChartData();
    }

    // Visual smoothness for the live bar.
    const currentLast = this.candles[this.candles.length - 1];
    if (currentLast && c.openTime === currentLast.openTime) {
      this.engine.motion.setTarget(c.close);
      this.engine.volumeMotion.setTarget(c.volume);
      this.engine.scheduler.requestContinuousRender();
    }

    for (const smc of this.smcPrimitives) {
      smc.setCandles(this.candles);
    }
    this.footprintPlugin.setCandles(this.candles, this.intervalMs);
  }

  private refreshChartData(): void {
    const cs = this.candles.map((c, i) => ({
      time: Math.floor(c.openTime / 1000) as UTCTimestamp,
      open: c.open, high: c.high, low: c.low, close: c.close,
      ...(i === this.candles.length - 1 ? { color: 'rgba(0,0,0,0)', wickColor: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)' } : {})
    }));
    const vs = this.candles.map((c) => ({
      time: Math.floor(c.openTime / 1000) as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? (this.theme.volumeUp ?? 'rgba(46, 189, 133, 0.35)') : (this.theme.volumeDown ?? 'rgba(246, 70, 93, 0.35)'),
    }));
    this.series.setData(cs);
    this.volume.setData(vs);
    const last = cs[cs.length - 1];
    if (last) this.lastUpdatedTime = last.time;
    this.footprintPlugin.setPrecision(this.getPrecision());
    this.footprintPlugin.setCandles(this.candles, this.intervalMs);
  }

  public pushTrade(t: any): void {
    this.footprintPlugin.pushTrade(t);
  }

  setLastTradePrice(price: number, timestampMs?: number, qty?: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    const currentTime = timestampMs ?? Date.now();
    const last = this.candles[this.candles.length - 1];

    // Interval rollover: create a new candle when the current interval expires.
    if (this.intervalMs > 0 && last && currentTime >= last.openTime + this.intervalMs) {
      const newOpenTime = Math.floor(currentTime / this.intervalMs) * this.intervalMs;
      const newCandle: Candle = { openTime: newOpenTime, open: price, high: price, low: price, close: price, volume: qty ?? 0 };
      const t = Math.floor(newOpenTime / 1000) as UTCTimestamp;

      if (!this.lastUpdatedTime || t >= this.lastUpdatedTime) {
        try {
          // Finalize previous bar if rollover
          if (this.lastUpdatedTime && t > this.lastUpdatedTime) {
            const prevT = Math.floor(last.openTime / 1000) as UTCTimestamp;
            if (prevT === this.lastUpdatedTime) {
              this.series.update({ time: prevT, open: last.open, high: last.high, low: last.low, close: last.close, color: undefined, wickColor: undefined, borderColor: undefined });
            }
          }

          this.series.update({ time: t, open: price, high: price, low: price, close: price, color: 'rgba(0,0,0,0)', wickColor: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)' });
          this.volume.update({
            time: t,
            value: this.engine.volumeMotion.getCurrent() ?? newCandle.volume,
            color: 'rgba(255, 255, 255, 0.18)',
          });
          this.lastUpdatedTime = t;
        } catch (e) {
          console.warn('[chart] failed to start new bar on rollover', e);
        }
      }
      this.updateCandleState(newCandle);
      this.engine.motion.setTarget(price);
      this.engine.volumeMotion.setTarget(newCandle.volume);
      this.engine.scheduler.requestContinuousRender();
      return;
    }

    // Update internal candle data immediately.
    if (last) {
      const candleOpenTime = this.intervalMs > 0 ? Math.floor(currentTime / this.intervalMs) * this.intervalMs : last.openTime;
      if (candleOpenTime === last.openTime) {
        this.candles[this.candles.length - 1] = {
          ...last,
          high: Math.max(last.high, price),
          low: Math.min(last.low, price),
          close: price,
          volume: last.volume + (qty ?? 0),
        };
      } else if (currentTime > last.openTime) {
        const newCandle: Candle = { openTime: candleOpenTime, open: price, high: price, low: price, close: price, volume: qty ?? 0 };
        this.updateCandleState(newCandle);
      }
    } else {
      // Bootstrap first candle
      const openTime = this.intervalMs > 0 ? Math.floor(currentTime / this.intervalMs) * this.intervalMs : currentTime;
      const newCandle: Candle = { openTime, open: price, high: price, low: price, close: price, volume: qty ?? 0 };
      const t = Math.floor(openTime / 1000) as UTCTimestamp;
      if (!this.lastUpdatedTime || t >= this.lastUpdatedTime) {
        try {
          this.series.update({ time: t, open: price, high: price, low: price, close: price, color: 'rgba(0,0,0,0)', wickColor: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)' });
          this.volume.update({
            time: t,
            value: this.engine.volumeMotion.getCurrent() ?? newCandle.volume,
            color: 'rgba(255, 255, 255, 0.18)',
          });
          this.lastUpdatedTime = t;
        } catch (e) {
          console.warn('[chart] failed to bootstrap series', e);
        }
      }
      this.updateCandleState(newCandle);
    }

    // drive visual smoothness via animator.
    this.engine.motion.setTarget(price);
    const updatedLast = this.candles[this.candles.length - 1];
    if (updatedLast) this.engine.volumeMotion.setTarget(updatedLast.volume);
    this.engine.scheduler.requestContinuousRender();
    
    // update LTP
    if (last) {
      const color = price >= last.open ? '#2ebd85' : '#f6465d';
      const t = Math.floor(last.openTime / 1000) as UTCTimestamp;
      this.ltp.setLtp(price, color, t);
      if (this.intervalMs > 0) this.ltp.setBarTiming(this.intervalMs, last.openTime);
    }

    // Record trade for CandleScope pulse ring and footprint
    if (qty !== undefined && qty > 0) {
      const priceY = this.series.priceToCoordinate(price);
      if (priceY !== null) {
        const isBuy = last ? price >= last.close : true;
        this.activeCandle.recordTrade(price, priceY, qty, isBuy);
      }
    }
  }

  clearLastTradePrice(): void {
    this.candles = [];
    this.engine.setCandles(this.candles);
    this.series.setData([]);
    this.volume.setData([]);
    this.engine.motion.reset();
    this.engine.volumeMotion.reset();
    this.lastUpdatedTime = null;
    this.ltp.setLtp(null, '#2ebd85', null);
    this.bidAskPlugin.setPrices(null, null);
  }

  setBookTicker(bestBidPrice: number, bestAskPrice: number, bestBidQty = 0, bestAskQty = 0): void {
    this.bidAskPlugin.setPrices(bestBidPrice, bestAskPrice);
    // Forward top-of-book to CandleScope for the spread bracket
    this.activeCandle.setBookTicker(bestBidPrice, bestBidQty, bestAskPrice, bestAskQty);
  }

  setCandleScopeEnabled(enabled: boolean): void {
    this.activeCandle.setEnabled(enabled);
  }

  setRealtimeLineEnabled(enabled: boolean): void {
    this.realtimeLine.setEnabled(enabled);
  }

  setFootprintEnabled(enabled: boolean): void {
    this.footprintPlugin.setEnabled(enabled);
  }

  // ── Indicators ──────────────────────────────────────────────────────

  updateAnalytics(data: {
    ltp: number; atp: number; ltq: number; ltt: number;
    volume: number; totalBuyQty: number; totalSellQty: number;
    oi: number | undefined; highOi: number | undefined; lowOi: number | undefined;
    dayOpen: number; dayHigh: number; dayLow: number; dayClose: number;
    depthBids: Array<{ price: number; qty: number; orders: number }> | undefined;
    depthAsks: Array<{ price: number; qty: number; orders: number }> | undefined;
    prevClose: number | undefined; prevOi: number | undefined;
    optionChain?: any;
  }): void {
    if (!this.analytics) return;
    const last = this.candles[this.candles.length - 1];
    if (!last) return;
    
    if (data.optionChain) {
      this.analytics.updateOptionChain(data.optionChain);
    }

    // Lazily anchor dayOpenMs to the FIRST tick that carries a valid dayOpen,
    // so expectedVolume extrapolates over real session time, not candle age.
    if (this.dayOpenMs === 0 && data.dayOpen > 0) {
      const now = new Date();
      const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      ist.setHours(9, 15, 0, 0);
      this.dayOpenMs = ist.getTime();
    }

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
      bidOrders: data.depthBids?.map((b) => b.orders),
      askOrders: data.depthAsks?.map((a) => a.orders),
      ltq: data.ltq,
      ltt: data.ltt,
      time: Math.floor(last.openTime / 1000) as UTCTimestamp,
    };

    this.analytics.update(state);
    this.depthHeatmap.update(data.depthBids, data.depthAsks);

    // Feed live depth + order flow into the CandleScope overlay
    if (data.depthBids && data.depthAsks) {
      this.activeCandle.setDepth(data.depthBids, data.depthAsks);
    }
    this.activeCandle.setOrderFlow(data.totalBuyQty, data.totalSellQty);
    this.updateVolumeProfile(data.ltp, data.ltq);

    if (data.ltt > 0) this.latencyMonitor.recordTick(data.ltt);

    // Compute alert inputs from REAL depth quantities (not order counts) and
    // extrapolate expected volume over a 6.5-hour session, not candle age.
    const bidQtyTotal = data.depthBids?.reduce((a, b) => a + b.qty, 0) ?? 0;
    const askQtyTotal = data.depthAsks?.reduce((a, b) => a + b.qty, 0) ?? 0;
    const SESSION_SEC = 6.5 * 3600;
    let expectedVolume = 0;
    if (this.dayOpenMs > 0 && data.volume > 0) {
      const elapsedSec = Math.max(1, (Date.now() - this.dayOpenMs) / 1000);
      expectedVolume = (data.volume / elapsedSec) * SESSION_SEC;
    }
    const tradesPerSec = this.latencyMonitor.getStats().tradesPerSec;

    this.alertSystem.check({
      ltp: data.ltp,
      atp: data.atp,
      oi: data.oi,
      dayHigh: data.dayHigh,
      dayLow: data.dayLow,
      volume: data.volume,
      totalBuyQty: data.totalBuyQty,
      totalSellQty: data.totalSellQty,
      bidQtyTotal,
      askQtyTotal,
      tradesPerSec,
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

  public applyTheme(theme: CandleTheme): void {
    this.engine.applyTheme(theme);
    
    // Update Indicators
    for (const instances of this.indicatorSeries.values()) {
      for (const inst of instances) {
        if ('color' in inst.options()) {
          inst.applyOptions({ color: theme.options.upColor || '#2ebd85' });
        }
      }
    }
  }

  updateVolumeProfile(price: number, qty: number): void {
    const precision = this.getPrecision();
    const tickSize = 1 / Math.pow(10, precision);
    this.volumeProfile.update(price, tickSize, qty);
  }

  renderVolumeProfile(): void {
    this.volumeProfile.render();
  }

  setIndicators(list: ActiveIndicator[]): void {
    for (const seriesList of this.indicatorSeries.values()) {
      for (const s of seriesList) {
        try { this._api.removeSeries(s); } catch { /* ignore */ }
      }
    }
    this.indicatorSeries.clear();

    for (const smc of this.smcPrimitives) {
      try { this.series.detachPrimitive(smc); } catch { /* ignore */ }
    }
    this.smcPrimitives.clear();

    // Clean up dynamic analytics sub-panes
    this.analytics?.removeCvdSeries();
    this.analytics?.removeOiSeries();

    if (this.candles.length === 0) return;

    const bars = this.candles.map((c) => ({
      time: Math.floor(c.openTime / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    const MA_COLORS  = ['#ff9800', '#2196f3', '#9c27b0', '#4caf50'];
    const EMA_COLORS = ['#ff5722', '#03a9f4', '#8bc34a', '#ffc107'];
    
    // Sub-pane indices start after CVD (1) and OI (2).
    let nextSubPane = this.indicatorBasePane;

    for (const ind of list) {
      const added: Array<ISeriesApi<'Line'> | ISeriesApi<'Histogram'>> = [];

      switch (ind.defId) {
        case 'CVD': {
          const pane = nextSubPane++;
          this.analytics?.setupCvdSeries(pane);
          break;
        }
        case 'OI': {
          const pane = nextSubPane++;
          this.analytics?.setupOiSeries(pane);
          break;
        }
        case 'MA': {
          const [period = 20] = ind.params;
          const res = SMA.calculate(bars, { len: period });
          const s = this._api.addSeries(LineSeries, {
            color: MA_COLORS[0]!,
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
            title: `MA(${period})`,
          });
          s.setData(res.plots.plot0 ?? []);
          added.push(s);
          break;
        }
        case 'EMA': {
          const [period = 9] = ind.params;
          const res = EMA.calculate(bars, { length: period });
          const s = this._api.addSeries(LineSeries, {
            color: EMA_COLORS[0]!,
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
            title: `EMA(${period})`,
          });
          s.setData(res.plots.plot0 ?? []);
          added.push(s);
          break;
        }
        case 'BOLL': {
          const [period = 20, mult = 2] = ind.params;
          const res = BollingerBands.calculate(bars, { length: period, mult });
          const midS = this._api.addSeries(LineSeries, {
            color: '#ff9800', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: `BB(${period})`,
          });
          const upS = this._api.addSeries(LineSeries, {
            color: 'rgba(255, 152, 0, 0.5)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false,
          });
          const loS = this._api.addSeries(LineSeries, {
            color: 'rgba(255, 152, 0, 0.5)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false,
          });
          midS.setData(res.plots.plot0 ?? []);
          upS.setData(res.plots.plot1 ?? []);
          loS.setData(res.plots.plot2 ?? []);
          added.push(midS, upS, loS);
          break;
        }
        case 'SAR': {
          const [start = 0.02, step = 0.02, max = 0.2] = ind.params;
          // Note: Library name might differ, assuming 'ParabolicSAR' or similar if not SAR.
          // But I imported 'SMA', 'EMA'... let's check if I have SAR.
          // For now I'll use placeholders for ones I'm unsure of and check.
          break;
        }
        case 'RSI': {
          const pane = nextSubPane++;
          const [period = 14] = ind.params;
          const res = RSI.calculate(bars, { length: period });
          const s = this._api.addSeries(LineSeries, {
            color: '#7b1fa2', lineWidth: 1, lastValueVisible: true, priceLineVisible: false, title: `RSI(${period})`,
          }, pane);
          s.setData(res.plots.plot0 ?? []);
          s.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
          added.push(s);
          break;
        }
        case 'MACD': {
          const pane = nextSubPane++;
          const [fast = 12, slow = 26, signal = 9] = ind.params;
          const res = MACD.calculate(bars, { fastLength: fast, slowLength: slow, signalLength: signal });
          const macdLine = this._api.addSeries(LineSeries, {
            color: '#2196f3', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: 'MACD',
          }, pane);
          const signalLine = this._api.addSeries(LineSeries, {
            color: '#ff5252', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: 'Signal',
          }, pane);
          const hist = this._api.addSeries(HistogramSeries, {
            color: '#4caf50', lastValueVisible: false, priceLineVisible: false,
          }, pane);
          
          macdLine.setData(res.plots.plot0 ?? []);
          signalLine.setData(res.plots.plot1 ?? []);
          hist.setData((res.plots.plot2 ?? []).map(p => ({
            ...p,
            color: (p.value ?? 0) >= 0 ? '#4caf50aa' : '#ff5252aa'
          })));
          
          added.push(macdLine, signalLine, hist);
          break;
        }
        case 'ATR': {
          const pane = nextSubPane++;
          const [period = 14] = ind.params;
          const res = ATR.calculate(bars, { length: period });
          const s = this._api.addSeries(LineSeries, {
            color: '#607d8b', lineWidth: 1, lastValueVisible: true, priceLineVisible: false, title: `ATR(${period})`,
          }, pane);
          s.setData(res.plots.plot0 ?? []);
          added.push(s);
          break;
        }
        case 'ADX': {
          const pane = nextSubPane++;
          const [period = 14] = ind.params;
          const res = ADX.calculate(bars, { adxSmoothing: period, diLength: period });
          const adx = this._api.addSeries(LineSeries, { color: '#ffeb3b', title: 'ADX' }, pane);
          const plusDI = this._api.addSeries(LineSeries, { color: '#4caf50', title: '+DI' }, pane);
          const minusDI = this._api.addSeries(LineSeries, { color: '#ff5252', title: '-DI' }, pane);
          adx.setData(res.plots.plot0 ?? []);
          plusDI.setData(res.plots.plot1 ?? []);
          minusDI.setData(res.plots.plot2 ?? []);
          added.push(adx, plusDI, minusDI);
          break;
        }
        case 'SUPERTREND': {
          const [period = 10, mult = 3] = ind.params;
          const res = Supertrend.calculate(bars, { atrPeriod: period, factor: mult });
          const s = this._api.addSeries(LineSeries, {
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            title: 'SuperTrend',
          });
          const plot0 = res.plots.plot0 ?? [];
          const plot1 = res.plots.plot1 ?? [];
          s.setData(plot0.map((p, i) => ({
            ...p,
            color: (plot1[i]?.value ?? 0) === 1 ? '#4caf50' : '#ff5252'
          })));
          added.push(s);
          break;
        }
        case 'ICHIMOKU': {
          const [conversion = 9, base = 26, spanB = 52, displacement = 26] = ind.params;
          const res = IchimokuCloud.calculate(bars, { conversionPeriods: conversion, basePeriods: base, laggingSpan2Periods: spanB, displacement });
          const tenkan = this._api.addSeries(LineSeries, { color: '#2196f3', title: 'Tenkan' });
          const kijun = this._api.addSeries(LineSeries, { color: '#f44336', title: 'Kijun' });
          const spanA = this._api.addSeries(LineSeries, { color: '#4caf50', title: 'Span A' });
          const spanBSeries = this._api.addSeries(LineSeries, { color: '#ff9800', title: 'Span B' });
          tenkan.setData(res.plots.plot0 ?? []);
          kijun.setData(res.plots.plot1 ?? []);
          spanA.setData(res.plots.plot2 ?? []);
          spanBSeries.setData(res.plots.plot3 ?? []);
          added.push(tenkan, kijun, spanA, spanBSeries);
          break;
        }
        case 'STOCH': {
          const pane = nextSubPane++;
          const [k = 14, kSmooth = 3, dSmooth = 3] = ind.params;
          const res = Stochastic.calculate(bars, { periodK: k, smoothK: kSmooth, periodD: dSmooth });
          const kLine = this._api.addSeries(LineSeries, { color: '#2196f3', title: '%K' }, pane);
          const dLine = this._api.addSeries(LineSeries, { color: '#ff9800', title: '%D' }, pane);
          kLine.setData(res.plots.plot0 ?? []);
          dLine.setData(res.plots.plot1 ?? []);
          added.push(kLine, dLine);
          break;
        }
        case 'CCI': {
          const pane = nextSubPane++;
          const [period = 20] = ind.params;
          const res = CCI.calculate(bars, { length: period });
          const s = this._api.addSeries(LineSeries, { color: '#9c27b0', title: `CCI(${period})` }, pane);
          s.setData(res.plots.plot0 ?? []);
          added.push(s);
          break;
        }
        case 'OBV': {
          const pane = nextSubPane++;
          const res = OBV.calculate(bars, {});
          const s = this._api.addSeries(LineSeries, { color: '#4caf50', title: 'OBV' }, pane);
          s.setData(res.plots.plot0 ?? []);
          added.push(s);
          break;
        }
        case 'MFI': {
          const pane = nextSubPane++;
          const [period = 14] = ind.params;
          const res = MFI.calculate(bars, { length: period });
          const s = this._api.addSeries(LineSeries, { color: '#00bcd4', title: `MFI(${period})` }, pane);
          s.setData(res.plots.plot0 ?? []);
          added.push(s);
          break;
        }
        case 'VWAP': {
          const res = vwap(this.candles);
          const s = this._api.addSeries(LineSeries, { color: '#7c4dff', title: 'VWAP', lineWidth: 2 });
          const times = this.candles.map((c) => Math.floor(c.openTime / 1000) as UTCTimestamp);
          s.setData(times.map((t, i) => ({ time: t, value: res[i]! })).filter(p => Number.isFinite(p.value)));
          added.push(s);
          break;
        }
        case 'SMC': {
          const [period = 5] = ind.params;
          const smc = new SmcPrimitive(this.aiOverlay, period);
          smc.setCandles(this.candles);
          this.series.attachPrimitive(smc);
          this.smcPrimitives.add(smc);
          break;
        }        default:
          break;
      }

      this.indicatorSeries.set(ind.uid, added);
    }
  }

  // ── Theme ───────────────────────────────────────────────────────────

  themes(): readonly CandleTheme[] { return CANDLE_THEMES; }
  currentTheme(): CandleTheme { return this.theme; }
  getPrecision(): number {
    const p = (this.series.options() as any).priceFormat?.precision ?? 2;
    return Math.min(20, Math.max(0, p));
  }

  setTheme(id: string): void {
    const next = CANDLE_THEMES.find((t) => t.id === id);
    if (!next) return;
    this.theme = next;
    saveCandleTheme(id);
    this.series.applyOptions(next.options);
    
    // Refresh volume series with new theme colors
    const vs = this.candles.map((c) => ({
      time: Math.floor(c.openTime / 1000) as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? (next.volumeUp ?? 'rgba(46, 189, 133, 0.35)') : (next.volumeDown ?? 'rgba(246, 70, 93, 0.35)'),
    }));
    this.volume.setData(vs);
  }

  // ── Drawing layer stubs (klinecharts-style API, no-op until ported) ──

  createOverlay(_opts: unknown): void { /* reserved */ }
  removeAllOverlays(): void { /* reserved */ }

  applyRegisteredIndicator(scriptId: string, indicatorName: string, outputs: any[]): void {
    const def = klinecharts.getIndicator(indicatorName);
    if (!def) return;

    let mounted = this.mountedScripts.get(scriptId);
    if (!mounted) {
      mounted = { lineSeries: [], histogramSeries: [] };
      this.mountedScripts.set(scriptId, mounted);
    }

    // Remove previous series
    for (const s of mounted.lineSeries) { try { this._api.removeSeries(s); } catch {} }
    for (const s of mounted.histogramSeries) { try { this._api.removeSeries(s); } catch {} }
    mounted.lineSeries = [];
    mounted.histogramSeries = [];

    // Compute values
    const dataList = this.candles;
    const calcResults = def.calc(dataList, def);

    const times = this.candles.map(c => Math.floor(c.openTime / 1000) as UTCTimestamp);

    // Draw figures
    for (const fig of def.figures || []) {
      const color = fig.color || '#58a6ff';
      if (fig.type === 'bar') {
        const s = this._api.addSeries(HistogramSeries, { color, priceLineVisible: false, lastValueVisible: false });
        const data = calcResults.map((row: any, i: number) => ({
          time: times[i]!,
          value: row[fig.key],
          color
        })).filter(p => p.time !== null && Number.isFinite(p.value));
        s.setData(data);
        mounted.histogramSeries.push(s);
      } else {
        const s = this._api.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false
        });
        const data = calcResults.map((row: any, i: number) => ({
          time: times[i]!,
          value: row[fig.key]
        })).filter(p => p.time !== null && Number.isFinite(p.value));
        s.setData(data);
        mounted.lineSeries.push(s);
      }
    }

    // Render markers if any
    const markers: any[] = [];
    for (const out of outputs) {
      if (out.kind === 'marker') {
        for (const m of out.markers) {
          if (typeof m.time !== 'number') continue;
          markers.push({
            time: (m.time / 1000) as UTCTimestamp,
            position: m.position || 'aboveBar',
            color: m.color || '#58a6ff',
            shape: m.shape || 'circle',
            text: m.text || ''
          });
        }
      }
    }

    if (markers.length > 0) {
      markers.sort((a, b) => a.time - b.time);
      if (!this.markersPlugin) {
        this.markersPlugin = createSeriesMarkers(this.series, markers);
      } else {
        this.markersPlugin.setMarkers(markers);
      }
    } else if (this.markersPlugin) {
      this.markersPlugin.setMarkers([]);
    }
  }

  removeMountedScript(scriptId: string): void {
    const mounted = this.mountedScripts.get(scriptId);
    if (mounted) {
      for (const s of mounted.lineSeries) { try { this._api.removeSeries(s); } catch {} }
      for (const s of mounted.histogramSeries) { try { this._api.removeSeries(s); } catch {} }
      this.mountedScripts.delete(scriptId);
    }
  }

  clearAllMountedScripts(): void {
    for (const scriptId of Array.from(this.mountedScripts.keys())) {
      this.removeMountedScript(scriptId);
    }
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
    this._api.timeScale().scrollToRealTime();
  }

  xToTime(x: number): UTCTimestamp | null {
    return this._api.timeScale().coordinateToTime(x) as UTCTimestamp | null;
  }

  yToPrice(y: number): number | null {
    return this.series.coordinateToPrice(y);
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

  private updateCandleWidth(range?: LogicalRange | null): void {
    const timeScale = this._api.timeScale();
    const visibleRange = range || timeScale.getVisibleLogicalRange();
    if (visibleRange && visibleRange.to > visibleRange.from) {
      const barSpacing = timeScale.width() / (visibleRange.to - visibleRange.from);
      let cw = Math.max(1, Math.floor(barSpacing * 0.75));
      if (cw % 2 !== 0 && cw > 1) cw += 1;
      this.cachedCandleWidth = cw;
    }
  }

  private handleRangeChange(range: LogicalRange | null): void {
    if (!range) return;
    this.updateCandleWidth(range);
    const atLive = range.to >= this.candles.length - 1;
    if (atLive !== this.atLive) {
      this.atLive = atLive;
      for (const fn of this.liveListeners) fn(atLive);
    }
    // Lazy-load older history when the user scrolls left and we're within the
    // first ~10 bars of the loaded window.
    if (range.from < 10 && this.candles.length > 0 && this.onLoadOlder && !this.olderLoading) {
      this.olderLoading = true;
      const oldest = this.candles[0]!.openTime;
      void this.onLoadOlder(oldest).finally(() => { this.olderLoading = false; });
    }
  }

  private olderLoading = false;
  private onLoadOlder: ((endTime: number) => Promise<void>) | null = null;
  setLoadOlderCallback(fn: (endTime: number) => Promise<void>): void { this.onLoadOlder = fn; }

  /** Prepend older candles without resetting visible range. */
  prependHistory(older: Candle[]): void {
    if (older.length === 0) return;
    const existing = new Set(this.candles.map((c) => c.openTime));
    const fresh = older.filter((c) => !existing.has(c.openTime));
    if (fresh.length === 0) return;
    this.candles = [...fresh, ...this.candles].sort((a, b) => a.openTime - b.openTime);
    this.engine.setCandles(this.candles);
    const cs = this.candles.map((c, i) => ({
      time: Math.floor(c.openTime / 1000) as UTCTimestamp,
      open: c.open, high: c.high, low: c.low, close: c.close,
      ...(i === this.candles.length - 1 ? { color: 'rgba(0,0,0,0)', wickColor: 'rgba(0,0,0,0)', borderColor: 'rgba(0,0,0,0)' } : {})
    }));
    const vs = this.candles.map((c) => ({
      time: Math.floor(c.openTime / 1000) as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(46, 189, 133, 0.35)' : 'rgba(246, 70, 93, 0.35)',
    }));
    this.series.setData(cs);
    this.volume.setData(vs);
    for (const smc of this.smcPrimitives) smc.setCandles(this.candles);
  }

  public setCandles(candles: Candle[], intervalMs: number = 0): void {
    this.candles = candles;
    this.engine.setCandles(candles);
    this.intervalMs = intervalMs;
    this.refreshChartData();
    for (const smc of this.smcPrimitives) smc.setCandles(candles);
  }

  dispose(): void {
    this.engine.destroy();
    this.engine.unregisterPlugin(this.ltp.id);
    this.analytics?.reset();
    this.alertSystem.reset();
    this.latencyMonitor.reset();
    this.volumeProfile.reset();
    this.depthHeatmap.dispose();
    this.volumeProfile.dispose();
    this.aiOverlay.reset();
    this.crosshairListeners.clear();
    this.liveListeners.clear();
    this.alertListeners.clear();
    // Drop indicator series before chart.remove() so requestUpdate hooks
    // do not see a partially-torn-down chart.
    for (const seriesList of this.indicatorSeries.values()) {
      for (const s of seriesList) {
        try { this._api.removeSeries(s); } catch { /* noop */ }
      }
    }
    this.indicatorSeries.clear();
    this.clearAllMountedScripts();
    this._api.remove();
  }
}

export interface CrosshairInfo {
  time: number;
  open: number; high: number; low: number; close: number;
  volume: number | null;
  formattedPrice: string;
}

