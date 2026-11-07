// tests/learnguw.poc.test.ts: Proof-of-Concept Simulation for Learn Gungbe (com.learnguw)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { getDb } from '../src/config/db.js';

describe('Learn Gungbe (com.learnguw) StreakKit POC Simulation', () => {
  let server: any;
  let db: any;
  const gungbeLearnerId = `gungbe_learner_${crypto.randomUUID().slice(0, 8)}`;
  const tenantKey = `pk_live_learnguw_${crypto.randomBytes(4).toString('hex')}`;
  const ruleSlug = 'gungbe_lesson';

  before(async () => {
    db = getDb();
    await db.migrate();

    // Register Learn Gungbe tenant in StreakKit
    await db.execute(
      `INSERT INTO tenants (id, name, public_key, secret_key_hash)
       VALUES ($1, 'Learn Gungbe Mobile App', $2, 'hash_gungbe')`,
      [crypto.randomUUID(), tenantKey]
    );

    server = await buildServer();
  });

  after(async () => {
    await server.close();
    await db.close();
  });

  it('Step 1: First-time learner completes "Numbers in Gun" lesson -> auto-provisions rule & unlocks 1-day streak', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: { authorization: `Bearer ${tenantKey}` },
      payload: {
        ruleSlug,
        externalUserId: gungbeLearnerId,
        value: 1,
        timezone: 'Africa/Lagos',
        ruleConfig: {
          name: 'Daily Gungbe Lesson',
          target: 1,
          daysOff: [0], // Rest on Sunday
          maxFreezes: 2,
          freezeAutoEarnDays: 7, // +1 freeze every 7 days
          restoreWindowDays: 90
        },
        metadata: {
          lessonTitle: 'Numbers 1-10 in Gungbe (Dopotọ, Awe, Atọ̀n...)',
          score: 100
        }
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ruleSlug, 'gungbe_lesson');
    assert.equal(body.currentStreak, 1);
    assert.equal(body.todayProgress.completed, true);
    assert.equal(body.status, 'ACTIVE_TODAY');
    assert.ok(body.embedUrl.includes(gungbeLearnerId));
  });

  it('Step 2: Learner completes another lesson ("Greetings in Egun") on the same day -> Idempotent progress', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: { authorization: `Bearer ${tenantKey}` },
      payload: {
        ruleSlug,
        externalUserId: gungbeLearnerId,
        value: 1,
        timezone: 'Africa/Lagos',
        metadata: {
          lessonTitle: 'Greetings (Ku doji, Ku afọnu)',
          score: 95
        }
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.currentStreak, 1); // Streak does not duplicate count on the same day
    assert.equal(body.status, 'ACTIVE_TODAY');
  });

  it('Step 3: Tapping streak badge in Learn Gungbe serves 60fps Duolingo-style Lottie flame embed UI', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/v1/embed/${ruleSlug}/${gungbeLearnerId}?timezone=Africa/Lagos`
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/html');
    assert.ok(res.body.includes('Daily Gungbe Lesson'));
    assert.ok(res.body.includes('1'));
    assert.ok(res.body.includes('Day Streak'));
    assert.ok(res.body.includes('lottie-container'));
    assert.ok(res.body.includes('StreakBridge'));
  });

  it('Step 4: Learner checks friends leaderboard in their Gungbe study circle', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/streak/friends',
      headers: { authorization: `Bearer ${tenantKey}` },
      payload: {
        ruleSlug,
        userIds: [gungbeLearnerId, 'learner_koffi_01', 'learner_sena_02'],
        timezone: 'Africa/Lagos'
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.rankings.length, 3);
    assert.equal(body.rankings[0].userId, gungbeLearnerId);
    assert.equal(body.rankings[0].currentStreak, 1);
  });

  it('Step 5: Broken streak restoration (Learner lost a 25-day Gungbe streak and restores it)', async () => {
    // Simulate user having lost their 25-day streak
    await db.execute(
      `UPDATE user_streaks 
       SET current_streak = 0, last_broken_streak_length = 25, last_broken_date = '2026-11-01'
       WHERE external_user_id = $1`,
      [gungbeLearnerId]
    );

    const res = await server.inject({
      method: 'POST',
      url: '/v1/streak/restore',
      headers: { authorization: `Bearer ${tenantKey}` },
      payload: {
        ruleSlug,
        externalUserId: gungbeLearnerId,
        timezone: 'Africa/Lagos'
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.restoredStreakLength, 25);
  });

  it('Step 6: Learner views Monthly Streak Calendar with active gold days and Sunday exemptions', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/v1/streaks/${ruleSlug}/${gungbeLearnerId}/calendar?timezone=Africa/Lagos`,
      headers: { authorization: `Bearer ${tenantKey}` }
    });

    assert.equal(res.statusCode, 200);
    const cal = JSON.parse(res.body);
    assert.equal(cal.ruleSlug, 'gungbe_lesson');
    assert.equal(cal.externalUserId, gungbeLearnerId);
    assert.ok(cal.daysInMonth >= 28 && cal.daysInMonth <= 31);
    assert.ok(Array.isArray(cal.days));
    assert.ok(typeof cal.firstDayOfWeek === 'number');
    assert.ok(typeof cal.activeDaysCount === 'number');
  });
});
