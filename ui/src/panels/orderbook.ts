import type { DepthDelta, OrderBookSnapshot } from '../provider-client';

interface Level { price: number; qty: number }

const sortDesc = (a: Level, b: Level): number => b.price - a.price;
const sortAsc = (a: Level, b: Level): number => a.price - b.price;

export class OrderBookPanel {
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private prevSizes = new Map<number, number>();
  private depth = 12;
  private renderRequested = false;

  constructor(private readonly root: HTMLElement, private readonly spreadEl: HTMLElement) {}

  reset(snapshot: OrderBookSnapshot | null): void {
    this.bids.clear();
    this.asks.clear();
    this.prevSizes.clear();
    if (snapshot) {
      if (snapshot.bids) {
        for (const [p, q] of snapshot.bids) if (q > 0) this.bids.set(p, q);
      }
      if (snapshot.asks) {
        for (const [p, q] of snapshot.asks) if (q > 0) this.asks.set(p, q);
      }
    }
    this.requestRender();
  }

  applyDelta(delta: DepthDelta): void {
    if (delta.replacement) {
      // Provider sent a full top-N snapshot, replace bids/asks with these levels.
      this.bids.clear();
      this.asks.clear();
      for (const [p, q] of delta.bids) if (q > 0 && p > 0) this.bids.set(p, q);
      for (const [p, q] of delta.asks) if (q > 0 && p > 0) this.asks.set(p, q);
    } else {
      for (const [p, q] of delta.bids) {
        if (q === 0) this.bids.delete(p);
        else this.bids.set(p, q);
      }
      for (const [p, q] of delta.asks) {
        if (q === 0) this.asks.delete(p);
        else this.asks.set(p, q);
      }
    }
    this.requestRender();
  }

  getSnapshot(): { bids: Array<[number, number]>; asks: Array<[number, number]> } {
    const bids: Array<[number, number]> = [];
    const asks: Array<[number, number]> = [];
    for (const [p, q] of this.bids) bids.push([p, q]);
    for (const [p, q] of this.asks) asks.push([p, q]);
    bids.sort((a, b) => b[0] - a[0]);
    asks.sort((a, b) => a[0] - b[0]);
    return { bids, asks };
  }

  private topLevels(map: Map<number, number>, n: number, cmp: (a: Level, b: Level) => number): Level[] {
    const arr: Level[] = [];
    for (const [price, qty] of map) arr.push({ price, qty });
    arr.sort(cmp);
    return arr.slice(0, n);
  }

  private requestRender(): void {
    if (this.renderRequested) return;
    this.renderRequested = true;
    requestAnimationFrame(() => {
      this.renderRequested = false;
      this.renderSync();
    });
  }

