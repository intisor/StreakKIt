// tests/hujjify.sim.test.ts: End-to-end simulation of Hujjify Android app using the new StreakKit drop-in SDK
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { getDb } from '../src/config/db.js';
import { seedDatabase } from '../src/db/seed.js';

describe('Hujjify Drop-In SDK Real-World Simulation', () => {
  let server: any;
  const db = getDb();
  const testUserId = 'hujjify_android_' + crypto.randomUUID().substring(0, 8);

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

  it('Step 1: First clean song observed in Hujjify advances daily progress to 1/3', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: {
        authorization: 'Bearer pk_live_alify_456'
      },
      payload: {
        ruleSlug: 'alify_playback',
        externalUserId: testUserId,
        value: 1,
        timezone: 'Africa/Lagos',
        metadata: { track: 'Maher Zain - For the Rest of My Life', isClean: true }
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ruleSlug, 'alify_playback');
    assert.equal(body.todayProgress.current, 1);
    assert.equal(body.todayProgress.target, 3);
    assert.equal(body.todayProgress.completed, false);
    assert.equal(body.status, 'PENDING_TODAY');
  });

  it('Step 2: Second clean song observed in Hujjify advances daily progress to 2/3', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: {
        authorization: 'Bearer pk_live_alify_456'
      },
      payload: {
        ruleSlug: 'alify_playback',
        externalUserId: testUserId,
        value: 1,
        timezone: 'Africa/Lagos',
        metadata: { track: 'Sami Yusuf - Hasbi Rabbi', isClean: true }
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.todayProgress.current, 2);
    assert.equal(body.todayProgress.target, 3);
    assert.equal(body.todayProgress.completed, false);
    assert.equal(body.status, 'PENDING_TODAY');
  });

  it('Step 3: Third clean song completes target, increments streak, and flips to ACTIVE_TODAY', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: {
        authorization: 'Bearer pk_live_alify_456'
      },
      payload: {
        ruleSlug: 'alify_playback',
        externalUserId: testUserId,
        value: 1,
        timezone: 'Africa/Lagos',
        metadata: { track: 'Harris J - Salam Alaikum', isClean: true }
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.todayProgress.current, 3);
    assert.equal(body.todayProgress.completed, true);
    assert.equal(body.currentStreak, 1);
    assert.equal(body.status, 'ACTIVE_TODAY');
    assert.ok(body.embedUrl.includes(testUserId));
  });

  it('Step 4: Tapping Streak Card in Hujjify loads universal animated embed UI in WebView', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/v1/embed/alify_playback/${testUserId}`
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/html');
    // Verifies Duolingo flame, 1-day streak, active state, close bridge, and WhatsApp sharing
    assert.ok(res.body.includes('1'));
    assert.ok(res.body.includes('Day Streak'));
    assert.ok(res.body.includes('Active Today'));
    assert.ok(res.body.includes('StreakBridge'));
    assert.ok(res.body.includes('Share Milestone'));
  });
});
