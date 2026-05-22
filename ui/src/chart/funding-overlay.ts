import {
  type IChartApi,
  type ISeriesApi,
  type Time,
  type HistogramData,
  ColorType
} from 'lightweight-charts';

export class FundingOverlay {
  private series: ISeriesApi<"Histogram">;

  constructor(chart: IChartApi) {
    this.series = chart.addHistogramSeries({
      color: '#2ebd85',
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => (price * 100).toFixed(4) + '%',
      },
      priceScaleId: 'funding',
    });

    chart.priceScale('funding').applyOptions({
      scaleMargins: {
        top: 0.8, // Push to bottom 20% of pane
        bottom: 0,
      },
      textColor: '#8892a4',
      borderVisible: false,
    });
  }

  setData(data: { time: number; fundingRate: number }[]) {
    const seriesData: HistogramData[] = data.map(d => ({
      time: (d.time / 1000) as Time,
      value: d.fundingRate,
      color: d.fundingRate > 0 ? 'rgba(46, 189, 133, 0.5)' : 'rgba(246, 70, 93, 0.5)'
    }));
    this.series.setData(seriesData);
  }

  update(time: number, fundingRate: number) {
    this.series.update({
      time: (time / 1000) as Time,
      value: fundingRate,
      color: fundingRate > 0 ? 'rgba(46, 189, 133, 0.5)' : 'rgba(246, 70, 93, 0.5)'
    });
  }
}
