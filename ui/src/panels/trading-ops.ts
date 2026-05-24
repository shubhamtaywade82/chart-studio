import { TradingClient, type TradingSnapshot, type TradingMode } from '../trading/trading-client';

const fmt = (n: number, d = 2): string =>
  n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

const pnlClass = (n: number): string => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat');
const signed = (n: number, d = 2): string => `${n >= 0 ? '+' : ''}${fmt(n, d)}`;

export class TradingOpsPanel {
  private readonly client: TradingClient;
  private snap: TradingSnapshot | null = null;
  private focusedSymbol = '';

  constructor(private readonly root: HTMLElement) {
    this.client = new TradingClient();
    this.client.onUpdate((s) => { this.snap = s; this.render(); });
    void this.client.refresh();
    this.render();
  }

  /** Called by the shell when the active chart symbol changes, to prefill the ticket. */
  setSymbol(symbol: string): void {
    this.focusedSymbol = symbol;
    const input = this.root.querySelector<HTMLInputElement>('#ops-ticket-symbol');
    if (input && document.activeElement !== input) input.value = symbol;
  }

  private render(): void {
    const s = this.snap;
    if (!s) {
      this.root.innerHTML = `<div class="ops-empty">Connecting to trading desk…</div>`;
      return;
    }

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
            <input id="ops-ticket-symbol" placeholder="SYMBOL" value="${this.focusedSymbol}" autocomplete="off" />
            <div class="ops-ticket-row">
              <input id="ops-ticket-qty" type="number" min="0" step="any" placeholder="QTY" />
              <select id="ops-ticket-type">
                <option value="MARKET">MARKET</option>
                <option value="LIMIT">LIMIT</option>
              </select>
              <input id="ops-ticket-price" type="number" min="0" step="any" placeholder="PRICE (limit)" />
            </div>
            <div class="ops-ticket-actions">
              <button type="submit" class="ops-buy" data-side="BUY" ${s.mode === 'live' ? 'disabled' : ''}>BUY</button>
              <button type="submit" class="ops-sell" data-side="SELL" ${s.mode === 'live' ? 'disabled' : ''}>SELL</button>
            </div>
            <div id="ops-ticket-msg" class="ops-ticket-msg"></div>
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
        <thead><tr><th>SYMBOL</th><th>QTY</th><th>AVG</th><th>uPnL</th><th>rPnL</th></tr></thead>
        <tbody>
          ${s.positions.map((p) => `
            <tr>
              <td>${p.symbol}</td>
              <td class="${p.netQty >= 0 ? 'pos' : 'neg'}">${fmt(p.netQty, 0)}</td>
              <td>${fmt(p.averagePrice)}</td>
              <td class="${pnlClass(p.unrealizedPnl)}">${signed(p.unrealizedPnl)}</td>
              <td class="${pnlClass(p.realizedPnl)}">${signed(p.realizedPnl)}</td>
            </tr>`).join('')}
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
              <td>${fmt(o.qty, 0)}</td>
              <td>${fmt(o.fillPrice)}</td>
              <td class="${pnlClass(o.realizedDelta)}">${o.realizedDelta ? signed(o.realizedDelta) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  private wire(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.ops-mode-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await this.client.setMode(btn.dataset.mode as TradingMode);
        await this.client.refresh();
      });
    });

    const form = this.root.querySelector<HTMLFormElement>('#ops-ticket');
    const msg = this.root.querySelector<HTMLDivElement>('#ops-ticket-msg');
    let pendingSide: 'BUY' | 'SELL' = 'BUY';
    this.root.querySelectorAll<HTMLButtonElement>('.ops-buy,.ops-sell').forEach((btn) => {
      btn.addEventListener('click', () => { pendingSide = btn.dataset.side as 'BUY' | 'SELL'; });
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const symbol = this.root.querySelector<HTMLInputElement>('#ops-ticket-symbol')!.value.trim().toUpperCase();
      const qty = Number(this.root.querySelector<HTMLInputElement>('#ops-ticket-qty')!.value);
      const type = this.root.querySelector<HTMLSelectElement>('#ops-ticket-type')!.value as 'MARKET' | 'LIMIT';
      const price = Number(this.root.querySelector<HTMLInputElement>('#ops-ticket-price')!.value) || undefined;
      if (!symbol || !qty || qty <= 0) {
        if (msg) { msg.textContent = 'Symbol and positive qty required'; msg.className = 'ops-ticket-msg neg'; }
        return;
      }
      const res = await this.client.placeOrder({ symbol, side: pendingSide, quantity: qty, type, price, product: 'INTRADAY' });
      if (msg) {
        msg.textContent = `${res.status}${res.message ? ' · ' + res.message : ''}`;
        msg.className = `ops-ticket-msg ${res.status === 'EXECUTED' ? 'pos' : 'neg'}`;
      }
      await this.client.refresh();
    });
  }
}
