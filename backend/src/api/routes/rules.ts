// api/routes/rules.ts: Developer Rule Management API (CRUD)
import crypto from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticatedRequest, authenticateApiKey } from '../middleware/auth.js';
import { getDb } from '../../config/db.js';
import { StreakRule } from '../../domain/types.js';

export async function registerRuleRoutes(fastify: FastifyInstance) {
  // 1. GET /v1/rules: List all rules for tenant
  fastify.get(
    '/v1/rules',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const db = getDb();

      const rows = await db.query<any>(
        'SELECT * FROM streak_rules WHERE tenant_id = $1 ORDER BY created_at ASC',
        [tenant.id]
      );

      const rules: StreakRule[] = rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        slug: r.slug,
        name: r.name,
        cadenceType: r.cadence_type,
        targetValue: r.target_value,
        exemptDaysBitmask: r.exempt_days_bitmask,
        gracePeriodMinutes: r.grace_period_minutes,
        maxFreezes: r.max_freezes,
        autoConsumeFreeze: Boolean(r.auto_consume_freeze),
        atRiskLeadMinutes: r.at_risk_lead_minutes,
        milestoneDays: typeof r.milestone_days === 'string'
          ? JSON.parse(r.milestone_days)
          : r.milestone_days,
        createdAt: r.created_at
      }));

      return reply.send({ rules });
    }
  );

  // 2. GET /v1/rules/:slug: Get a single rule by slug
  fastify.get(
    '/v1/rules/:slug',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const { slug } = request.params as { slug: string };
      const db = getDb();

      const r = await db.get<any>(
        'SELECT * FROM streak_rules WHERE tenant_id = $1 AND slug = $2',
        [tenant.id, slug]
      );

      if (!r) {
        return reply.status(404).send({ error: `Rule '${slug}' not found` });
      }

      const rule: StreakRule = {
        id: r.id,
        tenantId: r.tenant_id,
        slug: r.slug,
        name: r.name,
        cadenceType: r.cadence_type,
        targetValue: r.target_value,
        exemptDaysBitmask: r.exempt_days_bitmask,
        gracePeriodMinutes: r.grace_period_minutes,
        maxFreezes: r.max_freezes,
        autoConsumeFreeze: Boolean(r.auto_consume_freeze),
        atRiskLeadMinutes: r.at_risk_lead_minutes,
        milestoneDays: typeof r.milestone_days === 'string'
          ? JSON.parse(r.milestone_days)
          : r.milestone_days,
        createdAt: r.created_at
      };

      return reply.send({ rule });
    }
  );

  // 3. POST /v1/rules: Upsert a streak rule
  fastify.post(
    '/v1/rules',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = request.body as any;

      if (!body || !body.slug || !body.name) {
        return reply.status(400).send({
          error: 'slug and name are required'
        });
      }

      const db = getDb();
      const slug = body.slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const name = body.name.trim();
      const cadenceType = body.cadenceType || body.cadence_type || 'DAILY';
      const targetValue = Math.max(1, parseInt(body.targetValue ?? body.target_value ?? 1, 10));
      const exemptDaysBitmask = parseInt(body.exemptDaysBitmask ?? body.exempt_days_bitmask ?? 0, 10);
      const gracePeriodMinutes = Math.max(0, parseInt(body.gracePeriodMinutes ?? body.grace_period_minutes ?? 120, 10));
      const maxFreezes = Math.max(0, parseInt(body.maxFreezes ?? body.max_freezes ?? 2, 10));
      const autoConsumeFreeze = body.autoConsumeFreeze ?? body.auto_consume_freeze ?? true ? 1 : 0;
      const atRiskLeadMinutes = Math.max(0, parseInt(body.atRiskLeadMinutes ?? body.at_risk_lead_minutes ?? 120, 10));
      const milestoneDays = Array.isArray(body.milestoneDays ?? body.milestone_days)
        ? (body.milestoneDays ?? body.milestone_days)
        : [3, 7, 14, 30, 50, 100, 365];

      const existing = await db.get<any>(
        'SELECT id FROM streak_rules WHERE tenant_id = $1 AND slug = $2',
        [tenant.id, slug]
      );

      if (existing) {
        await db.execute(
          `UPDATE streak_rules SET
            name = $1,
            cadence_type = $2,
            target_value = $3,
            exempt_days_bitmask = $4,
            grace_period_minutes = $5,
            max_freezes = $6,
            auto_consume_freeze = $7,
            at_risk_lead_minutes = $8,
            milestone_days = $9
           WHERE id = $10`,
          [
            name,
            cadenceType,
            targetValue,
            exemptDaysBitmask,
            gracePeriodMinutes,
            maxFreezes,
            autoConsumeFreeze,
            atRiskLeadMinutes,
            JSON.stringify(milestoneDays),
            existing.id
          ]
        );

        return reply.send({
          status: 'updated',
          rule: {
            id: existing.id,
            tenantId: tenant.id,
            slug,
            name,
            cadenceType,
            targetValue,
            exemptDaysBitmask,
            gracePeriodMinutes,
            maxFreezes,
            autoConsumeFreeze: Boolean(autoConsumeFreeze),
            atRiskLeadMinutes,
            milestoneDays
          }
        });
      } else {
        const id = crypto.randomUUID();
        await db.execute(
          `INSERT INTO streak_rules (
            id, tenant_id, slug, name, cadence_type, target_value,
            exempt_days_bitmask, grace_period_minutes, max_freezes,
            auto_consume_freeze, at_risk_lead_minutes, milestone_days
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            id,
            tenant.id,
            slug,
            name,
            cadenceType,
            targetValue,
            exemptDaysBitmask,
            gracePeriodMinutes,
            maxFreezes,
            autoConsumeFreeze,
            atRiskLeadMinutes,
            JSON.stringify(milestoneDays)
          ]
        );

        return reply.status(201).send({
          status: 'created',
          rule: {
            id,
            tenantId: tenant.id,
            slug,
            name,
            cadenceType,
            targetValue,
            exemptDaysBitmask,
            gracePeriodMinutes,
            maxFreezes,
            autoConsumeFreeze: Boolean(autoConsumeFreeze),
            atRiskLeadMinutes,
            milestoneDays
          }
        });
      }
    }
  );

  // 4. DELETE /v1/rules/:slug: Delete a rule
  fastify.delete(
    '/v1/rules/:slug',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const { slug } = request.params as { slug: string };
      const db = getDb();

      const existing = await db.get<any>(
        'SELECT id FROM streak_rules WHERE tenant_id = $1 AND slug = $2',
        [tenant.id, slug]
      );

      if (!existing) {
        return reply.status(404).send({ error: `Rule '${slug}' not found` });
      }

      await db.execute('DELETE FROM streak_rules WHERE id = $1', [existing.id]);
      return reply.send({ status: 'deleted', slug });
    }
  );

  // 5. POST /v1/rules/sync: Bulk sync rules directly from SDK JSON config
  fastify.post(
    '/v1/rules/sync',
    { preHandler: authenticateApiKey },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const tenant = request.tenant!;
      const body = (request.body || {}) as { rules?: Array<any> };
      if (!body.rules || !Array.isArray(body.rules)) {
        return reply.status(400).send({ error: 'rules array is required' });
      }

      const db = getDb();
      const synced = [];

      for (const r of body.rules) {
        if (!r || !r.slug) continue;
        const slug = r.slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const name = r.name || slug.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        const cadence = r.cadenceType || r.cadence || 'DAILY';
        const target = Math.max(1, parseInt(String(r.targetValue ?? r.target ?? 1), 10));
        const grace = parseInt(String(r.gracePeriodMinutes ?? 120), 10);
        const freezes = parseInt(String(r.maxFreezes ?? 2), 10);
        const bitmask = parseInt(String(r.exemptDaysBitmask ?? 0), 10);
        const milestones = Array.isArray(r.milestoneDays) ? r.milestoneDays : [3, 7, 14, 30, 50, 100, 365];

        const existing = await db.get<any>(
          'SELECT id FROM streak_rules WHERE tenant_id = $1 AND slug = $2',
          [tenant.id, slug]
        );

        if (existing) {
          await db.execute(
            `UPDATE streak_rules SET
              name = $1,
              cadence_type = $2,
              target_value = $3,
              exempt_days_bitmask = $4,
              grace_period_minutes = $5,
              max_freezes = $6,
              milestone_days = $7
             WHERE id = $8`,
            [name, cadence, target, bitmask, grace, freezes, JSON.stringify(milestones), existing.id]
          );
          synced.push({ slug, status: 'updated', target });
        } else {
          await db.execute(
            `INSERT INTO streak_rules (
              id, tenant_id, slug, name, cadence_type, target_value,
              exempt_days_bitmask, grace_period_minutes, max_freezes,
              auto_consume_freeze, at_risk_lead_minutes, milestone_days
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 120, $10)`,
            [
              crypto.randomUUID(),
              tenant.id,
              slug,
              name,
              cadence,
              target,
              bitmask,
              grace,
              freezes,
              JSON.stringify(milestones)
            ]
          );
          synced.push({ slug, status: 'created', target });
        }
      }

      return reply.send({ status: 'ok', synced });
    }
  );
}
