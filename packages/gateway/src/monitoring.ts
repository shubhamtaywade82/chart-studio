import http from 'http';
import promClient from 'prom-client';

// Enable default metrics collection
promClient.collectDefaultMetrics({ prefix: 'chart_studio_' });

// Define custom metrics
export const chartTickLatencyMs = new promClient.Histogram({
  name: 'chart_tick_latency_ms',
  help: 'Latency from tick arrival to dispatch in milliseconds',
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000]
});

export const dhanWsReconnectTotal = new promClient.Counter({
  name: 'dhan_ws_reconnect_total',
  help: 'Total number of DhanHQ WebSocket reconnects'
});

export const aiInferenceDurationMs = new promClient.Histogram({
  name: 'ai_inference_duration_ms',
  help: 'AI Inference duration in milliseconds',
  labelNames: ['tier'], // reflex, tactical, narrative
  buckets: [50, 200, 500, 1000, 2000, 5000, 10000, 30000]
});

export const optionChainPollErrorsTotal = new promClient.Counter({
  name: 'option_chain_poll_errors_total',
  help: 'Total number of errors polling the option chain'
});

export function startMonitoringServer(port: number = 9090) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
      try {
        const metrics = await promClient.register.metrics();
        res.setHeader('Content-Type', promClient.register.contentType);
        res.end(metrics);
      } catch (ex) {
        res.statusCode = 500;
        res.end('Error retrieving metrics');
      }
    } else if (req.url === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    } else {
      res.statusCode = 404;
      res.end('Not Found');
    }
  });

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.warn(`[Monitoring] Port ${port} is in use, trying ${port + 1}`);
      startMonitoringServer(port + 1);
    } else {
      console.error('[Monitoring] Server error:', e);
    }
  });

  server.listen(port, () => {
    console.log(`[Monitoring] HTTP Server running on port ${port}`);
  });

  return server;
}
