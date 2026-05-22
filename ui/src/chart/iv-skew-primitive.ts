import {
  type ISeriesApi,
  type IChartApi,
  type LineData,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  LineSeries,
} from 'lightweight-charts';

export interface IVSkewDataPoint {
  delta: number; // x-axis
  callIV: number;
  putIV: number;
  realizedVol?: number;
}

export class IVSkewPrimitive {
  private chartApi: IChartApi;
  private callSeries: ISeriesApi<'Line'>;
  private putSeries: ISeriesApi<'Line'>;

  constructor(private container: HTMLElement) {
    this.chartApi = createChart(this.container, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#888',
      },
      grid: {
        vertLines: { color: '#333', style: LineStyle.Dotted },
        horzLines: { color: '#333', style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#555',
      },
      timeScale: {
        borderColor: '#555',
        timeVisible: false, // X-axis will be delta mapped to arbitrary 'time' numbers 
      },
    });

    this.callSeries = this.chartApi.addSeries(LineSeries, {
      color: '#2962FF', // Blue for Calls
      lineWidth: 2,
      title: 'Call IV',
    });

    this.putSeries = this.chartApi.addSeries(LineSeries, {
      color: '#FF1E56', // Red for Puts
      lineWidth: 2,
      title: 'Put IV',
    });
  }

  update(data: IVSkewDataPoint[]) {
    // Map Delta to "Time" for Lightweight Charts X-Axis compatibility
    // Delta goes from -50 to 50. We can map it directly to timestamps if we assume it's a day offset,
    // or we can just use integer ticks. Let's use simple integers -50 to 50 as 'time' mapped to days from epoch.

    const callData: LineData[] = [];
    const putData: LineData[] = [];

    // Sort by delta ascending
    const sorted = [...data].sort((a, b) => a.delta - b.delta);

    for (const pt of sorted) {
      // Lightweight charts accepts timestamps. We'll map delta to 2000-01-01 + delta days.
      // E.g., delta 0 is 2000-01-01. delta 25 is 2000-01-26.
      const baseTime = Date.UTC(2000, 0, 1) / 1000;
      const timeOffset = pt.delta * 86400; // 1 day per delta point
      const time = (baseTime + timeOffset) as any;

      if (pt.callIV > 0) callData.push({ time, value: pt.callIV });
      if (pt.putIV > 0) putData.push({ time, value: pt.putIV });
    }

    this.callSeries.setData(callData);
    this.putSeries.setData(putData);

    this.chartApi.timeScale().fitContent();
  }

  resize(width: number, height: number) {
    this.chartApi.applyOptions({ width, height });
  }

  destroy() {
    this.chartApi.remove();
  }
}
