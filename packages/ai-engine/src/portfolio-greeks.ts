export interface GreekPosition {
  symbol: string;
  qty: number;      // positive for long, negative for short
  lotSize: number;
  delta: number;    // per unit
  gamma: number;    // per unit
  vega: number;     // per unit (for 1% IV move)
  theta: number;    // per unit (daily)
  pnl: number;      // real-time P&L
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

export class PortfolioGreeksEngine {
  /**
   * Aggregate Greeks across all positions.
   * If absolute Portfolio Delta > threshold, suggest an ATM hedge.
   */
  aggregate(positions: GreekPosition[], spotPrice: number, thresholdDelta = 50): PortfolioGreeksResult {
    let totalDelta = 0;
    let totalGamma = 0;
    let totalVega = 0;
    let totalTheta = 0;
    let totalPnL = 0;

    for (const pos of positions) {
      const units = pos.qty; // lot size is usually already multiplied or we assume qty is total shares
      totalDelta += pos.delta * units;
      totalGamma += pos.gamma * units;
      totalVega += pos.vega * units;
      totalTheta += pos.theta * units;
      totalPnL += pos.pnl;
    }

    let deltaNeutralSuggestion: PortfolioGreeksResult['deltaNeutralSuggestion'];

    // If portfolio delta is heavily skewed, suggest a hedge.
    // For simplicity, we suggest trading the underlying (delta = 1 per share).
    if (Math.abs(totalDelta) > thresholdDelta) {
      const hedgeQty = Math.round(-totalDelta);
      deltaNeutralSuggestion = {
        action: hedgeQty > 0 ? 'BUY' : 'SELL',
        instrument: 'UNDERLYING', // In a real system, resolve ATM strike or future
        qty: Math.abs(hedgeQty),
      };
    }

    return {
      totalDelta,
      totalGamma,
      totalVega,
      totalTheta,
      totalPnL,
      deltaNeutralSuggestion,
    };
  }
}
