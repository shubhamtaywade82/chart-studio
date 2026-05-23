import WebSocket from 'ws';
import type { TokenProvider, DhanCreds } from './token-provider';
import { getIndianMarketStatus } from './market-time';

/**
 * Dhan v2 Live Market Feed binary protocol.
 *
 * Subscribe in JSON, receive binary frames little-endian:
 *   Header (8 bytes): code(1) | length(2) | exchSeg(1) | securityId(4)
 *   Ticker (code 2):     LTP(f32), LTT(i32)                                  [16 bytes]
 *   Quote  (code 4):     LTP, LTQ(i16), LTT, ATP, Volume(i32), TSQ, TBQ,
 *                        Open, Close, High, Low                              [50 bytes]
 *   OI     (code 5):     OI(i32)                                             [12 bytes]
 *   PrevClose (code 6):  PrevClose(f32), PrevOi(i32)                         [16 bytes]
 *   Full   (code 8):     LTP, LTQ(i16), LTT, ATP, Vol, TSQ, TBQ, OI, HighOi,
 *                        LowOi, Open, Close, High, Low,
 *                        then 5×(bidQty, askQty, bidOrders, askOrders,
 *                                 bidPx, askPx)                              [162 bytes]
 *   Disconnect (code 50): reason(i16)                                        [10 bytes]
 *
 * Subscription:
 *   { RequestCode: 15|17|21, InstrumentCount: N,
 *     InstrumentList: [{ ExchangeSegment, SecurityId }] }
 * RequestCode (Dhan v2): 15=Ticker, 17=Quote, 21=Full.
 * We use 21 by default so we get full top-5 depth + OI + LTP in one stream.
 */

const FEED_BASE = 'wss://api-feed.dhan.co';
// Request codes (Dhan v2): 15=Ticker, 17=Quote, 21=Full.
const REQ_TICKER = 15;
const REQ_QUOTE  = 17;
const REQ_FULL   = 21;
const REQ_DISCONNECT = 12;

// Response codes (Dhan v2): byte 0 of every frame.
const RESP_TICKER     = 2;
const RESP_QUOTE      = 4;
const RESP_OI         = 5;
const RESP_PREV_CLOSE = 6;
const RESP_FULL       = 8;
const RESP_DISCONNECT = 50;

/**
 * Dhan v2 Exchange Segment enums (byte 4 of each frame's 8-byte header).
 * Verified against https://dhanhq.co/docs/v2/annexure-codes/.
 */
export const ExchangeSegment = {
  IDX_I:        0, // Index value
  NSE_EQ:       1, // NSE Equity Cash
  NSE_FNO:      2, // NSE Futures & Options
  NSE_CURRENCY: 3, // NSE Currency
  BSE_EQ:       4, // BSE Equity Cash
  MCX_COMM:     5, // MCX Commodity
  BSE_CURRENCY: 7, // BSE Currency
  BSE_FNO:      8, // BSE Futures & Options
} as const;

export type ExchangeSegmentCode = typeof ExchangeSegment[keyof typeof ExchangeSegment];

const SEGMENT_CODE_TO_STRING: Record<number, string> = {
  [ExchangeSegment.IDX_I]:        'IDX_I',
  [ExchangeSegment.NSE_EQ]:       'NSE_EQ',
  [ExchangeSegment.NSE_FNO]:      'NSE_FNO',
  [ExchangeSegment.NSE_CURRENCY]: 'NSE_CURRENCY',
  [ExchangeSegment.BSE_EQ]:       'BSE_EQ',
  [ExchangeSegment.MCX_COMM]:     'MCX_COMM',
  [ExchangeSegment.BSE_CURRENCY]: 'BSE_CURRENCY',
  [ExchangeSegment.BSE_FNO]:      'BSE_FNO',
};

export const SEGMENT_STRING_TO_CODE: Record<string, number> = {
  IDX_I:        ExchangeSegment.IDX_I,
  NSE_EQ:       ExchangeSegment.NSE_EQ,
  NSE_FNO:      ExchangeSegment.NSE_FNO,
  NSE_CURRENCY: ExchangeSegment.NSE_CURRENCY,
  BSE_EQ:       ExchangeSegment.BSE_EQ,
  MCX_COMM:     ExchangeSegment.MCX_COMM,
  BSE_CURRENCY: ExchangeSegment.BSE_CURRENCY,
  BSE_FNO:      ExchangeSegment.BSE_FNO,
};

