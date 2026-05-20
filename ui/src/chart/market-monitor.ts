/**
 * Make a position:absolute floating widget draggable by holding any empty
 * space (or the explicit `.widget-drag-handle` if added). Drag offset is
 * persisted in localStorage under `chart-widget-pos:<id>` so the user's layout
 * survives reloads.
 */
function makeDraggable(el: HTMLElement, storageKey: string): void {
  el.style.cursor = 'move';
  el.style.userSelect = 'none';

  // Restore saved position.
  try {
    const saved = localStorage.getItem(`chart-widget-pos:${storageKey}`);
    if (saved) {
      const { left, top } = JSON.parse(saved) as { left: number; top: number };
      if (Number.isFinite(left) && Number.isFinite(top)) {
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }
    }
  } catch { /* ignore */ }

  let dragging = false;
  let offX = 0, offY = 0;
  const onDown = (e: PointerEvent): void => {
    // Allow text selection on inputs etc.
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, button')) return;
    dragging = true;
    const rect = el.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;
    el.setPointerCapture(e.pointerId);
    el.style.zIndex = '200';
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const parent = el.parentElement?.getBoundingClientRect();
    const px = parent?.left ?? 0;
    const py = parent?.top ?? 0;
    const left = e.clientX - px - offX;
    const top = e.clientY - py - offY;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  };
  const onUp = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    el.style.zIndex = '100';
    try {
      localStorage.setItem(`chart-widget-pos:${storageKey}`, JSON.stringify({
        left: parseFloat(el.style.left || '0'),
        top: parseFloat(el.style.top || '0'),
      }));
    } catch { /* ignore */ }
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

export class LatencyMonitor {
  private latencies: number[] = [];
  /** Ring buffer of tick arrival timestamps (ms) for tradesPerSec windowing. */
  private tickTimes: number[] = [];
  private lastLtt = 0;
  private listeners = new Set<(stats: LatencyStats) => void>();

  reset(): void {
    this.latencies = [];
    this.tickTimes = [];
    this.lastLtt = 0;
  }

  onStatsChange(fn: (stats: LatencyStats) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  recordTick(ltt: number): void {
    if (ltt === this.lastLtt) return; // Duplicate tick
    this.lastLtt = ltt;

    const now = Date.now();
    const latencyMs = now - (ltt * 1000);
    if (latencyMs > 0 && latencyMs < 10000) {
      this.latencies.push(latencyMs);
      if (this.latencies.length > 100) this.latencies.shift();
    }

    // Track tick arrival times for trades/sec windowing.
    this.tickTimes.push(now);
    // Drop entries older than 10s.
    const cutoff = now - 10_000;
    while (this.tickTimes.length > 0 && this.tickTimes[0]! < cutoff) {
      this.tickTimes.shift();
    }

    if (this.listeners.size > 0) {
      const stats = this.getStats();
      for (const fn of this.listeners) fn(stats);
    }
  }

  getStats(): LatencyStats {
    if (this.latencies.length === 0) {
      return { avg: 0, min: 0, max: 0, p95: 0, status: 'initializing', tradesPerSec: 0 };
    }

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const len = sorted.length;
    const avg = sorted.reduce((a, b) => a + b, 0) / len;
    const p95 = sorted[Math.floor(len * 0.95)];

    let status: LatencyStats['status'];
    if (avg < 50) status = 'excellent';
    else if (avg < 200) status = 'good';
    else if (avg < 500) status = 'acceptable';
    else status = 'poor';

    // tradesPerSec computed from real 10-second window
    const windowSec = this.tickTimes.length > 0
      ? Math.max(1, (Date.now() - this.tickTimes[0]!) / 1000)
      : 1;
    const tradesPerSec = this.tickTimes.length / windowSec;

    return {
      avg: Math.round(avg),
      min: sorted[0] ?? 0,
      max: sorted[len - 1] ?? 0,
      p95: p95 ?? 0,
      status,
      tradesPerSec: Math.round(tradesPerSec * 10) / 10,
    };
  }
}

export interface LatencyStats {
  avg: number;
  min: number;
  max: number;
  p95: number;
  status: 'excellent' | 'good' | 'acceptable' | 'poor' | 'initializing';
  tradesPerSec: number;
}

/** Per-level depth state used by the heatmap. */
export interface DepthLevel {
  price: number;
  qty: number;
  orders: number;
}

export class DepthHeatmap {
  private container: HTMLElement | null = null;
  private bids: DepthLevel[] = [];
  private asks: DepthLevel[] = [];

  ensurePanel(): HTMLElement {
    if (this.container) return this.container;
    this.container = document.getElementById('depth-heatmap-panel');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'depth-heatmap-panel';
      this.container.className = 'depth-heatmap-panel chart-floating-widget';
      this.container.style.cssText = `
        position: absolute;
        right: 10px;
        top: 60px;
        width: 180px;
        background: rgba(19, 23, 34, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        padding: 12px;
        font-size: 12px;
        z-index: 100;
      `;
      const parent = document.querySelector('.chart-container') || document.body;
      parent.appendChild(this.container);
      makeDraggable(this.container, 'depth-heatmap-panel');
    }
    return this.container;
  }

  update(bids: DepthLevel[] | undefined, asks: DepthLevel[] | undefined): void {
    if (!bids || !asks) return;
    this.bids = bids;
    this.asks = asks;
    this.render();
  }

  private render(): void {
    const panel = this.ensurePanel();
    const cols = ['L1', 'L2', 'L3', 'L4', 'L5'];
    let html = '<div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px;">';

    for (let i = 0; i < 5; i++) {
      const bid = this.bids[i];
      const ask = this.asks[i];
      const bidQuality = this.classify(bid);
      const askQuality = this.classify(ask);
      // Some venues (e.g. Binance) don't expose distinct-order counts per
      // level — fall back to the level qty so the panel still shows useful
      // numbers instead of zeros.
      const fmtNum = (v: number): string => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(v >= 10 ? 0 : 2);
      const bidLabel = bid ? (bid.orders > 0 ? String(bid.orders) : fmtNum(bid.qty)) : '0';
      const askLabel = ask ? (ask.orders > 0 ? String(ask.orders) : fmtNum(ask.qty)) : '0';

      html += `
        <div style="text-align: center;">
          <div style="color: #8892a4; font-size: 10px; margin-bottom: 2px;">${cols[i]}</div>
          <div style="background: ${bidQuality.color}22; border: 1px solid ${bidQuality.color}; padding: 4px; border-radius: 2px; margin-bottom: 2px;">
            <div style="color: ${bidQuality.color}; font-size: 11px; font-weight: bold;">${bidLabel}</div>
            <div style="color: rgba(255,255,255,0.5); font-size: 9px;">${bidQuality.label}</div>
          </div>
          <div style="background: ${askQuality.color}22; border: 1px solid ${askQuality.color}; padding: 4px; border-radius: 2px;">
            <div style="color: ${askQuality.color}; font-size: 11px; font-weight: bold;">${askLabel}</div>
            <div style="color: rgba(255,255,255,0.5); font-size: 9px;">${askQuality.label}</div>
          </div>
        </div>
      `;
    }
    html += '</div>';
    panel.innerHTML = html;
  }

  private classify(level: DepthLevel | undefined): { label: string; color: string } {
    if (!level || level.qty <= 0) return { label: '—', color: '#9c9c9c' };
    if (level.orders > 0) {
      const avgSize = level.qty / level.orders;
      if (avgSize > 5000 && level.orders < 5) return { label: 'Whale', color: '#ff9800' };
      if (avgSize < 100 && level.orders > 50) return { label: 'Retail', color: '#42a5f5' };
      return { label: 'Normal', color: '#9c9c9c' };
    }
    // No order-count info — classify on qty only.
    if (level.qty > 50) return { label: 'Heavy', color: '#ff9800' };
    if (level.qty > 5)  return { label: 'Normal', color: '#9c9c9c' };
    return { label: 'Light', color: '#42a5f5' };
  }

  dispose(): void {
    if (this.container) {
      try { this.container.remove(); } catch { /* noop */ }
      this.container = null;
    }
  }
}

interface VolBucket { qty: number; lastTs: number }

export class VolumeProfilePanel {
  private volProfile = new Map<number, VolBucket>();
  private container: HTMLElement | null = null;
  private readonly maxBuckets = 400;

  reset(): void {
    this.volProfile.clear();
  }

  ensurePanel(): HTMLElement {
    if (this.container) return this.container;
    this.container = document.getElementById('volume-profile-panel');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'volume-profile-panel';
      this.container.className = 'chart-floating-widget';
      this.container.style.cssText = `
        position: absolute;
        left: 10px;
        top: 60px;
        width: 120px;
        background: rgba(19, 23, 34, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        padding: 12px;
        font-size: 11px;
        z-index: 100;
      `;
      const parent = document.querySelector('.chart-container') || document.body;
      parent.appendChild(this.container);
      makeDraggable(this.container, 'volume-profile-panel');
    }
    return this.container;
  }

  update(ltp: number, tickSize: number, ltq: number): void {
    if (!Number.isFinite(ltp) || ltp <= 0 || tickSize <= 0 || ltq <= 0) return;
    const priceLevel = Math.round(ltp / tickSize) * tickSize;
    const now = Date.now();
    const existing = this.volProfile.get(priceLevel);
    if (existing) {
      existing.qty += ltq;
      existing.lastTs = now;
    } else {
      this.volProfile.set(priceLevel, { qty: ltq, lastTs: now });
    }

    // Evict the LEAST RECENTLY traded level when we exceed the cap.
    while (this.volProfile.size > this.maxBuckets) {
      let oldestKey: number | undefined;
      let oldestTs = Infinity;
      for (const [k, v] of this.volProfile) {
        if (v.lastTs < oldestTs) { oldestTs = v.lastTs; oldestKey = k; }
      }
      if (oldestKey === undefined) break;
      this.volProfile.delete(oldestKey);
    }
  }

  render(): void {
    const panel = this.ensurePanel();
    if (this.volProfile.size === 0) {
      panel.innerHTML = '<div style="color: rgba(255,255,255,0.5);">Vol profile building...</div>';
      return;
    }

    // Greedy value area: sort by volume desc, accumulate until 68% reached.
    const entries = [...this.volProfile.entries()]
      .map(([price, b]) => [price, b.qty] as const)
      .sort((a, b) => b[1] - a[1]);
    const poc = entries[0];
    if (!poc) return;
    const totalVol = entries.reduce((a, b) => a + b[1], 0);
    const target = totalVol * 0.68;
    const valueArea: Array<readonly [number, number]> = [];
    let accum = 0;
    for (const e of entries) {
      valueArea.push(e);
      accum += e[1];
      if (accum >= target) break;
    }

    const pocPrice = poc[0].toLocaleString(undefined, { maximumFractionDigits: 2 });
    const pocVol = poc[1];

    let html = `<div style="color: #ff9800; margin-bottom: 8px;"><strong>POC</strong></div>`;
    html += `<div style="color: #ffffff; margin-bottom: 4px;">${pocPrice}</div>`;
    html += `<div style="color: rgba(255,255,255,0.7); font-size: 10px; margin-bottom: 8px;">${pocVol.toLocaleString()} qty</div>`;

    if (valueArea.length > 0) {
      const prices = valueArea.map((e) => e[0]);
      const vaHi = Math.max(...prices).toLocaleString(undefined, { maximumFractionDigits: 2 });
      const vaLo = Math.min(...prices).toLocaleString(undefined, { maximumFractionDigits: 2 });
      html += `<div style="color: #2196f3; font-size: 10px; margin-top: 8px;">VA: ${vaLo}–${vaHi}</div>`;
    }

    panel.innerHTML = html;
  }

  dispose(): void {
    if (this.container) {
      try { this.container.remove(); } catch { /* noop */ }
      this.container = null;
    }
  }
}
