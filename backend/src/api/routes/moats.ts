// api/routes/moats.ts: REST endpoints for Trophy-grade streak moats
// Covers:
// 1. POST /v1/streak/restore
// 2. POST /v1/streak/pause & DELETE /v1/streak/pause/:id & GET /v1/streak/pauses
// 3. POST /v1/streak/preferences
// 4. POST /v1/streak/friends (Batch streaks)
// 5. GET /v1/streak/wrapped

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../config/db.js';
import { authenticateApiKey, AuthenticatedRequest } from '../middleware/auth.js';
import { MoatService } from '../../domain/moat-service.js';
import { computeLogicalDate } from '../../domain/time-window.js';

export async function registerMoatRoutes(fastify: FastifyInstance) {
  const db = getDb();
  const moatService = new MoatService(db);

  /**
   * POST /v1/streak/restore
   * Restores a broken streak within the 90-day restore window
   */
  fastify.post(
    '/v1/streak/restore',
    { preHandler: authenticateApiKey },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request as AuthenticatedRequest;
      const tenant = auth.tenant!;

      const body = request.body as {
        ruleSlug: string;
        externalUserId: string;
        timezone?: string;
      };

      if (!body?.ruleSlug || !body?.externalUserId) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'ruleSlug and externalUserId are required'
        });
      }

      const currentDate = computeLogicalDate(new Date(), body.timezone || 'UTC', 0);
      const result = await moatService.restoreStreak(
        tenant.id,
        body.ruleSlug,
        body.externalUserId,
        currentDate
      );

      if (!result.restored) {
        return reply.status(400).send({
          error: 'RESTORE_NOT_ELIGIBLE',
          reason: result.reason,
          message: 'Streak is not eligible for restoration'
        });
      }

      return reply.status(200).send({
        success: true,
        restoredStreakLength: result.restoredStreakLength,
        message: `Streak successfully restored to ${result.restoredStreakLength} days`
      });
    }
  );

  /**
   * POST /v1/streak/repair-verify
   * Validates in-app purchase proof or gem spend and resurrects broken streaks
   */
  fastify.post(
    '/v1/streak/repair-verify',
    { preHandler: authenticateApiKey },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request as AuthenticatedRequest;
      const tenant = auth.tenant!;

      const body = request.body as {
        ruleSlug: string;
        externalUserId: string;
        timezone?: string;
        paymentProof: {
          provider: 'google_play' | 'apple_storekit' | 'stripe' | 'coins';
          transactionId?: string;
          productId?: string;
          coinsSpent?: number;
        };
      };

      if (!body?.ruleSlug || !body?.externalUserId || !body?.paymentProof?.provider) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'ruleSlug, externalUserId, and paymentProof are required'
        });
      }

      const currentDate = computeLogicalDate(new Date(), body.timezone || 'UTC', 0);
      const result = await moatService.verifyAndRestoreStreak(
        tenant.id,
        body.ruleSlug,
        body.externalUserId,
        currentDate,
        body.paymentProof
      );

      if (!result.restored) {
        return reply.status(400).send({
          error: 'REPAIR_FAILED',
          reason: result.reason,
          message: 'Could not restore streak'
        });
      }

      return reply.status(200).send({
        success: true,
        restoredStreakLength: result.restoredStreakLength,
        transactionId: result.transactionId,
        message: `Streak successfully revived to ${result.restoredStreakLength} days`
      });
    }
  );

  /**
   * POST /v1/streak/pause
   * Schedules a vacation pause
   */
  fastify.post(
    '/v1/streak/pause',
    { preHandler: authenticateApiKey },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request as AuthenticatedRequest;
      const tenant = auth.tenant!;

      const body = request.body as {
        ruleSlug: string;
        externalUserId: string;
        startDate: string;
        endDate: string;
      };

      if (!body?.ruleSlug || !body?.externalUserId || !body?.startDate || !body?.endDate) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'ruleSlug, externalUserId, startDate, and endDate are required'
        });
      }

      try {
        const pause = await moatService.createPause({
          tenantId: tenant.id,
          ruleSlug: body.ruleSlug,
          externalUserId: body.externalUserId,
          startDate: body.startDate,
          endDate: body.endDate
        });
        return reply.status(201).send({ success: true, pause });
      } catch (err: any) {
        return reply.status(400).send({ error: 'INVALID_PAUSE', message: err.message });
      }
    }
  );

  /**
   * DELETE /v1/streak/pause/:id
   * Cancels/deletes a vacation pause
   */
  fastify.delete(
    '/v1/streak/pause/:id',
    { preHandler: authenticateApiKey },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request as AuthenticatedRequest;
      const tenant = auth.tenant!;

      const { id } = request.params as { id: string };
      const deleted = await moatService.deletePause(tenant.id, id);

      if (!deleted) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Pause not found' });
      }

      return reply.status(200).send({ success: true, message: 'Pause deleted' });
    }
  );

  /**
   * POST /v1/streak/friends
   * Returns batch ranked streaks for a list of friend IDs
   */
  fastify.post(
    '/v1/streak/friends',
    { preHandler: authenticateApiKey },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request as AuthenticatedRequest;
      const tenant = auth.tenant!;

      const body = request.body as {
        ruleSlug: string;
        userIds: string[];
        timezone?: string;
      };

      if (!body?.ruleSlug || !Array.isArray(body?.userIds)) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'ruleSlug and an array of userIds are required'
        });
      }

      const currentDate = computeLogicalDate(new Date(), body.timezone || 'UTC', 0);
      const rankings = await moatService.getBatchStreaks(
        tenant.id,
        body.ruleSlug,
        body.userIds,
        currentDate
      );

      return reply.status(200).send({ success: true, rankings });
    }
  );

  /**
   * GET /v1/streak/wrapped
   * Spotify-style Year in Review stats
   */
  fastify.get(
    '/v1/streak/wrapped',
    { preHandler: authenticateApiKey },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request as AuthenticatedRequest;
      const tenant = auth.tenant!;

      const query = request.query as {
        ruleSlug: string;
        externalUserId: string;
        year?: string;
      };

      if (!query?.ruleSlug || !query?.externalUserId) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'ruleSlug and externalUserId query params are required'
        });
      }

      const year = query.year ? parseInt(query.year, 10) : new Date().getFullYear();
      try {
        const summary = await moatService.getWrapped(
          tenant.id,
          query.ruleSlug,
          query.externalUserId,
          year
        );
        return reply.status(200).send({ success: true, wrapped: summary });
      } catch (err: any) {
        return reply.status(400).send({ error: 'WRAPPED_ERROR', message: err.message });
      }
    }
  );

  /**
   * POST /v1/streak/preferences
   * End-user custom daily targets and rest days
   */
  fastify.post(
    '/v1/streak/preferences',
    { preHandler: authenticateApiKey },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request as AuthenticatedRequest;
      const tenant = auth.tenant!;

      const body = request.body as {
        ruleSlug: string;
        externalUserId: string;
        customTarget?: number;
        daysOffOverride?: number[];
        enabled?: boolean;
      };

      if (!body?.ruleSlug || !body?.externalUserId) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'ruleSlug and externalUserId are required'
        });
      }

      await moatService.setPreferences({
        tenantId: tenant.id,
        ruleSlug: body.ruleSlug,
        externalUserId: body.externalUserId,
        customTarget: body.customTarget,
        daysOffOverride: body.daysOffOverride,
        enabled: body.enabled
      });

      return reply.status(200).send({ success: true, message: 'Preferences updated' });
    }
  );

  /**
   * POST /v1/streak/amnesty/evaluate
   * Evaluates if a dormant user qualifies for Streak Amnesty churn recovery
   */
  fastify.post(
    '/v1/streak/amnesty/evaluate',
    { preHandler: authenticateApiKey },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request as AuthenticatedRequest;
      const tenant = auth.tenant!;

      const body = request.body as {
        ruleSlug: string;
        externalUserId: string;
        minDormantDays?: number;
      };

      if (!body?.ruleSlug || !body?.externalUserId) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'ruleSlug and externalUserId are required'
        });
      }

      const evaluation = await moatService.evaluateAmnesty(
        tenant.id,
        body.ruleSlug,
        body.externalUserId,
        body.minDormantDays ?? 7
      );

      return reply.status(200).send({ success: true, evaluation });
    }
  );

  /**
   * POST /v1/streak/amnesty/claim
   * Consumes an amnesty token and resurrects the user's broken streak
   */
  fastify.post(
    '/v1/streak/amnesty/claim',
    { preHandler: authenticateApiKey },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request as AuthenticatedRequest;
      const tenant = auth.tenant!;

      const body = request.body as {
        ruleSlug: string;
        externalUserId: string;
      };

      if (!body?.ruleSlug || !body?.externalUserId) {
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: 'ruleSlug and externalUserId are required'
        });
      }

      try {
        const result = await moatService.claimAmnesty(
          tenant.id,
          body.ruleSlug,
          body.externalUserId
        );
        return reply.status(200).send(result);
      } catch (err: any) {
        return reply.status(400).send({
          error: 'AMNESTY_FAILED',
          message: err.message
        });
      }
    }
  );
}
