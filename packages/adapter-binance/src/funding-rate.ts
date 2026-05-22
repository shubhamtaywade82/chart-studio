import axios from 'axios';
import type { BinanceConfig } from './rest';
import { restBaseFor } from './rest';

export interface FundingRateData {
  symbol: string;
  fundingRate: number; // e.g. 0.0001
  fundingRateAPR: number; // e.g. 0.1095 for 10.95%
  nextFundingTime: number; // timestamp
  markPrice: number;
  indexPrice: number;
}

export class FundingRateTracker {
  constructor(private readonly cfg: BinanceConfig) {}

  async getPremiumIndex(symbol: string): Promise<FundingRateData | null> {
    if (this.cfg.product === 'spot') return null; // No funding in spot
    
    const url = `${restBaseFor(this.cfg)}/fapi/v1/premiumIndex`;
    try {
      const { data } = await axios.get(url, {
        params: { symbol: symbol.toUpperCase() },
        timeout: 5000,
      });
      
      const fr = Number(data.lastFundingRate);
      const markPrice = Number(data.markPrice);
      const indexPrice = Number(data.indexPrice);
      
      return {
        symbol: data.symbol,
        fundingRate: fr,
        // Annualized APR = rate * 3 (8hr periods/day) * 365
        fundingRateAPR: fr * 3 * 365,
        nextFundingTime: Number(data.nextFundingTime),
        markPrice,
        indexPrice
      };
    } catch (e) {
      return null;
    }
  }
}
