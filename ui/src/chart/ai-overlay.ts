import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { LineStyle } from 'lightweight-charts';

export type Urgency = 'none' | 'watch_only' | 'next_5min' | 'this_candle' | 'immediate' | 'critical';

export interface AILevel {
  price: number;
  type: 'support' | 'resistance' | 'poc' | 'invalidation';
  confidence: number;
  rationale: string;
}

export interface AISignal {
  layer: 'reflex' | 'tactical';
  type: string;
  urgency: Urgency;
  confidence: number;
  narrative: string;
  ts: number;
}

export interface TradeSetup {
  exists: boolean;
  direction: 'long' | 'short' | 'none';
  entry: number;
  stop: number;
  target: number;
  confidence: number;
  riskReward: number;
  positionSizePct: number;
  rationale: string;
  invalidation: string;
}

export interface FocusComponents {
  order_blocks?: UTCTimestamp[];
  fvgs?: UTCTimestamp[];
  sweeps?: UTCTimestamp[];
}

const REGIME_BG: Record<string, string> = {
  'accumulation': 'rgba(76, 175, 80, 0.03)',
  'distribution': 'rgba(244, 67, 54, 0.03)',
  'trending-up': 'rgba(0, 230, 118, 0.05)',
  'trending-down': 'rgba(255, 82, 82, 0.05)',
  'breakout': 'rgba(255, 215, 64, 0.08)',
  'failed_breakout': 'rgba(124, 77, 255, 0.06)',
  'range-bound': 'transparent',
};

/**
 * Manages all AI-driven overlays on the chart: levels, regime backdrop,
 * divergence markers, trade plan card, narrative ticker, OI/regime panels.
 */
export class AIOverlayManager {
  private levelLines = new Map<string, ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>>();
  private setupLines: Array<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>> = [];
  private focus: FocusComponents = {};

  constructor(private chart: IChartApi, private series: ISeriesApi<'Candlestick'>, private container: HTMLElement) {
    this.ensurePanels();
  }

  reset(): void {
    for (const line of this.levelLines.values()) {
      try { this.series.removePriceLine(line); } catch { /* noop */ }
    }
    this.levelLines.clear();
    for (const line of this.setupLines) {
      try { this.series.removePriceLine(line); } catch { /* noop */ }
    }
    this.setupLines = [];
    this.focus = {};
    this.hideTradeCard();
  }

  applyFocus(focus: FocusComponents): void {
    this.focus = focus;
  }

  isFocused(type: keyof FocusComponents, time: UTCTimestamp): boolean {
    const list = this.focus[type];
    if (!list || list.length === 0) return true;
    return list.includes(time);
  }

  private lastHtfBias: string = 'NEUTRAL';
  private lastLtfRegime: string = 'UNKNOWN';

  // ── 1. Regime color coding ──
  applyRegime(regime: string): void {
    const bg = REGIME_BG[regime] ?? 'transparent';
    this.chart.applyOptions({ layout: { background: { color: bg } } });
    this.lastLtfRegime = regime.replace(/_/g, ' ').toUpperCase();
    this.updateRegimeTag();
  }

  applyHtfBias(bias: string): void {
    this.lastHtfBias = bias.toUpperCase();
    this.updateRegimeTag();
  }

  private updateRegimeTag(): void {
    const tag = document.getElementById('ai-regime-tag');
    if (tag) {
      tag.textContent = `HTF ${this.lastHtfBias} / LTF ${this.lastLtfRegime}`;
      tag.setAttribute('data-regime', this.lastLtfRegime.toLowerCase().replace(/ /g, '_'));
    }
  }

