import type { Candle, ProviderClient } from '../provider-client';
import type { ChartView } from '../chart';
import { loadScripts, saveScripts, ScriptRunner, type SavedScript } from './runner';
import { klinecharts } from './klinecharts';

export class ScriptManager {
  private overlay: HTMLElement;
  private runner: ScriptRunner;
  private scripts: SavedScript[];
  private activeId: string | null = null;
  private candles: Candle[] = [];
  private chart: ChartView;

  constructor(chart: ChartView, _client: ProviderClient) {
    this.chart = chart;
    this.runner = new ScriptRunner();
    this.scripts = loadScripts();
    this.overlay = this.ensureOverlay();

    document.getElementById('scripts-btn')?.addEventListener('click', () => this.open());
    this.overlay.querySelector('#close-scripts')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });
    this.activeId = this.scripts[0]?.id ?? null;

    this.renderSidebar();
  }

  setCandles(candles: Candle[]): void {
    this.candles = candles;
    void this.runEnabled();
  }

  updateCandle(_c: Candle, candles: Candle[]): void {
    this.candles = candles;
    void this.runEnabled();
  }

  private async runEnabled(): Promise<void> {
    if (this.candles.length === 0) return;
    for (const s of this.scripts) {
      if (!s.enabled) {
        this.chart.removeMountedScript(s.id);
        continue;
      }
      try {
        const result = await this.runner.run(s, this.candles);
        if (!result.ok) {
          this.setStatus(s.id, `error: ${result.error}`);
          continue;
        }
        this.setStatus(s.id, 'ok');

        if (result.outputs) {
          const outputs = result.outputs;
          klinecharts.registerIndicator({
            name: s.name,
            shortName: s.name,
            figures: outputs
              .filter(out => out.kind === 'line' || out.kind === 'histogram' || out.kind === 'area')
              .map(out => {
                const o = out as Extract<typeof out, { kind: 'line' | 'histogram' | 'area' }>;
                return {
                  key: o.name,
                  title: o.name,
                  type: o.kind === 'histogram' ? 'bar' : 'line',
                  color: (o.opts['color'] as string) ?? '#58a6ff'
                };
              }),
            calc: (dataList) => {
              return dataList.map((_, index) => {
                const row: Record<string, any> = {};
                for (const out of outputs) {
                  if (out.kind !== 'line' && out.kind !== 'histogram' && out.kind !== 'area') continue;
                  const val = out.data[index];
                  row[out.name] = val && Number.isFinite(val.value) ? val.value : null;
                }
                return row;
              });
            }
          });

          this.chart.applyRegisteredIndicator(s.id, s.name, outputs);
        }
      } catch (err) {
        this.setStatus(s.id, `error: ${String(err)}`);
      }
    }
  }

  private open(): void {
    this.render();
    this.overlay.classList.remove('hidden');
  }

  private close(): void {
    this.overlay.classList.add('hidden');
  }

  private setStatus(scriptId: string, msg: string): void {
    const el = this.overlay.querySelector<HTMLElement>(`[data-status="${scriptId}"]`);
    if (el) el.textContent = msg;
    const sidebarEl = document.querySelector<HTMLElement>(`[data-sidebar-status="${scriptId}"]`);
    if (sidebarEl) {
      sidebarEl.textContent = msg;
      sidebarEl.style.color = msg.startsWith('error') ? 'var(--red)' : msg === 'ok' ? 'var(--green)' : 'var(--text-dim)';
    }
  }

  private ensureOverlay(): HTMLElement {
    let el = document.getElementById('scripts-overlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'scripts-overlay';
    el.className = 'overlay hidden';
    el.innerHTML = `
      <div class="settings-modal scripts-modal">
        <h2>NanoPine Scripts</h2>
        <p class="hint">Bar-by-bar indicator/strategy runtime. Plots render directly on the chart.</p>
        <div class="scripts-layout">
          <aside class="scripts-list" id="scripts-list"></aside>
          <section class="scripts-edit">
            <input id="script-name" type="text" placeholder="Script name" />
            <textarea id="script-source" spellcheck="false"></textarea>
            <div class="scripts-actions">
              <button class="ghost" id="script-new">+ New</button>
              <button class="ghost" id="script-save">Save</button>
              <button class="ghost" id="script-run">Run</button>
              <label><input type="checkbox" id="script-enabled"/> Enabled (auto-render on chart)</label>
              <span id="script-status" class="alert-fired"></span>
            </div>
          </section>
        </div>
        <button class="ghost" id="close-scripts">Close</button>
      </div>`;
    document.body.appendChild(el);

    el.querySelector('#script-new')?.addEventListener('click', () => {
      const id = `s${Date.now().toString(36)}`;
      this.scripts.push({ id, name: 'Untitled', source: '// new script\n', enabled: false });
      saveScripts(this.scripts);
      this.activeId = id;
      this.render();
      this.renderSidebar();
    });
    el.querySelector('#script-save')?.addEventListener('click', () => this.saveActive());
    el.querySelector('#script-run')?.addEventListener('click', () => { this.saveActive(); void this.runEnabled(); });
    el.querySelector<HTMLInputElement>('#script-enabled')?.addEventListener('change', (ev) => {
      const checked = (ev.target as HTMLInputElement).checked;
      const a = this.scripts.find((x) => x.id === this.activeId);
      if (!a) return;
      a.enabled = checked;
      saveScripts(this.scripts);
      void this.runEnabled();
      this.renderSidebar();
    });
    return el;
  }

  private saveActive(): void {
    const a = this.scripts.find((x) => x.id === this.activeId);
    if (!a) return;
    const name = (this.overlay.querySelector<HTMLInputElement>('#script-name')?.value ?? '').trim();
    const source = this.overlay.querySelector<HTMLTextAreaElement>('#script-source')?.value ?? '';
    a.name = name || a.name;
    a.source = source;
    saveScripts(this.scripts);
    this.render();
    this.renderSidebar();
  }

  private render(): void {
    const list = this.overlay.querySelector('#scripts-list')!;
    list.innerHTML = this.scripts.map((s) => `
      <div class="script-item ${s.id === this.activeId ? 'active' : ''}" data-id="${s.id}">
        <span>${escape(s.name)}</span>
        <span class="alert-fired" data-status="${s.id}">${s.enabled ? 'enabled' : 'paused'}</span>
      </div>
    `).join('');
    list.querySelectorAll<HTMLElement>('.script-item').forEach((el) => {
      el.addEventListener('click', () => { this.activeId = el.dataset.id!; this.render(); });
    });
    const active = this.scripts.find((s) => s.id === this.activeId);
    const nameInput = this.overlay.querySelector<HTMLInputElement>('#script-name');
    const sourceInput = this.overlay.querySelector<HTMLTextAreaElement>('#script-source');
    const enabledInput = this.overlay.querySelector<HTMLInputElement>('#script-enabled');
    if (nameInput) nameInput.value = active?.name ?? '';
    if (sourceInput) sourceInput.value = active?.source ?? '';
    if (enabledInput) enabledInput.checked = !!active?.enabled;
  }

  private renderSidebar(): void {
    const host = document.getElementById('nanopine-host');
    if (!host) return;

    host.innerHTML = `
      <div class="sidebar-scripts-list" style="display:flex; flex-direction:column; gap:12px; padding:12px;">
        <button id="open-scripts-editor-btn" class="ghost" style="width:100%; display:flex; align-items:center; justify-content:center; gap:6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Open Script Editor
        </button>
        <div style="border-top:1px solid var(--border); margin:4px 0;"></div>
        <div class="scripts-items-stack" style="display:flex; flex-direction:column; gap:8px;">
          ${this.scripts.map((s) => `
            <div class="sidebar-script-card" style="background:var(--bg-card); border:1px solid var(--border); border-radius:6px; padding:10px; display:flex; flex-direction:column; gap:6px; transition:border-color 0.2s;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:500; font-size:12px; color:var(--text-primary);">${escape(s.name)}</span>
                <label class="switch-label" style="display:flex; align-items:center; cursor:pointer; gap:4px; font-size:10px; color:var(--text-dim);">
                  <input type="checkbox" class="sidebar-script-toggle" data-id="${s.id}" ${s.enabled ? 'checked' : ''} />
                  <span>${s.enabled ? 'On' : 'Off'}</span>
                </label>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px;">
                <span class="status-badge" data-sidebar-status="${s.id}" style="color:${s.enabled ? 'var(--green)' : 'var(--text-dim)'}; font-weight:500;">${s.enabled ? 'active' : 'paused'}</span>
                <span style="color:var(--text-dim); font-family:var(--font-mono);">NanoPine</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    host.querySelector('#open-scripts-editor-btn')?.addEventListener('click', () => this.open());
    host.querySelectorAll<HTMLInputElement>('.sidebar-script-toggle').forEach((el) => {
      el.addEventListener('change', (ev) => {
        const checked = (ev.target as HTMLInputElement).checked;
        const id = el.dataset.id;
        const s = this.scripts.find((x) => x.id === id);
        if (s) {
          s.enabled = checked;
          saveScripts(this.scripts);
          void this.runEnabled();
          this.render();
          this.renderSidebar();
        }
      });
    });
  }
}

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
