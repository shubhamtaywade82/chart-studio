import type { AxiosInstance } from 'axios';
import type { DhanInstrument } from './instruments';

/**
 * NSE Option Chain response from Dhan v2.
 */
export interface DhanOptionChainItem {
  strikePrice: number;
  callOI: number;
  callOIChange: number;
  callVolume: number;
  callLTP: number;
  callIV: number;
  putOI: number;
  putOIChange: number;
  putVolume: number;
  putLTP: number;
  putIV: number;
}

export interface OptionChainData {
  underlying: string;
  timestamp: number;
  strikes: DhanOptionChainItem[];
  maxPain: number;
  supportOI: number;
  resistanceOI: number;
}

/**
 * Fetch live NSE option chain from DhanHQ v2.
 */
export const fetchOptionChain = async (
  client: AxiosInstance,
  ins: DhanInstrument,
): Promise<DhanOptionChainItem[]> => {
  // Dhan API: GET /v2/marketfeed/option-chain
  // Body: { "underlyingSecurityId": "...", "underlyingExchangeSegment": "..." }
  const { data } = await client.post('/v2/marketfeed/option-chain', {
    underlyingSecurityId: ins.securityId,
    underlyingExchangeSegment: ins.exchangeSegment,
  });
  
  // The API typically returns a list of strike-level details.
  // Note: Actual structure needs verification against live API, but following ROADMAP.md spec.
  return data?.data || [];
};

/**
 * Black-Scholes Greeks Engine (European Options).
 * NSE options are European-style (CE/PE).
 */
export class GreeksEngine {
  private readonly r = 0.065; // Risk-free rate (RBI repo approx)

  /**
   * Cumulative standard normal distribution N(x).
   */
  private N(x: number): number {
    const a1 = 0.319381530;
    const a2 = -0.356563782;
    const a3 = 1.781477937;
    const a4 = -1.821255978;
    const a5 = 1.330274429;
    const L = Math.abs(x);
    const K = 1.0 / (1.0 + 0.2316419 * L);
    let w = 1.0 - 1.0 / Math.sqrt(2 * Math.PI) * Math.exp(-L * L / 2) * (a1 * K + a2 * K * K + a3 * Math.pow(K, 3) + a4 * Math.pow(K, 4) + a5 * Math.pow(K, 5));
    if (x < 0) w = 1.0 - w;
    return w;
  }

  /**
   * Probability density function of standard normal N'(x).
   */
  private n_prime(x: number): number {
    return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
  }

  calculate(S: number, K: number, T: number, sigma: number, isCall: boolean) {
    if (T <= 0 || sigma <= 0) return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
    
    const d1 = (Math.log(S / K) + (this.r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);

    const delta = isCall ? this.N(d1) : this.N(d1) - 1;
    const gamma = this.n_prime(d1) / (S * sigma * Math.sqrt(T));
    const vega = (S * this.n_prime(d1) * Math.sqrt(T)) / 100; // per 1% IV move
    
    const theta1 = -(S * sigma * this.n_prime(d1)) / (2 * Math.sqrt(T));
    const theta2 = this.r * K * Math.exp(-this.r * T);
    let theta = isCall 
      ? (theta1 - theta2 * this.N(d2)) 
      : (theta1 + theta2 * this.N(-d2));
    theta = theta / 365; // per calendar day

    const rho = (K * T * Math.exp(-this.r * T) * (isCall ? this.N(d2) : -this.N(-d2))) / 100;

    return { delta, gamma, theta, vega, rho };
  }
}

/**
 * Calculate Max Pain for the given option chain.
 * Max Pain = argmin_K [ Σ_i max(0, K - K_i)·CallOI_i + Σ_i max(0, K_i - K)·PutOI_i ]
 */
export const calculateMaxPain = (items: DhanOptionChainItem[]): number => {
  if (items.length === 0) return 0;
  
  const strikes = items.map(i => i.strikePrice);
  let minLoss = Infinity;
  let maxPainStrike = strikes[0] ?? 0;

  for (const k of strikes) {
    let totalLoss = 0;
    for (const item of items) {
      // Call loss: if strike K > item strike Ki, call holders of Ki lose (K - Ki)
      if (k > item.strikePrice) {
        totalLoss += (k - item.strikePrice) * item.callOI;
      }
      // Put loss: if strike K < item strike Ki, put holders of Ki lose (Ki - K)
      if (k < item.strikePrice) {
        totalLoss += (item.strikePrice - k) * item.putOI;
      }
    }
    
    if (totalLoss < minLoss) {
      minLoss = totalLoss;
      maxPainStrike = k;
    }
  }

  return maxPainStrike;
};
