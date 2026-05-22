import { RedisAdapter } from '@chart-studio/adapter-core';
import { TemplateProvider } from './provider.js';

/**
 * ENTRY POINT
 * This starts the microservice and connects it to the Chart Studio Gateway via Redis.
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

const main = async () => {
  const provider = new TemplateProvider();
  await provider.init();

  const adapter = new RedisAdapter(provider, { redisUrl: REDIS_URL });
  await adapter.start();

  console.log(`[adapter-${provider.id}] online: ${provider.displayName}`);
};

main().catch((err) => {
  console.error(`[adapter-template] fatal error`, err);
  process.exit(1);
});
