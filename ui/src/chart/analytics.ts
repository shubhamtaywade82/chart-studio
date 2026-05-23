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
  private optionLevelLines: Map<string, ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>> = new Map();
  private cumulativeDelta = 0;
  /** Last seen cumulative day totals. Used to compute per-tick deltas. */
  private lastBuyQty = 0;
  private lastSellQty = 0;
  private lastOi = 0;
  /** First-tick flags to avoid spurious deltas on symbol switch. */
  private buyInit = false;
  private oiInit = false;
  private lastOptionLineUpdate = 0;

  public options = {
    showDayOpen: true,
    showDayHigh: true,
    showDayLow: true,
    showPrevClose: true,
    showAtp: true,
  };

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
    for (const line of this.optionLevelLines.values()) {
      try { this.mainSeries.removePriceLine(line); } catch { /* noop */ }
    }
    this.optionLevelLines.clear();
    this.dayLevelLastPrice?.clear();
    this.lastOptionLineUpdate = 0;
  }

  updateOptionChain(data: any): void {
    const now = Date.now();
    if (now - this.lastOptionLineUpdate < 60000 && this.optionLevelLines.size > 0) {
      return;
    }
    this.lastOptionLineUpdate = now;

    const { maxPain, supportOI, resistanceOI } = data;

    // Clear old option lines
    for (const line of this.optionLevelLines.values()) {
      try { this.mainSeries.removePriceLine(line); } catch { /* noop */ }
    }
    this.optionLevelLines.clear();

    if (maxPain > 0) {
      const mpLine = this.mainSeries.createPriceLine({
        price: maxPain,
        color: '#7c4dff',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Max Pain',
      });
      this.optionLevelLines.set('max-pain', mpLine);
    }

    if (supportOI > 0) {
      const sLine = this.mainSeries.createPriceLine({
        price: supportOI,
        color: '#00e676',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'OI Support',
      });
      this.optionLevelLines.set('oi-support', sLine);
    }

    if (resistanceOI > 0) {
      const rLine = this.mainSeries.createPriceLine({
        price: resistanceOI,
        color: '#ff1744',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'OI Resistance',
      });
      this.optionLevelLines.set('oi-resistance', rLine);
    }
  }

  setupAtpSeries(): void {
    // ATP line overlay on main pane
    this.atpSeries = this.chart.addSeries(LineSeries, {
      color: '#ffaa00',
      lineWidth: 1,
      lineStyle: LineStyle.LargeDashed,
      title: 'ATP',
      priceLineVisible: false,
      lastValueVisible: false,
    });
  }

  setupCvdSeries(pane: number): void {
    if (this.cvdSeries) return;
    // CVD histogram in sub-pane
    this.cvdSeries = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      title: 'CVD',
      priceScaleId: 'cvd',
    }, pane);
    this.chart.priceScale('cvd').applyOptions({
      scaleMargins: { top: 0.3, bottom: 0.05 },
    });
  }

  removeCvdSeries(): void {
    if (this.cvdSeries) {
      try { this.chart.removeSeries(this.cvdSeries); } catch { /* ignore */ }
      this.cvdSeries = null;
    }
  }

  setupOiSeries(pane: number): void {
    if (this.oiSeries) return;
    // OI histogram in sub-pane
    this.oiSeries = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      title: 'OI Change',
      priceScaleId: 'oi',
    }, pane);
    this.chart.priceScale('oi').applyOptions({
      scaleMargins: { top: 0.3, bottom: 0.05 },
    });
  }

  removeOiSeries(): void {
    if (this.oiSeries) {
      try { this.chart.removeSeries(this.oiSeries); } catch { /* ignore */ }
      this.oiSeries = null;
    }
  }

  update(state: AnalyticsState): void {
    // ATP deviation
    if (this.atpSeries) {
      if (this.options.showAtp) {
        this.atpSeries.applyOptions({ visible: true });
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
      } else {
        this.atpSeries.applyOptions({ visible: false });
      }
    }

    // CVD: Dhan's totalBuyQty/totalSellQty are cumulative since market open.
    // We need per-tick deltas, then accumulate those into CVD.
    if (this.cvdSeries && (state.totalBuyQty > 0 || state.totalSellQty > 0)) {
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
    if (this.oiSeries && state.oi !== undefined && state.oi > 0) {
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
    const updateLine = (key: string, price: number, color: string, title: string, show: boolean): void => {
      const existing = this.dayLevelLines.get(key);
      if (!show) {
        if (existing) {
          try { this.mainSeries.removePriceLine(existing); } catch { /* noop */ }
          this.dayLevelLines.delete(key);
          this.dayLevelLastPrice.delete(key);
        }
        return;
      }

      const prev = this.dayLevelLastPrice.get(key);
      if (prev === price && existing) return;

      // Remove existing line if present, then recreate. PriceLine.applyOptions
      // is not reliable across lightweight-charts versions, so we always recreate.
      if (existing) {
        try { this.mainSeries.removePriceLine(existing); } catch { /* noop */ }
      }
      const line = this.mainSeries.createPriceLine({ price, color, title });
      this.dayLevelLines.set(key, line);
      this.dayLevelLastPrice.set(key, price);
    };

    updateLine('do', state.dayOpen, '#ffffff', 'DO', this.options.showDayOpen && state.dayOpen > 0);
    updateLine('dh', state.dayHigh, '#26a69a', 'DH', this.options.showDayHigh && state.dayHigh > 0);
    updateLine('dl', state.dayLow, '#ef5350', 'DL', this.options.showDayLow && state.dayLow > 0);
    updateLine('pc', state.prevClose ?? 0, '#9c9c9c', 'Prev', this.options.showPrevClose && !!state.prevClose && state.prevClose > 0);
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
