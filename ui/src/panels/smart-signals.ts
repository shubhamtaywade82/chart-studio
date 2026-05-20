/**
 * Smart Money Signals panel: fetches and renders the on-chain smart money signals from
 * the gateway proxy endpoint (/api/signals/smart-money).
 */

export class SmartSignalsPanel {
  private chainSelect: HTMLSelectElement | null = null;
  private refreshBtn: HTMLButtonElement | null = null;
  private listContainer: HTMLElement | null = null;
  private activeChain: string = 'CT_501'; // Default Solana
  private isLoading: boolean = false;

  constructor() {
    this.chainSelect = document.getElementById('smart-signals-chain') as HTMLSelectElement;
    this.refreshBtn = document.getElementById('smart-signals-refresh') as HTMLButtonElement;
    this.listContainer = document.getElementById('smart-signals-list');

    if (this.chainSelect) {
      this.chainSelect.addEventListener('change', () => {
        this.activeChain = this.chainSelect!.value;
        void this.fetchSignals();
      });
    }

    if (this.refreshBtn) {
      this.refreshBtn.addEventListener('click', () => {
        void this.fetchSignals();
      });
    }

    // Trigger initial load
    void this.fetchSignals();
  }

  private async fetchSignals(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setLoadingState(true);

    try {
      const res = await fetch(`/api/signals/smart-money?chainId=${this.activeChain}&page=1&pageSize=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      
      if (payload.success && Array.isArray(payload.data)) {
        this.renderSignals(payload.data);
      } else {
        this.renderError(payload.message || 'Failed to retrieve signals');
      }
    } catch (err) {
      console.error('[smart-signals] fetch error:', err);
      this.renderError(err instanceof Error ? err.message : String(err));
    } finally {
      this.isLoading = false;
      this.setLoadingState(false);
    }
  }

  private setLoadingState(loading: boolean): void {
    if (this.refreshBtn) {
      this.refreshBtn.classList.toggle('loading', loading);
      if (loading) {
        this.refreshBtn.style.opacity = '0.5';
        this.refreshBtn.style.pointerEvents = 'none';
      } else {
        this.refreshBtn.style.opacity = '';
        this.refreshBtn.style.pointerEvents = '';
      }
    }
  }

  private renderError(message: string): void {
    if (!this.listContainer) return;
    this.listContainer.innerHTML = `
      <div class="signals-error-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px 10px; color: var(--text-secondary); text-align: center;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--bear)" stroke-width="2" style="margin-bottom: 12px; filter: drop-shadow(0 0 4px var(--bear-glow));">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">Failed to load signals</div>
        <div style="font-size: 11px; max-width: 80%; line-height: 1.4;">${message}</div>
      </div>
    `;
  }

  private renderSignals(signals: any[]): void {
    if (!this.listContainer) return;
    
    if (signals.length === 0) {
      this.listContainer.innerHTML = `
        <div class="signals-empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 10px; color: var(--text-secondary); text-align: center;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="2" style="margin-bottom: 12px;">
            <circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          <div style="font-weight: 500; color: var(--text-primary); margin-bottom: 4px;">No active signals found</div>
          <div style="font-size: 11px;">Try checking back during higher volatility.</div>
        </div>
      `;
      return;
    }

    const html = signals.map((s: any) => {
      const directionClass = s.direction === 'buy' ? 'bull' : 'bear';
      const directionLabel = s.direction ? s.direction.toUpperCase() : 'BUY';
      
      // Platform badges
      const launchPlatform = s.launchPlatform || '';
      const platformBadgeHtml = launchPlatform 
        ? `<span class="signal-tag platform-tag" data-platform="${launchPlatform.toLowerCase()}">${launchPlatform}</span>` 
        : '';

      // Tag list parsing
      const tags: string[] = [];
      if (s.tokenTag) {
        Object.entries(s.tokenTag).forEach(([_, list]: [string, any]) => {
          if (Array.isArray(list)) {
            list.forEach((t: any) => {
              if (t && t.tagName && !tags.includes(t.tagName)) tags.push(t.tagName);
            });
          }
        });
      }
      
      // Deduplicate tags that might match launch platform
      const filteredTags = tags.filter(t => t.toLowerCase() !== launchPlatform.toLowerCase());

      const tagsHtml = filteredTags.map(tag => {
        let tagClass = 'tag-secondary';
        if (tag.includes('Add') || tag.includes('Accumulate') || tag.includes('Buy') || tag.includes('Holdings')) {
          tagClass = 'tag-bullish';
        } else if (tag.includes('Reduce') || tag.includes('Sell')) {
          tagClass = 'tag-bearish';
        } else if (tag.includes('Paid') || tag.includes('Promo')) {
          tagClass = 'tag-amber';
        }
        return `<span class="signal-tag ${tagClass}">${tag}</span>`;
      }).join('');

      // Status Badge
      const status = s.status || 'active';
      const statusClass = status === 'active' ? 'status-active' : status === 'completed' ? 'status-completed' : 'status-timeout';

      // Price Formatting
      const formatPrice = (p: string | number | undefined) => {
        if (p === undefined) return '—';
        const num = Number(p);
        if (isNaN(num)) return String(p);
        if (num < 0.000001) return num.toFixed(8);
        if (num < 0.0001) return num.toFixed(6);
        if (num < 0.01) return num.toFixed(5);
        if (num < 1) return num.toFixed(4);
        if (num < 100) return num.toFixed(2);
        return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      };

      const formatMcap = (m: string | number | undefined) => {
        if (m === undefined) return '—';
        const num = Number(m);
        if (isNaN(num)) return String(m);
        if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
        if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
        if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
        return `$${num.toFixed(0)}`;
      };

      const maxGainPercent = s.maxGain ? parseFloat(s.maxGain) : 0;
      const maxGainHtml = maxGainPercent > 0 
        ? `<span class="signal-gain-val positive">+${maxGainPercent.toFixed(1)}%</span>`
        : '—';

      const timeAgo = (ms: number) => {
        const diff = Date.now() - ms;
        const mins = Math.floor(diff / 60_000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return new Date(ms).toLocaleDateString();
      };

      const shortAddress = s.contractAddress 
        ? `${s.contractAddress.slice(0, 6)}...${s.contractAddress.slice(-4)}` 
        : '—';

      const logoUrl = s.logoUrl 
        ? (s.logoUrl.startsWith('http') ? s.logoUrl : `https://bin.bnbstatic.com${s.logoUrl}`) 
        : '';

      return `
        <div class="smart-signal-card" data-signal-id="${s.signalId}">
          <div class="signal-card-header">
            <div class="signal-token-info">
              ${logoUrl ? `<img src="${logoUrl}" class="signal-token-logo" alt="${s.ticker || 'token'}" onerror="this.style.opacity='0'; this.style.width='0'; this.style.marginRight='0';" />` : ''}
              <div class="signal-token-meta">
                <span class="signal-token-ticker mono-sm">${s.ticker || 'UNKNOWN'}</span>
                ${platformBadgeHtml}
              </div>
            </div>
            <div class="signal-right-badges">
              <span class="signal-status-badge ${statusClass}">${status}</span>
              <span class="signal-direction-badge ${directionClass}">${directionLabel}</span>
            </div>
          </div>

          <div class="signal-card-metrics">
            <div class="metric-row">
              <span class="metric-label">Alert / Current Px</span>
              <span class="metric-value mono-sm">${formatPrice(s.alertPrice)} <span class="metric-arrow">→</span> ${formatPrice(s.currentPrice)}</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Mkt Cap / Exit Rate</span>
              <span class="metric-value mono-sm">${formatMcap(s.currentMarketCap)} <span class="dim">/</span> ${s.exitRate || 0}%</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Smart Money / Max Gain</span>
              <span class="metric-value mono-sm">👥 ${s.smartMoneyCount || 0} <span class="dim">/</span> ${maxGainHtml}</span>
            </div>
          </div>

          ${tagsHtml ? `<div class="signal-card-tags">${tagsHtml}</div>` : ''}

          <div class="signal-card-footer">
            <span class="signal-time mono-sm">${timeAgo(s.signalTriggerTime)}</span>
            <button class="icon-btn icon-btn-sm copy-address-btn" data-address="${s.contractAddress}" title="Copy contract address">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span class="address-text mono-sm">${shortAddress}</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.listContainer.innerHTML = html;

    // Attach copy event listeners
    this.listContainer.querySelectorAll('.copy-address-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const address = btn.getAttribute('data-address');
        const textSpan = btn.querySelector('.address-text');
        if (address) {
          navigator.clipboard.writeText(address).then(() => {
            if (textSpan) {
              const prevText = textSpan.textContent;
              textSpan.textContent = 'Copied!';
              btn.classList.add('copied');
              setTimeout(() => {
                textSpan.textContent = prevText;
                btn.classList.remove('copied');
              }, 1500);
            }
          }).catch((err) => console.error('Failed to copy text', err));
        }
      });
    });
  }
}
