// tests/evaluator.test.ts: Unit tests covering DST, offline sync, freezes, exempt days, anti-cheat
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLogicalDate,
  isExemptDay,
  addDays,
  daysBetween,
  computeNextWindowExpiry
} from '../src/domain/time-window.js';
import {
  verifyEventBatchIntegrity,
  computeEventHash
} from '../src/domain/anticheat.js';
import {
  evaluateEvent,
  evaluateStateOnRead
} from '../src/domain/evaluator.js';
import { StreakRule, UserStreak } from '../src/domain/types.js';

describe('Time Window & Timezone Calculations', () => {
  it('correctly maps late-night activity within grace period to the previous logical day', () => {
    // 01:30 AM WAT (UTC+1) on Tuesday Nov 3, 2026 is 00:30 AM UTC on Nov 3.
    // With 120m grace period, it shifts back 2 hours to 22:30 UTC on Nov 2 (23:30 WAT on Nov 2).
    // Logical date should be Monday Nov 2, 2026.
    const lateNightEventUtc = new Date('2026-11-03T00:30:00.000Z');
    const logicalDate = computeLogicalDate(lateNightEventUtc, 'Africa/Lagos', 120);
    assert.equal(logicalDate, '2026-11-02');
  });

  it('correctly maps activity outside grace period to the current logical day', () => {
    // 03:30 AM WAT (02:30 AM UTC) on Tuesday Nov 3, 2026.
    // With 120m grace, shifted time is 00:30 UTC (01:30 WAT on Nov 3).
    // Logical date should be Tuesday Nov 3, 2026.
    const eventUtc = new Date('2026-11-03T02:30:00.000Z');
    const logicalDate = computeLogicalDate(eventUtc, 'Africa/Lagos', 120);
    assert.equal(logicalDate, '2026-11-03');
  });

  it('correctly identifies exempt days using bitmask', () => {
    // Bitmask 64 = Sunday exempt (1 << (7 - 1) = 64)
    const sundayBitmask = 64;
    // 2026-11-01 was a Sunday
    assert.equal(isExemptDay('2026-11-01', sundayBitmask), true);
    // 2026-11-02 was a Monday
    assert.equal(isExemptDay('2026-11-02', sundayBitmask), false);
    // 2026-11-07 was a Saturday
    assert.equal(isExemptDay('2026-11-07', sundayBitmask), false);
  });

  it('calculates the next window expiry accounting for timezone, exemption, and grace period', () => {
    // Last completed date: Saturday 2026-11-07
    // Sunday (2026-11-08) is exempt under bitmask 64
    // Next required day is Monday 2026-11-09.
    // Expiry should be Monday 23:59:59.999 local (Lagos UTC+1) + 120m grace = Tuesday 00:59:59.999 UTC.
    const expiry = computeNextWindowExpiry('2026-11-07', 'Africa/Lagos', 64, 120);
    assert.equal(expiry.toISOString(), '2026-11-10T00:59:59.999Z');
  });
});

describe('Anti-Cheat & Monotonic Verification', () => {
  it('clamps future timestamps that exceed the 5-minute threshold', () => {
    const serverNow = new Date('2026-11-02T12:00:00.000Z');
    const futureEvent = {
      eventId: 'ev_future_1',
      ruleSlug: 'daily_tailor_log',
      value: 1,
      occurredAtUtc: '2026-11-02T13:00:00.000Z' // 1 hour into future
    };

    const verified = verifyEventBatchIntegrity([futureEvent], serverNow);
    assert.equal(verified.length, 1);
    assert.equal(verified[0].trustFlag, 'CLAMPED');
    assert.equal(verified[0].occurredAtUtc.toISOString(), serverNow.toISOString());
  });

  it('detects device clock tampering when monotonic progression diverges from wall clock', () => {
    const serverNow = new Date('2026-11-02T12:00:00.000Z');
    const ev1 = {
      eventId: 'ev_1',
      ruleSlug: 'daily_tailor_log',
      value: 1,
      occurredAtUtc: '2026-11-02T10:00:00.000Z',
      monotonicMs: 100000
    };
    // Client moved clock forward by 2 hours (deltaWall = 7200s), but monotonic only advanced 5 seconds (5000ms)
    const ev2 = {
      eventId: 'ev_2',
      ruleSlug: 'daily_tailor_log',
      value: 1,
      occurredAtUtc: '2026-11-02T12:00:00.000Z',
      monotonicMs: 105000
    };

    const verified = verifyEventBatchIntegrity([ev1, ev2], serverNow);
    assert.equal(verified.length, 2);
    assert.equal(verified[1].trustFlag, 'CLOCK_SKEW_SUSPECTED');
    // Clock overridden to ev1 time + monotonic delta (5000ms)
    assert.equal(
      verified[1].occurredAtUtc.toISOString(),
      new Date('2026-11-02T10:00:05.000Z').toISOString()
    );
  });
});

