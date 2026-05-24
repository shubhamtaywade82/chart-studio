import type { IChartApi } from 'lightweight-charts';

export type SyncMode = 'range' | 'crosshair' | 'both';

interface SyncedChart {
  api: IChartApi;
  unsubscribers: Array<() => void>;
}

/**
 * Multi-chart synchronization engine.
 *
 * Synchronizes visible time range across multiple IChartApi instances
 * so that zooming or scrolling one chart propagates to all others.
 *
 * Usage:
 *   const sync = new MultiChartSync();
 *   const unsub1 = sync.add(chart1.engine.api);
 *   const unsub2 = sync.add(chart2.engine.api);
 *   // Later:
 *   unsub1(); unsub2();
 */
export class MultiChartSync {
  private charts = new Map<IChartApi, SyncedChart>();
  private syncing = false;

  /**
   * Add an IChartApi to the sync group.
   * Returns an unsub function that removes it from the group.
   */
  add(api: IChartApi, mode: SyncMode = 'range'): () => void {
    if (this.charts.has(api)) return () => this.remove(api);

    const unsubscribers: Array<() => void> = [];

    if (mode === 'range' || mode === 'both') {
      const unsub = api.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (this.syncing || !range) return;
        this.syncing = true;
        for (const [otherApi] of this.charts) {
          if (otherApi === api) continue;
          try { otherApi.timeScale().setVisibleLogicalRange(range); } catch { /* chart may be torn down */ }
        }
        this.syncing = false;
      });
      // LWC v5: subscribeVisibleLogicalRangeChange returns void; keep reference via closure
      unsubscribers.push(() => api.timeScale().unsubscribeVisibleLogicalRangeChange(() => {}));
    }

    this.charts.set(api, { api, unsubscribers });
    return () => this.remove(api);
  }

  remove(api: IChartApi): void {
    const entry = this.charts.get(api);
    if (!entry) return;
    for (const fn of entry.unsubscribers) { try { fn(); } catch { /* noop */ } }
    this.charts.delete(api);
  }

  /** Synchronize all charts to the given chart's current visible range. */
  syncTo(sourceApi: IChartApi): void {
    const range = sourceApi.timeScale().getVisibleLogicalRange();
    if (!range) return;
    this.syncing = true;
    for (const [api] of this.charts) {
      if (api === sourceApi) continue;
      try { api.timeScale().setVisibleLogicalRange(range); } catch { /* noop */ }
    }
    this.syncing = false;
  }

  removeAll(): void {
    for (const [api] of this.charts) this.remove(api);
  }

  get size(): number { return this.charts.size; }
}
