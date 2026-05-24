const KEY_PREFIX = 'chart-studio:workspace:';
const DEFAULT_KEY = `${KEY_PREFIX}default`;
const VERSION = 2;

export interface WorkspaceIndicatorState {
  defId: string;
  params: number[];
}

export interface WorkspaceState {
  version: number;
  savedAt: number;
  provider: string;
  symbol: string;
  interval: string;
  theme: string;
  indicators: WorkspaceIndicatorState[];
  scripts: Array<{ id: string; name: string; source: string; enabled: boolean }>;
}

/**
 * Unified workspace persistence: saves and restores the full chart state
 * (symbol, timeframe, theme, indicators, scripts) to localStorage.
 *
 * Multiple named workspaces are supported via the `key` parameter.
 */
export class WorkspaceManager {
  private current: WorkspaceState | null = null;

  load(key?: string): WorkspaceState | null {
    try {
      const raw = localStorage.getItem(key ?? DEFAULT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as WorkspaceState;
      if (parsed.version !== VERSION) return null;
      this.current = parsed;
      return parsed;
    } catch {
      return null;
    }
  }

  save(state: Omit<WorkspaceState, 'version' | 'savedAt'>, key?: string): void {
    const full: WorkspaceState = { ...state, version: VERSION, savedAt: Date.now() };
    this.current = full;
    try {
      localStorage.setItem(key ?? DEFAULT_KEY, JSON.stringify(full));
    } catch {
      // Quota exceeded — silently skip
    }
  }

  getCurrent(): WorkspaceState | null {
    return this.current;
  }

  /** List all saved workspace keys. */
  listKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(KEY_PREFIX)) keys.push(k);
    }
    return keys.sort();
  }

  /** Delete a workspace by key. */
  delete(key: string): void {
    localStorage.removeItem(key);
    if (this.current && key === DEFAULT_KEY) this.current = null;
  }

  deleteAll(): void {
    for (const k of this.listKeys()) localStorage.removeItem(k);
    this.current = null;
  }

  namedKey(name: string): string {
    return `${KEY_PREFIX}${encodeURIComponent(name)}`;
  }
}