describe('Deterministic Streak State Machine (evaluator)', () => {
  const baseRule: StreakRule = {
    id: 'rule_tailor_1',
    tenantId: 'tenant_zikfash',
    slug: 'daily_tailor_log',
    name: 'Daily Tailor Log',
    cadenceType: 'EXEMPT_DAYS',
    targetValue: 1,
    exemptDaysBitmask: 64, // Sundays exempt
    gracePeriodMinutes: 120,
    maxFreezes: 2,
    autoConsumeFreeze: true,
    atRiskLeadMinutes: 120,
    milestoneDays: [3, 7, 14, 30],
    createdAt: '2026-11-01T00:00:00Z'
  };

  const initialStreak: UserStreak = {
    id: 'user_streak_1',
    tenantId: 'tenant_zikfash',
    ruleId: 'rule_tailor_1',
    externalUserId: 'tailor_99',
    timezone: 'Africa/Lagos',
    currentStreak: 0,
    highestStreak: 0,
    lastCompletedLogicalDate: null,
    currentLogicalDate: null,
    currentWindowProgress: 0,
    freezesAvailable: 2,
    lastFreezeConsumedDate: null,
    windowExpiresAtUtc: null,
    atRiskNotifiedForDate: null,
    recentHistory: [],
    lastClientEventUtc: null,
    lastEventHash: null,
    updatedAt: '2026-11-01T00:00:00Z'
  };

  it('increments streak to 1 on first-ever completion', () => {
    const event = {
      eventId: '0192-0001',
      ruleSlug: 'daily_tailor_log',
      value: 1,
      occurredAtUtc: new Date('2026-11-02T10:00:00Z'),
      monotonicMs: 1000,
      prevEventHash: null,
      computedHash: 'hash_1',
      trustFlag: 'VERIFIED' as const,
      metadata: null
    };

    const res = evaluateEvent(initialStreak, baseRule, event);
    assert.equal(res.updatedStreak.currentStreak, 1);
    assert.equal(res.updatedStreak.highestStreak, 1);
    assert.equal(res.updatedStreak.lastCompletedLogicalDate, '2026-11-02');
    assert.equal(res.webhooksToEnqueue.length, 1);
    assert.equal(res.webhooksToEnqueue[0].eventType, 'streak.incremented');
  });

  it('maintains progress without duplicate increment when completed twice on the same day', () => {
    const event1 = {
      eventId: '0192-0001',
      ruleSlug: 'daily_tailor_log',
      value: 1,
      occurredAtUtc: new Date('2026-11-02T10:00:00Z'),
      monotonicMs: 1000,
      prevEventHash: null,
      computedHash: 'hash_1',
      trustFlag: 'VERIFIED' as const,
      metadata: null
    };

    const res1 = evaluateEvent(initialStreak, baseRule, event1);

    const event2 = {
      eventId: '0192-0002',
      ruleSlug: 'daily_tailor_log',
      value: 1,
      occurredAtUtc: new Date('2026-11-02T15:00:00Z'),
      monotonicMs: 2000,
      prevEventHash: 'hash_1',
      computedHash: 'hash_2',
      trustFlag: 'VERIFIED' as const,
      metadata: null
    };

    const res2 = evaluateEvent(res1.updatedStreak, baseRule, event2);
    assert.equal(res2.updatedStreak.currentStreak, 1);
    assert.equal(res2.webhooksToEnqueue.length, 0); // No second increment webhook
  });

  it('preserves streak across exempt days without consuming a freeze (Sunday exempt)', () => {
    // User completed on Saturday 2026-11-07
    const saturdayStreak: UserStreak = {
      ...initialStreak,
      currentStreak: 5,
      highestStreak: 5,
      lastCompletedLogicalDate: '2026-11-07',
      currentLogicalDate: '2026-11-07',
      currentWindowProgress: 1,
      freezesAvailable: 2
    };

    // Next event is on Monday 2026-11-09 (Sunday 2026-11-08 was exempt)
    const mondayEvent = {
      eventId: '0192-0003',
      ruleSlug: 'daily_tailor_log',
      value: 1,
      occurredAtUtc: new Date('2026-11-09T10:00:00Z'),
      monotonicMs: 3000,
      prevEventHash: 'hash_2',
      computedHash: 'hash_3',
      trustFlag: 'VERIFIED' as const,
      metadata: null
    };

    const res = evaluateEvent(saturdayStreak, baseRule, mondayEvent);
    assert.equal(res.updatedStreak.currentStreak, 6);
    assert.equal(res.updatedStreak.freezesAvailable, 2); // Zero freezes consumed!
    assert.equal(res.updatedStreak.lastCompletedLogicalDate, '2026-11-09');
  });

  it('auto-consumes a freeze when a non-exempt day is missed and preserves streak', () => {
    // User completed on Monday 2026-11-02
    const mondayStreak: UserStreak = {
      ...initialStreak,
      currentStreak: 10,
      highestStreak: 10,
      lastCompletedLogicalDate: '2026-11-02',
      currentLogicalDate: '2026-11-02',
      currentWindowProgress: 1,
      freezesAvailable: 2
    };

    // User missed Tuesday 2026-11-03, next action is on Wednesday 2026-11-04
    const wednesdayEvent = {
      eventId: '0192-0004',
      ruleSlug: 'daily_tailor_log',
      value: 1,
      occurredAtUtc: new Date('2026-11-04T10:00:00Z'),
      monotonicMs: 4000,
      prevEventHash: 'hash_3',
      computedHash: 'hash_4',
      trustFlag: 'VERIFIED' as const,
      metadata: null
    };

    const res = evaluateEvent(mondayStreak, baseRule, wednesdayEvent);
    assert.equal(res.updatedStreak.currentStreak, 11);
    assert.equal(res.updatedStreak.freezesAvailable, 1); // 1 freeze consumed for Tuesday
    assert.equal(res.webhooksToEnqueue.some((w) => w.eventType === 'streak.frozen'), true);
    assert.equal(res.webhooksToEnqueue.some((w) => w.eventType === 'streak.incremented'), true);
  });

  it('breaks streak and resets to 1 when a day is missed and 0 freezes are available', () => {
    // User completed on Monday with 0 freezes left
    const streakZeroFreezes: UserStreak = {
      ...initialStreak,
      currentStreak: 15,
      highestStreak: 15,
      lastCompletedLogicalDate: '2026-11-02',
      currentLogicalDate: '2026-11-02',
      currentWindowProgress: 1,
      freezesAvailable: 0
    };

    // Next action on Wednesday 2026-11-04
    const wednesdayEvent = {
      eventId: '0192-0005',
      ruleSlug: 'daily_tailor_log',
      value: 1,
      occurredAtUtc: new Date('2026-11-04T10:00:00Z'),
      monotonicMs: 5000,
      prevEventHash: null,
      computedHash: 'hash_5',
      trustFlag: 'VERIFIED' as const,
      metadata: null
    };

    const res = evaluateEvent(streakZeroFreezes, baseRule, wednesdayEvent);
    assert.equal(res.updatedStreak.currentStreak, 1); // Reset to 1
    assert.equal(res.webhooksToEnqueue.some((w) => w.eventType === 'streak.broken'), true);
  });
});
