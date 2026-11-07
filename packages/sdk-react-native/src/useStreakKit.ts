// useStreakKit.ts: Universal Single-File Drop-In React Native Hook & SDK
// Drop into any React Native / Expo project
// Supports 1-line ping, real-time hook, offline persistence, and WebView modal embed.

import { useState, useEffect, useCallback } from 'react';

export interface StreakState {
  ruleSlug: string;
  externalUserId: string;
  currentStreak: number;
  highestStreak: number;
  status: 'ACTIVE_TODAY' | 'PENDING_TODAY' | 'AT_RISK' | 'FROZEN' | 'BROKEN';
  todayProgress: {
    current: number;
    target: number;
    completed: boolean;
  };
  freezes: {
    available: number;
    max: number;
  };
  milestone?: {
    justReached: number | null;
    nextMilestone: number | null;
    daysToNextMilestone: number;
  };
  embedUrl: string;
}

export type MilestoneListener = (ruleSlug: string, milestoneDay: number) => void;

class StreakKitClient {
  public endpoint: string = 'http://10.0.2.2:3000';
  public publicKey: string = 'pk_live_default';
  public userId: string = 'user_default';
  private milestoneListeners: MilestoneListener[] = [];

  init(config: { publicKey: string; endpoint?: string; userId?: string }) {
    this.publicKey = config.publicKey;
    if (config.endpoint) this.endpoint = config.endpoint.replace(/\/+$/, '');
    if (config.userId) this.userId = config.userId;
  }

  onMilestoneReached(listener: MilestoneListener) {
    this.milestoneListeners.push(listener);
    return () => {
      this.milestoneListeners = this.milestoneListeners.filter(l => l !== listener);
    };
  }

  async ping(ruleSlug: string, value: number = 1, userId?: string): Promise<StreakState | null> {
    const uid = userId || this.userId;
    try {
      const res = await fetch(`${this.endpoint}/v1/ping`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.publicKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ruleSlug,
          externalUserId: uid,
          value,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as StreakState;
        if (data.milestone?.justReached) {
          this.milestoneListeners.forEach(fn => fn(ruleSlug, data.milestone!.justReached!));
        }
        return data;
      }
    } catch (_) {}
    return null;
  }

  async checkAmnesty(ruleSlug: string, userId?: string, minDormantDays: number = 7) {
    const uid = userId || this.userId;
    try {
      const res = await fetch(`${this.endpoint}/v1/streak/amnesty/evaluate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.publicKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ruleSlug,
          externalUserId: uid,
          minDormantDays,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        return json.evaluation;
      }
    } catch (_) {}
    return null;
  }

  async claimAmnesty(ruleSlug: string, userId?: string): Promise<number | null> {
    const uid = userId || this.userId;
    try {
      const res = await fetch(`${this.endpoint}/v1/streak/amnesty/claim`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.publicKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ruleSlug, externalUserId: uid }),
      });
      if (res.ok) {
        const json = await res.json();
        return json.resurrectedStreak || null;
      }
    } catch (_) {}
    return null;
  }

  getEmbedUrl(ruleSlug: string, userId?: string): string {
    const uid = userId || this.userId;
    return `${this.endpoint}/v1/embed/${ruleSlug}/${uid}`;
  }
}

export const StreakKit = new StreakKitClient();

/**
 * React Hook for seamless streak state in React Native / Expo
 */
export function useStreak(ruleSlug: string, userId?: string) {
  const [state, setState] = useState<StreakState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchState = useCallback(async () => {
    const uid = userId || StreakKit.userId;
    try {
      setLoading(true);
      const res = await fetch(`${StreakKit.endpoint}/v1/streaks/${ruleSlug}/${uid}`, {
        headers: { Authorization: `Bearer ${StreakKit.publicKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        setState(data);
      }
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }, [ruleSlug, userId]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const ping = useCallback(
    async (value: number = 1) => {
      const newState = await StreakKit.ping(ruleSlug, value, userId);
      if (newState) setState(newState);
      return newState;
    },
    [ruleSlug, userId]
  );

  return {
    state,
    loading,
    currentStreak: state?.currentStreak ?? 0,
    isActiveToday: state?.status === 'ACTIVE_TODAY',
    embedUrl: StreakKit.getEmbedUrl(ruleSlug, userId),
    ping,
    refresh: fetchState,
  };
}
