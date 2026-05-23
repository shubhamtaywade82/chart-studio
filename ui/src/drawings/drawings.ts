import type { IPriceLine, ISeriesApi, UTCTimestamp, LineWidth } from 'lightweight-charts';
import { LineSeries, LineStyle } from 'lightweight-charts';
import type { ChartView } from '../chart';

const STORAGE_KEY = 'chart-studio:drawings:v1';

export type DrawingTool = 'cursor' | 'hline' | 'trendline' | 'fib' | 'rectangle' | 'ray';

export interface HLineDrawing {
  id: string;
  kind: 'hline';
  price: number;
  color: string;
}

export interface TrendLineDrawing {
  id: string;
  kind: 'trendline';
  t1: UTCTimestamp; p1: number;
  t2: UTCTimestamp; p2: number;
  color: string;
}

export interface FibDrawing {
  id: string;
  kind: 'fib';
  t1: UTCTimestamp; p1: number;
  t2: UTCTimestamp; p2: number;
  color: string;
}

export interface RectangleDrawing {
  id: string;
  kind: 'rectangle';
  t1: UTCTimestamp; p1: number;
  t2: UTCTimestamp; p2: number;
  color: string;
}

export interface RayDrawing {
  id: string;
  kind: 'ray';
  t1: UTCTimestamp; p1: number;
  t2: UTCTimestamp; p2: number;
  color: string;
}

export type Drawing = HLineDrawing | TrendLineDrawing | FibDrawing | RectangleDrawing | RayDrawing;

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
const FIB_COLORS: Record<number, string> = {
  0: '#aaaaaa',
  0.236: '#ff9800',
  0.382: '#4caf50',
  0.5: '#2196f3',
  0.618: '#9c27b0',
  0.786: '#f44336',
  1: '#aaaaaa',
};

interface StoredDrawings { [providerSymbol: string]: Drawing[] }

const loadStore = (): StoredDrawings => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); } catch { return {}; }
};
const persistStore = (s: StoredDrawings): void => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* noop */ }
};
const idGen = (): string => crypto.randomUUID();

// Ray extends to a far-future timestamp (100 years out)
const FAR_FUTURE = (Date.now() / 1000 + 60 * 60 * 24 * 365 * 100) as UTCTimestamp;

/**
 * Drawing layer: horizontal price lines, trend lines, Fibonacci retracements,
 * rectangles, and rays. Persists per (provider, symbol).
 */
export class DrawingLayer {
  private currentKey: string | null = null;
  private drawings: Drawing[] = [];
  private tool: DrawingTool = 'cursor';
  private store: StoredDrawings = loadStore();
  private hlineHandles = new Map<string, IPriceLine>();
  private trendlineHandles = new Map<string, ISeriesApi<'Line'>>();
  private fibHandles = new Map<string, IPriceLine[]>();
  private rectHandles = new Map<string, ISeriesApi<'Line'>[]>();
  private rayHandles = new Map<string, ISeriesApi<'Line'>>();
  private pendingPoint: { t: UTCTimestamp; p: number } | null = null;
  private toolListeners = new Set<(t: DrawingTool) => void>();

  constructor(private readonly chart: ChartView, private readonly container: HTMLElement) {
    container.addEventListener('click', (ev) => this.handleClick(ev));
  }

  setTool(tool: DrawingTool): void {
    this.tool = tool;
    this.pendingPoint = null;
    this.container.style.cursor = tool === 'cursor' ? '' : 'crosshair';
    for (const fn of this.toolListeners) fn(tool);
  }

  currentTool(): DrawingTool { return this.tool; }

  onToolChange(fn: (t: DrawingTool) => void): () => void {
    this.toolListeners.add(fn);
    return () => { this.toolListeners.delete(fn); };
  }

  setSymbol(provider: string, symbol: string): void {
    this.clearMounted();
    this.currentKey = `${provider}:${symbol}`;
    this.drawings = this.store[this.currentKey] ?? [];
    this.mountAll();
  }

  list(): Drawing[] { return this.drawings; }

