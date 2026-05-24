import { TradingClient, type TradingSnapshot, type TradingMode } from '../trading/trading-client';

const fmt = (n: number, d = 2): string =>
  n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

const pnlClass = (n: number): string => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat');
const signed = (n: number, d = 2): string => `${n >= 0 ? '+' : ''}${fmt(n, d)}`;

export class TradingOpsPanel {
  private readonly client: TradingClient;
  private snap: TradingSnapshot | null = null;
  private focusedSymbol = '';
  private readonly ticket = { symbol: '', qty: '', type: 'MARKET', price: '' };
  private ticketMsg = '';
  private ticketMsgCls = '';
  private pendingSide: 'BUY' | 'SELL' = 'BUY';
  private modeListeners: Array<(mode: TradingMode) => void> = [];
  private updateListeners: Array<(snap: TradingSnapshot) => void> = [];

  constructor(private readonly root: HTMLElement) {
    this.client = new TradingClient();
    this.client.onUpdate((s) => { 
      const oldMode = this.snap?.mode;
      this.snap = s; 
      this.render(); 
      if (oldMode && oldMode !== s.mode) {
        this.modeListeners.forEach(fn => fn(s.mode));
      }
      this.updateListeners.forEach(fn => fn(s));
    });
    void this.client.refresh();
    this.render();
  }

  onUpdate(fn: (snap: TradingSnapshot) => void): void {
    this.updateListeners.push(fn);
  }

  onModeChange(fn: (mode: TradingMode) => void): void {
    this.modeListeners.push(fn);
  }

  async setMode(mode: TradingMode): Promise<void> {
    await this.client.setMode(mode);
    await this.client.refresh();
  }

  /** Called by the shell when the active chart symbol changes, to prefill the ticket. */
  setSymbol(symbol: string): void {
    this.focusedSymbol = symbol;
    const input = this.root.querySelector<HTMLInputElement>('#ops-ticket-symbol');
    if (input && document.activeElement !== input) {
      this.ticket.symbol = symbol;
      input.value = symbol;
    }
  }

  /** Read current ticket field values out of the DOM before a re-render wipes them. */
  private captureTicket(): void {
    const get = (id: string): string | null =>
      this.root.querySelector<HTMLInputElement | HTMLSelectElement>(id)?.value ?? null;
    const sym = get('#ops-ticket-symbol');
    if (sym !== null) this.ticket.symbol = sym;
    const qty = get('#ops-ticket-qty');
    if (qty !== null) this.ticket.qty = qty;
    const type = get('#ops-ticket-type');
    if (type !== null) this.ticket.type = type;
    const price = get('#ops-ticket-price');
    if (price !== null) this.ticket.price = price;
  }

