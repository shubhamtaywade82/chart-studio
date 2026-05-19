import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineWidth,
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from './provider-client';
import type { ActiveIndicator } from './indicators/registry';
import { INDICATORS, type Pane, type SeriesSpec } from './indicators/registry';
import { CANDLE_THEMES, loadCandleTheme, saveCandleTheme, type CandleTheme } from './chart/candle-themes';
import { LtpPrimitive } from './chart/ltp-primitive';
import { SmcZonePrimitive, type SmcZone } from './chart/smc-zone-primitive';

interface ManagedSeries {
  pane: Pane;
  series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;
}

interface IndicatorHandle {
  active: ActiveIndicator;
  series: ManagedSeries[];
}

const PANE_INDEX: Record<Pane, number> = { overlay: 0, rsi: 1, macd: 2 };

/**
 * v5 chart wrapper. Uses native panes for RSI/MACD, primitives for the
 * live-price line and SMC zones, and exposes hooks for the host UI
 * (crosshair tooltip, scroll-to-live FAB).
 */
export class ChartView {
  private chart: IChartApi;
  private series: ISeriesApi<'Candlestick'>;
  private volume: ISeriesApi<'Histogram'>;
  private candles: Candle[] = [];
  private indicators = new Map<string, IndicatorHandle>();
  private resizeObs: ResizeObserver;
  private theme: CandleTheme = loadCandleTheme();
  private ltp: LtpPrimitive = new LtpPrimitive();
  private smc: SmcZonePrimitive = new SmcZonePrimitive();
  private markersPlugin: ISeriesMarkersPluginApi<UTCTimestamp> | null = null;
  private rsiPaneCreated = false;
  private macdPaneCreated = false;
  private crosshairListeners = new Set<(c: CrosshairInfo | null) => void>();
  private liveListeners = new Set<(atLive: boolean) => void>();
  private atLive = true;

