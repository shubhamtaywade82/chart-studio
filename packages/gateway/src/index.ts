import http from 'http';
import { URL } from 'url';
import { WebSocketServer } from 'ws';
import { RedisBridge } from './redis-bridge';
import { ClientSession } from './ws-router';
import { federatedListSymbols, federatedSearchSymbols } from './search';
import { handleBriefRequest, cacheAnalytics, cacheCandle, cacheMorningBrief, getMorningBrief } from './brief';
import { fetchMacroSnapshot } from './macro';
import { MarginCalculator, PortfolioGreeksEngine, VarEngine } from '@chart-studio/ai-engine';
import type { DataEnvelope } from '@chart-studio/adapter-core';

import pino from 'pino';
import { startMonitoringServer } from './monitoring';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' }
  }
});

const PORT = Number(process.env.PORT ?? 4100);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const ORIGIN = process.env.GATEWAY_CORS_ORIGIN ?? '*';

const main = async (): Promise<void> => {
  startMonitoringServer(9090);
  logger.info('Monitoring server started on port 9090');
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
      if (topic === 'chart.ai.morning_brief') {
        const payload = JSON.parse(raw);
        cacheMorningBrief(payload.data);
      }
    } catch { /* ignore malformed */ }
  });

  // Periodic macro snapshot broadcast
  setInterval(async () => {
    const snap = await fetchMacroSnapshot();
    if (snap) {
      await bridge['pub'].publish('chart.macro.snapshot', JSON.stringify(snap));
    }
  }, 60_000); // Every 60s
  
  const marginCalc = new MarginCalculator();
  const greeksEngine = new PortfolioGreeksEngine();
  const varEngine = new VarEngine();

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

    if (url.pathname === '/brief/morning') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getMorningBrief() || { error: 'Morning brief not yet generated' }));
      return;
    }

    if (url.pathname === '/macro') {
      fetchMacroSnapshot().then(snap => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(snap));
      }).catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      });
      return;
    }

    if (url.pathname === '/ai/health') {
      const ollamaHost = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
      const apiKey = process.env.OLLAMA_API_KEY;
      
      const check = async () => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        // 1. Check basic connectivity (version)
        const vRes = await fetch(`${ollamaHost}/api/tags`, { headers }).catch(e => { throw new Error(`Cannot reach Ollama at ${ollamaHost}: ${e.message}`); });
        if (!vRes.ok) throw new Error(`Ollama host returned error ${vRes.status}`);
        
        const tags = await vRes.json() as any;
        const models = (tags.models || []).map((m: any) => m.name);
        
        return {
          status: 'ok',
          host: ollamaHost,
          usingApiKey: !!apiKey,
          models,
          required: [
            { id: 'llama3.1:8b', available: models.some((m: string) => m.startsWith('llama3.1')) },
            { id: 'llama3.2:3b', available: models.some((m: string) => m.startsWith('llama3.2')) }
          ]
        };
      };

      check().then(result => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }).catch(err => {
        res.writeHead(200, { 'Content-Type': 'application/json' }); // Still 200 so UI can parse the error JSON
        res.end(JSON.stringify({ status: 'error', error: err.message, host: ollamaHost }));
      });
      return;
    }

    if (url.pathname === '/risk') {
      const symbol = url.searchParams.get('symbol') ?? 'NIFTY';
      const samplePositions = [
        { 
          symbol, 
          exchangeSegment: 'NSE_FNO', 
          qty: 50, 
          ltp: 24500, 
          isOption: false,
          lotSize: 50,
          delta: 1, gamma: 0, vega: 0, theta: 0, pnl: 1250 
        }
      ];

      const runRisk = async () => {
        const margin = await marginCalc.calculate(samplePositions as any);
        const greeks = greeksEngine.aggregate(samplePositions as any, 24500);
        const varRes = varEngine.calculate(samplePositions.map(p => ({
          symbol: p.symbol,
          qty: p.qty,
          ltp: p.ltp,
          volatility: 0.18
        })));

        return {
          ...margin,
          ...greeks,
          var95: varRes.var95,
          positions: samplePositions
        };
      };

      runRisk().then(result => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }).catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }

    // ── On-Chain Smart Money Signals ─────────────────────────────────────
    if (url.pathname === '/signals/smart-money') {
      const chainId = url.searchParams.get('chainId') ?? 'CT_501';
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(url.searchParams.get('pageSize') ?? '50');

      fetch('https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/web/signal/smart-money/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Encoding': 'identity',
          'User-Agent': 'binance-web3/1.1 (Skill)'
        },
        body: JSON.stringify({
          smartSignalType: '',
          page,
          pageSize,
          chainId
        })
      })
      .then(async (apiRes) => {
        if (!apiRes.ok) {
          throw new Error(`Binance Web3 API responded with status ${apiRes.status}`);
        }
        const data = await apiRes.json();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      })
      .catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      });
      return;
    }

    res.writeHead(404).end('not found');
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => {
    new ClientSession(socket, bridge);
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`[Gateway] online: ws/http on :${PORT}`);
  });

  process.on('SIGTERM', () => {
    logger.info('[Gateway] shutting down');
    bridge.stop();
    server.close();
  });
};

main().catch((err) => {
  logger.error('[Gateway] fatal error', err);
  process.exit(1);
});
