import axios from 'axios';
import type { BinanceConfig } from './rest';
import { restBaseFor } from './rest';

export interface OIData {
  symbol: string;
  openInterest: number;
  openInterestUsd: number;
  timestamp: number;
}

export interface LongShortRatio {
  symbol: string;
  longShortRatio: number;
  longAccount: number; // percentage
  shortAccount: number; // percentage
  timestamp: number;
}

export class OIDeltaTracker {
  constructor(private readonly cfg: BinanceConfig) {}

  async getOpenInterest(symbol: string): Promise<OIData | null> {
    if (this.cfg.product === 'spot') return null;

    const url = `${restBaseFor(this.cfg)}/fapi/v1/openInterest`;
    try {
      const { data } = await axios.get(url, {
        params: { symbol: symbol.toUpperCase() },
        timeout: 5000,
      });

      // To get accurate USD notional, we need the mark price or latest price.
      // But we can just store the raw coin OI here, and the dashboard will multiply by price.
      return {
        symbol: data.symbol,
        openInterest: Number(data.openInterest),
        openInterestUsd: 0, // Will be computed by the client
        timestamp: Number(data.time),
      };
    } catch (e) {
      return null;
    }
  }

  async getLongShortRatio(symbol: string, period: string = '1h'): Promise<LongShortRatio | null> {
    if (this.cfg.product === 'spot') return null;

    const url = `${restBaseFor(this.cfg)}/futures/data/globalLongShortAccountRatio`;
    try {
      const { data } = await axios.get(url, {
        params: { symbol: symbol.toUpperCase(), period, limit: 1 },
        timeout: 5000,
      });

      if (!data || data.length === 0) return null;
      
      const latest = data[0];
      return {
        symbol: latest.symbol,
        longShortRatio: Number(latest.longShortRatio),
        longAccount: Number(latest.longAccount),
        shortAccount: Number(latest.shortAccount),
        timestamp: Number(latest.timestamp)
      };
    } catch (e) {
      return null;
    }
  }
}
