import type { IChartApi, ISeriesApi, Time, UTCTimestamp } from 'lightweight-charts';
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
  private dayLevelLines: Map<string, any> = new Map();
  private cvdHistory: number[] = [];
  private oiHistory: Array<{ time: UTCTimestamp; oi: number; change: number }> = [];
  private prevOi = 0;

  constructor(private chart: IChartApi, private mainSeries: ISeriesApi<'Candlestick'>) {}

  setupSeries(): void {
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
    }, 1);
    this.chart.priceScale('cvd').applyOptions({
      scaleMargins: { top: 0.3, bottom: 0.05 },
    });

    // OI histogram in sub-pane
    this.oiSeries = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      title: 'OI Change',
      priceScaleId: 'oi',
    }, 2);
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

    // CVD calculation: delta between buy and sell
    const delta = state.totalBuyQty - state.totalSellQty;
    this.cvdHistory.push(delta);
    const cumulativeDelta = this.cvdHistory.reduce((a, b) => a + b, 0);
    const cvdColor = cumulativeDelta >= 0 ? 'rgba(46, 189, 133, 0.6)' : 'rgba(246, 70, 93, 0.6)';
    this.cvdSeries.update({ time: state.time, value: Math.abs(cumulativeDelta), color: cvdColor });

    // OI tracking
    if (state.oi !== undefined) {
      const oiChange = state.oi - this.prevOi;
      this.prevOi = state.oi;
      const oiColor = oiChange >= 0 ? 'rgba(46, 189, 133, 0.6)' : 'rgba(246, 70, 93, 0.6)';
      this.oiSeries.update({ time: state.time, value: Math.abs(oiChange), color: oiColor });
      this.oiHistory.push({ time: state.time, oi: state.oi, change: oiChange });
    }

    // Day level markers
    this.updateDayLevels(state);
  }

  private updateDayLevels(state: AnalyticsState): void {
    const updateLine = (key: string, price: number, color: string, title: string) => {
      if (!this.dayLevelLines.has(key)) {
        const line = this.mainSeries.createPriceLine({ price, color, title });
        this.dayLevelLines.set(key, line);
      } else {
        const line = this.dayLevelLines.get(key);
        if (line) {
          try {
            line.applyOptions({ price });
          } catch {
            this.dayLevelLines.delete(key);
            const newLine = this.mainSeries.createPriceLine({ price, color, title });
            this.dayLevelLines.set(key, newLine);
          }
        }
      }
    };

    if (state.dayOpen > 0) updateLine('do', state.dayOpen, '#ffffff', 'DO');
    if (state.dayHigh > 0) updateLine('dh', state.dayHigh, '#26a69a', 'DH');
    if (state.dayLow > 0) updateLine('dl', state.dayLow, '#ef5350', 'DL');
    if (state.prevClose && state.prevClose > 0) updateLine('pc', state.prevClose, '#9c9c9c', 'Prev');
  }

  getOiColor(priceChange: number, oiChange: number): string {
    if (priceChange > 0 && oiChange > 0) return '#26a69a'; // Long Buildup
    if (priceChange < 0 && oiChange > 0) return '#ef5350'; // Short Buildup
    if (priceChange > 0 && oiChange < 0) return '#81c784'; // Short Covering
    return '#f48fb1'; // Long Unwinding
  }

  getDepthQuality(avgSize: number, orderCount: number): { label: string; color: string } {
    if (avgSize > 5000 && orderCount < 5) {
      return { label: 'Whale', color: '#ff9800' };
    } else if (avgSize < 100 && orderCount > 50) {
      return { label: 'Retail', color: '#42a5f5' };
    }
    return { label: 'Normal', color: '#ffffff' };
  }

  getLiquidityFlip(buyPressure: number, prevPressure: number): boolean {
    return (prevPressure > 0.7 && buyPressure < 0.3) || (prevPressure < 0.3 && buyPressure > 0.7);
  }

  getVolumeAnomalyStatus(volume: number, expectedVolume: number): boolean {
    return volume > expectedVolume * 2;
  }
}
