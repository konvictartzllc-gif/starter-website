/**
 * Dex v2 - Health Check Service
 * Provides system health monitoring endpoints for deployment verification.
 * @version 2.0.0
 */

const os = require('os');
const { version } = require('../../../package.json');

const startTime = Date.now();

async function getHealthStatus(dependencies = {}) {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const memUsage = process.memoryUsage();

  const health = {
        status: 'healthy',
        version,
        uptime,
        timestamp: new Date().toISOString(),
        system: {
                platform: os.platform(),
                nodeVersion: process.version,
                memory: {
                          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                          rss: Math.round(memUsage.rss / 1024 / 1024)
                },
                cpuLoad: os.loadavg()
        },
        services: {}
  };

  for (const [name, checkFn] of Object.entries(dependencies)) {
        try {
                const start = Date.now();
                await checkFn();
                health.services[name] = {
                          status: 'connected',
                          latencyMs: Date.now() - start
                };
        } catch (err) {
                health.services[name] = {
                          status: 'disconnected',
                          error: err.message
                };
                health.status = 'degraded';
        }
  }

  return health;
}

function healthRouter(router, dependencies = {}) {
    router.get('/health', async (req, res) => {
          const health = await getHealthStatus(dependencies);
          const statusCode = health.status === 'healthy' ? 200 : 503;
          res.status(statusCode).json(health);
    });

  router.get('/health/ready', (req, res) => {
        res.status(200).json({ ready: true, timestamp: new Date().toISOString() });
  });

  router.get('/health/live', (req, res) => {
        res.status(200).json({ alive: true, uptime: Math.floor((Date.now() - startTime) / 1000) });
  });

  return router;
}

module.exports = { getHealthStatus, healthRouter };