  private render(): void {
    const s = this.snap;
    if (!s) {
      this.root.innerHTML = `<div class="ops-empty">Connecting to trading desk…</div>`;
      return;
    }
    this.captureTicket();
    // Remember focus + caret so a 2s snapshot push doesn't interrupt typing.
    const active = document.activeElement as HTMLInputElement | null;
    const activeId = active && this.root.contains(active) ? active.id : null;
    const caretStart = active?.selectionStart ?? null;
    const caretEnd = active?.selectionEnd ?? null;

    const os = s.operational_state;
    const rg = os.risk_gates;
    const modeBadge = s.mode === 'paper'
      ? `<span class="ops-mode-badge paper">📄 PAPER</span>`
      : `<span class="ops-mode-badge live">● LIVE</span>`;
    const entryBadge = os.auto_entry_allowed
      ? `<span class="ops-pill pos">ENTRY_OK</span>`
      : `<span class="ops-pill neg">ENTRY_BLOCKED</span>`;

    this.root.innerHTML = `
      <div class="ops-statusbar">
        <div class="ops-brand">
          <span class="ops-title">TRADING_DESK</span>
          ${modeBadge}
          ${entryBadge}
        </div>
        <div class="ops-stats">
          ${this.stat('EQUITY', `${s.wallet.paper_mode ? '📄 ' : ''}${fmt(s.wallet.total_equity)}`, 'flat')}
          ${this.stat('PNL', signed(s.stats.total_pnl), pnlClass(s.stats.total_pnl))}
          ${this.stat('WIN_RATE', s.stats.win_rate != null ? `${fmt(s.stats.win_rate, 1)}%` : '--', 'flat')}
          ${this.stat('TRADES', String(s.stats.closed_trades), 'flat')}
          ${this.stat('EXEC', s.execution_health.healthy ? 'HEALTHY' : s.execution_health.category.toUpperCase(), s.execution_health.healthy ? 'pos' : 'neg')}
        </div>
        <div class="ops-mode-toggle">
          <button class="ops-mode-btn ${s.mode === 'paper' ? 'active' : ''}" data-mode="paper">PAPER</button>
          <button class="ops-mode-btn ${s.mode === 'live' ? 'active' : ''}" data-mode="live" title="Live routing is a read-only stub">LIVE</button>
        </div>
      </div>

      <div class="ops-grid">
        <section class="ops-card">
          <header class="ops-card-h">OPERATIONAL_STATE</header>
          <div class="ops-session">SESSION #${os.trading_session.id} · ${os.trading_session.strategy.toUpperCase()} · cap ${fmt(os.trading_session.capital_usd, 0)}</div>
          ${this.gate('KILL_SWITCH', os.kill_switch.state.toUpperCase(), os.kill_switch.blocks, `PnL ${signed(os.kill_switch.total_pnl_usd)} / halt ${fmt(os.kill_switch.halt_at_or_below_usd)}`)}
          ${this.gate('DAILY_LOSS_CAP', `${signed(rg.daily_loss_cap.realized_pnl)}`, rg.daily_loss_cap.blocks, `cap ${fmt(rg.daily_loss_cap.loss_cap_usd)}`)}
          ${this.gate('MARGIN_UTIL', `${fmt(rg.margin_utilization.utilization_pct, 1)}%`, rg.margin_utilization.blocks, `max ${rg.margin_utilization.max_utilization_pct}% · exp ${fmt(rg.margin_utilization.exposure_usd)}`)}
          ${this.gate('CONCURRENT', `${rg.concurrent_positions.current}/${rg.concurrent_positions.max}`, rg.concurrent_positions.blocks, 'open positions')}
          ${os.blockers.length ? `<div class="ops-blockers">${os.blockers.map((b) => `<div class="ops-blocker">⨯ ${b.code}: ${b.message}</div>`).join('')}</div>` : ''}
        </section>

        <section class="ops-card">
          <header class="ops-card-h">ORDER_TICKET ${s.mode === 'live' ? '<span class="ops-pill neg">LIVE_DISABLED</span>' : ''}</header>
          <form id="ops-ticket" class="ops-ticket">
            <input id="ops-ticket-symbol" placeholder="SYMBOL" value="${this.ticket.symbol || this.focusedSymbol}" autocomplete="off" />
            <div class="ops-ticket-row">
              <input id="ops-ticket-qty" type="number" min="0" step="any" placeholder="QTY" value="${this.ticket.qty}" />
              <select id="ops-ticket-type">
                <option value="MARKET" ${this.ticket.type === 'MARKET' ? 'selected' : ''}>MARKET</option>
                <option value="LIMIT" ${this.ticket.type === 'LIMIT' ? 'selected' : ''}>LIMIT</option>
              </select>
              <input id="ops-ticket-price" type="number" min="0" step="any" placeholder="PRICE (limit)" value="${this.ticket.price}" />
            </div>
            <div class="ops-ticket-actions">
              <button type="submit" class="ops-buy" data-side="BUY" ${s.mode === 'live' ? 'disabled' : ''}>BUY</button>
              <button type="submit" class="ops-sell" data-side="SELL" ${s.mode === 'live' ? 'disabled' : ''}>SELL</button>
            </div>
            <div id="ops-ticket-msg" class="ops-ticket-msg ${this.ticketMsgCls}">${this.ticketMsg}</div>
          </form>
        </section>

        <section class="ops-card ops-card-wide">
          <header class="ops-card-h">POSITIONS (${s.positions.length})</header>
          ${this.positionsTable(s)}
        </section>

        <section class="ops-card ops-card-wide">
          <header class="ops-card-h">ORDERS</header>
          ${this.ordersTable(s)}
        </section>
      </div>
    `;

    this.wire();

    if (activeId) {
      const el = this.root.querySelector<HTMLInputElement>(`#${activeId}`);
      if (el) {
        el.focus();
        if (caretStart !== null && el.setSelectionRange && el.type !== 'number') {
          try { el.setSelectionRange(caretStart, caretEnd ?? caretStart); } catch { /* unsupported */ }
        }
      }
    }
  }

