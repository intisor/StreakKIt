# 🔥 StreakKit (StreakIt)

> **Offline-First Headless Streak Engine & Drop-in Retention SDK**  
> Handle timezone hell, rolling midnight cutoffs, offline syncing, anti-cheat clock verification, streak freezes, and push/webhook alerts without writing custom cron jobs or wrestling with CSS animations.

---

## 🏗️ Architecture: The 3-Layer System

```text
+-------------------------------------------------------------------------+
|                        HOST APPLICATION (Web / Mobile)                  |
|                                                                         |
|  +-----------------------------------+   +---------------------------+  |
|  | UI SKIN LAYER                     |   | Headless Triggers         |  |
|  | <streak-pill />, <streak-modal /> |   | (ZikFash / Alify / Custom)|  |
|  +-----------------+-----------------+   +-------------+-------------+  |
|                    | Subscribes to State               | .ping()        |
|                    v                                   v                |
|  +-------------------------------------------------------------------+  |
|  | HEADLESS CLIENT CORE (< 5KB, Zero-UI, Zero-Dependencies)          |  |
|  | - IndexedDB / LocalStorage Queue & Optimistic State Machine       |  |
|  | - Anti-Cheat Monotonic Clock Delta & Rolling SHA-256 Hash Chain   |  |
|  +---------------------------------+---------------------------------+  |
+------------------------------------|------------------------------------+
                                     | Batched Outbox Sync (HTTPS)
                                     v
+-------------------------------------------------------------------------+
|  STREAK ENGINE BACKEND API                                              |
|                                                                         |
|  [ Ingestion API ] ---> [ Timezone & Rule Evaluator ] ---> [ DB / WAL ] |
|                                    |                                    |
|                                    v                                    |
|                      [ Expiry & Nudge Worker ]                          |
|                 (Fires Webhooks: WhatsApp / Push / Email)               |
+-------------------------------------------------------------------------+
```

---

## 📦 Monorepo Directory Structure

```text
streakkit/
├── backend/                           # High-throughput Streak Engine API & Webhook Dispatcher
│   ├── src/
│   │   ├── config/db.ts               # Connection pool (PostgreSQL 15+ & SQLite WAL mode)
│   │   ├── db/
│   │   │   ├── migrations/001_init.sql # SQL DDL schema & indexes
│   │   │   └── seed.ts                # Preset tenants (ZikFash & Alify)
│   │   ├── domain/
│   │   │   ├── types.ts               # Core interfaces & StreakStateDTO contract
│   │   │   ├── time-window.ts         # IANA timezone & grace period math
│   │   │   ├── evaluator.ts           # Deterministic streak state machine & lazy evaluation
│   │   │   └── anticheat.ts           # Monotonic delta & HMAC hash-chain verifier
│   │   ├── api/
│   │   │   ├── middleware/auth.ts     # pk_live_... & sk_live_... verification
│   │   │   └── routes/
│   │   │       ├── events.ts          # POST /v1/events/batch
│   │   │       ├── state.ts           # GET /v1/streaks/:ruleSlug/:externalUserId
│   │   │       └── freezes.ts         # POST /v1/streaks/:ruleSlug/:externalUserId/freeze & grant
│   │   ├── workers/webhook-dispatcher.ts # Scans at-risk streaks & dispatches signed webhooks
│   │   └── server.ts                  # Fastify HTTP server entry point
│   └── tests/
│       ├── evaluator.test.ts          # Unit tests (DST, freezes, bitmask exempt days, clock skew)
│       └── api.e2e.test.ts            # Integration tests (auth, batch ingestion, idempotency)
├── packages/
│   ├── sdk-core/                      # < 5KB zero-dependency headless client SDK
│   │   ├── src/
│   │   │   ├── storage.ts             # IndexedDB + LocalStorage fallback queue
│   │   │   ├── optimistic.ts          # < 5ms client-side optimistic state calculator
│   │   │   ├── sync.ts                # Online/visibilitychange backoff batch synchronizer
│   │   │   └── index.ts               # Public StreakClient & Pub/Sub store
│   │   └── package.json
│   └── sdk-ui/                        # Web Components / UI Widgets consuming sdk-core
│       ├── src/
│       │   ├── streak-pill.ts         # <streak-pill> custom element (navbar flame & ring)
│       │   └── streak-modal.ts        # <streak-modal> custom element (14-day strip & share)
│       └── package.json
└── demo/
    └── index.html                     # Live verification & interactive UI simulator
```

---

## ⚡ Quick Start

### 1. Install Dependencies & Build
```bash
npm install
npm run build
```

### 2. Run Test Suite
```bash
npm test
```
*Executes all 17 unit and E2E integration tests (DST, timezone math, bitmask exemptions, anti-cheat clock skew detection, duplicate idempotency, and transactional webhook dispatching).*

### 3. Start the Backend API
```bash
npm start
```
Starts the API on `http://localhost:3000` with the embedded SQLite WAL engine (or Postgres if `DATABASE_URL` is configured) and automatically seeds tenant data.

---

## 🎯 Preset Tenants & Real-World Use Cases

The seed script (`backend/src/db/seed.ts`) pre-configures two battle-tested production presets:

