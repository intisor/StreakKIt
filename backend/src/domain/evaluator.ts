// domain/evaluator.ts: Deterministic streak state machine & Lazy Read Evaluation
import {
  StreakRule,
  UserStreak,
  StreakStateDTO,
  StreakStatus,
  DayHistoryState,
  WebhookEventType
} from './types.js';
import {
  computeLogicalDate,
  computeNextWindowExpiry,
  daysBetween,
  addDays,
  listDatesBetween,
  isExemptDay
} from './time-window.js';
import { calculateAutoEarnFreezes } from './features.js';
import { VerifiedEvent } from './anticheat.js';

export interface EvaluationResult {
  updatedStreak: UserStreak;
  webhooksToEnqueue: Array<{
    eventType: WebhookEventType;
    payload: Record<string, unknown>;
  }>;
  milestoneReached: number | null;
}

/**
 * Builds the rolling 14-day history array up to todayLogicalDate
 */
export function buildRollingHistory(
  todayLogicalDate: string,
  lastCompletedDate: string | null,
  recentHistory: Array<{ date: string; state: DayHistoryState }>,
  exemptDaysBitmask: number
): Array<{ date: string; state: DayHistoryState }> {
  const map = new Map<string, DayHistoryState>();
  for (const item of recentHistory) {
    map.set(item.date, item.state);
  }

  const result: Array<{ date: string; state: DayHistoryState }> = [];
  // Build 14 days ending todayLogicalDate
  for (let i = 13; i >= 0; i--) {
    const d = addDays(todayLogicalDate, -i);
    let state: DayHistoryState = 'PENDING';

    if (map.has(d)) {
      state = map.get(d)!;
    } else if (d === lastCompletedDate) {
      state = 'COMPLETED';
    } else if (isExemptDay(d, exemptDaysBitmask)) {
      state = 'EXEMPT';
    } else if (lastCompletedDate && daysBetween(d, lastCompletedDate) > 0) {
      // Date is after last completed date and before today -> missed if in the past
      if (d < todayLogicalDate) {
        state = 'MISSED';
      } else {
        state = 'PENDING';
      }
    } else if (lastCompletedDate && daysBetween(d, lastCompletedDate) < 0) {
      // Date is in the past before last completed date and wasn't explicitly marked
      state = 'MISSED';
    } else {
      state = d === todayLogicalDate ? 'PENDING' : 'MISSED';
    }

    result.push({ date: d, state });
  }

  return result;
}

/**
 * Calculates milestone information based on current streak and rule.milestoneDays
 */
export function calculateMilestones(
  currentStreak: number,
  milestoneDays: number[],
  isNewIncrement: boolean
): { justReached: number | null; nextMilestone: number | null; daysToNextMilestone: number } {
  const sorted = [...milestoneDays].sort((a, b) => a - b);
  const nextMilestone = sorted.find((m) => m > currentStreak) ?? null;
  const daysToNextMilestone = nextMilestone !== null ? nextMilestone - currentStreak : 0;
  const justReached = isNewIncrement && sorted.includes(currentStreak) ? currentStreak : null;

  return { justReached, nextMilestone, daysToNextMilestone };
}

/**
 * Evaluates a single verified event against the user streak state.
 * Implements Section 3.C of the master specification.
 */
