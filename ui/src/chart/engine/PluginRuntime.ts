import type { IChartApi, ISeriesApi, ISeriesPrimitive } from 'lightweight-charts';

/**
 * Interface that all custom rendering plugins must implement.
 */
export interface ChartPlugin {
  /** Unique identifier for the plugin (e.g. 'realtime-line', 'active-candle') */
  readonly id: string;
  
  /** Return the underlying Lightweight Charts primitive to attach */
  getPrimitive(): ISeriesPrimitive;

  /** 
   * Called automatically by the PluginRuntime every RAF loop 
   * if the plugin is registered and active.
   */
  onAnimationFrame?(timeMs: number): void;

  /** Called when the plugin is formally attached to the engine */
  onAttached?(api: IChartApi, series: ISeriesApi<'Candlestick'>): void;

  /** Called when the plugin is detached/destroyed */
  onDetached?(): void;
}

/**
 * Manages the lifecycle of all registered visual plugins.
 */
export class PluginRuntime {
  private plugins = new Map<string, ChartPlugin>();

  constructor(
    private readonly api: IChartApi,
    private readonly series: ISeriesApi<'Candlestick'>
  ) {}

  public register(plugin: ChartPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[PluginRuntime] Plugin ${plugin.id} is already registered. Detaching first.`);
      this.unregister(plugin.id);
    }
    
    this.plugins.set(plugin.id, plugin);
    this.series.attachPrimitive(plugin.getPrimitive());
    
    if (plugin.onAttached) {
      plugin.onAttached(this.api, this.series);
    }
  }

  public unregister(id: string): void {
    const plugin = this.plugins.get(id);
    if (!plugin) return;

    if (plugin.onDetached) {
      plugin.onDetached();
    }
    
    this.series.detachPrimitive(plugin.getPrimitive());
    this.plugins.delete(id);
  }

  public getPlugin<T extends ChartPlugin>(id: string): T | undefined {
    return this.plugins.get(id) as T | undefined;
  }

  /**
   * Called by the RafScheduler. Delegates the frame update to all active plugins.
   */
  public updatePlugins(timeMs: number): void {
    for (const plugin of this.plugins.values()) {
      if (plugin.onAnimationFrame) {
        plugin.onAnimationFrame(timeMs);
      }
    }
  }

  public destroy(): void {
    for (const id of this.plugins.keys()) {
      this.unregister(id);
    }
  }
}
