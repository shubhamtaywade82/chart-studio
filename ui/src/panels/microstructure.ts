import type { Trade } from '../provider-client';

export class MicrostructurePanel {
  private readonly windowMs = 30_000;
  private trades: Trade[] = [];

  private readonly verdictBadge: HTMLElement;
  private readonly tfiContainer: HTMLElement;
  private readonly obiContainer: HTMLElement;
  private readonly pressureContainer: HTMLElement;
  private readonly spreadContainer: HTMLElement;
  private readonly rvContainer: HTMLElement;
  private readonly micropriceContainer: HTMLElement;
  private readonly hintEl: HTMLElement | null;

  private lastBids: Array<[number, number]> = [];
  private lastAsks: Array<[number, number]> = [];
  private hasData = false;

  constructor() {
    this.verdictBadge = document.getElementById('ms-verdict-badge')!;
    this.tfiContainer = document.getElementById('ms-tfi-30')!;
    this.obiContainer = document.getElementById('ms-obi')!;
    this.pressureContainer = document.getElementById('ms-pressure')!;
    this.spreadContainer = document.getElementById('ms-spread')!;
    this.rvContainer = document.getElementById('ms-rv')!;
    this.micropriceContainer = document.getElementById('ms-microprice')!;
    this.hintEl = document.querySelector('.ms-stub-hint');
  }

  reset(): void {
    this.trades = [];
    this.lastBids = [];
    this.lastAsks = [];
    this.hasData = false;
    if (this.hintEl) this.hintEl.style.display = 'block';
    this.verdictBadge.textContent = 'NEUTRAL';
    this.verdictBadge.className = 'ms-obi-badge neutral';

    // Reset fields to placeholders
    this.tfiContainer.querySelector('.ms-tfi-buy')!.textContent = '—';
    this.tfiContainer.querySelector('.ms-tfi-sell')!.textContent = '—';
    this.tfiContainer.querySelector('.ms-tfi-net')!.textContent = '—';
    const tfiFill = this.tfiContainer.querySelector('.ms-tfi-bar-fill') as HTMLElement;
    if (tfiFill) tfiFill.style.width = '50%';

    this.obiContainer.querySelector('.ms-obi-bar-wrap')!.innerHTML = '<div class="ms-obi-center-tick"></div>';
    this.obiContainer.querySelector('.ms-obi-value')!.textContent = '—';

    this.pressureContainer.querySelector('.ms-pressure-bar-wrap')!.innerHTML = '';
    this.pressureContainer.querySelector('.ms-pressure-label')!.textContent = '—';

    this.spreadContainer.querySelector('.ms-spread-val')!.textContent = '—';
    const spreadBadge = this.spreadContainer.querySelector('.ms-spread-badge')!;
    spreadBadge.textContent = '—';
    spreadBadge.className = 'ms-spread-badge neutral';

    this.rvContainer.querySelector('.ms-rv-val')!.textContent = '—';
    const rvBadge = this.rvContainer.querySelector('.ms-rv-badge')!;
    rvBadge.textContent = '—';
    rvBadge.className = 'ms-rv-badge rv-low';

    this.micropriceContainer.querySelector('.ms-stat-val')!.textContent = '—';
  }

  pushTrade(t: Trade): void {
    this.trades.push(t);
    this.updateTfi();
  }