  private renderSync(): void {
    const askRows = this.topLevels(this.asks, this.depth, sortAsc).reverse();
    const bidRows = this.topLevels(this.bids, this.depth, sortDesc);

    const fmtPx = (n: number): string => n.toFixed(this.estimateDecimals());
    const fmtQty = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

    // 1. Calculate cumulative totals and maximum total for relative background depth bars
    let maxTotal = 0.0001;
    let runningAskTotal = 0;
    const askLevelsCalculated = askRows.map((l) => {
      runningAskTotal += l.qty;
      return { ...l, cumulativeTotal: runningAskTotal };
    });
    if (runningAskTotal > maxTotal) maxTotal = runningAskTotal;

    let runningBidTotal = 0;
    const bidLevelsCalculated = bidRows.map((l) => {
      runningBidTotal += l.qty;
      return { ...l, cumulativeTotal: runningBidTotal };
    });
    if (runningBidTotal > maxTotal) maxTotal = runningBidTotal;

    // 2. Generate HTML with background depth bars and flashing size updates
    const nextSizes = new Map<number, number>();

    const asksHtml = askLevelsCalculated.map((l) => {
      nextSizes.set(l.price, l.qty);
      const prevQty = this.prevSizes.get(l.price);
      let flashClass = '';
      if (prevQty !== undefined && prevQty !== l.qty) {
        flashClass = l.qty > prevQty ? ' flash-up' : ' flash-down';
      }
      // Calculate depth percentage relative to the maximum cumulative volume
      const pct = ((l.cumulativeTotal / maxTotal) * 100).toFixed(1);
      return `<div class="row ask" style="--depth-pct: ${pct}%"><span class="qty${flashClass}">${fmtQty(l.qty)}</span><span class="px">${fmtPx(l.price)}</span><span class="total">${fmtQty(l.cumulativeTotal)}</span></div>`;
    }).join('');

    const bidsHtml = bidLevelsCalculated.map((l) => {
      nextSizes.set(l.price, l.qty);
      const prevQty = this.prevSizes.get(l.price);
      let flashClass = '';
      if (prevQty !== undefined && prevQty !== l.qty) {
        flashClass = l.qty > prevQty ? ' flash-up' : ' flash-down';
      }
      const pct = ((l.cumulativeTotal / maxTotal) * 100).toFixed(1);
      return `<div class="row bid" style="--depth-pct: ${pct}%"><span class="qty${flashClass}">${fmtQty(l.qty)}</span><span class="px">${fmtPx(l.price)}</span><span class="total">${fmtQty(l.cumulativeTotal)}</span></div>`;
    }).join('');

    this.prevSizes = nextSizes;

    // 3. Render mid price and spread divider
    const bestBid = bidRows[0]?.price;
    const bestAsk = askRows[askRows.length - 1]?.price;
    
    // Calculate overall imbalance (visible depth)
    const bidTotal = runningBidTotal;
    const askTotal = runningAskTotal;
    const totalVisible = bidTotal + askTotal;
    const bidRatio = totalVisible > 0 ? (bidTotal / totalVisible) : 0.5;
    
    const imbEl = document.getElementById('book-imbalance');
    if (imbEl) {
      const pct = (bidRatio * 100).toFixed(0);
      imbEl.textContent = `${pct}% B`;
      imbEl.className = `imbalance-badge ${bidRatio > 0.6 ? 'bull' : bidRatio < 0.4 ? 'bear' : 'neutral'}`;
      imbEl.style.setProperty('--imb-ratio', `${bidRatio * 100}%`);
    }

    const headerHtml = `
      <div class="ob-header">
        <span class="hdr-qty">Size</span>
        <span class="hdr-px">Price</span>
        <span class="hdr-total">Total</span>
      </div>
    `;

    const markEl = document.getElementById('book-mark-val');

    if (bestBid !== undefined && bestAsk !== undefined && bestAsk >= bestBid) {
      const spread = bestAsk - bestBid;
      const mid = (bestAsk + bestBid) / 2;
      const bps = (spread / mid) * 10_000;
      
      this.spreadEl.textContent = `${fmtPx(spread)} (${bps.toFixed(2)} bps)`;
      if (markEl) {
        markEl.textContent = fmtPx(mid);
        markEl.classList.remove('is-empty');
      }
      
      this.root.innerHTML = `
        ${headerHtml}
        <div class="ob-section asks">${asksHtml}</div>
        <div class="spread">
          <div class="spread-line">
            <span class="mid-val">${fmtPx(mid)}</span>
            <span class="spread-val">${fmtPx(spread)}</span>
          </div>
          <div class="imbalance-bar-wrap">
            <div class="imbalance-bar-fill" style="width: ${bidRatio * 100}%"></div>
          </div>
        </div>
        <div class="ob-section bids">${bidsHtml}</div>
      `;
    } else {
      this.spreadEl.textContent = '';
      if (markEl) {
        markEl.textContent = '—';
        markEl.classList.add('is-empty');
      }
      this.root.innerHTML = `
        ${headerHtml}
        <div class="ob-section asks">${asksHtml}</div>
        <div class="spread empty">
          <span class="mid-val">—</span>
        </div>
        <div class="ob-section bids">${bidsHtml}</div>
      `;
    }
  }

  private estimateDecimals(): number {
    const sample = this.bids.keys().next().value ?? this.asks.keys().next().value;
    if (typeof sample !== 'number') return 2;
    if (sample >= 1000) return 2;
    if (sample >= 1) return 3;
    if (sample >= 0.01) return 4;
    return 6;
  }
}

