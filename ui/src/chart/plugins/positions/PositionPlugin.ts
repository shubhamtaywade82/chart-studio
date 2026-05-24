import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  LineStyle,
} from 'lightweight-charts';

import type { ChartPlugin } from '../../engine/PluginRuntime';
import type { ChartEngine } from '../../engine/ChartEngine';
import type { Position } from '@chart-studio/adapter-core';

export class PositionPlugin implements ChartPlugin, ISeriesPrimitive {
  public readonly id = 'positions';
  private requestUpdate?: () => void;
  private api?: IChartApi;
  private series?: ISeriesApi<'Candlestick'>;
  private engine?: ChartEngine;
  private positions: Position[] = [];
  private symbol: string = '';

  private priceLines = new Map<string, IPriceLine>();

  constructor(engine: ChartEngine) {
    this.engine = engine;
  }

  getPrimitive(): ISeriesPrimitive {
    return this;
  }

  attached({ requestUpdate }: { requestUpdate: () => void }) {
    this.requestUpdate = requestUpdate;
  }

  onAttached(api: IChartApi, series: ISeriesApi<'Candlestick'>) {
    this.api = api;
    this.series = series;
    this.update();
  }

  onAnimationFrame(timeMs: number): void {
    // We update titles (PnL) on every frame if needed, 
    // but the lines themselves are managed by lightweight-charts.
    this.update();
  }

  setSymbol(symbol: string): void {
    this.symbol = symbol;
    this._clearLines();
    this.update();
  }

  setPositions(positions: Position[]): void {
    this.positions = positions;
    this.update();
  }

  private _clearLines(): void {
    if (!this.series) return;
    for (const line of this.priceLines.values()) {
      try { this.series.removePriceLine(line); } catch {}
    }
    this.priceLines.clear();
  }

  update(): void {
    if (!this.api || !this.series) return;

    const active = this.positions.find(p => p.symbol === this.symbol && Math.abs(p.netQty) > 0);
    
    if (!active) {
      this._clearLines();
      return;
    }

    const precision = (this.series.options() as any).priceFormat?.precision ?? 2;
    const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision });
    const pnlFmt = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;

    // 1. Entry Line
    this._upsertLine('entry', {
      price: active.averagePrice,
      color: active.unrealizedPnl >= 0 ? '#2ebd85' : '#f6465d',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `${active.netQty > 0 ? 'LONG' : 'SHORT'} ${Math.abs(active.netQty).toFixed(4)} (${pnlFmt(active.unrealizedPnl)})`,
    });

    // 2. SL Line
    if (active.stopLoss) {
      this._upsertLine('sl', {
        price: active.stopLoss,
        color: '#f6465d',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `SL ${fmt(active.stopLoss)}`,
      });
    } else {
      this._removeLine('sl');
    }

    // 3. TP Line
    if (active.takeProfit) {
      this._upsertLine('tp', {
        price: active.takeProfit,
        color: '#2ebd85',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `TP ${fmt(active.takeProfit)}`,
      });
    } else {
      this._removeLine('tp');
    }

    // 4. LIQ Line
    if (active.liquidationPrice) {
      this._upsertLine('liq', {
        price: active.liquidationPrice,
        color: '#ff9800',
        lineWidth: 1,
        lineStyle: LineStyle.LargeDashed,
        axisLabelVisible: true,
        title: `LIQ ${fmt(active.liquidationPrice)}`,
      });
    } else {
      this._removeLine('liq');
    }
  }

  private _upsertLine(id: string, options: any): void {
    if (!this.series) return;
    const existing = this.priceLines.get(id);
    if (existing) {
      existing.applyOptions(options);
    } else {
      this.priceLines.set(id, this.series.createPriceLine(options));
    }
  }

  private _removeLine(id: string): void {
    const line = this.priceLines.get(id);
    if (line && this.series) {
      try { this.series.removePriceLine(line); } catch {}
      this.priceLines.delete(id);
    }
  }

  paneViews(): IPrimitivePaneView[] {
    return []; // We don't need custom pane views if we use IPriceLine
  }
}
