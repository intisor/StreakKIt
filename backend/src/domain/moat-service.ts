// domain/moat-service.ts: Service layer for Trophy-grade streak features
// Provides isolated operations for:
// 1. Vacation Pauses (create, delete, list)
// 2. Streak Restoration / Repair
// 3. Friends / Batch Streak rankings
// 4. Wrapped / Year-in-Review activity summary
// 5. Per-User Preferences

import crypto from 'node:crypto';
import type { DbAdapter } from '../config/db.js';
import {
  evaluateRestoreEligibility,
  type VacationPauseRange
} from './features.js';

export interface CreatePauseInput {
  tenantId: string;
  ruleSlug: string;
  externalUserId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface UserPreferencesInput {
  tenantId: string;
  ruleSlug: string;
  externalUserId: string;
  customTarget?: number | null;
  daysOffOverride?: number[] | null;
  enabled?: boolean;
}

export interface BatchStreakUserItem {
  userId: string;
  currentStreak: number;
  highestStreak: number;
  extendedToday: boolean;
}

export interface WrappedSummary {
  userId: string;
  year: number;
  daysActive: number;
  longestStreak: number;
  totalEventsLogged: number;
  mostActiveDay: { date: string; count: number } | null;
  percentile: number;
}

export class MoatService {
  constructor(private db: DbAdapter) {}

