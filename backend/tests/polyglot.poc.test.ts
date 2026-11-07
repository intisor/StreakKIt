// tests/polyglot.poc.test.ts: Proof-of-Concept Simulation for Language Learning Mobile App
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { getDb } from '../src/config/db.js';

describe('Language Learning Mobile App StreakKit POC Simulation', () => {
  let server: any;
  let db: any;
  const languageLearnerId = `lang_learner_${crypto.randomUUID().slice(0, 8)}`;
  const tenantKey = `pk_live_polyglot_${crypto.randomBytes(4).toString('hex')}`;
  const ruleSlug = `polyglot_${crypto.randomUUID().slice(0, 8)}`;

  before(async () => {
    db = getDb();
    await db.migrate();

    // Register Language Learning tenant in StreakKit
    await db.execute(
      `INSERT INTO tenants (id, name, public_key, secret_key_hash)
       VALUES ($1, 'Polyglot Language App', $2, 'hash_polyglot')`,
      [crypto.randomUUID(), tenantKey]
    );

    server = await buildServer();
  });

  after(async () => {
    await server.close();
    await db.close();
  });

  it('Step 1: First-time learner completes lesson -> auto-provisions rule & unlocks 1-day streak', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: { authorization: `Bearer ${tenantKey}` },
      payload: {
        ruleSlug,
        externalUserId: languageLearnerId,
        value: 1,
        timezone: 'Africa/Lagos',
        ruleConfig: {
          name: 'Daily Language Practice',
          target: 1,
          daysOff: [0], // Rest on Sunday
          maxFreezes: 2,
          freezeAutoEarnDays: 7, // +1 freeze every 7 days
          restoreWindowDays: 90
        },
        metadata: {
          lessonTitle: 'Numbers & Greetings',
          score: 100
        }
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ruleSlug, ruleSlug);
    assert.equal(body.currentStreak, 1);
    assert.equal(body.todayProgress.completed, true);
    assert.equal(body.status, 'ACTIVE_TODAY');
    assert.ok(body.embedUrl.includes(languageLearnerId));
  });

  it('Step 2: Learner completes another lesson on the same day -> Idempotent progress', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: { authorization: `Bearer ${tenantKey}` },
      payload: {
        ruleSlug,
        externalUserId: languageLearnerId,
        value: 1,
        timezone: 'Africa/Lagos',
        metadata: {
          lessonTitle: 'Everyday Vocabulary',
          score: 95
        }
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.currentStreak, 1); // Streak does not duplicate count on the same day
    assert.equal(body.status, 'ACTIVE_TODAY');
  });

  it('Step 3: Tapping streak badge in app serves 60fps Duolingo-style Lottie flame embed UI', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/v1/embed/${ruleSlug}/${languageLearnerId}?timezone=Africa/Lagos`
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/html');
    assert.ok(res.body.includes('Daily Language Practice'));
    assert.ok(res.body.includes('1'));
    assert.ok(res.body.includes('Day Streak'));
    assert.ok(res.body.includes('Active Today'));
  });

  it('Step 4: Learner checks Friend Leaderboard via batch streak query', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/streak/friends',
      headers: { authorization: `Bearer ${tenantKey}` },
      payload: {
        ruleSlug,
        userIds: [languageLearnerId, 'friend_kemi', 'friend_tunde']
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.rankings[0].userId, languageLearnerId);
    assert.equal(body.rankings[0].currentStreak, 1);
  });

  it('Step 5: Broken streak restoration check (simulate broken 10-day streak)', async () => {
    // Manually break learner streak
    await db.execute(
      `UPDATE user_streaks 
       SET current_streak = 0, last_broken_streak_length = 10, last_broken_date = '2026-11-01'
       WHERE external_user_id = $1`,
      [languageLearnerId]
    );

    // Free restore API call
    const res = await server.inject({
      method: 'POST',
      url: '/v1/streak/restore',
      headers: { authorization: `Bearer ${tenantKey}` },
      payload: {
        ruleSlug,
        externalUserId: languageLearnerId
      }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).restoredStreakLength, 10);
  });

  it('Step 6: Headless calendar verification for Android LazyVerticalGrid / iOS LazyVGrid', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/v1/embed/${ruleSlug}/${languageLearnerId}/calendar?year=2026&month=11`
    });

    assert.equal(res.statusCode, 200);
    const cal = JSON.parse(res.body);
    assert.equal(cal.ruleSlug, ruleSlug);
    assert.equal(cal.externalUserId, languageLearnerId);
    assert.ok(cal.days.length >= 28);
  });

  it('Step 7: Learner purchases Streak Rescue IAP -> Server verifies receipt & restores streak', async () => {
    // Break streak again
    await db.execute(
      `UPDATE user_streaks 
       SET current_streak = 0, last_broken_streak_length = 15, last_broken_date = '2026-11-05'
       WHERE external_user_id = $1`,
      [languageLearnerId]
    );

    const res = await server.inject({
      method: 'POST',
      url: '/v1/streak/repair-verify',
      headers: { authorization: `Bearer ${tenantKey}` },
      payload: {
        ruleSlug,
        externalUserId: languageLearnerId,
        paymentProof: {
          provider: 'google_play',
          transactionId: 'token_google_play_test_repair',
          productId: 'streak_repair_tier1'
        }
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.restoredStreakLength, 15);
  });
});
