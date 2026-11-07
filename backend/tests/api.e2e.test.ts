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
        authorization: 'Bearer pk_live_hujjify_456'
      },
      payload: {
        ruleSlug: 'hujjify_playback',
        externalUserId: testUser,
        value: 1,
        timezone: 'Africa/Lagos'
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ruleSlug, 'hujjify_playback');
    assert.equal(body.externalUserId, testUser);
    assert.equal(body.currentStreak, 1);
    assert.equal(body.status, 'ACTIVE_TODAY');
    assert.equal(body.todayProgress.completed, true);
    assert.equal(body.embedUrl, `/v1/embed/hujjify_playback/${testUser}`);
  });

  it('GET /v1/embed/:ruleSlug/:userId serves the universal HTML dopamine UI with Duolingo-style Month Calendar', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/embed/hujjify_playback/listener_guest'
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/html');
    assert.ok(res.body.includes('Day Streak'));
    assert.ok(res.body.includes('Share Milestone'));
    assert.ok(res.body.includes('closeBtn'));
    // Visual Monthly Calendar UI elements
    assert.ok(res.body.includes('monthCalendarView'));
    assert.ok(res.body.includes('calGrid'));
    assert.ok(res.body.includes('calPrevBtn'));
    assert.ok(res.body.includes('calNextBtn'));
    assert.ok(res.body.includes('tabMonth'));
  });

  it('GET /v1/embed/:ruleSlug/:userId/calendar returns headless month calendar JSON for interactive view toggling', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/embed/hujjify_playback/listener_guest/calendar?year=2026&month=11'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.year, 2026);
    assert.equal(body.month, 11);
    assert.equal(body.daysInMonth, 30);
    assert.equal(body.firstDayOfWeek, 0); // Sunday
    assert.equal(body.days.length, 30);
    assert.ok(Array.isArray(body.perfectWeeks));
  });

  it('GET /v1/streaks/:ruleSlug/:userId/calendar returns authenticated calendar JSON for custom client UIs', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/streaks/hujjify_playback/listener_guest/calendar?year=2026&month=11',
      headers: { authorization: 'Bearer pk_live_hujjify_456' }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ruleSlug, 'hujjify_playback');
    assert.equal(body.monthName, 'November');
    assert.equal(body.days.length, 30);
    assert.ok(typeof body.activeDaysCount === 'number');
  });

  it('GET /v1/embed/:ruleSlug/:userId supports code-driven animations (custom color, speed, and behavior preset)', async () => {
    const customConfig = {
      primaryColor: '#22c55e',
      speed: 1.75,
      preset: 'confetti',
      particleCount: 80,
      particleColors: ['#22c55e', '#10b981', '#34d399']
    };

    const res = await server.inject({
      method: 'GET',
      url: `/v1/embed/hujjify_playback/listener_guest?animConfig=${encodeURIComponent(JSON.stringify(customConfig))}`
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/html');
    // Verify CSS variables adopted custom color
    assert.ok(res.body.includes('--streak-primary: #22c55e'));
    // Verify SVG flame hue-rotation calculation
    assert.ok(res.body.includes('hue-rotate('));
    // Verify custom playback speed is injected
    assert.ok(res.body.includes('anim.setSpeed(1.75)'));
    // Verify custom behavior preset is injected into particle physics engine
    assert.ok(res.body.includes("preset = 'confetti'"));
    assert.ok(res.body.includes('pCount = 80'));
    assert.ok(res.body.includes('#34d399'));
  });

  it('GET /v1/embed/:ruleSlug/:userId embeds procedural Web Audio dopamine synthesizer & sound toggle', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/v1/embed/hujjify_playback/listener_guest'
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('AudioEngine'));
    assert.ok(res.body.includes('soundToggleBtn'));
    assert.ok(res.body.includes('streakkit_sound_enabled'));
    assert.ok(res.body.includes('streak_extend'));
    assert.ok(res.body.includes('streak_freeze'));
    assert.ok(res.body.includes('milestone_unlocked'));
  });

  it('renders high-converting Streak Repair Paywall Card when streak is broken', async () => {
    const brokenUser = `paywall_user_${crypto.randomUUID().slice(0, 8)}`;
    // Ping to create user streak
    await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: { authorization: 'Bearer pk_live_hujjify_456' },
      payload: { ruleSlug: 'hujjify_playback', externalUserId: brokenUser, value: 1 }
    });

    // Simulate streak break: currentStreak = 0, last_broken_streak_length = 42
    await db.execute(
      `UPDATE user_streaks
       SET current_streak = 0, last_broken_streak_length = 42, last_broken_date = '2026-11-01'
       WHERE external_user_id = $1`,
      [brokenUser]
    );

    const res = await server.inject({
      method: 'GET',
      url: `/v1/embed/hujjify_playback/${brokenUser}`
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('paywallCard'));
    assert.ok(res.body.includes('Restore your 42-Day Streak!'));
    assert.ok(res.body.includes('btnPaywallIap'));
    assert.ok(res.body.includes('btnPaywallCoins'));
    assert.ok(res.body.includes('STREAKKIT_PURCHASE_INTENT'));
  });

  it('POST /v1/streak/repair-verify verifies in-app purchase proof and restores streak atomically', async () => {
    const repairUser = `repair_iap_${crypto.randomUUID().slice(0, 8)}`;
    // Ping to initialize
    await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: { authorization: 'Bearer pk_live_hujjify_456' },
      payload: { ruleSlug: 'hujjify_playback', externalUserId: repairUser, value: 1 }
    });

    // Simulate streak break of 55 days
    await db.execute(
      `UPDATE user_streaks
       SET current_streak = 0, last_broken_streak_length = 55, last_broken_date = '2026-11-02'
       WHERE external_user_id = $1`,
      [repairUser]
    );

    // Call /v1/streak/repair-verify with Google Play receipt proof
    const verifyRes = await server.inject({
      method: 'POST',
      url: '/v1/streak/repair-verify',
      headers: { authorization: 'Bearer pk_live_hujjify_456' },
      payload: {
        ruleSlug: 'hujjify_playback',
        externalUserId: repairUser,
        paymentProof: {
          provider: 'google_play',
          transactionId: 'GPA.3391-4492-1102-44102',
          productId: 'streak_repair_tier1'
        }
      }
    });

    assert.equal(verifyRes.statusCode, 200);
    const body = JSON.parse(verifyRes.body);
    assert.equal(body.success, true);
    assert.equal(body.restoredStreakLength, 55);
    assert.equal(body.transactionId, 'GPA.3391-4492-1102-44102');

    // Verify DB state was updated atomically
    const row = await db.get(
      'SELECT current_streak, last_broken_streak_length FROM user_streaks WHERE external_user_id = $1',
      [repairUser]
    );
    assert.equal(row.current_streak, 55);
    assert.equal(row.last_broken_streak_length, 0);

    // Verify streak_history audit row exists
    const historyRow = await db.get(
      'SELECT status, streak_length FROM streak_history WHERE external_user_id = $1 AND status = $2',
      [repairUser, 'REPAIRED']
    );
    assert.ok(historyRow);
    assert.equal(historyRow.streak_length, 55);
  });

  it('Airplane-Mode Transatlantic Ingestion: respects creation timezone to prevent midnight drift', async () => {
    const flightUser = `flight_traveler_${crypto.randomUUID().slice(0, 8)}`;
    const eventId = crypto.randomUUID();

    // Event occurred in London at 23:45 PM before midnight
    const occurredInLondonUtc = '2026-11-06T23:45:00.000Z';

    const res = await server.inject({
      method: 'POST',
      url: '/v1/events/batch',
      headers: { authorization: 'Bearer pk_live_hujjify_456' },
      payload: {
        externalUserId: flightUser,
        timezone: 'America/New_York', // Device is now in NY after landing
        events: [
          {
            eventId,
            ruleSlug: 'hujjify_playback',
            value: 1,
            occurredAtUtc: occurredInLondonUtc,
            monotonicMs: 120594,
            metadata: {
              timezone: 'Europe/London' // Timezone where flight activity took place
            }
          }
        ]
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.processedCount, 1);
    const state = body.states.hujjify_playback;
    assert.ok(state);
    assert.equal(state.currentStreak, 1);
    // Verified 2026-11-06 is marked completed in rolling history
    const completedDay = state.historyLast14Days.find((h: any) => h.date === '2026-11-06');
    assert.equal(completedDay?.state, 'COMPLETED');
  });

  it('Rule Management API: list, create, and update rules dynamically', async () => {
    // 1. List rules
    const listRes = await server.inject({
      method: 'GET',
      url: '/v1/rules',
      headers: { authorization: 'Bearer pk_live_hujjify_456' }
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.body);
    assert.ok(Array.isArray(listBody.rules));
    assert.ok(listBody.rules.some((r: any) => r.slug === 'hujjify_playback'));

    // 2. Create custom rule dynamically
    const newSlug = `streak_custom_${crypto.randomUUID().slice(0, 6)}`;
    const createRes = await server.inject({
      method: 'POST',
      url: '/v1/rules',
      headers: { authorization: 'Bearer pk_live_hujjify_456' },
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
      headers: { authorization: 'Bearer pk_live_hujjify_456' },
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