  // ── 2. Smart support/resistance levels ──
  applyLevels(levels: AILevel[]): void {
    // Mark all existing as stale; we'll remove leftovers after re-applying.
    const incomingKeys = new Set(levels.map((l) => `${l.type}:${l.price.toFixed(2)}`));
    for (const [key, line] of this.levelLines) {
      if (!incomingKeys.has(key)) {
        try { this.series.removePriceLine(line); } catch { /* noop */ }
        this.levelLines.delete(key);
      }
    }
    for (const level of levels) {
      if (!Number.isFinite(level.price) || level.price <= 0) continue;
      if (level.confidence < 0.5) continue; // Fade-out low-confidence
      const key = `${level.type}:${level.price.toFixed(2)}`;
      if (this.levelLines.has(key)) continue;

      const color = level.type === 'support' ? '#26a69a'
        : level.type === 'resistance' ? '#ef5350'
        : level.type === 'poc' ? '#ff9800'
        : '#7c4dff';
      const line = this.series.createPriceLine({
        price: level.price,
        color,
        lineWidth: level.confidence > 0.8 ? 2 : 1,
        lineStyle: level.confidence > 0.8 ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${level.type.toUpperCase()} ${(level.confidence * 100).toFixed(0)}%`,
      });
      this.levelLines.set(key, line);
    }
  }

  // ── 4. Trade plan overlay card ──
  applySetup(setup: TradeSetup): void {
    // Clear previous setup lines.
    for (const line of this.setupLines) {
      try { this.series.removePriceLine(line); } catch { /* noop */ }
    }
    this.setupLines = [];

    if (!setup.exists || setup.direction === 'none') {
      this.hideTradeCard();
      return;
    }

    // Entry, stop, target lines.
    this.setupLines.push(this.series.createPriceLine({
      price: setup.entry, color: '#2196f3', lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Entry',
    }));
    this.setupLines.push(this.series.createPriceLine({
      price: setup.stop, color: '#ef5350', lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Stop',
    }));
    this.setupLines.push(this.series.createPriceLine({
      price: setup.target, color: '#26a69a', lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Target',
    }));

    this.showTradeCard(setup);
  }

  // ── 3. Divergence markers ──
  applyDivergences(divs: Array<{ type: string; strength: number; description: string }>): void {
    const panel = this.ensureDivPanel();
    if (divs.length === 0) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    panel.innerHTML = divs.map((d) => {
      const color = d.strength > 0 ? '#26a69a' : '#ef5350';
      const tag = d.type === 'price-oi' ? 'OI' : d.type === 'price-cvd' ? 'CVD' : 'ATP';
      return `<div style="border-left: 3px solid ${color}; padding: 4px 8px; margin: 4px 0; color: ${color}; font-size: 11px;">
        <strong>${tag}</strong> ${Math.abs(d.strength).toFixed(2)}
        <div style="color: rgba(255,255,255,0.7); font-size: 10px;">${escapeHtml(d.description)}</div>
      </div>`;
    }).join('');
  }

  // ── 5. Narrative ticker ──
  private narrativeInterval: any = null;
  private lastNarrativeText: string = '';

  applyNarrative(text: string, urgency: Urgency): void {
    if (this.lastNarrativeText === text) return;
    this.lastNarrativeText = text;

    const el = this.ensureNarrativeBar();
    const body = document.getElementById('ai-hud-body');
    const status = document.getElementById('ai-hud-status');
    if (!body || !status) return;

    el.style.display = 'block';
    
    const colors: Record<Urgency, string> = {
      none: '#9c9c9c',
      watch_only: '#9c9c9c',
      next_5min: '#bdbdbd',
      this_candle: '#ffd740',
      immediate: '#ff5252',
      critical: '#ff1744',
    };
    const color = colors[urgency];
    el.style.borderColor = `rgba(${urgency === 'immediate' || urgency === 'critical' ? '255,82,82' : '124,77,255'}, 0.3)`;
    status.style.color = color;
    status.textContent = `[${urgency.toUpperCase()}]`;

    // Typewriter effect
    if (this.narrativeInterval) clearInterval(this.narrativeInterval);
    body.innerHTML = '';
    let i = 0;
    this.narrativeInterval = setInterval(() => {
      if (i < text.length) {
        body.innerHTML += text[i] === '\n' ? '<br>' : escapeHtml(text[i]!);
        i++;
      } else {
        clearInterval(this.narrativeInterval);
      }
    }, 20);

    if (urgency === 'immediate' || urgency === 'critical') {
      el.animate([
        { boxShadow: '0 0 0px rgba(255,82,82,0)' },
        { boxShadow: '0 0 15px rgba(255,82,82,0.4)' },
        { boxShadow: '0 0 0px rgba(255,82,82,0)' }
      ], { duration: 1000, iterations: 3 });
    }
  }

  // ── 6. OI / Price 4-quadrant matrix ──
  applyOiMatrix(priceChange: number, oiChange: number): void {
    const panel = this.ensureOiMatrix();
    const quadrant = priceChange > 0 && oiChange > 0 ? 'LONG_BUILDUP'
      : priceChange < 0 && oiChange > 0 ? 'SHORT_BUILDUP'
      : priceChange > 0 && oiChange < 0 ? 'SHORT_COVERING'
      : 'LONG_UNWINDING';

    const labels: Record<string, { label: string; color: string }> = {
      LONG_BUILDUP: { label: 'Long Buildup', color: '#26a69a' },
      SHORT_BUILDUP: { label: 'Short Buildup', color: '#ef5350' },
      SHORT_COVERING: { label: 'Short Covering', color: '#81c784' },
      LONG_UNWINDING: { label: 'Long Unwinding', color: '#f48fb1' },
    };
    const c = labels[quadrant]!;
    panel.innerHTML = `
      <div style="font-size: 10px; color: rgba(255,255,255,0.5); margin-bottom: 4px;">F&amp;O STATE</div>
      <div style="font-size: 14px; color: ${c.color}; font-weight: bold;">${c.label}</div>
      <div style="font-size: 10px; color: rgba(255,255,255,0.6); margin-top: 4px;">
        Px ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)} | OI ${oiChange >= 0 ? '+' : ''}${(oiChange / 1000).toFixed(1)}K
      </div>
    `;
  }

  // ── 7. Toxicity meter ──
  applyToxicity(toxicity: number): void {
    const panel = this.ensureToxicityPanel();
    const pct = Math.round(toxicity * 100);
    const color = toxicity > 0.6 ? '#ff5252' : toxicity > 0.3 ? '#ffd740' : '#26a69a';
    const label = toxicity > 0.6 ? 'TOXIC' : toxicity > 0.3 ? 'CAUTION' : 'HEALTHY';
    panel.innerHTML = `
      <div style="font-size: 10px; color: rgba(255,255,255,0.5);">TOXICITY</div>
      <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
        <div style="width: 60px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
          <div style="width: ${pct}%; height: 100%; background: ${color}; transition: width .3s;"></div>
        </div>
        <div style="color: ${color}; font-size: 11px; font-weight: bold;">${pct}</div>
      </div>
      <div style="color: ${color}; font-size: 9px; margin-top: 2px;">${label}</div>
    `;
    // Pulsing border when toxic
    if (toxicity > 0.6) {
      this.container.classList.add('ai-toxic-border');
    } else {
      this.container.classList.remove('ai-toxic-border');
    }
  }

  // ── 8. Historical echo badge ──
  applyHistoricalEcho(matches: number, bullishCount: number): void {
    const panel = this.ensureEchoBadge();
    if (matches === 0) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const pct = Math.round((bullishCount / matches) * 100);
    const color = pct > 60 ? '#26a69a' : pct < 40 ? '#ef5350' : '#9c9c9c';
    panel.innerHTML = `
      <div style="font-size: 9px; color: rgba(255,255,255,0.5);">HISTORICAL ECHO</div>
      <div style="color: ${color}; font-size: 11px; font-weight: bold;">${matches} matches · ${pct}% bullish</div>
    `;
  }

  // ── 11. Confluence badge ──
  applyConfluence(badges: Array<{ tf: string; signal: 'bullish' | 'bearish' | 'neutral' }>): void {
    const panel = this.ensureConfluencePanel();
    if (badges.length === 0) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const bullish = badges.filter((b) => b.signal === 'bullish').length;
    const bearish = badges.filter((b) => b.signal === 'bearish').length;
    const conflictClass = bullish > 0 && bearish > 0 ? 'conflicted' : 'aligned';
    const color = conflictClass === 'conflicted' ? '#ffd740' : (bullish > bearish ? '#26a69a' : '#ef5350');
    panel.innerHTML = `
      <div style="font-size: 9px; color: rgba(255,255,255,0.5);">CONFLUENCE</div>
      <div style="display: flex; gap: 3px; margin-top: 3px;">
        ${badges.map((b) => `<span style="
          padding: 2px 6px;
          font-size: 10px;
          border-radius: 2px;
          background: ${b.signal === 'bullish' ? 'rgba(38,166,154,0.2)' : b.signal === 'bearish' ? 'rgba(239,83,80,0.2)' : 'rgba(255,255,255,0.06)'};
          color: ${b.signal === 'bullish' ? '#26a69a' : b.signal === 'bearish' ? '#ef5350' : '#9c9c9c'};
        ">${b.tf}</span>`).join('')}
      </div>
      <div style="color: ${color}; font-size: 9px; margin-top: 2px;">${conflictClass === 'aligned' ? 'ALIGNED' : 'CONFLICTED'}</div>
    `;
  }

  // ── 12. Risk pill ──
  applyRisk(status: 'all_clear' | 'yellow' | 'red', reason: string): void {
    const pill = this.ensureRiskPill();
    const color = status === 'red' ? '#ef5350' : status === 'yellow' ? '#ffd740' : '#26a69a';
    pill.style.background = `${color}33`;
    pill.style.color = color;
    pill.style.borderColor = color;
    pill.textContent = `RISK · ${status.toUpperCase()}`;
    pill.title = reason;
  }

  // ── 10. Cross-instrument correlation ribbon ──
  applyCorrelation(pairs: Array<{ a: string; b: string; correlation: number }>): void {
    const ribbon = this.ensureCorrelationRibbon();
    if (pairs.length === 0) { ribbon.style.display = 'none'; return; }
    ribbon.style.display = 'flex';
    ribbon.innerHTML = pairs.map((p) => {
      const broken = Math.abs(p.correlation) < 0.3;
      const color = broken ? '#ffd740' : p.correlation > 0 ? '#26a69a' : '#ef5350';
      return `<div style="padding: 2px 8px; font-size: 10px; color: ${color}; border-right: 1px solid rgba(255,255,255,0.06);">
        ${p.a}↔${p.b}: ${p.correlation.toFixed(2)}${broken ? ' ⚠' : ''}
      </div>`;
    }).join('');
  }

  // ── DOM scaffolding ──
  private ensurePanels(): void {
    if (document.getElementById('ai-regime-tag')) return;
    const tag = document.createElement('div');
    tag.id = 'ai-regime-tag';
    tag.style.cssText = 'position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 110; padding: 3px 10px; font-size: 10px; letter-spacing: 1px; color: rgba(255,255,255,0.5); background: rgba(19,23,34,0.7); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px;';
    this.container.appendChild(tag);
  }

  private ensureNarrativeBar(): HTMLElement {
    let el = document.getElementById('ai-narrative-hud');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ai-narrative-hud';
    el.className = 'chart-floating-widget';
    el.style.cssText = `
      position: absolute; bottom: 40px; right: 12px;
      width: 280px; min-height: 80px;
      padding: 0;
      font-size: 11px;
      font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
      background: rgba(13,17,25,0.85);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(124,77,255,0.2);
      border-top: 2px solid #7c4dff;
      border-radius: 4px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      z-index: 105;
      display: none;
      overflow: hidden;
      color: #e0e0e0;
      transition: border-color 0.3s;
    `;
    
    el.innerHTML = `
      <div style="background: rgba(124,77,255,0.1); padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 800; font-size: 9px; color: #7c4dff; letter-spacing: 1px;">AI NARRATIVE LOG</span>
        <span id="ai-hud-status" style="font-size: 8px; color: #00e676; opacity: 0.8;">[LIVE]</span>
      </div>
      <div id="ai-hud-body" style="padding: 10px; line-height: 1.5; min-height: 40px;"></div>
      <div style="height: 2px; background: repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(124,77,255,0.3) 2px, rgba(124,77,255,0.3) 4px); opacity: 0.5;"></div>
    `;

    this.container.appendChild(el);
    makeDraggable(el, 'ai-narrative-hud');
    return el;
  }

  private ensureOiMatrix(): HTMLElement {
    let el = document.getElementById('ai-oi-matrix');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ai-oi-matrix';
    el.className = 'chart-floating-widget';
    el.style.cssText = `
      position: absolute; right: 200px; top: 60px;
      padding: 8px 12px; min-width: 140px;
      background: rgba(19,23,34,0.95);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px;
      z-index: 100;
    `;
    this.container.appendChild(el);
    makeDraggable(el, 'ai-oi-matrix');
    return el;
  }

  private ensureToxicityPanel(): HTMLElement {
    let el = document.getElementById('ai-toxicity-panel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ai-toxicity-panel';
    el.className = 'chart-floating-widget';
    el.style.cssText = `
      position: absolute; right: 200px; top: 160px;
      padding: 8px 12px; min-width: 110px;
      background: rgba(19,23,34,0.95);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px;
      z-index: 100;
    `;
    this.container.appendChild(el);
    makeDraggable(el, 'ai-toxicity-panel');
    return el;
  }

  private ensureEchoBadge(): HTMLElement {
    let el = document.getElementById('ai-echo-badge');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ai-echo-badge';
    el.className = 'chart-floating-widget';
    el.style.cssText = `
      position: absolute; right: 200px; top: 240px;
      padding: 6px 10px;
      background: rgba(19,23,34,0.95);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px;
      z-index: 100;
      display: none;
    `;
    this.container.appendChild(el);
    makeDraggable(el, 'ai-echo-badge');
    return el;
  }

  private ensureConfluencePanel(): HTMLElement {
    let el = document.getElementById('ai-confluence-panel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ai-confluence-panel';
    el.className = 'chart-floating-widget';
    el.style.cssText = `
      position: absolute; right: 200px; top: 300px;
      padding: 6px 10px;
      background: rgba(19,23,34,0.95);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px;
      z-index: 100;
      display: none;
    `;
    this.container.appendChild(el);
    makeDraggable(el, 'ai-confluence-panel');
    return el;
  }

  private ensureRiskPill(): HTMLElement {
    let el = document.getElementById('ai-risk-pill');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ai-risk-pill';
    el.className = 'chart-floating-widget';
    el.style.cssText = `
      position: absolute; top: 12px; right: 16px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 1px;
      border: 1px solid #26a69a;
      border-radius: 12px;
      z-index: 110;
      cursor: help;
    `;
    el.textContent = 'RISK · ALL CLEAR';
    this.container.appendChild(el);
    makeDraggable(el, 'ai-risk-pill');
    return el;
  }

  private ensureDivPanel(): HTMLElement {
    let el = document.getElementById('ai-divergence-panel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ai-divergence-panel';
    el.className = 'chart-floating-widget';
    el.style.cssText = `
      position: absolute; right: 200px; top: 380px;
      padding: 8px;
      width: 160px;
      background: rgba(19,23,34,0.95);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px;
      z-index: 100;
      display: none;
    `;
    this.container.appendChild(el);
    makeDraggable(el, 'ai-divergence-panel');
    return el;
  }

  private ensureCorrelationRibbon(): HTMLElement {
    let el = document.getElementById('ai-correlation-ribbon');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ai-correlation-ribbon';
    el.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0;
      display: none;
      background: rgba(19,23,34,0.92);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      z-index: 105;
    `;
    this.container.appendChild(el);
    return el;
  }

  // ── Trade plan card ──
  private showTradeCard(setup: TradeSetup): void {
    let card = document.getElementById('ai-trade-card');
    if (!card) {
      card = document.createElement('div');
      card.id = 'ai-trade-card';
      card.style.cssText = `
        position: absolute; left: 50%; top: 80px;
        transform: translateX(-50%);
        width: 280px;
        background: rgba(19,23,34,0.97);
        border: 1px solid rgba(124, 77, 255, 0.4);
        border-radius: 6px;
        padding: 14px;
        z-index: 120;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        cursor: move;
      `;
      this.container.appendChild(card);
      makeDraggable(card, 'ai-trade-card');
    }
    const dirColor = setup.direction === 'long' ? '#26a69a' : '#ef5350';
    const dirArrow = setup.direction === 'long' ? '▲' : '▼';
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="color: ${dirColor}; font-weight: bold;">AI SETUP · ${dirArrow} ${setup.direction.toUpperCase()}</div>
        <button id="ai-trade-close" style="background: none; border: 0; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 16px;">×</button>
      </div>
      <div style="display: flex; gap: 10px; font-size: 11px; margin-bottom: 10px;">
        <div>Conf: <strong>${(setup.confidence * 100).toFixed(0)}%</strong></div>
        <div>R:R <strong>1:${setup.riskReward.toFixed(1)}</strong></div>
        <div>Size <strong>${setup.positionSizePct.toFixed(1)}%</strong></div>
      </div>
      <div style="font-size: 11px; line-height: 1.6; margin-bottom: 10px;">
        <div>Entry: <span style="color: #2196f3;">${setup.entry.toFixed(2)}</span></div>
        <div>Stop: <span style="color: #ef5350;">${setup.stop.toFixed(2)}</span></div>
        <div>Target: <span style="color: #26a69a;">${setup.target.toFixed(2)}</span></div>
      </div>
      <div style="font-size: 10px; color: rgba(255,255,255,0.7); padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08);">
        ${escapeHtml(setup.rationale)}
      </div>
      <div style="font-size: 10px; color: #ef5350; margin-top: 6px;">
        ⊗ ${escapeHtml(setup.invalidation)}
      </div>
    `;
    card.style.display = 'block';
    document.getElementById('ai-trade-close')?.addEventListener('click', () => this.hideTradeCard());
  }

  private hideTradeCard(): void {
    const card = document.getElementById('ai-trade-card');
    if (card) card.style.display = 'none';
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function makeDraggable(el: HTMLElement, storageKey: string): void {
  el.style.cursor = 'move';
  el.style.userSelect = 'none';

  // Restore saved position.
  try {
    const saved = localStorage.getItem(`chart-widget-pos:${storageKey}`);
    if (saved) {
      const { left, top } = JSON.parse(saved) as { left: number; top: number };
      if (Number.isFinite(left) && Number.isFinite(top)) {
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.transform = 'none';
      }
    }
  } catch { /* ignore */ }

  let dragging = false;
  let offX = 0, offY = 0;
  
  el.addEventListener('pointerdown', (e: PointerEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    dragging = true;
    const rect = el.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;
    el.setPointerCapture(e.pointerId);
    el.style.zIndex = '200';
    el.style.cursor = 'grabbing';
  });

  el.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    const parent = el.parentElement?.getBoundingClientRect();
    const px = parent?.left ?? 0;
    const py = parent?.top ?? 0;
    el.style.left = `${e.clientX - px - offX}px`;
    el.style.top = `${e.clientY - py - offY}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
  });

  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    el.style.zIndex = '120';
    el.style.cursor = 'move';
    try {
      localStorage.setItem(`chart-widget-pos:${storageKey}`, JSON.stringify({
        left: parseFloat(el.style.left || '0'),
        top: parseFloat(el.style.top || '0'),
      }));
    } catch { /* ignore */ }
  };

  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}
