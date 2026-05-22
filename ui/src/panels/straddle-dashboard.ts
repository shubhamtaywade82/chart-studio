export class StraddleDashboard {
  private data: any | null = null;
  
  constructor(private readonly root: HTMLElement) {
    this.root.classList.add('straddle-dashboard-container');
    this.render();
  }

  update(metrics: any) {
    this.data = metrics;
    this.render();
  }

  reset() {
    this.data = null;
    this.render();
  }

  private render() {
    if (!this.data) {
      this.root.innerHTML = `
        <div class="panel empty-state" style="text-align:center; padding:30px; color:var(--text-dim)">
          <div>No active straddle/strangle positions found.</div>
        </div>
      `;
      return;
    }

    const {
      underlying,
      strike,
      callLtp,
      putLtp,
      delta,
      gamma,
      theta,
      vega,
      pnl
    } = this.data;

    const premium = callLtp + putLtp;
    const breakevenUpper = strike + premium;
    const breakevenLower = strike - premium;

    this.root.innerHTML = `
      <div class="panel" style="padding: 14px; background: var(--bg-card); border-radius: var(--radius-md); border: 1px solid var(--border);">
        <header style="margin-bottom: 12px;">
          <h3 style="margin:0; font-size: 14px;">Short Straddle: ${underlying} ${strike}</h3>
        </header>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div>
            <div style="font-size: 10px; color: var(--text-dim);">Combined Premium</div>
            <div style="font-family: var(--font-mono); font-size: 14px;">₹${premium.toFixed(2)}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 10px; color: var(--text-dim);">Live P&L</div>
            <div style="font-family: var(--font-mono); font-size: 14px; color: ${pnl >= 0 ? 'var(--bull)' : 'var(--bear)'}">
              ${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}
            </div>
          </div>
        </div>

        <div style="margin-bottom: 12px;">
          <div style="font-size: 10px; color: var(--text-dim); margin-bottom: 4px;">Breakevens</div>
          <div style="display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 12px;">
            <span style="color: var(--bear)">${breakevenLower.toFixed(2)}</span>
            <span style="color: var(--text-dim)">← SPOT →</span>
            <span style="color: var(--bear)">${breakevenUpper.toFixed(2)}</span>
          </div>
        </div>

        <div style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px; margin-bottom: 12px;">
          <div style="font-size: 11px; margin-bottom: 4px;"><strong>IV Crush Scenario</strong></div>
          <div style="font-size: 10px; color: var(--text-secondary);">If IV drops by 20% post-event:</div>
          <div style="font-family: var(--font-mono); font-size: 12px; color: var(--bull); margin-top: 2px;">
            Estimated P&L Boost = +₹${(vega * 20).toFixed(2)}
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary);">
          <span>Δ: ${delta.toFixed(3)}</span>
          <span>Γ: ${gamma.toFixed(4)}</span>
          <span>θ: ${theta.toFixed(2)}</span>
          <span>V: ${vega.toFixed(2)}</span>
        </div>
      </div>
    `;
  }
}
