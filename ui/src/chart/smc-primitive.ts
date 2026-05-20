import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  SeriesType,
  UTCTimestamp,
  Time,
} from 'lightweight-charts';
import type { Candle } from '../provider-client';

export class SmcPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private candles: Candle[] = [];

  // Computed SMC Structures
  swings: Array<{ type: 'high' | 'low'; index: number; price: number; time: UTCTimestamp; broken: boolean }> = [];
  bos: Array<{ type: 'bullish' | 'bearish'; price: number; startTime: UTCTimestamp; breakTime: UTCTimestamp }> = [];
  choch: Array<{ type: 'bullish' | 'bearish'; price: number; startTime: UTCTimestamp; breakTime: UTCTimestamp }> = [];
  orderBlocks: Array<{ type: 'bullish' | 'bearish'; startTime: UTCTimestamp; priceMin: number; priceMax: number; mitigated: boolean; mitigatedTime?: UTCTimestamp }> = [];
  fvgs: Array<{ type: 'bullish' | 'bearish'; startTime: UTCTimestamp; priceMin: number; priceMax: number; mitigated: boolean; mitigatedTime?: UTCTimestamp }> = [];

  constructor(private readonly period: number = 5) {}

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart as IChartApi;
    this.series = param.series as ISeriesApi<SeriesType>;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setCandles(candles: Candle[]): void {
    this.candles = candles;
    this.calculateSMC();
    this.requestUpdate?.();
  }

  updateAllViews(): void {}

  paneViews(): IPrimitivePaneView[] {
    return [new SmcPaneView(this)];
  }

  priceAxisViews(): [] {
    return [];
  }

  _state() {
    return {
      chart: this.chart,
      series: this.series,
      candles: this.candles,
      period: this.period,
    };
  }

  private calculateSMC(): void {
    if (this.candles.length < this.period * 2 + 5) {
      this.swings = [];
      this.bos = [];
      this.choch = [];
      this.orderBlocks = [];
      this.fvgs = [];
      return;
    }

    const candles = this.candles;
    const n = candles.length;
    const period = this.period;

    // 1. Detect Swings (Fractals)
    const swings: Array<{ type: 'high' | 'low'; index: number; price: number; time: UTCTimestamp; broken: boolean }> = [];
    for (let i = period; i < n - period; i++) {
      const c = candles[i]!;
      
      // Swing High
      let isHigh = true;
      for (let j = 1; j <= period; j++) {
        if (candles[i - j]!.high >= c.high || candles[i + j]!.high > c.high) {
          isHigh = false;
          break;
        }
      }
      if (isHigh) {
        swings.push({
          type: 'high',
          index: i,
          price: c.high,
          time: Math.floor(c.openTime / 1000) as UTCTimestamp,
          broken: false,
        });
      }

      // Swing Low
      let isLow = true;
      for (let j = 1; j <= period; j++) {
        if (candles[i - j]!.low <= c.low || candles[i + j]!.low < c.low) {
          isLow = false;
          break;
        }
      }
      if (isLow) {
        swings.push({
          type: 'low',
          index: i,
          price: c.low,
          time: Math.floor(c.openTime / 1000) as UTCTimestamp,
          broken: false,
        });
      }
    }

    // 2. Detect BOS & CHoCH & Order Blocks
    const bos: typeof this.bos = [];
    const choch: typeof this.choch = [];
    const orderBlocks: typeof this.orderBlocks = [];
    
    let trend: 'bullish' | 'bearish' = 'bullish';

    for (let i = 0; i < n; i++) {
      const c = candles[i]!;
      const cTime = Math.floor(c.openTime / 1000) as UTCTimestamp;

      // Confirmed swing levels formed up to the current candle index
      const confirmed = swings.filter(s => s.index <= i - period);
      const activeHighs = confirmed.filter(s => s.type === 'high' && !s.broken);
      const activeLows = confirmed.filter(s => s.type === 'low' && !s.broken);

      const activeHigh = activeHighs[activeHighs.length - 1];
      const activeLow = activeLows[activeLows.length - 1];

      if (trend === 'bullish') {
        // Bullish BOS (Close breaks Swing High)
        if (activeHigh && c.close > activeHigh.price) {
          bos.push({
            type: 'bullish',
            price: activeHigh.price,
            startTime: activeHigh.time,
            breakTime: cTime,
          });
          activeHigh.broken = true;

          // Bullish Order Block (last down-candle before swing low move)
          let obIdx = activeHigh.index;
          for (let k = activeHigh.index; k >= Math.max(0, activeHigh.index - 15); k--) {
            if (candles[k]!.close < candles[k]!.open) {
              obIdx = k;
              break;
            }
          }
          const obCandle = candles[obIdx]!;
          orderBlocks.push({
            type: 'bullish',
            startTime: Math.floor(obCandle.openTime / 1000) as UTCTimestamp,
            priceMin: obCandle.low,
            priceMax: obCandle.high,
            mitigated: false,
          });
        }

        // Bearish CHoCH (Close breaks Swing Low in uptrend)
        if (activeLow && c.close < activeLow.price) {
          choch.push({
            type: 'bearish',
            price: activeLow.price,
            startTime: activeLow.time,
            breakTime: cTime,
          });
          activeLow.broken = true;
          trend = 'bearish';

          // Bearish Order Block (last up-candle before swing high move)
          let obIdx = activeLow.index;
          for (let k = activeLow.index; k >= Math.max(0, activeLow.index - 15); k--) {
            if (candles[k]!.close > candles[k]!.open) {
              obIdx = k;
              break;
            }
          }
          const obCandle = candles[obIdx]!;
          orderBlocks.push({
            type: 'bearish',
            startTime: Math.floor(obCandle.openTime / 1000) as UTCTimestamp,
            priceMin: obCandle.low,
            priceMax: obCandle.high,
            mitigated: false,
          });
        }
      } else {
        // Bearish Trend
        // Bearish BOS (Close breaks Swing Low)
        if (activeLow && c.close < activeLow.price) {
          bos.push({
            type: 'bearish',
            price: activeLow.price,
            startTime: activeLow.time,
            breakTime: cTime,
          });
          activeLow.broken = true;

          // Bearish OB
          let obIdx = activeLow.index;
          for (let k = activeLow.index; k >= Math.max(0, activeLow.index - 15); k--) {
            if (candles[k]!.close > candles[k]!.open) {
              obIdx = k;
              break;
            }
          }
          const obCandle = candles[obIdx]!;
          orderBlocks.push({
            type: 'bearish',
            startTime: Math.floor(obCandle.openTime / 1000) as UTCTimestamp,
            priceMin: obCandle.low,
            priceMax: obCandle.high,
            mitigated: false,
          });
        }

        // Bullish CHoCH (Close breaks Swing High in downtrend)
        if (activeHigh && c.close > activeHigh.price) {
          choch.push({
            type: 'bullish',
            price: activeHigh.price,
            startTime: activeHigh.time,
            breakTime: cTime,
          });
          activeHigh.broken = true;
          trend = 'bullish';

          // Bullish OB
          let obIdx = activeHigh.index;
          for (let k = activeHigh.index; k >= Math.max(0, activeHigh.index - 15); k--) {
            if (candles[k]!.close < candles[k]!.open) {
              obIdx = k;
              break;
            }
          }
          const obCandle = candles[obIdx]!;
          orderBlocks.push({
            type: 'bullish',
            startTime: Math.floor(obCandle.openTime / 1000) as UTCTimestamp,
            priceMin: obCandle.low,
            priceMax: obCandle.high,
            mitigated: false,
          });
        }
      }
    }

    // 3. Detect Fair Value Gaps (FVG)
    const fvgs: typeof this.fvgs = [];
    for (let i = 2; i < n; i++) {
      const cPrev2 = candles[i - 2]!;
      const cPrev1 = candles[i - 1]!;
      const c = candles[i]!;

      // Bullish FVG
      if (cPrev2.high < c.low) {
        fvgs.push({
          type: 'bullish',
          startTime: Math.floor(cPrev1.openTime / 1000) as UTCTimestamp,
          priceMin: cPrev2.high,
          priceMax: c.low,
          mitigated: false,
        });
      }

      // Bearish FVG
      if (cPrev2.low > c.high) {
        fvgs.push({
          type: 'bearish',
          startTime: Math.floor(cPrev1.openTime / 1000) as UTCTimestamp,
          priceMin: c.high,
          priceMax: cPrev2.low,
          mitigated: false,
        });
      }
    }

    // 4. Trace mitigation for Order Blocks and FVGs
    for (const ob of orderBlocks) {
      const startIdx = candles.findIndex(c => Math.floor(c.openTime / 1000) === ob.startTime);
      if (startIdx === -1) continue;
      for (let k = startIdx + 1; k < n; k++) {
        const c = candles[k]!;
        if (ob.type === 'bullish' && c.low <= ob.priceMin) {
          ob.mitigated = true;
          ob.mitigatedTime = Math.floor(c.openTime / 1000) as UTCTimestamp;
          break;
        }
        if (ob.type === 'bearish' && c.high >= ob.priceMax) {
          ob.mitigated = true;
          ob.mitigatedTime = Math.floor(c.openTime / 1000) as UTCTimestamp;
          break;
        }
      }
    }

    for (const fvg of fvgs) {
      const startIdx = candles.findIndex(c => Math.floor(c.openTime / 1000) === fvg.startTime);
      if (startIdx === -1) continue;
      for (let k = startIdx + 1; k < n; k++) {
        const c = candles[k]!;
        if (fvg.type === 'bullish' && c.low <= fvg.priceMin) {
          fvg.mitigated = true;
          fvg.mitigatedTime = Math.floor(c.openTime / 1000) as UTCTimestamp;
          break;
        }
        if (fvg.type === 'bearish' && c.high >= fvg.priceMax) {
          fvg.mitigated = true;
          fvg.mitigatedTime = Math.floor(c.openTime / 1000) as UTCTimestamp;
          break;
        }
      }
    }

    this.swings = swings;
    this.bos = bos;
    this.choch = choch;
    this.orderBlocks = orderBlocks;
    this.fvgs = fvgs;
  }
}

