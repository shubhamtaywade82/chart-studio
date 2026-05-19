import type { Candle, ProviderClient } from '../provider-client';
import type { ChartView } from '../chart';

/**
 * NanoPine scripts host. Previously rendered custom plots via
 * lightweight-charts addLineSeries; the klinecharts swap removed that
 * extension point. Custom plots can be re-enabled by porting each
 * NanoPine output to a klinecharts.registerIndicator() call.
 *
 * For now this stub keeps the existing API (setCandles/updateCandle)
 * so the main wire-up doesn't break, and renders an offline notice in
 * the Scripts sidebar tab + scripts button.
 */
export class ScriptManager {
  private overlay: HTMLElement;

  constructor(_chart: ChartView, _client: ProviderClient) {
    this.overlay = this.ensureOverlay();
    document.getElementById('scripts-btn')?.addEventListener('click', () => this.open());
    this.overlay.querySelector('#close-scripts')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });

    const host = document.getElementById('nanopine-host');
    if (host) {
      host.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:8px; padding:16px; color: var(--text-dim); font-size: 12px; line-height: 1.55;">
          <strong style="color: var(--text-secondary);">NanoPine offline</strong>
          <p>Scripts plotted via the old lightweight-charts pipeline are paused after the swap to klinecharts. Port them to <code>klinecharts.registerIndicator()</code> to bring them back.</p>
          <p>Built-in indicators (MA, EMA, BOLL, MACD, RSI, …) remain available via the <strong>Indicators</strong> button.</p>
        </div>`;
    }
  }

  setCandles(_candles: Candle[]): void { /* noop */ }
  updateCandle(_c: Candle, _candles: Candle[]): void { /* noop */ }

  private open(): void { this.overlay.classList.remove('hidden'); }
  private close(): void { this.overlay.classList.add('hidden'); }

  private ensureOverlay(): HTMLElement {
    let el = document.getElementById('scripts-overlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'scripts-overlay';
    el.className = 'overlay hidden';
    el.innerHTML = `
      <div class="settings-modal" style="width: 540px;">
        <h2>NanoPine Scripts</h2>
        <p class="hint">Custom-plot pipeline is offline after the klinecharts swap. Re-enable by porting scripts to <code>klinecharts.registerIndicator()</code>.</p>
        <button class="ghost" id="close-scripts">Close</button>
      </div>`;
    document.body.appendChild(el);
    return el;
  }
}