  /**
   * Schedules a vacation pause for a user over a date range.
   */
  async createPause(input: CreatePauseInput): Promise<{ id: string; startDate: string; endDate: string }> {
    const rule = await this.db.get<any>(
      `SELECT id FROM streak_rules WHERE tenant_id = $1 AND slug = $2`,
      [input.tenantId, input.ruleSlug]
    );
    if (!rule) {
      throw new Error(`Rule ${input.ruleSlug} not found for tenant`);
    }

    if (input.endDate < input.startDate) {
      throw new Error(`endDate must be on or after startDate`);
    }

    const id = crypto.randomUUID();
    await this.db.execute(
      `INSERT INTO streak_pauses (id, tenant_id, rule_id, external_user_id, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, input.tenantId, rule.id, input.externalUserId, input.startDate, input.endDate]
    );

    return { id, startDate: input.startDate, endDate: input.endDate };
  }

  /**
   * Retrieves active or upcoming vacation pauses for a user.
   */
  async getPauses(tenantId: string, ruleSlug: string, externalUserId: string): Promise<VacationPauseRange[]> {
    const rows = await this.db.query<{ start_date: string; end_date: string }>(
      `SELECT sp.start_date, sp.end_date
       FROM streak_pauses sp
       JOIN streak_rules sr ON sr.id = sp.rule_id
       WHERE sp.tenant_id = $1 AND sr.slug = $2 AND sp.external_user_id = $3
       ORDER BY sp.start_date ASC`,
      [tenantId, ruleSlug, externalUserId]
    );

    return rows.map(r => ({ startDate: r.start_date, endDate: r.end_date }));
  }

  /**
   * Deletes a vacation pause by ID.
   */
  async deletePause(tenantId: string, pauseId: string): Promise<boolean> {
    const res = await this.db.execute(
      `DELETE FROM streak_pauses WHERE id = $1 AND tenant_id = $2`,
      [pauseId, tenantId]
    );
    return res.rowCount > 0;
  }

  /**
   * Restores a broken streak if within the restore window (e.g. 90 days).
   */
  async restoreStreak(
    tenantId: string,
    ruleSlug: string,
    externalUserId: string,
    currentDate: string
  ): Promise<{ restored: boolean; restoredStreakLength: number; reason: string }> {
    const userStreak = await this.db.get<any>(
      `SELECT us.*, sr.restore_window_days
       FROM user_streaks us
       JOIN streak_rules sr ON sr.id = us.rule_id
       WHERE us.tenant_id = $1 AND sr.slug = $2 AND us.external_user_id = $3`,
      [tenantId, ruleSlug, externalUserId]
    );

    if (!userStreak) {
      return { restored: false, restoredStreakLength: 0, reason: 'USER_STREAK_NOT_FOUND' };
    }

    const restoreWindowDays = userStreak.restore_window_days ?? 90;
    const lastBreak = userStreak.last_broken_streak_length > 0
      ? { brokenAtDate: userStreak.last_broken_date || currentDate, achievedLength: userStreak.last_broken_streak_length }
      : null;

    const evalResult = evaluateRestoreEligibility(
      currentDate,
      userStreak.current_streak,
      lastBreak,
      restoreWindowDays
    );

    if (!evalResult.eligible) {
      return { restored: false, restoredStreakLength: 0, reason: evalResult.reason || 'NOT_ELIGIBLE' };
    }

    // Restore streak in DB
    await this.db.execute(
      `UPDATE user_streaks
       SET current_streak = $1,
           last_broken_streak_length = 0,
           last_broken_date = NULL,
           updated_at = datetime('now')
       WHERE id = $2`,
      [evalResult.restorableStreakLength, userStreak.id]
    );

    return {
      restored: true,
      restoredStreakLength: evalResult.restorableStreakLength,
      reason: 'OK'
    };
  }

  /**
   * Retrieves streak states for an array of friend user IDs, sorted by longest streak.
   */
  async getBatchStreaks(
    tenantId: string,
    ruleSlug: string,
    userIds: string[],
    currentDate: string
  ): Promise<BatchStreakUserItem[]> {
    if (userIds.length === 0) return [];

    const rule = await this.db.get<any>(
      `SELECT id FROM streak_rules WHERE tenant_id = $1 AND slug = $2`,
      [tenantId, ruleSlug]
    );
    if (!rule) return [];

    // Query all matching user_streaks
    const placeholders = userIds.map(() => '?').join(',');
    const rows = await this.db.query<any>(
      `SELECT external_user_id, current_streak, highest_streak, last_completed_logical_date
       FROM user_streaks
       WHERE tenant_id = ? AND rule_id = ? AND external_user_id IN (${placeholders})`,
      [tenantId, rule.id, ...userIds]
    );

    const rowMap = new Map<string, any>();
    for (const row of rows) {
      rowMap.set(row.external_user_id, row);
    }

    const results: BatchStreakUserItem[] = userIds.map(uid => {
      const match = rowMap.get(uid);
      if (!match) {
        return {
          userId: uid,
          currentStreak: 0,
          highestStreak: 0,
          extendedToday: false
        };
      }
      return {
        userId: uid,
        currentStreak: match.current_streak,
        highestStreak: match.highest_streak,
        extendedToday: match.last_completed_logical_date === currentDate
      };
    });

    // Sort descending by currentStreak, then highestStreak
    results.sort((a, b) => b.currentStreak - a.currentStreak || b.highestStreak - a.highestStreak);
    return results;
  }

  /**
   * Generates a Spotify-style "Wrapped / Year in Review" synthesis.
   */
  async getWrapped(
    tenantId: string,
    ruleSlug: string,
    externalUserId: string,
    year: number
  ): Promise<WrappedSummary> {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const rule = await this.db.get<any>(
      `SELECT id FROM streak_rules WHERE tenant_id = $1 AND slug = $2`,
      [tenantId, ruleSlug]
    );
    if (!rule) {
      throw new Error(`Rule ${ruleSlug} not found`);
    }

    const userStreak = await this.db.get<any>(
      `SELECT highest_streak FROM user_streaks
       WHERE tenant_id = $1 AND rule_id = $2 AND external_user_id = $3`,
      [tenantId, rule.id, externalUserId]
    );

    // Aggregate active days & events from streak_events
    const eventStats = await this.db.query<{ logical_local_date: string; total_events: number }>(
      `SELECT logical_local_date, COUNT(*) as total_events
       FROM streak_events
       WHERE tenant_id = $1 AND rule_id = $2 AND external_user_id = $3
         AND logical_local_date >= $4 AND logical_local_date <= $5
       GROUP BY logical_local_date
       ORDER BY total_events DESC`,
      [tenantId, rule.id, externalUserId, startDate, endDate]
    );

    const daysActive = eventStats.length;
    let totalEventsLogged = 0;
    for (const day of eventStats) {
      totalEventsLogged += Number(day.total_events);
    }

    const mostActiveDay = eventStats.length > 0
      ? { date: eventStats[0].logical_local_date, count: Number(eventStats[0].total_events) }
      : null;

    // Percentile calculation across all users in tenant for that year
    const tenantUserStats = await this.db.query<{ external_user_id: string; total_events: number }>(
      `SELECT external_user_id, COUNT(*) as total_events
       FROM streak_events
       WHERE tenant_id = $1 AND rule_id = $2
         AND logical_local_date >= $3 AND logical_local_date <= $4
       GROUP BY external_user_id
       ORDER BY total_events ASC`,
      [tenantId, rule.id, startDate, endDate]
    );

    let percentile = 99; // Default if top
    if (tenantUserStats.length > 1) {
      const rank = tenantUserStats.findIndex(u => u.external_user_id === externalUserId);
      if (rank !== -1) {
        percentile = Math.max(1, Math.round(((tenantUserStats.length - rank) / tenantUserStats.length) * 100));
      }
    }

    return {
      userId: externalUserId,
      year,
      daysActive,
      longestStreak: userStreak?.highest_streak ?? 0,
      totalEventsLogged,
      mostActiveDay,
      percentile
    };
  }

  /**
   * Upserts per-user preferences (custom goal and rest days).
   */
  async setPreferences(input: UserPreferencesInput): Promise<void> {
    const rule = await this.db.get<any>(
      `SELECT id FROM streak_rules WHERE tenant_id = $1 AND slug = $2`,
      [input.tenantId, input.ruleSlug]
    );
    if (!rule) throw new Error(`Rule ${input.ruleSlug} not found`);

    const daysOffJson = input.daysOffOverride ? JSON.stringify(input.daysOffOverride) : null;
    const enabledInt = input.enabled !== false ? 1 : 0;

    await this.db.execute(
      `INSERT INTO user_preferences (id, tenant_id, rule_id, external_user_id, custom_target, days_off_override, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(rule_id, external_user_id) DO UPDATE SET
         custom_target = excluded.custom_target,
         days_off_override = excluded.days_off_override,
         enabled = excluded.enabled,
         updated_at = datetime('now')`,
      [
        crypto.randomUUID(),
        input.tenantId,
        rule.id,
        input.externalUserId,
        input.customTarget ?? null,
        daysOffJson,
        enabledInt
      ]
    );
  }
}
