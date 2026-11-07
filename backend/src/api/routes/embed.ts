// api/routes/embed.ts: Serves the Universal Embed Dopamine UI for any Web, Android, iOS, or Flutter app
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../../config/db.js';
import { StreakRule, UserStreak } from '../../domain/types.js';
import { evaluateStateOnRead } from '../../domain/evaluator.js';
import { computeLogicalDate } from '../../domain/time-window.js';
import {
  generateMonthCalendar,
  MonthCalendarDTO,
  StreakHistoryEntry,
  StreakPauseEntry
} from '../../domain/calendar.js';
import { getFlameEvolutionTier } from '../../domain/features.js';

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

function hexToHue(hex: string): number {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length !== 6) return 38; // Default amber
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  if (max === min) h = 0;
  else if (max === r) h = (60 * ((g - b) / (max - min)) + 360) % 360;
  else if (max === g) h = (60 * ((b - r) / (max - min)) + 120) % 360;
  else if (max === b) h = (60 * ((r - g) / (max - min)) + 240) % 360;
  return Math.round(h);
}

export async function registerEmbedRoutes(fastify: FastifyInstance) {
  // 1. Full HTML Dopamine Embed UI
  fastify.get(
    '/v1/embed/:ruleSlug/:externalUserId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { ruleSlug, externalUserId } = request.params as {
        ruleSlug: string;
        externalUserId: string;
      };
      const query = request.query as {
        timezone?: string;
        animationUrl?: string;
        animConfig?: string;
        primaryColor?: string;
        speed?: string;
        preset?: string;
      };

      const db = getDb();
      const nowUtc = new Date();
      const userTimezone = query.timezone || 'UTC';

      // Parse code-driven animation configuration
      let animConfig: StreakAnimationConfig = {};
      if (query.animConfig) {
        try {
          animConfig = JSON.parse(decodeURIComponent(query.animConfig));
        } catch (_) {
          try { animConfig = JSON.parse(query.animConfig); } catch (__) {}
        }
      }
      if (query.animationUrl) animConfig.customUrl = query.animationUrl;
      if (query.primaryColor) animConfig.primaryColor = query.primaryColor;
      if (query.speed) animConfig.speed = parseFloat(query.speed);
      if (query.preset) animConfig.preset = query.preset as any;

      // 1. Fetch rule by slug (across all tenants)
      const ruleRow = await db.get<any>(
        'SELECT * FROM streak_rules WHERE slug = $1',
        [ruleSlug]
      );

      if (!ruleRow) {
        return reply.status(404).type('text/html').send(`
          <!DOCTYPE html>
          <html>
            <body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;text-align:center;padding:40px;">
              <h2>Rule not found</h2>
              <p style="color:#94a3b8;">Streak rule "${ruleSlug}" does not exist.</p>
            </body>
          </html>
        `);
      }

      const rule: StreakRule = {
        id: ruleRow.id,
        tenantId: ruleRow.tenant_id,
        slug: ruleRow.slug,
        name: ruleRow.name,
        cadenceType: ruleRow.cadence_type,
        targetValue: ruleRow.target_value,
        exemptDaysBitmask: ruleRow.exempt_days_bitmask,
        gracePeriodMinutes: ruleRow.grace_period_minutes,
        maxFreezes: ruleRow.max_freezes,
        autoConsumeFreeze: Boolean(ruleRow.auto_consume_freeze),
        atRiskLeadMinutes: ruleRow.at_risk_lead_minutes || 120,
        milestoneDays: typeof ruleRow.milestone_days === 'string'
          ? JSON.parse(ruleRow.milestone_days)
          : ruleRow.milestone_days,
        createdAt: ruleRow.created_at
      };

      // 2. Fetch or create user streak row
      let userStreakRow = await db.get<any>(
        'SELECT * FROM user_streaks WHERE rule_id = $1 AND external_user_id = $2',
        [rule.id, externalUserId]
      );

      let userStreak: UserStreak;
      if (!userStreakRow) {
        userStreak = {
          id: 'temp_user',
          tenantId: rule.tenantId,
          ruleId: rule.id,
          externalUserId,
          timezone: userTimezone,
          currentStreak: 0,
          highestStreak: 0,
          lastCompletedLogicalDate: null,
          currentLogicalDate: null,
          currentWindowProgress: 0,
          freezesAvailable: rule.maxFreezes,
          lastFreezeConsumedDate: null,
          windowExpiresAtUtc: null,
          atRiskNotifiedForDate: null,
          recentHistory: [],
          lastClientEventUtc: null,
          lastEventHash: null,
          updatedAt: nowUtc.toISOString()
        };
      } else {
        userStreak = {
          id: userStreakRow.id,
          tenantId: userStreakRow.tenant_id,
          ruleId: userStreakRow.rule_id,
          externalUserId: userStreakRow.external_user_id,
          timezone: query.timezone || userStreakRow.timezone || 'UTC',
          currentStreak: userStreakRow.current_streak,
          highestStreak: userStreakRow.highest_streak,
          lastCompletedLogicalDate: userStreakRow.last_completed_logical_date,
          currentLogicalDate: userStreakRow.current_logical_date,
          currentWindowProgress: userStreakRow.current_window_progress,
          freezesAvailable: userStreakRow.freezes_available,
          lastFreezeConsumedDate: userStreakRow.last_freeze_consumed_date,
          windowExpiresAtUtc: userStreakRow.window_expires_at_utc,
          atRiskNotifiedForDate: userStreakRow.at_risk_notified_for_date,
          recentHistory: typeof userStreakRow.recent_history === 'string'
            ? JSON.parse(userStreakRow.recent_history)
            : userStreakRow.recent_history || [],
          lastClientEventUtc: userStreakRow.last_client_event_utc,
          lastEventHash: userStreakRow.last_event_hash,
          updatedAt: userStreakRow.updated_at
        };
      }

      const state = evaluateStateOnRead(userStreak, rule, nowUtc);
      const todayLogicalDate = computeLogicalDate(nowUtc, userTimezone, rule.gracePeriodMinutes);
      const [todayYear, todayMonth] = todayLogicalDate.split('-').map(Number);

      // Fetch history & pauses for month calendar
      const historyRows = (await db.query<StreakHistoryEntry>(
        'SELECT period_date, status, streak_length FROM streak_history WHERE rule_id = $1 AND external_user_id = $2',
        [rule.id, externalUserId]
      )) || [];

      const pauseRows = (await db.query<StreakPauseEntry>(
        'SELECT start_date, end_date FROM streak_pauses WHERE rule_id = $1 AND external_user_id = $2',
        [rule.id, externalUserId]
      )) || [];

      const prefRow = await db.get<any>(
        'SELECT days_off_override FROM user_preferences WHERE rule_id = $1 AND external_user_id = $2',
        [rule.id, externalUserId]
      );
      const userDaysOff: number[] = prefRow?.days_off_override ? JSON.parse(prefRow.days_off_override) : [];

      const initialCalendar = generateMonthCalendar(
        todayYear,
        todayMonth,
        todayLogicalDate,
        rule,
        userStreak,
        historyRows,
        pauseRows,
        userDaysOff
      );

      const brokenStreakLength = userStreakRow?.last_broken_streak_length || 0;

      const html = renderEmbedHtml(
        state,
        rule.name,
        rule.slug,
        externalUserId,
        userTimezone,
        initialCalendar,
        animConfig,
        brokenStreakLength
      );
      return reply.type('text/html').send(html);
    }
  );

  // 2. Headless Embed Calendar Data API (for client-side month toggling)
  fastify.get(
    '/v1/embed/:ruleSlug/:externalUserId/calendar',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { ruleSlug, externalUserId } = request.params as {
        ruleSlug: string;
        externalUserId: string;
      };
      const query = request.query as { timezone?: string; year?: string; month?: string };

      const db = getDb();
      const nowUtc = new Date();
      const userTimezone = query.timezone || 'UTC';

      const ruleRow = await db.get<any>(
        'SELECT * FROM streak_rules WHERE slug = $1',
        [ruleSlug]
      );

      if (!ruleRow) {
        return reply.status(404).send({ error: `Rule not found: ${ruleSlug}` });
      }

      const rule: StreakRule = {
        id: ruleRow.id,
        tenantId: ruleRow.tenant_id,
        slug: ruleRow.slug,
        name: ruleRow.name,
        cadenceType: ruleRow.cadence_type,
        targetValue: ruleRow.target_value,
        exemptDaysBitmask: ruleRow.exempt_days_bitmask,
        gracePeriodMinutes: ruleRow.grace_period_minutes,
        maxFreezes: ruleRow.max_freezes,
        autoConsumeFreeze: Boolean(ruleRow.auto_consume_freeze),
        atRiskLeadMinutes: ruleRow.at_risk_lead_minutes || 120,
        milestoneDays: typeof ruleRow.milestone_days === 'string'
          ? JSON.parse(ruleRow.milestone_days)
          : ruleRow.milestone_days,
        createdAt: ruleRow.created_at
      };

      const userStreakRow = await db.get<any>(
        'SELECT * FROM user_streaks WHERE rule_id = $1 AND external_user_id = $2',
        [rule.id, externalUserId]
      );

      let userStreak: UserStreak;
      if (!userStreakRow) {
        userStreak = {
          id: 'temp_user',
          tenantId: rule.tenantId,
          ruleId: rule.id,
          externalUserId,
          timezone: userTimezone,
          currentStreak: 0,
          highestStreak: 0,
          lastCompletedLogicalDate: null,
          currentLogicalDate: null,
          currentWindowProgress: 0,
          freezesAvailable: rule.maxFreezes,
          lastFreezeConsumedDate: null,
          windowExpiresAtUtc: null,
          atRiskNotifiedForDate: null,
          recentHistory: [],
          lastClientEventUtc: null,
          lastEventHash: null,
          updatedAt: nowUtc.toISOString()
        };
      } else {
        userStreak = {
          id: userStreakRow.id,
          tenantId: userStreakRow.tenant_id,
          ruleId: userStreakRow.rule_id,
          externalUserId: userStreakRow.external_user_id,
          timezone: query.timezone || userStreakRow.timezone || 'UTC',
          currentStreak: userStreakRow.current_streak,
          highestStreak: userStreakRow.highest_streak,
          lastCompletedLogicalDate: userStreakRow.last_completed_logical_date,
          currentLogicalDate: userStreakRow.current_logical_date,
          currentWindowProgress: userStreakRow.current_window_progress,
          freezesAvailable: userStreakRow.freezes_available,
          lastFreezeConsumedDate: userStreakRow.last_freeze_consumed_date,
          windowExpiresAtUtc: userStreakRow.window_expires_at_utc,
          atRiskNotifiedForDate: userStreakRow.at_risk_notified_for_date,
          recentHistory: typeof userStreakRow.recent_history === 'string'
            ? JSON.parse(userStreakRow.recent_history)
            : userStreakRow.recent_history || [],
          lastClientEventUtc: userStreakRow.last_client_event_utc,
          lastEventHash: userStreakRow.last_event_hash,
          updatedAt: userStreakRow.updated_at
        };
      }

      const todayLogicalDate = computeLogicalDate(nowUtc, userTimezone, rule.gracePeriodMinutes);
      const [todayYear, todayMonth] = todayLogicalDate.split('-').map(Number);

      const targetYear = query.year ? parseInt(query.year, 10) : todayYear;
      const targetMonth = query.month ? parseInt(query.month, 10) : todayMonth;

      const historyRows = (await db.query<StreakHistoryEntry>(
        'SELECT period_date, status, streak_length FROM streak_history WHERE rule_id = $1 AND external_user_id = $2',
        [rule.id, externalUserId]
      )) || [];

      const pauseRows = (await db.query<StreakPauseEntry>(
        'SELECT start_date, end_date FROM streak_pauses WHERE rule_id = $1 AND external_user_id = $2',
        [rule.id, externalUserId]
      )) || [];

      const prefRow = await db.get<any>(
        'SELECT days_off_override FROM user_preferences WHERE rule_id = $1 AND external_user_id = $2',
        [rule.id, externalUserId]
      );
      const userDaysOff: number[] = prefRow?.days_off_override ? JSON.parse(prefRow.days_off_override) : [];

      const calendar = generateMonthCalendar(
        targetYear,
        targetMonth,
        todayLogicalDate,
        rule,
        userStreak,
        historyRows,
        pauseRows,
        userDaysOff
      );

      return reply.status(200).send(calendar);
    }
  );
}

