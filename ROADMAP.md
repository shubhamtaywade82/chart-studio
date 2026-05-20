# Chart Studio — Crypto Futures & Indian Options Roadmap

> **Branch**: `claude/tradingview-charts-guide-6Jr3K`  
> **Sprint duration**: 5 weeks (current baseline: DhanHQ v2 adapter + Prop Desk AI engine merged)  
> **Objective**: Extend Chart Studio into a production-grade prop-desk terminal covering Indian equity/F&O, Indian indices, crypto perpetuals, and AI-assisted options analytics.

---

## Current State (Baseline)

### What's Shipped
| Layer | Status |
|---|---|
| DhanHQ v2 binary feed (all 8 segments, correct enums) | ✅ |
| Heartbeat watchdog + force-reconnect on starvation | ✅ |
| `deferredSubscribe` — async instrument lookup at boot | ✅ |
| CVD (correct per-tick deltas from cumulative day totals) | ✅ |
| OI histogram (first-tick spike guard) | ✅ |
| ATP deviation overlay | ✅ |
| Day level markers (DO / DH / DL / Prev Close) | ✅ |
| Volume profile (LRU-eviction, O(n) value area) | ✅ |
| Depth heatmap (real qty/orders, not magic constants) | ✅ |
| Smart alerts (liquidity flip, ATP cross, OI trap) | ✅ |
| Latency monitor (windowed trades/sec ring buffer) | ✅ |
| Prop Desk AI engine (Reflex / Tactical / Narrative tiers) | ✅ |
| Ollama circuit breaker + JSON salvage | ✅ |
| Redis vector store (cosine similarity, 7-day TTL) | ✅ |
| Cross-instrument Pearson correlation | ✅ |
| AI overlay (12 visual features — regime, levels, setup, toxicity) | ✅ |
| Gateway 8-second stall detector | ✅ |
| Binance adapter (analytics streaming, REST snapshot) | ✅ |
| SMC primitive (order blocks, FVGs, structure) | ✅ |
| Strategy signal panel + microstructure panel | ✅ |

---

## Week 1 — Option Chain Foundation

### Goal
Live NSE option chain with Greeks, OI open interest analysis, and Max Pain.

### New Files
```
packages/adapter-dhanhq/src/option-chain.ts
ui/src/chart/option-chain-panel.ts
ui/src/panels/option-chain.ts
```

### `option-chain.ts` (adapter layer)
- Poll `GET /v2/marketfeed/option-chain` at 500 ms interval (rate-limit: 2 req/s per Dhan v2 docs)
- Parse strike-level payload: `{ strikePrice, callOI, callOIChange, callVolume, callLTP, callIV, putOI, putOIChange, putVolume, putLTP, putIV }`
- Publish to Redis channel `chart.data.dhanhq.{underlyingSymbol}.option_chain` as `DataEnvelope { kind: 'update', channel: 'analytics' }`
- Throttle publish: skip if payload hash matches last

### Greeks Engine (`option-chain.ts`)
Black-Scholes closed-form for European options (NSE options are European-style):

```
d1 = (ln(S/K) + (r + σ²/2)·T) / (σ·√T)
d2 = d1 - σ·√T

Call: Δ = N(d1),  θ = -(S·σ·N'(d1))/(2√T) - r·K·e^(-rT)·N(d2)
Put:  Δ = N(d1)-1

Gamma = N'(d1) / (S·σ·√T)
Vega  = S·N'(d1)·√T / 100          (per 1% move in IV)
Theta = value above / 365           (per calendar day)
Rho   = K·T·e^(-rT)·N(±d2) / 100
```

Inputs: spot `S`, strike `K`, risk-free rate `r = 0.065` (RBI repo), DTE `T` (calendar days / 365), implied vol `σ` (Newton-Raphson IV inversion from market price, max 50 iterations).

