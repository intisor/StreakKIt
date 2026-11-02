// domain/types.ts: Core domain interfaces, DTOs, and event payloads

export type CadenceType = 'DAILY' | 'EXEMPT_DAYS' | 'WEEKLY_QUOTA';

export type StreakStatus = 'ACTIVE_TODAY' | 'PENDING_TODAY' | 'AT_RISK' | 'FROZEN' | 'BROKEN';

export type DayHistoryState = 'COMPLETED' | 'FROZEN' | 'MISSED' | 'EXEMPT' | 'PENDING';

export type TrustFlag = 'VERIFIED' | 'CLOCK_SKEW_SUSPECTED' | 'CLAMPED';

export type WebhookStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

export type WebhookEventType =
  | 'streak.incremented'
  | 'streak.at_risk'
  | 'streak.frozen'
  | 'streak.broken'
  | 'streak.milestone';

export interface Tenant {
  id: string;
  name: string;
  publicKey: string;
  secretKeyHash: string;
  webhookUrl: string | null;
  webhookSecret: string | null;
  createdAt: string;
}

export interface StreakRule {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  cadenceType: CadenceType;
  targetValue: number;
  exemptDaysBitmask: number; // Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64
  gracePeriodMinutes: number;
  maxFreezes: number;
  autoConsumeFreeze: boolean;
  atRiskLeadMinutes: number;
  milestoneDays: number[];
  createdAt: string;
}

export interface UserStreak {
  id: string;
  tenantId: string;
  ruleId: string;
  externalUserId: string;
  timezone: string;
  currentStreak: number;
  highestStreak: number;
  lastCompletedLogicalDate: string | null;
  currentLogicalDate: string | null;
  currentWindowProgress: number;
  freezesAvailable: number;
  lastFreezeConsumedDate: string | null;
  windowExpiresAtUtc: string | null;
  atRiskNotifiedForDate: string | null;
  recentHistory: Array<{ date: string; state: DayHistoryState }>;
  lastClientEventUtc: string | null;
  lastEventHash: string | null;
  updatedAt: string;
}

export interface ClientEventInput {
  eventId: string;
  ruleSlug: string;
  value?: number;
  occurredAtUtc: string;
  monotonicMs?: number;
  prevEventHash?: string;
  metadata?: Record<string, unknown>;
}

export interface BatchEventsRequest {
  externalUserId: string;
  timezone?: string;
  events: ClientEventInput[];
}

export interface StreakEventRecord {
  eventId: string;
  tenantId: string;
  ruleId: string;
  externalUserId: string;
  value: number;
  occurredAtUtc: string;
  receivedAtUtc: string;
  logicalLocalDate: string;
  monotonicMs: number | null;
  prevEventHash: string | null;
  trustFlag: TrustFlag;
  metadata: Record<string, unknown> | null;
}

export interface WebhookOutboxRecord {
  id: string;
  tenantId: string;
  eventType: WebhookEventType;
  payload: Record<string, unknown>;
  status: WebhookStatus;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
}

export interface StreakStateDTO {
  ruleSlug: string;
  externalUserId: string;
  timezone: string;
  status: StreakStatus;
  currentStreak: number;
  highestStreak: number;
  todayProgress: {
    current: number;
    target: number;
    completed: boolean;
  };
  freezes: {
    available: number;
    max: number;
    autoConsume: boolean;
  };
  timing: {
    currentLogicalDate: string;
    windowExpiresAtUtc: string | null;
    secondsUntilExpiry: number;
    isExemptToday: boolean;
  };
  milestone: {
    justReached: number | null;
    nextMilestone: number | null;
    daysToNextMilestone: number;
  };
  historyLast14Days: Array<{
    date: string;
    state: DayHistoryState;
  }>;
}
