/**
 * CandleScopeOverlay
 *
 * A multi-layer canvas overlay that renders live market microstructure data
 * directly on top of the currently forming candle:
 *
 *   Layer 1 — Order Flow Bar     : Buy vs sell volume split inside the candle body
 *   Layer 2 — Depth Aura Bands   : 5-level order book depth heat-aura left/right of candle
 *   Layer 3 — Volume Pulse Ring  : Glowing ring at current price on each trade
 *   Layer 4 — Imbalance Dot      : Buy/sell pressure dot on the wick
 *   Layer 5 — Spread Bracket     : Live bid/ask spread bracket on the right edge
 *
 * Design contract: this class ONLY draws, it never modifies the series or options.
 * It assumes the base candle (wick + body) has already been drawn by ActiveCandleRenderer.
 */

export interface DepthLevel {
  price: number;
  qty: number;
  orders: number;
}

interface PulseRing {
  /** alpha at creation, decays per frame */
  alpha: number;
  /** radius at creation, expands per frame */
  radius: number;
  /** peak radius (normalized by trade size) */
  maxRadius: number;
  /** color: green for buy, red for sell */
  color: string;
  /** y coordinate (media pixels) at time of trade */
  y: number;
}

export class CandleScopeOverlay {
  // ── Order book depth (5 levels each side) ──────────────────────────────────
  private bids: DepthLevel[] = [];
  private asks: DepthLevel[] = [];

  // ── Book ticker (top of book) ───────────────────────────────────────────────
  private bestBidPrice = 0;
  private bestBidQty   = 0;
  private bestAskPrice = 0;
  private bestAskQty   = 0;

  // ── Cumulative session order flow ───────────────────────────────────────────
  private totalBuyQty  = 0;
  private totalSellQty = 0;

  // ── Volume pulse rings (fade-out per frame) ─────────────────────────────────
  private pulses: PulseRing[] = [];
  /** Running average trade qty (EMA) for normalizing pulse size */
  private avgTradeQty = 0;

  // ── Accumulated trades in the active candle ───────────────────────────────
  private trades: { price: number; qty: number; isBuy: boolean }[] = [];
  private activeCandleOpenTime = 0;

  // ── Visibility flag ─────────────────────────────────────────────────────────
  public enabled = true;

  // ═══════════════════════════════════════════════════════════════════════════
  // Data Setters
  // ═══════════════════════════════════════════════════════════════════════════

  setDepth(bids: DepthLevel[], asks: DepthLevel[]): void {
    this.bids = bids.slice(0, 5);
    this.asks = asks.slice(0, 5);
  }

  setBookTicker(bidPrice: number, bidQty: number, askPrice: number, askQty: number): void {
    this.bestBidPrice = bidPrice;
    this.bestBidQty   = bidQty;
    this.bestAskPrice = askPrice;
    this.bestAskQty   = askQty;
  }

  getBestAskPrice(): number { return this.bestAskPrice; }
  getBestBidPrice(): number { return this.bestBidPrice; }

  setOrderFlow(totalBuyQty: number, totalSellQty: number): void {
    this.totalBuyQty  = totalBuyQty;
    this.totalSellQty = totalSellQty;
  }

  /**
   * Called on each live trade to create a new pulse ring and store trade flow.
   * @param price    Raw price of the trade
   * @param priceY   Y coordinate (media pixels) of the trade price
   * @param qty      Trade quantity
   * @param isBuy    true = buyer-initiated, false = seller-initiated
   */
  onTrade(price: number, priceY: number, qty: number, isBuy: boolean): void {
    // Update EMA of trade size for normalization
    this.avgTradeQty = this.avgTradeQty === 0
      ? qty
      : this.avgTradeQty * 0.9 + qty * 0.1;

    const normalized = this.avgTradeQty > 0 ? qty / this.avgTradeQty : 1;
    const maxRadius  = Math.min(32, Math.max(6, 6 + normalized * 16));

    this.pulses.push({
      alpha:     0.85,
      radius:    3,
      maxRadius,
      color:     isBuy ? '#0ecb81' : '#f6465d',
      y:         priceY,
    });

    // Cap to last 6 pulses so we never accumulate stale rings
    if (this.pulses.length > 6) this.pulses.shift();

    // Accumulate trades inside this candle
    this.trades.push({ price, qty, isBuy });
  }

