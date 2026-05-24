import { Ollama } from 'ollama';

export interface OllamaGenerateOptions {
  model: string;
  prompt: string;
  /** Force JSON output. */
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
  private client: Ollama;
  private disabled: boolean;
  private failureCount = 0;
  private circuitOpenUntil = 0;
  private requestQueue: Promise<any> = Promise.resolve();

  constructor() {
    const host = (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
    const apiKey = process.env.OLLAMA_API_KEY;
    
    this.client = new Ollama({
      host,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    
    this.disabled = process.env.OLLAMA_DISABLE === '1';
  }

  private async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.requestQueue.then(fn);
    this.requestQueue = next.catch(() => {});
    return next;
  }

  isAvailable(): boolean {
    if (this.disabled) return false;
    if (Date.now() < this.circuitOpenUntil) return false;
    return true;
  }

  async generate(opts: OllamaGenerateOptions): Promise<string | null> {
    if (!this.isAvailable()) return null;

    let model = opts.model;
    if (process.env.OLLAMA_MODE === 'cloud' && (model.endsWith('-cloud') || model.endsWith(':cloud'))) {
      model = model.slice(0, -6);
    }

    return this.enqueue(async () => {
      if (!this.isAvailable()) return null;
      try {
        const messages = [];
        if (opts.system) {
          messages.push({ role: 'system', content: opts.system });
        }
        messages.push({ role: 'user', content: opts.prompt });

        const res = await this.client.chat({
          model,
          messages,
          stream: false,
          format: opts.json ? 'json' : undefined,
          options: {
            temperature: opts.temperature ?? 0.05,
            num_predict: opts.numPredict ?? 512,
            num_ctx: 4096,
          },
        });
        
        this.failureCount = 0;
        return res.message.content || null;
      } catch (err) {
        this.recordFailure(err);
        return null;
      }
    });
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

    let model = opts.model;
    if (process.env.OLLAMA_MODE === 'cloud' && (model.endsWith('-cloud') || model.endsWith(':cloud'))) {
      model = model.slice(0, -6);
    }

    return this.enqueue(async () => {
      if (!this.isAvailable()) return null;
      try {
        const res = await this.client.embeddings({
          model,
          prompt: opts.prompt,
        });
        
        this.failureCount = 0;
        return res.embedding ?? null;
      } catch (err) {
        this.recordFailure(err);
        return null;
      }
    });
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
