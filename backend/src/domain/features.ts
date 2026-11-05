// domain/features.ts: Pure domain functions for Trophy-grade streak moats
// Completely decoupled from database, HTTP, and SDK layers.

import { parseDateString, formatDateString, daysBetween } from './time-window.js';

export interface AutoEarnFreezeResult {
  freezesAwarded: number;
  newFreezesAvailable: number;
}

/**
 * Calculates auto-earned freezes based on current streak progression.
 * Formula: If autoEarnDays > 0 and streak achieves a new multiple of autoEarnDays,
 * award freezes without exceeding maxFreezes.
 *
 * @param previousStreak The streak count before this increment
 * @param newStreak The new streak count after this increment
 * @param currentFreezes The user's current freeze balance
 * @param maxFreezes The maximum freeze inventory cap
 * @param autoEarnDays Number of streak days required to earn a freeze (e.g., 7)
 * @param autoEarnAmount Number of freezes awarded per milestone (default 1)
 */
export function calculateAutoEarnFreezes(
  previousStreak: number,
  newStreak: number,
  currentFreezes: number,
  maxFreezes: number,
  autoEarnDays: number,
  autoEarnAmount: number = 1
): AutoEarnFreezeResult {
  if (autoEarnDays <= 0 || autoEarnAmount <= 0 || newStreak <= previousStreak) {
    return { freezesAwarded: 0, newFreezesAvailable: currentFreezes };
  }

  const prevMilestones = Math.floor(previousStreak / autoEarnDays);
  const newMilestones = Math.floor(newStreak / autoEarnDays);
  const milestonesCrossed = Math.max(0, newMilestones - prevMilestones);

  if (milestonesCrossed === 0) {
    return { freezesAwarded: 0, newFreezesAvailable: currentFreezes };
  }

  const potentialAward = milestonesCrossed * autoEarnAmount;
  const capacity = Math.max(0, maxFreezes - currentFreezes);
  const actualAward = Math.min(potentialAward, capacity);

  return {
    freezesAwarded: actualAward,
    newFreezesAvailable: currentFreezes + actualAward
  };
}

/**
 * Checks whether a given YYYY-MM-DD date is a Rest Day (Day Off).
 * Supports Trophy-style day-of-week indices:
 * 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday
 *
 * @param dateStr YYYY-MM-DD date
 * @param daysOff Array of day integers (0..6)
 */
export function isDayOff(dateStr: string, daysOff: number[] | null | undefined): boolean {
  if (!daysOff || daysOff.length === 0) return false;
  const [year, month, day] = parseDateString(dateStr);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = d.getUTCDay(); // 0 is Sunday, 6 is Saturday
  return daysOff.includes(dayOfWeek);
}

/**
 * Converts a Trophy-style daysOff array ([0, 6]) to a 7-bit ISO exemptDaysBitmask.
 * In StreakKit's existing bitmask:
 * Mon=1 (1<<0), Tue=2 (1<<1), Wed=4 (1<<2), Thu=8 (1<<3), Fri=16 (1<<4), Sat=32 (1<<5), Sun=64 (1<<6)
 */
export function daysOffToExemptBitmask(daysOff: number[] | null | undefined): number {
  if (!daysOff || daysOff.length === 0) return 0;
  let bitmask = 0;
  for (const day of daysOff) {
    if (day === 0) {
      // Sunday -> bit 6 (64)
      bitmask |= 1 << 6;
    } else if (day >= 1 && day <= 6) {
      // Mon (1) -> bit 0 (1), Sat (6) -> bit 5 (32)
      bitmask |= 1 << (day - 1);
    }
  }
  return bitmask;
}

/**
 * Converts a 7-bit ISO exemptDaysBitmask back into Trophy-style daysOff array ([0, 6]).
 */
export function exemptBitmaskToDaysOff(bitmask: number): number[] {
  const result: number[] = [];
  if (bitmask <= 0) return result;
  for (let iso = 1; iso <= 7; iso++) {
    const bit = 1 << (iso - 1);
    if ((bitmask & bit) !== 0) {
      if (iso === 7) {
        result.push(0); // Sunday
      } else {
        result.push(iso); // Mon=1..Sat=6
      }
    }
  }
  return result.sort((a, b) => a - b);
}

export interface VacationPauseRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

/**
 * Checks whether a given date falls inside any active vacation pause range.
 * Both start and end dates are inclusive.
 */
export function isDateInVacationPause(dateStr: string, pauses: VacationPauseRange[] | null | undefined): boolean {
  if (!pauses || pauses.length === 0) return false;
  return pauses.some(p => dateStr >= p.startDate && dateStr <= p.endDate);
}

export interface RestoreEligibilityResult {
  eligible: boolean;
  restorableStreakLength: number;
  reason?: 'NO_LOST_STREAK' | 'EXCEEDED_RESTORE_WINDOW' | 'ALREADY_ACTIVE' | 'OK';
}

export interface HistoricalStreakBreak {
  brokenAtDate: string; // YYYY-MM-DD when streak was lost/broken
  achievedLength: number; // Length of the streak right before it was lost
}

/**
 * Evaluates whether a user is eligible to restore a broken streak, and to what length.
 * Follows Trophy's rule: maximum previously achieved streak length found within the restore window
 * (e.g. 90 days for daily streaks).
 *
 * @param currentDate Current logical YYYY-MM-DD date
 * @param currentStreak Current active streak (if already > 0, cannot restore unless current < broken)
 * @param lastBreak Details of the most recent streak break (or null if never broken)
 * @param restoreWindowDays Window in days (default 90)
 */
export function evaluateRestoreEligibility(
  currentDate: string,
  currentStreak: number,
  lastBreak: HistoricalStreakBreak | null | undefined,
  restoreWindowDays: number = 90
): RestoreEligibilityResult {
  if (!lastBreak || lastBreak.achievedLength <= 0) {
    return { eligible: false, restorableStreakLength: 0, reason: 'NO_LOST_STREAK' };
  }

  if (currentStreak >= lastBreak.achievedLength) {
    return { eligible: false, restorableStreakLength: 0, reason: 'ALREADY_ACTIVE' };
  }

  const elapsed = daysBetween(lastBreak.brokenAtDate, currentDate);
  if (elapsed < 0 || elapsed > restoreWindowDays) {
    return { eligible: false, restorableStreakLength: 0, reason: 'EXCEEDED_RESTORE_WINDOW' };
  }

  return {
    eligible: true,
    restorableStreakLength: lastBreak.achievedLength,
    reason: 'OK'
  };
}
