export interface GreekPosition {
    symbol: string;
    qty: number;
    lotSize: number;
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
    pnl: number;
}
export interface PortfolioGreeksResult {
    totalDelta: number;
    totalGamma: number;
    totalVega: number;
    totalTheta: number;
    totalPnL: number;
    deltaNeutralSuggestion?: {
        action: 'BUY' | 'SELL';
        instrument: string;
        qty: number;
    };
}
export declare class PortfolioGreeksEngine {
    /**
     * Aggregate Greeks across all positions.
     * If absolute Portfolio Delta > threshold, suggest an ATM hedge.
     */
    aggregate(positions: GreekPosition[], spotPrice: number, thresholdDelta?: number): PortfolioGreeksResult;
}