export const resolveSegmentCode = (segment: string): number => {
  const code = SEGMENT_STRING_TO_CODE[segment.toUpperCase()];
  if (code === undefined) {
    throw new Error(`Unknown exchange segment: ${segment}. Valid: ${Object.keys(SEGMENT_STRING_TO_CODE).join(', ')}`);
  }
  return code;
};

export const resolveSegmentString = (code: number): string =>
  SEGMENT_CODE_TO_STRING[code] ?? `UNKNOWN_${code}`;

export interface DhanTick {
  /** Raw exchange segment byte from header (0..8). */
  exchangeSegmentCode: number;
  /** String form ('NSE_EQ', 'IDX_I', etc.) resolved from the code. */
  exchangeSegmentString: string;
  /** Backwards-compat: numeric code. Prefer exchangeSegmentString for keys. */
  exchangeSegment: number;
  securityId: number;
  /** Local receive timestamp (ms). */
  ts: number;
  /** Response code (RESP_TICKER=2, RESP_QUOTE=4, RESP_OI=5, RESP_PREV_CLOSE=6, RESP_FULL=8, RESP_DISCONNECT=50). */
  code: number;
  ltp?: number;
  ltq?: number;
  /** Epoch seconds (NOT ms). */
  ltt?: number;
  atp?: number;
  volume?: number;
  totalBuyQty?: number;
  totalSellQty?: number;
  open?: number;
  close?: number;
  high?: number;
  low?: number;
  openInterest?: number;
  /** NSE_FNO only (day high OI). */
  highOi?: number;
  /** NSE_FNO only (day low OI). */
  lowOi?: number;
  /** 5-level depth with [price, qty, orders] per side. */
  bids?: Array<[number, number, number]>;
  asks?: Array<[number, number, number]>;
  /** Order count per bid level (also surfaced separately for heatmaps). */
  bidOrders?: number[];
  /** Order count per ask level. */
  askOrders?: number[];
  /** Prev close (from code 6). */
  prevClose?: number;
  /** Prev OI (from code 6). */
  prevOi?: number;
  /** Reason code from disconnect frame (code 50). */
  disconnectReason?: number;
}

export interface DhanSubscription {
  exchangeSegment: string;
  securityId: string;
}

type Handler = (tick: DhanTick) => void;

interface InternalSub {
  ins: DhanSubscription;
  /** Maps Dhan's numeric segment back to the string segment used by handlers. */
  fns: Set<Handler>;
}