### `OptionChainPanel` (UI)
- Strike ladder — 20 strikes ITM/OTM centered on ATM
- Columns: `Call OI | Call OI Chg | Call Vol | Call LTP | IV | Strike | IV | Put LTP | Put Vol | Put OI Chg | Put OI`
- Color coding: OI increasing → green intensity; OI decreasing → red intensity
- ATM row highlighted; strikes beyond 2σ grayed out
- Greeks tooltip on hover per cell (Δ, Γ, θ, V, ρ)
- Sticky header on scroll

### Max Pain Calculator
```
Max Pain = argmin_K [ Σ_i max(0, K - K_i)·CallOI_i + Σ_i max(0, K_i - K)·PutOI_i ]
```
Rendered as a vertical dashed line on the option chain and as a price line on the main chart.

### OI-Based Support/Resistance
- Highest Put OI strike → support level
- Highest Call OI strike → resistance level
- Published as `annotation` frames to main chart overlay

### DhanHQ v2 Endpoints Used
| Endpoint | Purpose |
|---|---|
| `GET /v2/marketfeed/option-chain` | Live option chain |
| `GET /v2/charts/historical` | IV history for skew |
| `GET /v2/instruments/{segment}` | Strike listing |

### Deliverables
- [ ] `option-chain.ts` adapter module with Greeks engine
- [ ] `OptionChainPanel` React/vanilla component
- [ ] Max Pain overlay on main chart
- [ ] OI S/R price lines auto-updated every 60 s

---

## Week 2 — Risk & Margin Engine

### Goal
Real-time margin calculator, portfolio Greeks aggregation, Monte Carlo VaR.

### New Files
```
packages/ai-engine/src/margin-calculator.ts
packages/ai-engine/src/portfolio-greeks.ts
packages/ai-engine/src/var-engine.ts
ui/src/panels/greeks-panel.ts
ui/src/panels/margin-gauge.ts
```

### `margin-calculator.ts`
DhanHQ SPAN-style margin approximation:

```
SPAN Margin   = Max(Scenario Loss across 16 price/vol scenarios)
Exposure Margin = 1.5% × Contract Value (equity F&O)
Total Initial = SPAN + Exposure
Maintenance   = 0.75 × Total Initial

Scenario grid: price ±3σ/1-day × vol ±25%  (4×4 = 16 combinations)
```

- REST call to `POST /v2/margin-calculator` for live SPAN (when available)
- Fall back to internal approximation when offline
- Tracks available cash from `GET /v2/funds` (cached 30 s)
- Emits `margin_warning` alert when utilization > 80%

### `portfolio-greeks.ts`
Aggregates Greeks across all open positions:

```
Portfolio Δ = Σ position_i × Δ_i × lot_size_i
Portfolio Γ = Σ position_i × Γ_i × lot_size_i
Portfolio Vega  (per 1% IV move)
Portfolio Theta (per day, in ₹)
```

- Hedging suggestion: if |Portfolio Δ| > threshold, suggest ATM hedge quantity
- Delta-neutral suggestion for straddle/strangle positions

### `var-engine.ts`
Monte Carlo VaR (1-day, 95% / 99% confidence):
- 10,000 simulations using Cholesky-decomposed correlated returns
- Correlations from existing `correlation.ts` (Pearson, 5-min windows)
- Inputs: portfolio positions, current spot, σ per instrument
- Output: 95% VaR (₹), 99% VaR (₹), Expected Shortfall (CVaR)

### `GreeksPanel` (UI)
- Table: Position | Qty | Δ | Γ | Vega | Theta | P&L
- Aggregate row at bottom
- Δ neutral target badge

### `MarginGauge` (UI)
- Circular arc gauge: 0–100% utilization
- Color bands: 0–60% green, 60–80% amber, 80–100% red
- Shows: Used / Available / SPAN / Exposure breakdown
- Updates every 5 s during market hours

### DhanHQ v2 Endpoints Used
| Endpoint | Purpose |
|---|---|
| `POST /v2/margin-calculator` | SPAN margin |
| `GET /v2/funds` | Available cash |
| `GET /v2/positions` | Open positions |
| `GET /v2/holdings` | Equity holdings |

