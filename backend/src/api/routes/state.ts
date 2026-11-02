// api/routes/state.ts: GET /v1/streaks/:ruleSlug/:externalUserId
import crypto from 'node:crypto';
import { FastifyInstance, FastifyReply } from 'fastify';
import { AuthenticatedRequest, authenticateApiKey } from '../middleware/auth.js';
import { getDb } from '../../config/db.js';
import { StreakRule, UserStreak } from '../../domain/types.js';
import { evaluateStateOnRead } from '../../domain/evaluator.js';

export async function registerStateRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/v1/streaks/:ruleSlug/:externalUserId',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const { ruleSlug, externalUserId } = request.params as {
        ruleSlug: string;
        externalUserId: string;
      };
      const query = request.query as { timezone?: string };

      const db = getDb();
      const userTimezone = query.timezone || 'UTC';
      const nowUtc = new Date();

      // 1. Fetch rule
      const ruleRow = await db.get<any>(
        'SELECT * FROM streak_rules WHERE tenant_id = $1 AND slug = $2',
        [tenant.id, ruleSlug]
      );

      if (!ruleRow) {
        return reply.status(404).send({ error: `Rule not found: ${ruleSlug}` });
      }

      const rule: StreakRule = {
        id: ruleRow.id,
        tenantId: ruleRow.tenant_id,
        slug: ruleRow.slug,
        name: ruleRow.name,
        cadenceType: ruleRow.cadence_type,
        targetValue: ruleRow.target_value,
        exemptDaysBitmask: ruleRow.exempt_days_bitmask,
        gracePeriodMinutes: ruleRow.grace_period_minutes,
        maxFreezes: ruleRow.max_freezes,
        autoConsumeFreeze: Boolean(ruleRow.auto_consume_freeze),
        atRiskLeadMinutes: ruleRow.at_risk_lead_minutes,
        milestoneDays: typeof ruleRow.milestone_days === 'string'
          ? JSON.parse(ruleRow.milestone_days)
          : ruleRow.milestone_days,
        createdAt: ruleRow.created_at
      };

      // 2. Fetch or initialize user streak
      let userStreakRow = await db.get<any>(
        'SELECT * FROM user_streaks WHERE rule_id = $1 AND external_user_id = $2',
        [rule.id, externalUserId]
      );

      let userStreak: UserStreak;
      if (!userStreakRow) {
        const newId = crypto.randomUUID();
        await db.execute(
          `INSERT INTO user_streaks (
            id, tenant_id, rule_id, external_user_id, timezone,
            current_streak, highest_streak, last_completed_logical_date,
            current_logical_date, current_window_progress, freezes_available,
            recent_history
          ) VALUES ($1, $2, $3, $4, $5, 0, 0, NULL, NULL, 0, $6, '[]')`,
          [newId, tenant.id, rule.id, externalUserId, userTimezone, rule.maxFreezes]
        );

        userStreak = {
          id: newId,
          tenantId: tenant.id,
          ruleId: rule.id,
          externalUserId,
          timezone: userTimezone,
          currentStreak: 0,
          highestStreak: 0,
          lastCompletedLogicalDate: null,
          currentLogicalDate: null,
          currentWindowProgress: 0,
          freezesAvailable: rule.maxFreezes,
          lastFreezeConsumedDate: null,
          windowExpiresAtUtc: null,
          atRiskNotifiedForDate: null,
          recentHistory: [],
          lastClientEventUtc: null,
          lastEventHash: null,
          updatedAt: nowUtc.toISOString()
        };
      } else {
        userStreak = {
          id: userStreakRow.id,
          tenantId: userStreakRow.tenant_id,
          ruleId: userStreakRow.rule_id,
          externalUserId: userStreakRow.external_user_id,
          timezone: query.timezone || userStreakRow.timezone || 'UTC',
          currentStreak: userStreakRow.current_streak,
          highestStreak: userStreakRow.highest_streak,
          lastCompletedLogicalDate: userStreakRow.last_completed_logical_date,
          currentLogicalDate: userStreakRow.current_logical_date,
          currentWindowProgress: userStreakRow.current_window_progress,
          freezesAvailable: userStreakRow.freezes_available,
          lastFreezeConsumedDate: userStreakRow.last_freeze_consumed_date,
          windowExpiresAtUtc: userStreakRow.window_expires_at_utc,
          atRiskNotifiedForDate: userStreakRow.at_risk_notified_for_date,
          recentHistory: typeof userStreakRow.recent_history === 'string'
            ? JSON.parse(userStreakRow.recent_history)
            : userStreakRow.recent_history || [],
          lastClientEventUtc: userStreakRow.last_client_event_utc,
          lastEventHash: userStreakRow.last_event_hash,
          updatedAt: userStreakRow.updated_at
        };
      }

      // Execute Lazy Read Evaluation
      const stateDto = evaluateStateOnRead(userStreak, rule, nowUtc);
      return reply.status(200).send(stateDto);
    }
  );
}
