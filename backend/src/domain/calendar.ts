// domain/calendar.ts: Deterministic Monthly Calendar State Machine & DTO Generation
import { StreakRule, UserStreak, DayHistoryState } from './types.js';
import { parseDateString, computeLogicalDate, isExemptDay } from './time-window.js';

export type CalendarDayState =
  | 'COMPLETED'
  | 'FROZEN'
  | 'PAUSED'
  | 'EXEMPT'
  | 'MISSED'
  | 'ACTIVE_TODAY'
  | 'PENDING_TODAY'
  | 'AT_RISK'
  | 'FUTURE';

export interface CalendarDayDTO {
  date: string; // "YYYY-MM-DD"
  day: number; // 1..31
  dayOfWeek: number; // 0 = Sunday, 1 = Monday ... 6 = Saturday
  isToday: boolean;
  isFuture: boolean;
  state: CalendarDayState;
  streakLength?: number;
}

export interface MonthCalendarDTO {
  ruleSlug: string;
  externalUserId: string;
  year: number;
  month: number; // 1..12
  monthName: string; // e.g. "November"
  daysInMonth: number;
  firstDayOfWeek: number; // 0 = Sunday, 1 = Monday ... 6 = Saturday
  days: CalendarDayDTO[];
  activeDaysCount: number;
  frozenDaysCount: number;
  missedDaysCount: number;
  perfectWeeks: number[]; // Indexes of weeks (0-based) where non-exempt days were 100% completed/frozen
  currentStreak: number;
  highestStreak: number;
}

export interface StreakHistoryEntry {
  period_date: string;
  status: string; // 'EXTENDED', 'COMPLETED', 'FROZEN', 'PAUSED', 'BROKEN'
  streak_length: number;
}

export interface StreakPauseEntry {
  start_date: string;
  end_date: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Builds a deterministic monthly calendar for a user and rule.
 */
export function generateMonthCalendar(
  year: number,
  month: number, // 1..12
  todayLogicalDate: string, // "YYYY-MM-DD"
  rule: StreakRule,
  userStreak: UserStreak,
  historyRows: StreakHistoryEntry[] = [],
  pauseRows: StreakPauseEntry[] = [],
  userDaysOff: number[] = []
): MonthCalendarDTO {
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}. Expected 1-12.`);
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstDayOfWeek = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 is Sunday
  const monthName = MONTH_NAMES[month - 1];

  // Map history rows
  const historyMap = new Map<string, { status: string; streakLength: number }>();
  for (const h of historyRows) {
    historyMap.set(h.period_date, { status: h.status, streakLength: h.streak_length });
  }

  // Also overlay recentHistory from userStreak if not in historyMap
  if (userStreak.recentHistory && Array.isArray(userStreak.recentHistory)) {
    for (const item of userStreak.recentHistory) {
      if (!historyMap.has(item.date)) {
        historyMap.set(item.date, {
          status: item.state === 'COMPLETED' ? 'EXTENDED' : item.state,
          streakLength: userStreak.currentStreak
        });
      }
    }
  }

  // Check if today is completed
  const completedToday =
    userStreak.lastCompletedLogicalDate === todayLogicalDate &&
    userStreak.currentWindowProgress >= rule.targetValue;

  const days: CalendarDayDTO[] = [];
  let activeDaysCount = 0;
  let frozenDaysCount = 0;
  let missedDaysCount = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    const isToday = dateStr === todayLogicalDate;
    const isFuture = dateStr > todayLogicalDate;

    let state: CalendarDayState = 'MISSED';
    let streakLength: number | undefined;

    if (isFuture) {
      state = 'FUTURE';
    } else if (isToday) {
      if (completedToday) {
        state = 'ACTIVE_TODAY';
        activeDaysCount++;
        streakLength = userStreak.currentStreak;
      } else {
        const expiresUtc = userStreak.windowExpiresAtUtc ? new Date(userStreak.windowExpiresAtUtc) : null;
        const now = new Date();
        const atRiskLeadMs = (rule.atRiskLeadMinutes || 120) * 60 * 1000;
        if (expiresUtc && expiresUtc.getTime() <= now.getTime()) {
          state = 'MISSED';
          missedDaysCount++;
        } else if (expiresUtc && expiresUtc.getTime() - now.getTime() <= atRiskLeadMs) {
          state = 'AT_RISK';
        } else {
          state = 'PENDING_TODAY';
        }
      }
    } else {
      // Past day
      const isPaused = pauseRows.some(p => p.start_date <= dateStr && dateStr <= p.end_date);
      const isExempt = isExemptDay(dateStr, rule.exemptDaysBitmask) || userDaysOff.includes(dayOfWeek);
      const historyItem = historyMap.get(dateStr);

      if (isPaused || historyItem?.status === 'PAUSED') {
        state = 'PAUSED';
      } else if (historyItem?.status === 'EXTENDED' || historyItem?.status === 'COMPLETED' || dateStr === userStreak.lastCompletedLogicalDate) {
        state = 'COMPLETED';
        activeDaysCount++;
        streakLength = historyItem?.streakLength;
      } else if (historyItem?.status === 'FROZEN') {
        state = 'FROZEN';
        frozenDaysCount++;
        streakLength = historyItem?.streakLength;
      } else if (isExempt) {
        state = 'EXEMPT';
      } else {
        state = 'MISSED';
        missedDaysCount++;
      }
    }

    days.push({
      date: dateStr,
      day: d,
      dayOfWeek,
      isToday,
      isFuture,
      state,
      streakLength
    });
  }

  // Calculate perfect weeks (grouped into 7-day Sunday-Saturday chunks)
  const perfectWeeks: number[] = [];
  let currentWeekIndex = 0;
  let currentWeekActiveOrFrozen = 0;
  let currentWeekEligibleDays = 0;

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    if (day.dayOfWeek === 0 && i !== 0) {
      // Evaluate previous week
      if (currentWeekEligibleDays > 0 && currentWeekActiveOrFrozen === currentWeekEligibleDays) {
        perfectWeeks.push(currentWeekIndex);
      }
      currentWeekIndex++;
      currentWeekActiveOrFrozen = 0;
      currentWeekEligibleDays = 0;
    }

    if (!day.isFuture && day.state !== 'EXEMPT') {
      currentWeekEligibleDays++;
      if (day.state === 'COMPLETED' || day.state === 'ACTIVE_TODAY' || day.state === 'FROZEN') {
        currentWeekActiveOrFrozen++;
      }
    }
  }

  // Check the final week
  if (currentWeekEligibleDays > 0 && currentWeekActiveOrFrozen === currentWeekEligibleDays) {
    perfectWeeks.push(currentWeekIndex);
  }

  return {
    ruleSlug: rule.slug,
    externalUserId: userStreak.externalUserId,
    year,
    month,
    monthName,
    daysInMonth,
    firstDayOfWeek,
    days,
    activeDaysCount,
    frozenDaysCount,
    missedDaysCount,
    perfectWeeks,
    currentStreak: userStreak.currentStreak,
    highestStreak: userStreak.highestStreak
  };
}