const parseTick = (buf: Buffer): DhanTick | null => {
  if (buf.length < 8) return null;
  const code = buf.readUInt8(0);
  // bytes 1-2: message length (skipped)
  const exchangeSegmentCode = buf.readUInt8(3);
  const securityId = buf.readInt32LE(4);
  const exchangeSegmentString = resolveSegmentString(exchangeSegmentCode);
  const t: DhanTick = {
    exchangeSegmentCode,
    exchangeSegmentString,
    exchangeSegment: exchangeSegmentCode,
    securityId,
    ts: Date.now(),
    code,
  };

  if (code === RESP_TICKER && buf.length >= 16) {
    let p = 8;
    t.ltp = buf.readFloatLE(p); p += 4;
    t.ltt = buf.readInt32LE(p);
    return t;
  }

  if (code === RESP_QUOTE && buf.length >= 50) {
    let p = 8;
    t.ltp          = buf.readFloatLE(p); p += 4;
    t.ltq          = buf.readInt16LE(p); p += 2;
    t.ltt          = buf.readInt32LE(p); p += 4;
    t.atp          = buf.readFloatLE(p); p += 4;
    t.volume       = buf.readInt32LE(p); p += 4;
    t.totalSellQty = buf.readInt32LE(p); p += 4;
    t.totalBuyQty  = buf.readInt32LE(p); p += 4;
    t.open         = buf.readFloatLE(p); p += 4;
    t.close        = buf.readFloatLE(p); p += 4;
    t.high         = buf.readFloatLE(p); p += 4;
    t.low          = buf.readFloatLE(p);
    return t;
  }

  if (code === RESP_OI && buf.length >= 12) {
    t.openInterest = buf.readInt32LE(8);
    return t;
  }

  if (code === RESP_PREV_CLOSE && buf.length >= 16) {
    t.prevClose = buf.readFloatLE(8);
    t.prevOi    = buf.readInt32LE(12);
    return t;
  }

  if (code === RESP_FULL && buf.length >= 162) {
    let p = 8;
    t.ltp          = buf.readFloatLE(p); p += 4;
    t.ltq          = buf.readInt16LE(p); p += 2;
    t.ltt          = buf.readInt32LE(p); p += 4;
    t.atp          = buf.readFloatLE(p); p += 4;
    t.volume       = buf.readInt32LE(p); p += 4;
    t.totalSellQty = buf.readInt32LE(p); p += 4;
    t.totalBuyQty  = buf.readInt32LE(p); p += 4;
    t.openInterest = buf.readInt32LE(p); p += 4;
    t.highOi       = buf.readInt32LE(p); p += 4;
    t.lowOi        = buf.readInt32LE(p); p += 4;
    t.open         = buf.readFloatLE(p); p += 4;
    t.close        = buf.readFloatLE(p); p += 4;
    t.high         = buf.readFloatLE(p); p += 4;
    t.low          = buf.readFloatLE(p); p += 4;

    const bids: Array<[number, number, number]> = [];
    const asks: Array<[number, number, number]> = [];
    const bidOrders: number[] = [];
    const askOrders: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const bidQty = buf.readInt32LE(p);     p += 4;
      const askQty = buf.readInt32LE(p);     p += 4;
      const bidOrd = buf.readInt16LE(p);     p += 2;
      const askOrd = buf.readInt16LE(p);     p += 2;
      const bidPx  = buf.readFloatLE(p);     p += 4;
      const askPx  = buf.readFloatLE(p);     p += 4;
      bids.push([bidPx, bidQty, bidOrd]);
      asks.push([askPx, askQty, askOrd]);
      bidOrders.push(bidOrd);
      askOrders.push(askOrd);
    }
    t.bids = bids;
    t.asks = asks;
    t.bidOrders = bidOrders;
    t.askOrders = askOrders;
    return t;
  }

  if (code === RESP_DISCONNECT && buf.length >= 10) {
    t.disconnectReason = buf.readInt16LE(8);
    return t;
  }

  return null;
};

export class DhanStreamPool {
  private ws: WebSocket | null = null;
  private readonly subs = new Map<string, InternalSub>(); // key = `${seg}:${secId}`
  private readonly lastTicks = new Map<string, DhanTick>(); // key = `${seg}:${secId}`
  /** Deduplicates ticks that arrive from both primary and staging during MBB overlap. */
  private readonly lastExchangeTs = new Map<string, number>(); // key = `${seg}:${secId}`, value = ltt (epoch s)
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private marketCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closed = false;
  private mode: number;
  /** Throttle for unmatched-tick warnings. */
  private unmatchedWarned = 0;
  /** Timestamp (ms) of last received frame. Used to detect data starvation. */
  private lastFrameAt = 0;
  /** Periodic heartbeat tick to detect dead/silent sockets. */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** Staging socket used during Make-Before-Break token rotation. */
  private pendingMbb: WebSocket | null = null;
  /** Public mode field so callers can verify (e.g. depth requires REQ_FULL). */
  get currentMode(): number { return this.mode; }

  constructor(private readonly tokens: TokenProvider, mode: 'ticker' | 'quote' | 'full' = 'full') {
    this.mode = mode === 'ticker' ? REQ_TICKER : mode === 'quote' ? REQ_QUOTE : REQ_FULL;
    this.checkMarketHours();

    // Make-Before-Break token rotation: establish a secondary socket with the new
    // creds before tearing down the primary, eliminating the ~1-3s data gap that
    // a hard terminate would cause.
    this.tokens.onRotate?.((newCreds: DhanCreds) => {
      if (this.closed) return;
      console.log('[adapter-dhanhq] token rotated, initiating make-before-break rotation');
      void this.makeBeforeBreak(newCreds);
    });
  }

  getLastTick(symbol: string): DhanTick | undefined {
    // Symbol is usually segment:secId (e.g. NSE_EQ:11536)
    return this.lastTicks.get(symbol);
  }