### Deliverables
- [ ] `margin-calculator.ts` with SPAN approximation + live API
- [ ] `portfolio-greeks.ts` aggregation engine
- [ ] `var-engine.ts` Monte Carlo (10k simulations < 200 ms on CPU)
- [ ] `GreeksPanel` with delta-neutral suggestion
- [ ] `MarginGauge` arc widget

---

## Week 3 — AI Options Intelligence

### Goal
Ollama-powered options intelligence: regime-aware IV analysis, expiry gamma risk, straddle optimization, automated hedging prompts.

### New Files
```
packages/ai-engine/src/ai-prompts.ts         (prompt templates)
packages/ai-engine/src/iv-surface.ts         (IV skew/surface)
packages/ai-engine/src/straddle-tracker.ts   (straddle P&L + breakevens)
ui/src/chart/iv-skew-primitive.ts            (lightweight-charts pane primitive)
ui/src/panels/ai-trade-card.ts               (AI trade recommendation card)
```

### `ai-prompts.ts` — Prompt Templates

**Regime Detection Prompt** (3B model, Reflex tier):
```
System: You are a volatility regime classifier for Indian F&O markets.
Input: ATM IV={iv}%, HV20={hv20}%, IVP={ivp}%, PCR={pcr}, 
       DTE={dte}d, SpotChange1D={d1}%, OIChange={oiChg}%
Output JSON: { regime: "low_vol"|"high_vol"|"trending"|"mean_reverting",
               confidence: 0-1, rationale: "<20 words>" }
```

**Expiry Pinning Prompt** (7B model, Tactical tier):
```
System: Analyze options market structure for expiry pin risk.
Input: MaxPain={mp}, Spot={spot}, ATM Straddle={straddle}₹,
       PutCallOIRatio={pcr}, GammaExposure={gex}cr
Output JSON: { pinProbability: 0-1, pinLevel: number,
               gammaTrap: bool, recommendation: "<30 words>" }
```

**Greeks Optimizer Prompt** (7B model, Tactical tier):
```
System: Suggest delta-neutral adjustments for F&O portfolio.
Input: PortfolioDelta={delta}, PortfolioVega={vega}₹/%,
       PortfolioTheta={theta}₹/day, DTE={dte}d, Regime={regime}
Output JSON: { action: "add_hedge"|"roll"|"close"|"hold",
               instrument: string, qty: number, rationale: "<40 words>" }
```

**Risk Manager Prompt** (70B model, Strategic tier, morning only):
```
System: You are a senior risk manager for an Indian prop desk trading F&O.
Input: Portfolio summary, overnight events, IV surface shift, 
       upcoming expiries, macro calendar
Output: { maxLoss: number, positionSizing: {...}, 
          hedgeRecommendations: [...], riskNarrative: string }
```

### `iv-surface.ts`
- Builds IV smile/skew from option chain data
- Strike axis: delta-normalized (10Δ / 25Δ / ATM / -25Δ / -10Δ)
- Term structure: spot/1w/2w/monthly expiries
- Interpolation: cubic spline per expiry, log-linear across terms
- Detects: skew steepening (panic buying of puts), vol crush (post-event)
- Publishes `iv_skew` annotation to main chart overlay

### `straddle-tracker.ts`
For each tracked straddle/strangle position:
```
Breakeven Upper = Strike + (Call LTP + Put LTP)
Breakeven Lower = Strike - (Call LTP + Put LTP)
P&L = realtime_spot_pnl + theta_decay_since_entry
Theta Burn Rate = combined theta × time_elapsed
IV Crush Risk = if event within 2 days: estimated post-event IV drop
```
- Tracks up to 10 simultaneous straddles
- Alert when spot within 0.5% of breakeven
- Alert when theta burn > 25% of initial premium

### `IVSkewPrimitive` (Lightweight Charts primitive)
- Renders in a dedicated pane below main chart
- X-axis: strike prices / delta-normalized
- Y-axis: implied volatility %
- Series: call IV (blue), put IV (red), realized vol (dashed gray)
- Hover tooltip: exact IV, Δ, Γ per strike

