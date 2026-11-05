// tests/features.unit.test.ts: Pure domain unit tests for Trophy-grade streak features
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAutoEarnFreezes,
  isDayOff,
  daysOffToExemptBitmask,
  exemptBitmaskToDaysOff,
  isDateInVacationPause,
  evaluateRestoreEligibility
} from '../src/domain/features.js';

describe('Auto-Earn Freezes Calculation', () => {
  it('awards 0 freezes if autoEarnDays is 0 or disabled', () => {
    const res = calculateAutoEarnFreezes(6, 7, 1, 3, 0);
    assert.equal(res.freezesAwarded, 0);
    assert.equal(res.newFreezesAvailable, 1);
  });

  it('awards +1 freeze when user crosses the 7-day interval', () => {
    const res = calculateAutoEarnFreezes(6, 7, 1, 3, 7, 1);
    assert.equal(res.freezesAwarded, 1);
    assert.equal(res.newFreezesAvailable, 2);
  });

  it('awards 0 freezes when streak increments within the same interval (e.g. 7 -> 8)', () => {
    const res = calculateAutoEarnFreezes(7, 8, 2, 3, 7, 1);
    assert.equal(res.freezesAwarded, 0);
    assert.equal(res.newFreezesAvailable, 2);
  });

  it('respects maxFreezes capacity limit and clamps award', () => {
    // Current is 3, max is 3. User crosses 14-day mark -> cannot exceed 3
    const res = calculateAutoEarnFreezes(13, 14, 3, 3, 7, 1);
    assert.equal(res.freezesAwarded, 0);
    assert.equal(res.newFreezesAvailable, 3);
  });

  it('handles multi-milestone jumps gracefully', () => {
    // Jump from 5 to 21 (crosses 7, 14, 21 -> 3 milestones)
    const res = calculateAutoEarnFreezes(5, 21, 0, 5, 7, 1);
    assert.equal(res.freezesAwarded, 3);
    assert.equal(res.newFreezesAvailable, 3);
  });
});

describe('Days Off & Bitmask Conversion', () => {
  it('identifies Sunday (0) and Saturday (6) as rest days', () => {
    // 2026-11-08 is Sunday
    assert.equal(isDayOff('2026-11-08', [0, 6]), true);
    // 2026-11-07 is Saturday
    assert.equal(isDayOff('2026-11-07', [0, 6]), true);
    // 2026-11-06 is Friday
    assert.equal(isDayOff('2026-11-06', [0, 6]), false);
  });

  it('correctly converts daysOff ([0, 6]) to exemptDaysBitmask and back', () => {
    // Sunday (0) -> bit 6 = 64
    // Saturday (6) -> bit 5 = 32
    // 64 + 32 = 96
    const bitmask = daysOffToExemptBitmask([0, 6]);
    assert.equal(bitmask, 96);

    const backToDays = exemptBitmaskToDaysOff(bitmask);
    assert.deepEqual(backToDays, [0, 6]);
  });

  it('converts all days properly', () => {
    // All 7 days: Mon(1)..Sat(32) + Sun(64) = 127
    const allDays = [0, 1, 2, 3, 4, 5, 6];
    const bitmask = daysOffToExemptBitmask(allDays);
    assert.equal(bitmask, 127);
    assert.deepEqual(exemptBitmaskToDaysOff(bitmask), allDays);
  });
});

describe('Vacation Pause Range Evaluation', () => {
  const pauses = [
    { startDate: '2026-08-10', endDate: '2026-08-15' },
    { startDate: '2026-12-24', endDate: '2026-12-31' }
  ];

  it('detects dates within pause ranges inclusive', () => {
    assert.equal(isDateInVacationPause('2026-08-10', pauses), true);
    assert.equal(isDateInVacationPause('2026-08-12', pauses), true);
    assert.equal(isDateInVacationPause('2026-08-15', pauses), true);
    assert.equal(isDateInVacationPause('2026-12-25', pauses), true);
  });

  it('rejects dates outside pause ranges', () => {
    assert.equal(isDateInVacationPause('2026-08-09', pauses), false);
    assert.equal(isDateInVacationPause('2026-08-16', pauses), false);
    assert.equal(isDateInVacationPause('2026-10-01', pauses), false);
  });
});

describe('Streak Restoration / Repair Eligibility', () => {
  it('returns ineligible if no previous streak break exists', () => {
    const res = evaluateRestoreEligibility('2026-11-05', 0, null, 90);
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'NO_LOST_STREAK');
  });

  it('allows restoring a 30-day streak within the 90-day window', () => {
    const res = evaluateRestoreEligibility(
      '2026-11-05',
      1,
      { brokenAtDate: '2026-10-20', achievedLength: 30 },
      90
    );
    assert.equal(res.eligible, true);
    assert.equal(res.restorableStreakLength, 30);
    assert.equal(res.reason, 'OK');
  });

  it('rejects restoration if the break occurred more than 90 days ago', () => {
    const res = evaluateRestoreEligibility(
      '2026-11-05',
      0,
      { brokenAtDate: '2026-07-01', achievedLength: 50 },
      90
    );
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'EXCEEDED_RESTORE_WINDOW');
  });

  it('rejects restoration if current streak already equals or exceeds achieved length', () => {
    const res = evaluateRestoreEligibility(
      '2026-11-05',
      35,
      { brokenAtDate: '2026-10-01', achievedLength: 30 },
      90
    );
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'ALREADY_ACTIVE');
  });
});
