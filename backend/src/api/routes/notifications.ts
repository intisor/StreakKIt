// api/routes/notifications.ts: Behavioral Contrast & Escalating Notification API
import crypto from 'node:crypto';
import { FastifyInstance, FastifyReply } from 'fastify';
import { AuthenticatedRequest, authenticateApiKey } from '../middleware/auth.js';
import { getDb } from '../../config/db.js';
import {
  generateBehavioralContrastNudge,
  TriggerActivity,
  ContrastArchetype,
  AIEnhancerConfig
} from '../../domain/behavioral-contrast.js';
import { evaluateNotificationCopy, NotificationTone } from '../../domain/notifications.js';
import { evaluateStateOnRead } from '../../domain/evaluator.js';
import { StreakRule, UserStreak } from '../../domain/types.js';

export async function registerNotificationRoutes(fastify: FastifyInstance) {
  /**
   * POST /v1/notifications/contrast
   * Evaluates psychological behavioral contrast nudges (e.g. music vs deen, social scroll vs language).
   */
  fastify.post(
    '/v1/notifications/contrast',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = request.body as {
        userId: string;
        neglectedRuleSlug: string;
        triggerActivity: TriggerActivity;
        archetype?: ContrastArchetype;
        customCopies?: string[];
        aiConfig?: AIEnhancerConfig;
        domain?: string;
      };

      if (!body || !body.userId || !body.neglectedRuleSlug || !body.triggerActivity) {
        return reply.status(400).send({
          error: 'Missing required parameters: userId, neglectedRuleSlug, and triggerActivity'
        });
      }

      const db = getDb();

      // 1. Fetch the neglected rule
      const ruleRow = await db.get<any>(
        'SELECT * FROM streak_rules WHERE tenant_id = $1 AND slug = $2',
        [tenant.id, body.neglectedRuleSlug]
      );

      if (!ruleRow) {
        return reply.status(404).send({ error: `Rule '${body.neglectedRuleSlug}' not found` });
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

      // 2. Fetch User Streak state
      let userStreakRow = await db.get<any>(
        'SELECT * FROM user_streaks WHERE rule_id = $1 AND external_user_id = $2',
        [rule.id, body.userId]
      );

      let currentStreak = 0;
      let completedToday = false;

      if (userStreakRow) {
        const userStreak: UserStreak = {
          id: userStreakRow.id,
          tenantId: userStreakRow.tenant_id,
          ruleId: userStreakRow.rule_id,
          externalUserId: userStreakRow.external_user_id,
          timezone: userStreakRow.timezone || 'UTC',
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
            : (userStreakRow.recent_history || []),
          lastClientEventUtc: userStreakRow.last_client_event_utc,
          lastEventHash: userStreakRow.last_event_hash,
          updatedAt: userStreakRow.updated_at
        };

        const stateDTO = evaluateStateOnRead(userStreak, rule, new Date());
        currentStreak = stateDTO.currentStreak;
        completedToday = stateDTO.status === 'ACTIVE_TODAY';
      }

      // Infer domain from rule name or slug if not passed
      const domain = body.domain || (
        rule.slug.includes('deen') || rule.slug.includes('quran') || rule.slug.includes('hujjify') ? 'deen'
        : rule.slug.includes('lesson') || rule.slug.includes('gungbe') || rule.slug.includes('lang') ? 'learning'
        : rule.slug.includes('fit') || rule.slug.includes('workout') ? 'fitness'
        : 'habits'
      );

      // 3. Generate Behavioral Contrast Nudge
      const notification = await generateBehavioralContrastNudge({
        triggerActivity: body.triggerActivity,
        neglectedGoal: {
          ruleSlug: rule.slug,
          ruleName: rule.name,
          domain,
          currentStreak,
          completedToday
        },
        archetype: body.archetype,
        customCopies: body.customCopies,
        aiConfig: body.aiConfig
      });

      return reply.status(200).send({
        notification,
        completedToday,
        currentStreak
      });
    }
  );

  /**
   * GET /v1/notifications/evaluate/:ruleSlug/:userId
   * Evaluates standard escalating loss-aversion notifications (Nudge 4h, Urgent 2h, Panic 30m).
   */
  fastify.get(
    '/v1/notifications/evaluate/:ruleSlug/:userId',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const { ruleSlug, userId } = request.params as { ruleSlug: string; userId: string };
      const tone = (request.query as any)?.tone as NotificationTone || 'UNHINGED';

      const db = getDb();
      const ruleRow = await db.get<any>(
        'SELECT * FROM streak_rules WHERE tenant_id = $1 AND slug = $2',
        [tenant.id, ruleSlug]
      );

      if (!ruleRow) {
        return reply.status(404).send({ error: `Rule '${ruleSlug}' not found` });
      }

      const userStreakRow = await db.get<any>(
        'SELECT * FROM user_streaks WHERE rule_id = $1 AND external_user_id = $2',
        [ruleRow.id, userId]
      );

      if (!userStreakRow) {
        return reply.status(200).send({ notification: null, reason: 'NO_ACTIVE_STREAK' });
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
        timezone: userStreakRow.timezone || 'UTC',
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
          : (userStreakRow.recent_history || []),
        lastClientEventUtc: userStreakRow.last_client_event_utc,
        lastEventHash: userStreakRow.last_event_hash,
        updatedAt: userStreakRow.updated_at
      };

      const stateDTO = evaluateStateOnRead(userStreak, rule, new Date());
      const secondsUntilExpiry = stateDTO.timing.secondsUntilExpiry;
      const completedToday = stateDTO.status === 'ACTIVE_TODAY';

      const notification = evaluateNotificationCopy({
        ruleName: rule.name,
        currentStreak: stateDTO.currentStreak,
        secondsUntilExpiry,
        completedToday,
        freezesAvailable: stateDTO.freezes.available,
        tone
      });

      return reply.status(200).send({
        notification,
        state: stateDTO
      });
    }
  );

  /**
   * POST /v1/users/push-token
   * Registers a client device push token (FCM, OneSignal, APNs)
   */
  fastify.post(
    '/v1/users/push-token',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = request.body as {
        externalUserId: string;
        pushToken: string;
        platform?: 'FCM' | 'ONESIGNAL' | 'APNS';
      };

      if (!body?.externalUserId || !body?.pushToken) {
        return reply.status(400).send({
          error: 'Missing required parameters: externalUserId and pushToken'
        });
      }

      const db = getDb();
      const platform = body.platform || 'FCM';
      const id = crypto.randomUUID();

      await db.execute(
        `INSERT INTO user_push_tokens (id, tenant_id, external_user_id, push_token, platform)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, external_user_id, push_token) DO UPDATE SET
           platform = excluded.platform,
           updated_at = datetime('now')`,
        [id, tenant.id, body.externalUserId, body.pushToken, platform]
      );

      return reply.status(200).send({ success: true, message: 'Push token registered' });
    }
  );
}
