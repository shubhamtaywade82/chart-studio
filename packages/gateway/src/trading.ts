import { PaperRouter } from '@chart-studio/adapter-core';
import type { OrderParams, OrderResult, Position } from '@chart-studio/adapter-core';
import { CoinDCXRouter } from './coindcx-router';

export type TradingMode = 'paper' | 'live';

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

export interface RiskGate {
  blocks: boolean;
  [k: string]: unknown;
}

export interface TradingSnapshot {
  mode: TradingMode;
  wallet: {
    paper_mode: boolean;
    start_equity: number;
    available: number;
    total_equity: number;
  };
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

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Multi-mode trading desk. Wraps PaperRouter for simulation and CoinDCXRouter
 * for live execution. LIVE mode fetches real positions and wallet data.
 */
export class TradingDesk {
  private readonly ltp = new Map<string, number>();
  private readonly paper: PaperRouter;
  private readonly live: CoinDCXRouter | null = null;
  private readonly trades: TradeRecord[] = [];
  private readonly startEquity: number;
  private readonly maxConcurrent: number;
  private readonly dailyLossCapPct: number;
  private readonly maxUtilPct: number;
  private readonly killSwitchLossUsd: number;
  private readonly sessionStartedAt = new Date().toISOString();

  private mode: TradingMode = 'paper';
  private wins = 0;
  private losses = 0;
  private onChange: (() => void) | null = null;

  constructor() {
    this.startEquity = num(process.env.PAPER_START_EQUITY, 100_000);
    this.maxConcurrent = num(process.env.RISK_MAX_CONCURRENT, 5);
    this.dailyLossCapPct = num(process.env.RISK_DAILY_LOSS_CAP_PCT, 5);
    this.maxUtilPct = num(process.env.RISK_MAX_UTIL_PCT, 60);
    this.killSwitchLossUsd = num(process.env.KILL_SWITCH_LOSS_USD, this.startEquity * 0.1);
    this.paper = new PaperRouter((s) => this.ltp.get(s) ?? 0);

    const apiKey = process.env.COINDCX_API_KEY;
    const apiSecret = process.env.COINDCX_API_SECRET;
    if (apiKey && apiSecret) {
      this.live = new CoinDCXRouter({ apiKey, apiSecret });
    }
  }

  setLtp(symbol: string, price: number): void {
    if (price > 0) this.ltp.set(symbol, price);
  }

  onSnapshot(fn: () => void): void {
    this.onChange = fn;
  }

  getMode(): TradingMode {
    return this.mode;
  }

  setMode(mode: TradingMode): TradingMode {
    if (mode === 'paper' || mode === 'live') this.mode = mode;
    this.onChange?.();
    return this.mode;
  }

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    if (this.mode === 'live') {
      if (!this.live) {
        return { orderId: '', status: 'REJECTED', message: 'LIVE mode requires COINDCX_API_KEY and COINDCX_API_SECRET' };
      }
      return this.live.placeOrder(params);
    }
    const before = await this.realizedTotal();
    const res = await this.paper.placeOrder(params);
    if (res.status === 'EXECUTED') {
      const after = await this.realizedTotal();
      const delta = after - before;
      if (delta > 0) this.wins++;
      else if (delta < 0) this.losses++;
      this.trades.unshift({
        orderId: res.orderId,
        symbol: params.symbol,
        side: params.side,
        qty: params.quantity,
        type: params.type,
        fillPrice: res.fillPrice ?? 0,
        status: res.status,
        realizedDelta: delta,
        ts: Date.now(),
      });
      if (this.trades.length > 200) this.trades.length = 200;
      this.onChange?.();
    }
    return res;
  }

  async positions(): Promise<Position[]> {
    if (this.mode === 'live' && this.live) {
      return this.live.getPositions();
    }
    return this.paper.getPositions();
  }

  async orders(): Promise<TradeRecord[]> {
    if (this.mode === 'live' && this.live) {
      try {
        const liveOrders = await this.live.getOrders();
        return liveOrders.slice(0, 50);
      } catch {
        return [];
      }
    }
    return this.trades.slice(0, 50);
  }

  private async realizedTotal(): Promise<number> {
    const pos = await this.positions();
    return pos.reduce((s, p) => s + p.realizedPnl, 0);
  }