class SmcPaneView implements IPrimitivePaneView {
  constructor(private readonly p: SmcPrimitive) {}

  renderer(): IPrimitivePaneRenderer {
    return {
      draw: (target: any) => {
        const { chart, series, candles } = this.p._state();
        if (!chart || !series || candles.length === 0) return;

        const ts = chart.timeScale();
        const state = this.p;

        target.useBitmapCoordinateSpace((scope: any) => {
          const ctx: CanvasRenderingContext2D = scope.context;
          const dpr: number = scope.bitmapSize.width / scope.mediaSize.width;
          const bWidth = scope.bitmapSize.width;

          ctx.save();

          // ── 1. Draw FVGs ──
          for (const fvg of state.fvgs) {
            const yMin = series.priceToCoordinate(fvg.priceMin);
            const yMax = series.priceToCoordinate(fvg.priceMax);
            const xStart = ts.timeToCoordinate(fvg.startTime);

            if (yMin === null || yMax === null || xStart === null) continue;

            const xEnd = fvg.mitigated && fvg.mitigatedTime
              ? ts.timeToCoordinate(fvg.mitigatedTime)
              : null;
            
            const bYMin = yMax * dpr;
            const bYMax = yMin * dpr;
            const bYHeight = bYMax - bYMin;
            const bXStart = xStart * dpr;
            const bXEnd = xEnd !== null ? xEnd * dpr : bWidth;
            const bXWidth = bXEnd - bXStart;

            if (bXWidth <= 0 || bYHeight <= 0) continue;

            ctx.fillStyle = fvg.type === 'bullish'
              ? 'rgba(76, 175, 80, 0.04)'
              : 'rgba(255, 152, 0, 0.04)';
            ctx.fillRect(bXStart, bYMin, bXWidth, bYHeight);

            ctx.strokeStyle = fvg.type === 'bullish'
              ? 'rgba(76, 175, 80, 0.15)'
              : 'rgba(255, 152, 0, 0.15)';
            ctx.lineWidth = dpr;
            ctx.strokeRect(bXStart, bYMin, bXWidth, bYHeight);

            // Add FVG label
            ctx.fillStyle = fvg.type === 'bullish' ? '#81c784' : '#ffb74d';
            ctx.font = `${8 * dpr}px sans-serif`;
            ctx.fillText('FVG', bXStart + 4 * dpr, bYMin + 10 * dpr);
          }

          // ── 2. Draw Order Blocks ──
          for (const ob of state.orderBlocks) {
            const yMin = series.priceToCoordinate(ob.priceMin);
            const yMax = series.priceToCoordinate(ob.priceMax);
            const xStart = ts.timeToCoordinate(ob.startTime);

            if (yMin === null || yMax === null || xStart === null) continue;

            const xEnd = ob.mitigated && ob.mitigatedTime
              ? ts.timeToCoordinate(ob.mitigatedTime)
              : null;

            const bYMin = yMax * dpr;
            const bYMax = yMin * dpr;
            const bYHeight = bYMax - bYMin;
            const bXStart = xStart * dpr;
            const bXEnd = xEnd !== null ? xEnd * dpr : bWidth;
            const bXWidth = bXEnd - bXStart;

            if (bXWidth <= 0 || bYHeight <= 0) continue;

            const opacityMultiplier = ob.mitigated ? 0.3 : 1.0;

            ctx.fillStyle = ob.type === 'bullish'
              ? `rgba(38, 166, 154, ${0.12 * opacityMultiplier})`
              : `rgba(239, 83, 80, ${0.12 * opacityMultiplier})`;
            ctx.fillRect(bXStart, bYMin, bXWidth, bYHeight);

            ctx.strokeStyle = ob.type === 'bullish'
              ? `rgba(38, 166, 154, ${0.4 * opacityMultiplier})`
              : `rgba(239, 83, 80, ${0.4 * opacityMultiplier})`;
            ctx.lineWidth = dpr;
            ctx.strokeRect(bXStart, bYMin, bXWidth, bYHeight);

            // OB label
            ctx.fillStyle = ob.type === 'bullish' ? '#4db6ac' : '#e57373';
            ctx.font = `${9 * dpr}px sans-serif`;
            ctx.fillText(
              `OB ${ob.type === 'bullish' ? '+' : '-'}${ob.mitigated ? ' (Mitigated)' : ''}`,
              bXStart + 6 * dpr,
              bYMin + 12 * dpr
            );
          }

          // ── 3. Draw BOS Lines ──
          for (const item of state.bos) {
            const y = series.priceToCoordinate(item.price);
            const xStart = ts.timeToCoordinate(item.startTime);
            const xEnd = ts.timeToCoordinate(item.breakTime);

            if (y === null || xStart === null || xEnd === null) continue;

            const bY = y * dpr;
            const bXStart = xStart * dpr;
            const bXEnd = xEnd * dpr;

            ctx.strokeStyle = item.type === 'bullish' ? '#26a69a' : '#ef5350';
            ctx.lineWidth = dpr;
            ctx.setLineDash([4 * dpr, 4 * dpr]);
            ctx.beginPath();
            ctx.moveTo(bXStart, bY);
            ctx.lineTo(bXEnd, bY);
            ctx.stroke();

            // Label
            ctx.fillStyle = item.type === 'bullish' ? '#26a69a' : '#ef5350';
            ctx.font = `${9 * dpr}px sans-serif`;
            ctx.setLineDash([]);
            ctx.fillText('BOS', bXEnd - 24 * dpr, bY - 4 * dpr);
          }

          // ── 4. Draw CHoCH Lines ──
          for (const item of state.choch) {
            const y = series.priceToCoordinate(item.price);
            const xStart = ts.timeToCoordinate(item.startTime);
            const xEnd = ts.timeToCoordinate(item.breakTime);

            if (y === null || xStart === null || xEnd === null) continue;

            const bY = y * dpr;
            const bXStart = xStart * dpr;
            const bXEnd = xEnd * dpr;

            ctx.strokeStyle = item.type === 'bullish' ? '#26a69a' : '#ef5350';
            ctx.lineWidth = 1.5 * dpr;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(bXStart, bY);
            ctx.lineTo(bXEnd, bY);
            ctx.stroke();

            // Label
            ctx.fillStyle = item.type === 'bullish' ? '#26a69a' : '#ef5350';
            ctx.font = `bold ${9 * dpr}px sans-serif`;
            ctx.fillText('CHoCH', bXEnd - 36 * dpr, bY - 4 * dpr);
          }

          ctx.restore();
        });
      },
    };
  }
}
