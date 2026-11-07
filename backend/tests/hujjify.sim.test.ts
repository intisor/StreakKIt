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

  it('Step 9: Hujjify Duolingo-in-a-Box — Auditing 2 clean tracks awards +20 XP, completes Daily Goal (20/20 XP) & grants +10 bonus Gems', async () => {
    // Track 1: Clean -> +10 XP
    const xp1 = await server.inject({
      method: 'POST',
      url: '/v1/gamification/xp/add',
      headers: { authorization: 'Bearer pk_live_hujjify_456' },
      payload: {
        userId: testUserId,
        amount: 10,
        unitId: 'unit_1',
        timezone: 'Africa/Lagos'
      }
    });
    assert.equal(xp1.statusCode, 200);
    assert.equal(xp1.json().xp.today, 10);
    assert.equal(xp1.json().xp.dailyGoalCompleted, false);

    // Track 2: Clean -> +10 XP (20/20 XP -> daily goal completed + 10 bonus gems)
    const xp2 = await server.inject({
      method: 'POST',
      url: '/v1/gamification/xp/add',
      headers: { authorization: 'Bearer pk_live_hujjify_456' },
      payload: {
        userId: testUserId,
        amount: 10,
        unitId: 'unit_1',
        timezone: 'Africa/Lagos'
      }
    });
    assert.equal(xp2.statusCode, 200);
    const body2 = xp2.json();
    assert.equal(body2.xp.today, 20);
    assert.equal(body2.xp.dailyGoalCompleted, true);
    assert.equal(body2.bonusGemsAwarded, 10);
    assert.equal(body2.gems.balance, 60); // 50 initial + 10 bonus
    assert.equal(body2.curriculumProgress.unit_1, 2);
  });

  it('Step 10: Hujjify Duolingo-in-a-Box — Unskipped flagged song consumes 1 Heart (4/5 ❤️) and refills back to 5/5 using 50 Gems', async () => {
    const consumeRes = await server.inject({
      method: 'POST',
      url: '/v1/gamification/hearts/consume',
      headers: { authorization: 'Bearer pk_live_hujjify_456' },
      payload: {
        userId: testUserId,
        count: 1,
        timezone: 'Africa/Lagos'
      }
    });
    assert.equal(consumeRes.statusCode, 200);
    const consumed = consumeRes.json();
    assert.equal(consumed.hearts.current, 4);
    assert.equal(consumed.hearts.isFull, false);

    // Refill hearts using 50 Gems
    const refillRes = await server.inject({
      method: 'POST',
      url: '/v1/gamification/hearts/refill',
      headers: { authorization: 'Bearer pk_live_hujjify_456' },
      payload: {
        userId: testUserId,
        method: 'GEMS',
        gemCost: 50,
        timezone: 'Africa/Lagos'
      }
    });
    assert.equal(refillRes.statusCode, 200);
    const refilled = refillRes.json();
    assert.equal(refilled.hearts.current, 5);
    assert.equal(refilled.hearts.isFull, true);
    assert.equal(refilled.gems.balance, 10); // 60 - 50 = 10 gems left
  });

  it('Step 11: Hujjify Duolingo-in-a-Box — Long-pressing Streak Card renders Hujjify Winding Path UI (🎧 Conscious Listening)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/v1/embed/path/hujjify_playback/${testUserId}?timezone=Africa/Lagos&flag=%F0%9F%8E%A7&unitTitle=Conscious%20Listening&unitSubtitle=Audit%20clean%20tracks%20%26%20guard%20your%20ears`
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));
    assert.ok(res.body.includes('Conscious Listening'));
    assert.ok(res.body.includes('UNIT 1 · 2/4'));
    assert.ok(res.body.includes('Daily goal · <span id="xpVal">20</span>/20 XP'));
  });
});
