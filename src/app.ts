/**
 * Application entry point.
 *
 * Startup sequence:
 *  1. Connect to PostgreSQL
 *  2. Initialize distributed systems (lock, node registry)
 *  3. Start queue system
 *  4. Start scheduler engine
 *  5. Start monitoring (AlertManager, HealthCheck)
 *  6. Mount Express routes
 *  7. Start HTTP server
 *
 * Shutdown sequence (SIGTERM/SIGINT):
 *  1. Stop accepting new HTTP connections
 *  2. Stop scheduler
 *  3. Drain queue (stop adding new jobs, finish current)
 *  4. Deregister from node registry
 *  5. Close DB connections
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { ApolloServer } from 'apollo-server-express';
import { typeDefs } from './api/graphql/schema';
import { resolvers } from './api/graphql/resolvers';
import jobRoutes from './api/routes/jobs';
import workerRoutes from './api/routes/workers';
import scheduleRoutes from './api/routes/schedules';
import healthRoutes from './api/routes/health';
import { connectDatabase, disconnectDatabase } from './db/index';
import { queueManager } from './queue/QueueManager';
import { jobScheduler } from './scheduler/JobScheduler';
import { alertManager } from './monitoring/AlertManager';
import { healthCheck } from './monitoring/HealthCheck';
import { metricsService } from './monitoring/MetricsService';
import { nodeRegistry } from './distributed/NodeRegistry';
import { distributedLock } from './distributed/DistributedLock';
import { config } from './utils/config';
import { createLogger } from './utils/logger';

const log = createLogger('App');

async function bootstrap(): Promise<void> {
  log.info('Starting Backend Task Orchestration System', {
    version: process.env.npm_package_version ?? '1.0.0',
    env: config.app.env,
  });

  // ── 1. Database ────────────────────────────────────────────────────────────
  await connectDatabase();

  // ── 2. Distributed systems ────────────────────────────────────────────────
  try {
    await distributedLock.connect();
    await nodeRegistry.connect();
    await nodeRegistry.register('api', false);
  } catch (err) {
    log.warn('Distributed systems unavailable (standalone mode)', { error: err });
  }

  // ── 3. Queue ──────────────────────────────────────────────────────────────
  await queueManager.start();

  // ── 4. Scheduler ─────────────────────────────────────────────────────────
  await jobScheduler.start();

  // ── 5. Monitoring ─────────────────────────────────────────────────────────
  alertManager.start();
  healthCheck.start();

  // ── 6. Express app ────────────────────────────────────────────────────────
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request metrics middleware
  app.use((req, res, next) => {
    const start = Date.now();
    metricsService.incrementHttpInFlight();
    res.on('finish', () => {
      metricsService.decrementHttpInFlight();
      metricsService.recordHttpRequest(
        req.method,
        req.route?.path ?? req.path,
        res.statusCode,
        Date.now() - start,
      );
    });
    next();
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  const apiPrefix = `/api/${config.app.apiVersion}`;
  app.use('/health', healthRoutes);
  app.use(`${apiPrefix}/jobs`, jobRoutes);
  app.use(`${apiPrefix}/workers`, workerRoutes);
  app.use(`${apiPrefix}/schedules`, scheduleRoutes);

  // ── Prometheus metrics endpoint ────────────────────────────────────────────
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(await metricsService.getMetrics());
  });

  // ── GraphQL ────────────────────────────────────────────────────────────────
  const apolloServer = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({ req }) => ({ user: req.user }),
    introspection: !config.app.isProduction,
    formatError: (err) => {
      log.warn('GraphQL error', { error: err });
      return { message: err.message, path: err.path };
    },
  });

  await apolloServer.start();
  apolloServer.applyMiddleware({ app: app as Parameters<typeof apolloServer.applyMiddleware>[0]['app'], path: '/graphql' });

  // ── 404 fallthrough ────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ── Error handler ──────────────────────────────────────────────────────────
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error('Unhandled error', { error: err });
    res.status(500).json({ error: 'Internal server error' });
  });

  // ── 7. Start HTTP server ───────────────────────────────────────────────────
  const server = app.listen(config.app.port, () => {
    log.info(`HTTP server listening`, {
      port: config.app.port,
      graphql: `http://localhost:${config.app.port}/graphql`,
      health: `http://localhost:${config.app.port}/health`,
      metrics: `http://localhost:${config.app.port}/metrics`,
    });
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  async function shutdown(signal: string): Promise<void> {
    log.info(`Received ${signal}, gracefully shutting down`);

    server.close(async () => {
      try {
        alertManager.stop();
        healthCheck.stop();
        await jobScheduler.stop();
        await queueManager.stop();
        await nodeRegistry.disconnect();
        await distributedLock.disconnect();
        await disconnectDatabase();
        log.info('Graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        log.error('Shutdown error', { error: err });
        process.exit(1);
      }
    });

    // Force exit after 30s if graceful shutdown hangs
    setTimeout(() => {
      log.error('Shutdown timeout — forcing exit');
      process.exit(1);
    }, 30_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', { error: err });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', { reason });
    shutdown('unhandledRejection');
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
