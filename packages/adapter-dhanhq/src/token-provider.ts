import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface DhanCreds {
  clientId: string;
  accessToken: string;
}

export interface TokenProvider {
  /** Resolve a fresh set of creds. Implementations may cache internally. */
  get(): Promise<DhanCreds>;
  /** Force a refresh on next call (e.g. after a 401). */
  invalidate(): void;
  /** Cleanup any timers/connections. */
  shutdown(): void;
  /** Register a callback for when the token is proactively rotated. */
  onRotate?(fn: (creds: DhanCreds) => void): void;
}

export class StaticTokenProvider implements TokenProvider {
  constructor(private readonly creds: DhanCreds) {}
  async get(): Promise<DhanCreds> { return this.creds; }
  invalidate(): void { /* no-op */ }
  shutdown(): void { /* no-op */ }
}

export class NullTokenProvider implements TokenProvider {
  async get(): Promise<DhanCreds> { return { clientId: '', accessToken: '' }; }
  invalidate(): void { /* no-op */ }
  shutdown(): void { /* no-op */ }
}

/**
 * Helper to decode base32 format without external dependencies.
 */
function decodeBase32(b32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = b32.toUpperCase().replace(/[\s=]/g, '').replace(/\s/g, '');
  const len = clean.length;
  const buffer = Buffer.alloc(Math.floor((len * 5) / 8));
  
  let bits = 0;
  let value = 0;
  let index = 0;
  
  for (let i = 0; i < len; i++) {
    const char = clean[i];
    if (!char) continue;
    const val = alphabet.indexOf(char);
    if (val === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      buffer[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return buffer;
}

/**
 * Helper to generate TOTP code (HMAC-SHA1) using Node's native crypto module.
 */
export function generateTOTP(secret: string): string {
  const cleanSecret = secret.replace(/\s+/g, '');
  const key = decodeBase32(cleanSecret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
    
  const otp = (binary % 1000000).toString();
  return otp.padStart(6, '0');
}

function extractClientIdFromJwt(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    return payload.dhanClientId ?? payload.clientId ?? payload.client_id ?? null;
  } catch {
    return null;
  }
}

function extractExpiryFromJwt(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export interface DhanTokenManagerOptions {
  authMode?: string;
  clientId?: string;
  pin?: string;
  totpSecret?: string;
  accessToken?: string;
  authorityUrl?: string;
  authorityToken?: string;
  cachePath?: string;
  preExpiryMs?: number;  // Default 30 mins
  minRefreshMs?: number; // Default 5 mins
}

export class DhanTokenManager implements TokenProvider {
  private cached: { creds: DhanCreds; expiresAt: number } | null = null;
  private inflight: Promise<DhanCreds> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onRotateFn: ((creds: DhanCreds) => void) | null = null;
  
  private readonly authMode: string;
  private readonly clientId: string;
  private readonly pin: string;
  private readonly totpSecret: string;
  private readonly staticToken: string;
  private readonly authorityUrl: string;
  private readonly authorityToken: string;
  private readonly cachePath: string;
  private readonly preExpiryMs: number;
  private readonly minRefreshMs: number;

  constructor(opts: DhanTokenManagerOptions = {}) {
    this.clientId = opts.clientId ?? process.env.DHAN_CLIENT_ID ?? process.env.CLIENT_ID ?? '';
    this.pin = opts.pin ?? process.env.DHAN_PIN ?? '';
    this.totpSecret = opts.totpSecret ?? process.env.DHAN_TOTP_SECRET ?? '';
    this.staticToken = opts.accessToken ?? process.env.DHAN_ACCESS_TOKEN ?? '';
    
    // Support either TRADER_API_BASE_URL (new) or ALGO_SCALPER_URL (legacy)
    this.authorityUrl = opts.authorityUrl ?? process.env.TRADER_API_BASE_URL ?? process.env.ALGO_SCALPER_URL ?? '';
    
    // Support either DHAN_TOKEN_ACCESS_TOKEN (new) or ALGO_SCALPER_API_KEY (legacy)
    this.authorityToken = opts.authorityToken ?? process.env.DHAN_TOKEN_ACCESS_TOKEN ?? process.env.ALGO_SCALPER_API_KEY ?? '';

    // Smart default mode resolution
    const defaultMode = (this.totpSecret && this.pin && this.clientId)
      ? 'totp'
      : (this.authorityUrl ? 'authority' : 'totp');

    this.authMode = (opts.authMode ?? process.env.DHAN_AUTH_MODE ?? defaultMode).toLowerCase().trim();
    
    this.cachePath = opts.cachePath ?? path.resolve(process.cwd(), '.dhan_token_cache.json');
    
    // Proactive refresh buffer: default to 30 minutes to match Ruby BUFFER_MINUTES
    this.preExpiryMs = opts.preExpiryMs ?? 30 * 60 * 1000;
    this.minRefreshMs = opts.minRefreshMs ?? 5 * 60 * 1000;
  }

  onRotate(fn: (creds: DhanCreds) => void): void {
    this.onRotateFn = fn;
  }

  async get(): Promise<DhanCreds> {
    if (this.cached && Date.now() < this.cached.expiresAt - this.preExpiryMs) {
      return this.cached.creds;
    }
    return this.refresh();
  }

  invalidate(): void {
    console.log('[dhanhq-token] invalidating cached token and clearing file cache');
    this.cached = null;
    this.deleteFileCache();
  }

  shutdown(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async refresh(): Promise<DhanCreds> {
    if (this.inflight) return this.inflight;
    
    this.inflight = (async () => {
      try {
        // 1. Try to load from file cache first if memory cache is empty
        if (!this.cached) {
          const cachedFromFile = this.loadFileCache();
          if (cachedFromFile && Date.now() < cachedFromFile.expiresAt - this.preExpiryMs) {
            console.log('[dhanhq-token] using valid token from file cache');
            this.cached = cachedFromFile;
            this.applyTokenToRuntime(cachedFromFile.creds.accessToken);
            this.scheduleNextRefresh(cachedFromFile.expiresAt);
            return cachedFromFile.creds;
          }
        }

        // 2. Fetch fresh token based on resolved strategy
        let result: { accessToken: string; expiresAt: number };
        
        switch (this.authMode) {
          case 'manual':
            result = this.getManualToken();
            break;
            
          case 'renew':
            try {
              const currentToken = this.cached?.creds.accessToken || this.loadFileCache()?.creds.accessToken;
              if (!currentToken) {
                throw new Error('No existing token found for renew strategy');
              }
              result = await this.renewToken(currentToken);
            } catch (err) {
              console.warn('[dhanhq-token] renew strategy failed. Falling back to TOTP strategy if credentials are set.', err);
              if (this.clientId && this.pin && this.totpSecret) {
                result = await this.getTotpToken();
              } else {
                throw err;
              }
            }
            break;
            
          case 'authority':
            result = await this.getAuthorityToken();
            break;
            
          case 'totp':
          default:
            result = await this.getTotpToken();
            break;
        }

        const creds: DhanCreds = {
          clientId: this.clientId || (this.authMode === 'authority' ? await this.extractClientId(result.accessToken) : ''),
          accessToken: result.accessToken
        };

        const safeExpiry = result.expiresAt > Date.now() ? result.expiresAt : Date.now() + this.minRefreshMs;
        
        this.cached = { creds, expiresAt: safeExpiry };
        
        // 3. Persist and apply the fresh token
        this.writeFileCache(this.cached);
        this.applyTokenToRuntime(creds.accessToken);
        this.scheduleNextRefresh(safeExpiry);
        this.onRotateFn?.(creds);
        
        return creds;
      } finally {
        this.inflight = null;
      }
    })();

    return this.inflight;
  }

  private getManualToken(): { accessToken: string; expiresAt: number } {
    if (!this.staticToken) {
      throw new Error('manual strategy: DHAN_ACCESS_TOKEN is missing');
    }
    console.log('[dhanhq-token] resolved manual strategy');
    return {
      accessToken: this.staticToken,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24-hour expiry
    };
  }

  private async getTotpToken(): Promise<{ accessToken: string; expiresAt: number }> {
    if (!this.clientId) throw new Error('totp strategy: DHAN_CLIENT_ID / CLIENT_ID is missing');
    if (!this.pin) throw new Error('totp strategy: DHAN_PIN is missing');
    if (!this.totpSecret) throw new Error('totp strategy: DHAN_TOTP_SECRET is missing');

    const otp = generateTOTP(this.totpSecret);
    console.log(`[dhanhq-token] resolving totp strategy (clientId: ${this.clientId})`);

    const res = await axios.post('https://auth.dhan.co/app/generateAccessToken', null, {
      params: {
        dhanClientId: this.clientId,
        pin: this.pin,
        totp: otp
      },
      headers: { Accept: 'application/json' },
      timeout: 10000
    });

    const data = res.data;
    if (!data) throw new Error('Empty response from TOTP authentication');
    if (data.status?.toLowerCase() === 'error' || data.status?.toLowerCase() === 'failure') {
      throw new Error(`TOTP authentication failed: ${data.message || data.errorMessage || 'unknown error'}`);
    }

    const accessToken = data.accessToken || data.access_token;
    const expiryRaw = data.expiryTime || data.expires_at;

    if (!accessToken) throw new Error('TOTP response missing accessToken');

    let expiresAt = typeof expiryRaw === 'number'
      ? (expiryRaw < 1e12 ? expiryRaw * 1000 : expiryRaw)
      : Date.parse(expiryRaw);

    if (isNaN(expiresAt)) {
      expiresAt = extractExpiryFromJwt(accessToken) ?? (Date.now() + 24 * 3600_000);
    }

    return { accessToken, expiresAt };
  }

  private async renewToken(existingToken: string): Promise<{ accessToken: string; expiresAt: number }> {
    if (!this.clientId) throw new Error('renew strategy: DHAN_CLIENT_ID / CLIENT_ID is missing');
    console.log(`[dhanhq-token] resolving renew strategy (clientId: ${this.clientId})`);

    const res = await axios.post('https://api.dhan.co/v2/RenewToken', {}, {
      headers: {
        'Content-Type': 'application/json',
        'access-token': existingToken,
        'dhanClientId': this.clientId
      },
      timeout: 10000
    });

    const data = res.data;
    if (!data) throw new Error('Empty response from RenewToken endpoint');
    if (data.status?.toLowerCase() === 'error' || data.status?.toLowerCase() === 'failure') {
      throw new Error(`RenewToken failed: ${data.message || data.errorMessage || 'unknown error'}`);
    }

    const accessToken = data.accessToken || data.access_token;
    const expiryRaw = data.expiryTime || data.expires_at;

    if (!accessToken) throw new Error('Renew response missing accessToken');

    let expiresAt = typeof expiryRaw === 'number'
      ? (expiryRaw < 1e12 ? expiryRaw * 1000 : expiryRaw)
      : Date.parse(expiryRaw);

    if (isNaN(expiresAt)) {
      expiresAt = extractExpiryFromJwt(accessToken) ?? (Date.now() + 24 * 3600_000);
    }

    return { accessToken, expiresAt };
  }

  private async getAuthorityToken(): Promise<{ accessToken: string; expiresAt: number }> {
    if (!this.authorityUrl) {
      throw new Error('authority strategy: TRADER_API_BASE_URL or ALGO_SCALPER_URL is missing');
    }

    const isBaseUrl = !this.authorityUrl.includes('/token');
    const url = isBaseUrl ? `${this.authorityUrl.replace(/\/$/, '')}/auth/dhan/token` : this.authorityUrl;

    console.log(`[dhanhq-token] resolving authority strategy (url: ${url})`);
    
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.authorityToken) {
      if (isBaseUrl) {
        headers['Authorization'] = `Bearer ${this.authorityToken}`;
      } else {
        headers['X-API-Key'] = this.authorityToken;
      }
    }

    const res = await axios.get(url, { headers, timeout: 10000 });
    const data = res.data;
    if (!data) throw new Error('Empty response from authority server');

    const accessToken = data.access_token || data.accessToken || data.dhan_access_token || data.dhanaccesstoken;
    let expiresAt = data.expires_at || data.expiresAt || data.expiryTime;

    if (!accessToken) throw new Error('Authority response missing access_token');

    if (typeof expiresAt === 'string') {
      expiresAt = Date.parse(expiresAt);
    } else if (typeof expiresAt === 'number' && expiresAt < 1e12) {
      expiresAt *= 1000;
    }

    if (!expiresAt || isNaN(expiresAt)) {
      expiresAt = extractExpiryFromJwt(accessToken) ?? (Date.now() + 24 * 3600_000);
    }

    return { accessToken, expiresAt };
  }

  private async extractClientId(token: string): Promise<string> {
    const cid = extractClientIdFromJwt(token);
    return cid || '';
  }

  private applyTokenToRuntime(accessToken: string): void {
    process.env.ACCESS_TOKEN = accessToken;
    process.env.DHAN_ACCESS_TOKEN = accessToken;
  }

  private scheduleNextRefresh(expiresAt: number): void {
    if (this.timer) clearTimeout(this.timer);
    
    const delay = Math.max(this.minRefreshMs, expiresAt - Date.now() - this.preExpiryMs);
    
    console.log(`[dhanhq-token] next token refresh scheduled in ${Math.round(delay / 60000)} minutes`);
    
    this.timer = setTimeout(() => {
      this.refresh().catch((err) => {
        console.error('[dhanhq-token] scheduled token refresh failed', err);
      });
    }, delay);
  }

  private loadFileCache(): { creds: DhanCreds; expiresAt: number } | null {
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed.accessToken === 'string' &&
          typeof parsed.expiresAt === 'number'
        ) {
          return {
            creds: {
              clientId: parsed.clientId || '',
              accessToken: parsed.accessToken
            },
            expiresAt: parsed.expiresAt
          };
        }
      }
    } catch (err) {
      console.warn('[dhanhq-token] failed to read token cache file', err);
    }
    return null;
  }

  private writeFileCache(cached: { creds: DhanCreds; expiresAt: number }): void {
    try {
      const data = {
        clientId: cached.creds.clientId,
        accessToken: cached.creds.accessToken,
        expiresAt: cached.expiresAt
      };
      fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[dhanhq-token] saved token to file cache at ${this.cachePath}`);
    } catch (err) {
      console.warn('[dhanhq-token] failed to write token cache file', err);
    }
  }

  private deleteFileCache(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        fs.unlinkSync(this.cachePath);
        console.log(`[dhanhq-token] deleted token cache file at ${this.cachePath}`);
      }
    } catch (err) {
      console.warn('[dhanhq-token] failed to delete token cache file', err);
    }
  }
}
