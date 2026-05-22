import type {
  BookTicker,
  Candle,
  DepthDelta,
  InstrumentMeta,
  MarketDataProvider,
  OrderBookSnapshot,
  SymbolRef,
  Trade,
  Unsub,
} from '@chart-studio/adapter-core';

/**
 * [TEMPLATE] Market Data Provider
 * Replace 'Template' with your provider name (e.g., Bybit, Upstox).
 */
export class TemplateProvider implements MarketDataProvider {
  readonly id = 'template-id'; // Unique ID for Redis routing (e.g. 'bybit')
  readonly displayName = 'Template Provider';

  constructor() {
    // Initialize your REST client or local caches here
  }

  async init(): Promise<void> {
    // Load instrument list or authenticate
  }

  // ── Discovery ────────────────────────────────────────────────────────

  async searchSymbols(query: string, limit = 20): Promise<SymbolRef[]> {
    // Return list of symbols matching the query
    return [];
  }

  async listSymbols(): Promise<InstrumentMeta[]> {
    // Return all supported instruments
    return [];
  }

  async getInstrumentMeta(symbol: string): Promise<InstrumentMeta | null> {
    // Get details for a specific symbol
    return null;
  }

  // ── Snapshots (REST) ──────────────────────────────────────────────────

  async getCandles(symbol: string, interval: string, opts: { limit?: number } = {}): Promise<Candle[]> {
    // Fetch historical candles from Provider REST API
    return [];
  }

  async getOrderBook(symbol: string, limit = 100): Promise<OrderBookSnapshot | null> {
    // Fetch current depth snapshot from Provider REST API
    return null;
  }

  // ── Streams (WebSocket) ───────────────────────────────────────────────

  streamCandles(symbol: string, interval: string, onCandle: (c: Candle, isFinal: boolean) => void): Unsub {
    // 1. Subscribe to Provider WS kline/candle stream
    // 2. Map their JSON/Binary to our Candle interface
    // 3. Call onCandle(mappedCandle, isFinal)
    return () => { /* Logic to unsubscribe */ };
  }

  streamDepth(symbol: string, onDelta: (d: DepthDelta) => void): Unsub {
    // Subscribe to L2 depth updates
    return () => {};
  }

  streamTrades(symbol: string, onTrade: (t: Trade) => void): Unsub {
    // Subscribe to individual trade ticks
    return () => {};
  }

  streamBookTicker(symbol: string, onTicker: (t: BookTicker) => void): Unsub {
    // Subscribe to best bid/ask updates
    return () => {};
  }
}
