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

export interface SMCStructure {
  type: 'bullish' | 'bearish';
  price: number;
  startTime: UTCTimestamp;
  breakTime: UTCTimestamp;
  isDisplacement: boolean;
}

export interface SMCOrderBlock {
  type: 'bullish' | 'bearish';
  startTime: UTCTimestamp;
  priceMin: number;
  priceMax: number;
  mitigated: boolean;
  mitigatedTime?: UTCTimestamp;
  isOrigin: boolean;
}

export interface SMCZone {
  type: 'bullish' | 'bearish';
  startTime: UTCTimestamp;
  priceMin: number;
  priceMax: number;
  mitigated: boolean;
  mitigatedTime?: UTCTimestamp;
}

export class SmcPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private candles: Candle[] = [];

  // Computed SMC Structures
  swings: Array<{ type: 'high' | 'low'; index: number; price: number; time: UTCTimestamp; broken: boolean }> = [];
  bos: SMCStructure[] = [];
  choch: SMCStructure[] = [];
  orderBlocks: SMCOrderBlock[] = [];
  fvgs: SMCZone[] = [];
  
  // Premium/Discount Array
  pdRange: { high: number; low: number; equilibrium: number } | null = null;

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

  private lastCalcTime = 0;
  private lastLength = 0;

  setCandles(candles: Candle[]): void {
    this.candles = candles;
    const now = performance.now();
    const lengthChanged = candles.length !== this.lastLength;

    if (lengthChanged || now - this.lastCalcTime > 500) {
      this.calculateSMC();
      this.lastCalcTime = now;
      this.lastLength = candles.length;
    }
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
    if (this.candles.length < this.period * 2 + 10) {
      this.swings = []; this.bos = []; this.choch = []; this.orderBlocks = []; this.fvgs = [];
      return;
    }

    const candles = this.candles;
    const n = candles.length;
    const period = this.period;

    // 1. Detect Swings (Fractals)
    const swings: typeof this.swings = [];
    for (let i = period; i < n - period; i++) {
      const c = candles[i]!;
      let isHigh = true, isLow = true;
      for (let j = 1; j <= period; j++) {
        if (candles[i - j]!.high >= c.high || candles[i + j]!.high > c.high) isHigh = false;
        if (candles[i - j]!.low <= c.low || candles[i + j]!.low < c.low) isLow = false;
      }
      if (isHigh) swings.push({ type: 'high', index: i, price: c.high, time: Math.floor(c.openTime / 1000) as UTCTimestamp, broken: false });
      if (isLow) swings.push({ type: 'low', index: i, price: c.low, time: Math.floor(c.openTime / 1000) as UTCTimestamp, broken: false });
    }

    // 2. Premium/Discount Range (Last significant High/Low)
    if (swings.length >= 2) {
      const lastHigh = [...swings].reverse().find(s => s.type === 'high');
      const lastLow = [...swings].reverse().find(s => s.type === 'low');
      if (lastHigh && lastLow) {
        this.pdRange = { high: lastHigh.price, low: lastLow.price, equilibrium: (lastHigh.price + lastLow.price) / 2 };
      }
    }

    // 3. Detect BOS/CHoCH with Displacement
    const bos: SMCStructure[] = [];
    const choch: SMCStructure[] = [];
    const orderBlocks: SMCOrderBlock[] = [];
    let trend: 'bullish' | 'bearish' = 'bullish';

    for (let i = 0; i < n; i++) {
      const c = candles[i]!;
      const cTime = Math.floor(c.openTime / 1000) as UTCTimestamp;
      const confirmed = swings.filter(s => s.index <= i - period);
      const activeHigh = confirmed.filter(s => s.type === 'high' && !s.broken).pop();
      const activeLow = confirmed.filter(s => s.type === 'low' && !s.broken).pop();

      // DISPLACEMENT CHECK: Is the break strong? (Body size > 1.5x average of last 5)
      const body = Math.abs(c.close - c.open);
      let avgBody = 0;
      for (let k = Math.max(0, i - 5); k < i; k++) avgBody += Math.abs(candles[k]!.close - candles[k]!.open);
      avgBody /= 5;
      const isDisplaced = body > avgBody * 1.5;

      if (trend === 'bullish') {
        if (activeHigh && c.close > activeHigh.price) {
          bos.push({ type: 'bullish', price: activeHigh.price, startTime: activeHigh.time, breakTime: cTime, isDisplacement: isDisplaced });
          activeHigh.broken = true;
          this.addOrderBlock(orderBlocks, candles, activeHigh.index, 'bullish', true);
        }
        if (activeLow && c.close < activeLow.price) {
          choch.push({ type: 'bearish', price: activeLow.price, startTime: activeLow.time, breakTime: cTime, isDisplacement: isDisplaced });
          activeLow.broken = true;
          trend = 'bearish';
          this.addOrderBlock(orderBlocks, candles, activeLow.index, 'bearish', true);
        }
      } else {
        if (activeLow && c.close < activeLow.price) {
          bos.push({ type: 'bearish', price: activeLow.price, startTime: activeLow.time, breakTime: cTime, isDisplacement: isDisplaced });
          activeLow.broken = true;
          this.addOrderBlock(orderBlocks, candles, activeLow.index, 'bearish', true);
        }
        if (activeHigh && c.close > activeHigh.price) {
          choch.push({ type: 'bullish', price: activeHigh.price, startTime: activeHigh.time, breakTime: cTime, isDisplacement: isDisplaced });
          activeHigh.broken = true;
          trend = 'bullish';
          this.addOrderBlock(orderBlocks, candles, activeHigh.index, 'bullish', true);
        }
      }
    }

    // 4. Fair Value Gaps
    const fvgs: SMCZone[] = [];
    for (let i = 2; i < n; i++) {
      const c2 = candles[i - 2]!, c1 = candles[i - 1]!, c = candles[i]!;
      if (c2.high < c.low) fvgs.push({ type: 'bullish', startTime: Math.floor(c1.openTime / 1000) as UTCTimestamp, priceMin: c2.high, priceMax: c.low, mitigated: false });
      if (c2.low > c.high) fvgs.push({ type: 'bearish', startTime: Math.floor(c1.openTime / 1000) as UTCTimestamp, priceMin: c.high, priceMax: c2.low, mitigated: false });
    }

    // 5. Mitigation Tracing
    this.traceMitigation(orderBlocks, candles);
    this.traceMitigation(fvgs, candles);

    this.swings = swings; this.bos = bos; this.choch = choch; this.orderBlocks = orderBlocks; this.fvgs = fvgs;
  }

  private addOrderBlock(obs: SMCOrderBlock[], candles: Candle[], swingIdx: number, type: 'bullish' | 'bearish', isOrigin: boolean): void {
    // Find the last opposite candle before the swing move
    let obIdx = swingIdx;
    for (let k = swingIdx; k >= Math.max(0, swingIdx - 10); k--) {
      const c = candles[k]!;
      if (type === 'bullish' ? c.close < c.open : c.close > c.open) {
        obIdx = k;
        break;
      }
    }
    const ob = candles[obIdx]!;
    obs.push({
      type, isOrigin,
      startTime: Math.floor(ob.openTime / 1000) as UTCTimestamp,
      priceMin: ob.low, priceMax: ob.high,
      mitigated: false
    });
  }

  private traceMitigation(zones: SMCZone[] | SMCOrderBlock[], candles: Candle[]): void {
    const n = candles.length;
    for (const z of zones) {
      const startIdx = candles.findIndex(c => Math.floor(c.openTime / 1000) === z.startTime);
      if (startIdx === -1) continue;
      for (let k = startIdx + 1; k < n; k++) {
        const c = candles[k]!;
        if ((z.type === 'bullish' && c.low <= z.priceMin) || (z.type === 'bearish' && c.high >= z.priceMax)) {
          z.mitigated = true;
          z.mitigatedTime = Math.floor(c.openTime / 1000) as UTCTimestamp;
          break;
        }
      }
    }
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
        const dpr = window.devicePixelRatio || 1;

        target.useBitmapCoordinateSpace((scope: any) => {
          const ctx: CanvasRenderingContext2D = scope.context;
          const bWidth = scope.bitmapSize.width;
          const bHeight = scope.bitmapSize.height;
          ctx.save();

          // 1. Draw Premium/Discount Zones
          if (this.p.pdRange) {
            const yHigh = series.priceToCoordinate(this.p.pdRange.high);
            const yLow = series.priceToCoordinate(this.p.pdRange.low);
            const yMid = series.priceToCoordinate(this.p.pdRange.equilibrium);
            if (yHigh !== null && yLow !== null && yMid !== null) {
              // Premium (Reddish)
              ctx.fillStyle = 'rgba(239, 83, 80, 0.02)';
              ctx.fillRect(0, Math.round(yHigh * dpr), bWidth, Math.round((yMid - yHigh) * dpr));
              // Discount (Greenish)
              ctx.fillStyle = 'rgba(38, 166, 154, 0.02)';
              ctx.fillRect(0, Math.round(yMid * dpr), bWidth, Math.round((yLow - yMid) * dpr));
              // Equilibrium line
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
              ctx.setLineDash([5 * dpr, 5 * dpr]);
              ctx.beginPath();
              ctx.moveTo(0, Math.round(yMid * dpr));
              ctx.lineTo(bWidth, Math.round(yMid * dpr));
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
              ctx.font = `${Math.round(10 * dpr)}px sans-serif`;
              ctx.fillText('EQUILIBRIUM (50%)', 10 * dpr, Math.round(yMid * dpr) - 4 * dpr);
            }
          }

          // 2. Draw FVGs
          this.p.fvgs.filter(f => !f.mitigated).slice(-6).forEach(fvg => {
            const yMin = series.priceToCoordinate(fvg.priceMin), yMax = series.priceToCoordinate(fvg.priceMax);
            const xStart = ts.timeToCoordinate(fvg.startTime);
            if (yMin !== null && yMax !== null && xStart !== null) {
              ctx.fillStyle = fvg.type === 'bullish' ? 'rgba(76, 175, 80, 0.04)' : 'rgba(255, 152, 0, 0.04)';
              ctx.fillRect(Math.round(xStart * dpr), Math.round(yMax * dpr), bWidth, Math.round((yMin - yMax) * dpr));
            }
          });

          // 3. Draw Order Blocks
          this.p.orderBlocks.filter(ob => !ob.mitigated).slice(-6).forEach(ob => {
            const yMin = series.priceToCoordinate(ob.priceMin), yMax = series.priceToCoordinate(ob.priceMax);
            const xStart = ts.timeToCoordinate(ob.startTime);
            if (yMin !== null && yMax !== null && xStart !== null) {
              ctx.fillStyle = ob.type === 'bullish' ? 'rgba(38, 166, 154, 0.1)' : 'rgba(239, 83, 80, 0.1)';
              ctx.strokeStyle = ob.type === 'bullish' ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)';
              ctx.fillRect(Math.round(xStart * dpr), Math.round(yMax * dpr), bWidth, Math.round((yMin - yMax) * dpr));
              ctx.strokeRect(Math.round(xStart * dpr), Math.round(yMax * dpr), bWidth, Math.round((yMin - yMax) * dpr));
              ctx.fillStyle = ob.type === 'bullish' ? '#4db6ac' : '#e57373';
              ctx.font = `bold ${Math.round(9 * dpr)}px sans-serif`;
              ctx.fillText(ob.isOrigin ? 'ORIGIN OB' : 'OB', Math.round(xStart * dpr) + 4 * dpr, Math.round(yMax * dpr) + 12 * dpr);
            }
          });

          // 4. Draw BOS/CHoCH with Displacement markers
          const drawStruct = (list: SMCStructure[], label: string) => {
            list.slice(-3).forEach(s => {
              const y = series.priceToCoordinate(s.price), xS = ts.timeToCoordinate(s.startTime), xE = ts.timeToCoordinate(s.breakTime);
              if (y !== null && xS !== null && xE !== null) {
                ctx.strokeStyle = s.type === 'bullish' ? '#26a69a' : '#ef5350';
                ctx.setLineDash(label === 'BOS' ? [4*dpr, 4*dpr] : []);
                ctx.beginPath(); ctx.moveTo(Math.round(xS * dpr), Math.round(y * dpr)); ctx.lineTo(Math.round(xE * dpr), Math.round(y * dpr)); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = ctx.strokeStyle;
                ctx.font = `${s.isDisplacement ? 'bold ' : ''}${Math.round(10 * dpr)}px sans-serif`;
                ctx.fillText(`${label}${s.isDisplacement ? ' ⚡' : ''}`, Math.round(xS * dpr) + (Math.round(xE * dpr) - Math.round(xS * dpr))/2 - 10*dpr, Math.round(y * dpr) - 4*dpr);
              }
            });
          };
          drawStruct(this.p.bos, 'BOS');
          drawStruct(this.p.choch, 'CHoCH');

          ctx.restore();
        });
      }
    };
  }
}
