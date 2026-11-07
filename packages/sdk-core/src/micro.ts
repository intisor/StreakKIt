// packages/sdk-core/src/micro.ts: Universal Zero-Friction Micro-Client for Any Framework
export interface StreakAnimationConfig {
  preset?: 'flame' | 'confetti' | 'frost' | 'fireworks' | 'zen';
  primaryColor?: string;     // Hex e.g. '#22c55e', '#8b5cf6', '#ec4899'
  secondaryColor?: string;   // Hex e.g. '#10b981'
  glowColor?: string;        // CSS color e.g. 'rgba(34, 197, 94, 0.7)'
  speed?: number;            // 0.5 to 3.0 playback & particle speed
  particleCount?: number;    // Number of active particles (e.g. 20 - 150)
  particleColors?: string[]; // Array of hex colors for particles
  behavior?: 'ember' | 'confetti' | 'fountain' | 'float';
  durationMs?: number;       // Duration for celebration in ms
  loop?: boolean;            // Whether animation loops or plays once
  customUrl?: string;        // Optional custom Lottie JSON URL
}

export interface StreakRuleConfig {
  slug: string;
  name?: string;
  target?: number;
  cadence?: 'DAILY' | 'EXEMPT_DAYS' | 'WEEKLY_QUOTA' | string;
  gracePeriodMinutes?: number;
  maxFreezes?: number;
  daysOff?: number[];
  freezeAutoEarnDays?: number;
  restoreWindowDays?: number;
  notificationTone?: 'UNHINGED' | 'CONSCIOUS' | 'GENTLE';
}

export interface MicroPingOptions {
  endpoint?: string;
  publicKey: string;
  ruleSlug: string;
  userId: string;
  value?: number;
  timezone?: string;
  ruleConfig?: StreakRuleConfig;
}

export interface StreakKitInitOptions {
  endpoint?: string;
  publicKey: string;
  userId: string;
  rules?: StreakRuleConfig[];
  rulesJson?: string;
}

/**
 * Universal Zero-Friction StreakKit Client
 * Works identically in Node.js, Next.js, React, Vue, Svelte, React Native, Bun, Deno, or vanilla JS.
 */
export class StreakKitClient {
  private endpoint: string;
  private publicKey: string;
  private userId: string;
  private configuredRules = new Map<string, StreakRuleConfig>();

  constructor(options: StreakKitInitOptions) {
    this.endpoint = (options.endpoint || 'http://localhost:3000').replace(/\/+$/, '');
    this.publicKey = options.publicKey;
    this.userId = options.userId;

    if (options.rules) {
      for (const r of options.rules) {
        this.configuredRules.set(r.slug, r);
      }
    }

    if (options.rulesJson) {
      try {
        const parsed = JSON.parse(options.rulesJson);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        for (const r of arr) {
          if (r.slug) this.configuredRules.set(r.slug, r);
        }
      } catch (_) {}
    }
  }

