import http from 'http';
import { URL } from 'url';
import { WebSocketServer } from 'ws';
import { RedisBridge } from './redis-bridge';
import { ClientSession } from './ws-router';
import { federatedListSymbols, federatedSearchSymbols } from './search';
import { handleBriefRequest, cacheAnalytics, cacheCandle } from './brief';
import type { DataEnvelope } from '@chart-studio/adapter-core';

const PORT = Number(process.env.PORT ?? 4100);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const ORIGIN = process.env.GATEWAY_CORS_ORIGIN ?? '*';

const main = async (): Promise<void> => {
  const bridge = new RedisBridge(REDIS_URL);
  await bridge.start();

  // ── Passive analytics listener: feed the brief cache ────────────────────
  // The bridge already subscribes to chart.data.* so we just tap into it via
  // a wildcard listener registered directly on the underlying Redis sub.
  bridge.listenRaw((topic: string, raw: string) => {
    try {
      // analytics envelopes → feed brief state cache
      if (topic.endsWith('.analytics')) {
        const env = JSON.parse(raw) as DataEnvelope;
        if (env.kind !== 'update' || !env.data) return;
        const d = env.data as Record<string, unknown>;
        if (typeof d['ltp'] !== 'number') return;
        cacheAnalytics(
          env.provider,
          env.symbol,
          d as unknown as Parameters<typeof cacheAnalytics>[2],
          (d['derived'] as unknown as Parameters<typeof cacheAnalytics>[3]) ?? {
            vwapDeviation: 0, cvd: 0, oiChange: 0,
            depthImbalance: 0, tradeIntensity: 0,
            volatilityRegime: 'normal', toxicity: 0,
          },
          env.ts,
        );
      }
      // candle envelopes (updates only) → feed candle history
      if (topic.endsWith('.1m') || topic.match(/\.(candle|1m|3m|5m|15m|1h)$/)) {
        const env = JSON.parse(raw) as DataEnvelope;
        if (env.kind !== 'update' || !env.data) return;

        const interval = env.key || '1m';
        const data = env.data as Record<string, any>;
        const candle = data.candle || data;

        if (typeof candle['openTime'] === 'number') {
          cacheCandle(env.provider, env.symbol, interval, candle as any);
        }
        // batch snapshot (array)
        if (Array.isArray(env.data)) {
          for (const c of env.data) {
            if (typeof c['openTime'] === 'number') {
              cacheCandle(env.provider, env.symbol, interval, c as any);
            }
          }
        }
      }
      // annotation envelopes from ai-engine may contain derived data too
      if (topic.endsWith('.annotation')) {
        const env = JSON.parse(raw) as DataEnvelope;
        if (env.kind !== 'update' || !env.data) return;
        const ann = env.data as Record<string, unknown>;
        if (ann['kind'] === 'reflex' && ann['derived']) {
          // derived data refreshed by ai-engine reflex — update if we have no tick yet
          // (we rely on analytics channel for tick, this is supplementary)
        }
      }
    } catch { /* ignore malformed */ }
  });

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, providers: bridge.snapshotPresence() }));
      return;
    }

    if (url.pathname === '/providers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(bridge.snapshotPresence()));
      return;
    }

    if (url.pathname === '/symbols/search') {
      const q = url.searchParams.get('q') ?? '';
      const limit = Number(url.searchParams.get('limit') ?? 20);
      federatedSearchSymbols(bridge, q, limit).then((results) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
      }).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      });
      return;
    }

    if (url.pathname.startsWith('/symbols/list/')) {
      const provider = url.pathname.slice('/symbols/list/'.length);
      const segment = url.searchParams.get('segment') ?? undefined;
      federatedListSymbols(bridge, provider, segment ? { segment } : undefined).then((results) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
      }).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      });
      return;
    }

    // ── Historic candles (lazy left-scroll) ──────────────────────────────
    if (url.pathname === '/candles/history') {
      const provider = url.searchParams.get('provider') ?? '';
      const symbol = url.searchParams.get('symbol') ?? '';
      const interval = url.searchParams.get('interval') ?? '1m';
      const endTime = Number(url.searchParams.get('endTime') ?? 0);
      const limit = Math.min(1500, Math.max(1, Number(url.searchParams.get('limit') ?? 500)));
      if (!provider || !symbol || !endTime) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'provider, symbol, endTime required' }));
        return;
      }
      bridge.discover(provider, 'candles', { symbol, interval, endTime, limit }, 15_000).then((bars) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(bars ?? []));
      }).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      });
      return;
    }

    // ── AI Brief ─────────────────────────────────────────────────────────
    if (url.pathname === '/brief') {
      handleBriefRequest(req, res, url).catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    res.writeHead(404).end('not found');
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => {
    new ClientSession(socket, bridge);
  });

  server.listen(PORT, () => {
    console.log(`[gateway] listening on :${PORT} (redis=${REDIS_URL})`);
  });

  const shutdown = async (): Promise<void> => {
    console.log('[gateway] shutting down');
    wss.close();
    server.close();
    await bridge.stop();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

main().catch((err) => {
  console.error('[gateway] fatal', err);
  process.exit(1);
});
