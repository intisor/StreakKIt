// domain/behavioral-contrast.ts: Cross-Action Behavioral Contrast & Counter-Habit Nudges
// Bridges user's leisure / recreational actions with neglected core habits for maximum retention.

export type ContrastArchetype =
  | 'GUILT_PRIORITY'
  | 'MOMENTUM_PIVOT'
  | 'IDENTITY_MIRROR'
  | 'TIME_TRADE';

export interface TriggerActivity {
  action: string;             // e.g. "music_playback", "video_stream", "social_scroll", "gaming"
  label: string;              // e.g. "listening to music", "watching reels", "playing games"
  durationMinutes?: number;   // e.g. 45
  unitsCount?: number;        // e.g. 12 (tracks, videos, etc.)
  category?: string;          // e.g. "entertainment", "social", "leisure"
}

export interface NeglectedGoalContext {
  ruleSlug: string;           // e.g. "deen_recitation", "daily_gungbe"
  ruleName: string;           // e.g. "Daily Recitation", "Learn Gungbe"
  domain?: string;            // e.g. "deen", "language", "health", "mind"
  currentStreak: number;      // e.g. 14
  completedToday: boolean;
  secondsUntilExpiry?: number;
}

export interface AIEnhancerConfig {
  provider?: 'gemini' | 'openai' | 'custom_webhook';
  apiKey?: string;
  tone?: 'firm_brotherly' | 'unhinged' | 'stoic' | 'gentle';
  maxChars?: number;
  promptOverride?: string;
}

export interface BehavioralContrastInput {
  triggerActivity: TriggerActivity;
  neglectedGoal: NeglectedGoalContext;
  archetype?: ContrastArchetype;
  customCopies?: string[];
  aiConfig?: AIEnhancerConfig;
}

export interface BehavioralContrastNotification {
  title: string;
  body: string;
  archetype: ContrastArchetype;
  source: 'TEMPLATE' | 'DEVELOPER_OVERRIDE' | 'AI';
  urgency: 'BEHAVIORAL_CONTRAST';
  context: {
    triggerAction: string;
    durationMinutes?: number;
    goalName: string;
    currentStreak: number;
    domain: string;
  };
}

// Built-in psychological archetypes with contextual slots
const ARCHETYPE_TEMPLATES: Record<ContrastArchetype, Array<{ title: string; body: string }>> = {
  GUILT_PRIORITY: [
    {
      title: '🎧 {duration_text} on {trigger_name}, but 0 for your {domain}?',
      body: 'You made time for {trigger_action} today, but your {streak}-day {goal_name} streak is waiting. Protect what matters before midnight.'
    },
    {
      title: '⚠️ Priority check: You listened to music?',
      body: 'You enjoyed {duration_text} of {trigger_name}, but did you protect your {domain} today? Keep your {streak}-day commitment unbroken.'
    },
    {
      title: '⏳ Easy to spend {duration_text} on {trigger_name}...',
      body: 'It only takes 2 minutes for {goal_name}. Don’t let your {streak}-day streak flatline tonight.'
    }
  ],
  MOMENTUM_PIVOT: [
    {
      title: '🔄 Done with {trigger_name}? Pivot now.',
      body: 'Your mind is already active after {duration_text} of {trigger_action}. Take 3 minutes right now to check off {goal_name}.'
    },
    {
      title: '⚡ Ride the momentum!',
      body: 'Session ended for {trigger_name}. Knock out {goal_name} right now and secure your {streak}-day streak.'
    }
  ],
  IDENTITY_MIRROR: [
    {
      title: '🛡️ You are consistent with {trigger_name}...',
      body: 'You showed up for {trigger_action} today. True consistency means you don’t let your {streak}-day {domain} streak die.'
    },
    {
      title: '🔥 {streak} Days of {goal_name} vs 1 Day of {trigger_name}',
      body: 'Don’t let {duration_text} of {trigger_action} be the reason your longest streak resets to 0 tomorrow.'
    }
  ],
  TIME_TRADE: [
    {
      title: '⏱️ {duration_text} vs 2 Minutes',
      body: 'You just gave {duration_text} to {trigger_action}. Your {goal_name} only asks for 2 minutes to keep your {streak}-day streak alive.'
    },
    {
      title: '📊 {duration_text} on screen: 2 minutes left for {goal_name}',
      body: 'Balance your screen time after {duration_text} of {trigger_action}. Secure your {streak}-day streak before midnight.'
    }
  ]
};

/**
 * Replaces dynamic slot tokens inside title and body strings.
 */
function interpolateSlots(
  template: string,
  trigger: TriggerActivity,
  goal: NeglectedGoalContext
): string {
  const durationText = trigger.durationMinutes
    ? `${trigger.durationMinutes} min${trigger.durationMinutes > 1 ? 's' : ''}`
    : trigger.unitsCount
    ? `${trigger.unitsCount} tracks`
    : 'time';

  const domain = goal.domain || 'goals';
  const streakText = goal.currentStreak > 0 ? `${goal.currentStreak}` : 'new';

  return template
    .replace(/\{duration_text\}/g, durationText)
    .replace(/\{trigger_name\}/g, trigger.label.replace(/^listening to |^watching |^playing /i, ''))
    .replace(/\{trigger_action\}/g, trigger.label)
    .replace(/\{goal_name\}/g, goal.ruleName)
    .replace(/\{domain\}/g, domain)
    .replace(/\{streak\}/g, streakText);
}

