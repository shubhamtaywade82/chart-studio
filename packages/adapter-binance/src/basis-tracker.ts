export interface BasisMetrics {
  symbol: string;
  spotPrice: number;
  perpPrice: number;
  basisPct: number;
  timestamp: number;
}

export class BasisTracker {
  // Simple in-memory tracker for Binance Spot vs Binance USD-M
  private spotPrices = new Map<string, number>();
  private perpPrices = new Map<string, number>();

  updateSpotPrice(symbol: string, price: number) {
    this.spotPrices.set(symbol.toUpperCase(), price);
  }

  updatePerpPrice(symbol: string, price: number) {
    this.perpPrices.set(symbol.toUpperCase(), price);
  }

  getBasis(symbol: string): BasisMetrics | null {
    const sym = symbol.toUpperCase();
    const spot = this.spotPrices.get(sym);
    const perp = this.perpPrices.get(sym);

    if (spot && perp && spot > 0) {
      return {
        symbol: sym,
        spotPrice: spot,
        perpPrice: perp,
        basisPct: ((perp - spot) / spot) * 100,
        timestamp: Date.now()
      };
    }
    return null;
  }
}
