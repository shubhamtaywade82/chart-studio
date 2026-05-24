import crypto from 'crypto';
import https from 'https';
import { OrderRouter, OrderParams, OrderResult, Position } from '@chart-studio/adapter-core';

const COINDCX_BASE = 'https://api.coindcx.com';

export interface CoinDCXConfig {
  apiKey: string;
  apiSecret: string;
}

export class CoinDCXRouter implements OrderRouter {
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(config: CoinDCXConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
  }

  private _nowMs(): number {
    return Date.now();
  }

  private _sign(body: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(body).digest('hex');
  }

  private _signedHeaders(body: string): Record<string, string> {
    return {
      'X-AUTH-APIKEY': this.apiKey,
      'X-AUTH-SIGNATURE': this._sign(body),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private async _request(method: string, endpoint: string, payload: any = {}): Promise<any> {
    const bodyObj = { ...payload, timestamp: this._nowMs() };
    const body = JSON.stringify(bodyObj);
    const url = new URL(`${COINDCX_BASE}/${endpoint.replace(/^\//, '')}`);

    const options = {
      method,
      hostname: url.hostname,
      path: url.pathname,
      headers: this._signedHeaders(body),
      timeout: 10000, // 10s timeout
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`CoinDCX Error: ${json.message || data} (code: ${res.statusCode})`));
            } else {
              resolve(json);
            }
          } catch (e) {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`CoinDCX Error: ${data} (code: ${res.statusCode})`));
            } else {
              reject(new Error(`CoinDCX JSON Parse Error: ${e instanceof Error ? e.message : String(e)} | Data: ${data.slice(0, 100)}`));
            }
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`CoinDCX Request Timeout (${method} ${endpoint})`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  private _internalToCoinDCX(symbol: string): string {
    const s = symbol.toUpperCase();
    if (s.startsWith('B-') && s.includes('_')) return s;
    if (s.endsWith('USDT')) {
      const base = s.slice(0, -4);
      return `B-${base}_USDT`;
    }
    return s;
  }

  private _coindcxToInternal(pair: string): string {
    let p = pair.toUpperCase();
    if (p.startsWith('B-')) p = p.slice(2);
    const parts = p.split('_');
    if (parts.length >= 2) return `${parts[0]}${parts[1]}`;
    return p;
  }

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    const payload = {
      pair: this._internalToCoinDCX(params.symbol),
      side: params.side.toLowerCase(),
      order_type: params.type === 'MARKET' ? 'market_order' : 'limit_order',
      price: params.price,
      quantity: params.quantity,
      leverage: 1, // Default to 1 if not specified
      margin_type: 'isolated',
    };

    try {
      const res = await this._request('POST', 'exchange/v1/derivatives/futures/orders/create', payload);
      return {
        orderId: res.id || res.order_id || '',
        status: 'EXECUTED', // CoinDCX orders are often immediate or managed
        message: 'Order placed on CoinDCX',
      };
    } catch (err) {
      return {
        orderId: '',
        status: 'REJECTED',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async modifyOrder(orderId: string, params: Partial<OrderParams>): Promise<OrderResult> {
    throw new Error('Modify order not implemented for CoinDCX');
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this._request('POST', 'exchange/v1/derivatives/futures/orders/cancel', { id: orderId });
      return true;
    } catch {
      return false;
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      const resp = await this._request('POST', 'exchange/v1/derivatives/futures/positions', {
        page: '1',
        size: '100',
      });
      
      const rawPositions = Array.isArray(resp) ? resp : (resp.data || []);
      return rawPositions.map((raw: any) => ({
        symbol: this._coindcxToInternal(raw.pair || raw.symbol),
        netQty: parseFloat(raw.active_pos || raw.quantity || '0'),
        averagePrice: parseFloat(raw.avg_price || raw.entry_price || '0'),
        realizedPnl: parseFloat(raw.realized_pnl || '0'),
        unrealizedPnl: parseFloat(raw.unrealized_pnl || '0'),
      }));
    } catch (err) {
      console.error('[CoinDCXRouter] Failed to fetch positions:', err);
      return [];
    }
  }

  async getOrders(): Promise<any[]> {
    try {
      const resp = await this._request('POST', 'exchange/v1/derivatives/futures/orders', {
        status: 'open',
        page: '1',
        size: '100',
      });
      const rawOrders = Array.isArray(resp) ? resp : (resp.data || []);
      return rawOrders.map((raw: any) => ({
        orderId: raw.id || raw.order_id || '',
        symbol: this._coindcxToInternal(raw.pair || raw.symbol),
        side: (raw.side || 'buy').toUpperCase() as 'BUY' | 'SELL',
        qty: parseFloat(raw.quantity || '0'),
        type: raw.order_type || 'LIMIT',
        fillPrice: parseFloat(raw.avg_price || '0'),
        status: raw.status || 'OPEN',
        realizedDelta: 0,
        ts: raw.timestamp || Date.now(),
      }));
    } catch {
      return [];
    }
  }

  async getBalance(currency: string = 'USDT'): Promise<number> {
    try {
      const resp = await this._request('GET', 'exchange/v1/derivatives/futures/wallets');
      const wallets = Array.isArray(resp) ? resp : (resp.data || []);
      const wallet = wallets.find((w: any) => w.currency_short_name === currency || w.currency === currency);
      return wallet ? parseFloat(wallet.balance || '0') : 0;
    } catch (err) {
      console.error('[CoinDCXRouter] Failed to fetch balance:', err);
      return 0;
    }
  }

  async getTotalEquity(): Promise<number> {
    try {
      const resp = await this._request('GET', 'exchange/v1/derivatives/futures/positions/cross_margin_details');
      return parseFloat(resp.total_equity || resp.equity || '0');
    } catch {
      // Fallback to balance + unrealized PnL if cross_margin_details fails
      const balance = await this.getBalance();
      const positions = await this.getPositions();
      const unrealized = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
      return balance + unrealized;
    }
  }
}
