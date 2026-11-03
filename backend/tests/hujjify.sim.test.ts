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
    assert.equal(body.todayProgress.completed, true);
    assert.equal(body.currentStreak, 1);
    assert.equal(body.status, 'ACTIVE_TODAY');
  });

  it('Step 3: Tapping Streak Card in Hujjify loads universal animated embed UI in WebView', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/v1/embed/alify_playback/${testUserId}`
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/html');
    assert.ok(res.body.includes('1'));
    assert.ok(res.body.includes('Day Streak'));
    assert.ok(res.body.includes('Active Today'));
    assert.ok(res.body.includes('StreakBridge'));
    assert.ok(res.body.includes('Share Milestone'));
  });
});
