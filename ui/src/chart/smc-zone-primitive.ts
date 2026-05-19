import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  UTCTimestamp,
} from 'lightweight-charts';

export interface SmcZone {
  id: string;
  startTime: UTCTimestamp;
  endTime: UTCTimestamp | null;     // null = open-ended (extend to right edge)
  priceTop: number;
  priceBottom: number;
  kind: 'order-block' | 'fvg' | 'liquidity';
  bullish: boolean;
}

/**
 * Draws translucent rectangles for Smart-Money-Concept zones (order blocks,
 * fair-value gaps, liquidity sweeps). Backend pushes the zones via
 * setZones(); primitive renders behind the candles.
 */
export class SmcZonePrimitive implements ISeriesPrimitive<'Candlestick'> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private zones: SmcZone[] = [];
  private requestUpdate: (() => void) | null = null;

  attached(p: { chart: IChartApi; series: ISeriesApi<'Candlestick'>; requestUpdate: () => void }): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }
  detached(): void { this.chart = null; this.series = null; this.requestUpdate = null; }

  setZones(zones: SmcZone[]): void {
    this.zones = zones;
    this.requestUpdate?.();
  }

  updateAllViews(): void { /* views pull live */ }

  paneViews(): ISeriesPrimitivePaneView[] {
    return [new SmcPaneView(this)];
  }

  _state(): { chart: IChartApi | null; series: ISeriesApi<'Candlestick'> | null; zones: SmcZone[] } {
    return { chart: this.chart, series: this.series, zones: this.zones };
  }
}

class SmcPaneView implements ISeriesPrimitivePaneView {
  constructor(private readonly p: SmcZonePrimitive) {}
  renderer(): ISeriesPrimitivePaneRenderer {
    const { chart, series, zones } = this.p._state();
    return {
      draw: (scope) => {
        if (!chart || !series || zones.length === 0) return;
        const ts = chart.timeScale();
        const ctx = scope.context;
        ctx.save();
        for (const z of zones) {
          const x1 = ts.timeToCoordinate(z.startTime);
          const x2 = z.endTime === null ? scope.mediaSize.width : (ts.timeToCoordinate(z.endTime) ?? scope.mediaSize.width);
          const yTop = series.priceToCoordinate(z.priceTop);
          const yBot = series.priceToCoordinate(z.priceBottom);
          if (x1 === null || yTop === null || yBot === null) continue;
          const top = Math.min(yTop, yBot);
          const h = Math.abs(yBot - yTop);
          const baseColor = z.bullish ? '0, 230, 118' : '255, 23, 68';
          const alpha = z.kind === 'liquidity' ? 0.08 : z.kind === 'fvg' ? 0.10 : 0.14;
          ctx.fillStyle = `rgba(${baseColor}, ${alpha})`;
          ctx.strokeStyle = `rgba(${baseColor}, 0.35)`;
          ctx.lineWidth = 1;
          ctx.fillRect(x1, top, x2 - x1, h);
          ctx.strokeRect(x1, top, x2 - x1, h);
        }
        ctx.restore();
      },
    };
  }
}
