export class GreeksPanel {
  private renderRequested = false;
  private data: any | null = null;

  constructor(private readonly root: HTMLElement) {
    this.root.classList.add('panel-content-scroll', 'greeks-panel');
  }

  update(data: any): void {
    this.data = data;
    this.requestRender();
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
    if (!this.data || !this.data.positions || this.data.positions.length === 0) {
      this.root.innerHTML = '<div class="empty-hint">No open positions to display Greeks.</div>';
      return;
    }

    const { positions, totalDelta, totalGamma, totalVega, totalTheta, totalPnL, deltaNeutralSuggestion } = this.data;

    const fmtNum = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    const fmtPnL = (n: number) => `<span class="${n >= 0 ? 'bull' : 'bear'}">${n >= 0 ? '+' : ''}${fmtNum(n)}</span>`;

    const rowsHtml = positions.map((p: any) => `
      <tr>
        <td class="cell-symbol">${p.symbol}</td>
        <td class="cell-qty ${p.qty > 0 ? 'bull' : 'bear'}">${p.qty}</td>
        <td class="cell-delta">${fmtNum(p.delta, 3)}</td>
        <td class="cell-gamma">${fmtNum(p.gamma, 4)}</td>
        <td class="cell-vega">${fmtNum(p.vega)}</td>
        <td class="cell-theta">${fmtNum(p.theta)}</td>
        <td class="cell-pnl">${fmtPnL(p.pnl)}</td>
      </tr>
    `).join('');

    let suggestionHtml = '';
    if (deltaNeutralSuggestion) {
      suggestionHtml = `
        <div class="delta-neutral-badge alert-box">
          <strong>Δ Neutral Hedge:</strong> ${deltaNeutralSuggestion.action} ${deltaNeutralSuggestion.qty} ${deltaNeutralSuggestion.instrument}
        </div>
      `;
    }

    this.root.innerHTML = `
      <div class="greeks-wrap">
        <table class="greeks-table">
          <thead>
            <tr>
              <th>Position</th>
              <th>Qty</th>
              <th>Δ Delta</th>
              <th>Γ Gamma</th>
              <th>V Vega</th>
              <th>Θ Theta</th>
              <th>P&L</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr class="aggregate-row">
              <td colspan="2"><strong>PORTFOLIO TOTAL</strong></td>
              <td><strong>${fmtNum(totalDelta, 3)}</strong></td>
              <td><strong>${fmtNum(totalGamma, 4)}</strong></td>
              <td><strong>${fmtNum(totalVega)}</strong></td>
              <td><strong>${fmtNum(totalTheta)}</strong></td>
              <td><strong>${fmtPnL(totalPnL)}</strong></td>
            </tr>
          </tfoot>
        </table>
        ${suggestionHtml}
      </div>
    `;
  }
}
