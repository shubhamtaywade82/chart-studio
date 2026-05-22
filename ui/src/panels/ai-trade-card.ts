export class AiTradeCard {
  private data: any | null = null;
  
  constructor(private readonly root: HTMLElement) {
    this.root.classList.add('ai-trade-card-container');
  }

  update(tradeData: any) {
    this.data = tradeData;
    this.render();
  }

  private render() {
    if (!this.data) {
      this.root.innerHTML = '';
      return;
    }

    const {
      regime, iv,
      setup, entry, premium, breakevens, maxProfit, thetaPerDay,
      greeks, margin, var95,
      rationale, confidence
    } = this.data;

    const regimeClass = regime.toLowerCase().replace('_', '-');
    const formatCurrency = (val: any) => typeof val === 'number' ? `₹${val}` : val;
    
    this.root.innerHTML = `
      <div class="ai-trade-card">
        <div class="ai-trade-card-inner">
          <div class="ai-card-header">
            <span class="ai-badge ${regimeClass}">${regime.replace('_', ' ')}</span>
            <span class="ai-card-iv">IV: ${iv}%</span>
          </div>
          
          <div>
            <div class="ai-setup-title">${setup}</div>
            <div class="ai-setup-entry">${entry}</div>
          </div>
          
          <div class="ai-metrics-grid">
            <div class="ai-metric-col">
              <span class="ai-metric-label">Premium</span>
              <span class="ai-metric-val">₹${premium.total}</span>
            </div>
            <div class="ai-metric-col">
              <span class="ai-metric-label">Breakevens</span>
              <span class="ai-metric-val">${breakevens[0]} / ${breakevens[1]}</span>
            </div>
            <div class="ai-metric-col">
              <span class="ai-metric-label">Max Profit</span>
              <span class="ai-metric-val" style="color: var(--bull)">${formatCurrency(maxProfit)}</span>
            </div>
            <div class="ai-metric-col">
              <span class="ai-metric-label">Theta/Day</span>
              <span class="ai-metric-val" style="color: ${thetaPerDay > 0 ? 'var(--bull)' : 'var(--bear)'}">${formatCurrency(thetaPerDay)}</span>
            </div>
          </div>

          <div class="ai-greeks-bar">
            <span>Δ: ${greeks.delta}</span>
            <span>Γ: ${greeks.gamma}</span>
            <span>V: ₹${greeks.vega}</span>
          </div>

          <div class="ai-greeks-bar" style="margin-top: -4px;">
            <span>Margin: ₹${margin}</span>
            <span>VaR(95%): <span style="color: var(--bear)">₹${var95}</span></span>
          </div>

          <div class="ai-rationale-box">
            <div class="ai-rationale-header">AI Rationale &nbsp;<span style="color: var(--text-secondary); font-weight: normal;">(Conf: ${Math.round(confidence * 100)}%)</span></div>
            <div class="ai-rationale-text">"${rationale}"</div>
          </div>

          <div class="ai-card-actions">
            <button class="ai-btn ai-btn-exec">Execute</button>
            <button class="ai-btn ai-btn-paper">Paper Trade</button>
          </div>
        </div>
      </div>
    `;

    this.root.querySelector('.ai-btn-paper')?.addEventListener('click', () => {
      this.root.innerHTML = '';
      this.data = null;
    });
  }
}