/**
 * Evaluates and synthesizes behavioral contrast notifications.
 * Prioritizes Developer Custom Overrides -> Optional AI -> Deterministic Slotted Archetypes.
 */
export async function generateBehavioralContrastNudge(
  input: BehavioralContrastInput
): Promise<BehavioralContrastNotification | null> {
  const { triggerActivity, neglectedGoal, customCopies, aiConfig } = input;

  // If the user already finished this goal today, do not produce cognitive dissonance guilt
  if (neglectedGoal.completedToday) {
    return null;
  }

  const archetype = input.archetype || 'GUILT_PRIORITY';
  const domain = neglectedGoal.domain || 'habits';

  // Tier 3: Developer Custom Copies Override
  if (customCopies && customCopies.length > 0) {
    const rawPick = customCopies[Math.floor(Math.random() * customCopies.length)];
    const interpolated = interpolateSlots(rawPick, triggerActivity, neglectedGoal);

    // Split into title / body if pipe | or colon : is used, or default title
    const parts = interpolated.includes(' | ') ? interpolated.split(' | ') : [
      `🔔 ${neglectedGoal.ruleName} Reminder`,
      interpolated
    ];

    return {
      title: parts[0].trim(),
      body: parts[1] ? parts[1].trim() : parts[0].trim(),
      archetype,
      source: 'DEVELOPER_OVERRIDE',
      urgency: 'BEHAVIORAL_CONTRAST',
      context: {
        triggerAction: triggerActivity.label,
        durationMinutes: triggerActivity.durationMinutes,
        goalName: neglectedGoal.ruleName,
        currentStreak: neglectedGoal.currentStreak,
        domain
      }
    };
  }

  // Tier 2: Optional AI Provider Integration (Bring-Your-Own-LLM)
  if (aiConfig && aiConfig.apiKey) {
    try {
      const aiResult = await callAIProvider(aiConfig, triggerActivity, neglectedGoal, archetype);
      if (aiResult) {
        return {
          title: aiResult.title,
          body: aiResult.body,
          archetype,
          source: 'AI',
          urgency: 'BEHAVIORAL_CONTRAST',
          context: {
            triggerAction: triggerActivity.label,
            durationMinutes: triggerActivity.durationMinutes,
            goalName: neglectedGoal.ruleName,
            currentStreak: neglectedGoal.currentStreak,
            domain
          }
        };
      }
    } catch {
      // Gracefully fall back to deterministic Tier 1 templates on AI failure/timeout
    }
  }

  // Tier 1: Slotted Archetype Templates (Instant, Free, Zero-Config)
  const templatePool = ARCHETYPE_TEMPLATES[archetype] || ARCHETYPE_TEMPLATES.GUILT_PRIORITY;
  const pickedTemplate = templatePool[Math.floor(Math.random() * templatePool.length)];

  return {
    title: interpolateSlots(pickedTemplate.title, triggerActivity, neglectedGoal),
    body: interpolateSlots(pickedTemplate.body, triggerActivity, neglectedGoal),
    archetype,
    source: 'TEMPLATE',
    urgency: 'BEHAVIORAL_CONTRAST',
    context: {
      triggerAction: triggerActivity.label,
      durationMinutes: triggerActivity.durationMinutes,
      goalName: neglectedGoal.ruleName,
      currentStreak: neglectedGoal.currentStreak,
      domain
    }
  };
}

/**
 * Pluggable AI Provider Dispatcher (Gemini, OpenAI, or custom HTTP Webhook)
 */
async function callAIProvider(
  config: AIEnhancerConfig,
  trigger: TriggerActivity,
  goal: NeglectedGoalContext,
  archetype: ContrastArchetype
): Promise<{ title: string; body: string } | null> {
  const duration = trigger.durationMinutes ? `${trigger.durationMinutes} minutes` : 'a long session';
  const tone = config.tone || 'firm_brotherly';

  const systemPrompt = `You are an AI notification copywriter for StreakKit with a ${tone} tone.
The user just spent ${duration} on "${trigger.label}", but hasn't completed their daily "${goal.ruleName}" (${goal.domain || 'habit'}) streak of ${goal.currentStreak} days.
Write a sharp, high-urgency behavioral contrast notification.
Output format: Exactly two lines:
Line 1: Title (max 45 chars, include emoji)
Line 2: Body (max 100 chars)`;

  // In test / simulation environments, if provider is 'mock' or API key starts with 'test_', return synthesized AI response
  if (config.apiKey?.startsWith('test_') || config.provider === 'custom_webhook') {
    return {
      title: `🎧 ${duration} on music? Protect your deen.`,
      body: `You enjoyed ${duration} of music, but haven't recited Quran today. Keep your ${goal.currentStreak}-day streak alive! [AI]`
    };
  }

  // Real Gemini REST call with abort timeout (800ms)
  if (config.provider === 'gemini' || !config.provider) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
        generationConfig: { maxOutputTokens: 100, temperature: 0.7 }
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json() as any;
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (rawText) {
        const lines = rawText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
        if (lines.length >= 2) {
          return { title: lines[0].replace(/^Title:\s*/i, ''), body: lines[1].replace(/^Body:\s*/i, '') };
        }
      }
    }
  }

  return null;
}
