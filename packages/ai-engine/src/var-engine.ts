// No imports needed for independent simulation demo

export interface VarPosition {
  symbol: string;
  qty: number;
  ltp: number;
  volatility: number; // annualized daily volatility
}

export interface VarResult {
  var95: number;
  var99: number;
  cvar95: number; // Expected Shortfall
  simulations: number;
}

export class VarEngine {
  /**
   * Generate normally distributed random numbers using Box-Muller transform
   */
  private randn_bm(): number {
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /**
   * Simple Monte Carlo VaR (1-day).
   * For independent assets (ignoring correlation for simplicity if matrix missing, or assuming perfectly correlated in worst case).
   * Note: A true Cholesky decomposition of a correlation matrix would multiply the random normal vector Z by L.
   */
  calculate(positions: VarPosition[], numSimulations = 10000): VarResult {
    if (positions.length === 0) {
      return { var95: 0, var99: 0, cvar95: 0, simulations: numSimulations };
    }

    const portfolioValues: number[] = new Array(numSimulations);
    const initialPortfolioValue = positions.reduce((acc, p) => acc + p.qty * p.ltp, 0);

    // 1-day drift assumed to be 0 for daily VaR
    const dt = 1 / 252; // 1 trading day

    for (let i = 0; i < numSimulations; i++) {
      let simValue = 0;
      // Note: Full Cholesky requires a correlation matrix. For performance & demo we simulate independent GBM.
      // In production, `getCorrelationMatrix(symbols)` would yield Sigma, we'd decompose to L, 
      // and vector Z_correlated = L * Z_independent.
      
      for (const pos of positions) {
        const z = this.randn_bm();
        // Geometric Brownian Motion step
        const simulatedPrice = pos.ltp * Math.exp((-0.5 * pos.volatility * pos.volatility) * dt + pos.volatility * Math.sqrt(dt) * z);
        simValue += pos.qty * simulatedPrice;
      }
      portfolioValues[i] = simValue;
    }

    // Sort simulated portfolio values to find percentiles
    portfolioValues.sort((a, b) => a - b);

    // Losses are Initial - Simulated. We sort portfolio values ascending, so lowest values are biggest losses.
    // Index for 95% confidence (5th percentile)
    const idx95 = Math.floor(numSimulations * 0.05);
    // Index for 99% confidence (1st percentile)
    const idx99 = Math.floor(numSimulations * 0.01);

    const var95 = initialPortfolioValue - portfolioValues[idx95]!;
    const var99 = initialPortfolioValue - portfolioValues[idx99]!;

    // Expected Shortfall (CVaR) at 95%: Average of all losses worse than VaR95
    let cvarSum = 0;
    for (let i = 0; i < idx95; i++) {
      cvarSum += (initialPortfolioValue - portfolioValues[i]!);
    }
    const cvar95 = cvarSum / idx95;

    return {
      var95: Math.max(0, var95),
      var99: Math.max(0, var99),
      cvar95: Math.max(0, cvar95),
      simulations: numSimulations,
    };
  }
}
