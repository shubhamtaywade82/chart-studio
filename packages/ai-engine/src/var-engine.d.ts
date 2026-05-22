export interface VarPosition {
    symbol: string;
    qty: number;
    ltp: number;
    volatility: number;
}
export interface VarResult {
    var95: number;
    var99: number;
    cvar95: number;
    simulations: number;
}
export declare class VarEngine {
    /**
     * Generate normally distributed random numbers using Box-Muller transform
     */
    private randn_bm;
    /**
     * Simple Monte Carlo VaR (1-day).
     * For independent assets (ignoring correlation for simplicity if matrix missing, or assuming perfectly correlated in worst case).
     * Note: A true Cholesky decomposition of a correlation matrix would multiply the random normal vector Z by L.
     */
    calculate(positions: VarPosition[], numSimulations?: number): VarResult;
}
