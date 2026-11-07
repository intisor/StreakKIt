import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMonthCalendar } from '../src/domain/calendar.js';
import { StreakRule, UserStreak } from '../src/domain/types.js';

describe('Deterministic Monthly Calendar Generator', () => {
  const dummyRule: StreakRule = {
    id: 'rule_1',
    tenantId: 'tenant_1',
    slug: 'daily_workout',
    name: 'Daily Workout',
    cadenceType: 'DAILY',
    targetValue: 1,
    exemptDaysBitmask: 0,
    gracePeriodMinutes: 0,
    maxFreezes: 2,
    autoConsumeFreeze: true,
    atRiskLeadMinutes: 120,
    milestoneDays: [3, 7, 14, 30],
    createdAt: new Date().toISOString()
  };

  const dummyStreak: UserStreak = {
    id: 'user_streak_1',
    tenantId: 'tenant_1',
    ruleId: 'rule_1',
    externalUserId: 'user_123',
    timezone: 'UTC',
    currentStreak: 5,
    highestStreak: 12,
    lastCompletedLogicalDate: '2026-11-05',
    currentLogicalDate: '2026-11-05',
    currentWindowProgress: 1,
    freezesAvailable: 1,
    lastFreezeConsumedDate: null,
    windowExpiresAtUtc: '2026-11-06T00:00:00.000Z',
    atRiskNotifiedForDate: null,
    recentHistory: [
      { date: '2026-11-01', state: 'COMPLETED' },
      { date: '2026-11-02', state: 'COMPLETED' },
      { date: '2026-11-03', state: 'COMPLETED' },
      { date: '2026-11-04', state: 'FROZEN' },
      { date: '2026-11-05', state: 'COMPLETED' }
    ],
    lastClientEventUtc: null,
    lastEventHash: null,
    updatedAt: new Date().toISOString()
  };

  it('generates exact 30 days for November 2026 with correct day of week', () => {
    const calendar = generateMonthCalendar(
      2026,
      11,
      '2026-11-05',
      dummyRule,
      dummyStreak
    );

    assert.equal(calendar.year, 2026);
    assert.equal(calendar.month, 11);
    assert.equal(calendar.monthName, 'November');
    assert.equal(calendar.daysInMonth, 30);
    // Nov 1, 2026 is a Sunday (day 0)
    assert.equal(calendar.firstDayOfWeek, 0);
    assert.equal(calendar.days.length, 30);

    // Days 1..3 should be COMPLETED
    assert.equal(calendar.days[0].state, 'COMPLETED');
    assert.equal(calendar.days[1].state, 'COMPLETED');
    assert.equal(calendar.days[2].state, 'COMPLETED');

    // Day 4 should be FROZEN
    assert.equal(calendar.days[3].state, 'FROZEN');

    // Day 5 is todayLogicalDate and was completed
    assert.equal(calendar.days[4].isToday, true);
    assert.equal(calendar.days[4].state, 'ACTIVE_TODAY');

    // Day 6..30 should be FUTURE
    assert.equal(calendar.days[5].isFuture, true);
    assert.equal(calendar.days[5].state, 'FUTURE');
    assert.equal(calendar.days[29].state, 'FUTURE');
  });

  it('correctly flags pauses and exempt days', () => {
    const ruleWithSundayExempt: StreakRule = {
      ...dummyRule,
      exemptDaysBitmask: 64 // Sunday exempt
    };

    const pauses = [
      { start_date: '2026-11-10', end_date: '2026-11-12' }
    ];

    const calendar = generateMonthCalendar(
      2026,
      11,
      '2026-11-15',
      ruleWithSundayExempt,
      dummyStreak,
      [],
      pauses
    );

    // Nov 10, 11, 12 should be PAUSED
    const day10 = calendar.days.find(d => d.date === '2026-11-10');
    const day11 = calendar.days.find(d => d.date === '2026-11-11');
    const day12 = calendar.days.find(d => d.date === '2026-11-12');
    assert.equal(day10?.state, 'PAUSED');
    assert.equal(day11?.state, 'PAUSED');
    assert.equal(day12?.state, 'PAUSED');

    // Nov 8, 2026 is Sunday (exempt)
    const day8 = calendar.days.find(d => d.date === '2026-11-08');
    assert.equal(day8?.state, 'EXEMPT');
  });

  it('calculates perfect weeks accurately', () => {
    const fullWeekStreak: UserStreak = {
      ...dummyStreak,
      lastCompletedLogicalDate: '2026-11-07',
      recentHistory: [
        { date: '2026-11-01', state: 'COMPLETED' }, // Sun
        { date: '2026-11-02', state: 'COMPLETED' }, // Mon
        { date: '2026-11-03', state: 'COMPLETED' }, // Tue
        { date: '2026-11-04', state: 'COMPLETED' }, // Wed
        { date: '2026-11-05', state: 'COMPLETED' }, // Thu
        { date: '2026-11-06', state: 'COMPLETED' }, // Fri
        { date: '2026-11-07', state: 'COMPLETED' }  // Sat
      ]
    };

    const calendar = generateMonthCalendar(
      2026,
      11,
      '2026-11-07',
      dummyRule,
      fullWeekStreak
    );

    // Week 0 (Nov 1 to Nov 7) should be a perfect week!
    assert.ok(calendar.perfectWeeks.includes(0), 'Expected week 0 to be a perfect week');
    assert.equal(calendar.activeDaysCount, 7);
  });
});