### 1. ZikFash Artisan OS (`daily_tailor_log`)
- **Cadence**: `EXEMPT_DAYS` (Sunday exempt via `exempt_days_bitmask: 64`)
- **Target**: 1 shop action per day (e.g., save measurement, update order)
- **Grace Period**: 120 minutes past midnight (night owl buffer up to 02:00 AM)
- **At-Risk Nudge**: 180 minutes before deadline (triggers WhatsApp bot reminder at 9:00 PM WAT)
- **Keys**: Public: `pk_live_zikfash_123` | Secret: `sk_live_zikfash_secret`

### 2. Alify Music & Lyric Ledger (`alify_playback`)
- **Cadence**: `DAILY`
- **Target**: 3 songs observed or 1 semantic lyric note saved
- **Grace Period**: 180 minutes
- **Keys**: Public: `pk_live_alify_456` | Secret: `sk_live_alify_secret`

---

## 📡 API Endpoints

### 1. Ingest Batched Events (Client SDK)
`POST /v1/events/batch`  
**Header**: `Authorization: Bearer pk_live_zikfash_123`

```json
{
  "externalUserId": "tailor_usr_90210",
  "timezone": "Africa/Lagos",
  "events": [
    {
      "eventId": "0192ed44-8a1c-7000-8000-000000000001",
      "ruleSlug": "daily_tailor_log",
      "value": 1,
      "occurredAtUtc": "2026-11-02T09:15:00.000Z",
      "monotonicMs": 482910,
      "metadata": { "source": "measurement_saved", "clientId": "cust_44" }
    }
  ]
}
```

### 2. Get Streak State (Lazy Evaluation)
`GET /v1/streaks/daily_tailor_log/tailor_usr_90210?timezone=Africa/Lagos`  
**Header**: `Authorization: Bearer pk_live_zikfash_123`

**Response (`StreakStateDTO`)**:
```json
{
  "ruleSlug": "daily_tailor_log",
  "externalUserId": "tailor_usr_90210",
  "timezone": "Africa/Lagos",
  "status": "ACTIVE_TODAY",
  "currentStreak": 14,
  "highestStreak": 21,
  "todayProgress": {
    "current": 1,
    "target": 1,
    "completed": true
  },
  "freezes": {
    "available": 2,
    "max": 2,
    "autoConsume": true
  },
  "timing": {
    "currentLogicalDate": "2026-11-02",
    "windowExpiresAtUtc": "2026-11-04T00:59:59.999Z",
    "secondsUntilExpiry": 124500,
    "isExemptToday": false
  },
  "milestone": {
    "justReached": 14,
    "nextMilestone": 30,
    "daysToNextMilestone": 16
  },
  "historyLast14Days": [
    { "date": "2026-10-28", "state": "COMPLETED" },
    { "date": "2026-10-29", "state": "COMPLETED" },
    { "date": "2026-10-30", "state": "FROZEN" },
    { "date": "2026-10-31", "state": "COMPLETED" },
    { "date": "2026-11-01", "state": "EXEMPT" },
    { "date": "2026-11-02", "state": "COMPLETED" }
  ]
}
```

### 3. Grant Freezes (Server-to-Server)
`POST /v1/streaks/:ruleSlug/:externalUserId/freezes/grant`  
**Header**: `Authorization: Bearer sk_live_...`
```json
{ "amount": 1, "reason": "referral_bonus" }
```

---

## 💻 Headless Client Usage (`@streakkit/sdk-core`)

```typescript
import { StreakClient } from '@streakkit/sdk-core';

const streak = new StreakClient({
  publicKey: 'pk_live_zikfash_123',
  endpoint: 'https://api.streakkit.dev',
  userId: 'tailor_usr_90210',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
});

// Subscribe to state updates (fires on local optimistic updates & server sync)
streak.subscribe('daily_tailor_log', (state) => {
  console.log('Current streak:', state.currentStreak);
  console.log('Status:', state.status); // 'ACTIVE_TODAY' | 'AT_RISK' | 'PENDING_TODAY'
});

// Log meaningful activity (<5ms optimistic UI update, queued for offline batch sync)
await streak.ping('daily_tailor_log', 1, { action: 'saved_measurement' });
```

---

## 🎨 Drop-in Web Components (`@streakkit/sdk-ui`)

Drop directly into any HTML page, React, Vue, Svelte, or Blazor app:

```html
<script type="module" src="/path/to/@streakkit/sdk-ui/dist/index.js"></script>

<!-- Navbar Streak Badge -->
<streak-pill rule="daily_tailor_log" theme="dark"></streak-pill>

<!-- Interactive Milestone Modal (opens on click or milestone trigger) -->
<streak-modal rule="daily_tailor_log"></streak-modal>
```

---

## 🛡️ Moats & Anti-Cheat

1. **Monotonic Progression Delta**: Compares `performance.now()` delta against wall clock progression to detect when users roll back their device clock to salvage an expired streak.
2. **Rolling SHA-256 Hash Chain**: Each queued offline event references the cryptographic hash of the previous event.
3. **No Global Midnight Cron Jobs**: Evaluates logical dates relative to user's IANA timezone and configured grace periods lazily upon read/write, avoiding DB lock contention at midnight.
4. **Transactional Outbox**: All notifications (`streak.at_risk`, `streak.milestone`, `streak.frozen`, `streak.broken`, `streak.incremented`) are recorded in `webhook_outbox` inside the state machine transaction and signed with HMAC-SHA256.
