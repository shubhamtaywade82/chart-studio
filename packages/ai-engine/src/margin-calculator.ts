import type { AxiosInstance } from 'axios';
import { EventEmitter } from 'events';

export interface PositionInfo {
  symbol: string;
  exchangeSegment: string;
  qty: number;
  lotSize: number;
  ltp: number;
  isOption: boolean;
  strike?: number;
  optionType?: 'CE' | 'PE';
  impliedVol?: number;
  historicalVol?: number;
}

export interface MarginResult {
  used: number;
  available: number;
  span: number;
  exposure: number;
  totalInitial: number;
  maintenance: number;
  isFallback: boolean;
}

export class MarginCalculator extends EventEmitter {
  private availableCash = 0;
  private lastUpdate = 0;

  constructor(private client: AxiosInstance | null = null) {
    super();
  }

  /**
   * Fetches funds and margins. If API fails, falls back to internal SPAN approximation.
   */
  async calculate(positions: PositionInfo[]): Promise<MarginResult> {
    const now = Date.now();
    // Cache funds for 30s
    if (this.client && now - this.lastUpdate > 30000) {
      try {
        const { data } = await this.client.get('/v2/funds');
        if (data?.data?.availableBalance) {
          this.availableCash = data.data.availableBalance;
        }
        this.lastUpdate = now;
      } catch (err) {
        console.warn('[MarginCalculator] Failed to fetch funds, using cached', err);
      }
    }

    let result: MarginResult | null = null;
    if (this.client && positions.length > 0) {
      try {
        // Try live SPAN margin calculator
        const reqPayload = {
          exchangeSegment: positions[0]!.exchangeSegment, // Assuming single segment for demo
          positions: positions.map(p => ({
            securityId: p.symbol,
            quantity: p.qty,
            exchangeSegment: p.exchangeSegment,
          }))
        };
        const { data } = await this.client.post('/v2/margin-calculator', reqPayload);
        if (data?.data) {
          result = {
            used: data.data.totalMargin || 0,
            available: this.availableCash,
            span: data.data.spanMargin || 0,
            exposure: data.data.exposureMargin || 0,
            totalInitial: data.data.totalMargin || 0,
            maintenance: (data.data.totalMargin || 0) * 0.75,
            isFallback: false,
          };
        }
      } catch (err) {
        console.warn('[MarginCalculator] Live SPAN failed, falling back to approximation');
      }
    }

    if (!result) {
      result = this.approximateMargin(positions);
      result.available = this.availableCash;
    }

    // Emit warning if utilization > 80%
    if (result.available > 0) {
      const utilization = result.used / (result.available + result.used);
      if (utilization > 0.8) {
        this.emit('margin_warning', { utilization, result });
      }
    }

    return result;
  }

  private approximateMargin(positions: PositionInfo[]): MarginResult {
    let totalSpan = 0;
    let totalExposure = 0;

    for (const pos of positions) {
      const contractValue = Math.abs(pos.qty * pos.ltp);
      const exposure = contractValue * 0.015; // 1.5% exposure margin
      totalExposure += exposure;

      const vol = pos.impliedVol || pos.historicalVol || 0.2; // default 20%
      const priceMove = pos.ltp * (vol / Math.sqrt(252)) * 3; // 3-sigma 1-day move
      
      // 16 scenarios: Price +-3sigma (4 steps), Vol +-25% (4 steps).
      // For simple approximation, we just take the worst case max loss.
      // If it's a naked short option or future, loss is huge. If long option, max loss is premium.
      let worstLoss = 0;
      if (pos.isOption) {
        if (pos.qty > 0) {
          // Long option: max loss is the premium paid
          worstLoss = contractValue;
        } else {
          // Short option: worst loss is highly nonlinear, approx delta + gamma + vega impact.
          // Simplification: take max intrinsic value across price scenarios.
          const upMove = pos.ltp + priceMove;
          const downMove = Math.max(0, pos.ltp - priceMove);
          
          if (pos.optionType === 'CE') {
             // Short Call worst case is price goes UP
             const loss = Math.max(0, upMove - (pos.strike || pos.ltp)) * Math.abs(pos.qty);
             worstLoss = Math.max(contractValue, loss);
          } else {
             // Short Put worst case is price goes DOWN
             const loss = Math.max(0, (pos.strike || pos.ltp) - downMove) * Math.abs(pos.qty);
             worstLoss = Math.max(contractValue, loss);
          }
        }
      } else {
        // Futures / Equity worst case
        worstLoss = Math.abs(pos.qty) * priceMove;
      }
      totalSpan += worstLoss;
    }

    const totalInitial = totalSpan + totalExposure;
    return {
      used: totalInitial,
      available: this.availableCash,
      span: totalSpan,
      exposure: totalExposure,
      totalInitial,
      maintenance: totalInitial * 0.75,
      isFallback: true,
    };
  }
}