  constructor(private readonly container: HTMLElement) {
    this.chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { color: 'transparent' },
        textColor: '#8892a4',
        panes: { separatorColor: 'rgba(255,255,255,0.08)', separatorHoverColor: 'rgba(124,77,255,0.25)', enableResize: true },
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: 'rgba(255,255,255,0.08)', rightOffset: 6 },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: false,
    });

    this.series = this.chart.addSeries(CandlestickSeries, {
      ...this.theme.options,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    this.volume = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      color: 'rgba(255,255,255,0.18)',
      priceScaleId: 'volume',
    }, 0);
    this.chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    this.series.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.2 } });

    this.series.attachPrimitive(this.ltp);
    this.series.attachPrimitive(this.smc);

    this.resizeObs = new ResizeObserver(() => {
      this.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    this.resizeObs.observe(container);

    this.chart.subscribeCrosshairMove((p) => this.handleCrosshair(p));
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => this.handleRangeChange(r));
  }

  // ── Data ────────────────────────────────────────────────────────────

  setHistory(candles: Candle[]): void {
    this.candles = [...candles].sort((a, b) => a.openTime - b.openTime);
    const cs = this.candles.map((c) => ({
      time: (c.openTime / 1000) as UTCTimestamp,
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    const vs = this.candles.map((c) => ({
      time: (c.openTime / 1000) as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0, 230, 118, 0.35)' : 'rgba(255, 23, 68, 0.35)',
    }));
    this.series.setData(cs);
    this.volume.setData(vs);
    this.recomputeIndicators();
    this.chart.timeScale().fitContent();
  }

  updateCandle(c: Candle): void {
    const t = (c.openTime / 1000) as UTCTimestamp;
    this.series.update({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
    this.volume.update({ time: t, value: c.volume, color: c.close >= c.open ? 'rgba(0, 230, 118, 0.35)' : 'rgba(255, 23, 68, 0.35)' });

    const last = this.candles[this.candles.length - 1];
    if (last && last.openTime === c.openTime) this.candles[this.candles.length - 1] = c;
    else this.candles.push(c);

    // Ensure the LTP line moves with candle updates (important when trade stream is sparse).
    this.setLastTradePrice(c.close);

    this.recomputeIndicators();
  }

  // ── Live trade tick: forming-bar update + LTP primitive ─────────────

  setLastTradePrice(price: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    const last = this.candles[this.candles.length - 1];
    if (last) {
      const next: Candle = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
      this.candles[this.candles.length - 1] = next;
      const t = (next.openTime / 1000) as UTCTimestamp;
      this.series.update({ time: t, open: next.open, high: next.high, low: next.low, close: next.close });
    }
    const bullish = !last || price >= last.open;
    const color = bullish ? '#00e676' : '#ff1744';
    const startTime = last ? ((last.openTime / 1000) as UTCTimestamp) : null;
    this.ltp.setLtp(price, color, startTime);
  }

  clearLastTradePrice(): void {
    this.ltp.setLtp(null, '#00e676', null);
  }

  // ── SMC zones (backend-fed) ─────────────────────────────────────────

  setSmcZones(zones: SmcZone[]): void { this.smc.setZones(zones); }

  // ── Candle theme ────────────────────────────────────────────────────

  themes(): readonly CandleTheme[] { return CANDLE_THEMES; }
  currentTheme(): CandleTheme { return this.theme; }
  setTheme(id: string): void {
    const next = CANDLE_THEMES.find((t) => t.id === id);
    if (!next) return;
    this.theme = next;
    saveCandleTheme(id);
    this.series.applyOptions(next.options);
  }

  // ── Indicators ──────────────────────────────────────────────────────

  setIndicators(list: ActiveIndicator[]): void {
    const seen = new Set<string>();
    for (const ind of list) {
      seen.add(ind.uid);
      const existing = this.indicators.get(ind.uid);
      if (existing && existing.active.defId === ind.defId && shallowEq(existing.active.params, ind.params)) continue;
      if (existing) this.removeIndicator(ind.uid);
      this.addIndicator(ind);
    }
    for (const uid of [...this.indicators.keys()]) if (!seen.has(uid)) this.removeIndicator(uid);
    this.recomputeIndicators();
  }

  private addIndicator(active: ActiveIndicator): void {
    const def = INDICATORS.find((d) => d.id === active.defId);
    if (!def) return;
    const specs = def.compute([], active.params);
    const series: ManagedSeries[] = specs.map((spec) => this.createSeriesForSpec(spec));
    this.indicators.set(active.uid, { active, series });
  }

  private removeIndicator(uid: string): void {
    const h = this.indicators.get(uid);
    if (!h) return;
    for (const s of h.series) try { this.chart.removeSeries(s.series); } catch { /* noop */ }
    this.indicators.delete(uid);
  }

  private createSeriesForSpec(spec: SeriesSpec): ManagedSeries {
    const paneIdx = PANE_INDEX[spec.pane];
    if (spec.pane === 'rsi') this.ensureRsiPane();
    if (spec.pane === 'macd') this.ensureMacdPane();

    const baseOpts = {
      color: spec.color,
      lineWidth: 1 as LineWidth,
      lastValueVisible: spec.pane === 'overlay',
      priceLineVisible: false,
      lineStyle: LineStyle.Solid,
    };

    let series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;
    if (spec.kind === 'histogram') {
      series = this.chart.addSeries(HistogramSeries, { color: spec.color, priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } }, paneIdx);
    } else {
      series = this.chart.addSeries(LineSeries, baseOpts, paneIdx);
    }
    return { pane: spec.pane, series };
  }

  private ensureRsiPane(): void {
    if (this.rsiPaneCreated) return;
    this.rsiPaneCreated = true;
    // Adding a series with paneIndex=1 auto-creates the pane; size it explicitly.
    queueMicrotask(() => { try { this.chart.panes()[1]?.setHeight(100); } catch { /* noop */ } });
  }

  private ensureMacdPane(): void {
    if (this.macdPaneCreated) return;
    this.macdPaneCreated = true;
    queueMicrotask(() => { try { this.chart.panes()[2]?.setHeight(110); } catch { /* noop */ } });
  }

  private recomputeIndicators(): void {
    if (this.candles.length === 0) return;
    for (const h of this.indicators.values()) {
      const def = INDICATORS.find((d) => d.id === h.active.defId);
      if (!def) continue;
      const specs = def.compute(this.candles, h.active.params);
      for (let i = 0; i < h.series.length; i += 1) {
        const spec = specs[i];
        const ms = h.series[i];
        if (!spec || !ms) continue;
        const data = this.candles
          .map((c, idx) => ({ time: (c.openTime / 1000) as UTCTimestamp, value: spec.values[idx] as number }))
          .filter((p) => Number.isFinite(p.value));
        if (spec.kind === 'histogram') {
          (ms.series as ISeriesApi<'Histogram'>).setData(data);
        } else {
          (ms.series as ISeriesApi<'Line'>).setData(data);
        }
      }
    }
  }

  // ── Markers (NanoPine plots) ────────────────────────────────────────

  setMarkers(markers: SeriesMarker<UTCTimestamp>[]): void {
    if (!this.markersPlugin) {
      this.markersPlugin = createSeriesMarkers(this.series, markers);
    } else {
      this.markersPlugin.setMarkers(markers);
    }
  }

  // ── Crosshair / scroll-to-live hooks ────────────────────────────────

  onCrosshair(fn: (info: CrosshairInfo | null) => void): () => void {
    this.crosshairListeners.add(fn);
    return () => { this.crosshairListeners.delete(fn); };
  }

  onLiveStateChange(fn: (atLive: boolean) => void): () => void {
    this.liveListeners.add(fn);
    fn(this.atLive);
    return () => { this.liveListeners.delete(fn); };
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
    if (!data) {
      for (const fn of this.crosshairListeners) fn(null);
      return;
    }
    const vol = p.seriesData.get(this.volume) as { value: number } | undefined;
    const info: CrosshairInfo = {
      time: p.time as UTCTimestamp,
      open: data.open, high: data.high, low: data.low, close: data.close,
      volume: vol?.value ?? null,
    };
    for (const fn of this.crosshairListeners) fn(info);
  }

  private handleRangeChange(range: LogicalRange | null): void {
    if (!range || this.candles.length === 0) return;
    const lastIdx = this.candles.length - 1;
    const atLive = range.to >= lastIdx - 0.5;
    if (atLive !== this.atLive) {
      this.atLive = atLive;
      for (const fn of this.liveListeners) fn(atLive);
    }
  }

  // ── Drawing-tool helpers (kept for drawings.ts) ─────────────────────

  yToPrice(y: number): number | null { return this.series.coordinateToPrice(y); }
  priceToY(price: number): number | null { return this.series.priceToCoordinate(price); }
  xToTime(x: number): UTCTimestamp | null { return this.chart.timeScale().coordinateToTime(x) as UTCTimestamp | null; }
  timeToX(time: UTCTimestamp): number | null { return this.chart.timeScale().timeToCoordinate(time); }

  api(): IChartApi { return this.chart; }
  mainSeries(): ISeriesApi<'Candlestick'> { return this.series; }

  dispose(): void {
    this.resizeObs.disconnect();
    this.chart.remove();
  }
}

export interface CrosshairInfo {
  time: UTCTimestamp;
  open: number; high: number; low: number; close: number;
  volume: number | null;
}

const shallowEq = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const ka = Object.keys(a); const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
};

// Re-export so callers don't need to depend on the candle-themes module path.
export type { CandleTheme };
export type { SmcZone };
