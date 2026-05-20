/**
 * Cross-instrument correlation tracker. Maintains rolling return series
 * per symbol and computes pearson correlations between any pair on demand.
 */
export class CorrelationTracker {
  private series = new Map<string, Array<{ ts: number; price: number }>>();
  private readonly windowMs = 5 * 60 * 1000;

  /** Push a price tick for a symbol. */
  observe(symbol: string, price: number): void {
    const arr = this.series.get(symbol) ?? [];
    arr.push({ ts: Date.now(), price });
    const cutoff = Date.now() - this.windowMs;
    while (arr.length > 0 && arr[0]!.ts < cutoff) arr.shift();
    this.series.set(symbol, arr);
  }

  /** Computes pearson correlation between two symbols on aligned 1s buckets. */
  correlation(symA: string, symB: string): number | null {
    const a = this.series.get(symA);
    const b = this.series.get(symB);
    if (!a || !b || a.length < 30 || b.length < 30) return null;

    const bucketsA = bucket(a);
    const bucketsB = bucket(b);
    const keys = [...bucketsA.keys()].filter((k) => bucketsB.has(k)).sort();
    if (keys.length < 10) return null;

    const retsA: number[] = [];
    const retsB: number[] = [];
    for (let i = 1; i < keys.length; i += 1) {
      const ka = keys[i]!;
      const kPrev = keys[i - 1]!;
      const pA0 = bucketsA.get(kPrev)!;
      const pA1 = bucketsA.get(ka)!;
      const pB0 = bucketsB.get(kPrev)!;
      const pB1 = bucketsB.get(ka)!;
      retsA.push((pA1 - pA0) / pA0);
      retsB.push((pB1 - pB0) / pB0);
    }
    return pearson(retsA, retsB);
  }

  symbols(): string[] {
    return [...this.series.keys()];
  }
}

function bucket(samples: Array<{ ts: number; price: number }>): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of samples) {
    const k = Math.floor(s.ts / 1000);
    m.set(k, s.price); // last price in second wins
  }
  return m;
}

function pearson(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const n = a.length;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i += 1) { sumA += a[i]!; sumB += b[i]!; }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  return denom === 0 ? 0 : cov / denom;
}
