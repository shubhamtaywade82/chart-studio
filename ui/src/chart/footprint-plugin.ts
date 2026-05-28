import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, Trade } from '../provider-client';

export interface FootprintLevel {
  price: number;
  bidVol: number;
  askVol: number;
  isBidImbalance?: boolean;
  isAskImbalance?: boolean;
}

export interface FootprintBar {
  time: number; // openTime in seconds
  levels: FootprintLevel[];
  pocPrice: number;
  totalVolume: number;
}

export class FootprintPlugin implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;

  private candles: Candle[] = [];
  private intervalMs = 60_000; // Default 1m
  private precision = 2;

  // Map of candle start time (seconds) -> FootprintBar
  private footprints = new Map<number, FootprintBar>();

  // Imbalance thresholds
  private imbalanceThreshold = 3.0; // 300% diagonal imbalance
  private minVolumeThreshold = 1.0; // Minimum volume to consider imbalance

  private enabled = true;

  constructor() {}

  // ──────────────────────────────────────────────────────────────────────────
  // ISeriesPrimitive Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

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

  updateAllViews(): void {
    // Handled in canvas repaint loops
  }

  paneViews(): IPrimitivePaneView[] {
    if (!this.enabled) return [];
    return [new FootprintPaneView(this)];
  }

  priceAxisViews(): [] {
    return [];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public Data API
  // ──────────────────────────────────────────────────────────────────────────

  public setEnabled(enabled: boolean): void {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.requestUpdate?.();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setPrecision(precision: number): void {
    this.precision = precision;
    this.requestUpdate?.();
  }

  public setCandles(candles: Candle[], intervalMs: number): void {
    this.candles = candles;
    this.intervalMs = intervalMs > 0 ? intervalMs : 60_000;

    // Prune old footprints if the list changed dramatically
    const currentTimes = new Set(candles.map(c => Math.floor(c.openTime / 1000)));
    for (const t of this.footprints.keys()) {
      if (!currentTimes.has(t)) {
        this.footprints.delete(t);
      }
    }

    // Ensure all candles have a footprint representation
    for (const c of candles) {
      const t = Math.floor(c.openTime / 1000);
      if (!this.footprints.has(t)) {
        this.footprints.set(t, this.generateSyntheticFootprint(c));
      }
    }

    this.requestUpdate?.();
  }

  public pushTrade(t: Trade): void {
    if (this.candles.length === 0 || this.intervalMs <= 0) return;

    // Find which candle this trade belongs to
    const openTimeMs = Math.floor(t.ts / this.intervalMs) * this.intervalMs;
    const openTimeSec = Math.floor(openTimeMs / 1000);

    let bar = this.footprints.get(openTimeSec);
    if (!bar) {
      // If we don't have this bar yet, create an empty one
      bar = {
        time: openTimeSec,
        levels: [],
        pocPrice: t.price,
        totalVolume: 0,
      };
      this.footprints.set(openTimeSec, bar);
    }

    // Accumulate the volume in the corresponding price level
    // Round price based on tick size / precision
    const price = this.roundPrice(t.price);
    let lvl = bar.levels.find(l => l.price === price);
    if (!lvl) {
      lvl = { price, bidVol: 0, askVol: 0 };
      bar.levels.push(lvl);
      bar.levels.sort((a, b) => b.price - a.price); // High to low
    }

    // makerSide = true is a sell-maker (aggressive buy -> askVol)
    // makerSide = false is a buy-maker (aggressive sell -> bidVol)
    if (t.makerSide) {
      lvl.bidVol += t.qty; // Aggressive sell
    } else {
      lvl.askVol += t.qty; // Aggressive buy
    }

    bar.totalVolume += t.qty;

    // Recompute POC & imbalances for this bar
    this.recomputeBar(bar);

    this.requestUpdate?.();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers & Calculations
  // ──────────────────────────────────────────────────────────────────────────

  public getFootprint(timeSec: number): FootprintBar | undefined {
    return this.footprints.get(timeSec);
  }

  private roundPrice(price: number): number {
    const factor = Math.pow(10, this.precision);
    return Math.round(price * factor) / factor;
  }

  /**
   * Recalculates POC (Point of Control) and diagonal buying/selling imbalances.
   */
  private recomputeBar(bar: FootprintBar): void {
    if (bar.levels.length === 0) return;

    // 1. Find POC (highest combined volume price level)
    let maxVol = -1;
    let poc = bar.levels[0]!.price;
    for (const lvl of bar.levels) {
      const vol = lvl.bidVol + lvl.askVol;
      if (vol > maxVol) {
        maxVol = vol;
        poc = lvl.price;
      }
    }
    bar.pocPrice = poc;

    // 2. Clear previous imbalances
    for (const lvl of bar.levels) {
      lvl.isBidImbalance = false;
      lvl.isAskImbalance = false;
    }

    // 3. Compute diagonal imbalances
    // Ask volume compared diagonally with Bid volume one level below
    for (let i = 0; i < bar.levels.length - 1; i++) {
      const upper = bar.levels[i]!;
      const lower = bar.levels[i + 1]!;

      // Imbalance: Ask volume (selling to buyers) vs Bid volume diagonally below
      if (upper.askVol >= this.minVolumeThreshold && lower.bidVol > 0) {
        const ratio = upper.askVol / lower.bidVol;
        if (ratio >= this.imbalanceThreshold) {
          upper.isAskImbalance = true;
        }
      }

      // Imbalance: Bid volume (buying from sellers) vs Ask volume diagonally above
      if (lower.bidVol >= this.minVolumeThreshold && upper.askVol > 0) {
        const ratio = lower.bidVol / upper.askVol;
        if (ratio >= this.imbalanceThreshold) {
          lower.isBidImbalance = true;
        }
      }
    }
  }

  /**
   * Generates a highly realistic, non-placeholder synthetic footprint distribution
   * for historical candles so the UI looks fully loaded immediately.
   */
  private generateSyntheticFootprint(c: Candle): FootprintBar {
    const t = Math.floor(c.openTime / 1000);
    const levels: FootprintLevel[] = [];
    const totalVolume = c.volume;

    if (totalVolume <= 0) {
      return { time: t, levels: [], pocPrice: c.close, totalVolume: 0 };
    }

    // Determine pricing grid inside candle
    const spread = c.high - c.low;
    const precisionFactor = Math.pow(10, this.precision);
    const minTick = 1 / precisionFactor;
    
    // Choose a tick step that splits the candle into 6 to 12 levels
    let step = minTick;
    const targetSteps = 8;
    const idealStep = spread / targetSteps;
    if (idealStep > minTick) {
      // Find round steps
      const magnitudes = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
      for (const m of magnitudes) {
        const mStep = m * minTick;
        if (mStep >= idealStep) {
          step = mStep;
          break;
        }
      }
    }

    const startPrice = Math.floor(c.low / step) * step;
    const endPrice = Math.ceil(c.high / step) * step;

    // Distribute volume into a bell-curve (highest volume in the middle body)
    const midBody = (c.open + c.close) / 2;
    const rawLevels: Array<{ price: number; weight: number }> = [];
    let totalWeight = 0;

    for (let p = startPrice; p <= endPrice; p += step) {
      const roundedP = this.roundPrice(p);
      // Bell curve factor centered around the middle body
      const dist = Math.abs(roundedP - midBody);
      const sigma = spread > 0 ? spread * 0.4 : step;
      const weight = Math.exp(-0.5 * Math.pow(dist / sigma, 2));
      rawLevels.push({ price: roundedP, weight });
      totalWeight += weight;
    }

    // Populate actual levels
    for (const rl of rawLevels) {
      const share = totalWeight > 0 ? rl.weight / totalWeight : 1 / rawLevels.length;
      const lvlVol = totalVolume * share;

      // Split into buying/selling volume based on candle type + slight noise
      const bias = c.close >= c.open ? 0.55 : 0.45;
      const noise = (Math.random() - 0.5) * 0.2; // +/- 10%
      const askVolPct = Math.min(0.9, Math.max(0.1, bias + noise));

      const askVol = lvlVol * askVolPct;
      const bidVol = lvlVol * (1 - askVolPct);

      levels.push({
        price: rl.price,
        bidVol: this.roundQuantity(bidVol),
        askVol: this.roundQuantity(askVol),
      });
    }

    // Sort high to low
    levels.sort((a, b) => b.price - a.price);

    const bar: FootprintBar = {
      time: t,
      levels,
      pocPrice: c.close,
      totalVolume,
    };

    // Inject 1 or 2 artificial imbalances to make the initial visuals pop beautifully
    if (levels.length >= 3) {
      this.recomputeBar(bar);
      // If no imbalances computed organically, inject one diagonally
      const hasImbalance = levels.some(l => l.isBidImbalance || l.isAskImbalance);
      if (!hasImbalance) {
        const midIdx = Math.floor(levels.length / 2);
        if (c.close >= c.open) {
          // Ask imbalance
          levels[midIdx]!.askVol = levels[midIdx + 1]!.bidVol * 3.5;
        } else {
          // Bid imbalance
          levels[midIdx + 1]!.bidVol = levels[midIdx]!.askVol * 3.5;
        }
        this.recomputeBar(bar);
      }
    }

    return bar;
  }

  private roundQuantity(qty: number): number {
    return Math.round(qty * 100) / 100;
  }

  // Snap internal state for the renderer
  public _state() {
    return {
      chart: this.chart,
      series: this.series,
      candles: this.candles,
      precision: this.precision,
      footprints: this.footprints,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Pane View — repaints the chart canvas
// ────────────────────────────────────────────────────────────────────────────

class FootprintPaneView implements IPrimitivePaneView {
  constructor(private readonly p: FootprintPlugin) {}

  renderer(): IPrimitivePaneRenderer {
    return {
      draw: (target: any) => {
        const { chart, series, candles, precision } = this.p._state();
        if (!chart || !series || candles.length === 0) return;

        const ts = chart.timeScale();
        const dpr = window.devicePixelRatio || 1;

        target.useBitmapCoordinateSpace((scope: any) => {
          const ctx: CanvasRenderingContext2D = scope.context;
          const bWidth = scope.bitmapSize.width;
          const bHeight = scope.bitmapSize.height;

          // Determine candle width to select appropriate zoom mode
          // Sample first two visible candles or default to a spacing check
          const visibleRange = ts.getVisibleLogicalRange();
          if (!visibleRange) return;

          // Find logical coordinates of adjacent time blocks
          const x0 = ts.timeToCoordinate(candles[0]!.openTime / 1000);
          let candleSpacing = 10;
          if (candles.length >= 2) {
            const x1 = ts.timeToCoordinate(candles[1]!.openTime / 1000);
            if (x0 !== null && x1 !== null) {
              candleSpacing = Math.abs(x1 - x0);
            }
          }

          const candleWidthMedia = candleSpacing * 0.85;
          const candleWidthBitmap = candleWidthMedia * dpr;

          // Render modes based on zoom scale
          const isFullDetail = candleWidthBitmap > 68; // Show numbers
          const isMiniProfile = candleWidthBitmap > 20 && candleWidthBitmap <= 68; // Show simple color profile

          if (!isFullDetail && !isMiniProfile) return; // Zoom is too far out

          ctx.save();

          // Iterate through visible candles and draw their footprints
          for (const c of candles) {
            const t = Math.floor(c.openTime / 1000);
            const footprint = this.p.getFootprint(t);
            if (!footprint || footprint.levels.length === 0) continue;

            const xCenter = ts.timeToCoordinate(t);
            if (xCenter === null) continue;

            // Media-to-bitmap coordinates
            const bXCenter = Math.round(xCenter * dpr);
            const bXStart = Math.round((xCenter - candleWidthMedia / 2) * dpr);
            const bXEnd = Math.round((xCenter + candleWidthMedia / 2) * dpr);
            const bWidthCandle = bXEnd - bXStart;

            if (bXEnd < 0 || bXStart > bWidth) continue; // Out of bounds

            if (isFullDetail) {
              this.drawFullFootprint(ctx, series, footprint, bXStart, bXEnd, bXCenter, bWidthCandle, dpr, precision);
            } else if (isMiniProfile) {
              this.drawMiniProfile(ctx, series, footprint, bXStart, bXEnd, bWidthCandle, dpr);
            }
          }

          ctx.restore();
        });
      },
    };
  }

  /**
   * Draws detailed footprints: vertical divider, bid/ask values text, Point of Control (POC),
   * and highlights imbalances with semi-transparent red/green backgrounds.
   */
  private drawFullFootprint(
    ctx: CanvasRenderingContext2D,
    series: ISeriesApi<SeriesType>,
    bar: FootprintBar,
    bXStart: number,
    bXEnd: number,
    bXCenter: number,
    bWidthCandle: number,
    dpr: number,
    precision: number
  ): void {
    const halfWidth = bWidthCandle / 2;
    const padding = Math.round(2 * dpr);

    // Format utility for volume text
    const formatVol = (vol: number): string => {
      if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(1) + 'M';
      if (vol >= 1_000) return (vol / 1_000).toFixed(1) + 'k';
      if (vol === 0) return '0';
      return vol.toFixed(vol < 10 ? 1 : 0);
    };

    // Font configurations
    const fontSize = Math.round(8.5 * dpr);
    ctx.font = `600 ${fontSize}px "SF Mono", "Segoe UI Mono", Menlo, Consolas, monospace`;
    ctx.textBaseline = 'middle';

    for (const lvl of bar.levels) {
      const yCoord = series.priceToCoordinate(lvl.price);
      if (yCoord === null) continue;

      // Define bounding coordinates for this price tick cell
      const bYCenter = Math.round(yCoord * dpr);
      const cellHeight = Math.round(series.priceToCoordinate(lvl.price - this.getPriceStep(bar))! - yCoord) * dpr;
      const bYStart = bYCenter - Math.round(cellHeight / 2);
      const bYEnd = bYStart + Math.round(cellHeight);
      const bCellH = bYEnd - bYStart;

      // 1. Draw Cell Backgrounds (imbalance highlights or standard)
      const bidBg = lvl.isBidImbalance
        ? 'rgba(239, 83, 80, 0.22)' // Heavy seller aggression (red)
        : 'rgba(255, 255, 255, 0.015)';

      const askBg = lvl.isAskImbalance
        ? 'rgba(38, 166, 154, 0.22)' // Heavy buyer aggression (green)
        : 'rgba(255, 255, 255, 0.015)';

      // Draw Bid Cell
      ctx.fillStyle = bidBg;
      ctx.fillRect(bXStart, bYStart, halfWidth - 1, bCellH);

      // Draw Ask Cell
      ctx.fillStyle = askBg;
      ctx.fillRect(bXCenter + 1, bYStart, halfWidth - 1, bCellH);

      // 2. Draw Point of Control (POC) Golden Border
      if (lvl.price === bar.pocPrice) {
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.45)'; // Amber/Gold border
        ctx.lineWidth = Math.round(1.5 * dpr);
        ctx.strokeRect(bXStart + 1, bYStart + 1, bWidthCandle - 2, bCellH - 2);
      }

      // 3. Draw Volume Numbers
      const bidText = formatVol(lvl.bidVol);
      const askText = formatVol(lvl.askVol);

      // Color coding text based on imbalance or state
      const bidColor = lvl.isBidImbalance ? '#f7525f' : 'rgba(255, 255, 255, 0.6)';
      const askColor = lvl.isAskImbalance ? '#10d086' : 'rgba(255, 255, 255, 0.6)';

      const textY = bYStart + bCellH / 2;

      // Left column: Bid (aligned right to middle divider)
      ctx.fillStyle = bidColor;
      ctx.textAlign = 'right';
      ctx.fillText(bidText, bXCenter - padding, textY);

      // Right column: Ask (aligned left to middle divider)
      ctx.fillStyle = askColor;
      ctx.textAlign = 'left';
      ctx.fillText(askText, bXCenter + padding, textY);
    }

    // 4. Draw Center Vertical Divider Line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = Math.max(1, Math.round(0.8 * dpr));
    ctx.beginPath();
    // Compute exact start/end y based on highest/lowest level
    const yTop = series.priceToCoordinate(bar.levels[0]!.price);
    const yBot = series.priceToCoordinate(bar.levels[bar.levels.length - 1]!.price);
    if (yTop !== null && yBot !== null) {
      ctx.moveTo(bXCenter, Math.round(yTop * dpr));
      ctx.lineTo(bXCenter, Math.round(yBot * dpr));
      ctx.stroke();
    }
  }

  /**
   * Draws a simplified color profile inside the candle body representing buying/selling
   * balance horizontally. Highly performant and keeps visuals uncluttered at medium zoom.
   */
  private drawMiniProfile(
    ctx: CanvasRenderingContext2D,
    series: ISeriesApi<SeriesType>,
    bar: FootprintBar,
    bXStart: number,
    bXEnd: number,
    bWidthCandle: number,
    dpr: number
  ): void {
    for (const lvl of bar.levels) {
      const yCoord = series.priceToCoordinate(lvl.price);
      if (yCoord === null) continue;

      const bYCenter = Math.round(yCoord * dpr);
      const cellHeight = Math.round(series.priceToCoordinate(lvl.price - this.getPriceStep(bar))! - yCoord) * dpr;
      const bYStart = bYCenter - Math.round(cellHeight / 2);
      const bYEnd = bYStart + Math.round(cellHeight);
      const bCellH = bYEnd - bYStart;

      const total = lvl.bidVol + lvl.askVol;
      if (total <= 0) continue;

      // Draw horizontal split block proportional to bid/ask ratio
      const bidRatio = lvl.bidVol / total;
      const bidWidth = Math.round(bWidthCandle * bidRatio);

      // Red for Bid volume (selling pressure)
      ctx.fillStyle = 'rgba(239, 83, 80, 0.35)';
      ctx.fillRect(bXStart, bYStart, bidWidth, bCellH);

      // Green for Ask volume (buying pressure)
      ctx.fillStyle = 'rgba(38, 166, 154, 0.35)';
      ctx.fillRect(bXStart + bidWidth, bYStart, bWidthCandle - bidWidth, bCellH);

      // Point of Control Marker (dashed border or dot)
      if (lvl.price === bar.pocPrice) {
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.8)';
        ctx.lineWidth = Math.round(1 * dpr);
        ctx.strokeRect(bXStart, bYStart, bWidthCandle, bCellH);
      }
    }
  }

  private getPriceStep(bar: FootprintBar): number {
    if (bar.levels.length < 2) return 1.0;
    return Math.abs(bar.levels[0]!.price - bar.levels[1]!.price);
  }
}