  private stat(label: string, value: string | false, cls: string): string {
    return `<div class="ops-stat"><label>${label}</label><span class="value ${cls}">${value || '--'}</span></div>`;
  }

  private gate(label: string, value: string, blocks: boolean, sub: string): string {
    return `
      <div class="ops-gate ${blocks ? 'blocked' : 'ok'}">
        <span class="ops-gate-dot"></span>
        <span class="ops-gate-label">${label}</span>
        <span class="ops-gate-value">${value}</span>
        <span class="ops-gate-sub">${sub}</span>
      </div>`;
  }

  private positionsTable(s: TradingSnapshot): string {
    if (!s.positions.length) return `<div class="ops-empty-row">No open positions</div>`;
    return `
      <table class="ops-table">
        <thead><tr><th>SYMBOL</th><th>QTY</th><th>AVG</th><th>uPnL</th><th>PnL%</th><th>LIQ</th><th>SL</th><th>TP</th></tr></thead>
        <tbody>
          ${s.positions.map((p) => {
            const cost = p.averagePrice * Math.abs(p.netQty);
            const pnlPct = cost > 0 ? (p.unrealizedPnl / cost) * 100 : 0;
            return `
            <tr>
              <td>${p.symbol}</td>
              <td class="${p.netQty >= 0 ? 'pos' : 'neg'}">${fmt(p.netQty, 4)}</td>
              <td>${fmt(p.averagePrice)}</td>
              <td class="${pnlClass(p.unrealizedPnl)}">${signed(p.unrealizedPnl)}</td>
              <td class="${pnlClass(pnlPct)}">${signed(pnlPct, 2)}%</td>
              <td class="neg">${p.liquidationPrice ? fmt(p.liquidationPrice) : '—'}</td>
              <td class="dim">${p.stopLoss ? fmt(p.stopLoss) : '—'}</td>
              <td class="dim">${p.takeProfit ? fmt(p.takeProfit) : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  private ordersTable(s: TradingSnapshot): string {
    if (!s.orders.length) return `<div class="ops-empty-row">No orders yet</div>`;
    return `
      <table class="ops-table">
        <thead><tr><th>TIME</th><th>SYMBOL</th><th>SIDE</th><th>QTY</th><th>FILL</th><th>ΔrPnL</th></tr></thead>
        <tbody>
          ${s.orders.map((o) => `
            <tr>
              <td>${new Date(o.ts).toLocaleTimeString()}</td>
              <td>${o.symbol}</td>
              <td class="${o.side === 'BUY' ? 'pos' : 'neg'}">${o.side}</td>
              <td>${fmt(o.qty, 4)}</td>
              <td>${fmt(o.fillPrice)}</td>
              <td class="${pnlClass(o.realizedDelta)}">${o.realizedDelta ? signed(o.realizedDelta) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  private wire(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.ops-mode-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const next = btn.dataset.mode as TradingMode;
        this.snap = null; // Clear old data immediately
        this.render();
        this.modeListeners.forEach(fn => fn(next));
        await this.client.setMode(next);
        await this.client.refresh();
      });
    });

    const form = this.root.querySelector<HTMLFormElement>('#ops-ticket');
    // Persist edits immediately so the next snapshot re-render keeps them.
    form?.addEventListener('input', () => this.captureTicket());
    this.root.querySelectorAll<HTMLButtonElement>('.ops-buy,.ops-sell').forEach((btn) => {
      btn.addEventListener('click', () => { this.pendingSide = btn.dataset.side as 'BUY' | 'SELL'; });
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.captureTicket();
      const symbol = this.ticket.symbol.trim().toUpperCase();
      const qty = Number(this.ticket.qty);
      const type = this.ticket.type as 'MARKET' | 'LIMIT';
      const price = Number(this.ticket.price) || undefined;
      if (!symbol || !qty || qty <= 0) {
        this.ticketMsg = 'Symbol and positive qty required';
        this.ticketMsgCls = 'neg';
        this.render();
        return;
      }
      const res = await this.client.placeOrder({ symbol, side: this.pendingSide, quantity: qty, type, price, product: 'INTRADAY' });
      this.ticketMsg = `${res.status}${res.message ? ' · ' + res.message : ''}`;
      this.ticketMsgCls = res.status === 'EXECUTED' ? 'pos' : 'neg';
      await this.client.refresh();
    });
  }
}
