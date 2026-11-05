// tests/moat-service.unit.test.ts: Unit tests for MoatService operations
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createInMemoryDb, type DbAdapter } from '../src/config/db.js';
import { MoatService } from '../src/domain/moat-service.js';

describe('MoatService Operations', () => {
  let db: DbAdapter;
  let service: MoatService;
  const tenantId = crypto.randomUUID();
  const ruleId = crypto.randomUUID();
  const ruleSlug = 'hujjify_test_track';

  before(async () => {
    db = createInMemoryDb();
    await db.migrate();
    service = new MoatService(db);

    // Setup tenant & rule
    await db.execute(
      `INSERT INTO tenants (id, name, public_key, secret_key_hash)
       VALUES ($1, 'Test Tenant', 'pk_test_moat_123', 'hash_123')`,
      [tenantId]
    );

    await db.execute(
      `INSERT INTO streak_rules (id, tenant_id, slug, name, cadence_type, target_value, max_freezes, restore_window_days)
       VALUES ($1, $2, $3, 'Hujjify Track Test', 'DAILY', 1, 3, 90)`,
      [ruleId, tenantId, ruleSlug]
    );
  });

  after(async () => {
    await db.close();
  });

  describe('Vacation Pauses', () => {
    it('creates, lists, and deletes vacation pauses', async () => {
      const pause = await service.createPause({
        tenantId,
        ruleSlug,
        externalUserId: 'user_vacation_1',
        startDate: '2026-12-20',
        endDate: '2026-12-27'
      });

      assert.ok(pause.id);
      assert.equal(pause.startDate, '2026-12-20');

      const pauses = await service.getPauses(tenantId, ruleSlug, 'user_vacation_1');
      assert.equal(pauses.length, 1);
      assert.equal(pauses[0].startDate, '2026-12-20');
      assert.equal(pauses[0].endDate, '2026-12-27');

      const deleted = await service.deletePause(tenantId, pause.id);
      assert.equal(deleted, true);

      const afterDelete = await service.getPauses(tenantId, ruleSlug, 'user_vacation_1');
      assert.equal(afterDelete.length, 0);
    });

    it('rejects invalid date range where endDate is before startDate', async () => {
      await assert.rejects(
        () => service.createPause({
          tenantId,
          ruleSlug,
          externalUserId: 'user_vacation_2',
          startDate: '2026-12-30',
          endDate: '2026-12-20'
        }),
        /endDate must be on or after startDate/
      );
    });
  });

  describe('Streak Restoration', () => {
    it('restores a previously broken 15-day streak within 90 days', async () => {
      const userId = 'user_broken_streak';
      await db.execute(
        `INSERT INTO user_streaks (id, tenant_id, rule_id, external_user_id, current_streak, last_broken_streak_length, last_broken_date)
         VALUES ($1, $2, $3, $4, 0, 15, '2026-10-15')`,
        [crypto.randomUUID(), tenantId, ruleId, userId]
      );

      const res = await service.restoreStreak(tenantId, ruleSlug, userId, '2026-11-05');
      assert.equal(res.restored, true);
      assert.equal(res.restoredStreakLength, 15);

      const check = await db.get<any>(
        `SELECT current_streak, last_broken_streak_length FROM user_streaks WHERE external_user_id = $1`,
        [userId]
      );
      assert.equal(check.current_streak, 15);
      assert.equal(check.last_broken_streak_length, 0);
    });
  });

  describe('Batch Streaks & Leaderboards', () => {
    it('returns ranked friends with current and highest streaks', async () => {
      await db.execute(
        `INSERT INTO user_streaks (id, tenant_id, rule_id, external_user_id, current_streak, highest_streak, last_completed_logical_date)
         VALUES 
           ($1, $2, $3, 'alice', 12, 15, '2026-11-05')`,
        [crypto.randomUUID(), tenantId, ruleId]
      );
      await db.execute(
        `INSERT INTO user_streaks (id, tenant_id, rule_id, external_user_id, current_streak, highest_streak, last_completed_logical_date)
         VALUES 
           ($1, $2, $3, 'bob', 24, 30, '2026-11-04')`,
        [crypto.randomUUID(), tenantId, ruleId]
      );
      await db.execute(
        `INSERT INTO user_streaks (id, tenant_id, rule_id, external_user_id, current_streak, highest_streak, last_completed_logical_date)
         VALUES 
           ($1, $2, $3, 'charlie', 5, 5, '2026-11-05')`,
        [crypto.randomUUID(), tenantId, ruleId]
      );

      const ranked = await service.getBatchStreaks(
        tenantId,
        ruleSlug,
        ['alice', 'bob', 'charlie', 'david_not_found'],
        '2026-11-05'
      );

      assert.equal(ranked.length, 4);
      // Bob has 24, Alice has 12, Charlie has 5, David has 0
      assert.equal(ranked[0].userId, 'bob');
      assert.equal(ranked[0].currentStreak, 24);
      assert.equal(ranked[0].extendedToday, false);

      assert.equal(ranked[1].userId, 'alice');
      assert.equal(ranked[1].currentStreak, 12);
      assert.equal(ranked[1].extendedToday, true);

      assert.equal(ranked[3].userId, 'david_not_found');
      assert.equal(ranked[3].currentStreak, 0);
    });
  });

  describe('Per-User Preferences', () => {
    it('saves custom daily target and rest days override', async () => {
      await service.setPreferences({
        tenantId,
        ruleSlug,
        externalUserId: 'power_user_1',
        customTarget: 5,
        daysOffOverride: [0, 6] // Rest on weekends
      });

      const pref = await db.get<any>(
        `SELECT custom_target, days_off_override FROM user_preferences WHERE external_user_id = $1`,
        ['power_user_1']
      );

      assert.equal(pref.custom_target, 5);
      assert.deepEqual(JSON.parse(pref.days_off_override), [0, 6]);
    });
  });

  describe('Wrapped / Year in Review', () => {
    it('summarizes annual active days, longest streak, and peak day', async () => {
      const wrappedUser = 'wrapped_listener_1';
      // Insert events across multiple days
      for (const date of ['2026-03-01', '2026-03-02', '2026-05-15']) {
        await db.execute(
          `INSERT INTO streak_events (event_id, tenant_id, rule_id, external_user_id, value, occurred_at_utc, logical_local_date)
           VALUES ($1, $2, $3, $4, 1, '2026-03-01T12:00:00Z', $5)`,
          [crypto.randomUUID(), tenantId, ruleId, wrappedUser, date]
        );
      }
      // Add a 2nd event on 2026-05-15 so it becomes the most active day
      await db.execute(
        `INSERT INTO streak_events (event_id, tenant_id, rule_id, external_user_id, value, occurred_at_utc, logical_local_date)
         VALUES ($1, $2, $3, $4, 1, '2026-05-15T14:00:00Z', '2026-05-15')`,
        [crypto.randomUUID(), tenantId, ruleId, wrappedUser]
      );

      const wrapped = await service.getWrapped(tenantId, ruleSlug, wrappedUser, 2026);
      assert.equal(wrapped.daysActive, 3);
      assert.equal(wrapped.totalEventsLogged, 4);
      assert.equal(wrapped.mostActiveDay?.date, '2026-05-15');
      assert.equal(wrapped.mostActiveDay?.count, 2);
    });
  });
});
