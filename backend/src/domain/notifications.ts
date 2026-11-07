// domain/notifications.ts: The Psychological & Escalating Streak Notification Engine
// Generates Duolingo-grade loss-aversion copy based on time-to-expiry and streak status.

export type NotificationTone = 'UNHINGED' | 'CONSCIOUS' | 'GENTLE';

export type UrgencyTier = 'NUDGE_4H' | 'URGENT_2H' | 'PANIC_30M' | 'STREAK_LOST_REPAIR';

export interface NotificationMessage {
  title: string;
  body: string;
  urgency: UrgencyTier;
  soundName?: string;
  actionUrl?: string;
}

export interface NotificationEvaluationInput {
  ruleName: string;
  currentStreak: number;
  secondsUntilExpiry: number;
  completedToday: boolean;
  freezesAvailable: number;
  tone?: NotificationTone;
}

export function evaluateNotificationCopy(input: NotificationEvaluationInput): NotificationMessage | null {
  if (input.completedToday) {
    return null; // No anxiety notifications if already completed today
  }

  const streak = input.currentStreak;
  const tone = input.tone || 'UNHINGED';
  const hoursLeft = input.secondsUntilExpiry / 3600;

  // 1. Final Emergency Panic (< 30 minutes left)
  if (input.secondsUntilExpiry > 0 && input.secondsUntilExpiry <= 1800) {
    return getPanicCopy(streak, input.ruleName, tone, input.freezesAvailable);
  }

  // 2. Urgent / Cardiac Arrest (< 2 hours left)
  if (hoursLeft > 0 && hoursLeft <= 2) {
    return getUrgentCopy(streak, input.ruleName, tone, input.freezesAvailable);
  }

  // 3. Gentle / Loss Aversion Nudge (between 2 and 4.5 hours left)
  if (hoursLeft > 2 && hoursLeft <= 4.5) {
    return getNudgeCopy(streak, input.ruleName, tone);
  }

  return null;
}

/**
 * Generates copy when a streak is lost, offering immediate resurrection / paywall / ad repair.
 */
export function getStreakLostRepairCopy(
  lostStreak: number,
  ruleName: string,
  tone: NotificationTone = 'UNHINGED'
): NotificationMessage {
  switch (tone) {
    case 'UNHINGED':
      return {
        title: `💔 Flatline. Your ${lostStreak}-day streak died.`,
        body: `It didn't have to end this way. You have 24 hours to resurrect it before it's gone forever. Tap to restore.`,
        urgency: 'STREAK_LOST_REPAIR'
      };
    case 'CONSCIOUS':
      return {
        title: `🕊️ Your ${lostStreak}-day streak ended last night`,
        body: `Consistency is a journey. Reclaim your ${lostStreak}-day dedication today with streak repair.`,
        urgency: 'STREAK_LOST_REPAIR'
      };
    case 'GENTLE':
    default:
      return {
        title: `Streak Ended: ${lostStreak} Days`,
        body: `Don't worry! You can restore your ${ruleName} streak today. Tap here to continue.`,
        urgency: 'STREAK_LOST_REPAIR'
      };
  }
}

function getNudgeCopy(streak: number, ruleName: string, tone: NotificationTone): NotificationMessage {
  const daysText = streak > 0 ? `${streak} days` : 'your streak';
  switch (tone) {
    case 'UNHINGED':
      return {
        title: `🔥 Duo is watching...`,
        body: `You've spent ${daysText} building this. Don't let it freeze over tonight. 1 quick session saves it.`,
        urgency: 'NUDGE_4H'
      };
    case 'CONSCIOUS':
      return {
        title: `🌙 Evening Reflection: ${ruleName}`,
        body: `Keep your ${daysText} of mindful practice unbroken. A few minutes is all it takes tonight.`,
        urgency: 'NUDGE_4H'
      };
    case 'GENTLE':
    default:
      return {
        title: `Reminder: Complete ${ruleName}`,
        body: `You're on a ${daysText} streak! Take a few moments today to keep it going.`,
        urgency: 'NUDGE_4H'
      };
  }
}

function getUrgentCopy(
  streak: number,
  ruleName: string,
  tone: NotificationTone,
  freezes: number
): NotificationMessage {
  const freezeNotice = freezes > 0 ? ` (🛡️ ${freezes} freeze shield available)` : ' (NO FREEZES LEFT)';
  switch (tone) {
    case 'UNHINGED':
      return {
        title: `⚠️ CARDIAC ARREST: ${streak} Days in Danger!`,
        body: `Your streak flatlines in under 2 hours. Don't throw away ${streak} days of blood, sweat, and tears.${freezeNotice}`,
        urgency: 'URGENT_2H'
      };
    case 'CONSCIOUS':
      return {
        title: `⏳ 2 Hours Left Today`,
        body: `Protect your ${streak}-day conscious habit before midnight.${freezeNotice}`,
        urgency: 'URGENT_2H'
      };
    case 'GENTLE':
    default:
      return {
        title: `Expiring Soon: ${streak}-Day Streak`,
        body: `Less than 2 hours left to complete today's ${ruleName}.${freezeNotice}`,
        urgency: 'URGENT_2H'
      };
  }
}

function getPanicCopy(
  streak: number,
  ruleName: string,
  tone: NotificationTone,
  freezes: number
): NotificationMessage {
  switch (tone) {
    case 'UNHINGED':
      return {
        title: `🚨 30 MINUTES LEFT. CODE RED.`,
        body: `Say goodbye to your ${streak} days in 30 minutes unless you open the app RIGHT NOW. Don't be that guy.`,
        urgency: 'PANIC_30M'
      };
    case 'CONSCIOUS':
      return {
        title: `🚨 Final Moments Today`,
        body: `30 minutes remain to preserve your ${streak}-day commitment to ${ruleName}. Complete it now.`,
        urgency: 'PANIC_30M'
      };
    case 'GENTLE':
    default:
      return {
        title: `Final Warning: Streak Expiring!`,
        body: `Only 30 minutes left to save your ${streak}-day streak on ${ruleName}.`,
        urgency: 'PANIC_30M'
      };
  }
}