  /**
   * 1-liner ping: Ingests activity, auto-provisions rule if missing, updates streak
   */
  async ping(ruleSlug: string, value: number = 1) {
    const rule = this.configuredRules.get(ruleSlug);
    const timezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

    const res = await fetch(`${this.endpoint}/v1/ping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.publicKey}`
      },
      body: JSON.stringify({
        ruleSlug,
        externalUserId: this.userId,
        value,
        timezone,
        ruleConfig: rule
      })
    });
    return res.json();
  }

  /**
   * Trophy Moat 1: Resurrects a broken streak within the 90-day restore window
   */
  async restore(ruleSlug: string) {
    const res = await fetch(`${this.endpoint}/v1/streak/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.publicKey}`
      },
      body: JSON.stringify({
        ruleSlug,
        externalUserId: this.userId
      })
    });
    return res.json();
  }

  /**
   * Trophy Moat 2: Schedule vacation / sick pause
   */
  async pause(ruleSlug: string, startDate: string, endDate: string) {
    const res = await fetch(`${this.endpoint}/v1/streak/pause`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.publicKey}`
      },
      body: JSON.stringify({
        ruleSlug,
        externalUserId: this.userId,
        startDate,
        endDate
      })
    });
    return res.json();
  }

  /**
   * Trophy Moat 3: Batch query ranked friends streaks
   */
  async getFriendsStreak(ruleSlug: string, userIds: string[]) {
    const res = await fetch(`${this.endpoint}/v1/streak/friends`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.publicKey}`
      },
      body: JSON.stringify({
        ruleSlug,
        userIds
      })
    });
    return res.json();
  }

  /**
   * Trophy Moat 4: Spotify-style "Wrapped" Year-in-Review
   */
  async getWrapped(ruleSlug: string, year: number = new Date().getFullYear()) {
    const res = await fetch(
      `${this.endpoint}/v1/streak/wrapped?ruleSlug=${encodeURIComponent(ruleSlug)}&externalUserId=${encodeURIComponent(this.userId)}&year=${year}`,
      {
        headers: { Authorization: `Bearer ${this.publicKey}` }
      }
    );
    return res.json();
  }

  /**
   * Trophy Moat 5: Per-user custom daily targets and rest days
   */
  async setUserPreferences(ruleSlug: string, customTarget?: number, daysOff?: number[]) {
    const res = await fetch(`${this.endpoint}/v1/streak/preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.publicKey}`
      },
      body: JSON.stringify({
        ruleSlug,
        externalUserId: this.userId,
        customTarget,
        daysOffOverride: daysOff
      })
    });
    return res.json();
  }

  /**
   * Fetches deterministic Duolingo-style monthly calendar data (days 1..31, completed, frozen, missed, active, perfect weeks)
   */
  async getCalendar(ruleSlug: string, year?: number, month?: number, timezone?: string) {
    const tz = timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
    let url = `${this.endpoint}/v1/streaks/${encodeURIComponent(ruleSlug)}/${encodeURIComponent(this.userId)}/calendar?timezone=${encodeURIComponent(tz)}`;
    if (year) url += `&year=${year}`;
    if (month) url += `&month=${month}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.publicKey}` }
    });
    return res.json();
  }

  /**
   * Mounts the hardware-accelerated universal animated Lottie modal with customizable color, behavior, and timing
   */
  showModal(
    ruleSlug: string,
    options?: string | { customAnimationUrl?: string; animation?: StreakAnimationConfig }
  ) {
    if (typeof document === 'undefined') return;

    let url = `${this.endpoint}/v1/embed/${encodeURIComponent(ruleSlug)}/${encodeURIComponent(this.userId)}`;
    
    if (typeof options === 'string') {
      url += `?animationUrl=${encodeURIComponent(options)}`;
    } else if (options) {
      const params = new URLSearchParams();
      if (options.customAnimationUrl) {
        params.set('animationUrl', options.customAnimationUrl);
      }
      if (options.animation) {
        params.set('animConfig', JSON.stringify(options.animation));
        if (options.animation.primaryColor) params.set('primaryColor', options.animation.primaryColor);
        if (options.animation.speed) params.set('speed', String(options.animation.speed));
        if (options.animation.preset) params.set('preset', options.animation.preset);
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;border:none;z-index:999999;background:rgba(15,23,42,0.85);backdrop-filter:blur(4px);';

    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'STREAKKIT_CLOSE') {
        iframe.remove();
        window.removeEventListener('message', handler);
      }
    };
    window.addEventListener('message', handler);
    document.body.appendChild(iframe);
  }
}

export async function syncRules(endpoint: string, publicKey: string, rules: StreakRuleConfig[]) {
  const ep = (endpoint || 'http://localhost:3000').replace(/\/+$/, '');
  const res = await fetch(`${ep}/v1/rules/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${publicKey}`
    },
    body: JSON.stringify({ rules })
  });
  return res.json();
}

export async function pingStreak(options: MicroPingOptions) {
  const client = new StreakKitClient({
    endpoint: options.endpoint,
    publicKey: options.publicKey,
    userId: options.userId,
    rules: options.ruleConfig ? [options.ruleConfig] : []
  });
  return client.ping(options.ruleSlug, options.value);
}

export function openStreakModal(options: {
  endpoint?: string;
  ruleSlug: string;
  userId: string;
  customAnimationUrl?: string;
  animation?: StreakAnimationConfig;
}) {
  const client = new StreakKitClient({
    endpoint: options.endpoint,
    publicKey: 'public',
    userId: options.userId
  });
  client.showModal(options.ruleSlug, {
    customAnimationUrl: options.customAnimationUrl,
    animation: options.animation
  });
}
