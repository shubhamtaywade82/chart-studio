export interface OptionChainStrike {
  strike: number;
  callIV: number;
  putIV: number;
  callDelta: number;
  putDelta: number;
}

export interface IVSurfacePoint {
  delta: number; // Normalized -50 to 50 (e.g. Call Delta 25 -> 25, Put Delta -25 -> -25)
  strike: number;
  impliedVol: number;
}

export class IVSurfaceEngine {
  /**
   * Builds an IV smile profile from an option chain.
   * Maps strike IVs to Delta-normalized axes (e.g., 10D, 25D, ATM, -25D, -10D).
   */
  buildSmile(chain: OptionChainStrike[], spotPrice: number): IVSurfacePoint[] {
    const points: IVSurfacePoint[] = [];

    for (const item of chain) {
      if (item.callIV > 0 && item.callDelta > 0 && item.callDelta < 1) {
        points.push({ delta: item.callDelta * 100, strike: item.strike, impliedVol: item.callIV });
      }
      if (item.putIV > 0 && item.putDelta > -1 && item.putDelta < 0) {
        // Put delta is negative, we map it to -100 to 0
        points.push({ delta: item.putDelta * 100, strike: item.strike, impliedVol: item.putIV });
      }
    }

    // Sort by delta
    points.sort((a, b) => a.delta - b.delta);
    return points;
  }

  /**
   * Calculates the steepness of the skew
   * Skew = (25D Put IV - 25D Call IV) / ATM IV
   */
  calculateSkewSteepness(smile: IVSurfacePoint[], atmIV: number): number {
    if (atmIV === 0 || smile.length === 0) return 0;
    
    // Find closest to 25D Call (delta = 25)
    const call25 = smile.reduce((prev, curr) => Math.abs(curr.delta - 25) < Math.abs(prev.delta - 25) ? curr : prev);
    // Find closest to 25D Put (delta = -25)
    const put25 = smile.reduce((prev, curr) => Math.abs(curr.delta + 25) < Math.abs(prev.delta + 25) ? curr : prev);

    return (put25.impliedVol - call25.impliedVol) / atmIV;
  }
}
