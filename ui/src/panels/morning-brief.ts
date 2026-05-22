/**
 * Morning Brief Panel
 * Displays strategic morning analysis with global macro context.
 */

export interface MorningBriefData {
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  levels: Array<{ symbol: string; price: number; type: string; probability: number }>;
  scenarios: Array<{ trigger: string; outcome: string; probability: number }>;
  risks: string[];
  narrative: string;
}

export class MorningBriefPanel {
  private readonly body: HTMLElement;
  private readonly timeEl: HTMLElement | null;

  constructor() {
    this.body = document.getElementById('morning-brief-body')!;
    this.timeEl = document.getElementById('morning-brief-time');
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const res = await fetch('/api/brief/morning');
      if (!res.ok) return;
      const data = await res.json();
      if (data && !data.error) {
        this.render(data);
      }
    } catch (err) {
      console.error('[morning-brief] failed to refresh', err);
    }
  }

  private render(data: MorningBriefData): void {
    if (this.timeEl) {
      this.timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const scenariosHtml = data.scenarios.map(s => `
      <div class="mb-scenario">
        <div class="mb-scenario-trigger">${s.trigger}</div>
        <div class="mb-scenario-outcome">${s.outcome} (${Math.round(s.probability * 100)}%)</div>
      </div>
    `).join('');

    const risksHtml = data.risks.map(r => `
      <li class="mb-list-item">${r}</li>
    `).join('');

    const levelsHtml = data.levels.map(l => `
      <div class="mb-level-row">
        <span class="mono-sm">${l.symbol}</span>
        <span class="mb-level-price">${l.price}</span>
        <span class="mb-level-type ${l.type}">${l.type}</span>
      </div>
    `).join('');

    this.body.innerHTML = `
      <div class="mb-narrative">${data.narrative}</div>
      
      <div class="mb-section-title">Key Levels</div>
      <div class="mb-levels">${levelsHtml}</div>

      <div class="mb-section-title">Market Scenarios</div>
      <div class="mb-scenarios">${scenariosHtml}</div>

      <div class="mb-section-title">Primary Risks</div>
      <ul class="mb-list">${risksHtml}</ul>
    `;
  }
}
