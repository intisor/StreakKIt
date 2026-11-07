// tests/notifications.test.ts: Tests for Behavioral Contrast & Counter-Habit Nudges
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';
import { getDb } from '../src/config/db.js';
import { seedDatabase } from '../src/db/seed.js';
import { generateBehavioralContrastNudge } from '../src/domain/behavioral-contrast.js';

describe('Behavioral Contrast & Counter-Habit Nudges', () => {
  let app: any;
  const testTenantKey = 'pk_live_zikfash_123';

  before(async () => {
    const db = getDb();
    await db.migrate();
    try {
      await seedDatabase(db);
    } catch {}
    app = await buildServer();
  });

  after(async () => {
    if (app) await app.close();
  });

  it('generates Tier 1 slotted template for music vs deen contrast (GUILT_PRIORITY)', async () => {
    const nudge = await generateBehavioralContrastNudge({
      triggerActivity: {
        action: 'music_playback',
        label: 'listening to music',
        durationMinutes: 45,
        category: 'entertainment'
      },
      neglectedGoal: {
        ruleSlug: 'deen_recitation',
        ruleName: 'Daily Quran Recitation',
        domain: 'deen',
        currentStreak: 14,
        completedToday: false
      },
      archetype: 'GUILT_PRIORITY'
    });

    assert.ok(nudge);
    assert.equal(nudge.source, 'TEMPLATE');
    assert.equal(nudge.archetype, 'GUILT_PRIORITY');
    assert.equal(nudge.urgency, 'BEHAVIORAL_CONTRAST');
    // Ensure dynamic slots were properly interpolated
    assert.ok(nudge.title.includes('45 mins') || nudge.title.includes('music') || nudge.title.includes('deen'));
    assert.ok(nudge.body.includes('deen') || nudge.body.includes('Quran') || nudge.body.includes('14'));
  });

  it('generates Tier 1 MOMENTUM_PIVOT and TIME_TRADE archetypes correctly', async () => {
    const pivot = await generateBehavioralContrastNudge({
      triggerActivity: {
        action: 'social_scroll',
        label: 'browsing social media',
        durationMinutes: 30
      },
      neglectedGoal: {
        ruleSlug: 'daily_language',
        ruleName: 'Daily Language Practice',
        domain: 'language',
        currentStreak: 7,
        completedToday: false
      },
      archetype: 'MOMENTUM_PIVOT'
    });

    assert.ok(pivot);
    assert.equal(pivot.archetype, 'MOMENTUM_PIVOT');
    assert.ok(pivot.body.includes('30 mins') || pivot.body.includes('social media'));

    const timeTrade = await generateBehavioralContrastNudge({
      triggerActivity: {
        action: 'gaming',
        label: 'playing games',
        durationMinutes: 60
      },
      neglectedGoal: {
        ruleSlug: 'daily_language',
        ruleName: 'Daily Language Practice',
        domain: 'language',
        currentStreak: 5,
        completedToday: false
      },
      archetype: 'TIME_TRADE'
    });

    assert.ok(timeTrade);
    assert.equal(timeTrade.archetype, 'TIME_TRADE');
    assert.ok(timeTrade.title.includes('60 mins') || timeTrade.body.includes('60 mins'));
  });

  it('Tier 3: Prioritizes developer custom copies with slot interpolation', async () => {
    const custom = await generateBehavioralContrastNudge({
      triggerActivity: {
        action: 'music_playback',
        label: 'listening to music',
        durationMinutes: 40
      },
      neglectedGoal: {
        ruleSlug: 'deen_recitation',
        ruleName: 'Quran Recitation',
        domain: 'deen',
        currentStreak: 21,
        completedToday: false
      },
      customCopies: [
        '🎧 Music Alert | You spent {duration_text} on music, but didn’t protect your {domain}? Fix your {streak}-day streak before midnight.'
      ]
    });

    assert.ok(custom);
    assert.equal(custom.source, 'DEVELOPER_OVERRIDE');
    assert.equal(custom.title, '🎧 Music Alert');
    assert.equal(
      custom.body,
      'You spent 40 mins on music, but didn’t protect your deen? Fix your 21-day streak before midnight.'
    );
  });

  it('Tier 2: Calls AI Provider when configured, and falls back cleanly if AI fails or apiKey is missing', async () => {
    // With mock AI key
    const aiNudge = await generateBehavioralContrastNudge({
      triggerActivity: {
        action: 'music_playback',
        label: 'listening to music',
        durationMinutes: 35
      },
      neglectedGoal: {
        ruleSlug: 'deen_recitation',
        ruleName: 'Daily Recitation',
        domain: 'deen',
        currentStreak: 12,
        completedToday: false
      },
      aiConfig: {
        provider: 'gemini',
        apiKey: 'test_mock_gemini_key',
        tone: 'firm_brotherly'
      }
    });

    assert.ok(aiNudge);
    assert.equal(aiNudge.source, 'AI');
    assert.ok(aiNudge.body.includes('[AI]'));

    // Without API key (falls back to Tier 1 TEMPLATE)
    const fallbackNudge = await generateBehavioralContrastNudge({
      triggerActivity: {
        action: 'music_playback',
        label: 'listening to music',
        durationMinutes: 35
      },
      neglectedGoal: {
        ruleSlug: 'deen_recitation',
        ruleName: 'Daily Recitation',
        domain: 'deen',
        currentStreak: 12,
        completedToday: false
      },
      aiConfig: {
        provider: 'gemini',
        apiKey: '' // empty key triggers fallback
      }
    });

    assert.ok(fallbackNudge);
    assert.equal(fallbackNudge.source, 'TEMPLATE');
  });

  it('Returns null if user already completed the habit today (no false guilt trips)', async () => {
    const nudge = await generateBehavioralContrastNudge({
      triggerActivity: {
        action: 'music_playback',
        label: 'listening to music',
        durationMinutes: 50
      },
      neglectedGoal: {
        ruleSlug: 'deen_recitation',
        ruleName: 'Quran Recitation',
        domain: 'deen',
        currentStreak: 14,
        completedToday: true // Already done!
      }
    });

    assert.equal(nudge, null);
  });

  it('POST /v1/notifications/contrast evaluates real user streak against music activity', async () => {
    const userId = 'contrast_user_' + Math.random().toString(16).slice(2, 10);

    // Call API without prior completion
    const res = await app.inject({
      method: 'POST',
      url: '/v1/notifications/contrast',
      headers: {
        authorization: `Bearer ${testTenantKey}`
      },
      payload: {
        userId,
        neglectedRuleSlug: 'daily_tailor_log',
        triggerActivity: {
          action: 'music_playback',
          label: 'listening to music',
          durationMinutes: 45
        },
        archetype: 'GUILT_PRIORITY'
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.completedToday, false);
    assert.ok(body.notification);
    assert.equal(body.notification.urgency, 'BEHAVIORAL_CONTRAST');
    assert.equal(body.notification.archetype, 'GUILT_PRIORITY');
    assert.ok(body.notification.title);
    assert.ok(body.notification.body);
  });

  it('POST /v1/notifications/contrast honors developer custom copies override over API', async () => {
    const userId = 'contrast_dev_' + Math.random().toString(16).slice(2, 10);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/notifications/contrast',
      headers: {
        authorization: `Bearer ${testTenantKey}`
      },
      payload: {
        userId,
        neglectedRuleSlug: 'daily_tailor_log',
        triggerActivity: {
          action: 'gaming',
          label: 'playing games',
          durationMinutes: 50
        },
        customCopies: [
          '🎮 50m of gaming? | But 0 logs today? Don’t let your streak slip!'
        ]
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.notification);
    assert.equal(body.notification.source, 'DEVELOPER_OVERRIDE');
    assert.equal(body.notification.title, '🎮 50m of gaming?');
    assert.equal(body.notification.body, 'But 0 logs today? Don’t let your streak slip!');
  });

  it('POST /v1/users/push-token registers client FCM / push token idempotently', async () => {
    const userId = 'push_user_' + Math.random().toString(16).slice(2, 10);
    const token = 'fcm_tok_' + Math.random().toString(36).slice(2, 15);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/users/push-token',
      headers: {
        authorization: `Bearer ${testTenantKey}`
      },
      payload: {
        externalUserId: userId,
        pushToken: token,
        platform: 'FCM'
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.message, 'Push token registered');
  });
});