### `AiTradeCard` (UI)
Full-feature trade recommendation card:
```
┌─────────────────────────────────────┐
│ [REGIME: MEAN REVERTING] [IV: 18%]  │
│                                     │
│ Setup: Short Straddle NIFTY 24500   │
│ Entry: Sell 24500CE + 24500PE       │
│ Premium: ₹285 (CE: 142 + PE: 143)  │
│ Breakevens: 24215 / 24785           │
│ Max Profit: ₹285 × lot × qty       │
│ Theta/day: -₹12 per lot            │
│                                     │
│ Greeks: Δ≈0  Γ=0.003  V=₹85/%     │
│ Margin: ₹89,000  VaR(95%): ₹4,200 │
│                                     │
│ AI Rationale (confidence: 0.78):    │
│ "IV elevated vs HV, expiry in 4d,  │
│  max pain 24500, PCR neutral"       │
│                                     │
│ [EXECUTE]  [PAPER TRADE]  [DISMISS] │
└─────────────────────────────────────┘
```

### Deliverables
- [ ] `ai-prompts.ts` — all 4 prompt templates with Zod validation
- [ ] `iv-surface.ts` — skew builder + term structure
- [ ] `straddle-tracker.ts` — P&L + breakeven + burn rate
- [ ] `IVSkewPrimitive` — pane renderer using `useBitmapCoordinateSpace`
- [ ] `AiTradeCard` — full recommendation card with execute stub
- [ ] Wire Expiry Countdown badge (IST time to 3:30 PM expiry day)

---

## Week 4 — Crypto Futures

### Goal
Binance perpetual futures analytics: funding rate overlay, open interest delta, liquidation heatmap, cross-exchange basis (Binance vs Bybit vs OKX).

### New Files
```
packages/adapter-binance/src/funding-rate.ts
packages/adapter-binance/src/liquidation-feed.ts
packages/adapter-binance/src/basis-tracker.ts
packages/adapter-binance/src/oi-delta.ts
ui/src/chart/funding-overlay.ts
ui/src/chart/liquidation-heatmap.ts
ui/src/panels/crypto-dashboard.ts
```

### `funding-rate.ts`
- REST: `GET /fapi/v1/fundingRate` — last 8-hour funding rates, poll every 60 s
- WebSocket: `{symbol}@markPrice` stream for real-time funding rate
- Predicted funding from mark price vs index price spread: `f = (markPrice - indexPrice) / indexPrice`
- Annualized funding APR: `fundingRate × 3 × 365 × 100`%
- Publish as `DataEnvelope` on `chart.data.binance.{symbol}.analytics`

### `liquidation-feed.ts`
- WebSocket: `!forceOrder@arr` (global) or `{symbol}@forceOrder`
- Parse: `{ symbol, side, quantity, price, time }`
- Aggregate into 1-minute buckets: `{ longLiqUsd, shortLiqUsd, timestamp }`
- Large liquidation alert: > $1M single liquidation within 1 candle
- Cluster detection: 3+ liquidations within 30 s → "cascade risk" alert

### `basis-tracker.ts`
Cross-exchange spot-perp basis:
```
Basis (%) = (Perp Price - Spot Price) / Spot Price × 100
Basis Spread = Binance Perp - Bybit Perp     (arb signal)
```
- Binance: WebSocket `btcusdt@markPrice`
- Bybit: WebSocket `publicTrade.BTCUSDT` (REST fallback)
- OKX: REST `GET /api/v5/market/mark-price` (fallback, 30 s poll)
- Publishes `basis` time series to Redis for chart overlay

### `oi-delta.ts`
- REST: `GET /fapi/v1/openInterest` every 30 s
- OI Delta = `currentOI - previousOI` (in USD notional)
- OI/Volume ratio: rising OI + rising vol = conviction; rising OI + falling vol = accumulation
- Long/short ratio from `GET /futures/data/globalLongShortAccountRatio`

### `FundingOverlay` (Lightweight Charts primitive)
- Bar chart in sub-pane: positive funding = green (longs pay), negative = red (shorts pay)
- Threshold lines at ±0.01% (normal), ±0.05% (elevated), ±0.1% (extreme)
- Tooltip: "Funding: +0.0312% | APR: +34.1% | Next in 2h14m"

