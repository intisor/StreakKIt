// tests/notifications.unit.test.ts: Unit tests for Scary & Psychological Notifications
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateNotificationCopy,
  getStreakLostRepairCopy
} from '../src/domain/notifications.js';

describe('Scary Streak Notification Engine', () => {
  it('returns null if user has already completed goal today', () => {
    const copy = evaluateNotificationCopy({
      ruleName: 'Daily Quran',
      currentStreak: 15,
      secondsUntilExpiry: 3600, // 1 hour left
      completedToday: true,
      freezesAvailable: 2
    });
    assert.equal(copy, null);
  });

  it('triggers NUDGE_4H copy between 2 and 4.5 hours left', () => {
    const copy = evaluateNotificationCopy({
      ruleName: 'Hujjify Listening',
      currentStreak: 21,
      secondsUntilExpiry: 3.5 * 3600, // 3.5 hours left
      completedToday: false,
      freezesAvailable: 1,
      tone: 'UNHINGED'
    });
    assert.ok(copy);
    assert.equal(copy?.urgency, 'NUDGE_4H');
    assert.ok(copy?.title.includes('Duo'));
    assert.ok(copy?.body.includes('21 days'));
  });

  it('triggers URGENT_2H cardiac arrest copy when under 2 hours remain', () => {
    const copy = evaluateNotificationCopy({
      ruleName: 'Workout Streak',
      currentStreak: 45,
      secondsUntilExpiry: 5400, // 1.5 hours left
      completedToday: false,
      freezesAvailable: 0,
      tone: 'UNHINGED'
    });
    assert.ok(copy);
    assert.equal(copy?.urgency, 'URGENT_2H');
    assert.ok(copy?.title.includes('CARDIAC ARREST'));
    assert.ok(copy?.body.includes('NO FREEZES LEFT'));
  });

  it('triggers PANIC_30M code red copy when under 30 minutes remain', () => {
    const copy = evaluateNotificationCopy({
      ruleName: 'Coding Habit',
      currentStreak: 100,
      secondsUntilExpiry: 1200, // 20 minutes left
      completedToday: false,
      freezesAvailable: 1,
      tone: 'UNHINGED'
    });
    assert.ok(copy);
    assert.equal(copy?.urgency, 'PANIC_30M');
    assert.ok(copy?.title.includes('CODE RED'));
    assert.ok(copy?.body.includes('Don\'t be that guy'));
  });

  it('generates loss aversion streak resurrection copy when streak dies', () => {
    const copy = getStreakLostRepairCopy(30, 'Daily Audio', 'UNHINGED');
    assert.equal(copy.urgency, 'STREAK_LOST_REPAIR');
    assert.ok(copy.title.includes('Flatline'));
    assert.ok(copy.body.includes('24 hours to resurrect'));
  });

  it('supports CONSCIOUS tone for respectful mindful apps', () => {
    const copy = evaluateNotificationCopy({
      ruleName: 'Conscious Dhikr',
      currentStreak: 10,
      secondsUntilExpiry: 5400,
      completedToday: false,
      freezesAvailable: 2,
      tone: 'CONSCIOUS'
    });
    assert.ok(copy);
    assert.ok(copy?.title.includes('2 Hours Left'));
    assert.ok(copy?.body.includes('conscious habit'));
  });
});
