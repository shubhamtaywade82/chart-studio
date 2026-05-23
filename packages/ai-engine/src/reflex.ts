import type { MicrostructureSnapshot, ReflexSignal } from './types';

/**
 * Reflex layer: synchronous, deterministic prop-desk heuristics.
 * Refactored to focus on Advanced SMC / Institutional Flow.
 */
export function reflex(
  snap: MicrostructureSnapshot,
  prev?: MicrostructureSnapshot,
  correlatedPrice?: number
): ReflexSignal {
  const d = snap.derived;
  const t = snap.tick;

  // 1. LIQUIDITY SWEEP / MANIPULATION (The 'M' in AMD)
  if (prev) {
    const sweptHigh = prev.tick.ltp >= t.dayHigh && t.ltp < t.dayHigh;
    const sweptLow = prev.tick.ltp <= t.dayLow && t.ltp > t.dayLow;
    
    if (sweptHigh && d.depthImbalance < -0.3) {
      return {
        layer: 'reflex',
        type: 'liquidity_sweep',
        urgency: 'immediate',
        confidence: 0.85,
        narrative: '[LIQUIDITY SWEEP] Buy-side stops hit at day high. Rejection confirmed by ask-side depth. Manipulation phase complete.',
        ts: snap.timestamp,
      };
    }
    if (sweptLow && d.depthImbalance > 0.3) {
      return {
        layer: 'reflex',
        type: 'liquidity_sweep',
        urgency: 'immediate',
        confidence: 0.85,
        narrative: '[LIQUIDITY SWEEP] Sell-side stops hit at day low. Rejection confirmed by bid-side depth. Manipulation phase complete.',
        ts: snap.timestamp,
      };
    }
  }

  // 2. SMT DIVERGENCE: Cracks in Correlation
  // If BTC makes a lower low but ETH makes a higher low -> Bullish SMT.
  if (correlatedPrice && prev && prev.tick.ltp > 0) {
    const priceChange = (t.ltp - prev.tick.ltp) / prev.tick.ltp;
    const corrChange = (correlatedPrice - (prev as any).correlatedPrice || correlatedPrice) / ((prev as any).correlatedPrice || correlatedPrice);
    
    // Simplified SMT: assets moving in opposite directions at key levels
    if (Math.sign(priceChange) !== Math.sign(corrChange) && Math.abs(priceChange) > 0.0005) {
      return {
        layer: 'reflex',
        type: 'smt_divergence',
        urgency: 'this_candle',
        confidence: 0.78,
        narrative: '[SMT DIVERGENCE] Asset correlation broken. One asset is failing to follow the trend, signaling institutional divergence.',
        ts: snap.timestamp,
      };
    }
  }

  // 3. INDUCEMENT TRAP: Price pokes a minor swing but fails to sustain body close.
  // This traps retail traders who think it's a BOS.
  if (snap.candles.length >= 3) {
    const last = snap.candles[snap.candles.length - 1]!;
    const prevC = snap.candles[snap.candles.length - 2]!;
    if (last.high > prevC.high && last.close < prevC.high && d.cvd < 0) {
      return {
        layer: 'reflex',
        type: 'inducement_trap',
        urgency: 'next_5min',
        confidence: 0.72,
        narrative: '[INDUCEMENT] Retail long trap detected. Price poked high but failed to close body. Order flow is negative.',
        ts: snap.timestamp,
      };
    }
  }

  // 4. DISPLACEMENT / MOMENTUM
  if (Math.abs(d.vwapDeviation) > 0.003 && d.tradeIntensity > 15) {
    const isBullish = d.vwapDeviation > 0 && d.cvd > 0;
    const isBearish = d.vwapDeviation < 0 && d.cvd < 0;
    
    if (isBullish || isBearish) {
      return {
        layer: 'reflex',
        type: 'displacement',
        urgency: 'this_candle',
        confidence: 0.75,
        narrative: `[DISPLACEMENT] Strong institutional ${isBullish ? 'buying' : 'selling'} detected. Price moving with high intensity.`,
        ts: snap.timestamp,
      };
    }
  }

  // 5. OI TRAP
  if (Math.abs(d.oiChange) > 40_000 && Math.abs(d.vwapDeviation) < 0.0003) {
    return {
      layer: 'reflex',
      type: 'oi_trap',
      urgency: 'next_5min',
      confidence: 0.80,
      narrative: '[OI TRAP] Aggressive position building at fair value (ATP). Smart money is loading.',
      ts: snap.timestamp,
    };
  }

  // 6. ATP CROSS
  if (prev && t.atp > 0) {
    if (prev.tick.ltp < prev.tick.atp && t.ltp >= t.atp && d.cvd > 0) {
      return {
        layer: 'reflex',
        type: 'atp_cross_up',
        urgency: 'this_candle',
        confidence: 0.70,
        narrative: '[TAPE FLIP] Buyers in control above ATP.',
        ts: snap.timestamp,
      };
    }
    if (prev.tick.ltp > prev.tick.atp && t.ltp <= t.atp && d.cvd < 0) {
      return {
        layer: 'reflex',
        type: 'atp_cross_down',
        urgency: 'this_candle',
        confidence: 0.70,
        narrative: '[TAPE FLIP] Sellers in control below ATP.',
        ts: snap.timestamp,
      };
    }
  }

  // 7. TOXICITY WARNING
  if (d.toxicity > 0.65) {
    return {
      layer: 'reflex',
      type: 'toxicity_spike',
      urgency: 'immediate',
      confidence: 0.90,
      narrative: '[TOXICITY] Extreme adverse selection detected. Use limit orders only.',
      ts: snap.timestamp,
    };
  }

  return {
    layer: 'reflex',
    type: 'neutral',
    urgency: 'none',
    confidence: 0,
    narrative: '',
    ts: snap.timestamp,
  };
}

