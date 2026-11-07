// tests/moat-routes.e2e.test.ts: E2E API tests for moat routes
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { getDb } from '../src/config/db.js';
import { FastifyInstance } from 'fastify';

describe('Moat Routes E2E API Integration', () => {
  let app: FastifyInstance;
  const tenantId = crypto.randomUUID();
  const ruleId = crypto.randomUUID();
  const publicKey = `pk_live_moat_${crypto.randomBytes(4).toString('hex')}`;
  const ruleSlug = 'hujjify_e2e_moat';

  before(async () => {
    const db = getDb(':memory:');
    await db.migrate();

    await db.execute(
      `INSERT INTO tenants (id, name, public_key, secret_key_hash)
       VALUES ($1, 'E2E Tenant', $2, 'hash_e2e')`,
      [tenantId, publicKey]
    );

    await db.execute(
      `INSERT INTO streak_rules (id, tenant_id, slug, name, cadence_type, target_value, max_freezes, restore_window_days)
       VALUES ($1, $2, $3, 'Hujjify E2E Rule', 'DAILY', 1, 3, 90)`,
      [ruleId, tenantId, ruleSlug]
    );

    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it('POST /v1/streak/pause creates a vacation pause', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/streak/pause',
      headers: { authorization: `Bearer ${publicKey}` },
      payload: {
        ruleSlug,
        externalUserId: 'user_e2e_pause',
        startDate: '2026-12-01',
        endDate: '2026-12-10'
      }
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.ok(body.pause.id);
  });

  it('POST /v1/streak/restore returns 400 when user has no lost streak', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/streak/restore',
      headers: { authorization: `Bearer ${publicKey}` },
      payload: {
        ruleSlug,
        externalUserId: 'user_non_existent'
      }
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'RESTORE_NOT_ELIGIBLE');
  });

  it('POST /v1/streak/friends returns sorted batch streak rankings', async () => {
    const db = getDb();
    await db.execute(
      `INSERT INTO user_streaks (id, tenant_id, rule_id, external_user_id, current_streak, highest_streak, last_completed_logical_date)
       VALUES 
         ($1, $2, $3, 'friend_a', 10, 15, '2026-11-05')`,
      [crypto.randomUUID(), tenantId, ruleId]
    );
    await db.execute(
      `INSERT INTO user_streaks (id, tenant_id, rule_id, external_user_id, current_streak, highest_streak, last_completed_logical_date)
       VALUES 
         ($1, $2, $3, 'friend_b', 25, 30, '2026-11-04')`,
      [crypto.randomUUID(), tenantId, ruleId]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/streak/friends',
      headers: { authorization: `Bearer ${publicKey}` },
      payload: {
        ruleSlug,
        userIds: ['friend_a', 'friend_b', 'friend_c']
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.rankings.length, 3);
    assert.equal(body.rankings[0].userId, 'friend_b');
    assert.equal(body.rankings[0].currentStreak, 25);
    assert.equal(body.rankings[1].userId, 'friend_a');
    assert.equal(body.rankings[1].currentStreak, 10);
  });

  it('POST /v1/streak/preferences updates user settings', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/streak/preferences',
      headers: { authorization: `Bearer ${publicKey}` },
      payload: {
        ruleSlug,
        externalUserId: 'friend_a',
        customTarget: 3,
        daysOffOverride: [0]
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
  });

  it('GET /v1/streak/wrapped returns annual activity metrics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/streak/wrapped?ruleSlug=${ruleSlug}&externalUserId=friend_a&year=2026`,
      headers: { authorization: `Bearer ${publicKey}` }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.wrapped.userId, 'friend_a');
    assert.equal(body.wrapped.year, 2026);
  });

  it('POST /v1/streak/amnesty/evaluate identifies churned user and claim restores streak', async () => {
    const db = getDb();
    const dormantUserId = 'dormant_learner_' + crypto.randomUUID().slice(0, 8);
    // User had a 40-day streak that broke on 2026-10-15 (more than 7 days ago)
    await db.execute(
      `INSERT INTO user_streaks (
        id, tenant_id, rule_id, external_user_id, current_streak, highest_streak,
        last_completed_logical_date, last_broken_streak_length, last_broken_date
      ) VALUES ($1, $2, $3, $4, 0, 40, '2026-10-14', 40, '2026-10-15')`,
      [crypto.randomUUID(), tenantId, ruleId, dormantUserId]
    );

    // 1. Evaluate Amnesty
    const evalRes = await app.inject({
      method: 'POST',
      url: '/v1/streak/amnesty/evaluate',
      headers: { authorization: `Bearer ${publicKey}` },
      payload: {
        ruleSlug,
        externalUserId: dormantUserId,
        minDormantDays: 7
      }
    });

    assert.equal(evalRes.statusCode, 200);
    const evalBody = JSON.parse(evalRes.body);
    assert.equal(evalBody.success, true);
    assert.equal(evalBody.evaluation.eligible, true);
    assert.equal(evalBody.evaluation.resurrectableStreak, 40);
    assert.ok(evalBody.evaluation.pushCopy.title.includes('Amnesty'));

    // 2. Claim Amnesty
    const claimRes = await app.inject({
      method: 'POST',
      url: '/v1/streak/amnesty/claim',
      headers: { authorization: `Bearer ${publicKey}` },
      payload: {
        ruleSlug,
        externalUserId: dormantUserId
      }
    });

    if (claimRes.statusCode !== 200) {
      console.log('CLAIM ERROR:', claimRes.body);
    }

    assert.equal(claimRes.statusCode, 200);
    const claimBody = JSON.parse(claimRes.body);
    assert.equal(claimBody.success, true);
    assert.equal(claimBody.resurrectedStreak, 41); // Resurrected to 40 + 1!
  });
});
