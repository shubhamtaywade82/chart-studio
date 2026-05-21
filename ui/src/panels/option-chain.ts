import type { OptionChainData } from '../provider-client';

/**
 * Live NSE Option Chain strike ladder with Greeks and OI intensity.
 */
export class OptionChainPanel {
  private renderRequested = false;
  private data: OptionChainData | null = null;

  constructor(private readonly root: HTMLElement) {
    this.root.classList.add('panel-content-scroll');
  }

  update(data: OptionChainData): void {
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
    if (!this.data) {
      this.root.innerHTML = '<div class="empty-hint">Awaiting option chain data from DhanHQ...</div>';
      return;
    }

    const { strikes, spotPrice, maxPain } = this.data;
    
    // Sort strikes by price ascending
    const sortedStrikes = [...strikes].sort((a, b) => a.strikePrice - b.strikePrice);
    
    // Find closest strikes to ATM (centered 20 strikes)
    const atmIndex = sortedStrikes.findIndex(s => s.strikePrice >= spotPrice);
    const startIndex = Math.max(0, atmIndex - 10);
    const displayStrikes = sortedStrikes.slice(startIndex, startIndex + 20);

    const fmtOI = (n: number) => n.toLocaleString();
    const fmtPx = (n: number) => n.toFixed(1);
    const fmtIV = (n: number) => (n > 0 ? (n * 100).toFixed(1) + '%' : '—');

    const rowsHtml = displayStrikes.map((s) => {
      const isATM = Math.abs(s.strikePrice - spotPrice) < 25; // heuristic for Nifty 50 strikes
      const atmClass = isATM ? ' is-atm' : '';
      
      const getOiStyle = (chg: number) => {
        if (chg === 0) return '';
        const alpha = Math.min(0.4, Math.abs(chg) / 50000);
        const color = chg > 0 ? `0, 230, 118, ${alpha}` : `255, 23, 68, ${alpha}`;
        return `background: rgba(${color});`;
      };

      const greeks = (delta?: number, gamma?: number, theta?: number, vega?: number) => {
        if (delta === undefined) return '';
        return `title="Δ: ${delta.toFixed(3)} | Γ: ${gamma?.toFixed(4)} | θ: ${theta?.toFixed(2)} | V: ${vega?.toFixed(2)}"`;
      };

      return `
        <tr class="strike-row${atmClass}">
          <td class="cell-oi" style="${getOiStyle(s.callOIChange)}">${fmtOI(s.callOI)}</td>
          <td class="cell-chg ${s.callOIChange >= 0 ? 'bull' : 'bear'}">${s.callOIChange > 0 ? '+' : ''}${fmtOI(s.callOIChange)}</td>
          <td class="cell-vol">${fmtOI(s.callVolume)}</td>
          <td class="cell-ltp" ${greeks(s.callDelta, s.callGamma, s.callTheta, s.callVega)}>${fmtPx(s.callLTP)}</td>
          <td class="cell-iv">${fmtIV(s.callIV)}</td>
          <td class="cell-strike"><strong>${s.strikePrice}</strong></td>
          <td class="cell-iv">${fmtIV(s.putIV)}</td>
          <td class="cell-ltp" ${greeks(s.putDelta, s.putGamma, s.putTheta, s.putVega)}>${fmtPx(s.putLTP)}</td>
          <td class="cell-vol">${fmtOI(s.putVolume)}</td>
          <td class="cell-chg ${s.putOIChange >= 0 ? 'bull' : 'bear'}">${s.putOIChange > 0 ? '+' : ''}${fmtOI(s.putOIChange)}</td>
          <td class="cell-oi" style="${getOiStyle(s.putOIChange)}">${fmtOI(s.putOI)}</td>
        </tr>
      `;
    }).join('');

    this.root.innerHTML = `
      <div class="option-chain-wrap">
        <div class="chain-summary">
          <div class="summary-item">Spot: <span class="val">${fmtPx(spotPrice)}</span></div>
          <div class="summary-item">Max Pain: <span class="val highlight">${fmtPx(maxPain)}</span></div>
        </div>
        <div class="option-chain-table-container">
          <table class="option-chain-table">
            <thead>
              <tr class="super-header">
                <th colspan="5">CALLS</th>
                <th class="strike-hdr"></th>
                <th colspan="5">PUTS</th>
              </tr>
              <tr class="sub-header">
                <th>OI</th><th>Chg</th><th>Vol</th><th>LTP</th><th>IV</th>
                <th class="strike-hdr">STRIKE</th>
                <th>IV</th><th>LTP</th><th>Vol</th><th>Chg</th><th>OI</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}