### `LiquidationHeatmap` (Lightweight Charts primitive)
- Horizontal price-level bars showing estimated liquidation clusters
- Derived from estimated leverage distribution (Binance open interest + last price)
- Color intensity = estimated liquidation volume at that price level
- Updates every 60 s using OI snapshots

### `CryptoDashboard` panel
```
┌──────────────────────────────────────────┐
│ BTC/USDT PERP    $67,420  +1.2%         │
│                                          │
│ Funding Rate: +0.0312% (APR: +34.1%)    │
│ Next Funding: 2h 14m                    │
│                                          │
│ Open Interest: $18.4B  ▲ +2.1% (1h)    │
│ OI/Vol Ratio: 0.34 (accumulation)       │
│ Long/Short: 52% / 48%                   │
│                                          │
│ Basis (Binance-Spot): +0.08%            │
│ Basis Spread (Bin-Bybit): +0.012%       │
│                                          │
│ Liquidations (1h): Long $42M / Short $8M│
│ [LONGS AT RISK] cascade probability 23% │
└──────────────────────────────────────────┘
```

### Realized Volatility Surface (Crypto)
- 1D / 7D / 30D realized vol from OHLCV candles
- Parkinson estimator: `σ = √(1/(4n·ln2) × Σ(ln(H/L))²)`  (lower noise than close-to-close)
- Yang-Zhang estimator for overnight gaps
- Compare realized vs funding-implied vol for carry opportunities

### Deliverables
- [ ] `funding-rate.ts` — WebSocket + REST, APR calculation
- [ ] `liquidation-feed.ts` — aggregation + cascade alert
- [ ] `basis-tracker.ts` — 3-exchange basis with arb signal
- [ ] `oi-delta.ts` — OI delta + L/S ratio
- [ ] `FundingOverlay` primitive (sub-pane bar chart)
- [ ] `LiquidationHeatmap` primitive (price-level heatmap)
- [ ] `CryptoDashboard` panel

---

## Week 5 — Polish & Production Hardening

### Goal
UI polish, performance optimization, expiry workflow, smart order routing stub, monitoring.

### Straddle Tracker UI
Full P&L dashboard for straddle/strangle positions:
- Combined premium, breakevens, theta decay curve
- IV crush scenario: "If IV drops from 18% to 12% post-event, P&L = +₹X"
- Rolling adjustment suggestion when delta drifts > 0.15

### IV Skew Plots
- Rendered as a tabbed panel: "Smile" (single expiry) | "Term Structure" | "Surface" (3D-ish heatmap)
- Historical comparison: today's skew vs 5-day / 20-day average
- Skew steepness metric: `(25Δ Put IV - 25Δ Call IV) / ATM IV`

### Expiry Countdown Widget
- Real-time countdown: `D HH:MM:SS` to 3:30 PM IST on expiry day
- Color transitions: >3 days = gray, <3 days = amber, <1 day = red pulse
- DTE annotations on IV surface chart
- Weekly (Thu) / Monthly (last Thu) / Quarterly expiry auto-detection

### Smart Order Routing Stub
Interface definition for future broker integration:
```typescript
interface OrderRouter {
  placeOrder(params: OrderParams): Promise<OrderResult>;
  modifyOrder(orderId: string, params: Partial<OrderParams>): Promise<void>;
  cancelOrder(orderId: string): Promise<void>;
  getPositions(): Promise<Position[]>;
  getOrderBook(symbol: string): Promise<OrderBook>;
}
```
- DhanHQ implementation: `POST /v2/orders` with SPAN pre-check
- Paper trading mode: in-memory fill simulation using LTP
- Slippage model: `fill_price = ltp ± (spread/2) × (1 + urgency_factor)`

### Performance Targets
| Metric | Target |
|---|---|
| Tick-to-render latency | < 16 ms (1 frame) |
| Option chain refresh cycle | < 500 ms |
| AI Reflex signal latency | < 50 ms |
| AI Tactical signal latency | < 2 s |
| Greeks calculation (50 strikes) | < 5 ms |
| Monte Carlo VaR (10k paths) | < 200 ms |
| Memory footprint (renderer) | < 512 MB |