  async snapshot(): Promise<TradingSnapshot> {
    const positions = await this.positions().catch(() => []);
    const realized = positions.reduce((s, p) => s + p.realizedPnl, 0);
    const unrealized = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
    const totalPnl = realized + unrealized;
    
    // Default to startEquity + PnL (derived)
    let totalEquity = this.startEquity + totalPnl;
    let available = totalEquity;

    if (this.mode === 'live' && this.live) {
      try {
        const liveEquity = await this.live.getTotalEquity();
        const liveBalance = await this.live.getBalance();
        
        // Only use live values if they are non-zero (or we explicitly trust 0 if the call succeeded)
        if (liveEquity > 0) totalEquity = liveEquity;
        if (liveBalance > 0) available = liveBalance;
        else if (liveEquity > 0) available = liveEquity; // Fallback available to equity if balance fetch failed
      } catch (err) {
        console.warn('[TradingDesk] Failed to fetch live wallet data, falling back to derived:', err);
      }
    }

    const exposure = positions.reduce(
      (s, p) => s + Math.abs(p.netQty) * (this.ltp.get(p.symbol) ?? p.averagePrice),
      0,
    );
    if (this.mode === 'paper' || (this.mode === 'live' && available === totalEquity && exposure > 0)) {
      available = totalEquity - exposure;
    }

    const openCount = positions.filter((p) => p.netQty !== 0).length;
    const closed = this.wins + this.losses;
    const winRate = closed > 0 ? (this.wins / closed) * 100 : null;

    const lossCapUsd = (this.mode === 'paper' ? this.startEquity : totalEquity) * (this.dailyLossCapPct / 100);
    const utilizationPct = totalEquity > 0 ? (exposure / totalEquity) * 100 : 0;

    const killBlocks = totalPnl <= -this.killSwitchLossUsd;
    const lossCapBlocks = realized <= -lossCapUsd;
    const utilBlocks = utilizationPct >= this.maxUtilPct;
    const concurrentBlocks = openCount >= this.maxConcurrent;

    const blockers: { code: string; message: string }[] = [];
    if (this.mode === 'paper') {
      if (killBlocks) blockers.push({ code: 'KILL_SWITCH', message: 'Portfolio loss breached kill-switch threshold' });
      if (lossCapBlocks) blockers.push({ code: 'DAILY_LOSS_CAP', message: 'Daily realized loss cap reached' });
      if (utilBlocks) blockers.push({ code: 'MARGIN_UTILIZATION', message: 'Margin utilization above limit' });
      if (concurrentBlocks) blockers.push({ code: 'CONCURRENT_POSITIONS', message: 'Max concurrent positions reached' });
    }

    const autoEntryAllowed = blockers.length === 0;
    const haveData = this.ltp.size > 0;

    const fin = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback;

    return {
      mode: this.mode,
      wallet: {
        paper_mode: this.mode === 'paper',
        start_equity: fin(this.mode === 'paper' ? this.startEquity : (totalEquity - totalPnl)),
        available: fin(available),
        total_equity: fin(totalEquity),
      },
      stats: {
        win_rate: this.wins + this.losses > 0 ? fin((this.wins / (this.wins + this.losses)) * 100, null as any) : null,
        total_pnl: fin(totalPnl),
        realized_pnl: fin(realized),
        unrealized_pnl: fin(unrealized),
        wins: this.wins,
        losses: this.losses,
        closed_trades: this.wins + this.losses,
      },
      execution_health: haveData || this.mode === 'live'
        ? { healthy: true, category: 'healthy' }
        : { healthy: false, category: 'no_market_data' },
      operational_state: {
        execution_mode_label: this.mode === 'paper' ? 'PAPER' : 'LIVE',
        paper_trading: this.mode === 'paper',
        auto_entry_allowed: autoEntryAllowed,
        entry_blocked: !autoEntryAllowed,
        kill_switch: {
          state: killBlocks ? 'halted' : 'armed',
          total_pnl_usd: fin(totalPnl),
          halt_at_or_below_usd: fin(-this.killSwitchLossUsd),
          blocks: killBlocks,
        },
        risk_gates: {
          daily_loss_cap: { realized_pnl: fin(realized), loss_cap_usd: fin(lossCapUsd), blocks: lossCapBlocks },
          margin_utilization: {
            exposure_usd: fin(exposure),
            utilization_pct: fin(utilizationPct),
            max_utilization_pct: fin(this.maxUtilPct),
            blocks: utilBlocks,
          },
          concurrent_positions: { current: openCount, max: this.maxConcurrent, blocks: concurrentBlocks },
        },
        blockers,
        trading_session: {
          id: 1,
          strategy: 'manual',
          status: 'active',
          capital_usd: fin(this.mode === 'paper' ? this.startEquity : totalEquity),
          started_at: this.sessionStartedAt,
        },
      },
      positions,
      orders: await this.orders(),
    };
  }
}