function renderCalendarCellsHtml(calendar: MonthCalendarDTO): string {
  let html = '';
  // Empty padding cells before first day of month
  for (let i = 0; i < calendar.firstDayOfWeek; i++) {
    html += '<div class="cal-cell cal-empty"></div>';
  }

  for (const day of calendar.days) {
    let classes = `cal-cell cal-${day.state.toLowerCase()}`;
    let icon = '';

    if (day.isToday) {
      classes += ' cal-today';
    }

    if (day.state === 'COMPLETED' || day.state === 'ACTIVE_TODAY') {
      icon = '<span class="cal-icon">🔥</span>';
    } else if (day.state === 'FROZEN') {
      icon = '<span class="cal-icon">❄️</span>';
    } else if (day.state === 'PAUSED') {
      icon = '<span class="cal-icon">⏸️</span>';
    } else if (day.state === 'EXEMPT') {
      icon = '<span class="cal-icon cal-icon-dim">—</span>';
    }

    html += `
      <div class="${classes}" title="${day.date}: ${day.state}">
        <span class="cal-num">${day.day}</span>
        ${icon}
      </div>
    `;
  }
  return html;
}

function renderEmbedHtml(
  state: any,
  ruleName: string,
  ruleSlug: string,
  externalUserId: string,
  timezone: string,
  calendar: MonthCalendarDTO,
  animConfig?: StreakAnimationConfig,
  brokenStreakLength: number = 0
): string {
  const streak = state.currentStreak || 0;
  const highest = state.highestStreak || streak;
  const status = state.status || 'PENDING_TODAY';
  const freezes = state.freezes || { available: 2, max: 2 };
  const history = state.historyLast14Days || [];
  const milestone = state.milestone;

  const anim = animConfig || {};
  let defaultThemeColor = '#f59e0b';
  let defaultGlow = '0 0 24px rgba(245, 158, 11, 0.7)';
  let statusText = 'Pending';
  let statusBadgeBg = '#334155';

  if (status === 'ACTIVE_TODAY') {
    defaultThemeColor = '#f59e0b';
    defaultGlow = '0 0 24px rgba(245, 158, 11, 0.7)';
    statusText = 'Active Today';
    statusBadgeBg = '#15803d';
  } else if (status === 'AT_RISK') {
    defaultThemeColor = '#ef4444';
    defaultGlow = '0 0 20px rgba(239, 68, 68, 0.8)';
    statusText = 'At Risk!';
    statusBadgeBg = '#b91c1c';
  } else if (status === 'FROZEN') {
    defaultThemeColor = '#38bdf8';
    defaultGlow = '0 0 20px rgba(56, 189, 248, 0.7)';
    statusText = 'Frozen';
    statusBadgeBg = '#0369a1';
  } else if (status === 'BROKEN') {
    defaultThemeColor = '#ef4444';
    defaultGlow = '0 0 20px rgba(239, 68, 68, 0.6)';
    statusText = 'Broken';
    statusBadgeBg = '#7f1d1d';
  }

  const flameTier = getFlameEvolutionTier(streak);

  // Developer code-customized animation options or evolved flame tier color
  const primaryColor = anim.primaryColor || (status === 'FROZEN' ? defaultThemeColor : flameTier.primaryColor);
  const glow = anim.glowColor ? `0 0 24px ${anim.glowColor}` : (status === 'FROZEN' ? defaultGlow : `0 0 24px ${flameTier.glowColor}`);
  const speed = anim.speed && anim.speed > 0 ? anim.speed : 1.0;
  const preset = anim.preset || (status === 'FROZEN' ? 'frost' : 'flame');
  const particleCount = anim.particleCount && anim.particleCount > 0 ? anim.particleCount : 40;

  // Compute hue rotation for SVG/Lottie flame from base amber (hue 38 deg)
  const targetHue = hexToHue(primaryColor);
  const hueRotateDeg = (targetHue - 38 + 360) % 360;

  const stripHtml = history
    .slice(-10)
    .map((item: any) => {
      const day = item.date.slice(8);
      let icon = '•';
      let color = '#64748b';
      if (item.state === 'COMPLETED') {
        icon = '✓';
        color = '#22c55e';
      } else if (item.state === 'FROZEN') {
        icon = '❄';
        color = '#38bdf8';
      } else if (item.state === 'EXEMPT') {
        icon = '—';
        color = '#94a3b8';
      } else if (item.state === 'MISSED') {
        icon = '✕';
        color = '#ef4444';
      }
      return `
        <div class="day-col">
          <span class="day-label">${day}</span>
          <div class="day-icon" style="color:${color};">${icon}</div>
        </div>
      `;
    })
    .join('');

  const calendarCellsHtml = renderCalendarCellsHtml(calendar);
  const perfectWeeksCount = calendar.perfectWeeks.length;
  const showPaywall = brokenStreakLength > 0 && streak === 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${ruleName} Streak</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.13.0/lottie.min.js"></script>
  <style>
    :root {
      --streak-primary: ${primaryColor};
      --streak-glow: ${glow};
      --anim-speed: ${speed}s;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      overflow-x: hidden;
      user-select: none;
    }
    .header-bar {
      width: 100%;
      max-width: 440px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .rule-title {
      font-size: 14px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .sound-btn, .close-btn {
      background: #1e293b;
      border: 1px solid #334155;
      color: #94a3b8;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      font-size: 15px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .sound-btn:hover, .close-btn:hover { background: #334155; color: #ffffff; }
    .card {
      width: 100%;
      max-width: 440px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 20px 30px -10px rgba(0, 0, 0, 0.5);
      text-align: center;
      position: relative;
    }
    .flame-hero {
      width: 110px;
      height: 110px;
      margin: 0 auto 8px auto;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    .flame-fallback {
      font-size: 64px;
      line-height: 1;
      filter: drop-shadow(var(--streak-glow));
      animation: float 2.5s ease-in-out infinite;
    }
    #lottie-container {
      width: 100%;
      height: 100%;
      filter: hue-rotate(${hueRotateDeg}deg);
    }
    .streak-num {
      font-size: 42px;
      font-weight: 800;
      color: var(--streak-primary);
      line-height: 1;
      margin-bottom: 4px;
    }
    .streak-label {
      font-size: 14px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-weight: 600;
      margin-bottom: 14px;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      background: ${statusBadgeBg};
      color: #ffffff;
      margin-bottom: 20px;
    }
    .stats-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 20px;
    }
    .stat-box {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px 8px;
    }
    .stat-val { font-size: 18px; font-weight: 700; }
    .stat-lbl { font-size: 11px; color: #94a3b8; margin-top: 2px; }

    /* Calendar and History Container */
    .history-card {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .view-tabs {
      display: flex;
      background: #1e293b;
      border-radius: 8px;
      padding: 3px;
      margin-bottom: 14px;
    }
    .view-tab {
      flex: 1;
      padding: 6px 10px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      background: transparent;
      cursor: pointer;
      transition: all 0.2s;
    }
    .view-tab.active {
      background: #334155;
      color: #f8fafc;
    }

    /* Month Calendar View Styles */
    .cal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .cal-month-title {
      font-size: 14px;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: 0.3px;
    }
    .cal-nav-btn {
      background: #1e293b;
      border: 1px solid #334155;
      color: #94a3b8;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      font-size: 15px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .cal-nav-btn:hover { background: #334155; color: #ffffff; }

    .cal-weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;
      margin-bottom: 8px;
      text-align: center;
    }
    .cal-weekday {
      font-size: 11px;
      font-weight: 700;
      color: #64748b;
    }

    .cal-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 5px;
    }
    .cal-cell {
      aspect-ratio: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      position: relative;
      transition: transform 0.1s;
    }
    .cal-empty { background: transparent; }
    .cal-num { line-height: 1; }
    .cal-icon { font-size: 9px; line-height: 1; margin-top: 1px; }
    .cal-icon-dim { color: #64748b; }

    /* Day states */
    .cal-completed {
      background: rgba(245, 158, 11, 0.2);
      border: 1px solid var(--streak-primary);
      color: var(--streak-primary);
    }
    .cal-active_today {
      background: var(--streak-primary);
      border: 1px solid var(--streak-primary);
      color: #ffffff;
      box-shadow: var(--streak-glow);
    }
    .cal-frozen {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(2, 132, 199, 0.25));
      border: 1px solid rgba(56, 189, 248, 0.6);
      color: #38bdf8;
    }
    .cal-paused {
      background: rgba(129, 140, 248, 0.2);
      border: 1px solid rgba(129, 140, 248, 0.4);
      color: #a5b4fc;
    }
    .cal-exempt {
      background: #1e293b;
      color: #64748b;
    }
    .cal-missed {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid #334155;
      color: #475569;
    }
    .cal-pending_today {
      border: 1.5px dashed var(--streak-primary);
      color: var(--streak-primary);
      background: rgba(245, 158, 11, 0.08);
    }
    .cal-at_risk {
      border: 1.5px dashed #ef4444;
      color: #ef4444;
      background: rgba(239, 68, 68, 0.12);
      animation: pulse-ring 1.5s infinite;
    }
    .cal-future {
      background: transparent;
      color: #334155;
    }
    .cal-today {
      outline: 2px solid var(--streak-primary);
      outline-offset: 1px;
    }

    .cal-perfect-banner {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(234, 88, 12, 0.15));
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 700;
      color: var(--streak-primary);
      margin-top: 10px;
      text-align: center;
    }
    .cal-stats-footer {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 8px;
      text-align: center;
    }

    /* 10-day Strip Styles */
    .history-strip {
      display: flex;
      justify-content: space-between;
      gap: 4px;
    }
    .day-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .day-label { font-size: 11px; color: #64748b; }
    .day-icon {
      width: 26px;
      height: 26px;
      background: #1e293b;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: bold;
    }

    /* Paywall Monetization Banner */
    .paywall-card {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.18), rgba(245, 158, 11, 0.18));
      border: 1.5px solid rgba(245, 158, 11, 0.6);
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 20px;
      text-align: center;
      animation: pulse-ring 2.2s infinite;
    }
    .paywall-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.5px;
      background: #f59e0b;
      color: #0f172a;
      padding: 3px 8px;
      border-radius: 6px;
      margin-bottom: 8px;
    }
    .paywall-title {
      font-size: 18px;
      font-weight: 800;
      color: #f8fafc;
      margin-bottom: 6px;
    }
    .paywall-desc {
      font-size: 12px;
      color: #cbd5e1;
      margin-bottom: 14px;
      line-height: 1.4;
    }
    .paywall-btn-row {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .paywall-btn-primary {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #0f172a;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.35);
      transition: transform 0.1s, filter 0.1s;
    }
    .paywall-btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .paywall-btn-secondary {
      width: 100%;
      padding: 10px;
      background: #1e293b;
      border: 1px solid #475569;
      color: #f8fafc;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
    }
    .paywall-btn-secondary:hover { background: #334155; }
    .paywall-urgency {
      font-size: 11px;
      color: #ef4444;
      font-weight: 600;
      margin-top: 10px;
    }

    .milestone-banner {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(234, 88, 12, 0.15));
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 12px;
      padding: 12px;
      font-size: 13px;
      font-weight: 600;
      color: var(--streak-primary);
      margin-bottom: 20px;
    }
    .share-btn {
      width: 100%;
      padding: 14px;
      background: var(--streak-primary);
      color: #0f172a;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .share-btn:hover { filter: brightness(0.9); }
    canvas {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 99;
    }
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-6px); }
    }
    @keyframes pulse-ring {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>

  <div class="header-bar">
    <span class="rule-title">${ruleName}</span>
    <div class="header-actions">
      <button class="sound-btn" id="soundToggleBtn" title="Toggle Sound">🔊</button>
      <button class="close-btn" id="closeBtn">✕</button>
    </div>
  </div>

  <div class="card">
    <div class="flame-tier-pill" style="display:inline-block; margin-bottom: 10px; padding: 4px 14px; border-radius: 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid ${flameTier.primaryColor}; color: ${flameTier.primaryColor}; background: rgba(0,0,0,0.35);">${flameTier.badge} · Lvl ${flameTier.level}</div>
    <div class="flame-hero">
      <div id="lottie-container"></div>
      <div class="flame-fallback" id="flameFallback">${status === 'FROZEN' ? '❄️' : '🔥'}</div>
    </div>
    <div class="streak-num">${streak}</div>
    <div class="streak-label">Day Streak</div>
    <span class="status-badge">${statusText}</span>

    <div class="stats-row">
      <div class="stat-box">
        <div class="stat-val">🏆 ${highest}</div>
        <div class="stat-lbl">Personal Best</div>
      </div>
      <div class="stat-box">
        <div class="stat-val">🛡️ ${freezes.available} / ${freezes.max}</div>
        <div class="stat-lbl">Freezes Left</div>
      </div>
    </div>

    ${
      showPaywall
        ? `
      <!-- High-Converting Streak Repair Paywall Card -->
      <div class="paywall-card" id="paywallCard">
        <div class="paywall-badge">⚡ STREAK RESCUE AVAILABLE</div>
        <div class="paywall-title">Restore your ${brokenStreakLength}-Day Streak!</div>
        <p class="paywall-desc">Don't lose weeks of daily dedication. Reclaim your streak now before the grace window closes:</p>
        <div class="paywall-btn-row">
          <button class="paywall-btn-primary" id="btnPaywallIap">
            💎 Restore Streak · $2.99
          </button>
          <button class="paywall-btn-secondary" id="btnPaywallCoins">
            🪙 Use 50 Gems / Coins
          </button>
        </div>
        <div class="paywall-urgency">⌛ Grace window expires soon</div>
      </div>
    `
        : ''
    }

    <!-- Calendar & History Card with View Switcher -->
    <div class="history-card">
      <div class="view-tabs">
        <button class="view-tab active" id="tabMonth">📅 Month Calendar</button>
        <button class="view-tab" id="tabStrip">⚡ 10-Day Strip</button>
      </div>

      <!-- View 1: Duolingo-style Month Calendar View -->
      <div id="monthCalendarView">
        <div class="cal-header">
          <button class="cal-nav-btn" id="calPrevBtn">‹</button>
          <span class="cal-month-title" id="calMonthTitle">${calendar.monthName} ${calendar.year}</span>
          <button class="cal-nav-btn" id="calNextBtn">›</button>
        </div>

        <div class="cal-weekdays">
          <span class="cal-weekday">S</span>
          <span class="cal-weekday">M</span>
          <span class="cal-weekday">T</span>
          <span class="cal-weekday">W</span>
          <span class="cal-weekday">T</span>
          <span class="cal-weekday">F</span>
          <span class="cal-weekday">S</span>
        </div>

        <div class="cal-grid" id="calGrid">
          ${calendarCellsHtml}
        </div>

        <div id="perfectBannerContainer">
          ${
            perfectWeeksCount > 0
              ? `<div class="cal-perfect-banner">✨ ${perfectWeeksCount} Perfect Week${perfectWeeksCount > 1 ? 's' : ''}! (7/7 days active)</div>`
              : ''
          }
        </div>

        <div class="cal-stats-footer" id="calFooterStats">
          🔥 ${calendar.activeDaysCount} Active Days · ❄️ ${calendar.frozenDaysCount} Frozen
        </div>
      </div>

      <!-- View 2: Horizontal Activity Strip -->
      <div id="stripView" style="display: none;">
        <div class="history-strip">
          ${stripHtml}
        </div>
      </div>
    </div>

    ${
      milestone?.nextMilestone
        ? `
      <div class="milestone-banner">
        🎯 ${milestone.daysToNextMilestone} days to reach Day ${milestone.nextMilestone}!
      </div>
    `
        : ''
    }

    <button class="share-btn" id="shareBtn">
      Share Milestone 🚀
    </button>
  </div>

  <script>
    // Procedural Web Audio Dopamine Synthesizer (Zero external downloads, 100% synthesized)
    var AudioEngine = (function() {
      var ctx = null;
      var isMuted = localStorage.getItem('streakkit_sound_enabled') === 'false';

      function getAudioContext() {
        if (!ctx) {
          var AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) ctx = new AudioCtx();
        }
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(function() {});
        }
        return ctx;
      }

      function playTone(freq, start, duration, type, startGain, endGain) {
        var ac = getAudioContext();
        if (!ac || isMuted) return;

        var osc = ac.createOscillator();
        var gain = ac.createGain();

        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, ac.currentTime + start);

        gain.gain.setValueAtTime(startGain || 0.15, ac.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(endGain || 0.0001, ac.currentTime + start + duration);

        osc.connect(gain);
        gain.connect(ac.destination);

        osc.start(ac.currentTime + start);
        osc.stop(ac.currentTime + start + duration);
      }

      function playNoise(start, duration, filterFreq) {
        var ac = getAudioContext();
        if (!ac || isMuted) return;

        var bufferSize = Math.floor(ac.sampleRate * duration);
        var buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
        var data = buffer.getChannelData(0);
        for (var i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }

        var noise = ac.createBufferSource();
        noise.buffer = buffer;

        var filter = ac.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(filterFreq || 2400, ac.currentTime + start);

        var gain = ac.createGain();
        gain.gain.setValueAtTime(0.08, ac.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + duration);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ac.destination);

        noise.start(ac.currentTime + start);
        noise.stop(ac.currentTime + start + duration);
      }

      return {
        isMuted: function() { return isMuted; },
        toggleMute: function() {
          isMuted = !isMuted;
          localStorage.setItem('streakkit_sound_enabled', isMuted ? 'false' : 'true');
          return !isMuted;
        },
        play: function(soundType) {
          if (isMuted) return;
          getAudioContext();

          // Dispatch to native bridge if running inside Android / iOS app
          if (window.StreakBridge && typeof window.StreakBridge.onSoundEffect === 'function') {
            window.StreakBridge.onSoundEffect(soundType);
          }

          if (soundType === 'streak_extend') {
            // Ascending major chord (C5 -> E5 -> G5 -> C6)
            playTone(523.25, 0.00, 0.30, 'sine', 0.16);
            playTone(659.25, 0.08, 0.32, 'sine', 0.18);
            playTone(783.99, 0.16, 0.35, 'sine', 0.20);
            playTone(1046.50, 0.24, 0.55, 'triangle', 0.24);
          } else if (soundType === 'streak_freeze') {
            // High crystal glass harmonic + crisp ice noise
            playTone(987.77, 0.00, 0.45, 'triangle', 0.18);
            playTone(1975.53, 0.05, 0.35, 'sine', 0.12);
            playNoise(0.02, 0.30, 2600);
          } else if (soundType === 'streak_at_risk') {
            // Low cautionary dual pulse (A2 -> F#2)
            playTone(110.00, 0.00, 0.22, 'sawtooth', 0.14);
            playTone(92.50, 0.24, 0.30, 'sawtooth', 0.14);
          } else if (soundType === 'milestone_unlocked') {
            // Victory fanfare arpeggio
            var notes = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];
            for (var i = 0; i < notes.length; i++) {
              playTone(notes[i], i * 0.07, 0.40, 'triangle', 0.20);
            }
          }
        }
      };
    })();

    // Wire Sound Toggle Button
    var soundBtn = document.getElementById('soundToggleBtn');
    if (AudioEngine.isMuted()) {
      soundBtn.innerText = '🔇';
    }
    soundBtn.addEventListener('click', function() {
      var unmuted = AudioEngine.toggleMute();
      soundBtn.innerText = unmuted ? '🔊' : '🔇';
      if (unmuted) {
        AudioEngine.play('streak_extend');
      }
    });

    // Play initial sound on gesture or view
    window.addEventListener('click', function onFirstClick() {
      if ('${status}' === 'ACTIVE_TODAY' || ${streak} > 0) {
        AudioEngine.play('streak_extend');
      } else if ('${status}' === 'FROZEN') {
        AudioEngine.play('streak_freeze');
      } else if ('${status}' === 'AT_RISK') {
        AudioEngine.play('streak_at_risk');
      }
      window.removeEventListener('click', onFirstClick);
    }, { once: true });

    // Wire Monetization Paywall Buttons
    var btnPaywallIap = document.getElementById('btnPaywallIap');
    if (btnPaywallIap) {
      btnPaywallIap.addEventListener('click', function() {
        var payload = {
          action: 'STREAK_REPAIR',
          brokenStreakLength: ${brokenStreakLength},
          ruleSlug: "${ruleSlug}",
          externalUserId: "${externalUserId}",
          costUsd: 2.99,
          provider: 'in_app_purchase'
        };
        window.parent.postMessage({ type: 'STREAKKIT_PURCHASE_INTENT', payload: payload }, '*');
        if (window.StreakBridge && typeof window.StreakBridge.onPurchaseRequest === 'function') {
          window.StreakBridge.onPurchaseRequest(JSON.stringify(payload));
        } else {
          alert('Redirecting to Google Play / StoreKit In-App Purchase...');
        }
      });
    }

    var btnPaywallCoins = document.getElementById('btnPaywallCoins');
    if (btnPaywallCoins) {
      btnPaywallCoins.addEventListener('click', function() {
        var payload = {
          action: 'STREAK_REPAIR',
          brokenStreakLength: ${brokenStreakLength},
          ruleSlug: "${ruleSlug}",
          externalUserId: "${externalUserId}",
          costCoins: 50,
          provider: 'coins'
        };
        window.parent.postMessage({ type: 'STREAKKIT_PURCHASE_INTENT', payload: payload }, '*');
        if (window.StreakBridge && typeof window.StreakBridge.onCoinSpend === 'function') {
          window.StreakBridge.onCoinSpend(JSON.stringify(payload));
        } else {
          alert('50 Gems redeemed for Streak Rescue!');
        }
      });
    }

    // State for interactive month calendar
    var curYear = ${calendar.year};
    var curMonth = ${calendar.month};
    var ruleSlug = "${ruleSlug}";
    var externalUserId = "${externalUserId}";
    var timezone = "${timezone}";

    // View Switcher logic
    var tabMonth = document.getElementById('tabMonth');
    var tabStrip = document.getElementById('tabStrip');
    var monthView = document.getElementById('monthCalendarView');
    var stripView = document.getElementById('stripView');

    tabMonth.addEventListener('click', function() {
      tabMonth.classList.add('active');
      tabStrip.classList.remove('active');
      monthView.style.display = 'block';
      stripView.style.display = 'none';
    });

    tabStrip.addEventListener('click', function() {
      tabStrip.classList.add('active');
      tabMonth.classList.remove('active');
      monthView.style.display = 'none';
      stripView.style.display = 'block';
    });

    // Month Navigation handler
    function loadMonthCalendar(year, month) {
      fetch('/v1/embed/' + encodeURIComponent(ruleSlug) + '/' + encodeURIComponent(externalUserId) + '/calendar?year=' + year + '&month=' + month + '&timezone=' + encodeURIComponent(timezone))
        .then(function(r) { return r.json(); })
        .then(function(cal) {
          curYear = cal.year;
          curMonth = cal.month;
          document.getElementById('calMonthTitle').innerText = cal.monthName + ' ' + cal.year;

          // Render cells
          var html = '';
          for (var i = 0; i < cal.firstDayOfWeek; i++) {
            html += '<div class="cal-cell cal-empty"></div>';
          }
          for (var j = 0; j < cal.days.length; j++) {
            var day = cal.days[j];
            var classes = 'cal-cell cal-' + day.state.toLowerCase();
            var icon = '';
            if (day.isToday) classes += ' cal-today';
            if (day.state === 'COMPLETED' || day.state === 'ACTIVE_TODAY') {
              icon = '<span class="cal-icon">🔥</span>';
            } else if (day.state === 'FROZEN') {
              icon = '<span class="cal-icon">❄️</span>';
            } else if (day.state === 'PAUSED') {
              icon = '<span class="cal-icon">⏸️</span>';
            } else if (day.state === 'EXEMPT') {
              icon = '<span class="cal-icon cal-icon-dim">—</span>';
            }
            html += '<div class="' + classes + '" title="' + day.date + ': ' + day.state + '">' +
              '<span class="cal-num">' + day.day + '</span>' + icon + '</div>';
          }
          document.getElementById('calGrid').innerHTML = html;

          // Perfect week banner
          var banner = document.getElementById('perfectBannerContainer');
          if (cal.perfectWeeks && cal.perfectWeeks.length > 0) {
            banner.innerHTML = '<div class="cal-perfect-banner">✨ ' + cal.perfectWeeks.length + ' Perfect Week' + (cal.perfectWeeks.length > 1 ? 's' : '') + '! (7/7 days active)</div>';
          } else {
            banner.innerHTML = '';
          }

          // Footer stats
          document.getElementById('calFooterStats').innerText = '🔥 ' + cal.activeDaysCount + ' Active Days · ❄️ ' + cal.frozenDaysCount + ' Frozen';
        })
        .catch(function(e) {
          console.error('Failed to load month calendar:', e);
        });
    }

    document.getElementById('calPrevBtn').addEventListener('click', function() {
      var m = curMonth - 1;
      var y = curYear;
      if (m < 1) { m = 12; y--; }
      loadMonthCalendar(y, m);
    });

    document.getElementById('calNextBtn').addEventListener('click', function() {
      var m = curMonth + 1;
      var y = curYear;
      if (m > 12) { m = 1; y++; }
      loadMonthCalendar(y, m);
    });

    // Lottie Animation Player with Graceful Fallback and Programmatic Speed Control
    (function initLottie() {
      var container = document.getElementById('lottie-container');
      var fallback = document.getElementById('flameFallback');
      if (!window.lottie || !container) return;

      var defaultFlameUrl = 'https://raw.githubusercontent.com/henriquegpb/rodada/main/components/streak/fire-streak.json';
      var animUrl = ${anim.customUrl ? `'${anim.customUrl}'` : 'defaultFlameUrl'};

      try {
        var anim = window.lottie.loadAnimation({
          container: container,
          renderer: 'svg',
          loop: ${anim.loop !== false},
          autoplay: true,
          path: animUrl
        });

        anim.addEventListener('DOMLoaded', function() {
          if (fallback) fallback.style.display = 'none';
          if (${speed} !== 1.0) {
            anim.setSpeed(${speed});
          }
        });

        anim.addEventListener('data_failed', function() {
          if (fallback) fallback.style.display = 'block';
        });
      } catch (e) {
        if (fallback) fallback.style.display = 'block';
      }
    })();

    // Native Bridge & Close Handler
    document.getElementById('closeBtn').addEventListener('click', function() {
      window.parent.postMessage({ type: 'STREAKKIT_CLOSE' }, '*');
      if (window.StreakBridge && typeof window.StreakBridge.close === 'function') {
        window.StreakBridge.close();
      }
    });

    // Share Handler
    document.getElementById('shareBtn').addEventListener('click', function() {
      var text = "🔥 I'm on a ${streak}-day streak on ${ruleName}! Can you beat me?";
      if (window.StreakBridge && typeof window.StreakBridge.share === 'function') {
        window.StreakBridge.share(text);
      } else if (navigator.share) {
        navigator.share({ title: '${ruleName} Streak', text: text }).catch(function() {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function() {
          alert('Milestone copied to clipboard!');
        });
      }
    });

    // Code-Driven Particle Celebration Engine (Customizable preset, timing, and palette)
    if ('${status}' === 'ACTIVE_TODAY' || ${streak} > 0) {
      var canvas = document.getElementById('canvas');
      var ctx = canvas.getContext('2d');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      var preset = '${preset}';
      var pSpeed = ${speed};
      var pCount = ${particleCount};
      var palette = ${JSON.stringify(anim.particleColors || [primaryColor, anim.secondaryColor || '#fbbf24', '#ffffff'])};

      var particles = [];
      for (var i = 0; i < pCount; i++) {
        if (preset === 'confetti') {
          particles.push({
            type: 'confetti',
            x: window.innerWidth / 2 + (Math.random() - 0.5) * 120,
            y: 160 + (Math.random() - 0.5) * 40,
            w: Math.random() * 8 + 4,
            h: Math.random() * 6 + 3,
            vx: (Math.random() - 0.5) * 12 * pSpeed,
            vy: (-Math.random() * 10 - 4) * pSpeed,
            gravity: 0.28 * pSpeed,
            color: palette[Math.floor(Math.random() * palette.length)],
            tilt: Math.random() * 10,
            tiltAngle: Math.random() * Math.PI,
            tiltSpeed: (Math.random() * 0.1 + 0.05) * pSpeed,
            alpha: 1,
            decay: Math.random() * 0.008 + 0.005
          });
        } else if (preset === 'frost') {
          particles.push({
            type: 'frost',
            x: Math.random() * window.innerWidth,
            y: Math.random() * -50,
            radius: Math.random() * 3 + 1.5,
            vx: (Math.random() - 0.5) * 1.5 * pSpeed,
            vy: (Math.random() * 2 + 1) * pSpeed,
            color: palette[Math.floor(Math.random() * palette.length)],
            alpha: 1,
            decay: Math.random() * 0.004 + 0.002
          });
        } else if (preset === 'fireworks') {
          var angle = Math.random() * Math.PI * 2;
          var spd = (Math.random() * 7 + 2) * pSpeed;
          particles.push({
            type: 'circle',
            x: window.innerWidth / 2,
            y: 180,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            radius: Math.random() * 3 + 1.5,
            friction: 0.96,
            gravity: 0.06 * pSpeed,
            color: palette[Math.floor(Math.random() * palette.length)],
            alpha: 1,
            decay: Math.random() * 0.02 + 0.012
          });
        } else {
          // 'flame' or 'ember'
          particles.push({
            type: 'circle',
            x: window.innerWidth / 2 + (Math.random() - 0.5) * 30,
            y: 180,
            vx: (Math.random() - 0.5) * 5 * pSpeed,
            vy: (-Math.random() * 5 - 2) * pSpeed,
            radius: Math.random() * 3 + 2,
            color: palette[Math.floor(Math.random() * palette.length)],
            alpha: 1,
            decay: Math.random() * 0.02 + 0.015
          });
        }
      }

      function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        var active = false;
        for (var j = 0; j < particles.length; j++) {
          var p = particles[j];
          if (p.friction) { p.vx *= p.friction; p.vy *= p.friction; }
          if (p.gravity) { p.vy += p.gravity; }
          p.x += p.vx;
          p.y += p.vy;
          if (p.type === 'frost') {
            p.x += Math.sin(p.y * 0.04) * 0.8;
          }
          p.alpha -= p.decay;
          if (p.alpha > 0 && p.y < window.innerHeight + 50) {
            active = true;
            ctx.globalAlpha = p.alpha;
            if (p.type === 'confetti') {
              p.tiltAngle += p.tiltSpeed;
              ctx.save();
              ctx.translate(p.x, p.y);
              ctx.rotate(p.tiltAngle);
              ctx.fillStyle = p.color;
              ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
              ctx.restore();
            } else {
              ctx.beginPath();
              ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
              ctx.fillStyle = p.color;
              ctx.fill();
            }
          }
        }
        if (active) requestAnimationFrame(animate);
      }
      animate();
    }

    var shareBtnEl = document.getElementById('shareBtn');
    if (shareBtnEl) {
      shareBtnEl.addEventListener('click', function() {
        AudioEngine.playAscendingChords();
        var shareMsg = "🔥 I'm on a " + ${streak} + "-day " + "${flameTier.name}" + " streak on " + "${ruleName}" + "! Can you beat my streak? #StreakKit";
        if (navigator.share) {
          navigator.share({
            title: "${ruleName} Streak Milestone",
            text: shareMsg,
            url: window.location.href
          }).catch(function() {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(shareMsg).then(function() {
            var orig = shareBtnEl.textContent;
            shareBtnEl.textContent = '✓ Copied to Clipboard!';
            setTimeout(function() { shareBtnEl.textContent = orig; }, 2000);
          });
        }
      });
    }
  </script>
</body>
</html>`;
}