  subscribe(ins: DhanSubscription, fn: Handler): () => void {
    const key = `${ins.exchangeSegment}:${ins.securityId}`;
    let entry = this.subs.get(key);
    if (!entry) {
      entry = { ins, fns: new Set() };
      this.subs.set(key, entry);
      this.sendSub([ins]);
    }
    entry.fns.add(fn);
    this.ensureConnected();
    return () => {
      const e = this.subs.get(key);
      if (!e) return;
      e.fns.delete(fn);
      if (e.fns.size === 0) {
        this.subs.delete(key);
        // Dhan v2 has no per-instrument unsubscribe; we just stop relaying.
      }
    };
  }

  shutdown(): void {
    this.closed = true;
    if (this.marketCheckTimer) clearTimeout(this.marketCheckTimer);
    this.shutdownWs();
  }

  /**
   * Data-starvation watchdog. Dhan v2 doesn't expose a ping/pong protocol,
   * so we use TCP-level WebSocket pings AND a 30-second idle threshold:
   * if no frame in 30s with active subs, force-reconnect.
   */
  private checkMarketHours(): void {
    if (this.marketCheckTimer) clearTimeout(this.marketCheckTimer);
    
    const status = getIndianMarketStatus();
    if (!status.isOpen) {
      if (this.ws) {
        console.log(`[adapter-dhanhq] Market closed (${status.reason}). Disconnecting...`);
        this.shutdownWs();
      }
    } else if (this.subs.size > 0 && !this.ws) {
      console.log(`[adapter-dhanhq] Market open. Resuming connections...`);
      this.ensureConnected();
    }

    this.marketCheckTimer = setTimeout(() => this.checkMarketHours(), status.nextCheckMs);
  }