  hasActivePulses(): boolean {
    return this.pulses.length > 0;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // Drawing
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Main draw entry point. Called by ActiveCandleRenderer after drawing the base candle.
   *
   * All coordinates are in **bitmap pixels** (DPR already applied by the caller).
   */
  checkNewCandle(openTime: number): void {
    if (this.activeCandleOpenTime !== openTime) {
      this.activeCandleOpenTime = openTime;
      this.trades = [];
    }
  }

  /**
   * Main draw entry point. Called by ActiveCandleRenderer after drawing the base candle.
   *
   * All coordinates are in **bitmap pixels** (DPR already applied by the caller).
   */
  draw(
    ctx: CanvasRenderingContext2D,
    /** candle centre-x in bitmap px */
    bX:            number,
    /** y of open price in bitmap px */
    openBY:        number,
    /** y of current close (animated) in bitmap px */
    closeBY:       number,
    /** y of candle high in bitmap px */
    highBY:        number,
    /** y of candle low in bitmap px */
    lowBY:         number,
    /** half-width of the candle body in bitmap px */
    halfW:         number,
    /** device pixel ratio */
    dpr:           number,
    /** y of best ask price in bitmap px (or null if unknown) */
    askBY:         number | null,
    /** y of best bid price in bitmap px (or null if unknown) */
    bidBY:         number | null,
    /** Y coordinates of 5 bid depth levels */
    bidsY:         (number | null)[],
    /** Y coordinates of 5 ask depth levels */
    asksY:         (number | null)[],
    /** price of candle high */
    highPrice:     number,
    /** price of candle low */
    lowPrice:      number,
    /** volume of the active candle */
    currentVolume: number,
    /** rolling average volume of past candles */
    avgVolume:     number,
    /** openTime of the active candle */
    openTime:      number,
  ): void {
    if (!this.enabled) return;

    this.checkNewCandle(openTime);

    ctx.save();

    this._drawDepthAura(ctx, bX, halfW, dpr, bidsY, asksY);
    this._drawFootprint(ctx, bX, highBY, lowBY, highPrice, lowPrice, halfW);
    this._drawVolumeGauge(ctx, bX, openBY, closeBY, halfW, currentVolume, avgVolume, dpr);
    this._drawSpreadBracket(ctx, bX, halfW, askBY, bidBY, dpr);
    this._drawImbalanceDot(ctx, bX, highBY, dpr);
    this._drawPulseRings(ctx, bX, dpr);

    ctx.restore();
  }

  /** Called every RAF frame to advance pulse ring animations. Returns true if still animating. */
  tickPulses(): boolean {
    let alive = false;
    for (const p of this.pulses) {
      p.alpha  *= 0.88;       // fade
      p.radius += (p.maxRadius - p.radius) * 0.18; // ease-out expand
      if (p.alpha > 0.015) alive = true;
    }
    // Prune dead pulses
    this.pulses = this.pulses.filter((p) => p.alpha > 0.015);
    return alive;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private drawing helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Layer 2 — Depth Aura Bands (Actual Prices)
   *
   * 5 horizontal bars extending left (bids) and right (asks) at their exact price coordinates.
   * Bar length ∝ qty at that level. Nearest level = brightest.
   */
  private _drawDepthAura(
    ctx: CanvasRenderingContext2D,
    bX: number,
    halfW: number,
    dpr: number,
    bidsY: (number | null)[],
    asksY: (number | null)[],
  ): void {
    const maxQty = Math.max(
      ...this.bids.map((b) => b.qty),
      ...this.asks.map((a) => a.qty),
      1,
    );

    const maxExt = halfW * 6;
    const barH   = Math.round(3 * dpr); // Clean thin horizontal line

    // ── Bid bands (extend LEFT) ──
    this.bids.forEach((level, i) => {
      const y = bidsY[i];
      if (y === null || y === undefined || y < 0) return;

      const ext   = (level.qty / maxQty) * maxExt;
      const alpha = 0.35 - i * 0.05;          // brightest near touch
      if (alpha <= 0.02) return;

      const grad = ctx.createLinearGradient(bX - halfW - ext, 0, bX - halfW, 0);
      grad.addColorStop(0, `rgba(14,203,129,0)`);
      grad.addColorStop(1, `rgba(14,203,129,${alpha.toFixed(2)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(bX - halfW - ext, y - barH / 2, ext, barH);
    });

    // ── Ask bands (extend RIGHT) ──
    this.asks.forEach((level, i) => {
      const y = asksY[i];
      if (y === null || y === undefined || y < 0) return;

      const ext   = (level.qty / maxQty) * maxExt;
      const alpha = 0.35 - i * 0.05;
      if (alpha <= 0.02) return;

      const grad = ctx.createLinearGradient(bX + halfW, 0, bX + halfW + ext, 0);
      grad.addColorStop(0, `rgba(246,70,93,${alpha.toFixed(2)})`);
      grad.addColorStop(1, `rgba(246,70,93,0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(bX + halfW, y - barH / 2, ext, barH);
    });
  }

  /**
   * Layer 1 — Anatomy Footprint (Real-time Trade Flow)
   *
   * Displays the horizontal footprint distribution of trades within the forming candle.
   * Dynamically bins price levels so it looks perfect regardless of chart scale.
   */
  private _drawFootprint(
    ctx: CanvasRenderingContext2D,
    bX: number,
    highBY: number,
    lowBY: number,
    highPrice: number,
    lowPrice: number,
    halfW: number,
  ): void {
    if (this.trades.length === 0) return;

    const range = Math.max(0.000001, highPrice - lowPrice);
    // Aim for ~12 vertical bins inside the candle body/range
    const binSize = range / 12;

    const bins = new Map<number, { buyQty: number; sellQty: number }>();
    let maxVolume = 0;

    for (const t of this.trades) {
      const binIndex = Math.round((t.price - lowPrice) / binSize);
      const binnedPrice = lowPrice + binIndex * binSize;

      let node = bins.get(binnedPrice);
      if (!node) {
        node = { buyQty: 0, sellQty: 0 };
        bins.set(binnedPrice, node);
      }
      if (t.isBuy) {
        node.buyQty += t.qty;
      } else {
        node.sellQty += t.qty;
      }
      maxVolume = Math.max(maxVolume, node.buyQty + node.sellQty);
    }

    if (maxVolume === 0) return;

    const totalBYHeight = lowBY - highBY;

    bins.forEach((node, price) => {
      const pricePct = (highPrice - price) / range;
      const y = highBY + pricePct * totalBYHeight;

      const binH = (binSize / range) * totalBYHeight;
      const barH = Math.max(1.5, binH - 0.5);

      const nodeVol = node.buyQty + node.sellQty;
      const pctOfMax = nodeVol / maxVolume;
      const maxBarW = halfW * 0.9;
      const barW = pctOfMax * maxBarW;

      const buyPct = node.buyQty / nodeVol;
      const sellPct = node.sellQty / nodeVol;

      // Draw buy volume (green, left)
      if (node.buyQty > 0) {
        const w = barW * buyPct;
        ctx.fillStyle = 'rgba(14, 203, 129, 0.42)';
        ctx.fillRect(bX - w, y - barH / 2, w, barH);
      }

      // Draw sell volume (red, right)
      if (node.sellQty > 0) {
        const w = barW * sellPct;
        ctx.fillStyle = 'rgba(246, 70, 93, 0.42)';
        ctx.fillRect(bX, y - barH / 2, w, barH);
      }
    });
  }

  /**
   * Layer 1b — Active Volume Gauge
   *
   * Displays a thin progress bar on the left edge of the candle body,
   * showing current candle volume relative to rolling historical average.
   * Glows purple when current volume exceeds the rolling average!
   */
  private _drawVolumeGauge(
    ctx: CanvasRenderingContext2D,
    bX: number,
    openBY: number,
    closeBY: number,
    halfW: number,
    currentVolume: number,
    avgVolume: number,
    dpr: number,
  ): void {
    if (avgVolume <= 0 || currentVolume <= 0) return;

    const bodyTop    = Math.min(openBY, closeBY);
    const bodyBottom = Math.max(openBY, closeBY);
    const bodyH      = Math.max(bodyBottom - bodyTop, 1);

    const ratio = currentVolume / avgVolume;
    const gaugeH = Math.min(1.0, ratio) * bodyH;

    const x = bX - halfW - Math.round(5 * dpr);
    const w = Math.round(2 * dpr);

    // Track backdrop
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(x, bodyTop, w, bodyH);

    // Fill
    let fillStyle = 'rgba(0, 188, 212, 0.6)'; // cyan for normal activity
    if (ratio >= 1.0) {
      fillStyle = '#e040fb'; // Purple glow for high volume breakout
      ctx.shadowBlur = Math.round(4 * dpr);
      ctx.shadowColor = '#e040fb';
    } else if (ratio < 0.5) {
      fillStyle = 'rgba(144, 164, 174, 0.4)'; // grey for low volume
    }

    ctx.fillStyle = fillStyle;
    ctx.fillRect(x, bodyBottom - gaugeH, w, gaugeH);

    ctx.shadowBlur = 0;
  }

  /**
   * Layer 5 — Spread Bracket
   *
   * Two small horizontal ticks right of the candle column — one at ask, one at bid.
   * Connected by a thin vertical line. Bracket gets taller as spread widens.
   */
  private _drawSpreadBracket(
    ctx: CanvasRenderingContext2D,
    bX: number,
    halfW: number,
    askBY: number | null,
    bidBY: number | null,
    dpr: number,
  ): void {
    if (askBY === null || bidBY === null) return;
    if (askBY < 0 || bidBY < 0) return;

    const tickLen   = Math.round(4 * dpr);
    const xStart    = bX + halfW + Math.round(3 * dpr);
    const lineWidth = Math.max(1, Math.round(0.8 * dpr));

    ctx.lineWidth   = lineWidth;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineCap     = 'round';

    // Ask tick (top)
    ctx.beginPath();
    ctx.moveTo(xStart, askBY);
    ctx.lineTo(xStart + tickLen, askBY);
    ctx.stroke();

    // Bid tick (bottom)
    ctx.beginPath();
    ctx.moveTo(xStart, bidBY);
    ctx.lineTo(xStart + tickLen, bidBY);
    ctx.stroke();

    // Vertical connector
    ctx.beginPath();
    ctx.moveTo(xStart + tickLen, askBY);
    ctx.lineTo(xStart + tickLen, bidBY);
    ctx.stroke();

    // Spread label (tiny)
    if (this.bestAskPrice > 0 && this.bestBidPrice > 0) {
      const spread    = this.bestAskPrice - this.bestBidPrice;
      const midY      = (askBY + bidBY) / 2;
      const fontSize  = Math.max(8, Math.round(8.5 * dpr));
      ctx.font        = `${fontSize}px -apple-system, "Segoe UI", sans-serif`;
      ctx.fillStyle   = 'rgba(255,255,255,0.4)';
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'left';
      // Format: remove trailing zeros for readability
      const label = spread.toPrecision(3).replace(/\.?0+$/, '');
      ctx.fillText(label, xStart + tickLen + Math.round(3 * dpr), midY);
    }
  }

  /**
   * Layer 4 — Imbalance Dot
   *
   * A small dot above/below the wick whose color shows cumulative buy/sell imbalance.
   * Deep green = strong buy pressure, yellow = balanced, deep red = sell pressure.
   */
  private _drawImbalanceDot(
    ctx: CanvasRenderingContext2D,
    bX: number,
    highBY: number,
    dpr: number,
  ): void {
    const total = this.totalBuyQty + this.totalSellQty;
    if (total === 0) return;

    const imbalance = (this.totalBuyQty - this.totalSellQty) / total; // -1..+1
    const dotR      = Math.round(3.5 * dpr);
    const dotY      = highBY - dotR * 2.5;

    // Color gradient: red (-1) → yellow (0) → green (+1)
    const color = this._imbalanceColor(imbalance);

    // Glow
    ctx.shadowBlur  = Math.round(6 * dpr);
    ctx.shadowColor = color;

    ctx.beginPath();
    ctx.arc(bX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fill();

    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;
  }

  /**
   * Layer 3 — Volume Pulse Rings
   *
   * Each incoming trade creates a glowing ring that expands and fades out.
   * Rendered at the Y coordinate of the trade price.
   */
  private _drawPulseRings(
    ctx: CanvasRenderingContext2D,
    bX: number,
    dpr: number,
  ): void {
    for (const p of this.pulses) {
      const r = p.radius * dpr;

      // Outer glow ring
      ctx.beginPath();
      ctx.arc(bX, p.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth   = Math.max(1, Math.round(1.2 * dpr));
      ctx.globalAlpha = p.alpha * 0.6;
      ctx.stroke();

      // Inner fill dot
      ctx.beginPath();
      ctx.arc(bX, p.y, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle   = p.color;
      ctx.globalAlpha = p.alpha * 0.9;
      ctx.fill();

      ctx.globalAlpha = 1;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════════════════════

  /** Maps imbalance ratio [-1..+1] to a color string. */
  private _imbalanceColor(v: number): string {
    // v: -1 = full sell, 0 = balanced, +1 = full buy
    const clamped = Math.max(-1, Math.min(1, v));
    if (clamped >= 0) {
      // Yellow → Green
      const t = clamped;
      const r = Math.round(255 * (1 - t));
      const g = Math.round(160 + 43 * t);  // 160→203
      const b = Math.round(0   + 129 * t); // 0→129
      return `rgb(${r},${g},${b})`;
    } else {
      // Red → Yellow
      const t = -clamped;
      const r = Math.round(246 * 1);
      const g = Math.round(70  * (1 - t) + 160 * t);
      const b = Math.round(93  * (1 - t));
      return `rgb(${r},${g},${b})`;
    }
  }
}
