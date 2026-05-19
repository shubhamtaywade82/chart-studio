import type { ProviderClient, ProviderInfo } from '../provider-client';

export class ProviderSettings {
  private overlay: HTMLElement;
  private list: HTMLElement;
  private bar: HTMLElement;
  private countEl: HTMLElement | null;
  private current: ProviderInfo[] = [];
  private changeListeners = new Set<(list: ProviderInfo[]) => void>();

  constructor(private readonly client: ProviderClient) {
    this.overlay = document.getElementById('settings-overlay')!;
    this.list = document.getElementById('provider-list')!;
    this.bar = document.getElementById('providers-bar')!;
    this.countEl = document.getElementById('sys-providers-count');

    document.getElementById('settings-btn')?.addEventListener('click', () => this.open());
    document.getElementById('close-settings')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.overlay.hasAttribute('hidden')) this.close();
    });

    void this.refresh();
    setInterval(() => void this.refresh(), 5000);
  }

  async refresh(): Promise<void> {
    const list = await this.client.listProviders();
    this.current = list;
    this.renderBar();
    if (!this.overlay.hasAttribute('hidden')) this.renderList();
    if (this.countEl) this.countEl.textContent = String(list.filter((p) => p.online).length);
    for (const fn of this.changeListeners) fn(list);
  }

  onChange(fn: (list: ProviderInfo[]) => void): () => void {
    this.changeListeners.add(fn);
    fn(this.current);
    return () => { this.changeListeners.delete(fn); };
  }

  open(): void {
    this.renderList();
    this.overlay.removeAttribute('hidden');
  }

  close(): void {
    this.overlay.setAttribute('hidden', '');
  }

  providers(): ProviderInfo[] {
    return this.current;
  }

  private renderBar(): void {
    if (this.current.length === 0) {
      this.bar.innerHTML = '<span class="pill offline"><span class="dot offline"></span>no providers</span>';
      return;
    }
    this.bar.innerHTML = this.current.map((p) =>
      `<span class="pill ${p.online ? 'online' : 'offline'}" title="${p.provider}"><span class="dot ${p.online ? 'online' : 'offline'}"></span>${p.displayName}</span>`
    ).join('');
  }

  private renderList(): void {
    if (this.current.length === 0) {
      this.list.innerHTML = '<li><div class="name">No providers running</div><span class="status offline">Start an adapter microservice.</span></li>';
      return;
    }
    this.list.innerHTML = this.current.map((p) => `
      <li>
        <div>
          <div class="name">${p.displayName}</div>
          <div style="color: var(--text-dim); font-size: 11px; font-family: var(--font-mono);">${p.provider}</div>
        </div>
        <div class="status ${p.online ? 'online' : 'offline'}">${p.online ? '● online' : '● offline'}</div>
      </li>
    `).join('');
  }
}
