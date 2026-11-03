// tests/api.e2e.test.ts: End-to-End API Route Tests
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { getDb } from '../src/config/db.js';
import { seedDatabase } from '../src/db/seed.js';

describe('StreakKit E2E API Integration', () => {
  let server: any;
  let db: any;

  before(async () => {
    db = getDb();
    await db.migrate();
    await seedDatabase(db);
    server = await buildServer();
  });

  after(async () => {
    await server.close();
    await db.close();
  });

  it('GET /health returns healthy status', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/health'
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'healthy');
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/streaks/daily_tailor_log/tailor_guest'
    });
    assert.equal(res.statusCode, 401);
  });

  it('ingests batch events and returns exact StreakStateDTO structure', async () => {
    const testUser = `tailor_batch_${crypto.randomUUID().slice(0, 8)}`;
    const eventId = crypto.randomUUID();
    const res = await server.inject({
      method: 'POST',
      url: '/v1/events/batch',
      headers: {
        authorization: 'Bearer pk_live_zikfash_123'
      },
      payload: {
        externalUserId: testUser,
        timezone: 'Africa/Lagos',
        events: [
          {
            eventId,
            ruleSlug: 'daily_tailor_log',
            value: 1,
            occurredAtUtc: new Date().toISOString(),
            monotonicMs: 482910,
            metadata: { source: 'measurement_saved', clientId: 'cust_44' }
          }
        ]
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.processedCount, 1);
    assert.ok(body.states.daily_tailor_log);

    const state = body.states.daily_tailor_log;
    assert.equal(state.ruleSlug, 'daily_tailor_log');
    assert.equal(state.externalUserId, testUser);
    assert.equal(state.timezone, 'Africa/Lagos');
    assert.equal(state.status, 'ACTIVE_TODAY');
    assert.equal(state.currentStreak, 1);
    assert.equal(state.todayProgress.completed, true);
    assert.ok(state.timing.windowExpiresAtUtc);
    assert.equal(Array.isArray(state.historyLast14Days), true);
  });

  it('deduplicates duplicate eventId submissions without double counting', async () => {
    const testUser = `tailor_dedup_${crypto.randomUUID().slice(0, 8)}`;
    const duplicateEventId = crypto.randomUUID();

    // First submission
    const res1 = await server.inject({
      method: 'POST',
      url: '/v1/events/batch',
      headers: {
        authorization: 'Bearer pk_live_zikfash_123'
      },
      payload: {
        externalUserId: testUser,
        timezone: 'Africa/Lagos',
        events: [
          {
            eventId: duplicateEventId,
            ruleSlug: 'daily_tailor_log',
            value: 1,
            occurredAtUtc: new Date().toISOString()
          }
        ]
      }
    });
    assert.equal(res1.statusCode, 200);

    // Duplicate submission
    const res2 = await server.inject({
      method: 'POST',
      url: '/v1/events/batch',
      headers: {
        authorization: 'Bearer pk_live_zikfash_123'
      },
      payload: {
        externalUserId: testUser,
        timezone: 'Africa/Lagos',
        events: [
          {
            eventId: duplicateEventId,
            ruleSlug: 'daily_tailor_log',
            value: 1,
            occurredAtUtc: new Date().toISOString()
          }
        ]
      }
    });

    assert.equal(res2.statusCode, 200);
    const body = JSON.parse(res2.body);
    assert.equal(body.processedCount, 0);
  });

  it('GET /v1/streaks/:ruleSlug/:userId returns active state', async () => {
    const testUser = `tailor_inspect_${crypto.randomUUID().slice(0, 8)}`;
    // Ping first
    await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: { authorization: 'Bearer pk_live_zikfash_123' },
      payload: {
        ruleSlug: 'daily_tailor_log',
        externalUserId: testUser,
        value: 1,
        timezone: 'Africa/Lagos'
      }
    });

    const res = await server.inject({
      method: 'GET',
      url: `/v1/streaks/daily_tailor_log/${testUser}?timezone=Africa/Lagos`,
      headers: {
        authorization: 'Bearer pk_live_zikfash_123'
      }
    });

    assert.equal(res.statusCode, 200);
    const state = JSON.parse(res.body);
    assert.equal(state.status, 'ACTIVE_TODAY');
    assert.equal(state.currentStreak, 1);
    assert.equal(state.todayProgress.completed, true);
  });

  it('enforces secret key authorization for granting freezes', async () => {
    const freezeUser = 'tailor_freeze_' + crypto.randomUUID().slice(0, 8);
    // 1. Attempt with public key should fail with 403 Forbidden
    const forbiddenRes = await server.inject({
      method: 'POST',
      url: `/v1/streaks/daily_tailor_log/${freezeUser}/freezes/grant`,
      headers: {
        authorization: 'Bearer pk_live_zikfash_123'
      },
      payload: { amount: 2, reason: 'admin_award' }
    });
    assert.equal(forbiddenRes.statusCode, 403);

    // 2. Attempt with secret key should succeed with 200 OK
    const successRes = await server.inject({
      method: 'POST',
      url: `/v1/streaks/daily_tailor_log/${freezeUser}/freezes/grant`,
      headers: {
        authorization: 'Bearer sk_live_zikfash_secret'
      },
      payload: { amount: 2, reason: 'admin_award' }
    });
    assert.equal(successRes.statusCode, 200);
    const body = JSON.parse(successRes.body);
    assert.equal(body.freezes.available, 2);
  });

  it('POST /v1/ping advances streak and returns state with embedUrl in single roundtrip', async () => {
    const testUser = `listener_${crypto.randomUUID().slice(0, 8)}`;
    const res = await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: {
        authorization: 'Bearer pk_live_alify_456'
      },
      payload: {
        ruleSlug: 'alify_playback',
        externalUserId: testUser,
        value: 1,
        timezone: 'Africa/Lagos'
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ruleSlug, 'alify_playback');
    assert.equal(body.externalUserId, testUser);
    assert.equal(body.currentStreak, 1);
    assert.equal(body.status, 'ACTIVE_TODAY');
    assert.equal(body.todayProgress.completed, true);
    assert.equal(body.embedUrl, `/v1/embed/alify_playback/${testUser}`);
  });

  it('GET /v1/embed/:ruleSlug/:userId serves the universal HTML dopamine UI', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/embed/alify_playback/listener_guest'
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/html');
    assert.ok(res.body.includes('Day Streak'));
    assert.ok(res.body.includes('Share Milestone'));
    assert.ok(res.body.includes('closeBtn'));
  });

  it('Rule Management API: list, create, and update rules dynamically', async () => {
    // 1. List rules
    const listRes = await server.inject({
      method: 'GET',
      url: '/v1/rules',
      headers: { authorization: 'Bearer pk_live_alify_456' }
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.body);
    assert.ok(Array.isArray(listBody.rules));
    assert.ok(listBody.rules.some((r: any) => r.slug === 'alify_playback'));

    // 2. Create custom rule dynamically
    const newSlug = `streak_custom_${crypto.randomUUID().slice(0, 6)}`;
    const createRes = await server.inject({
      method: 'POST',
      url: '/v1/rules',
      headers: { authorization: 'Bearer pk_live_alify_456' },
      payload: {
        slug: newSlug,
        name: 'Custom Developer Streak Rule',
        cadenceType: 'DAILY',
        targetValue: 1,
        gracePeriodMinutes: 120,
        maxFreezes: 3
      }
    });
    assert.equal(createRes.statusCode, 201);
    const createBody = JSON.parse(createRes.body);
    assert.equal(createBody.rule.slug, newSlug);
    assert.equal(createBody.rule.targetValue, 1);

    // 3. Update existing rule
    const updateRes = await server.inject({
      method: 'POST',
      url: '/v1/rules',
      headers: { authorization: 'Bearer pk_live_alify_456' },
      payload: {
        slug: newSlug,
        name: 'Updated Rule Name',
        targetValue: 2
      }
    });
    assert.equal(updateRes.statusCode, 200);
    const updateBody = JSON.parse(updateRes.body);
    assert.equal(updateBody.rule.targetValue, 2);
    assert.equal(updateBody.rule.name, 'Updated Rule Name');
  });

  it('GET /dashboard serves developer studio console', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/dashboard'
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/html');
    assert.ok(res.body.includes('Rule Studio'));
    assert.ok(res.body.includes('StreakKit'));
  });
});
