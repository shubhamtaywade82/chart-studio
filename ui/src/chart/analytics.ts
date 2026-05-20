import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { LineSeries, HistogramSeries, LineStyle } from 'lightweight-charts';

export interface AnalyticsState {
  atp: number;
  ltp: number;
  volume: number;
  totalBuyQty: number;
  totalSellQty: number;
  oi: number | undefined;
  highOi: number | undefined;
  lowOi: number | undefined;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  dayClose: number;
  prevClose: number | undefined;
  prevOi: number | undefined;
  bidOrders: number[] | undefined;
  askOrders: number[] | undefined;
  ltt: number;
  ltq: number;
  time: UTCTimestamp;
}

export class AnalyticsRenderer {
  private atpSeries: ISeriesApi<'Line'> | null = null;
  private cvdSeries: ISeriesApi<'Histogram'> | null = null;
  private oiSeries: ISeriesApi<'Histogram'> | null = null;
  private dayLevelLines: Map<string, ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>> = new Map();
  private cumulativeDelta = 0;
  /** Last seen cumulative day totals. Used to compute per-tick deltas. */
  private lastBuyQty = 0;
  private lastSellQty = 0;
  private lastOi = 0;
  /** First-tick flags to avoid spurious deltas on symbol switch. */
  private buyInit = false;
  private oiInit = false;

  constructor(private chart: IChartApi, private mainSeries: ISeriesApi<'Candlestick'>) {}

  /** Reset tick-state when symbol/interval changes. */
  reset(): void {
    this.cumulativeDelta = 0;
    this.lastBuyQty = 0;
    this.lastSellQty = 0;
    this.lastOi = 0;
    this.buyInit = false;
    this.oiInit = false;
    for (const line of this.dayLevelLines.values()) {
      try { this.mainSeries.removePriceLine(line); } catch { /* noop */ }
    }
    this.dayLevelLines.clear();
    this.dayLevelLastPrice?.clear();
  }

  /**
   * Allocate analytics series. Pane indices are negotiated externally to
   * avoid colliding with indicator sub-panes (RSI/MACD also use 1+).
   */
  setupSeries(cvdPane: number, oiPane: number): void {
    // ATP line overlay on main pane
    this.atpSeries = this.chart.addSeries(LineSeries, {
      color: '#ffaa00',
      lineWidth: 1,
      lineStyle: LineStyle.LargeDashed,
      title: 'ATP',
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // CVD histogram in sub-pane
    this.cvdSeries = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      title: 'CVD',
      priceScaleId: 'cvd',
    }, cvdPane);
    this.chart.priceScale('cvd').applyOptions({
      scaleMargins: { top: 0.3, bottom: 0.05 },
    });

    // OI histogram in sub-pane
    this.oiSeries = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      title: 'OI Change',
      priceScaleId: 'oi',
    }, oiPane);
    this.chart.priceScale('oi').applyOptions({
      scaleMargins: { top: 0.3, bottom: 0.05 },
    });
  }

  update(state: AnalyticsState): void {
    if (!this.atpSeries || !this.cvdSeries || !this.oiSeries) return;

    // ATP deviation
    if (state.atp > 0) {
      const deviation = ((state.ltp - state.atp) / state.atp) * 100;
      let color = '#ffffff';
      if (deviation > 0.1) color = '#f6465d';
      else if (deviation < -0.1) color = '#2ebd85';

      this.atpSeries.update({ time: state.time, value: state.atp });

      // Update LTP label color based on ATP deviation
      const ltpLabel = document.querySelector('[data-atp-dev]') as HTMLElement | null;
      if (ltpLabel) {
        ltpLabel.setAttribute('data-atp-dev', deviation.toFixed(3));
        ltpLabel.style.setProperty('--atp-color', color);
      }
    }

    // CVD: Dhan's totalBuyQty/totalSellQty are cumulative since market open.
    // We need per-tick deltas, then accumulate those into CVD.
    if (state.totalBuyQty > 0 || state.totalSellQty > 0) {
      if (!this.buyInit) {
        this.lastBuyQty = state.totalBuyQty;
        this.lastSellQty = state.totalSellQty;
        this.buyInit = true;
      } else {
        const buyDelta = Math.max(0, state.totalBuyQty - this.lastBuyQty);
        const sellDelta = Math.max(0, state.totalSellQty - this.lastSellQty);
        this.lastBuyQty = state.totalBuyQty;
        this.lastSellQty = state.totalSellQty;
        this.cumulativeDelta += buyDelta - sellDelta;
        const cvdColor = this.cumulativeDelta >= 0 ? 'rgba(46, 189, 133, 0.6)' : 'rgba(246, 70, 93, 0.6)';
        this.cvdSeries.update({ time: state.time, value: Math.abs(this.cumulativeDelta), color: cvdColor });
      }
    }

    // OI: skip first reading to avoid huge spurious bar on symbol switch.
    if (state.oi !== undefined && state.oi > 0) {
      if (!this.oiInit) {
        this.lastOi = state.oi;
        this.oiInit = true;
      } else {
        const oiChange = state.oi - this.lastOi;
        this.lastOi = state.oi;
        const oiColor = oiChange >= 0 ? 'rgba(46, 189, 133, 0.6)' : 'rgba(246, 70, 93, 0.6)';
        this.oiSeries.update({ time: state.time, value: Math.abs(oiChange), color: oiColor });
      }
    }

    // Day level markers
    this.updateDayLevels(state);
  }

  /** Tracks the last price set per key, to skip no-op recreations. */
  private dayLevelLastPrice = new Map<string, number>();

  private updateDayLevels(state: AnalyticsState): void {
    const updateLine = (key: string, price: number, color: string, title: string): void => {
      const prev = this.dayLevelLastPrice.get(key);
      if (prev === price && this.dayLevelLines.has(key)) return;

      // Remove existing line if present, then recreate. PriceLine.applyOptions
      // is not reliable across lightweight-charts versions, so we always recreate.
      const existing = this.dayLevelLines.get(key);
      if (existing) {
        try { this.mainSeries.removePriceLine(existing); } catch { /* noop */ }
      }
      const line = this.mainSeries.createPriceLine({ price, color, title });
      this.dayLevelLines.set(key, line);
      this.dayLevelLastPrice.set(key, price);
    };

    if (state.dayOpen > 0) updateLine('do', state.dayOpen, '#ffffff', 'DO');
    if (state.dayHigh > 0) updateLine('dh', state.dayHigh, '#26a69a', 'DH');
    if (state.dayLow > 0) updateLine('dl', state.dayLow, '#ef5350', 'DL');
    if (state.prevClose && state.prevClose > 0) updateLine('pc', state.prevClose, '#9c9c9c', 'Prev');
  }

  /**
   * Classify F&O position state from price/OI change combination.
   * Useful for highlighting candles. Currently exposed for callers but not
   * wired into the candle border rendering (lightweight-charts v5 lacks
   * per-candle border color override).
   */
  static classifyPositionState(priceChange: number, oiChange: number): 'long-buildup' | 'short-buildup' | 'short-covering' | 'long-unwinding' {
    if (priceChange > 0 && oiChange > 0) return 'long-buildup';
    if (priceChange < 0 && oiChange > 0) return 'short-buildup';
    if (priceChange > 0 && oiChange < 0) return 'short-covering';
    return 'long-unwinding';
  }
}
