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

    document.getElementById('ai-test-conn')?.addEventListener('click', () => {
      void this.runDiagnostic();
    });
  }

  private async runDiagnostic(): Promise<void> {
    this.renderSkeleton();
    this.setStatus('loading');
    
    try {
      const res = await fetch('/api/ai/health');
      const data = await res.json();
      
      if (data.status === 'ok') {
        const modelsHtml = data.required.map((r: any) => `
          <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
            <span>${r.id}</span>
            <span style="color: ${r.available ? '#00e676' : '#f6465d'}">${r.available ? 'AVAILABLE' : 'MISSING'}</span>
          </div>
        `).join('');

        this.body.innerHTML = `
          <div class="ai-brief-header" style="background: rgba(0,230,118,0.1); border-radius: 4px; padding: 10px;">
            <div style="font-weight: bold; color: #00e676;">✅ Connection Successful</div>
            <div class="mono-sm dim">${data.host}</div>
          </div>
          <div style="padding: 12px 4px;">
            <div class="mb-section-title">Required Models</div>
            <div style="margin-top: 8px;">${modelsHtml}</div>
            
            <div class="mb-section-title" style="margin-top: 16px;">All Local Models</div>
            <div class="mono-sm dim" style="margin-top: 8px; font-size: 9px; line-height: 1.4;">
              ${data.models.join(', ') || 'None found'}
            </div>
            
            <div style="margin-top: 20px; font-size: 10px; color: var(--text-dim);">
              Note: If required models are missing, run: <br>
              <code>ollama pull llama3.1:8b</code><br>
              <code>ollama pull llama3.2:3b</code>
            </div>
          </div>
          <button class="ai-brief-refresh-btn" onclick="location.reload()">Return to Brief</button>
        `;
        this.setStatus('live');
      } else {
        this.body.innerHTML = `
          <div class="ai-brief-header" style="background: rgba(246,70,93,0.1); border-radius: 4px; padding: 10px;">
            <div style="font-weight: bold; color: #f6465d;">❌ Connection Failed</div>
            <div class="mono-sm dim">${data.host}</div>
          </div>
          <div style="padding: 12px 4px; font-size: 11px;">
            <p>Error: <strong>${data.error}</strong></p>
            <p style="margin-top: 12px; color: var(--text-secondary);">Possible solutions:</p>
            <ul style="margin-top: 8px; padding-left: 16px;">
              <li>Check if Ollama is running (<code>ollama serve</code>)</li>
              <li>Verify OLLAMA_HOST in your <code>.env</code></li>
              <li>If using Docker on Linux, use your Host IP instead of localhost</li>
              <li>Ensure OLLAMA_API_KEY is correct if using a cloud provider</li>
            </ul>
          </div>
          <button class="ai-brief-refresh-btn" onclick="location.reload()">Retry</button>
        `;
        this.setStatus('error');
      }
    } catch (err) {
      this.renderError('Diagnostic failed: ' + String(err));
    }
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
