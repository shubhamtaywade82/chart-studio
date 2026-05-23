import type { MicrostructureSnapshot, ReflexSignal } from './types';

/**
 * Reflex layer: synchronous, deterministic prop-desk heuristics.
 * Refactored to focus on Advanced SMC / Institutional Flow.
 */
export function reflex(snap: MicrostructureSnapshot, prev?: MicrostructureSnapshot): ReflexSignal {
  const d = snap.derived;
  const t = snap.tick;

  // 1. LIQUIDITY SWEEP: Price pokes past day high/low but snaps back immediately.
  // This is a "Manipulation" signal in the AMD cycle.
  if (prev) {
    const sweptHigh = prev.tick.ltp >= t.dayHigh && t.ltp < t.dayHigh;
    const sweptLow = prev.tick.ltp <= t.dayLow && t.ltp > t.dayLow;
    
    if (sweptHigh && d.depthImbalance < -0.3) {
      return {
        layer: 'reflex',
        type: 'liquidity_sweep',
        urgency: 'immediate',
        confidence: 0.85,
        narrative: '[LIQUIDITY SWEEP] Buy-side stops hit at day high. Rejection confirmed by ask-side depth. Bearish shift likely.',
        ts: snap.timestamp,
      };
    }
    if (sweptLow && d.depthImbalance > 0.3) {
      return {
        layer: 'reflex',
        type: 'liquidity_sweep',
        urgency: 'immediate',
        confidence: 0.85,
        narrative: '[LIQUIDITY SWEEP] Sell-side stops hit at day low. Rejection confirmed by bid-side depth. Bullish shift likely.',
        ts: snap.timestamp,
      };
    }
  }

  // 2. DISPLACEMENT / MOMENTUM: Strong volume-weighted move away from ATP.
  // Institutional "Distribution" phase.
  if (Math.abs(d.vwapDeviation) > 0.003 && d.tradeIntensity > 15) {
    const isBullish = d.vwapDeviation > 0 && d.cvd > 0;
    const isBearish = d.vwapDeviation < 0 && d.cvd < 0;
    
    if (isBullish || isBearish) {
      return {
        layer: 'reflex',
        type: 'displacement',
        urgency: 'this_candle',
        confidence: 0.75,
        narrative: `[DISPLACEMENT] Strong institutional ${isBullish ? 'buying' : 'selling'} detected. Price moving with high intensity and volume support.`,
        ts: snap.timestamp,
      };
    }
  }

  // 3. OI TRAP (Re-refined): Position building at Equilibrium.
  if (Math.abs(d.oiChange) > 40_000 && Math.abs(d.vwapDeviation) < 0.0003) {
    return {
      layer: 'reflex',
      type: 'oi_trap',
      urgency: 'next_5min',
      confidence: 0.80,
      narrative: '[OI TRAP] Aggressive position building at fair value (ATP). Smart money is loading for the next expansion.',
      ts: snap.timestamp,
    };
  }

  // 4. ATP CROSS (Tape Flip)
  if (prev && t.atp > 0) {
    if (prev.tick.ltp < prev.tick.atp && t.ltp >= t.atp && d.cvd > 0) {
      return {
        layer: 'reflex',
        type: 'atp_cross_up',
        urgency: 'this_candle',
        confidence: 0.70,
        narrative: '[TAPE FLIP] Buyers in control above ATP. Order flow confirms bullish momentum.',
        ts: snap.timestamp,
      };
    }
    if (prev.tick.ltp > prev.tick.atp && t.ltp <= t.atp && d.cvd < 0) {
      return {
        layer: 'reflex',
        type: 'atp_cross_down',
        urgency: 'this_candle',
        confidence: 0.70,
        narrative: '[TAPE FLIP] Sellers in control below ATP. Order flow confirms bearish momentum.',
        ts: snap.timestamp,
      };
    }
  }

  // 5. TOXICITY WARNING
  if (d.toxicity > 0.65) {
    return {
      layer: 'reflex',
      type: 'toxicity_spike',
      urgency: 'immediate',
      confidence: 0.90,
      narrative: '[TOXICITY] Extreme adverse selection detected. High-frequency arbitrageurs are dominant. Avoid market orders.',
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
