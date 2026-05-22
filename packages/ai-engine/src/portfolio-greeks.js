"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PortfolioGreeksEngine = void 0;
class PortfolioGreeksEngine {
    /**
     * Aggregate Greeks across all positions.
     * If absolute Portfolio Delta > threshold, suggest an ATM hedge.
     */
    aggregate(positions, spotPrice, thresholdDelta = 50) {
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
        let deltaNeutralSuggestion;
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
exports.PortfolioGreeksEngine = PortfolioGreeksEngine;
//# sourceMappingURL=portfolio-greeks.js.map