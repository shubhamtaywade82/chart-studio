import { OrderRouter, OrderParams, OrderResult, Position } from './order-router';

export class PaperRouter implements OrderRouter {
  private positions = new Map<string, Position>();
  private orderIdCounter = 1;
  
  // A real implementation would subscribe to LTP updates or order book
  // Here we just accept an injected getLtp function
  constructor(private readonly getLtp: (symbol: string) => number) {}

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    const ltp = this.getLtp(params.symbol) || (params.price ?? 0);
    if (ltp <= 0) {
      return { orderId: '', status: 'REJECTED', message: 'No market data available for fill' };
    }

    // Slippage model: 0.1% slippage for market orders
    const slippage = params.type === 'MARKET' ? (params.side === 'BUY' ? 1.001 : 0.999) : 1;
    const fillPrice = ltp * slippage;

    const id = `paper_${this.orderIdCounter++}`;
    
    // Update position
    let pos = this.positions.get(params.symbol);
    if (!pos) {
      pos = { symbol: params.symbol, netQty: 0, averagePrice: 0, realizedPnl: 0, unrealizedPnl: 0 };
      this.positions.set(params.symbol, pos);
    }
    
    const fillQty = params.side === 'BUY' ? params.quantity : -params.quantity;
    
    // Simple average price math
    if (Math.sign(pos.netQty) === Math.sign(fillQty) || pos.netQty === 0) {
      // increasing position
      const newQty = pos.netQty + fillQty;
      pos.averagePrice = ((pos.averagePrice * Math.abs(pos.netQty)) + (fillPrice * Math.abs(fillQty))) / Math.abs(newQty);
      pos.netQty = newQty;
    } else {
      // decreasing position (realizing PnL)
      if (Math.abs(fillQty) <= Math.abs(pos.netQty)) {
        const pnl = (fillPrice - pos.averagePrice) * Math.abs(fillQty) * (pos.netQty > 0 ? 1 : -1);
        pos.realizedPnl += pnl;
        pos.netQty += fillQty;
      } else {
        // flipping position
        const closingQty = Math.abs(pos.netQty);
        const openingQty = Math.abs(fillQty) - closingQty;
        const pnl = (fillPrice - pos.averagePrice) * closingQty * (pos.netQty > 0 ? 1 : -1);
        pos.realizedPnl += pnl;
        pos.netQty = params.side === 'BUY' ? openingQty : -openingQty;
        pos.averagePrice = fillPrice;
      }
    }

    return {
      orderId: id,
      status: 'EXECUTED',
      fillPrice,
      message: `Paper filled at ${fillPrice.toFixed(2)}`
    };
  }

  async modifyOrder(orderId: string, params: Partial<OrderParams>): Promise<OrderResult> {
    return { orderId, status: 'REJECTED', message: 'Modify not supported in paper mode for market orders' };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    return false;
  }

  async getPositions(): Promise<Position[]> {
    const list = Array.from(this.positions.values());
    for (const p of list) {
      const ltp = this.getLtp(p.symbol);
      if (ltp > 0) {
        p.unrealizedPnl = (ltp - p.averagePrice) * p.netQty;
      }
    }
    return list;
  }
}
