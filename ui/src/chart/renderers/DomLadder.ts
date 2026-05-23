export interface OrderBookLevel {
  price: number;
  bidSize: number;
  askSize: number;
}

export interface DomLadderOptions {
  rows?: number;
  rowHeightPx?: number;
  widthPx?: number;
  bidColor?: string;
  askColor?: string;
  priceDecimals?: number;
}

/**
 * DOM (Depth-of-Market) Ladder: renders a live order book as a
 * positioned overlay div with RAF-batched updates.
 *
 * Usage:
 *   const ladder = new DomLadder(container, { rows: 20 });
 *   ladder.update(levels);   // call on each order book snapshot/delta
 *   ladder.destroy();        // cleanup
 */
export class DomLadder {
  private readonly el: HTMLElement;
  private readonly rows: HTMLElement[] = [];
  private readonly opts: Required<DomLadderOptions>;
  private pending: OrderBookLevel[] | null = null;
  private rafId: number | null = null;

  constructor(container: HTMLElement, opts: DomLadderOptions = {}) {
    this.opts = {
      rows: opts.rows ?? 20,
      rowHeightPx: opts.rowHeightPx ?? 20,
      widthPx: opts.widthPx ?? 180,
      bidColor: opts.bidColor ?? 'rgba(76,175,80,0.25)',
      askColor: opts.askColor ?? 'rgba(244,67,54,0.25)',
      priceDecimals: opts.priceDecimals ?? 2,
    };

    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute',
      'top:0',
      'right:0',
      `width:${this.opts.widthPx}px`,
      'overflow:hidden',
      'background:rgba(15,15,15,0.85)',
      'border-left:1px solid #333',
      'font:11px/1 monospace',
      'color:#ccc',
      'z-index:10',
      'pointer-events:none',
      'user-select:none',
    ].join(';');

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;border-bottom:1px solid #333;padding:2px 4px;color:#888;font-size:10px';
    header.innerHTML = '<span style="flex:1">Bid</span><span style="flex:1;text-align:center">Price</span><span style="flex:1;text-align:right">Ask</span>';
    this.el.appendChild(header);

    for (let i = 0; i < this.opts.rows; i++) {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;height:${this.opts.rowHeightPx}px;align-items:center;padding:0 4px;position:relative`;
      this.el.appendChild(row);
      this.rows.push(row);
    }

    container.style.position = 'relative';
    container.appendChild(this.el);
  }

  /** Queue an order book update; actual DOM mutations are RAF-batched. */
  update(levels: OrderBookLevel[]): void {
    this.pending = levels;
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        if (this.pending) this.flush(this.pending);
        this.pending = null;
      });
    }
  }

  private flush(levels: OrderBookLevel[]): void {
    // Sort: asks ascending (best ask = lowest), bids descending (best bid = highest)
    const asks = levels.filter(l => l.askSize > 0).sort((a, b) => a.price - b.price);
    const bids = levels.filter(l => l.bidSize > 0).sort((a, b) => b.price - a.price);

    const halfRows = Math.floor(this.opts.rows / 2);
    const displayAsk = asks.slice(0, halfRows).reverse(); // top of ladder = highest ask
    const displayBid = bids.slice(0, halfRows);

    const display: Array<{ price: number; bid: number; ask: number }> = [
      ...displayAsk.map(l => ({ price: l.price, bid: 0, ask: l.askSize })),
      ...displayBid.map(l => ({ price: l.price, bid: l.bidSize, ask: 0 })),
    ];

    const maxBid = Math.max(1, ...bids.slice(0, halfRows).map(l => l.bidSize));
    const maxAsk = Math.max(1, ...asks.slice(0, halfRows).map(l => l.askSize));

    for (let i = 0; i < this.opts.rows; i++) {
      const row = this.rows[i];
      if (!row) continue;
      const entry = display[i];
      if (!entry) { row.innerHTML = ''; continue; }

      const bidPct = entry.bid > 0 ? (entry.bid / maxBid) * 50 : 0;
      const askPct = entry.ask > 0 ? (entry.ask / maxAsk) * 50 : 0;
      const bg = entry.bid > 0
        ? `linear-gradient(to right, ${this.opts.bidColor} ${bidPct.toFixed(1)}%, transparent ${bidPct.toFixed(1)}%)`
        : entry.ask > 0
          ? `linear-gradient(to left, ${this.opts.askColor} ${askPct.toFixed(1)}%, transparent ${askPct.toFixed(1)}%)`
          : 'transparent';

      row.style.background = bg;
      row.innerHTML = [
        `<span style="flex:1;color:${entry.bid > 0 ? '#4CAF50' : 'transparent'}">${entry.bid > 0 ? fmtSize(entry.bid) : ''}</span>`,
        `<span style="flex:1;text-align:center;color:${entry.ask > 0 ? '#F44336' : '#aaa'}">${entry.price.toFixed(this.opts.priceDecimals)}</span>`,
        `<span style="flex:1;text-align:right;color:${entry.ask > 0 ? '#F44336' : 'transparent'}">${entry.ask > 0 ? fmtSize(entry.ask) : ''}</span>`,
      ].join('');
    }
  }

  destroy(): void {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.el.remove();
  }

  get element(): HTMLElement { return this.el; }
}

function fmtSize(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(2);
}
