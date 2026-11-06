// tests/hujjify.sim.test.ts: End-to-end integration simulation for Hujjify Android Client
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { getDb } from '../src/config/db.js';
import { seedDatabase } from '../src/db/seed.js';

describe('Hujjify Drop-In SDK Real-World Simulation', () => {
  let server: any;
  let db: any;
  const testUserId = `hujjify_android_${crypto.randomUUID().slice(0, 8)}`;

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

  it('Step 1: Active session or playback in Hujjify completes target (1/1) and unlocks streak (1-day, ACTIVE_TODAY)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: {
        authorization: 'Bearer pk_live_hujjify_456'
      },
      payload: {
        ruleSlug: 'hujjify_playback',
        externalUserId: testUserId,
        value: 1,
        timezone: 'Africa/Lagos',
        metadata: { track: 'Maher Zain - For the Rest of My Life', isClean: true }
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ruleSlug, 'hujjify_playback');
    assert.equal(body.todayProgress.current, 1);
    assert.equal(body.todayProgress.target, 1);
    assert.equal(body.todayProgress.completed, true);
    assert.equal(body.currentStreak, 1);
    assert.equal(body.status, 'ACTIVE_TODAY');
    assert.ok(body.embedUrl.includes(testUserId));
  });

  it('Step 2: Subsequent playback in Hujjify on the same day is idempotent and preserves active streak', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: {
        authorization: 'Bearer pk_live_hujjify_456'
      },
      payload: {
        ruleSlug: 'hujjify_playback',
        externalUserId: testUserId,
        value: 1,
        timezone: 'Africa/Lagos',
        metadata: { track: 'Sami Yusuf - Hasbi Rabbi', isClean: true }
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.todayProgress.completed, true);
    assert.equal(body.currentStreak, 1);
    assert.equal(body.status, 'ACTIVE_TODAY');
  });

  it('Step 3: Tapping Streak Card in Hujjify loads universal animated embed UI in WebView', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/v1/embed/hujjify_playback/${testUserId}`
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/html');
    assert.ok(res.body.includes('1'));
    assert.ok(res.body.includes('Day Streak'));
    assert.ok(res.body.includes('Active Today'));
    assert.ok(res.body.includes('StreakBridge'));
    assert.ok(res.body.includes('Share Milestone'));
    assert.ok(res.body.includes('lottie-container'));
  });

  it('Step 4: Hujjify User configures custom target and rest days (Friday)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/streak/preferences',
      headers: {
        authorization: 'Bearer pk_live_hujjify_456'
      },
      payload: {
        ruleSlug: 'hujjify_playback',
        externalUserId: testUserId,
        customTarget: 3,
        daysOffOverride: [5] // Friday rest day
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
  });

  it('Step 5: Hujjify queries batch friends streak leaderboard', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/streak/friends',
      headers: {
        authorization: 'Bearer pk_live_hujjify_456'
      },
      payload: {
        ruleSlug: 'hujjify_playback',
        userIds: [testUserId, 'hujjify_friend_omar', 'hujjify_friend_zainab']
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.rankings));
    assert.equal(body.rankings.length, 3);
    assert.equal(body.rankings[0].userId, testUserId);
    assert.equal(body.rankings[0].currentStreak, 1);
    assert.equal(body.rankings[0].extendedToday, true);
  });

  it('Step 6: Hujjify schedules a Ramadan/Vacation pause', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/streak/pause',
      headers: {
        authorization: 'Bearer pk_live_hujjify_456'
      },
      payload: {
        ruleSlug: 'hujjify_playback',
        externalUserId: testUserId,
        startDate: '2026-03-01',
        endDate: '2026-03-30'
      }
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.ok(body.pause.id);
  });

  it('Step 7: Hujjify generates Year-in-Review Wrapped for active listener', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/v1/streak/wrapped?ruleSlug=hujjify_playback&externalUserId=${testUserId}&year=2026`,
      headers: {
        authorization: 'Bearer pk_live_hujjify_456'
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.wrapped.userId, testUserId);
    assert.equal(body.wrapped.year, 2026);
    assert.ok(body.wrapped.daysActive >= 1);
  });

  it('Step 8: Hujjify repairs / restores a broken streak', async () => {
    // Manually simulate a broken 14-day streak on this user
    await db.execute(
      `UPDATE user_streaks 
       SET current_streak = 0, last_broken_streak_length = 14, last_broken_date = '2026-11-01'
       WHERE external_user_id = $1`,
      [testUserId]
    );

    const res = await server.inject({
      method: 'POST',
      url: '/v1/streak/restore',
      headers: {
        authorization: 'Bearer pk_live_hujjify_456'
      },
      payload: {
        ruleSlug: 'hujjify_playback',
        externalUserId: testUserId
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.restoredStreakLength, 14);

    // Verify user streak state in DB
    const check = await db.get(
      `SELECT current_streak FROM user_streaks WHERE external_user_id = $1`,
      [testUserId]
    );
    assert.equal(check.current_streak, 14);
  });
});
