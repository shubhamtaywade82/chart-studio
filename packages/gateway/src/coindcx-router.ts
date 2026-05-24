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
  private detectedCurrency: string | null = null;

  constructor(config: CoinDCXConfig) {
    this.apiKey = config.apiKey.trim();
    this.apiSecret = config.apiSecret.trim();
  }

  private async _getCurrency(): Promise<string> {
    if (this.detectedCurrency) return this.detectedCurrency;
    try {
      const resp = await this._request('GET', 'exchange/v1/derivatives/futures/wallets');
      const wallets = Array.isArray(resp) ? resp : (resp.data || []);
      // Prefer USDT, fallback to INR, then anything
      const best = wallets.find((w: any) => w.currency_short_name === 'USDT')
        || wallets.find((w: any) => w.currency_short_name === 'INR')
        || wallets[0];
      if (best) {
        this.detectedCurrency = best.currency_short_name;
        console.log(`[CoinDCXRouter] Detected account currency: ${this.detectedCurrency}`);
        return this.detectedCurrency!;
      }
    } catch (err) {
      console.warn('[CoinDCXRouter] Currency detection failed, defaulting to USDT');
    }
    return 'USDT';
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
      'User-Agent': 'crypto-trader/4.0',
    };
  }

  private async _request(method: string, endpoint: string, payload: any = {}): Promise<any> {
    const bodyObj = { ...payload, timestamp: this._nowMs() };
    // Match Python's separators=(',', ':') to ensure identical signature
    const body = JSON.stringify(bodyObj).replace(/ /g, '');
    const url = new URL(`${COINDCX_BASE}/${endpoint.replace(/^\//, '')}`);

    const options = {
      method,
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        ...this._signedHeaders(body),
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    };

    if (process.env.DEBUG_COINDCX === '1') {
      console.log(`[CoinDCXRouter] ${method} ${endpoint} | Body: ${body}`);
    }

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              const msg = typeof json === 'object' ? (json.message || JSON.stringify(json)) : data;
              console.warn(`[CoinDCXRouter] ${method} ${endpoint} status=${res.statusCode} body=${data}`);
              reject(new Error(`CoinDCX Error: ${msg} (code: ${res.statusCode})`));
            } else {
              if (process.env.DEBUG_COINDCX === '1') {
                console.log(`[CoinDCXRouter] ${method} ${endpoint} status=${res.statusCode} response=${data.slice(0, 500)}`);
              }
              resolve(json);
            }
          } catch (e) {
            if (res.statusCode && res.statusCode >= 400) {
              console.warn(`[CoinDCXRouter] ${method} ${endpoint} status=${res.statusCode} rawBody=${data.slice(0, 200)}`);
              reject(new Error(`CoinDCX Error (Non-JSON): ${data.slice(0, 500)} (code: ${res.statusCode})`));
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
    const cur = await this._getCurrency();
    const resp = await this._request('POST', 'exchange/v1/derivatives/futures/positions', {
      page: '1',
      size: '100',
      margin_currency_short_name: [cur],
    });
    
    const rawPositions = Array.isArray(resp) ? resp : (resp.data || []);
    return rawPositions
      .map((raw: any) => {
        const qty = parseFloat(raw.active_pos || raw.quantity || '0');
        return {
          symbol: this._coindcxToInternal(raw.pair || raw.symbol),
          netQty: qty,
          averagePrice: parseFloat(raw.avg_price || raw.entry_price || '0'),
          realizedPnl: parseFloat(raw.realized_pnl || '0'),
          unrealizedPnl: parseFloat(raw.unrealized_pnl || '0'),
        };
      })
      .filter((p: Position) => Math.abs(p.netQty) > 0.000001);
  }

  async getOrders(): Promise<any[]> {
    const cur = await this._getCurrency();
    const resp = await this._request('POST', 'exchange/v1/derivatives/futures/orders', {
      status: 'open',
      page: '1',
      size: '100',
      margin_currency_short_name: [cur],
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
  }

  async getBalance(currency?: string): Promise<number> {
    try {
      const target = currency || await this._getCurrency();
      const resp = await this._request('GET', 'exchange/v1/derivatives/futures/wallets');
      const wallets = Array.isArray(resp) ? resp : (resp.data || []);
      const wallet = wallets.find((w: any) => w.currency_short_name === target || w.currency === target);
      return wallet ? parseFloat(wallet.balance || '0') : 0;
    } catch (err) {
      console.error('[CoinDCXRouter] Failed to fetch balance:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async getTotalEquity(): Promise<number> {
    try {
      const cur = await this._getCurrency();
      const resp = await this._request('GET', 'exchange/v1/derivatives/futures/positions/cross_margin_details', {
        margin_currency_short_name: [cur]
      });
      if (resp.total_equity || resp.equity) {
        return parseFloat(resp.total_equity || resp.equity || '0');
      }
      throw new Error('No equity in cross_margin_details');
    } catch (err) {
      // Fallback to balance + unrealized PnL if cross_margin_details fails or is empty
      const balance = await this.getBalance().catch(() => 0);
      const positions = await this.getPositions().catch(() => []);
      const unrealized = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
      const total = balance + unrealized;
      return total;
    }
  }
}
