import { RedisAdapter } from '@chart-studio/adapter-core';
import { DhanProvider } from './provider';
import { DhanTokenManager, StaticTokenProvider, NullTokenProvider, type TokenProvider } from './token-provider';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const CLIENT_ID = process.env.DHAN_CLIENT_ID ?? process.env.CLIENT_ID ?? '';
const ACCESS_TOKEN = process.env.DHAN_ACCESS_TOKEN ?? '';
const DHAN_AUTH_MODE = process.env.DHAN_AUTH_MODE ?? '';

const buildTokens = (): TokenProvider => {
  const hasTotp = process.env.DHAN_TOTP_SECRET && process.env.DHAN_PIN && CLIENT_ID;
  const hasAuthority = process.env.TRADER_API_BASE_URL || process.env.ALGO_SCALPER_URL;
  
  if (DHAN_AUTH_MODE || hasTotp || hasAuthority) {
    console.log(`[adapter-dhanhq] using DhanTokenManager (mode: ${DHAN_AUTH_MODE || (hasTotp ? 'totp' : 'authority')})`);
    return new DhanTokenManager();
  }
  if (CLIENT_ID && ACCESS_TOKEN) {
    console.log('[adapter-dhanhq] using static DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN');
    return new StaticTokenProvider({ clientId: CLIENT_ID, accessToken: ACCESS_TOKEN });
  }
  console.warn('[adapter-dhanhq] no credentials configured: search may be limited and live data will fail');
  return new NullTokenProvider();
};

const main = async (): Promise<void> => {
  const tokens = buildTokens();
  const provider = new DhanProvider({
    id: process.env.DHAN_ADAPTER_ID,
    displayName: process.env.DHAN_ADAPTER_NAME,
    tokens,
    scripMasterUrl: process.env.DHAN_SCRIP_MASTER_URL,
    feedMode: (process.env.DHAN_FEED_MODE as 'ticker' | 'quote' | 'full' | undefined) ?? 'full',
  });
  const adapter = new RedisAdapter(provider, { redisUrl: REDIS_URL });
  await adapter.start();
  console.log(`[adapter-dhanhq] online: ${provider.id} (${provider.displayName})`);
};

main().catch((err) => {
  console.error('[adapter-dhanhq] fatal', err);
  process.exit(1);
});
