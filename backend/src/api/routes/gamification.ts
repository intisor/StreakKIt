// api/routes/gamification.ts: Duolingo-in-a-Box Gamification API Routes
// Provides endpoints for Hearts (lives + auto-refill timer), Gems virtual currency,
// and Daily XP Goals (0/20 XP with automatic daily reset & bonus gem rewards).

import { FastifyInstance, FastifyReply } from 'fastify';
import { AuthenticatedRequest, authenticateApiKey } from '../middleware/auth.js';
import { getDb } from '../../config/db.js';
import { GamificationService } from '../../domain/gamification.js';

export async function registerGamificationRoutes(fastify: FastifyInstance) {
  /**
   * GET /v1/gamification/:externalUserId
   * Returns current Hearts (with live refill countdown), Gems balance, and Daily XP progress.
   */
  fastify.get(
    '/v1/gamification/:externalUserId',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const { externalUserId } = request.params as { externalUserId: string };
      const { timezone, nowMs } = request.query as { timezone?: string; nowMs?: string };

      const db = getDb();
      const service = new GamificationService(db);
      const parsedNowMs = nowMs ? Number(nowMs) : Date.now();
      const status = await service.getStatus(
        tenant.id,
        externalUserId,
        timezone || 'UTC',
        Number.isNaN(parsedNowMs) ? Date.now() : parsedNowMs
      );

      return reply.status(200).send(status);
    }
  );

  /**
   * POST /v1/gamification/hearts/consume
   * Deducts 1 or more hearts when a user makes a mistake in a lesson/quiz.
   */
  fastify.post(
    '/v1/gamification/hearts/consume',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = request.body as {
        userId: string;
        count?: number;
        timezone?: string;
        nowMs?: number;
      };

      if (!body || !body.userId) {
        return reply.status(400).send({ error: 'Missing required parameter: userId' });
      }

      const db = getDb();
      const service = new GamificationService(db);
      const status = await service.consumeHeart(
        tenant.id,
        body.userId,
        body.count ?? 1,
        body.timezone || 'UTC',
        body.nowMs ?? Date.now()
      );

      return reply.status(200).send(status);
    }
  );

  /**
   * POST /v1/gamification/hearts/refill
   * Refills hearts via Gems (default 50 gems for full refill), Practice (+1 heart), Ad (+1 heart), or Free.
   */
  fastify.post(
    '/v1/gamification/hearts/refill',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = request.body as {
        userId: string;
        method?: 'GEMS' | 'PRACTICE' | 'AD' | 'FREE';
        gemCost?: number;
        timezone?: string;
        nowMs?: number;
      };

      if (!body || !body.userId) {
        return reply.status(400).send({ error: 'Missing required parameter: userId' });
      }

      const db = getDb();
      const service = new GamificationService(db);
      try {
        const status = await service.refillHearts(
          tenant.id,
          body.userId,
          body.method || 'GEMS',
          body.gemCost ?? 50,
          body.timezone || 'UTC',
          body.nowMs ?? Date.now()
        );
        return reply.status(200).send(status);
      } catch (err: any) {
        return reply.status(err.statusCode || 400).send({ error: err.message });
      }
    }
  );

  /**
   * POST /v1/gamification/xp/add
   * Adds XP toward the user's daily goal (e.g. 0/20 XP) and total XP.
   * Awards +10 bonus gems automatically when the daily XP goal is crossed for the first time today.
   */
  fastify.post(
    '/v1/gamification/xp/add',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = request.body as {
        userId: string;
        amount: number;
        unitId?: string;
        timezone?: string;
        dailyTargetOverride?: number;
        nowMs?: number;
      };

      if (!body || !body.userId || typeof body.amount !== 'number') {
        return reply.status(400).send({ error: 'Missing required parameters: userId and numeric amount' });
      }

      const db = getDb();
      const service = new GamificationService(db);
      const status = await service.addXp(tenant.id, body.userId, body.amount, {
        unitId: body.unitId,
        timezone: body.timezone,
        dailyTargetOverride: body.dailyTargetOverride,
        nowMs: body.nowMs
      });

      return reply.status(200).send(status);
    }
  );

  /**
   * POST /v1/gamification/gems/transaction
   * Awards or spends virtual gems in the user's gem ledger.
   */
  fastify.post(
    '/v1/gamification/gems/transaction',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = request.body as {
        userId: string;
        amount: number;
        type: 'AWARD' | 'SPEND';
        timezone?: string;
      };

      if (!body || !body.userId || typeof body.amount !== 'number' || !body.type) {
        return reply.status(400).send({
          error: 'Missing required parameters: userId, amount, and type (AWARD | SPEND)'
        });
      }

      const db = getDb();
      const service = new GamificationService(db);
      try {
        const status = await service.transactGems(
          tenant.id,
          body.userId,
          body.amount,
          body.type,
          body.timezone || 'UTC'
        );
        return reply.status(200).send(status);
      } catch (err: any) {
        return reply.status(err.statusCode || 400).send({ error: err.message });
      }
    }
  );

  /**
   * POST /v1/gamification/config
   * Customizes user/tenant gamification parameters:
   * - heartsMax (e.g. 3 for hard quizzes, 10 for kids, 999 for VIPs)
   * - heartsCurrent
   * - heartsRefillIntervalMinutes (e.g. 30m vs 240m)
   * - gemsBalance
   * - xpTargetDaily (e.g. 50 XP vs 20 XP)
   */
  fastify.post(
    '/v1/gamification/config',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = request.body as {
        userId: string;
        heartsMax?: number;
        heartsCurrent?: number;
        heartsRefillIntervalMinutes?: number;
        gemsBalance?: number;
        xpTargetDaily?: number;
        timezone?: string;
      };

      if (!body || !body.userId) {
        return reply.status(400).send({ error: 'Missing required parameter: userId' });
      }

      const db = getDb();
      const service = new GamificationService(db);
      const status = await service.updateConfig(
        tenant.id,
        body.userId,
        {
          heartsMax: body.heartsMax,
          heartsCurrent: body.heartsCurrent,
          heartsRefillIntervalMinutes: body.heartsRefillIntervalMinutes,
          gemsBalance: body.gemsBalance,
          xpTargetDaily: body.xpTargetDaily
        },
        body.timezone || 'UTC'
      );

      return reply.status(200).send(status);
    }
  );
}