export function evaluateEvent(
  userStreak: UserStreak,
  rule: StreakRule,
  event: VerifiedEvent,
  nowUtc: Date = new Date()
): EvaluationResult {
  const eventTimezone = (event.metadata?.timezone as string) || userStreak.timezone;
  const L_event = computeLogicalDate(
    event.occurredAtUtc,
    eventTimezone,
    rule.gracePeriodMinutes
  );
  const L_last = userStreak.lastCompletedLogicalDate;

  const webhooksToEnqueue: Array<{
    eventType: WebhookEventType;
    payload: Record<string, unknown>;
  }> = [];

  let currentStreak = userStreak.currentStreak;
  const prevStreak = userStreak.currentStreak;
  let highestStreak = userStreak.highestStreak;
  let freezesAvailable = userStreak.freezesAvailable;
  let lastFreezeConsumedDate = userStreak.lastFreezeConsumedDate;
  let currentWindowProgress = userStreak.currentWindowProgress;
  let currentLogicalDate = userStreak.currentLogicalDate;
  let lastCompletedLogicalDate = userStreak.lastCompletedLogicalDate;
  let windowExpiresAtUtc = userStreak.windowExpiresAtUtc;
  let atRiskNotifiedForDate = userStreak.atRiskNotifiedForDate;
  let milestoneReached: number | null = null;

  const history = [...userStreak.recentHistory];

  // 1. Advance progress for L_event
  if (currentLogicalDate !== L_event) {
    currentWindowProgress = event.value;
    currentLogicalDate = L_event;
  } else {
    currentWindowProgress += event.value;
  }

  // Check if window crossed rule.targetValue
  const targetReached = currentWindowProgress >= rule.targetValue;
  const alreadyCompletedOnThisDate = L_last === L_event;

  if (targetReached && !alreadyCompletedOnThisDate) {
    // Window crosses target_value for the first time on L_event!
    if (L_last === null) {
      // Case 1: First-ever completion
      currentStreak = 1;
      highestStreak = Math.max(highestStreak, 1);
      lastCompletedLogicalDate = L_event;

      webhooksToEnqueue.push({
        eventType: 'streak.incremented',
        payload: {
          ruleSlug: rule.slug,
          externalUserId: userStreak.externalUserId,
          currentStreak: 1,
          highestStreak,
          completedLogicalDate: L_event
        }
      });

      if (rule.milestoneDays.includes(1)) {
        milestoneReached = 1;
        webhooksToEnqueue.push({
          eventType: 'streak.milestone',
          payload: {
            ruleSlug: rule.slug,
            externalUserId: userStreak.externalUserId,
            milestone: 1,
            currentStreak: 1
          }
        });
      }
    } else {
      // Case 2: Subsequent completion (L_last < L_event or out-of-order check)
      const daysDiff = daysBetween(L_last, L_event);

      if (daysDiff <= 0) {
        // Event was for a date before or equal to last completed date
        // No streak change, but record history
      } else {
        // Iterate calendar day by day from L_last + 1 to L_event - 1
        const intermediateDates = listDatesBetween(L_last, L_event);
        const missedDates: string[] = [];

        for (const d of intermediateDates) {
          if (!isExemptDay(d, rule.exemptDaysBitmask)) {
            missedDates.push(d);
          } else {
            history.push({ date: d, state: 'EXEMPT' });
          }
        }

        const missedCount = missedDates.length;

        if (missedCount === 0) {
          // Subcase 2A: Consecutive required window completed!
          currentStreak += 1;
          highestStreak = Math.max(highestStreak, currentStreak);
          lastCompletedLogicalDate = L_event;

          webhooksToEnqueue.push({
            eventType: 'streak.incremented',
            payload: {
              ruleSlug: rule.slug,
              externalUserId: userStreak.externalUserId,
              currentStreak,
              highestStreak,
              completedLogicalDate: L_event
            }
          });

          if (rule.milestoneDays.includes(currentStreak)) {
            milestoneReached = currentStreak;
            webhooksToEnqueue.push({
              eventType: 'streak.milestone',
              payload: {
                ruleSlug: rule.slug,
                externalUserId: userStreak.externalUserId,
                milestone: currentStreak,
                currentStreak
              }
            });
          }
        } else if (rule.autoConsumeFreeze && freezesAvailable >= missedCount) {
          // Subcase 2B: Consumed freeze(s)
          freezesAvailable -= missedCount;
          lastFreezeConsumedDate = missedDates[missedDates.length - 1];
          for (const md of missedDates) {
            history.push({ date: md, state: 'FROZEN' });
          }

          currentStreak += 1;
          highestStreak = Math.max(highestStreak, currentStreak);
          lastCompletedLogicalDate = L_event;

          webhooksToEnqueue.push({
            eventType: 'streak.frozen',
            payload: {
              ruleSlug: rule.slug,
              externalUserId: userStreak.externalUserId,
              freezesConsumed: missedCount,
              freezesRemaining: freezesAvailable,
              dates: missedDates
            }
          });

          webhooksToEnqueue.push({
            eventType: 'streak.incremented',
            payload: {
              ruleSlug: rule.slug,
              externalUserId: userStreak.externalUserId,
              currentStreak,
              highestStreak,
              completedLogicalDate: L_event
            }
          });

          if (rule.milestoneDays.includes(currentStreak)) {
            milestoneReached = currentStreak;
            webhooksToEnqueue.push({
              eventType: 'streak.milestone',
              payload: {
                ruleSlug: rule.slug,
                externalUserId: userStreak.externalUserId,
                milestone: currentStreak,
                currentStreak
              }
            });
          }
        } else {
          // Subcase 2C: Insufficient freezes -> Streak broken, resets to 1
          webhooksToEnqueue.push({
            eventType: 'streak.broken',
            payload: {
              ruleSlug: rule.slug,
              externalUserId: userStreak.externalUserId,
              previousStreak: currentStreak,
              brokenOnDate: missedDates[0] || L_event
            }
          });

          // Record last broken streak for restoration window
          userStreak.lastBrokenStreakLength = currentStreak;
          userStreak.lastBrokenDate = missedDates[0] || L_event;

          for (const md of missedDates) {
            history.push({ date: md, state: 'MISSED' });
          }

          currentStreak = 1;
          lastCompletedLogicalDate = L_event;

          webhooksToEnqueue.push({
            eventType: 'streak.incremented',
            payload: {
              ruleSlug: rule.slug,
              externalUserId: userStreak.externalUserId,
              currentStreak: 1,
              highestStreak,
              completedLogicalDate: L_event
            }
          });
        }
      }
    }

    // Auto-earn freeze check if rule has freezeAutoEarnDays configured
    if (rule.freezeAutoEarnDays && rule.freezeAutoEarnDays > 0) {
      const earnRes = calculateAutoEarnFreezes(
        prevStreak,
        currentStreak,
        freezesAvailable,
        rule.freezeMaxCount ?? rule.maxFreezes ?? 3,
        rule.freezeAutoEarnDays,
        1
      );
      if (earnRes.freezesAwarded > 0) {
        freezesAvailable = earnRes.newFreezesAvailable;
      }
    }

    // Add this completion to recent history
    history.push({ date: L_event, state: 'COMPLETED' });

    // Compute Next window_expires_at_utc
    const nextExpiry = computeNextWindowExpiry(
      L_event,
      userStreak.timezone,
      rule.exemptDaysBitmask,
      rule.gracePeriodMinutes
    );
    windowExpiresAtUtc = nextExpiry.toISOString();
    atRiskNotifiedForDate = null;
  }

  // Deduplicate and trim history to last 30 entries
  const trimmedHistory = deduplicateHistory(history);

  const updatedStreak: UserStreak = {
    ...userStreak,
    currentStreak,
    highestStreak,
    freezesAvailable,
    lastFreezeConsumedDate,
    lastCompletedLogicalDate,
    currentLogicalDate,
    currentWindowProgress,
    windowExpiresAtUtc,
    atRiskNotifiedForDate,
    recentHistory: trimmedHistory,
    lastClientEventUtc: event.occurredAtUtc.toISOString(),
    lastEventHash: event.computedHash,
    updatedAt: nowUtc.toISOString()
  };

  return {
    updatedStreak,
    webhooksToEnqueue,
    milestoneReached
  };
}

