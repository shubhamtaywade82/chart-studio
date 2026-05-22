# 🚀 Chart Studio: Complete Feature List & E2E Guide

Welcome to the definitive guide for **Chart Studio**, a production-grade prop-desk terminal covering Indian Equity/F&O, Crypto Perpetuals, and AI-assisted analytics.

---

## 🏗️ 1. Core Architecture & Market Data

### Multi-Provider Engine
*   **DhanHQ v2 Adapter**: 
    *   **Ultra-low Latency**: Binary WebSocket feed supporting all segments (NSE Cash/FNO, BSE, MCX, Currency).
    *   **Market Hour Awareness**: Intelligent logic that automatically disconnects outside of Indian market hours (08:30–16:00 IST) and on weekends to preserve API quota and account health.
    *   **Async Scrip Master**: Fast startup via lazy-loaded CSV instrument metadata.
*   **Binance Perpetual Adapter**:
    *   Real-time data streaming for Crypto Perpetuals.
    *   Automatic calculation of **Funding Rates**, **Long/Short Ratios**, and **Spot-Perp Basis**.
*   **Gateway Bridge**: High-performance Node.js service that multiplexes multiple providers into a unified WebSocket/REST API for the UI.

### Charting Engine
*   **TradingView Core**: Powered by **Lightweight Charts™ v5**.
*   **Smooth LTP Animation**: Sub-tick interpolation using `requestAnimationFrame` (100 micro-steps between ticks) for institutional-grade visual fluidity.
*   **Intelligent History Merging**: A Map-based deduplication engine that merges live WebSocket updates with historical snapshots, preventing candle "flicker" or data loss.

---

## 📊 2. Prop-Desk Microstructure Tools

### Order Book & Depth
*   **High-Density Visualization**: L2 depth with smooth linear-gradient bars.
*   **Imbalance Engine**: 
    *   Real-time **Bid/Ask Imbalance Bar** in the spread area.
    *   **Status Badges**: Automatic Bullish (Green), Bearish (Red), or Neutral (Gray) classification.
*   **Visual Feedback**: Typewriter-style flashing on size updates for instant liquidity detection.

### Flow & Sentiment
*   **Aggregated Trade Tape**: Color-coded by aggressor side (Maker vs. Taker).
*   **Sentiment Panel**: Tracks buy/sell volume intensity across multiple time windows (30s to 5m).
*   **Depth Heatmap**: Maps liquidity clusters over time directly on the price chart.
*   **Volume Profile (VPVR)**: Real-time O(n) value area calculation with LRU-eviction.

---

## 📈 3. Options Analytics (NSE Focus)

### Live Option Chain
*   **Strike Ladder**: Centered 20-strike view centered on ATM with sticky headers.
*   **OI Intensity Heatmapping**: Green/Red intensity based on the magnitude of OI change per strike.
*   **Greeks Engine**: Real-time Black-Scholes calculation for **Delta, Gamma, Theta, and Vega**.
*   **Newton-Raphson IV Solver**: Back-calculates Implied Volatility from LTP if the exchange provides 0 IV.

### Chart Overlays
*   **Max Pain Magnet**: A purple dashed line marking the expected expiry pin level.
*   **OI Support/Resistance**: Automated levels based on the highest Put and Call concentration.
*   **IV Skew (Smile)**: Dedicated chart pane visualizing volatility skew across Deltas.

---

## 🧠 4. AI Intelligence (Prop-Desk Tiers)

### Multi-Tier Analysis
*   **Reflex Tier (<1ms)**: Heuristic signals for **OI Traps**, **Liquidity Crises**, and **CVD Divergences**.
*   **Tactical Tier (7B Model)**: Detects **Volatility Regimes** and generates full **Trade Setup Cards** (Entry, Stop, Target).
*   **Strategic Tier (8B+ Model)**: Generates the **Strategic Morning Brief** by analyzing Global Macro data (S&P 500, VIX, Crude, 10Y Yields).

### Cyberpunk HUD (Heads-Up Display)
*   **Narrative Log**: A floating, draggable terminal with a **typewriter effect**.
*   **Provider-Aware**: AI logic switches terminology between "Crypto Perps" and "Indian F&O" automatically.
*   **Urgency Feedback**: Visual glow and color coding based on market risk (Immediate vs. Watch).

---

## 🎨 5. Customization & UI Extras

### Visual Identity
*   **13 Specialized Themes**: Including standard Dark/Light, **Colorblind Accessible** (HC Yellow/Blue, Deuteranopia, Tritanopia), and **Hollow Candle** variations.
*   **Persistent Layout**: Toggles for Watchlist (`Ctrl+L`) and Sidebar (`Ctrl+B`) are remembered across sessions.
*   **Draggable Elements**: All AI panels and microstructure widgets can be rearranged and their positions are saved automatically.

---

## 📖 End-to-End User Flow

### 1. Initialization
1.  **Configure**: Set your DhanHQ/Binance tokens in **Settings**.
2.  **Search**: Press `S` for Global Search. Pick a symbol like `NIFTY` or `BTCUSDT`.
3.  **Interval**: Select `1m` for the highest fidelity microstructure analysis.

### 2. Market Open (09:00 IST)
1.  Check the **Strategic Morning Brief** in the Insights tab for the day's macro-bias.
2.  Monitor the **AI HUD** for early-session liquidity traps or regime shifts.
3.  Watch the **Order Book Imbalance** to see which side is "stacking" the book.

### 3. Executing Strategy
1.  Use **Options Tab** to find strikes with high IV-skew or OI buildup.
2.  Wait for an **AI Trade Card** or **Reflex Signal** (e.g., "CVD Divergence") for entry confirmation.
3.  Use **SMC Primitives** to identify Order Blocks and Fair Value Gaps for precise stop-loss placement.

### 4. Risk Management
1.  Keep an eye on the **Toxicity (VPIN)** gauge. If it turns red, switch to limit-orders only or reduce size.
2.  Use the **Max Pain** level on the chart as a target for expiry-week mean reversion.

---

*This guide was generated on May 21, 2026, for the Chart Studio Prop-Desk environment.*
