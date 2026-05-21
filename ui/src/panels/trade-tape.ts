import type { Trade } from '../provider-client';

export class TradeTapePanel {
  private rows: Trade[] = [];
  private capacity = 80;
  private pendingTrades: Trade[] = [];
  private renderRequested = false;
  private readonly dateFormatter = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  constructor(private readonly root: HTMLElement) {}

  push(t: Trade): void {
    this.pendingTrades.push(t);
    this.requestRender();
  }

  reset(): void {
    this.rows = [];
    this.pendingTrades = [];
    this.root.innerHTML = '';
  }

  private requestRender(): void {
    if (this.renderRequested) return;
    this.renderRequested = true;

    requestAnimationFrame(() => {
      this.renderRequested = false;
      if (this.pendingTrades.length === 0) return;

      const fragment = document.createDocumentFragment();

      // Process pending trades from oldest to newest so they append in correct order in the fragment
      for (const t of this.pendingTrades) {
        this.rows.unshift(t);

        const side = t.makerSide ? 'sell' : 'buy';
        const px = t.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
        const qty = t.qty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 4 });
        
        const row = document.createElement('div');
        row.className = 'row';

        // Check for block trades (Mega: >=100k USD/value or >=250 quantity; Regular: >=25k USD/value or >=50 quantity)
        const value = t.qty * t.price;
        if (value >= 100000 || t.qty >= 250) {
          row.classList.add('block-trade-mega');
        } else if (value >= 25000 || t.qty >= 50) {
          row.classList.add('block-trade');
        }

        row.innerHTML = `<span class="px ${side}">${px}</span><span class="qty">${qty}</span><span class="ts">${this.dateFormatter.format(new Date(t.ts))}</span>`;
        
        // Prepended rows go to the top of our DOM, so we insert the oldest trades first at the top of our fragment
        if (fragment.firstChild) {
          fragment.insertBefore(row, fragment.firstChild);
        } else {
          fragment.appendChild(row);
        }
      }

      // Prepend all new rows in one single DOM operation
      this.root.insertBefore(fragment, this.root.firstChild);
      this.pendingTrades = [];

      // Slice array to limit memory
      if (this.rows.length > this.capacity) {
        this.rows.length = this.capacity;
      }

      // Prune excess DOM elements
      while (this.root.childElementCount > this.capacity) {
        this.root.lastElementChild?.remove();
      }
    });
  }
}

