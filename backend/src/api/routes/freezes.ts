// api/routes/freezes.ts: Manual freeze application and admin freeze granting
import { FastifyInstance, FastifyReply } from 'fastify';
import {
  AuthenticatedRequest,
  authenticateApiKey,
  requireSecretKey
} from '../middleware/auth.js';
import { getDb } from '../../config/db.js';
import { StreakRule, UserStreak } from '../../domain/types.js';
import { evaluateStateOnRead } from '../../domain/evaluator.js';
import { computeLogicalDate } from '../../domain/time-window.js';

export async function registerFreezeRoutes(fastify: FastifyInstance) {
  // 1. Manually consume a freeze
  fastify.post(
    '/v1/streaks/:ruleSlug/:externalUserId/freeze',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const { ruleSlug, externalUserId } = request.params as {
        ruleSlug: string;
        externalUserId: string;
      };

      const db = getDb();
      const nowUtc = new Date();

      const ruleRow = await db.get<any>(
        'SELECT * FROM streak_rules WHERE tenant_id = $1 AND slug = $2',
        [tenant.id, ruleSlug]
      );
      if (!ruleRow) {
        return reply.status(404).send({ error: `Rule not found: ${ruleSlug}` });
      }

      const userStreakRow = await db.get<any>(
        'SELECT * FROM user_streaks WHERE rule_id = $1 AND external_user_id = $2',
        [ruleRow.id, externalUserId]
      );
      if (!userStreakRow) {
        return reply.status(404).send({ error: 'User streak not found' });
      }

      if (userStreakRow.freezes_available <= 0) {
        return reply.status(400).send({ error: 'No freezes available' });
      }

      const today = computeLogicalDate(
        nowUtc,
        userStreakRow.timezone,
        ruleRow.grace_period_minutes
      );
      const updatedFreezes = userStreakRow.freezes_available - 1;
      const history = typeof userStreakRow.recent_history === 'string'
        ? JSON.parse(userStreakRow.recent_history)
        : userStreakRow.recent_history || [];
      history.push({ date: today, state: 'FROZEN' });

      await db.execute(
        `UPDATE user_streaks SET
          freezes_available = $1,
          last_freeze_consumed_date = $2,
          recent_history = $3,
          updated_at = $4
         WHERE id = $5`,
        [updatedFreezes, today, JSON.stringify(history), nowUtc.toISOString(), userStreakRow.id]
      );

      // Record outbox event
      await db.execute(
        `INSERT INTO webhook_outbox (id, tenant_id, event_type, payload, status)
         VALUES ($1, $2, 'streak.frozen', $3, 'PENDING')`,
        [
          crypto.randomUUID(),
          tenant.id,
          JSON.stringify({
            ruleSlug,
            externalUserId,
            freezesConsumed: 1,
            freezesRemaining: updatedFreezes,
            date: today,
            reason: 'manual_freeze'
          })
        ]
      );

      const userStreak: UserStreak = {
        id: userStreakRow.id,
        tenantId: userStreakRow.tenant_id,
        ruleId: userStreakRow.rule_id,
        externalUserId: userStreakRow.external_user_id,
        timezone: userStreakRow.timezone,
        currentStreak: userStreakRow.current_streak,
        highestStreak: userStreakRow.highest_streak,
        lastCompletedLogicalDate: userStreakRow.last_completed_logical_date,
        currentLogicalDate: userStreakRow.current_logical_date,
        currentWindowProgress: userStreakRow.current_window_progress,
        freezesAvailable: updatedFreezes,
        lastFreezeConsumedDate: today,
        windowExpiresAtUtc: userStreakRow.window_expires_at_utc,
        atRiskNotifiedForDate: userStreakRow.at_risk_notified_for_date,
        recentHistory: history,
        lastClientEventUtc: userStreakRow.last_client_event_utc,
        lastEventHash: userStreakRow.last_event_hash,
        updatedAt: nowUtc.toISOString()
      };

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

      return reply.status(200).send(evaluateStateOnRead(userStreak, rule, nowUtc));
    }
  );

  // 2. Grant freezes (Server-to-Server, requires sk_live_...)
  fastify.post(
    '/v1/streaks/:ruleSlug/:externalUserId/freezes/grant',
    { preHandler: requireSecretKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const { ruleSlug, externalUserId } = request.params as {
        ruleSlug: string;
        externalUserId: string;
      };
      const body = (request.body || {}) as { amount?: number; reason?: string };
      const amount = typeof body.amount === 'number' && body.amount > 0 ? body.amount : 1;

      const db = getDb();
      const nowUtc = new Date();

      const ruleRow = await db.get<any>(
        'SELECT * FROM streak_rules WHERE tenant_id = $1 AND slug = $2',
        [tenant.id, ruleSlug]
      );
      if (!ruleRow) {
        return reply.status(404).send({ error: `Rule not found: ${ruleSlug}` });
      }

      let userStreakRow = await db.get<any>(
        'SELECT * FROM user_streaks WHERE rule_id = $1 AND external_user_id = $2',
        [ruleRow.id, externalUserId]
      );

      if (!userStreakRow) {
        const newId = crypto.randomUUID();
        await db.execute(
          `INSERT INTO user_streaks (
            id, tenant_id, rule_id, external_user_id, timezone,
            current_streak, highest_streak, last_completed_logical_date,
            current_logical_date, current_window_progress, freezes_available,
            recent_history
          ) VALUES ($1, $2, $3, $4, 'UTC', 0, 0, NULL, NULL, 0, $5, '[]')`,
          [newId, tenant.id, ruleRow.id, externalUserId, amount]
        );
        userStreakRow = await db.get<any>('SELECT * FROM user_streaks WHERE id = $1', [newId]);
      } else {
        await db.execute(
          'UPDATE user_streaks SET freezes_available = freezes_available + $1, updated_at = $2 WHERE id = $3',
          [amount, nowUtc.toISOString(), userStreakRow.id]
        );
        userStreakRow.freezes_available += amount;
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

      const userStreak: UserStreak = {
        id: userStreakRow.id,
        tenantId: userStreakRow.tenant_id,
        ruleId: userStreakRow.rule_id,
        externalUserId: userStreakRow.external_user_id,
        timezone: userStreakRow.timezone,
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
        updatedAt: nowUtc.toISOString()
      };

      return reply.status(200).send(evaluateStateOnRead(userStreak, rule, nowUtc));
    }
  );
}
