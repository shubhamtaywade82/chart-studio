export interface Alert {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'critical';
  timestamp: number;
}

export interface AlertInput {
  ltp: number;
  atp: number;
  oi: number | undefined;
  dayHigh: number;
  dayLow: number;
  volume: number;
  /** Cumulative day totalBuyQty (raw from Dhan). */
  totalBuyQty: number;
  /** Cumulative day totalSellQty (raw from Dhan). */
  totalSellQty: number;
  /** Top-of-book bid/ask depth — sum of quantities, not order counts. */
  bidQtyTotal: number;
  askQtyTotal: number;
  /** Trades/sec from latency monitor (windowed). */
  tradesPerSec: number;
  /** Expected day-pace volume (from market open to now, extrapolated). */
  expectedVolume: number;
}

const generateAlertId = (): string => {
  return crypto.randomUUID();
};

export class AlertSystem {
  private alerts: Alert[] = [];
  private listeners = new Set<(alerts: Alert[]) => void>();
  private lastAlertTime = new Map<string, number>();

  // Tick state. None of these reset to zero blindly — we track init flags
  // so that the first tick after a symbol switch never fires a spurious alert.
  private init = false;
  private prevLtp = 0;
  private prevOi = 0;
  private prevDepthTotal = 0;
  private prevBuyPressure = 0.5;
  private prevTradesPerSec = 0;
  private prevBuyQty = 0;
  private prevSellQty = 0;

  /** Reset all tick-state. Call when symbol or interval changes. */
  reset(): void {
    this.init = false;
    this.prevLtp = 0;
    this.prevOi = 0;
    this.prevDepthTotal = 0;
    this.prevBuyPressure = 0.5;
    this.prevTradesPerSec = 0;
    this.prevBuyQty = 0;
    this.prevSellQty = 0;
    this.lastAlertTime.clear();
    this.alerts = [];
    for (const fn of this.listeners) fn(this.alerts);
  }

  onAlertsChange(fn: (alerts: Alert[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  check(data: AlertInput): void {
    const now = Date.now();

    // First tick: capture baselines without firing alerts.
    if (!this.init) {
      this.init = true;
      this.prevLtp = data.ltp;
      this.prevOi = data.oi ?? 0;
      this.prevDepthTotal = data.bidQtyTotal + data.askQtyTotal;
      this.prevBuyQty = data.totalBuyQty;
      this.prevSellQty = data.totalSellQty;
      return;
    }

    // ATP crosses
    if (data.atp > 0) {
      if (this.prevLtp < data.atp && data.ltp > data.atp && this.shouldAlert('atp-cross-up', now)) {
        this.addAlert('Price crossed above ATP — bullish', 'info');
      } else if (this.prevLtp > data.atp && data.ltp < data.atp && this.shouldAlert('atp-cross-down', now)) {
        this.addAlert('Price crossed below ATP — bearish', 'info');
      }
    }

    // OI spike: real change vs prev tick, not vs zero.
    if (data.oi !== undefined && this.prevOi > 0) {
      const oiChange = data.oi - this.prevOi;
      if (Math.abs(oiChange) > 50000 && this.shouldAlert('oi-spike', now)) {
        const dir = oiChange > 0 ? '+' : '-';
        this.addAlert(`OI ${dir}${Math.abs(oiChange / 1000).toFixed(0)}K — position change`, 'warning');
      }
    }

    // Depth evaporation: sum of QUANTITIES across all levels, not order counts.
    const currDepth = data.bidQtyTotal + data.askQtyTotal;
    if (this.prevDepthTotal > 0 && currDepth < this.prevDepthTotal * 0.5 && this.shouldAlert('depth-evap', now)) {
      this.addAlert('Liquidity evaporating — spread incoming', 'critical');
    }

    // Day high/low touches
    if (data.dayHigh > 0 && data.ltp >= data.dayHigh && this.prevLtp < data.dayHigh && this.shouldAlert('day-high', now)) {
      this.addAlert('Day high break — momentum', 'warning');
    }
    if (data.dayLow > 0 && data.ltp <= data.dayLow && this.prevLtp > data.dayLow && this.shouldAlert('day-low', now)) {
      this.addAlert('Day low test — support holding?', 'warning');
    }

    // Volume anomaly (caller must provide a correctly-extrapolated expectedVolume).
    if (data.expectedVolume > 0 && data.volume > data.expectedVolume * 2 && this.shouldAlert('vol-anom', now)) {
      this.addAlert('2x volume pace — event-driven', 'warning');
    }

    // Liquidity flip: use per-tick deltas (not cumulative totals).
    const buyDelta = Math.max(0, data.totalBuyQty - this.prevBuyQty);
    const sellDelta = Math.max(0, data.totalSellQty - this.prevSellQty);
    const tickFlow = buyDelta + sellDelta;
    if (tickFlow > 0) {
      const buyPressure = buyDelta / tickFlow;
      if (
        (this.prevBuyPressure > 0.7 && buyPressure < 0.3) ||
        (this.prevBuyPressure < 0.3 && buyPressure > 0.7)
      ) {
        if (this.shouldAlert('liquidity-flip', now)) {
          this.addAlert('Liquidity flip — buy/sell pressure reversed', 'critical');
        }
      }
      this.prevBuyPressure = buyPressure;
    }

    // Trade rate mode transitions (caller provides windowed tradesPerSec).
    if (data.tradesPerSec > 50 && this.prevTradesPerSec <= 50 && this.shouldAlert('hf-mode', now)) {
      this.addAlert('High frequency mode — widen stops', 'info');
    }
    if (data.tradesPerSec < 2 && this.prevTradesPerSec >= 2 && this.shouldAlert('frozen', now)) {
      this.addAlert('Market frozen — avoid market orders', 'info');
    }

    this.prevLtp = data.ltp;
    this.prevOi = data.oi ?? this.prevOi;
    this.prevDepthTotal = currDepth || this.prevDepthTotal;
    this.prevTradesPerSec = data.tradesPerSec;
    this.prevBuyQty = data.totalBuyQty;
    this.prevSellQty = data.totalSellQty;
  }

  private shouldAlert(key: string, now: number): boolean {
    const last = this.lastAlertTime.get(key) ?? 0;
    if (now - last < 5000) return false;
    this.lastAlertTime.set(key, now);
    return true;
  }

  private addAlert(message: string, type: Alert['type']): void {
    const id = genId();
    const alert: Alert = { id, message, type, timestamp: Date.now() };
    this.alerts.unshift(alert);
    if (this.alerts.length > 20) this.alerts.pop();
    for (const fn of this.listeners) fn(this.alerts);
    setTimeout(() => {
      const before = this.alerts.length;
      this.alerts = this.alerts.filter((a) => a.id !== id);
      if (this.alerts.length !== before) {
        for (const fn of this.listeners) fn(this.alerts);
      }
    }, 8000);
  }
}
