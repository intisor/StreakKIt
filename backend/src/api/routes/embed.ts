// api/routes/embed.ts: Serves the Universal Embed Dopamine UI for any Web, Android, iOS, or Flutter app
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../../config/db.js';
import { StreakRule, UserStreak } from '../../domain/types.js';
import { evaluateStateOnRead } from '../../domain/evaluator.js';

export async function registerEmbedRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/v1/embed/:ruleSlug/:externalUserId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { ruleSlug, externalUserId } = request.params as {
        ruleSlug: string;
        externalUserId: string;
      };
      const query = request.query as { timezone?: string };

      const db = getDb();
      const nowUtc = new Date();
      const userTimezone = query.timezone || 'UTC';

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
      const html = renderEmbedHtml(state, rule.name);
      return reply.type('text/html').send(html);
    }
  );
}

function renderEmbedHtml(state: any, ruleName: string): string {
  const streak = state.currentStreak || 0;
  const highest = state.highestStreak || streak;
  const status = state.status || 'PENDING_TODAY';
  const progress = state.todayProgress || { current: 0, target: 1, completed: false };
  const freezes = state.freezes || { available: 2, max: 2 };
  const history = state.historyLast14Days || [];
  const milestone = state.milestone;

  let flameColor = '#94a3b8';
  let glow = 'none';
  let statusText = 'Pending';
  let statusBadgeBg = '#334155';

  if (status === 'ACTIVE_TODAY') {
    flameColor = '#f59e0b';
    glow = '0 0 24px rgba(245, 158, 11, 0.7)';
    statusText = 'Active Today';
    statusBadgeBg = '#15803d';
  } else if (status === 'AT_RISK') {
    flameColor = '#ef4444';
    glow = '0 0 20px rgba(239, 68, 68, 0.8)';
    statusText = 'At Risk!';
    statusBadgeBg = '#b91c1c';
  } else if (status === 'FROZEN') {
    flameColor = '#38bdf8';
    glow = '0 0 20px rgba(56, 189, 248, 0.7)';
    statusText = 'Frozen';
    statusBadgeBg = '#0369a1';
  }

  const historyHtml = history
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${ruleName} Streak</title>
  <style>
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
    .rule-title {
      font-size: 14px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .close-btn {
      background: #1e293b;
      border: 1px solid #334155;
      color: #94a3b8;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .close-btn:hover { background: #334155; color: #ffffff; }
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
      font-size: 64px;
      line-height: 1;
      margin-bottom: 8px;
      filter: drop-shadow(${glow});
      animation: float 2.5s ease-in-out infinite;
    }
    .streak-num {
      font-size: 42px;
      font-weight: 800;
      color: #f59e0b;
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
    .history-card {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 20px;
    }
    .history-header {
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 12px;
      text-align: left;
    }
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
    .milestone-banner {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(234, 88, 12, 0.15));
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 12px;
      padding: 12px;
      font-size: 13px;
      font-weight: 600;
      color: #f59e0b;
      margin-bottom: 20px;
    }
    .share-btn {
      width: 100%;
      padding: 14px;
      background: #f59e0b;
      color: #0f172a;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .share-btn:hover { background: #d97706; }
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
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>

  <div class="header-bar">
    <span class="rule-title">${ruleName}</span>
    <button class="close-btn" id="closeBtn">✕</button>
  </div>

  <div class="card">
    <div class="flame-hero">🔥</div>
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

    <div class="history-card">
      <div class="history-header">Last 10 Days Activity</div>
      <div class="history-strip">
        ${historyHtml}
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
    // Native Bridge & Close Handler
    document.getElementById('closeBtn').addEventListener('click', () => {
      // 1. PostMessage for Web / iframe
      window.parent.postMessage({ type: 'STREAKKIT_CLOSE' }, '*');
      // 2. Android JavascriptInterface bridge if present
      if (window.StreakBridge && typeof window.StreakBridge.close === 'function') {
        window.StreakBridge.close();
      }
    });

    // Share Handler
    document.getElementById('shareBtn').addEventListener('click', () => {
      const text = "🔥 I'm on a ${streak}-day streak on ${ruleName}! Can you beat me?";
      if (window.StreakBridge && typeof window.StreakBridge.share === 'function') {
        window.StreakBridge.share(text);
      } else if (navigator.share) {
        navigator.share({ title: '${ruleName} Streak', text }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          alert('Milestone copied to clipboard!');
        });
      }
    });

    // Spark Particles for celebration
    if ('${status}' === 'ACTIVE_TODAY' || ${streak} > 0) {
      const canvas = document.getElementById('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const particles = [];
      for (let i = 0; i < 40; i++) {
        particles.push({
          x: window.innerWidth / 2,
          y: 180,
          vx: (Math.random() - 0.5) * 6,
          vy: -Math.random() * 5 - 2,
          radius: Math.random() * 3 + 2,
          color: ['#f59e0b', '#ef4444', '#fbbf24'][Math.floor(Math.random() * 3)],
          alpha: 1,
          decay: Math.random() * 0.02 + 0.015
        });
      }

      function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let active = false;
        for (const p of particles) {
          p.x += p.vx;
          p.y += p.vy;
          p.alpha -= p.decay;
          if (p.alpha > 0) {
            active = true;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.alpha;
            ctx.fill();
          }
        }
        if (active) requestAnimationFrame(animate);
      }
      animate();
    }
  </script>
</body>
</html>`;
}
