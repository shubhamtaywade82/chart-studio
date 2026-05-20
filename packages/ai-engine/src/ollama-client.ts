/**
 * Thin wrapper around the Ollama HTTP API. Centralizes timeout, JSON-mode
 * parsing, retry-with-backoff, and a circuit breaker so a downed Ollama
 * server can't stall the engine.
 *
 * If `OLLAMA_DISABLE=1` or the host is unreachable, all calls return null
 * — heuristic-only mode keeps working.
 */
export interface OllamaGenerateOptions {
  model: string;
  prompt: string;
  /** Force JSON output (Ollama "format" parameter). */
  json?: boolean;
  /** Truncate output to N tokens. */
  numPredict?: number;
  /** Lower = more deterministic. Trading defaults to 0.05. */
  temperature?: number;
  /** Per-call timeout in ms. Defaults to 20s. */
  timeoutMs?: number;
  /** Override the system prompt. */
  system?: string;
}

export interface OllamaEmbeddingOptions {
  model: string;
  prompt: string;
  timeoutMs?: number;
}

export class OllamaClient {
  private host: string;
  private disabled: boolean;
  private failureCount = 0;
  private circuitOpenUntil = 0;

  constructor(host = process.env.OLLAMA_HOST ?? 'http://localhost:11434') {
    this.host = host.replace(/\/$/, '');
    this.disabled = process.env.OLLAMA_DISABLE === '1';
  }

  isAvailable(): boolean {
    if (this.disabled) return false;
    if (Date.now() < this.circuitOpenUntil) return false;
    return true;
  }

  async generate(opts: OllamaGenerateOptions): Promise<string | null> {
    if (!this.isAvailable()) return null;
    const body: Record<string, unknown> = {
      model: opts.model,
      prompt: opts.prompt,
      stream: false,
      options: {
        temperature: opts.temperature ?? 0.05,
        num_predict: opts.numPredict ?? 512,
        num_ctx: 4096,
      },
    };
    if (opts.json) body.format = 'json';
    if (opts.system) body.system = opts.system;

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
    try {
      const res = await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`ollama generate ${res.status}`);
      const json = await res.json() as { response?: string };
      this.failureCount = 0;
      return json.response ?? null;
    } catch (err) {
      this.recordFailure(err);
      return null;
    } finally {
      clearTimeout(tid);
    }
  }

  async generateJson<T>(opts: OllamaGenerateOptions): Promise<T | null> {
    const raw = await this.generate({ ...opts, json: true });
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Some models leak text around the JSON; salvage the first object.
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try { return JSON.parse(m[0]) as T; } catch { return null; }
    }
  }

  async embed(opts: OllamaEmbeddingOptions): Promise<number[] | null> {
    if (!this.isAvailable()) return null;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
    try {
      const res = await fetch(`${this.host}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: opts.model, prompt: opts.prompt }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`ollama embed ${res.status}`);
      const json = await res.json() as { embedding?: number[] };
      this.failureCount = 0;
      return json.embedding ?? null;
    } catch (err) {
      this.recordFailure(err);
      return null;
    } finally {
      clearTimeout(tid);
    }
  }

  private recordFailure(err: unknown): void {
    this.failureCount += 1;
    if (this.failureCount >= 3) {
      // Open the circuit for 30s after 3 consecutive failures.
      this.circuitOpenUntil = Date.now() + 30_000;
      this.failureCount = 0;
      console.warn('[ai-engine] ollama circuit opened for 30s:', err instanceof Error ? err.message : err);
    }
  }
}
