// packages/sdk-core/src/optimistic.ts: Client-side optimistic state calculator
export interface StreakStateDTO {
  ruleSlug: string;
  externalUserId: string;
  timezone: string;
  status: 'ACTIVE_TODAY' | 'PENDING_TODAY' | 'AT_RISK' | 'FROZEN' | 'BROKEN';
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
    state: 'COMPLETED' | 'FROZEN' | 'MISSED' | 'EXEMPT' | 'PENDING';
  }>;
}

export function computeOptimisticState(
  currentState: StreakStateDTO | null,
  ruleSlug: string,
  userId: string,
  timezone: string,
  value: number = 1
): StreakStateDTO {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  if (!currentState) {
    // Initial fallback if no cached state exists yet
    const completed = value >= 1;
    return {
      ruleSlug,
      externalUserId: userId,
      timezone,
      status: completed ? 'ACTIVE_TODAY' : 'PENDING_TODAY',
      currentStreak: completed ? 1 : 0,
      highestStreak: completed ? 1 : 0,
      todayProgress: {
        current: value,
        target: 1,
        completed
      },
      freezes: { available: 2, max: 2, autoConsume: true },
      timing: {
        currentLogicalDate: today,
        windowExpiresAtUtc: null,
        secondsUntilExpiry: 86400,
        isExemptToday: false
      },
      milestone: {
        justReached: completed ? 1 : null,
        nextMilestone: 3,
        daysToNextMilestone: completed ? 2 : 3
      },
      historyLast14Days: [{ date: today, state: completed ? 'COMPLETED' : 'PENDING' }]
    };
  }

  const prevProgress = currentState.todayProgress.current;
  const target = currentState.todayProgress.target;
  const newProgress = prevProgress + value;
  const isNowCompleted = newProgress >= target;
  const wasAlreadyCompleted = currentState.todayProgress.completed;

  let currentStreak = currentState.currentStreak;
  let highestStreak = currentState.highestStreak;
  let status = currentState.status;
  let justReached: number | null = null;

  if (isNowCompleted && !wasAlreadyCompleted) {
    currentStreak += 1;
    highestStreak = Math.max(highestStreak, currentStreak);
    status = 'ACTIVE_TODAY';

    const defaultMilestones = [3, 7, 14, 30, 50, 100, 365];
    if (defaultMilestones.includes(currentStreak)) {
      justReached = currentStreak;
    }
  }

  const history = [...currentState.historyLast14Days];
  const lastIndex = history.length - 1;
  if (lastIndex >= 0 && isNowCompleted) {
    history[lastIndex] = { ...history[lastIndex], state: 'COMPLETED' };
  }

  return {
    ...currentState,
    status,
    currentStreak,
    highestStreak,
    todayProgress: {
      current: newProgress,
      target,
      completed: isNowCompleted || wasAlreadyCompleted
    },
    milestone: {
      ...currentState.milestone,
      justReached: justReached ?? currentState.milestone.justReached
    },
    historyLast14Days: history
  };
}
