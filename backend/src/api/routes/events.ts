// api/routes/events.ts: POST /v1/events/batch
import crypto from 'node:crypto';
import { FastifyInstance, FastifyReply } from 'fastify';
import { AuthenticatedRequest, authenticateApiKey } from '../middleware/auth.js';
import { getDb } from '../../config/db.js';
import {
  BatchEventsRequest,
  StreakRule,
  UserStreak,
  StreakStateDTO
} from '../../domain/types.js';
import { verifyEventBatchIntegrity } from '../../domain/anticheat.js';
import { evaluateEvent, evaluateStateOnRead } from '../../domain/evaluator.js';
import { computeLogicalDate } from '../../domain/time-window.js';

export async function registerEventRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/v1/events/batch',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = request.body as BatchEventsRequest;

      if (!body || !body.externalUserId || !Array.isArray(body.events)) {
        return reply.status(400).send({
          error: 'Invalid payload: externalUserId and events array are required'
        });
      }

      if (body.events.length === 0) {
        return reply.status(200).send({ states: {}, processedCount: 0 });
      }

      const db = getDb();
      const userTimezone = body.timezone || 'UTC';
      const externalUserId = body.externalUserId;
      const nowUtc = new Date();

      // Execute ingestion and state transitions inside an atomic transaction
      const result = await db.transaction(async (tx) => {
        // 1. Fetch rules for this tenant
        const ruleRows = await tx.query<any>(
          'SELECT * FROM streak_rules WHERE tenant_id = $1',
          [tenant.id]
        );
        const rulesBySlug = new Map<string, StreakRule>();
        for (const row of ruleRows) {
          rulesBySlug.set(row.slug, {
            id: row.id,
            tenantId: row.tenant_id,
            slug: row.slug,
            name: row.name,
            cadenceType: row.cadence_type,
            targetValue: row.target_value,
            exemptDaysBitmask: row.exempt_days_bitmask,
            gracePeriodMinutes: row.grace_period_minutes,
            maxFreezes: row.max_freezes,
            autoConsumeFreeze: Boolean(row.auto_consume_freeze),
            atRiskLeadMinutes: row.at_risk_lead_minutes,
            milestoneDays: typeof row.milestone_days === 'string'
              ? JSON.parse(row.milestone_days)
              : row.milestone_days,
            createdAt: row.created_at
          });
        }

        // Group incoming events by ruleSlug
        const eventsByRule = new Map<string, typeof body.events>();
        for (const ev of body.events) {
          if (!rulesBySlug.has(ev.ruleSlug)) {
            continue; // Skip unknown rule
          }
          const list = eventsByRule.get(ev.ruleSlug) || [];
          list.push(ev);
          eventsByRule.set(ev.ruleSlug, list);
        }

        const updatedStates: Record<string, StreakStateDTO> = {};
        let processedCount = 0;

        for (const [ruleSlug, events] of eventsByRule.entries()) {
          const rule = rulesBySlug.get(ruleSlug)!;

          // 2. Fetch or initialize User Streak Ledger row
          let userStreakRow = await tx.get<any>(
            'SELECT * FROM user_streaks WHERE rule_id = $1 AND external_user_id = $2',
            [rule.id, externalUserId]
          );

          let userStreak: UserStreak;
          if (!userStreakRow) {
            const newId = crypto.randomUUID();
            await tx.execute(
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
              timezone: userStreakRow.timezone || userTimezone,
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

          // 3. Verify anti-cheat and clock integrity on event batch
          const lastClientUtc = userStreak.lastClientEventUtc
            ? new Date(userStreak.lastClientEventUtc)
            : null;
          const verifiedEvents = verifyEventBatchIntegrity(
            events,
            nowUtc,
            lastClientUtc,
            userStreak.lastEventHash
          );

          // 4. Process each event idempotently
          for (const ev of verifiedEvents) {
            const logicalDate = computeLogicalDate(
              ev.occurredAtUtc,
              userStreak.timezone,
              rule.gracePeriodMinutes
            );

            // Deduplicate via event_id
            try {
              const insertResult = await tx.execute(
                `INSERT INTO streak_events (
                  event_id, tenant_id, rule_id, external_user_id, value,
                  occurred_at_utc, logical_local_date, monotonic_ms,
                  prev_event_hash, trust_flag, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                  ev.eventId,
                  tenant.id,
                  rule.id,
                  externalUserId,
                  ev.value,
                  ev.occurredAtUtc.toISOString(),
                  logicalDate,
                  ev.monotonicMs,
                  ev.prevEventHash,
                  ev.trustFlag,
                  ev.metadata ? JSON.stringify(ev.metadata) : null
                ]
              );

              if (insertResult.rowCount === 0) {
                // Event already recorded, skip state transition
                continue;
              }
            } catch (err: any) {
              // Primary key conflict on event_id means already processed
              if (err.message && (err.message.includes('UNIQUE') || err.message.includes('duplicate'))) {
                continue;
              }
              throw err;
            }

            // Execute deterministic state transition
            const evalResult = evaluateEvent(userStreak, rule, ev, nowUtc);
            userStreak = evalResult.updatedStreak;
            processedCount++;

            // Enqueue webhooks into transactional outbox
            for (const wh of evalResult.webhooksToEnqueue) {
              await tx.execute(
                `INSERT INTO webhook_outbox (id, tenant_id, event_type, payload, status)
                 VALUES ($1, $2, $3, $4, 'PENDING')`,
                [crypto.randomUUID(), tenant.id, wh.eventType, JSON.stringify(wh.payload)]
              );
            }
          }

          // 5. Persist updated user streak ledger
          await tx.execute(
            `UPDATE user_streaks SET
              current_streak = $1,
              highest_streak = $2,
              last_completed_logical_date = $3,
              current_logical_date = $4,
              current_window_progress = $5,
              freezes_available = $6,
              last_freeze_consumed_date = $7,
              window_expires_at_utc = $8,
              at_risk_notified_for_date = $9,
              recent_history = $10,
              last_client_event_utc = $11,
              last_event_hash = $12,
              updated_at = $13
             WHERE id = $14`,
            [
              userStreak.currentStreak,
              userStreak.highestStreak,
              userStreak.lastCompletedLogicalDate,
              userStreak.currentLogicalDate,
              userStreak.currentWindowProgress,
              userStreak.freezesAvailable,
              userStreak.lastFreezeConsumedDate,
              userStreak.windowExpiresAtUtc,
              userStreak.atRiskNotifiedForDate,
              JSON.stringify(userStreak.recentHistory),
              userStreak.lastClientEventUtc,
              userStreak.lastEventHash,
              nowUtc.toISOString(),
              userStreak.id
            ]
          );

          updatedStates[ruleSlug] = evaluateStateOnRead(userStreak, rule, nowUtc);
        }

        return { states: updatedStates, processedCount };
      });

      return reply.status(200).send(result);
    }
  );

  // Simplified Single-Roundtrip Ping Endpoint
  fastify.post(
    '/v1/ping',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = (request.body || {}) as {
        ruleSlug?: string;
        externalUserId?: string;
        value?: number;
        timezone?: string;
        metadata?: Record<string, unknown>;
        ruleConfig?: {
          name?: string;
          target?: number;
          targetValue?: number;
          cadence?: string;
          cadenceType?: string;
          gracePeriodMinutes?: number;
          maxFreezes?: number;
          exemptDaysBitmask?: number;
          milestoneDays?: number[];
        };
      };

      if (!body.ruleSlug || !body.externalUserId) {
        return reply.status(400).send({
          error: 'ruleSlug and externalUserId are required'
        });
      }

      const ruleSlug = body.ruleSlug;
      const externalUserId = body.externalUserId;
      const db = getDb();
      const nowUtc = new Date();
      const userTimezone = body.timezone || 'UTC';
      const value = typeof body.value === 'number' && body.value > 0 ? Math.floor(body.value) : 1;

      const result = await db.transaction(async (tx) => {
        // 1. Fetch or auto-provision rule from developer JSON config
        let ruleRow = await tx.get<any>(
          'SELECT * FROM streak_rules WHERE tenant_id = $1 AND slug = $2',
          [tenant.id, ruleSlug]
        );

        const config = body.ruleConfig;
        if (!ruleRow) {
          const newRuleId = crypto.randomUUID();
          const target = Math.max(1, parseInt(String(config?.targetValue ?? config?.target ?? 1), 10));
          const name = config?.name || ruleSlug.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          const cadence = config?.cadenceType || config?.cadence || 'DAILY';
          const grace = config?.gracePeriodMinutes ?? 120;
          const freezes = config?.maxFreezes ?? 2;
          const bitmask = config?.exemptDaysBitmask ?? 0;
          const milestones = config?.milestoneDays || [3, 7, 14, 30, 50, 100, 365];

          await tx.execute(
            `INSERT INTO streak_rules (
              id, tenant_id, slug, name, cadence_type, target_value,
              exempt_days_bitmask, grace_period_minutes, max_freezes,
              auto_consume_freeze, at_risk_lead_minutes, milestone_days
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 120, $10)`,
            [
              newRuleId,
              tenant.id,
              ruleSlug,
              name,
              cadence,
              target,
              bitmask,
              grace,
              freezes,
              JSON.stringify(milestones)
            ]
          );

          ruleRow = {
            id: newRuleId,
            tenant_id: tenant.id,
            slug: ruleSlug,
            name,
            cadence_type: cadence,
            target_value: target,
            exempt_days_bitmask: bitmask,
            grace_period_minutes: grace,
            max_freezes: freezes,
            auto_consume_freeze: 1,
            at_risk_lead_minutes: 120,
            milestone_days: milestones,
            created_at: nowUtc.toISOString()
          };
        } else if (config && (config.targetValue || config.target)) {
          const target = Math.max(1, parseInt(String(config.targetValue ?? config.target), 10));
          if (target !== ruleRow.target_value) {
            await tx.execute(
              'UPDATE streak_rules SET target_value = $1 WHERE id = $2',
              [target, ruleRow.id]
            );
            ruleRow.target_value = target;
          }
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
          atRiskLeadMinutes: row_lead_minutes(ruleRow.at_risk_lead_minutes),
          milestoneDays: typeof ruleRow.milestone_days === 'string'
            ? JSON.parse(ruleRow.milestone_days)
            : ruleRow.milestone_days,
          createdAt: ruleRow.created_at
        };

        // 2. Fetch or create user streak
        let userStreakRow = await tx.get<any>(
          'SELECT * FROM user_streaks WHERE rule_id = $1 AND external_user_id = $2',
          [rule.id, body.externalUserId]
        );

        let userStreak: UserStreak;
        if (!userStreakRow) {
          const newId = crypto.randomUUID();
          await tx.execute(
            `INSERT INTO user_streaks (
              id, tenant_id, rule_id, external_user_id, timezone,
              current_streak, highest_streak, last_completed_logical_date,
              current_logical_date, current_window_progress, freezes_available,
              recent_history
            ) VALUES ($1, $2, $3, $4, $5, 0, 0, NULL, NULL, 0, $6, '[]')`,
            [newId, tenant.id, rule.id, body.externalUserId, userTimezone, rule.maxFreezes]
          );

          userStreak = {
            id: newId,
            tenantId: tenant.id,
            ruleId: rule.id,
            externalUserId: body.externalUserId!,
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
            timezone: body.timezone || userStreakRow.timezone || 'UTC',
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

        // 3. Record event
        const eventId = crypto.randomUUID();
        const logicalDate = computeLogicalDate(nowUtc, userStreak.timezone, rule.gracePeriodMinutes);
        const computedHash = crypto.createHash('sha256')
          .update(`${userStreak.lastEventHash || 'ROOT'}:${eventId}:${nowUtc.toISOString()}:${value}`)
          .digest('hex');

        await tx.execute(
          `INSERT INTO streak_events (
            event_id, tenant_id, rule_id, external_user_id, value,
            occurred_at_utc, logical_local_date, monotonic_ms,
            prev_event_hash, trust_flag, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'VERIFIED', $10)`,
          [
            eventId,
            tenant.id,
            rule.id,
            body.externalUserId,
            value,
            nowUtc.toISOString(),
            logicalDate,
            0,
            userStreak.lastEventHash,
            body.metadata ? JSON.stringify(body.metadata) : null
          ]
        );

        // 4. Evaluate event
        const verifiedEvent = {
          eventId,
          ruleSlug: body.ruleSlug!,
          value,
          occurredAtUtc: nowUtc,
          monotonicMs: 0,
          prevEventHash: userStreak.lastEventHash,
          computedHash,
          trustFlag: 'VERIFIED' as const,
          metadata: body.metadata || null
        };

        const evalResult = evaluateEvent(userStreak, rule, verifiedEvent, nowUtc);
        userStreak = evalResult.updatedStreak;

        // 5. Enqueue outbox webhooks
        for (const wh of evalResult.webhooksToEnqueue) {
          await tx.execute(
            `INSERT INTO webhook_outbox (id, tenant_id, event_type, payload, status)
             VALUES ($1, $2, $3, $4, 'PENDING')`,
            [crypto.randomUUID(), tenant.id, wh.eventType, JSON.stringify(wh.payload)]
          );
        }

        // 6. Persist updated streak
        await tx.execute(
          `UPDATE user_streaks SET
            current_streak = $1,
            highest_streak = $2,
            last_completed_logical_date = $3,
            current_logical_date = $4,
            current_window_progress = $5,
            freezes_available = $6,
            last_freeze_consumed_date = $7,
            window_expires_at_utc = $8,
            at_risk_notified_for_date = $9,
            recent_history = $10,
            last_client_event_utc = $11,
            last_event_hash = $12,
            updated_at = $13
           WHERE id = $14`,
          [
            userStreak.currentStreak,
            userStreak.highestStreak,
            userStreak.lastCompletedLogicalDate,
            userStreak.currentLogicalDate,
            userStreak.currentWindowProgress,
            userStreak.freezesAvailable,
            userStreak.lastFreezeConsumedDate,
            userStreak.windowExpiresAtUtc,
            userStreak.atRiskNotifiedForDate,
            JSON.stringify(userStreak.recentHistory),
            userStreak.lastClientEventUtc,
            userStreak.lastEventHash,
            nowUtc.toISOString(),
            userStreak.id
          ]
        );

        const stateDto = evaluateStateOnRead(userStreak, rule, nowUtc);
        return {
          ...stateDto,
          embedUrl: `/v1/embed/${encodeURIComponent(rule.slug)}/${encodeURIComponent(userStreak.externalUserId)}`
        };
      });

      if (!result) {
        return reply.status(404).send({ error: `Rule not found: ${body.ruleSlug}` });
      }

      return reply.status(200).send(result);
    }
  );
}

function row_lead_minutes(val: any): number {
  return typeof val === 'number' ? val : 120;
}
