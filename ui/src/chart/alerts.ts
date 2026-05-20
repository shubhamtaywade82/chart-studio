export interface Alert {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'critical';
  timestamp: number;
}

export class AlertSystem {
  private alerts: Alert[] = [];
  private listeners = new Set<(alerts: Alert[]) => void>();
  private alertDedupe = new Map<string, number>(); // deduplicate within 5s windows
  private prevLtp = 0;
  private prevAtp = 0;
  private prevOi = 0;
  private prevDepthTotal = 0;
  private prevBuyPressure = 0.5;
  private prevTradesPerSec = 0;
  private lastAlertTime = new Map<string, number>();

  onAlertsChange(fn: (alerts: Alert[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  check(data: {
    ltp: number;
    atp: number;
    oi: number | undefined;
    dayHigh: number;
    dayLow: number;
    volume: number;
    totalBuyQty: number;
    totalSellQty: number;
    bidOrders: number[] | undefined;
    askOrders: number[] | undefined;
    ltt: number;
    ltq: number;
    expectedVolume: number;
  }): void {
    const now = Date.now();

    // Alert: ATP Cross
    if (this.prevLtp < data.atp && data.ltp > data.atp && this.shouldAlert('atp-cross', now)) {
      this.addAlert('Price crossed above ATP — bullish', 'info');
    }
    if (this.prevLtp > data.atp && data.ltp < data.atp && this.shouldAlert('atp-cross-down', now)) {
      this.addAlert('Price crossed below ATP — bearish', 'info');
    }

    // Alert: OI Spike
    if (data.oi && this.prevOi > 0) {
      const oiChange = data.oi - this.prevOi;
      if (oiChange > 50000 && this.shouldAlert('oi-spike', now)) {
        this.addAlert(`OI spike +${(oiChange / 1000).toFixed(0)}K — new position`, 'warning');
      }
    }

    // Alert: Depth Evaporation
    const currDepth = (data.bidOrders?.reduce((a, b) => a + b, 0) ?? 0) + (data.askOrders?.reduce((a, b) => a + b, 0) ?? 0);
    if (this.prevDepthTotal > 0 && currDepth < this.prevDepthTotal * 0.5 && this.shouldAlert('depth-evap', now)) {
      this.addAlert('Liquidity evaporating — spread incoming', 'critical');
    }

    // Alert: Day High/Low Touch
    if (data.ltp >= data.dayHigh && this.prevLtp < data.dayHigh && this.shouldAlert('day-high', now)) {
      this.addAlert('Day high break — momentum', 'warning');
    }
    if (data.ltp <= data.dayLow && this.prevLtp > data.dayLow && this.shouldAlert('day-low', now)) {
      this.addAlert('Day low test — support holding?', 'warning');
    }

    // Alert: Volume Anomaly
    if (data.volume > data.expectedVolume * 2 && this.shouldAlert('vol-anom', now)) {
      this.addAlert('2x volume pace — event-driven', 'warning');
    }

    // Alert: Liquidity Flip (buy/sell pressure reversal)
    const buyPressure = data.totalBuyQty / (data.totalBuyQty + data.totalSellQty || 1);
    if ((this.prevBuyPressure > 0.7 && buyPressure < 0.3) || (this.prevBuyPressure < 0.3 && buyPressure > 0.7)) {
      if (this.shouldAlert('liquidity-flip', now)) {
        this.addAlert('Liquidity flip detected — pressure reversal', 'critical');
      }
    }

    // Alert: High Trade Rate
    const tradesPerSec = data.ltq > 0 ? 1 : 0; // Rough estimate; in real usage, track tick rate
    if (tradesPerSec > 50 && this.prevTradesPerSec <= 50 && this.shouldAlert('hf-mode', now)) {
      this.addAlert('High frequency mode — widen stops', 'info');
    }
    if (tradesPerSec < 2 && this.prevTradesPerSec >= 2 && this.shouldAlert('frozen', now)) {
      this.addAlert('Market frozen — avoid market orders', 'info');
    }

    this.prevLtp = data.ltp;
    this.prevAtp = data.atp;
    this.prevOi = data.oi ?? 0;
    this.prevDepthTotal = currDepth;
    this.prevBuyPressure = buyPressure;
    this.prevTradesPerSec = tradesPerSec;
  }

  private shouldAlert(key: string, now: number): boolean {
    const last = this.lastAlertTime.get(key) ?? 0;
    if (now - last < 5000) return false;
    this.lastAlertTime.set(key, now);
    return true;
  }

  private addAlert(message: string, type: Alert['type']): void {
    const id = `${type}-${Date.now()}-${Math.random()}`;
    const alert: Alert = { id, message, type, timestamp: Date.now() };
    this.alerts.unshift(alert);
    if (this.alerts.length > 20) this.alerts.pop();
    for (const fn of this.listeners) fn(this.alerts);
    setTimeout(() => {
      this.alerts = this.alerts.filter((a) => a.id !== id);
      for (const fn of this.listeners) fn(this.alerts);
    }, 8000);
  }
}