  updateDepth(bids: Array<[number, number]>, asks: Array<[number, number]>): void {
    this.lastBids = bids;
    this.lastAsks = asks;
    this.reveal();

    if (bids.length === 0 || asks.length === 0) return;

    const bestBid = bids[0]![0];
    const bestAsk = asks[0]![0];
    const bidQtyL1 = bids[0]![1];
    const askQtyL1 = asks[0]![1];

    // ── 1. Wt. OBI & Pressure ──
    const weights = [5, 4, 3, 2, 1];
    let weightedBid = 0;
    let weightedAsk = 0;
    for (let i = 0; i < 5; i++) {
      const bid = bids[i];
      const ask = asks[i];
      const w = weights[i] ?? 1;
      if (bid) weightedBid += bid[1] * w;
      if (ask) weightedAsk += ask[1] * w;
    }

    const totalWeighted = weightedBid + weightedAsk;
    const imbalance = totalWeighted > 0 ? (weightedBid - weightedAsk) / totalWeighted : 0;
    const buyPressure = totalWeighted > 0 ? weightedBid / totalWeighted : 0.5;

    // Render OBI Bar
    const ratio = (imbalance + 1) / 2; // scale to 0..1
    const left = Math.max(0, 0.5 - ratio) * 100;
    const right = Math.max(0, ratio - 0.5) * 100;
    const obiWrap = this.obiContainer.querySelector('.ms-obi-bar-wrap')!;
    obiWrap.innerHTML = `
      <div class="ms-obi-center-tick"></div>
      ${ratio >= 0.5
        ? `<div class="ms-obi-bar-fill" style="left: 50%; width: ${right}%; background: var(--bull); height: 100%; transition: width 0.2s;"></div>`
        : `<div class="ms-obi-bar-fill" style="left: ${50 - left}%; width: ${left}%; background: var(--bear); height: 100%; transition: width 0.2s;"></div>`
      }
    `;
    const obiVal = this.obiContainer.querySelector('.ms-obi-value')!;
    obiVal.textContent = (imbalance >= 0 ? '+' : '') + imbalance.toFixed(2);
    obiVal.className = `ms-obi-value mono-sm ${imbalance >= 0.1 ? 'bull' : imbalance <= -0.1 ? 'bear' : ''}`;

    // Render Pressure Bar
    const pressurePct = buyPressure * 100;
    const pressureWrap = this.pressureContainer.querySelector('.ms-pressure-bar-wrap')!;
    pressureWrap.innerHTML = `
      <div class="ms-pressure-fill" style="width: ${pressurePct}%; background: ${pressurePct >= 50 ? 'var(--bull)' : 'var(--bear)'}; height: 100%; transition: width 0.2s;"></div>
    `;
    this.pressureContainer.querySelector('.ms-pressure-label')!.textContent = `${pressurePct.toFixed(1)}%`;

    // ── 2. Spread ──
    const spread = bestAsk - bestBid;
    const mid = (bestAsk + bestBid) / 2;
    const decimals = this.estimateDecimals(bestBid);
    this.spreadContainer.querySelector('.ms-spread-val')!.textContent = spread.toFixed(decimals);

    const bps = mid > 0 ? (spread / mid) * 10_000 : 0;
    const spreadBadge = this.spreadContainer.querySelector('.ms-spread-badge')!;
    if (bps < 1.5) {
      spreadBadge.textContent = 'TIGHT';
      spreadBadge.className = 'ms-spread-badge bull';
      (spreadBadge as HTMLElement).style.background = 'var(--bull-dim)';
      (spreadBadge as HTMLElement).style.color = 'var(--bull)';
    } else if (bps > 5.0) {
      spreadBadge.textContent = 'WIDE';
      spreadBadge.className = 'ms-spread-badge bear';
      (spreadBadge as HTMLElement).style.background = 'var(--bear-dim)';
      (spreadBadge as HTMLElement).style.color = 'var(--bear)';
    } else {
      spreadBadge.textContent = 'NORMAL';
      spreadBadge.className = 'ms-spread-badge neutral';
      (spreadBadge as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
      (spreadBadge as HTMLElement).style.color = 'var(--text-secondary)';
    }

    // ── 3. Microprice ──
    const microprice = (bestBid * askQtyL1 + bestAsk * bidQtyL1) / (bidQtyL1 + askQtyL1);
    this.micropriceContainer.querySelector('.ms-stat-val')!.textContent = microprice.toFixed(decimals);

    this.updateVerdict(imbalance);
  }

  updateAI(volatilityRegime?: string, toxicity?: number): void {
    this.reveal();

    if (volatilityRegime) {
      const badgeEl = this.rvContainer.querySelector('.ms-rv-badge')!;
      badgeEl.textContent = volatilityRegime.toUpperCase();
      let badgeClass = 'neutral';
      let styleBg = 'rgba(255,255,255,0.06)';
      let styleFg = 'var(--text-secondary)';

      if (volatilityRegime === 'low') {
        badgeClass = 'rv-low';
      } else if (volatilityRegime === 'high') {
        badgeClass = 'rv-high bear';
        styleBg = 'var(--bear-dim)';
        styleFg = 'var(--bear)';
      } else if (volatilityRegime === 'extreme') {
        badgeClass = 'rv-extreme bear';
        styleBg = 'rgba(239,83,80,0.3)';
        styleFg = '#ff8a80';
      }

      badgeEl.className = `ms-rv-badge ${badgeClass}`;
      (badgeEl as HTMLElement).style.background = styleBg;
      (badgeEl as HTMLElement).style.color = styleFg;
    }

    if (typeof toxicity === 'number') {
      // We can display the toxicity value as volatility level helper or in the RV section
      const valEl = this.rvContainer.querySelector('.ms-rv-val')!;
      valEl.textContent = `tox ${(toxicity * 100).toFixed(0)}%`;
    }
  }

  private updateTfi(): void {
    this.reveal();
    const cutoff = Date.now() - this.windowMs;
    while (this.trades.length > 0 && this.trades[0]!.ts < cutoff) {
      this.trades.shift();
    }

    let buyQty = 0;
    let sellQty = 0;
    for (const tr of this.trades) {
      if (tr.makerSide) sellQty += tr.qty;
      else buyQty += tr.qty;
    }

    const totalQty = buyQty + sellQty;
    const buyPct = totalQty > 0 ? (buyQty / totalQty) * 100 : 50;
    const net = buyQty - sellQty;

    // Update Bar
    const fillEl = this.tfiContainer.querySelector('.ms-tfi-bar-fill') as HTMLElement;
    if (fillEl) {
      fillEl.style.width = `${buyPct}%`;
      fillEl.className = `ms-tfi-bar-fill ${buyPct >= 55 ? 'buy' : buyPct <= 45 ? 'sell' : 'neutral'}`;
      if (buyPct >= 55) {
        fillEl.style.background = 'var(--bull)';
      } else if (buyPct <= 45) {
        fillEl.style.background = 'var(--bear)';
      } else {
        fillEl.style.background = '#8892a4';
      }
    }

    // Update Labels
    this.tfiContainer.querySelector('.ms-tfi-buy')!.textContent = buyQty.toLocaleString(undefined, { maximumFractionDigits: 1 });
    this.tfiContainer.querySelector('.ms-tfi-sell')!.textContent = sellQty.toLocaleString(undefined, { maximumFractionDigits: 1 });

    const netEl = this.tfiContainer.querySelector('.ms-tfi-net')!;
    const netSign = net >= 0 ? '+' : '';
    netEl.textContent = `${netSign}${net.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
    netEl.className = `ms-tfi-net mono-sm ${net > 0 ? 'bull' : net < 0 ? 'bear' : ''}`;
    (netEl as HTMLElement).style.color = net > 0 ? 'var(--bull)' : net < 0 ? 'var(--bear)' : 'var(--text-dim)';
  }

  private updateVerdict(imbalance: number): void {
    let buyPct30s = 50;
    let net30s = 0;

    const cutoff = Date.now() - this.windowMs;
    const recent = this.trades.filter((t) => t.ts >= cutoff);
    if (recent.length > 0) {
      let buy = 0, sell = 0;
      for (const t of recent) {
        if (t.makerSide) sell += t.qty;
        else buy += t.qty;
      }
      if (buy + sell > 0) {
        buyPct30s = (buy / (buy + sell)) * 100;
        net30s = buy - sell;
      }
    }

    let verdict = 'NEUTRAL';
    let verdictClass = 'neutral';
    let bg = 'rgba(255,255,255,0.06)';
    let fg = 'var(--text-secondary)';

    if (imbalance > 0.15 && buyPct30s > 55) {
      verdict = 'BULLISH';
      verdictClass = 'bull';
      bg = 'var(--bull-dim)';
      fg = 'var(--bull)';
    } else if (imbalance < -0.15 && buyPct30s < 45) {
      verdict = 'BEARISH';
      verdictClass = 'bear';
      bg = 'var(--bear-dim)';
      fg = 'var(--bear)';
    } else if (imbalance > 0.25 || buyPct30s > 65) {
      verdict = 'BULLISH';
      verdictClass = 'bull';
      bg = 'var(--bull-dim)';
      fg = 'var(--bull)';
    } else if (imbalance < -0.25 || buyPct30s < 35) {
      verdict = 'BEARISH';
      verdictClass = 'bear';
      bg = 'var(--bear-dim)';
      fg = 'var(--bear)';
    }

    this.verdictBadge.textContent = verdict;
    this.verdictBadge.className = `ms-obi-badge ${verdictClass}`;
    this.verdictBadge.style.background = bg;
    this.verdictBadge.style.color = fg;
  }

  private reveal(): void {
    if (this.hasData) return;
    this.hasData = true;
    if (this.hintEl) this.hintEl.style.display = 'none';
  }

  private estimateDecimals(sample: number): number {
    if (sample >= 1000) return 2;
    if (sample >= 1) return 3;
    if (sample >= 0.01) return 4;
    return 6;
  }
}
