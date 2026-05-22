import { OrderRouter, OrderParams, OrderResult, Position } from '@chart-studio/adapter-core';
import type { TokenProvider } from './token-provider';

export class DhanOrderRouter implements OrderRouter {
  constructor(private readonly tokens: TokenProvider) {}

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    // Stub for DhanHQ POST /v2/orders
    console.log('[DhanOrderRouter] placeOrder request:', params);
    
    // Check SPAN margin (stub)
    const marginReq = params.quantity * (params.price || 100) * 0.15;
    console.log(`[DhanOrderRouter] SPAN margin required: ₹${marginReq}`);

    return {
      orderId: 'DHAN_' + Date.now(),
      status: 'PENDING',
      message: 'Order routed to DhanHQ (Stubbed)'
    };
  }

  async modifyOrder(orderId: string, params: Partial<OrderParams>): Promise<OrderResult> {
    return {
      orderId,
      status: 'PENDING',
      message: 'Modify request sent (Stubbed)'
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    console.log(`[DhanOrderRouter] cancelOrder: ${orderId}`);
    return true;
  }

  async getPositions(): Promise<Position[]> {
    // Stub for GET /v2/positions
    return [];
  }
}
