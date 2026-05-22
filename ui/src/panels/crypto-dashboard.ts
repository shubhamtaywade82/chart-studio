export class CryptoDashboard {
  private data: any | null = null;
  
  constructor(private readonly root: HTMLElement) {
    this.root.classList.add('crypto-dashboard-container');
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
          <svg style="width:32px; height:32px; margin-bottom:10px; opacity:0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <div>Awaiting Crypto Analytics. Focus a Binance USD-M symbol to populate this panel.</div>
        </div>
      `;
      return;
    }

    const {
      fundingRate, fundingRateAPR, nextFundingTime,
      longShortRatio, openInterestUsd, basisPct,
      liquidations
    } = this.data;

    const timeToFunding = nextFundingTime ? Math.max(0, nextFundingTime - Date.now()) : 0;
    const hours = Math.floor(timeToFunding / (1000 * 60 * 60));
    const mins = Math.floor((timeToFunding % (1000 * 60 * 60)) / (1000 * 60));

    const isPositiveFunding = fundingRate > 0;
    const fundingColor = isPositiveFunding ? 'var(--bull)' : 'var(--bear)';

    const liqLong = liquidations?.long || 0;
    const liqShort = liquidations?.short || 0;
    
    const formatUsd = (val: number) => {
      if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
      if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
      if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
      return `$${val.toFixed(0)}`;
    };

    const cascadeBanner = liquidations?.cascadeDetected ? `
      <div style="background: rgba(255,23,68,0.15); border: 1px solid var(--bear); padding: 8px; border-radius: 4px; margin-top: 12px; text-align: center;">
        <strong style="color: var(--bear); font-size: 11px;">⚠️ CASCADE PROBABILITY DETECTED</strong>
        <div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">Multiple large liquidations observed.</div>
      </div>
    ` : '';

    this.root.innerHTML = `
      <div class="panel" style="padding: 14px; background: var(--bg-card); border-radius: var(--radius-md); border: 1px solid var(--border);">
        <div style="display: flex; flex-direction: column; gap: 12px;">
          
          <!-- Funding Row -->
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Funding Rate</span>
              <span style="font-family: var(--font-mono); color: ${fundingColor}; font-weight: 600;">
                ${fundingRate > 0 ? '+' : ''}${(fundingRate * 100).toFixed(4)}%
              </span>
            </div>
            <div style="display: flex; flex-direction: column; text-align: right;">
              <span style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Next Funding</span>
              <span style="font-family: var(--font-mono); color: var(--text-secondary);">
                ${hours}h ${mins}m
              </span>
            </div>
          </div>

          <div style="height: 1px; background: var(--border);"></div>

          <!-- OI and Ratio Row -->
          <div style="display: flex; justify-content: space-between;">
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Open Interest</span>
              <span style="font-family: var(--font-mono); color: var(--text-primary);">
                ${formatUsd(openInterestUsd)}
              </span>
            </div>
            <div style="display: flex; flex-direction: column; text-align: right;">
              <span style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">L/S Ratio</span>
              <span style="font-family: var(--font-mono); color: var(--text-primary);">
                ${longShortRatio > 0 ? longShortRatio.toFixed(2) : '-'}
              </span>
            </div>
          </div>

          <div style="height: 1px; background: var(--border);"></div>

          <!-- Basis and Liq Row -->
          <div style="display: flex; justify-content: space-between;">
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Spot Basis</span>
              <span style="font-family: var(--font-mono); color: ${basisPct >= 0 ? 'var(--bull)' : 'var(--bear)'};">
                ${basisPct > 0 ? '+' : ''}${basisPct.toFixed(3)}%
              </span>
            </div>
            <div style="display: flex; flex-direction: column; text-align: right;">
              <span style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Liquidations (1h)</span>
              <div style="font-family: var(--font-mono); font-size: 11px;">
                <span style="color: var(--bear)">L: ${formatUsd(liqLong)}</span> | 
                <span style="color: var(--bull)">S: ${formatUsd(liqShort)}</span>
              </div>
            </div>
          </div>

          ${cascadeBanner}
        </div>
      </div>
    `;
  }
}