### Monitoring & Observability
- Prometheus metrics via `prom-client`:
  - `chart_tick_latency_ms` histogram
  - `dhan_ws_reconnect_total` counter
  - `ai_inference_duration_ms` histogram (per model tier)
  - `option_chain_poll_errors_total` counter
- Structured logging: `pino` with log levels per module
- Health endpoint: `GET /health` → liveness + readiness
- Grafana dashboard JSON committed at `monitoring/grafana-dashboard.json`

### Deliverables
- [ ] Straddle tracker full UI with IV crush scenario
- [ ] IV skew 3-panel (smile / term structure / surface)
- [ ] Expiry countdown widget with color transitions
- [ ] `OrderRouter` interface + DhanHQ implementation + paper trading mode
- [ ] Prometheus metrics instrumentation
- [ ] Grafana dashboard definition
- [ ] E2E smoke test: subscribe → tick → analytics → AI signal → render

---

## Hardware Requirements

### Development (Minimum)
| Component | Spec |
|---|---|
| GPU | NVIDIA RTX 3060 12 GB VRAM |
| RAM | 32 GB DDR4 |
| CPU | 8-core (Ryzen 7 / i7) |
| NVMe | 500 GB (model weights + Redis AOF) |
| OS | Ubuntu 22.04 LTS |

**Ollama model allocation on RTX 3060:**
- `llama3.2:3b` — 2.0 GB VRAM — Reflex tier (< 50 ms)
- `llama3.1:8b` — 5.5 GB VRAM — Tactical tier (< 2 s)
- 4.5 GB remaining for KV cache

**Note**: 70B Strategic tier requires offloading to CPU RAM (llama.cpp) — latency ~30–60 s, acceptable for morning brief only.

### Staging (Recommended)
| Component | Spec |
|---|---|
| GPU | 2× NVIDIA RTX 4090 24 GB VRAM each |
| RAM | 128 GB DDR5 ECC |
| CPU | 32-core (AMD EPYC / Xeon) |
| NVMe | 4 TB NVMe RAID-1 |
| Network | 1 Gbps dedicated (co-lo or cloud) |

**Model allocation on dual 4090:**
- GPU 0: `llama3.2:3b` (Reflex) + `llama3.1:8b` (Tactical)
- GPU 1: `llama3.3:70b` Q4_K_M quantized (Strategic) — fits in 24 GB at Q4

### Production (Target)
| Component | Spec |
|---|---|
| GPU | 2× NVIDIA A100 80 GB SXM |
| RAM | 512 GB DDR5 ECC |
| CPU | 64-core AMD EPYC 9004 |
| NVMe | 8 TB NVMe (4× 2 TB RAID-10) |
| Network | 10 Gbps (BSE/NSE co-location preferred) |
| Redis | Dedicated Redis Cluster (3 nodes, 32 GB each) |
| Backup | Automated S3 AOF + RDB snapshots every 6 h |

**Model allocation on dual A100:**
- GPU 0: `llama3.2:3b` + `llama3.1:8b` + vector store inference
- GPU 1: `llama3.3:70b` full precision (fp16) — < 2 s latency
- Tensor parallelism via vLLM for serving concurrency

---

## DhanHQ v2 API Reference

### Binary Feed Subscription
| Request Code | Type |
|---|---|
| 15 | Ticker (LTP only) |
| 17 | Quote (bid/ask + OHLC) |
| 21 | Full Market Depth (5 levels) |

### Exchange Segment Enums (Binary Feed)
| Segment | Code |
|---|---|
| IDX_I (Indices) | 0 |
| NSE_EQ | 1 |
| NSE_FNO | 2 |
| NSE_CURRENCY | 3 |
| BSE_EQ | 4 |
| MCX_COMM | 5 |
| BSE_CURRENCY | 7 |
| BSE_FNO | 8 |

