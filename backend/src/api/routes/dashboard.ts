// api/routes/dashboard.ts: Interactive Developer Console & Rule Management Studio
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export async function registerDashboardRoutes(fastify: FastifyInstance) {
  // Redirect root to dashboard
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect('/dashboard');
  });

  fastify.get('/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StreakKit — Developer Console & Rule Studio</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --card-hover: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #f59e0b;
      --primary-hover: #d97706;
      --accent: #38bdf8;
      --success: #10b981;
      --danger: #ef4444;
      --freeze: #06b6d4;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    body { background-color: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; }
    
    /* Topbar */
    header {
      background: rgba(17, 24, 39, 0.8);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
      padding: 14px 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .logo-area { display: flex; align-items: center; gap: 12px; font-weight: 800; font-size: 18px; letter-spacing: -0.5px; }
    .logo-area span.badge { font-size: 11px; background: #f59e0b22; color: var(--primary); padding: 3px 8px; border-radius: 9999px; border: 1px solid #f59e0b44; }
    .tenant-select-bar { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-muted); }
    select, input, textarea {
      background: #1e293b;
      color: var(--text);
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 13px;
      outline: none;
      transition: border 0.2s;
    }
    select:focus, input:focus, textarea:focus { border-color: var(--primary); }
    button {
      background: var(--primary);
      color: #000;
      font-weight: 700;
      font-size: 13px;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    button:hover { background: var(--primary-hover); transform: translateY(-1px); }
    button.secondary { background: #1e293b; color: var(--text); border: 1px solid #334155; }
    button.secondary:hover { background: #334155; }
    button.freeze-btn { background: #0891b2; color: #fff; }
    button.freeze-btn:hover { background: #06b6d4; }
    button.danger-btn { background: #dc2626; color: #fff; }

    /* Navigation Tabs */
    .tabs-bar {
      display: flex;
      gap: 8px;
      padding: 0 28px;
      background: #0d1321;
      border-bottom: 1px solid var(--card-border);
    }
    .tab-btn {
      background: transparent;
      color: var(--text-muted);
      border-radius: 0;
      border-bottom: 2px solid transparent;
      padding: 14px 16px;
      font-weight: 600;
      font-size: 14px;
    }
    .tab-btn:hover { background: transparent; color: var(--text); transform: none; }
    .tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }

    /* Main Container */
    main { max-width: 1360px; width: 100%; margin: 0 auto; padding: 28px; flex: 1; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Grid Layouts */
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 960px) { .grid-2 { grid-template-columns: 1fr; } }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 24px;
      position: relative;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .card-title { font-size: 16px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }

    /* Rule List Cards */
    .rule-card {
      background: #162032;
      border: 1px solid #283548;
      border-radius: 10px;
      padding: 18px;
      margin-bottom: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      transition: border 0.2s;
    }
    .rule-card:hover { border-color: #3b82f6; }
    .rule-title-row { display: flex; justify-content: space-between; align-items: baseline; }
    .rule-slug { font-family: monospace; font-size: 14px; color: var(--accent); background: #0f172a; padding: 3px 8px; border-radius: 4px; }
    .rule-meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; font-size: 12px; color: var(--text-muted); background: #0f172a; padding: 10px 14px; border-radius: 8px; }
    .rule-meta strong { display: block; color: #fff; font-size: 14px; margin-top: 2px; }
    .rule-actions { display: flex; gap: 8px; justify-content: flex-end; }

    /* Form Fields */
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 6px; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

    /* Playground Visualizer */
    .metric-display {
      background: #0f172a;
      border: 1px solid #223049;
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      margin-bottom: 20px;
    }
    .streak-flame { font-size: 54px; filter: drop-shadow(0 0 16px rgba(245, 158, 11, 0.4)); animation: pulse 2s infinite ease-in-out; }
    @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
    .streak-number { font-size: 40px; font-weight: 900; color: #fff; margin: 4px 0; }
    .streak-sub { color: var(--text-muted); font-size: 14px; }
    .progress-bar-bg { background: #1e293b; height: 10px; border-radius: 9999px; overflow: hidden; margin: 16px 0 8px 0; }
    .progress-bar-fill { height: 100%; background: linear-gradient(90deg, #f59e0b, #e11d48); width: 0%; transition: width 0.4s ease; }
    .history-dots { display: flex; justify-content: center; gap: 6px; margin-top: 18px; }
    .dot { width: 14px; height: 14px; border-radius: 50%; background: #334155; }
    .dot.completed { background: var(--success); box-shadow: 0 0 8px rgba(16, 185, 129, 0.5); }
    .dot.frozen { background: var(--freeze); box-shadow: 0 0 8px rgba(6, 182, 212, 0.5); }
    .dot.missed { background: #475569; }

    /* JSON Box */
    pre.json-box {
      background: #0a0f1d;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 14px;
      color: #38bdf8;
      font-family: monospace;
      font-size: 12px;
      max-height: 280px;
      overflow-y: auto;
      white-space: pre-wrap;
    }

    /* Mobile Embed Frame */
    .mobile-frame-container { display: flex; justify-content: center; }
    .mobile-frame {
      width: 380px;
      height: 660px;
      border: 12px solid #1e293b;
      border-radius: 40px;
      overflow: hidden;
      background: #0f172a;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
    }
    .mobile-frame iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>

  <!-- Topbar -->
  <header>
    <div class="logo-area">
      <span style="font-size: 24px;">🔥</span>
      <span>StreakKit</span>
      <span class="badge">Developer Console</span>
    </div>
    <div class="tenant-select-bar">
      <span>Tenant API Key:</span>
      <select id="tenantSelect" onchange="onTenantChanged()">
        <option value="pk_live_hujjify_456" selected>Hujjify Music & Lyrics (pk_live_hujjify_456)</option>
        <option value="pk_live_zikfash_123">ZikFash Tailor Ledger (pk_live_zikfash_123)</option>
        <option value="CUSTOM">Custom API Key...</option>
      </select>
      <input type="text" id="customApiKey" placeholder="pk_live_..." style="display: none; width: 220px;" oninput="onCustomKeyInput()">
    </div>
  </header>

  <!-- Navigation Tabs -->
  <div class="tabs-bar">
    <button class="tab-btn active" onclick="switchTab('tab-rules', this)">📋 Rule Studio</button>
    <button class="tab-btn" onclick="switchTab('tab-simulator', this)">⚡ Streak Playground</button>
    <button class="tab-btn" onclick="switchTab('tab-embed', this)">📱 Embed UI Preview</button>
    <button class="tab-btn" onclick="switchTab('tab-docs', this)">💻 SDK Code Snippets</button>
  </div>

  <main>
    <!-- TAB 1: RULE STUDIO -->
    <div id="tab-rules" class="tab-content active">
      <div class="grid-2">
        <!-- Rule List -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Active Streak Rules for Tenant</div>
            <button onclick="refreshRules()">🔄 Refresh</button>
          </div>
          <div id="rulesListContainer">
            <div style="color: var(--text-muted); font-size: 14px;">Loading rules...</div>
          </div>
        </div>

        <!-- Rule Builder / Form -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">✨ Rule Builder & Editor</div>
            <button class="secondary" onclick="resetRuleForm()">Clear Form</button>
          </div>
          <form id="ruleForm" onsubmit="saveRule(event)">
            <div class="form-row">
              <div class="form-group">
                <label>Rule Slug (Unique ID)</label>
                <input type="text" id="ruleSlug" placeholder="e.g. hujjify_playback" required>
              </div>
              <div class="form-group">
                <label>Display Name</label>
                <input type="text" id="ruleName" placeholder="e.g. Daily Music Session" required>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Cadence Type</label>
                <select id="cadenceType">
                  <option value="DAILY">DAILY (Every day)</option>
                  <option value="EXEMPT_DAYS">EXEMPT_DAYS (Skip weekends, etc.)</option>
                  <option value="WEEKLY_QUOTA">WEEKLY_QUOTA</option>
                </select>
              </div>
              <div class="form-group">
                <label>Daily Target Value (Actions needed)</label>
                <input type="number" id="targetValue" value="1" min="1" required>
                <small style="color: var(--text-muted); font-size: 11px;">e.g. 1 song or 1 app open completes today's streak.</small>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Grace Period (Minutes past midnight)</label>
                <input type="number" id="gracePeriodMinutes" value="180" min="0">
                <small style="color: var(--text-muted); font-size: 11px;">180 mins = window stays open until 3:00 AM.</small>
              </div>
              <div class="form-group">
                <label>Max Freeze Shields</label>
                <input type="number" id="maxFreezes" value="2" min="0">
              </div>
            </div>

            <div style="margin-top: 10px;">
              <button type="submit" id="btnSaveRule" style="width: 100%; justify-content: center; padding: 12px;">💾 Save & Publish Rule</button>
            </div>
            <div id="ruleFormFeedback" style="margin-top: 12px; font-size: 13px; font-weight: 600; text-align: center;"></div>
          </form>
        </div>
      </div>
    </div>

    <!-- TAB 2: STREAK PLAYGROUND & SIMULATOR -->
    <div id="tab-simulator" class="tab-content">
      <div class="grid-2">
        <!-- Controls -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">🧪 Live Streak Simulator</div>
          </div>
          <div class="form-group">
            <label>Rule Slug</label>
            <select id="simRuleSelect"></select>
          </div>
          <div class="form-group">
            <label>External User ID</label>
            <input type="text" id="simUserId" value="user_default" required>
          </div>
          <div class="form-group">
            <label>Action Increment Value</label>
            <input type="number" id="simValue" value="1" min="1">
          </div>

          <div style="display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap;">
            <button onclick="simulatePing()" style="flex: 1; justify-content: center; padding: 12px;">
              ⚡ Ping Action (+1)
            </button>
            <button class="secondary" onclick="simulateInspect()" style="flex: 1; justify-content: center; padding: 12px;">
              🔍 Inspect State
            </button>
            <button class="freeze-btn" onclick="simulateGrantFreeze()" style="justify-content: center; padding: 12px;">
              ❄️ Grant Freeze
            </button>
          </div>

          <div style="margin-top: 24px;">
            <label style="display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">
              Raw API Response (JSON)
            </label>
            <pre class="json-box" id="simJsonOutput">// Click "Inspect State" or "Ping Action" to see response</pre>
          </div>
        </div>

        <!-- Live Metrics Visualizer -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">📊 Live Streak Visualizer</div>
          </div>
          <div class="metric-display">
            <div class="streak-flame">🔥</div>
            <div class="streak-number" id="metricStreak">0</div>
            <div class="streak-sub" id="metricSub">Current Day Streak</div>

            <div class="progress-bar-bg">
              <div class="progress-bar-fill" id="metricProgress"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted);">
              <span id="metricProgressText">Progress: 0 / 1</span>
              <span id="metricFreezeText">🛡️ 0 Freezes</span>
            </div>

            <div class="history-dots" id="metricDots">
              <div class="dot missed"></div>
              <div class="dot missed"></div>
              <div class="dot missed"></div>
              <div class="dot missed"></div>
              <div class="dot missed"></div>
              <div class="dot missed"></div>
              <div class="dot missed"></div>
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">Rolling 14-day consistency record</div>
          </div>

          <div style="background: #111e33; border: 1px solid #1e3a8a; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #93c5fd;">
            💡 <strong>Instant Test:</strong> Every time you click <em>"Ping Action"</em>, it sends an idempotent event to the backend. Watch the progress bar fill and unlock today's streak flame!
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 3: EMBED UI PREVIEW -->
    <div id="tab-embed" class="tab-content">
      <div class="card" style="margin-bottom: 20px;">
        <div style="display: flex; gap: 16px; align-items: center; justify-content: space-between;">
          <div>
            <h3 style="font-size: 16px; font-weight: 700; color: #fff;">Universal Embed Sheet</h3>
            <p style="font-size: 13px; color: var(--text-muted);">This is the exact animated Duolingo-style bottom sheet displayed by Android, iOS, or Web iframe.</p>
          </div>
          <button onclick="reloadEmbedFrame()">🔄 Reload Frame</button>
        </div>
      </div>
      <div class="mobile-frame-container">
        <div class="mobile-frame">
          <iframe id="embedFrame" src="/v1/embed/hujjify_playback/user_default"></iframe>
        </div>
      </div>
    </div>

    <!-- TAB 4: SDK CODE SNIPPETS -->
    <div id="tab-docs" class="tab-content">
      <div class="card">
        <div class="card-header">
          <div class="card-title">🚀 2026 Single-File Drop-In Integration</div>
        </div>
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 20px;">
          StreakKit is designed as a true drop-in SDK: zero state-machine boilerplate in your client, single-roundtrip pings with offline resilience, and native embed modals.
        </p>

        <h4 style="color: var(--accent); margin-bottom: 8px; font-size: 14px;">Android (Kotlin) — StreakKit.kt (< 120 lines)</h4>
        <pre class="json-box" style="color: #a5f3fc; max-height: 220px;">// 1. Initialize once in MainActivity.kt
StreakKit.init(context = this)

// 2. Ping whenever the user takes an action (e.g. opens app or plays a song)
StreakKit.ping(context = this, ruleSlug = "hujjify_playback")

// 3. Open the animated dopamine embed modal anywhere
StreakKit.showModal(activity = this, ruleSlug = "hujjify_playback")</pre>

        <h4 style="color: var(--accent); margin: 20px 0 8px 0; font-size: 14px;">Web (TypeScript / React / Vue)</h4>
        <pre class="json-box" style="color: #a5f3fc; max-height: 220px;">import { StreakClient } from '@streakkit/sdk-core';

const client = new StreakClient({ publicKey: 'pk_live_hujjify_456' });

// Ping and get full updated state + embed URL
const state = await client.ping('hujjify_playback', 'user_123');
console.log('Current streak:', state.currentStreak);</pre>
      </div>
    </div>
  </main>

  <script>
    let currentApiKey = 'pk_live_hujjify_456';
    let loadedRules = [];

    function getApiKey() {
      const select = document.getElementById('tenantSelect');
      if (select.value === 'CUSTOM') {
        return document.getElementById('customApiKey').value.trim() || currentApiKey;
      }
      return select.value;
    }

    function onTenantChanged() {
      const select = document.getElementById('tenantSelect');
      const customInput = document.getElementById('customApiKey');
      if (select.value === 'CUSTOM') {
        customInput.style.display = 'inline-block';
        customInput.focus();
      } else {
        customInput.style.display = 'none';
        currentApiKey = select.value;
        refreshRules();
      }
    }

    function onCustomKeyInput() {
      currentApiKey = document.getElementById('customApiKey').value.trim();
      if (currentApiKey) refreshRules();
    }

    function switchTab(tabId, btn) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      btn.classList.add('active');

      if (tabId === 'tab-simulator') {
        simulateInspect();
      } else if (tabId === 'tab-embed') {
        reloadEmbedFrame();
      }
    }

    async function refreshRules() {
      const container = document.getElementById('rulesListContainer');
      const simSelect = document.getElementById('simRuleSelect');
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 14px;">Fetching rules...</div>';

      try {
        const key = getApiKey();
        const res = await fetch('/v1/rules', {
          headers: { 'Authorization': 'Bearer ' + key }
        });
        const data = await res.json();
        loadedRules = data.rules || [];

        simSelect.innerHTML = '';

        if (loadedRules.length === 0) {
          container.innerHTML = '<div style="color: var(--text-muted); font-size: 14px;">No rules found for this tenant. Create one on the right!</div>';
          return;
        }

        let html = '';
        loadedRules.forEach(r => {
          html += \`
            <div class="rule-card">
              <div class="rule-title-row">
                <strong style="color: #fff; font-size: 15px;">\${r.name}</strong>
                <span class="rule-slug">\${r.slug}</span>
              </div>
              <div class="rule-meta">
                <div>Cadence<strong>\${r.cadenceType}</strong></div>
                <div>Target<strong>\${r.targetValue} action/day</strong></div>
                <div>Grace Period<strong>\${r.gracePeriodMinutes} mins</strong></div>
                <div>Freezes<strong>\${r.maxFreezes} max</strong></div>
              </div>
              <div class="rule-actions">
                <button class="secondary" onclick="populateEditRule('\${r.slug}')">✏️ Edit Rule</button>
                <button class="danger-btn" onclick="deleteRule('\${r.slug}')">🗑️ Delete</button>
              </div>
            </div>
          \`;

          const opt = document.createElement('option');
          opt.value = r.slug;
          opt.textContent = \`\${r.name} (\${r.slug})\`;
          simSelect.appendChild(opt);
        });

        container.innerHTML = html;
      } catch (err) {
        container.innerHTML = '<div style="color: var(--danger); font-size: 14px;">Error fetching rules: ' + err.message + '</div>';
      }
    }

    function populateEditRule(slug) {
      const r = loadedRules.find(x => x.slug === slug);
      if (!r) return;
      document.getElementById('ruleSlug').value = r.slug;
      document.getElementById('ruleName').value = r.name;
      document.getElementById('cadenceType').value = r.cadenceType;
      document.getElementById('targetValue').value = r.targetValue;
      document.getElementById('gracePeriodMinutes').value = r.gracePeriodMinutes;
      document.getElementById('maxFreezes').value = r.maxFreezes;
      document.getElementById('btnSaveRule').textContent = '💾 Update Rule (' + r.slug + ')';
    }

    function resetRuleForm() {
      document.getElementById('ruleForm').reset();
      document.getElementById('btnSaveRule').textContent = '💾 Save & Publish Rule';
      document.getElementById('ruleFormFeedback').textContent = '';
    }

    async function saveRule(e) {
      e.preventDefault();
      const feedback = document.getElementById('ruleFormFeedback');
      feedback.style.color = 'var(--text-muted)';
      feedback.textContent = 'Saving rule...';

      const payload = {
        slug: document.getElementById('ruleSlug').value.trim(),
        name: document.getElementById('ruleName').value.trim(),
        cadenceType: document.getElementById('cadenceType').value,
        targetValue: parseInt(document.getElementById('targetValue').value, 10),
        gracePeriodMinutes: parseInt(document.getElementById('gracePeriodMinutes').value, 10),
        maxFreezes: parseInt(document.getElementById('maxFreezes').value, 10),
        autoConsumeFreeze: true,
        milestoneDays: [3, 7, 14, 30, 50, 100, 365]
      };

      try {
        const key = getApiKey();
        const res = await fetch('/v1/rules', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + key,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
          feedback.style.color = 'var(--success)';
          feedback.textContent = 'Rule saved successfully (' + data.status + ')!';
          refreshRules();
        } else {
          feedback.style.color = 'var(--danger)';
          feedback.textContent = data.error || 'Failed to save rule';
        }
      } catch (err) {
        feedback.style.color = 'var(--danger)';
        feedback.textContent = err.message;
      }
    }

    async function deleteRule(slug) {
      if (!confirm('Are you sure you want to delete rule: ' + slug + '?')) return;
      try {
        const key = getApiKey();
        const res = await fetch('/v1/rules/' + slug, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + key }
        });
        refreshRules();
      } catch (err) {
        alert(err.message);
      }
    }

    // Simulator Functions
    async function simulatePing() {
      const ruleSlug = document.getElementById('simRuleSelect').value || 'hujjify_playback';
      const userId = document.getElementById('simUserId').value.trim() || 'user_default';
      const val = parseInt(document.getElementById('simValue').value, 10) || 1;

      try {
        const key = getApiKey();
        const res = await fetch('/v1/ping', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + key,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ruleSlug,
            externalUserId: userId,
            value: val,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
          })
        });
        const data = await res.json();
        document.getElementById('simJsonOutput').textContent = JSON.stringify(data, null, 2);
        updateVisualizer(data);
      } catch (err) {
        document.getElementById('simJsonOutput').textContent = '// Error: ' + err.message;
      }
    }

    async function simulateInspect() {
      const ruleSlug = document.getElementById('simRuleSelect').value || 'hujjify_playback';
      const userId = document.getElementById('simUserId').value.trim() || 'user_default';

      try {
        const key = getApiKey();
        const res = await fetch(\`/v1/streaks/\${encodeURIComponent(ruleSlug)}/\${encodeURIComponent(userId)}\`, {
          headers: { 'Authorization': 'Bearer ' + key }
        });
        const data = await res.json();
        document.getElementById('simJsonOutput').textContent = JSON.stringify(data, null, 2);
        updateVisualizer(data);
      } catch (err) {
        document.getElementById('simJsonOutput').textContent = '// Error: ' + err.message;
      }
    }

    async function simulateGrantFreeze() {
      const ruleSlug = document.getElementById('simRuleSelect').value || 'hujjify_playback';
      const userId = document.getElementById('simUserId').value.trim() || 'user_default';

      try {
        const res = await fetch(\`/v1/streaks/\${encodeURIComponent(ruleSlug)}/\${encodeURIComponent(userId)}/freezes/grant\`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer sk_live_hujjify_secret',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ count: 1 })
        });
        const data = await res.json();
        simulateInspect();
      } catch (err) {
        document.getElementById('simJsonOutput').textContent = '// Error: ' + err.message;
      }
    }

    function updateVisualizer(data) {
      if (!data) return;
      document.getElementById('metricStreak').textContent = data.currentStreak ?? 0;
      const progress = data.todayProgress ?? data.currentWindowProgress ?? 0;
      const target = data.targetValue ?? 1;
      const pct = Math.min(100, Math.round((progress / target) * 100));
      document.getElementById('metricProgress').style.width = pct + '%';
      document.getElementById('metricProgressText').textContent = \`Today's Progress: \${progress} / \${target} (\${pct}%)\`;
      document.getElementById('metricFreezeText').textContent = \`🛡️ \${data.freezes?.available ?? 0} Freezes\`;

      if (Array.isArray(data.recentHistory)) {
        let dotsHtml = '';
        data.recentHistory.slice(-14).forEach(h => {
          const cls = h.state === 'completed' ? 'completed' : (h.state === 'frozen' ? 'frozen' : 'missed');
          dotsHtml += \`<div class="dot \${cls}" title="\${h.date}: \${h.state}"></div>\`;
        });
        document.getElementById('metricDots').innerHTML = dotsHtml;
      }
    }

    function reloadEmbedFrame() {
      const ruleSlug = document.getElementById('simRuleSelect')?.value || 'hujjify_playback';
      const userId = document.getElementById('simUserId')?.value.trim() || 'user_default';
      const frame = document.getElementById('embedFrame');
      frame.src = \`/v1/embed/\${encodeURIComponent(ruleSlug)}/\${encodeURIComponent(userId)}?t=\` + Date.now();
    }

    // Auto-load rules on page start
    window.addEventListener('DOMContentLoaded', refreshRules);
  </script>
</body>
</html>`;
    return reply.type('text/html').send(html);
  });
}
