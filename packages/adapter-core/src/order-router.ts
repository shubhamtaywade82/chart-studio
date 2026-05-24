export interface OrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  type: 'MARKET' | 'LIMIT' | 'SL';
  price?: number;
  triggerPrice?: number;
  product: 'INTRADAY' | 'DELIVERY' | 'MARGIN';
}

export interface OrderResult {
  orderId: string;
  status: 'PENDING' | 'EXECUTED' | 'REJECTED';
  message?: string;
  fillPrice?: number;
}

export interface Position {
  symbol: string;
  netQty: number;
  averagePrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
  liquidationPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface OrderRouter {
  placeOrder(params: OrderParams): Promise<OrderResult>;
  modifyOrder(orderId: string, params: Partial<OrderParams>): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<boolean>;
  getPositions(): Promise<Position[]>;
}
