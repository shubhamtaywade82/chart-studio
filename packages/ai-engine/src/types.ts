/**
 * Microstructure snapshot constructed from one Dhan Full packet plus
 * recent candles. The Reflex/Tactical/Strategic layers all consume this.
 */
export interface MicrostructureSnapshot {
  symbol: string;
  provider: string;
  timestamp: number;
  candles: Array<{
    openTime: number;
    open: number; high: number; low: number; close: number;
    volume: number;
  }>;
  tick: {
    ltp: number;
    atp: number;
    ltq: number;
    ltt: number;
    volume: number;
    totalBuyQty: number;
    totalSellQty: number;
    openInterest: number;
    dayOpen: number;
    dayHigh: number;
    dayLow: number;
    dayClose: number;
    prevClose: number;
    prevOi: number;
    bids: Array<{ price: number; qty: number; orders: number }>;
    asks: Array<{ price: number; qty: number; orders: number }>;
  };
  derived: {
    /** (ltp - atp) / atp */
    vwapDeviation: number;
    /** Per-tick delta accumulated: buyQty - sellQty (NOT raw cumulative) */
    cvd: number;
    /** oi - prevOi */
    oiChange: number;
    /** (bidQty - askQty) / (bidQty + askQty) at top of book, full 5 levels */
    depthImbalance: number;
    /** Ticks per second windowed over last 10s. */
    tradeIntensity: number;
    /** Realised volatility classification (last 20 candles range/median). */
    volatilityRegime: 'low' | 'normal' | 'high' | 'extreme';
    /** Toxicity (VPIN-style) 0..1 */
    toxicity: number;
  };
}

export type Urgency = 'none' | 'watch_only' | 'next_5min' | 'this_candle' | 'immediate' | 'critical';

export interface ReflexSignal {
  layer: 'reflex';
  type:
    | 'oi_trap'
    | 'liquidity_crisis'
    | 'atp_cross_up' | 'atp_cross_down'
    | 'day_break_up' | 'day_break_down'
    | 'cvd_divergence'
    | 'toxicity_spike'
    | 'neutral';
  urgency: Urgency;
  confidence: number;
  narrative: string;
  ts: number;
}

export interface AILevel {
  price: number;
  type: 'support' | 'resistance' | 'poc' | 'invalidation';
  confidence: number;
  rationale: string;
}

export interface AIDivergence {
  type: 'price-oi' | 'price-cvd' | 'price-atp';
  /** -1..1, sign indicates direction (positive = bullish for price) */
  strength: number;
  description: string;
}

export interface TradeSetup {
  exists: boolean;
  direction: 'long' | 'short' | 'none';
  entry: number;
  stop: number;
  target: number;
  confidence: number;
  riskReward: number;
  positionSizePct: number;
  rationale: string;
  invalidation: string;
}

export interface TacticalAnalysis {
  layer: 'tactical';
  regime: 'accumulation' | 'distribution' | 'trending-up' | 'trending-down' | 'breakout' | 'failed_breakout' | 'range-bound';
  regimeConfidence: number;
  levels: AILevel[];
  divergences: AIDivergence[];
  setup: TradeSetup;
  narrative: string;
  urgency: Urgency;
  ts: number;
}

export interface AIAnnotation {
  kind: 'tactical' | 'reflex' | 'narrative' | 'risk' | 'morning_brief' | 'correlation' | 'historical_echo' | 'confluence' | 'strategy_signal';
  ts: number;
  data: unknown;
}
