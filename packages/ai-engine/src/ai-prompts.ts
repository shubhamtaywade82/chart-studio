import { z } from 'zod';

// 1. Regime Detection Prompt
export const RegimeDetectionPrompt = {
  template: `System: You are a volatility regime classifier for Indian F&O markets.
Input: ATM IV={iv}%, HV20={hv20}%, IVP={ivp}%, PCR={pcr}, 
       DTE={dte}d, SpotChange1D={d1}%, OIChange={oiChg}%
Output JSON: { "regime": "low_vol"|"high_vol"|"trending"|"mean_reverting", "confidence": 0-1, "rationale": "<20 words>" }`,
  schema: z.object({
    regime: z.enum(['low_vol', 'high_vol', 'trending', 'mean_reverting']),
    confidence: z.number().min(0).max(1),
    rationale: z.string().max(100),
  }),
};

// 2. Expiry Pinning Prompt
export const ExpiryPinningPrompt = {
  template: `System: Analyze options market structure for expiry pin risk.
Input: MaxPain={mp}, Spot={spot}, ATM Straddle={straddle}INR,
       PutCallOIRatio={pcr}, GammaExposure={gex}cr
Output JSON: { "pinProbability": 0-1, "pinLevel": number, "gammaTrap": boolean, "recommendation": "<30 words>" }`,
  schema: z.object({
    pinProbability: z.number().min(0).max(1),
    pinLevel: z.number(),
    gammaTrap: z.boolean(),
    recommendation: z.string().max(150),
  }),
};

// 3. Greeks Optimizer Prompt (Options Buying focused)
export const GreeksOptimizerPrompt = {
  template: `System: Suggest delta-neutral adjustments for F&O portfolio using ONLY options buying.
Input: PortfolioDelta={delta}, PortfolioVega={vega}INR/%,
       PortfolioTheta={theta}INR/day, DTE={dte}d, Regime={regime}
Output JSON: { "action": "buy_hedge"|"roll_long"|"close"|"hold", "instrument": string, "qty": number, "rationale": "<40 words>" }`,
  schema: z.object({
    action: z.enum(['buy_hedge', 'roll_long', 'close', 'hold']),
    instrument: z.string(),
    qty: z.number(),
    rationale: z.string().max(200),
  }),
};

// 4. Risk Manager Prompt
export const RiskManagerPrompt = {
  template: `System: You are a senior risk manager for an Indian prop desk trading F&O, focusing on options buying strategies.
Input: Portfolio summary, overnight events, IV surface shift, 
       upcoming expiries, macro calendar
CRITICAL: All hedging and adjustment recommendations must be framed as BUYING options. Do not suggest selling.
Output JSON: { "maxLoss": number, "positionSizing": {}, "hedgeRecommendations": [], "riskNarrative": string }`,
  schema: z.object({
    maxLoss: z.number(),
    positionSizing: z.record(z.string(), z.any()),
    hedgeRecommendations: z.array(z.string()),
    riskNarrative: z.string(),
  }),
};