/**
 * Evaluates state at read time.
 * If window_expires_at_utc has passed and user missed required days without freezes,
 * calculates the real live state (lazy evaluation).
 */
export function evaluateStateOnRead(
  userStreak: UserStreak,
  rule: StreakRule,
  nowUtc: Date = new Date()
): StreakStateDTO {
  const todayLogicalDate = computeLogicalDate(
    nowUtc,
    userStreak.timezone,
    rule.gracePeriodMinutes
  );

  let currentStreak = userStreak.currentStreak;
  let freezesAvailable = userStreak.freezesAvailable;
  let status: StreakStatus = 'PENDING_TODAY';

  const windowExpiresUtc = userStreak.windowExpiresAtUtc
    ? new Date(userStreak.windowExpiresAtUtc)
    : null;

  const secondsUntilExpiry = windowExpiresUtc
    ? Math.max(0, Math.floor((windowExpiresUtc.getTime() - nowUtc.getTime()) / 1000))
    : 0;

  const isExemptToday = isExemptDay(todayLogicalDate, rule.exemptDaysBitmask);
  const completedToday =
    userStreak.lastCompletedLogicalDate === todayLogicalDate &&
    userStreak.currentWindowProgress >= rule.targetValue;

  if (completedToday) {
    status = 'ACTIVE_TODAY';
  } else if (windowExpiresUtc && nowUtc.getTime() > windowExpiresUtc.getTime()) {
    // Window has expired! Check if broken or auto-frozen
    if (userStreak.lastCompletedLogicalDate) {
      const intermediateDates = listDatesBetween(
        userStreak.lastCompletedLogicalDate,
        todayLogicalDate
      );
      const missedDates = intermediateDates.filter(
        (d) => !isExemptDay(d, rule.exemptDaysBitmask)
      );

      if (missedDates.length > 0) {
        if (rule.autoConsumeFreeze && freezesAvailable >= missedDates.length) {
          status = 'FROZEN';
          freezesAvailable -= missedDates.length;
        } else {
          status = 'BROKEN';
          currentStreak = 0;
        }
      }
    } else {
      status = 'BROKEN';
      currentStreak = 0;
    }
  } else {
    // Window still open
    const atRiskLeadMs = (rule.atRiskLeadMinutes || 120) * 60 * 1000;
    if (windowExpiresUtc && windowExpiresUtc.getTime() - nowUtc.getTime() <= atRiskLeadMs) {
      status = 'AT_RISK';
    } else {
      status = 'PENDING_TODAY';
    }
  }

  const milestones = calculateMilestones(currentStreak, rule.milestoneDays, false);
  const rollingHistory = buildRollingHistory(
    todayLogicalDate,
    userStreak.lastCompletedLogicalDate,
    userStreak.recentHistory,
    rule.exemptDaysBitmask
  );

  return {
    ruleSlug: rule.slug,
    externalUserId: userStreak.externalUserId,
    timezone: userStreak.timezone,
    status,
    currentStreak,
    highestStreak: userStreak.highestStreak,
    todayProgress: {
      current: userStreak.currentLogicalDate === todayLogicalDate ? userStreak.currentWindowProgress : 0,
      target: rule.targetValue,
      completed: completedToday
    },
    freezes: {
      available: freezesAvailable,
      max: rule.maxFreezes,
      autoConsume: rule.autoConsumeFreeze
    },
    timing: {
      currentLogicalDate: todayLogicalDate,
      windowExpiresAtUtc: userStreak.windowExpiresAtUtc,
      secondsUntilExpiry,
      isExemptToday
    },
    milestone: milestones,
    historyLast14Days: rollingHistory
  };
}

function deduplicateHistory(
  history: Array<{ date: string; state: DayHistoryState }>
): Array<{ date: string; state: DayHistoryState }> {
  const map = new Map<string, DayHistoryState>();
  for (const item of history) {
    map.set(item.date, item.state);
  }
  return Array.from(map.entries())
    .map(([date, state]) => ({ date, state }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);
}