### Response Codes (Binary Frame Header)
| Code | Meaning |
|---|---|
| 2 | Ticker data |
| 4 | Quote data |
| 5 | OI data |
| 6 | Previous close |
| 8 | Market depth (full) |
| 50 | Disconnect / error |

### REST Endpoints Used (v2)
| Endpoint | Method | Use |
|---|---|---|
| `/v2/charts/historical` | GET | OHLCV candle history |
| `/v2/marketfeed/quote` | POST | Snapshot quotes (batch) |
| `/v2/marketfeed/option-chain` | GET | Live option chain |
| `/v2/instruments/{segment}` | GET | Instrument list by segment |
| `/v2/margin-calculator` | POST | SPAN margin |
| `/v2/funds` | GET | Available cash |
| `/v2/positions` | GET | Open positions |
| `/v2/orders` | POST | Place order |
| `/v2/forever/orders` | POST | GTT orders |

---

## Top 5 Killer Features

### 1. Live Option Chain with Max Pain + OI S/R
Real-time NSE option chain refreshing every 500 ms. Max pain level rendered as a magnetic price on the chart. Highest Call/Put OI strikes auto-drawn as resistance/support. As expiry approaches and gamma rises, the probability of pinning to max pain increases — this feature makes that visible before most retail platforms show it.

### 2. Expiry Gamma Risk (AI-Powered)
The 7B tactical model monitors GEX (Gamma Exposure in ₹ crore) continuously. When gamma flips negative (dealers become long gamma → stabilizing) or spiking positive (dealers short gamma → amplifying), the `AiTradeCard` auto-surfaces an adjustment recommendation with specific instrument, quantity, and P&L scenario. This is the feature that separates a terminal from a charting app.

### 3. Liquidation Cascade Detector (Crypto)
Aggregates Binance force-order WebSocket events into 30-second windows. When 3+ liquidations cluster within a single candle AND OI drops > 2% simultaneously, a "cascade risk" banner fires with directional bias. Historically, BTC liquidation cascades above $50M/candle precede 1–2% directional moves within the next 3 candles — this detector catches them in real time.

### 4. CVD Divergence → AI Narrative Pipeline
CVD (Cumulative Volume Delta) diverging from price is a well-known smart-money signal. This implementation goes further: the Reflex tier detects the divergence in < 50 ms, the Tactical tier asks the 7B model to contextualize it against current regime/OI/depth, and the Narrative tier outputs a single high-urgency sentence rendered directly on the chart. No other retail terminal has AI-mediated interpretation of microstructure signals at this latency.

### 5. Cross-Exchange Basis Arbitrage Signal
Tracks spot-perp basis across Binance, Bybit, and OKX simultaneously. When the basis spread between two exchanges exceeds the effective round-trip cost (fees + slippage ≈ 0.06%), an arb signal fires with entry/exit levels and estimated carry. The funding rate APR overlay contextualizes whether holding the arb position is worth the carry cost. This is institutional-grade tooling available at prop desk cost.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| DhanHQ option-chain API rate limit (2 req/s) | High | Medium | Deduplicate by hash; 500 ms poll with jitter |
| Ollama 7B OOM on 12 GB GPU | Medium | High | Q4_K_M quantization (5.5 GB); swap to CPU if VRAM full |
| Black-Scholes IV inversion divergence | Low | Medium | Cap IV at 500%; max 50 Newton-Raphson iterations |
| Cross-exchange basis WebSocket sync drift | Medium | Low | Timestamp-align with 100 ms tolerance; flag stale feeds |
| Redis vector store memory growth | Medium | Medium | 7-day TTL + LRU cap at 50k entries |
| Binance `!forceOrder@arr` stream rate | Low | Low | Server-side filter by minimum $100k notional |
| NSE expiry day circuit breakers | Low | High | Pause trading signals when NSE halt message received |

---

## Non-Goals (This Sprint)

- Real order execution (SOR stub only; requires SEBI algo registration)
- BSE equity options (low liquidity; prioritize NSE)
- Multi-account aggregation (single credential per session)
- Mobile UI (desktop terminal only; responsive layout deferred)
- GIFT City / SGX Nifty (data availability uncertain)
