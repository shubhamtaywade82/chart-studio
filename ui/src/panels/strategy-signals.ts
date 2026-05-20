/**
 * Strategy Signals panel: renders the strategy_signal annotation pushed by
 * the ai-engine into the static markup defined in index.html (#signals-panel).
 *
 * Activation: `bind(provider, symbol, interval)` is called whenever the chart
 * subject changes. The panel filters incoming annotations by interval so the
 * displayed values always match the active timeframe.
 */

import type { AIAnnotation, ProviderClient } from '../provider-client';

type Sign = 'bull' | 'bear' | 'flat' | 'bullish' | 'bearish' | 'neutral' | 'up' | 'down' | 'none';

interface StrategySignalPayload {
  interval: string;
  verdict: 'bullish' | 'bearish' | 'neutral';
  htfBias: 'bullish' | 'bearish' | 'neutral';
  trend: 'up' | 'down' | 'flat';
  confidence: number;
  refPrice: number;
  smc: {
    score: number;
    sweep: 'bullish' | 'bearish' | 'none';
    orderBlock: 'bullish' | 'bearish' | 'none';
    fvg: 'bullish' | 'bearish' | 'none';
    bos: 'bullish' | 'bearish' | 'none';
    choch: 'bullish' | 'bearish' | 'none';
  };
  mtf: {
    direction: 'bullish' | 'bearish' | 'neutral';
    pass: number;
    legs: Array<{ label: string; trend: 'up' | 'down' | 'flat' }>;
    reasons: string[];
  };
  matrix: {
    ema: 'bull' | 'bear' | 'flat';
    macd: 'bull' | 'bear' | 'flat';
    rsi: 'bull' | 'bear' | 'flat';
    st: 'bull' | 'bear' | 'flat';
    struct: 'bull' | 'bear' | 'flat';
    vol: 'bull' | 'bear' | 'flat';
  };
}

const VAL_LABEL: Record<string, string> = {
  bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral',
  bull: 'Bull', bear: 'Bear', flat: 'Flat',
  up: 'Up', down: 'Down', none: '—',
};

const cssFor = (s: Sign): string => {
  if (s === 'bull' || s === 'bullish' || s === 'up') return 'bull';
  if (s === 'bear' || s === 'bearish' || s === 'down') return 'bear';
  return 'neutral';
};

const setSign = (id: string, s: Sign): void => {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = VAL_LABEL[s] ?? '—';
  el.classList.remove('bull', 'bear', 'neutral');
  el.classList.add(cssFor(s));
};

const setText = (id: string, text: string, klass?: string): void => {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  if (klass !== undefined) {
    el.classList.remove('bull', 'bear', 'neutral');
    if (klass) el.classList.add(klass);
  }
};

export class StrategySignalsPanel {
  private interval = '1m';
  private unsub: (() => void) | null = null;

  constructor(private readonly client: ProviderClient) {}

  bind(provider: string, symbol: string, interval: string): void {
    this.interval = interval;
    if (this.unsub) { this.unsub(); this.unsub = null; }
    this.reset();
    this.unsub = this.client.streamAIAnnotation(provider, symbol, (ann: AIAnnotation) => {
      if (ann.kind !== ('strategy_signal' as AIAnnotation['kind'])) return;
      const p = ann.data as StrategySignalPayload;
      if (!p || p.interval !== this.interval) return;
      this.render(p);
    });
  }

  setInterval(interval: string): void {
    this.interval = interval;
    this.reset();
  }

  detach(): void {
    if (this.unsub) { this.unsub(); this.unsub = null; }
  }

  private reset(): void {
    const verdict = document.getElementById('signal-verdict');
    if (verdict) { verdict.textContent = 'NEUTRAL'; verdict.className = 'verdict-badge neutral'; }
    ['sig-htf', 'sig-ltf', 'sig-conf', 'sig-ref-tf',
     'sig-smc-score', 'sig-sweep', 'sig-ob', 'sig-fvg', 'sig-bos', 'sig-choch',
     'sig-mtf-dir', 'sig-mtf-pass'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.textContent = '—'; el.classList.remove('bull', 'bear'); el.classList.add('neutral'); }
    });
    const reasons = document.getElementById('sig-mtf-reasons');
    if (reasons) reasons.innerHTML = '';
    document.querySelectorAll<HTMLElement>('.signals-matrix .matrix-item').forEach((cell) => {
      const v = cell.querySelector('.mat-val');
      if (v) v.textContent = '—';
      cell.classList.remove('bull', 'bear');
      cell.classList.add('neutral');
    });
  }

  private render(p: StrategySignalPayload): void {
    const verdict = document.getElementById('signal-verdict');
    if (verdict) {
      verdict.textContent = p.verdict.toUpperCase();
      verdict.className = `verdict-badge ${cssFor(p.verdict)}`;
    }

    setSign('sig-htf', p.htfBias);
    setSign('sig-ltf', p.trend);
    setText('sig-conf', `${Math.round(p.confidence * 100)}%`,
      p.confidence >= 0.6 ? cssFor(p.verdict) : 'neutral');
    setText('sig-ref-tf', p.refPrice ? p.refPrice.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—', 'neutral');

    setText('sig-smc-score', String(p.smc.score),
      p.smc.score > 0 ? 'bull' : p.smc.score < 0 ? 'bear' : 'neutral');
    setSign('sig-sweep', p.smc.sweep);
    setSign('sig-ob', p.smc.orderBlock);
    setSign('sig-fvg', p.smc.fvg);
    setSign('sig-bos', p.smc.bos);
    setSign('sig-choch', p.smc.choch);

    setSign('sig-mtf-dir', p.mtf.direction);
    setText('sig-mtf-pass', `${p.mtf.pass}/${p.mtf.legs.length}`,
      p.mtf.pass >= 2 ? cssFor(p.mtf.direction) : 'neutral');
    const reasons = document.getElementById('sig-mtf-reasons');
    if (reasons) {
      reasons.innerHTML = '';
      for (const leg of p.mtf.legs) {
        const row = document.createElement('div');
        row.className = `reason-row ${cssFor(leg.trend)}`;
        row.textContent = `${leg.label}: ${VAL_LABEL[leg.trend] ?? leg.trend}`;
        reasons.appendChild(row);
      }
    }

    const cells = document.querySelectorAll<HTMLElement>('.signals-matrix .matrix-item');
    const order: Array<keyof StrategySignalPayload['matrix']> = ['ema', 'macd', 'rsi', 'st', 'struct', 'vol'];
    cells.forEach((cell, i) => {
      const key = order[i];
      const val = cell.querySelector<HTMLElement>('.mat-val');
      if (!val || !key) return;
      const s = p.matrix[key];
      val.textContent = VAL_LABEL[s] ?? s;
      cell.classList.remove('bull', 'bear', 'neutral');
      cell.classList.add(cssFor(s));
    });
  }
}
