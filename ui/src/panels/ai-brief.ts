/**
 * AI Brief Panel
 *
 * Calls GET /api/brief?provider=...&symbol=...&interval=...
 * Renders the result as rich, styled HTML inside #ai-brief-body.
 * Auto-refreshes every 60 seconds while the symbol is active.
 * Heuristic fallback works without Ollama.
 */

export interface BriefSection { heading: string; body: string; }

export interface BriefResult {
  symbol: string;
  interval: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  sections: BriefSection[];
  disclaimer: string;
  ts: number;
  heuristic: boolean;
}

const AUTO_REFRESH_MS = 60_000;

export class AIBriefPanel {
  private readonly body: HTMLElement;
  private readonly statusEl: HTMLElement | null;
  private provider = '';
  private symbol = '';
  private interval = '1m';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private abortCtrl: AbortController | null = null;
  private loading = false;

  constructor() {
    this.body = document.getElementById('ai-brief-body')!;
    this.statusEl = document.getElementById('ai-brief-status');
    this.setStatus('idle');
  }

  /** Call when symbol/provider/interval changes. Triggers an immediate fetch. */
  refresh(provider: string, symbol: string, interval: string): void {
    this.provider = provider;
    this.symbol = symbol;
    this.interval = interval;

    this.startAutoRefresh();
    void this.fetch();
  }

  /** Stop auto-refresh (e.g., on symbol teardown). */
  stop(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.abortCtrl?.abort();
    this.abortCtrl = null;
  }

  private startAutoRefresh(): void {
    this.stop();
    this.refreshTimer = setInterval(() => {
      if (!this.loading) void this.fetch();
    }, AUTO_REFRESH_MS);
  }

  private async fetch(): Promise<void> {
    if (!this.symbol) return;
    this.loading = true;
    this.setStatus('loading');
    this.renderSkeleton();

    this.abortCtrl?.abort();
    this.abortCtrl = new AbortController();

    const url = `/api/brief?provider=${encodeURIComponent(this.provider)}&symbol=${encodeURIComponent(this.symbol)}&interval=${encodeURIComponent(this.interval)}`;

    try {
      const res = await fetch(url, { signal: this.abortCtrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as BriefResult;
      this.render(data);
      this.setStatus(data.heuristic ? 'heuristic' : 'live');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      this.renderError(err instanceof Error ? err.message : String(err));
      this.setStatus('error');
    } finally {
      this.loading = false;
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private render(data: BriefResult): void {
    const biasColor = data.bias === 'bullish' ? '#2ebd85' : data.bias === 'bearish' ? '#f6465d' : '#a0aec0';
    const biasIcon = data.bias === 'bullish' ? '▲' : data.bias === 'bearish' ? '▼' : '●';
    const confPct = Math.round(data.confidence * 100);

    const age = this.formatAge(data.ts);
    const srcLabel = data.heuristic ? 'heuristic' : 'LLM';

    const sectionsHtml = data.sections.map((s) => `
      <div class="ai-brief-section">
        <div class="ai-brief-section-heading">${escHtml(s.heading)}</div>
        <p class="ai-brief-section-body">${escHtml(s.body)}</p>
      </div>
    `).join('');

    this.body.innerHTML = `
      <div class="ai-brief-header">
        <div class="ai-brief-bias" style="color: ${biasColor};">
          <span class="ai-brief-bias-icon">${biasIcon}</span>
          <span class="ai-brief-bias-label">${capitalize(data.bias)}</span>
          <span class="ai-brief-conf">${confPct}%</span>
        </div>
        <div class="ai-brief-meta">
          <span class="ai-brief-symbol">${escHtml(data.symbol)}</span>
          <span class="ai-brief-dot">·</span>
          <span class="ai-brief-interval">${escHtml(data.interval)}</span>
          <span class="ai-brief-dot">·</span>
          <span class="ai-brief-age">${age}</span>
          <span class="ai-brief-src ${data.heuristic ? 'ai-brief-src--heuristic' : 'ai-brief-src--llm'}">${srcLabel}</span>
        </div>
      </div>

      <div class="ai-brief-divider"></div>

      <div class="ai-brief-sections">
        ${sectionsHtml}
      </div>

      <div class="ai-brief-divider"></div>

      <p class="ai-brief-disclaimer">${escHtml(data.disclaimer)}</p>

      <button class="ai-brief-refresh-btn" id="ai-brief-refresh-btn" title="Refresh brief">
        ↻ Refresh
      </button>
    `;

    document.getElementById('ai-brief-refresh-btn')?.addEventListener('click', () => {
      if (!this.loading) void this.fetch();
    });
  }

  private renderSkeleton(): void {
    this.body.innerHTML = `
      <div class="ai-brief-skeleton">
        <div class="ai-brief-skel-row ai-brief-skel-wide"></div>
        <div class="ai-brief-skel-row ai-brief-skel-medium"></div>
        <div class="ai-brief-skel-spacer"></div>
        <div class="ai-brief-skel-row ai-brief-skel-full"></div>
        <div class="ai-brief-skel-row ai-brief-skel-full"></div>
        <div class="ai-brief-skel-row ai-brief-skel-medium"></div>
        <div class="ai-brief-skel-spacer"></div>
        <div class="ai-brief-skel-row ai-brief-skel-full"></div>
        <div class="ai-brief-skel-row ai-brief-skel-wide"></div>
        <div class="ai-brief-skel-row ai-brief-skel-full"></div>
      </div>
    `;
  }

  private renderError(msg: string): void {
    this.body.innerHTML = `
      <div class="ai-brief-error">
        <span class="ai-brief-error-icon">⚠</span>
        <span>Brief unavailable: ${escHtml(msg)}</span>
        <button class="ai-brief-refresh-btn" id="ai-brief-err-refresh" title="Retry">↻ Retry</button>
      </div>
      <p class="ai-brief-disclaimer">Advisory only — not financial advice.</p>
    `;
    document.getElementById('ai-brief-err-refresh')?.addEventListener('click', () => {
      void this.fetch();
    });
  }

  // ── Status badge ───────────────────────────────────────────────────────────

  private setStatus(s: 'idle' | 'loading' | 'live' | 'heuristic' | 'error'): void {
    if (!this.statusEl) return;
    const labels: Record<string, string> = {
      idle: 'offline', loading: '…', live: 'llm', heuristic: 'heuristic', error: 'error',
    };
    const colors: Record<string, string> = {
      idle: '', loading: 'var(--text-muted)', live: '#2ebd85', heuristic: '#f5a623', error: '#f6465d',
    };
    this.statusEl.textContent = labels[s] ?? s;
    this.statusEl.style.color = colors[s] ?? '';
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private formatAge(ts: number): string {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 5) return 'just now';
    if (secs < 60) return `${secs}s ago`;
    return `${Math.floor(secs / 60)}m ago`;
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
