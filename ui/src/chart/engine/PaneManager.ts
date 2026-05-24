import type { IChartApi } from 'lightweight-charts';

export interface PaneConfig {
  id: string;
  name: string;
  index: number;
}

/**
 * Formal pane management: allocates pane indices for named sub-indicators
 * (RSI, MACD, CVD, OI, custom scripts) and tracks them so they can be
 * freed and the index reused on indicator reset.
 */
export class PaneManager {
  private panes = new Map<string, PaneConfig>();
  private nextIndex: number;

  constructor(
    private readonly api: IChartApi,
    baseIndex = 1,
  ) {
    this.nextIndex = baseIndex;
  }

  /**
   * Allocate the next pane index for a named indicator.
   * If already allocated, returns the existing index (idempotent).
   */
  allocate(id: string, name: string): number {
    const existing = this.panes.get(id);
    if (existing) return existing.index;
    const index = this.nextIndex++;
    this.panes.set(id, { id, name, index });
    return index;
  }

  /** Allocate an anonymous pane (e.g. for a one-off indicator). */
  claimNext(): number {
    return this.nextIndex++;
  }

  getIndex(id: string): number | undefined {
    return this.panes.get(id)?.index;
  }

  has(id: string): boolean {
    return this.panes.has(id);
  }

  list(): PaneConfig[] {
    return [...this.panes.values()].sort((a, b) => a.index - b.index);
  }

  get nextPaneIndex(): number {
    return this.nextIndex;
  }

  /**
   * Free a named pane. Caller must remove all series in that pane first.
   * Does NOT compact indices — freed indices become gaps.
   */
  free(id: string): void {
    this.panes.delete(id);
  }

  /** Reset all pane tracking. Call when all indicators are cleared. */
  reset(baseIndex = 1): void {
    this.panes.clear();
    this.nextIndex = baseIndex;
  }

  /**
   * Apply proportional heights to panes via the LWC API (when supported).
   * `configs` maps pane index → height fraction (0–1).
   */
  applyHeights(configs: Array<{ index: number; fraction: number }>): void {
    const panes = this.api.panes();
    for (const { index, fraction } of configs) {
      const pane = panes[index];
      if (pane && typeof (pane as any).setHeight === 'function') {
        (pane as any).setHeight(fraction);
      }
    }
  }
}
