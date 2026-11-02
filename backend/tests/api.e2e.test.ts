// tests/api.e2e.test.ts: End-to-end API integration tests
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { getDb } from '../src/config/db.js';
import { seedDatabase } from '../src/db/seed.js';

describe('StreakKit E2E API Integration', () => {
  let server: any;
  const db = getDb();

  before(async () => {
    await db.migrate();
    await seedDatabase(db);
    server = await buildServer();
    await server.ready();
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
    const eventId = crypto.randomUUID();
    const res = await server.inject({
      method: 'POST',
      url: '/v1/events/batch',
      headers: {
        authorization: 'Bearer pk_live_zikfash_123'
      },
      payload: {
        externalUserId: 'tailor_usr_90210',
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
    assert.equal(state.externalUserId, 'tailor_usr_90210');
    assert.equal(state.timezone, 'Africa/Lagos');
    assert.equal(state.status, 'ACTIVE_TODAY');
    assert.equal(state.currentStreak, 1);
    assert.equal(state.todayProgress.completed, true);
    assert.ok(state.timing.windowExpiresAtUtc);
    assert.equal(Array.isArray(state.historyLast14Days), true);
  });

  it('deduplicates duplicate eventId submissions without double counting', async () => {
    const duplicateEventId = crypto.randomUUID();
    // First submission
    await server.inject({
      method: 'POST',
      url: '/v1/events/batch',
      headers: {
        authorization: 'Bearer pk_live_zikfash_123'
      },
      payload: {
        externalUserId: 'tailor_usr_dedup',
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

    // Duplicate submission
    const res2 = await server.inject({
      method: 'POST',
      url: '/v1/events/batch',
      headers: {
        authorization: 'Bearer pk_live_zikfash_123'
      },
      payload: {
        externalUserId: 'tailor_usr_dedup',
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
    // Processed count for the duplicate event should be 0 because of idempotency
    assert.equal(body.processedCount, 0);
  });

  it('GET /v1/streaks/:ruleSlug/:userId returns active state', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/streaks/daily_tailor_log/tailor_usr_90210?timezone=Africa/Lagos',
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
    // 1. Attempt with public key should fail with 403 Forbidden
    const forbiddenRes = await server.inject({
      method: 'POST',
      url: '/v1/streaks/daily_tailor_log/tailor_usr_90210/freezes/grant',
      headers: {
        authorization: 'Bearer pk_live_zikfash_123'
      },
      payload: { amount: 2, reason: 'admin_award' }
    });
    assert.equal(forbiddenRes.statusCode, 403);

    // 2. Attempt with secret key should succeed with 200 OK
    const successRes = await server.inject({
      method: 'POST',
      url: '/v1/streaks/daily_tailor_log/tailor_usr_90210/freezes/grant',
      headers: {
        authorization: 'Bearer sk_live_zikfash_secret'
      },
      payload: { amount: 2, reason: 'admin_award' }
    });
    assert.equal(successRes.statusCode, 200);
    const body = JSON.parse(successRes.body);
    assert.equal(body.freezes.available, 4); // 2 default + 2 granted = 4
  });
});