  private shutdownWs(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    if (this.ws) {
      try { this.ws.removeAllListeners(); this.ws.terminate(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastFrameAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.ping(); } catch { /* noop */ }

      if (this.subs.size === 0) return; // nothing subscribed → no expectation
      const idle = Date.now() - this.lastFrameAt;
      if (idle > 30_000) {
        console.warn(`[adapter-dhanhq] data starvation (${idle}ms idle, ${this.subs.size} subs) — forcing reconnect`);
        try { ws.terminate(); } catch { /* close handler will reconnect */ }
      }
    }, 10_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private ensureConnected(): void {
    if (this.closed) return;
    
    // Validate market hours before connecting
    const status = getIndianMarketStatus();
    if (!status.isOpen) {
      console.log(`[adapter-dhanhq] Connection deferred: ${status.reason}`);
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    void this.connect();
  }

  private scheduleReconnectAfterError(isRateLimit = false): void {
    if (this.closed) return;
    const attempt = ++this.reconnectAttempts;
    // Base exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s
    let delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
    
    // If rate limited, wait at least 15 seconds to allow server session cleanup
    if (isRateLimit) {
      delay = Math.max(delay, 15_000);
      console.warn(`[adapter-dhanhq] Rate limit detected (429). Backing off for ${delay}ms before retry #${attempt}`);
    }
    
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private async connect(): Promise<void> {
    if (this.closed) return;

    // Clear any existing connection if called unexpectedly
    if (this.ws) {
      try { this.ws.terminate(); } catch { /* noop */ }
      this.ws = null;
    }

    let creds;
    try {
      creds = await this.tokens.get();
    } catch (err) {
      console.error('[adapter-dhanhq] token resolve failed', err);
      this.scheduleReconnectAfterError();
      return;
    }
    if (this.closed) return;
    const url = `${FEED_BASE}?version=2&token=${encodeURIComponent(creds.accessToken)}&clientId=${encodeURIComponent(creds.clientId)}&authType=2`;
    console.log(`[adapter-dhanhq] Connecting to WebSocket (clientId: ${creds.clientId})`);
    const ws = new WebSocket(url);
    this.ws = ws;

    // Handle unexpected response codes (like 429) before 'open'
    ws.on('unexpected-response', (req, res) => {
      console.error(`[adapter-dhanhq] WebSocket unexpected response: ${res.statusCode} ${res.statusMessage}`);
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      const is429 = res.statusCode === 429;
      this.scheduleReconnectAfterError(is429);
      try { ws.terminate(); } catch { /* noop */ }
    });

    ws.on('open', () => {
      console.log('[adapter-dhanhq] WebSocket connection opened successfully.');
      this.reconnectAttempts = 0;
      const list: DhanSubscription[] = [...this.subs.values()].map((s) => s.ins);
      if (list.length > 0) {
        console.log(`[adapter-dhanhq] Re-subscribing to ${list.length} instruments on connection open`);
        this.sendSubToWs(ws, list);
      }
      this.startHeartbeat();
    });

    this.attachHandlers(ws);
  }

  /**
   * Attaches the production message/close/error/pong handlers to a socket.
   * Called for both normal connections and after MBB cutover.
   */
  private attachHandlers(ws: WebSocket): void {
    ws.on('pong', () => { this.lastFrameAt = Date.now(); });

    ws.on('message', (raw) => {
      if (!(raw instanceof Buffer)) return;
      this.lastFrameAt = Date.now();

      // Validate header length field if present. Reject obviously truncated frames
      // so we don't read garbage past the buffer end.
      if (raw.length >= 8) {
        const msgLen = raw.readInt16LE(1);
        if (msgLen > 0 && raw.length < msgLen) {
          if (this.unmatchedWarned < 5) {
            this.unmatchedWarned += 1;
            console.warn(`[adapter-dhanhq] truncated frame: header says ${msgLen} bytes, got ${raw.length}`);
          }
          return;
        }
      }

      const tick = parseTick(raw);
      if (!tick) return;

      // Disconnect frames are not symbol-routed; just log the reason.
      if (tick.code === RESP_DISCONNECT) {
        console.warn(`[adapter-dhanhq] server disconnect, reason=${tick.disconnectReason}`);
        return;
      }

      const segStr = tick.exchangeSegmentString;
      if (!segStr || segStr.startsWith('UNKNOWN_')) {
        if (this.unmatchedWarned < 5) {
          this.unmatchedWarned += 1;
          console.warn(`[adapter-dhanhq] unknown segment code ${tick.exchangeSegmentCode} for securityId=${tick.securityId}`);
        }
        return;
      }
      const key = `${segStr}:${tick.securityId}`;

      // Deduplicate ticks that arrive from both the primary and staging sockets
      // during an MBB overlap window, using the exchange-side trade timestamp.
      if (tick.ltt !== undefined) {
        const lastLtt = this.lastExchangeTs.get(key) ?? 0;
        if (tick.ltt <= lastLtt) return;
        this.lastExchangeTs.set(key, tick.ltt);
      }

      // Update LTP cache
      const existing = this.lastTicks.get(key);
      if (existing) {
        Object.assign(existing, tick);
      } else {
        this.lastTicks.set(key, { ...tick });
      }

      const entry = this.subs.get(key);
      if (entry) {
        for (const fn of entry.fns) fn(tick);
      } else if (this.unmatchedWarned < 5) {
        this.unmatchedWarned += 1;
        console.warn(`[adapter-dhanhq] unmatched tick segment=${segStr} secId=${tick.securityId} (active keys: ${[...this.subs.keys()].slice(0, 5).join(',')})`);
      }
    });

    ws.on('error', (err) => {
      console.error('[adapter-dhanhq] WebSocket error occurred:', err);
    });

    ws.on('close', (code, reason) => {
      console.warn(`[adapter-dhanhq] WebSocket closed: code=${code}, reason=${reason ? reason.toString() : 'none'}`);
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      if (this.closed) return;
      // 401-equivalent close codes — refresh token before next reconnect.
      if (code === 1008 || code === 4001 || code === 4003) {
        console.warn('[adapter-dhanhq] Invalid or expired credentials code detected. Invalidating token.');
        this.tokens.invalidate();
      }
      this.scheduleReconnectAfterError();
    });
  }

  /**
   * Make-Before-Break token rotation protocol:
   * 1. Establish a secondary socket with the new token.
   * 2. Re-subscribe all instruments on the secondary.
   * 3. Wait for the first valid data tick on the secondary.
   * 4. Promote secondary to primary; attach production handlers.
   * 5. Terminate the old primary.
   *
   * Ticks arriving from both sockets during the overlap are deduplicated via
   * lastExchangeTs (exchange-side ltt timestamp).
   */
  private async makeBeforeBreak(newCreds: DhanCreds): Promise<void> {
    if (this.pendingMbb) {
      console.log('[adapter-dhanhq] MBB already in progress, skipping duplicate rotation');
      return;
    }

    const url = `${FEED_BASE}?version=2&token=${encodeURIComponent(newCreds.accessToken)}&clientId=${encodeURIComponent(newCreds.clientId)}&authType=2`;
    console.log('[adapter-dhanhq] MBB: establishing secondary socket');
    const staging = new WebSocket(url);
    this.pendingMbb = staging;

    const fallback = (): void => {
      this.pendingMbb = null;
      try { staging.removeAllListeners(); staging.terminate(); } catch { /* noop */ }
      // Fall back to a hard reconnect so we don't stay on a stale token.
      if (this.ws) {
        try { this.ws.terminate(); } catch { /* noop */ }
      } else {
        this.ensureConnected();
      }
    };

    const mbbTimeout = setTimeout(() => {
      console.warn('[adapter-dhanhq] MBB: secondary socket timed out (10s), falling back to hard reconnect');
      fallback();
    }, 10_000);

    const onStagingError = (): void => {
      clearTimeout(mbbTimeout);
      console.warn('[adapter-dhanhq] MBB: secondary socket error, falling back to hard reconnect');
      fallback();
    };

    const onStagingMessage = (raw: WebSocket.RawData): void => {
      if (!(raw instanceof Buffer)) return;
      const tick = parseTick(raw);
      // Wait for the first real data tick (not a disconnect or unparseable frame).
      if (!tick || tick.code === RESP_DISCONNECT) return;

      clearTimeout(mbbTimeout);
      this.pendingMbb = null;
      staging.removeListener('message', onStagingMessage);
      staging.removeListener('error', onStagingError);

      console.log('[adapter-dhanhq] MBB: secondary socket live — cutting over primary');
      const oldWs = this.ws;

      // Promote staging to primary before attaching production handlers so that
      // the close handler's `this.ws !== ws` guard works correctly.
      this.stopHeartbeat();
      this.ws = staging;
      this.reconnectAttempts = 0;
      this.attachHandlers(staging);
      this.startHeartbeat();

      // Deliver the first tick that triggered the cutover.
      const segStr = tick.exchangeSegmentString;
      if (segStr && !segStr.startsWith('UNKNOWN_')) {
        const key = `${segStr}:${tick.securityId}`;
        if (tick.ltt !== undefined) {
          const lastLtt = this.lastExchangeTs.get(key) ?? 0;
          if (tick.ltt > lastLtt) {
            this.lastExchangeTs.set(key, tick.ltt);
            const entry = this.subs.get(key);
            if (entry) {
              for (const fn of entry.fns) fn(tick);
            }
          }
        }
      }

      // Gracefully close the old primary — its handlers will no-op because
      // `this.ws !== oldWs` after promotion.
      if (oldWs) {
        try { oldWs.removeAllListeners(); oldWs.terminate(); } catch { /* noop */ }
      }
    };

    staging.once('error', onStagingError);
    staging.on('message', onStagingMessage);

    staging.once('open', () => {
      const list = [...this.subs.values()].map(s => s.ins);
      if (list.length > 0) {
        this.sendSubToWs(staging, list);
      }
    });
  }

  private sendSub(instruments: DhanSubscription[]): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) { this.ensureConnected(); return; }
    this.sendSubToWs(ws, instruments);
  }

  /** Sends subscription messages to a specific WebSocket (used by both normal and MBB paths). */
  private sendSubToWs(ws: WebSocket, instruments: DhanSubscription[]): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    // Group instruments by resolved RequestCode.
    // Indices (IDX_I) do not support Full Feed (RequestCode 21), so they must use Quote (17) or Ticker (15).
    const groups = new Map<number, DhanSubscription[]>();
    for (const ins of instruments) {
      const rc = ins.exchangeSegment.toUpperCase() === 'IDX_I'
        ? (this.mode === REQ_TICKER ? REQ_TICKER : REQ_QUOTE)
        : this.mode;
      let list = groups.get(rc);
      if (!list) {
        list = [];
        groups.set(rc, list);
      }
      list.push(ins);
    }

    // Send subscription messages for each RequestCode in chunks of 100
    for (const [rc, list] of groups.entries()) {
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        const body = {
          RequestCode: rc,
          InstrumentCount: chunk.length,
          InstrumentList: chunk.map((ins) => ({
            ExchangeSegment: ins.exchangeSegment,
            SecurityId: ins.securityId,
          })),
        };
        console.log(`[adapter-dhanhq] Subscribing: RequestCode=${rc}, count=${chunk.length}, instruments=${chunk.map(c => `${c.exchangeSegment}:${c.securityId}`).join(',')}`);
        try { ws.send(JSON.stringify(body)); } catch (err) {
          console.error('[adapter-dhanhq] Failed to send subscription message', err);
        }
      }
    }
  }
}
