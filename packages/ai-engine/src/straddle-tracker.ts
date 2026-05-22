export interface StraddlePosition {
  id: string;
  underlying: string;
  strike: number;
  callEntryPrice: number;
  putEntryPrice: number;
  callLTP: number;
  putLTP: number;
  qty: number; // positive for long straddle, negative for short
  entryTheta: number; // combined theta at entry
  entryTime: number; // timestamp
  dte: number;
}

export interface StraddleMetrics {
  id: string;
  pnl: number;
  breakevenUpper: number;
  breakevenLower: number;
  thetaBurnRate: number; // ₹ per day elapsed
  distanceToBreakevenPct: number;
  ivCrushRisk: number; // estimated ₹ change if IV drops 20% post-event
}

export class StraddleTracker {
  private straddles = new Map<string, StraddlePosition>();

  track(position: StraddlePosition) {
    this.straddles.set(position.id, position);
  }

  updateLTP(id: string, callLtp: number, putLtp: number) {
    const pos = this.straddles.get(id);
    if (pos) {
      pos.callLTP = callLtp;
      pos.putLTP = putLtp;
    }
  }

  getMetrics(spotPrice: number): StraddleMetrics[] {
    const metrics: StraddleMetrics[] = [];
    
    for (const pos of this.straddles.values()) {
      const entryPremium = pos.callEntryPrice + pos.putEntryPrice;
      const currentPremium = pos.callLTP + pos.putLTP;
      
      const breakevenUpper = pos.strike + entryPremium;
      const breakevenLower = pos.strike - entryPremium;

      // PnL calculation depending on long/short
      const pnl = pos.qty > 0 
        ? (currentPremium - entryPremium) * pos.qty
        : (entryPremium - currentPremium) * Math.abs(pos.qty);

      // Distance to breakeven
      const distUpper = Math.abs(breakevenUpper - spotPrice) / spotPrice;
      const distLower = Math.abs(spotPrice - breakevenLower) / spotPrice;
      const distanceToBreakevenPct = Math.min(distUpper, distLower) * 100;

      // Burn rate (for short straddles, theta works in your favor)
      const daysElapsed = Math.max(0.01, (Date.now() - pos.entryTime) / (1000 * 60 * 60 * 24));
      const thetaBurnRate = pos.entryTheta * daysElapsed * pos.qty;

      // IV Crush Risk: simplified as Vega impact if IV drops 5 absolute percentage points
      // Assume approx combined Vega = premium * 0.1 for back-of-the-envelope demo
      const combinedVegaApprox = currentPremium * 0.1;
      const ivCrushRisk = combinedVegaApprox * -5 * pos.qty; // if IV drops 5%

      metrics.push({
        id: pos.id,
        pnl,
        breakevenUpper,
        breakevenLower,
        thetaBurnRate,
        distanceToBreakevenPct,
        ivCrushRisk
      });
    }

    return metrics;
  }
}
