export type TradingMode = 'paper' | 'live';

export interface Position {
  symbol: string;
  netQty: number;
  averagePrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

export interface TradeRecord {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  type: string;
  fillPrice: number;
  status: string;
  realizedDelta: number;
  ts: number;
}

export interface TradingSnapshot {
  mode: TradingMode;
  wallet: { paper_mode: boolean; start_equity: number; available: number; total_equity: number };
  stats: {
    win_rate: number | null;
    total_pnl: number;
    realized_pnl: number;
    unrealized_pnl: number;
    wins: number;
    losses: number;
    closed_trades: number;
  };
  execution_health: { healthy: boolean; category: string };
  operational_state: {
    execution_mode_label: string;
    paper_trading: boolean;
    auto_entry_allowed: boolean;
    entry_blocked: boolean;
    kill_switch: { state: string; total_pnl_usd: number; halt_at_or_below_usd: number; blocks: boolean };
    risk_gates: {
      daily_loss_cap: { realized_pnl: number; loss_cap_usd: number; blocks: boolean };
      margin_utilization: { exposure_usd: number; utilization_pct: number; max_utilization_pct: number; blocks: boolean };
      concurrent_positions: { current: number; max: number; blocks: boolean };
    };
    blockers: { code: string; message: string }[];
    trading_session: { id: number; strategy: string; status: string; capital_usd: number; started_at: string };
  };
  positions: Position[];
  orders: TradeRecord[];
}

export interface OrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  type: 'MARKET' | 'LIMIT' | 'SL';
  price?: number;
  product: 'INTRADAY' | 'DELIVERY' | 'MARGIN';
}

export interface OrderResult {
  orderId: string;
  status: 'PENDING' | 'EXECUTED' | 'REJECTED';
  message?: string;
  fillPrice?: number;
}

const wsUrlFromLocation = (): string => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
};

/** REST snapshot loader + dedicated WS listener for `type:'trading'` push frames. */
export class TradingClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(snap: TradingSnapshot) => void>();

  constructor() {
    this.connect();
  }

  onUpdate(fn: (snap: TradingSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async refresh(): Promise<TradingSnapshot | null> {
    try {
      const r = await fetch('/api/trading/account');
      if (!r.ok) return null;
      const snap = (await r.json()) as TradingSnapshot;
      this.emit(snap);
      return snap;
    } catch {
      return null;
    }
  }

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    const r = await fetch('/api/trading/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return (await r.json()) as OrderResult;
  }

  async setMode(mode: TradingMode): Promise<TradingMode> {
    const r = await fetch('/api/trading/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    const data = (await r.json()) as { mode: TradingMode };
    return data.mode;
  }

  private emit(snap: TradingSnapshot): void {
    for (const fn of this.listeners) fn(snap);
  }

  private connect(): void {
    const ws = new WebSocket(wsUrlFromLocation());
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      try {
        const frame = JSON.parse(ev.data as string);
        if (frame?.type === 'trading' && frame.data) this.emit(frame.data as TradingSnapshot);
      } catch {
        /* ignore non-trading frames */
      }
    });
    ws.addEventListener('close', () => this.scheduleReconnect());
    ws.addEventListener('error', () => ws.close());
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }
}