  remove(id: string): void {
    this.drawings = this.drawings.filter((d) => d.id !== id);
    const main = this.chart.getMainSeries();
    const api = this.chart.getApi();

    const hh = this.hlineHandles.get(id);
    if (hh) { try { main.removePriceLine(hh); } catch { /* noop */ } this.hlineHandles.delete(id); }

    const th = this.trendlineHandles.get(id);
    if (th) { try { api.removeSeries(th); } catch { /* noop */ } this.trendlineHandles.delete(id); }

    const fh = this.fibHandles.get(id);
    if (fh) { for (const pl of fh) { try { main.removePriceLine(pl); } catch { /* noop */ } } this.fibHandles.delete(id); }

    const rh = this.rectHandles.get(id);
    if (rh) { for (const s of rh) { try { api.removeSeries(s); } catch { /* noop */ } } this.rectHandles.delete(id); }

    const rayH = this.rayHandles.get(id);
    if (rayH) { try { api.removeSeries(rayH); } catch { /* noop */ } this.rayHandles.delete(id); }

    this.persist();
  }

  clear(): void { for (const d of [...this.drawings]) this.remove(d.id); }

  private clearMounted(): void {
    const main = this.chart.getMainSeries();
    const api = this.chart.getApi();
    for (const h of this.hlineHandles.values()) { try { main.removePriceLine(h); } catch { /* noop */ } }
    for (const s of this.trendlineHandles.values()) { try { api.removeSeries(s); } catch { /* noop */ } }
    for (const pls of this.fibHandles.values()) { for (const pl of pls) { try { main.removePriceLine(pl); } catch { /* noop */ } } }
    for (const ss of this.rectHandles.values()) { for (const s of ss) { try { api.removeSeries(s); } catch { /* noop */ } } }
    for (const s of this.rayHandles.values()) { try { api.removeSeries(s); } catch { /* noop */ } }
    this.hlineHandles.clear();
    this.trendlineHandles.clear();
    this.fibHandles.clear();
    this.rectHandles.clear();
    this.rayHandles.clear();
  }

  private mountAll(): void { for (const d of this.drawings) this.mount(d); }

  private mount(d: Drawing): void {
    const main = this.chart.getMainSeries();
    const api = this.chart.getApi();

    if (d.kind === 'hline') {
      const handle = main.createPriceLine({
        price: d.price, color: d.color, lineStyle: LineStyle.Dashed,
        lineWidth: 1 as LineWidth, axisLabelVisible: true, title: '',
      });
      this.hlineHandles.set(d.id, handle);

    } else if (d.kind === 'trendline') {
      const s = api.addSeries(LineSeries, {
        color: d.color, lineWidth: 2 as LineWidth,
        lastValueVisible: false, priceLineVisible: false,
      });
      const ordered = orderByTime(
        { time: d.t1, value: d.p1 },
        { time: d.t2, value: d.p2 },
      );
      s.setData(ordered);
      this.trendlineHandles.set(d.id, s);

    } else if (d.kind === 'fib') {
      const priceLow = Math.min(d.p1, d.p2);
      const priceHigh = Math.max(d.p1, d.p2);
      const range = priceHigh - priceLow;
      const handles: IPriceLine[] = [];
      for (const level of FIB_LEVELS) {
        const price = priceLow + range * (1 - level);
        const pl = main.createPriceLine({
          price,
          color: FIB_COLORS[level] ?? d.color,
          lineStyle: LineStyle.Dashed,
          lineWidth: 1 as LineWidth,
          axisLabelVisible: true,
          title: `${(level * 100).toFixed(1)}%`,
        });
        handles.push(pl);
      }
      this.fibHandles.set(d.id, handles);

    } else if (d.kind === 'rectangle') {
      // Rectangle: 4 LineSeries segments forming the outline
      const pTop = Math.max(d.p1, d.p2);
      const pBot = Math.min(d.p1, d.p2);
      const tL = (Math.min(d.t1 as number, d.t2 as number)) as UTCTimestamp;
      const tR = (Math.max(d.t1 as number, d.t2 as number)) as UTCTimestamp;
      const opts = {
        color: d.color, lineWidth: 1 as LineWidth,
        lastValueVisible: false, priceLineVisible: false,
      };
      const top = api.addSeries(LineSeries, opts);
      top.setData([{ time: tL, value: pTop }, { time: tR, value: pTop }]);

      const bot = api.addSeries(LineSeries, opts);
      bot.setData([{ time: tL, value: pBot }, { time: tR, value: pBot }]);

      const left = api.addSeries(LineSeries, opts);
      left.setData([{ time: tL, value: pBot }, { time: tL, value: pTop }]);

      const right = api.addSeries(LineSeries, opts);
      right.setData([{ time: tR, value: pBot }, { time: tR, value: pTop }]);

      this.rectHandles.set(d.id, [top, bot, left, right]);

    } else if (d.kind === 'ray') {
      // Ray: line from (t1, p1) extending toward FAR_FUTURE at the slope of p1→p2
      const tDelta = (d.t2 as number) - (d.t1 as number);
      const pDelta = d.p2 - d.p1;
      const farPrice = tDelta !== 0
        ? d.p1 + pDelta * ((FAR_FUTURE as number - (d.t1 as number)) / tDelta)
        : d.p1;

      const s = api.addSeries(LineSeries, {
        color: d.color, lineWidth: 2 as LineWidth,
        lastValueVisible: false, priceLineVisible: false,
      });
      const tStart = (Math.min(d.t1 as number, d.t2 as number)) as UTCTimestamp;
      const pStart = tStart === d.t1 ? d.p1 : d.p2;
      s.setData([
        { time: tStart, value: pStart },
        { time: FAR_FUTURE, value: farPrice },
      ]);
      this.rayHandles.set(d.id, s);
    }
  }

