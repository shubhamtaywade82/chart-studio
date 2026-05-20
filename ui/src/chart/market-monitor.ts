export class LatencyMonitor {
  private latencies: number[] = [];
  private lastLtt = 0;
  private listeners = new Set<(stats: LatencyStats) => void>();

  onStatsChange(fn: (stats: LatencyStats) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  recordTick(ltt: number): void {
    if (ltt === this.lastLtt) return; // Duplicate tick
    this.lastLtt = ltt;

    const latencyMs = Date.now() - (ltt * 1000);
    if (latencyMs > 0 && latencyMs < 10000) {
      this.latencies.push(latencyMs);
      if (this.latencies.length > 100) this.latencies.shift();

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

    return {
      avg: Math.round(avg),
      min: sorted[0] ?? 0,
      max: sorted[len - 1] ?? 0,
      p95: p95 ?? 0,
      status,
      tradesPerSec: Math.round(this.latencies.length / 10), // ~10s window
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

export class DepthHeatmap {
  private container: HTMLElement | null = null;
  private bidOrders: number[] = [];
  private askOrders: number[] = [];

  ensurePanel(): HTMLElement {
    if (this.container) return this.container;
    this.container = document.getElementById('depth-heatmap-panel');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'depth-heatmap-panel';
      this.container.className = 'depth-heatmap-panel';
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
    }
    return this.container;
  }

  update(bidOrders: number[] | undefined, askOrders: number[] | undefined): void {
    if (!bidOrders || !askOrders) return;
    this.bidOrders = bidOrders;
    this.askOrders = askOrders;
    this.render();
  }

  private render(): void {
    const panel = this.ensurePanel();
    const cols = ['L1', 'L2', 'L3', 'L4', 'L5'];
    let html = '<div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px;">';

    for (let i = 0; i < 5; i++) {
      const bidOrd = this.bidOrders[i] ?? 0;
      const askOrd = this.askOrders[i] ?? 0;
      const avgBid = bidOrd > 0 ? (5000 / bidOrd) : 0;
      const avgAsk = askOrd > 0 ? (5000 / askOrd) : 0;

      const bidQuality = this.getQuality(avgBid, bidOrd);
      const askQuality = this.getQuality(avgAsk, askOrd);

      html += `
        <div style="text-align: center;">
          <div style="color: #26a69a; font-size: 10px; margin-bottom: 2px;">${cols[i]}</div>
          <div style="background: ${bidQuality.color}22; border: 1px solid ${bidQuality.color}; padding: 4px; border-radius: 2px; margin-bottom: 2px;">
            <div style="color: ${bidQuality.color}; font-size: 11px; font-weight: bold;">${bidOrd}</div>
            <div style="color: rgba(255,255,255,0.5); font-size: 9px;">${bidQuality.label}</div>
          </div>
          <div style="background: ${askQuality.color}22; border: 1px solid ${askQuality.color}; padding: 4px; border-radius: 2px;">
            <div style="color: ${askQuality.color}; font-size: 11px; font-weight: bold;">${askOrd}</div>
            <div style="color: rgba(255,255,255,0.5); font-size: 9px;">${askQuality.label}</div>
          </div>
        </div>
      `;
    }
    html += '</div>';
    panel.innerHTML = html;
  }

  private getQuality(avgSize: number, orderCount: number): { label: string; color: string } {
    if (avgSize > 5000 && orderCount < 5) return { label: 'Whale', color: '#ff9800' };
    if (avgSize < 100 && orderCount > 50) return { label: 'Retail', color: '#42a5f5' };
    return { label: 'Normal', color: '#9c9c9c' };
  }

  dispose(): void {
    if (this.container) {
      try { this.container.remove(); } catch { /* noop */ }
    }
  }
}

export class VolumeProfilePanel {
  private volProfile = new Map<number, number>();
  private container: HTMLElement | null = null;

  ensurePanel(): HTMLElement {
    if (this.container) return this.container;
    this.container = document.getElementById('volume-profile-panel');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'volume-profile-panel';
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
    }
    return this.container;
  }

  update(ltp: number, tickSize: number, ltq: number): void {
    const priceLevel = Math.round(ltp / tickSize) * tickSize;
    this.volProfile.set(priceLevel, (this.volProfile.get(priceLevel) ?? 0) + ltq);

    if (this.volProfile.size > 50) {
      const oldest = [...this.volProfile.keys()][0];
      if (oldest !== undefined) this.volProfile.delete(oldest);
    }
  }

  render(): void {
    const panel = this.ensurePanel();
    if (this.volProfile.size === 0) {
      panel.innerHTML = '<div style="color: rgba(255,255,255,0.5);">Vol profile building...</div>';
      return;
    }

    const entries = [...this.volProfile.entries()].sort((a, b) => b[1] - a[1]);
    const poc = entries[0];
    if (!poc) return;
    const totalVol = entries.reduce((a, b) => a + b[1], 0);
    const valueArea = entries.filter((e) => {
      const sum = entries.filter((x) => x[1] >= e[1]).reduce((a, b) => a + b[1], 0);
      return sum <= totalVol * 0.68;
    });

    const pocPrice = poc[0].toLocaleString(undefined, { maximumFractionDigits: 2 });
    const pocVol = poc[1];

    let html = `<div style="color: #ff9800; margin-bottom: 8px;"><strong>POC</strong></div>`;
    html += `<div style="color: #ffffff; margin-bottom: 4px;">${pocPrice}</div>`;
    html += `<div style="color: rgba(255,255,255,0.7); font-size: 10px; margin-bottom: 8px;">${pocVol} contracts</div>`;

    if (valueArea.length > 0) {
      const vaHi = Math.max(...valueArea.map((e) => e[0])).toLocaleString(undefined, { maximumFractionDigits: 2 });
      const vaLo = Math.min(...valueArea.map((e) => e[0])).toLocaleString(undefined, { maximumFractionDigits: 2 });
      html += `<div style="color: #2196f3; font-size: 10px; margin-top: 8px;">VA: ${vaLo}–${vaHi}</div>`;
    }

    panel.innerHTML = html;
  }

  dispose(): void {
    if (this.container) {
      try { this.container.remove(); } catch { /* noop */ }
    }
  }
}
