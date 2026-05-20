import type { MicrostructureSnapshot, ReflexSignal } from './types';

/**
 * Reflex layer: synchronous, deterministic prop-desk heuristics. Runs on
 * every tick. Never calls into Ollama — must complete in well under 1ms.
 *
 * Returns the highest-urgency signal that fires; callers should dedupe by
 * (type, symbol) and a short refractory period.
 */
export function reflex(snap: MicrostructureSnapshot, prev?: MicrostructureSnapshot): ReflexSignal {
  const d = snap.derived;
  const t = snap.tick;

  // 1. OI trap: large OI build with price pinned near ATP.
  if (Math.abs(d.oiChange) > 50_000 && Math.abs(d.vwapDeviation) < 0.0005) {
    return {
      layer: 'reflex',
      type: 'oi_trap',
      urgency: 'critical',
      confidence: 0.82,
      narrative: `OI ${d.oiChange > 0 ? '+' : '-'}${Math.abs(d.oiChange / 1000).toFixed(0)}K with price pinned near ATP. Institutional position building. Expect volatility expansion.`,
      ts: snap.timestamp,
    };
  }

  // 2. Liquidity crisis: depth tilted heavily one-sided + CVD divergence.
  if (d.depthImbalance < -0.6 && d.cvd < 0) {
    return {
      layer: 'reflex',
      type: 'liquidity_crisis',
      urgency: 'critical',
      confidence: 0.76,
      narrative: 'Bid wall collapsing while sell pressure dominant. Slippage risk extreme for market orders.',
      ts: snap.timestamp,
    };
  }
  if (d.depthImbalance > 0.6 && d.cvd > 0) {
    return {
      layer: 'reflex',
      type: 'liquidity_crisis',
      urgency: 'critical',
      confidence: 0.76,
      narrative: 'Ask wall thinning while buy pressure dominant. Stop-running risk above current price.',
      ts: snap.timestamp,
    };
  }

  // 3. ATP cross — requires previous snapshot.
  if (prev && t.atp > 0) {
    if (prev.tick.ltp < prev.tick.atp && t.ltp >= t.atp) {
      return {
        layer: 'reflex',
        type: 'atp_cross_up',
        urgency: 'this_candle',
        confidence: 0.65,
        narrative: 'LTP crossed above ATP. Tape control flipping bullish.',
        ts: snap.timestamp,
      };
    }
    if (prev.tick.ltp > prev.tick.atp && t.ltp <= t.atp) {
      return {
        layer: 'reflex',
        type: 'atp_cross_down',
        urgency: 'this_candle',
        confidence: 0.65,
        narrative: 'LTP crossed below ATP. Tape control flipping bearish.',
        ts: snap.timestamp,
      };
    }
  }

  // 4. Day break — touch of day high/low with momentum.
  if (prev && t.dayHigh > 0 && t.ltp >= t.dayHigh && prev.tick.ltp < t.dayHigh) {
    return {
      layer: 'reflex',
      type: 'day_break_up',
      urgency: 'immediate',
      confidence: 0.70,
      narrative: `Day high break at ${t.dayHigh.toFixed(2)}. ${d.depthImbalance > 0 ? 'Confirmed by bid support.' : 'Watch for failure — bids thin.'}`,
      ts: snap.timestamp,
    };
  }
  if (prev && t.dayLow > 0 && t.ltp <= t.dayLow && prev.tick.ltp > t.dayLow) {
    return {
      layer: 'reflex',
      type: 'day_break_down',
      urgency: 'immediate',
      confidence: 0.70,
      narrative: `Day low test at ${t.dayLow.toFixed(2)}. ${d.depthImbalance < 0 ? 'Confirmed by ask pressure.' : 'Watch for bounce — bids holding.'}`,
      ts: snap.timestamp,
    };
  }

  // 5. CVD divergence — price up but CVD down (or vice versa) over 5 candles.
  if (snap.candles.length >= 5 && prev) {
    const fiveAgo = snap.candles[snap.candles.length - 5];
    const last = snap.candles[snap.candles.length - 1];
    if (fiveAgo && last) {
      const priceDelta = last.close - fiveAgo.close;
      // Need cvd snapshot history for true divergence; approximate via sign.
      const cvdSign = Math.sign(d.cvd);
      const priceSign = Math.sign(priceDelta);
      if (priceSign !== 0 && cvdSign !== 0 && priceSign !== cvdSign && Math.abs(priceDelta / fiveAgo.close) > 0.001) {
        return {
          layer: 'reflex',
          type: 'cvd_divergence',
          urgency: 'next_5min',
          confidence: 0.60,
          narrative: priceSign > 0
            ? 'Price up but order flow negative. Bearish divergence forming.'
            : 'Price down but order flow positive. Bullish divergence forming.',
          ts: snap.timestamp,
        };
      }
    }
  }

  // 6. Toxicity spike.
  if (d.toxicity > 0.6) {
    return {
      layer: 'reflex',
      type: 'toxicity_spike',
      urgency: 'next_5min',
      confidence: 0.55,
      narrative: 'Order flow toxicity elevated. Use limit orders only.',
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
