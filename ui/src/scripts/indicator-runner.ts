import type { IndicatorId, IndicatorWorkerRequest, IndicatorWorkerResponse } from './indicator-worker';
import type { Candle } from '../provider-client';

export type { IndicatorId };

export interface IndicatorRunOptions {
  indicator: IndicatorId;
  params?: Record<string, number>;
  candles: Candle[];
}

export interface IndicatorResult {
  indicator: IndicatorId;
  result: Record<string, number[]>;
}

let workerInstance: Worker | null = null;

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL('./indicator-worker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return workerInstance;
}

/**
 * Runs indicator calculations off the main thread using a shared Web Worker.
 * The worker is lazily created and reused across all calls.
 *
 * Usage:
 *   const runner = new IndicatorRunner();
 *   const result = await runner.run({ indicator: 'RSI', params: { period: 14 }, candles });
 *   // result.result.values — array of RSI values aligned to candles
 */
export class IndicatorRunner {
  private readonly pending = new Map<string, (resp: IndicatorWorkerResponse) => void>();
  private nextId = 1;
  private worker: Worker;

  constructor() {
    this.worker = getWorker();
    this.worker.addEventListener('message', (ev: MessageEvent<IndicatorWorkerResponse>) => {
      const cb = this.pending.get(ev.data.reqId);
      if (!cb) return;
      this.pending.delete(ev.data.reqId);
      cb(ev.data);
    });
  }

  run(opts: IndicatorRunOptions): Promise<IndicatorResult> {
    return new Promise((resolve, reject) => {
      const reqId = `ind-${this.nextId++}`;
      const req: IndicatorWorkerRequest = {
        reqId,
        indicator: opts.indicator,
        params: opts.params ?? {},
        closes: opts.candles.map(c => c.close),
        highs: opts.candles.map(c => c.high),
        lows: opts.candles.map(c => c.low),
        volumes: opts.candles.map(c => c.volume),
      };
      this.pending.set(reqId, (resp) => {
        if (!resp.ok) { reject(new Error(resp.error ?? 'Indicator worker error')); return; }
        resolve({ indicator: opts.indicator, result: resp.result! });
      });
      this.worker.postMessage(req);
    });
  }

  /** Run multiple indicators concurrently over the same candle set. */
  runAll(
    candles: Candle[],
    indicators: Array<{ indicator: IndicatorId; params?: Record<string, number> }>,
  ): Promise<IndicatorResult[]> {
    return Promise.all(indicators.map(({ indicator, params }) => this.run({ indicator, params, candles })));
  }

  /** Terminate the shared worker. Call on app teardown. */
  terminate(): void {
    this.worker.terminate();
    workerInstance = null;
  }
}