  private handleClick(ev: MouseEvent): void {
    if (this.tool === 'cursor') return;
    const rect = this.container.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const time = this.chart.xToTime(x);
    const price = this.chart.yToPrice(y);
    if (typeof price !== 'number' || time === null) return;

    if (this.tool === 'hline') {
      const d: HLineDrawing = { id: idGen(), kind: 'hline', price, color: '#f0b400' };
      this.drawings.push(d);
      this.mount(d);
      this.persist();
      this.setTool('cursor');
      return;
    }

    // Tools requiring two clicks
    const twoClickTools: DrawingTool[] = ['trendline', 'fib', 'rectangle', 'ray'];
    if (twoClickTools.includes(this.tool)) {
      if (!this.pendingPoint) {
        this.pendingPoint = { t: time, p: price };
        return;
      }
      const pp = this.pendingPoint;
      this.pendingPoint = null;

      if (this.tool === 'trendline') {
        const d: TrendLineDrawing = {
          id: idGen(), kind: 'trendline', color: '#58a6ff',
          t1: pp.t, p1: pp.p, t2: time, p2: price,
        };
        this.drawings.push(d);
        this.mount(d);
      } else if (this.tool === 'fib') {
        const d: FibDrawing = {
          id: idGen(), kind: 'fib', color: '#f0b400',
          t1: pp.t, p1: pp.p, t2: time, p2: price,
        };
        this.drawings.push(d);
        this.mount(d);
      } else if (this.tool === 'rectangle') {
        const d: RectangleDrawing = {
          id: idGen(), kind: 'rectangle', color: '#58a6ff',
          t1: pp.t, p1: pp.p, t2: time, p2: price,
        };
        this.drawings.push(d);
        this.mount(d);
      } else if (this.tool === 'ray') {
        const d: RayDrawing = {
          id: idGen(), kind: 'ray', color: '#ff9800',
          t1: pp.t, p1: pp.p, t2: time, p2: price,
        };
        this.drawings.push(d);
        this.mount(d);
      }
      this.persist();
      this.setTool('cursor');
    }
  }

  private persist(): void {
    if (!this.currentKey) return;
    this.store[this.currentKey] = this.drawings;
    persistStore(this.store);
  }
}

function orderByTime(
  a: { time: UTCTimestamp; value: number },
  b: { time: UTCTimestamp; value: number },
): [{ time: UTCTimestamp; value: number }, { time: UTCTimestamp; value: number }] {
  return (a.time as number) <= (b.time as number) ? [a, b] : [b, a];
}
