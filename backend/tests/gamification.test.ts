// tests/gamification.test.ts: End-to-End Tests for Duolingo-in-a-Box Gamification Engine
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/config/db.js';
import { seedDatabase } from '../src/db/seed.js';
import { buildServer } from '../src/server.js';
import { evaluateHeartsState } from '../src/domain/gamification.js';

describe('Duolingo-in-a-Box Gamification Engine (Hearts, Gems, Daily XP & Winding Path UI)', () => {
  let app: any;
  const authHeader = { authorization: 'Bearer pk_live_zikfash_123' };

  before(async () => {
    const db = getDb();
    await db.migrate();
    await seedDatabase(db);
    app = await buildServer();
  });

  it('1. Pure evaluateHeartsState calculates 4-hour auto-refill intervals deterministically', () => {
    const baseMs = Date.parse('2026-06-01T10:00:00.000Z');
    // 3 hearts left, 2 missing, 240 min (4 hr) refill interval
    const after1Hr = evaluateHeartsState(
      3,
      5,
      240,
      new Date(baseMs).toISOString(),
      baseMs + 60 * 60 * 1000 // +1 hour
    );
    assert.equal(after1Hr.effectiveCurrent, 3);
    assert.equal(after1Hr.secondsUntilNextRefill, 3 * 3600); // 3 hours left for next heart

    // After 4 hours -> 1 heart recovered (4/5)
    const after4Hr = evaluateHeartsState(
      3,
      5,
      240,
      new Date(baseMs).toISOString(),
      baseMs + 4 * 60 * 60 * 1000
    );
    assert.equal(after4Hr.effectiveCurrent, 4);

    // After 8 hours -> all 5/5 hearts recovered
    const after8Hr = evaluateHeartsState(
      3,
      5,
      240,
      new Date(baseMs).toISOString(),
      baseMs + 8 * 60 * 60 * 1000
    );
    assert.equal(after8Hr.effectiveCurrent, 5);
    assert.equal(after8Hr.secondsUntilNextRefill, null);
  });

  it('2. Initializes new user with 5/5 Hearts, 50 Gems, and 0/20 Daily XP', async () => {
    const userId = `duo_user_${Date.now()}`;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/gamification/${userId}`,
      headers: authHeader
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.hearts.current, 5);
    assert.equal(body.hearts.max, 5);
    assert.equal(body.hearts.isFull, true);
    assert.equal(body.hearts.outOfHearts, false);
    assert.equal(body.gems.balance, 50);
    assert.equal(body.xp.today, 0);
    assert.equal(body.xp.targetDaily, 20);
    assert.equal(body.xp.dailyGoalCompleted, false);
  });

  it('3. Consumes hearts on wrong answers down to 0 (outOfHearts = true) and refills via PRACTICE and GEMS', async () => {
    const userId = `duo_hearts_${Date.now()}`;

    // Consume 5 hearts
    const consumeRes = await app.inject({
      method: 'POST',
      url: '/v1/gamification/hearts/consume',
      headers: authHeader,
      payload: { userId, count: 5 }
    });
    assert.equal(consumeRes.statusCode, 200);
    const consumed = consumeRes.json();
    assert.equal(consumed.hearts.current, 0);
    assert.equal(consumed.hearts.outOfHearts, true);
    assert.ok(consumed.hearts.secondsUntilNextRefill > 0);

    // Practice to earn +1 heart
    const practiceRes = await app.inject({
      method: 'POST',
      url: '/v1/gamification/hearts/refill',
      headers: authHeader,
      payload: { userId, method: 'PRACTICE' }
    });
    assert.equal(practiceRes.statusCode, 200);
    assert.equal(practiceRes.json().hearts.current, 1);

    // Refill full hearts using 50 Gems
    const gemRefillRes = await app.inject({
      method: 'POST',
      url: '/v1/gamification/hearts/refill',
      headers: authHeader,
      payload: { userId, method: 'GEMS', gemCost: 50 }
    });
    assert.equal(gemRefillRes.statusCode, 200);
    const refilled = gemRefillRes.json();
    assert.equal(refilled.hearts.current, 5);
    assert.equal(refilled.hearts.isFull, true);
    assert.equal(refilled.gems.balance, 0);
  });

  it('4. Adds XP toward Daily Goal (0/20 XP) and awards +10 bonus Gems when daily goal is reached', async () => {
    const userId = `duo_xp_${Date.now()}`;

    // Lesson 1: +10 XP (10/20 XP)
    const xp1 = await app.inject({
      method: 'POST',
      url: '/v1/gamification/xp/add',
      headers: authHeader,
      payload: { userId, amount: 10, unitId: 'unit_1' }
    });
    assert.equal(xp1.statusCode, 200);
    const state1 = xp1.json();
    assert.equal(state1.xp.today, 10);
    assert.equal(state1.xp.dailyGoalCompleted, false);
    assert.equal(state1.bonusGemsAwarded, 0);
    assert.equal(state1.curriculumProgress.unit_1, 1);

    // Lesson 2: +10 XP (20/20 XP -> completes daily goal and awards +10 gems!)
    const xp2 = await app.inject({
      method: 'POST',
      url: '/v1/gamification/xp/add',
      headers: authHeader,
      payload: { userId, amount: 10, unitId: 'unit_1' }
    });
    assert.equal(xp2.statusCode, 200);
    const state2 = xp2.json();
    assert.equal(state2.xp.today, 20);
    assert.equal(state2.xp.dailyGoalCompleted, true);
    assert.equal(state2.dailyGoalJustCompleted, true);
    assert.equal(state2.bonusGemsAwarded, 10);
    assert.equal(state2.gems.balance, 60); // 50 initial + 10 bonus
    assert.equal(state2.curriculumProgress.unit_1, 2);
  });

  it('5. Renders the Universal Duolingo Winding Path UI (/v1/embed/path/:ruleSlug/:externalUserId)', async () => {
    const userId = `duo_embed_${Date.now()}`;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/embed/path/daily_tailor_log/${userId}?flag=%F0%9F%87%B3%F0%9F%87%AC&unitTitle=Greetings`,
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));
    const html = res.body;
    assert.ok(html.includes('Daily goal ·'));
    assert.ok(html.includes('UNIT 1 ·'));
    assert.ok(html.includes('Greetings'));
    assert.ok(html.includes('START'));
  });

  it('6. Supports full customizability: POST /v1/gamification/config and URL query overrides', async () => {
    const userId = `custom_user_${Date.now()}`;

    // Customize user gamification params: 3 hearts max, 50 XP daily target, 30 min refill, 150 gems
    const configRes = await app.inject({
      method: 'POST',
      url: '/v1/gamification/config',
      headers: authHeader,
      payload: {
        userId,
        heartsMax: 3,
        heartsCurrent: 3,
        heartsRefillIntervalMinutes: 30,
        gemsBalance: 150,
        xpTargetDaily: 50
      }
    });
    assert.equal(configRes.statusCode, 200);
    const configuredState = configRes.json();
    assert.equal(configuredState.hearts.max, 3);
    assert.equal(configuredState.hearts.current, 3);
    assert.equal(configuredState.gems.balance, 150);
    assert.equal(configuredState.xp.targetDaily, 50);

    // Verify GET /v1/gamification/:userId returns the customized settings
    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/gamification/${userId}`,
      headers: authHeader
    });
    assert.equal(getRes.statusCode, 200);
    const fetchedState = getRes.json();
    assert.equal(fetchedState.hearts.max, 3);
    assert.equal(fetchedState.xp.targetDaily, 50);
    assert.equal(fetchedState.gems.balance, 150);

    // Verify embed URL query parameter overrides (?dailyTarget=100&maxHearts=10&gemCost=25)
    const embedRes = await app.inject({
      method: 'GET',
      url: `/v1/embed/path/daily_tailor_log/${userId}?dailyTarget=100&maxHearts=10&gemCost=25`,
    });
    assert.equal(embedRes.statusCode, 200);
    const html = embedRes.body;
    assert.ok(html.includes('Daily goal · <span id="xpVal">0</span>/100 XP'));
    assert.ok(html.includes('/10</div>'));
    assert.ok(html.includes('Refill Full Hearts (25 Gems)'));
  });
});
