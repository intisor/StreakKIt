// server.ts: HTTP server entry point for StreakKit Backend API
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getDb } from './config/db.js';
import { seedDatabase } from './db/seed.js';
import { registerEventRoutes } from './api/routes/events.js';
import { registerStateRoutes } from './api/routes/state.js';
import { registerFreezeRoutes } from './api/routes/freezes.js';
import { registerEmbedRoutes } from './api/routes/embed.js';
import { registerRuleRoutes } from './api/routes/rules.js';
import { registerDashboardRoutes } from './api/routes/dashboard.js';
import { WebhookDispatcherWorker } from './workers/webhook-dispatcher.js';

export async function buildServer() {
  const fastify = Fastify({
    logger: process.env.NODE_ENV !== 'test'
  });

  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  // Healthcheck endpoint
  fastify.get('/health', async () => {
    return { status: 'healthy', timestamp: new Date().toISOString() };
  });

  // Register API and developer studio routes
  await registerEventRoutes(fastify);
  await registerStateRoutes(fastify);
  await registerFreezeRoutes(fastify);
  await registerEmbedRoutes(fastify);
  await registerRuleRoutes(fastify);
  await registerDashboardRoutes(fastify);

  return fastify;
}

export async function startServer() {
  const db = getDb();
  await db.migrate();
  await seedDatabase(db);

  const server = await buildServer();
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';

  // Start background webhook dispatcher worker
  const dispatcher = new WebhookDispatcherWorker({ intervalMs: 60000 });
  dispatcher.start();

  try {
    await server.listen({ port, host });
    console.log(`[StreakKit API] Server listening on http://${host}:${port}`);
    console.log(`[StreakKit Console] Developer Studio available at http://${host}:${port}/dashboard`);
  } catch (err) {
    server.log.error(err);
    dispatcher.stop();
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[StreakKit API] Shutting down gracefully...');
    dispatcher.stop();
    await server.close();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  startServer().catch((err) => {
    console.error('[StreakKit] Failed to start server:', err);
    process.exit(1);
  });
}
