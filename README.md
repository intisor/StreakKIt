# StreakKit Architecture & Developer Documentation (2026 Edition)

> **StreakKit** is a code-first, zero-dashboard gamification and streak infrastructure engine designed for mobile and web applications. It replaces \$299/month platforms (like Trophy.so) with deterministic local-first state machines, universal embed UI, and pure SDK configuration.

---

## 1. Core Philosophy: Why Zero-Dashboard?

Traditional gamification platforms force developers to leave their code editor, navigate complex web consoles, configure metrics, create rewards, and link webhooks across multiple disconnected screens.

**StreakKit flips this model:**
1. **Declared in Code:** Rules, thresholds, rest days, and auto-freeze policies are defined as JSON or typed objects directly in your codebase (`StreakKit.init()`).
2. **Auto-Provisioning:** On application startup or event submission, the SDK automatically registers and syncs rules with the backend.
3. **Drop-in UI:** A single function call opens a 60fps Duolingo-grade animated embed UI inside a native bottom sheet or web modal.
4. **Local & Resilient:** Ping requests are queued offline when network connectivity drops and safely flushed upon reconnection.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Client SDK Tier                       │
│     (Android Kotlin, iOS Swift, TypeScript / React Native)   │
├───────────────────────────────┬─────────────────────────────┤
│ • Offline Action Queue        │ • In-Memory State Cache     │
│ • Universal WebView Bridge    │ • Code-First Rule Auto-Sync │
└───────────────┬───────────────┴──────────────┬──────────────┘
                │ HTTP POST /v1/ping           │ GET /v1/embed/...
                ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      StreakKit Engine                       │
├─────────────────────────────────────────────────────────────┤
│ 1. Time-Window & IANA Timezone Engine (Grace Periods)       │
│ 2. Deterministic State Machine (Evaluator)                  │
│ 3. Anti-Cheat & Monotonic Clock Verifier                    │
│ 4. Trophy-Grade Moat Subsystems:                            │
│    • Auto-Earn Freeze Milestones                            │
│    • 90-Day Broken Streak Restoration                       │
│    • Scheduled Vacation Pauses                              │
│    • Spotify-Style "Wrapped" Year-in-Review Generator       │
│    • Batch Friends Streak Leaderboards                      │
│ 5. Universal Vector Embed UI (Lottie + CSS Fallback)        │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Quickstart: 3-Minute Integration

### Android (Kotlin)
Add `StreakKit.kt` to your project and initialize it once inside your `Application` or `MainActivity`:

```kotlin
// In MainActivity.kt or Application.onCreate()
StreakKit.init(
    context = this,
    defaultEndpoint = "https://streaks.yourdomain.com",
    defaultKey = "pk_live_hujjify_456",
    rules = listOf(
        StreakKit.StreakRule(
            slug = "hujjify_playback",
            name = "Daily Song Playback",
            target = 1,                      // Complete 1 playback daily
            gracePeriodMinutes = 120,        // Day extends until 2:00 AM local time
            maxFreezes = 3,                  // Inventory cap
            daysOff = listOf(0),             // Rest on Sunday (0) without breaking
            freezeAutoEarnDays = 7,          // Earn +1 freeze every 7 consecutive days
            restoreWindowDays = 90           // Allow 90-day streak repair
        )
    )
)
```

### Logging an Activity (The 1-Liner Ping)
Call `StreakKit.ping()` whenever the user performs the action:

```kotlin
// Whenever user plays a track or completes a task:
StreakKit.ping(
    context = this,
    ruleSlug = "hujjify_playback",
    userId = currentUserId
) { updatedState ->
    // Confetti or UI update
    val streak = updatedState.optInt("currentStreak", 0)
    Log.d("StreakKit", "User is on a $streak-day streak!")
}
```

### Showing the Dopamine Streak Modal
Show the animated streak celebration sheet with one line of code:

```kotlin
// In your UI button or track completion listener:
StreakKit.showEmbed(this, "hujjify_playback", currentUserId)
```

---

## 4. Trophy-Grade Moat Features (Zero Dashboard Required)

### 1. Streak Repair / Restoration (`StreakKit.restore`)
When a user breaks their streak, you can monetize the recovery or offer an ad-watch incentive:

```kotlin
// Resurrects a broken streak within the 90-day restore window
StreakKit.restore("hujjify_playback", currentUserId) { success, restoredLength, message ->
    if (success) {
        Toast.makeText(this, "Resurrected your $restoredLength-day streak! 🔥", Toast.LENGTH_LONG).show()
    }
}
```

### 2. Scheduled Vacation Mode (`StreakKit.pause`)
Allows users to pause streak requirements during holidays or sickness without burning safety freezes:

```kotlin
// Pauses streak requirements from Dec 20 through Dec 27
StreakKit.pause("hujjify_playback", currentUserId, "2026-12-20", "2026-12-27") { success, _ ->
    Log.d("StreakKit", "Vacation mode active: $success")
}
```

### 3. Friends Streak Leaderboard (`StreakKit.getFriendsStreak`)
Instant batch query to rank a user's friends list by longest streak:

```kotlin
val friendIds = listOf("user_alex", "user_sam", "user_jordan")

StreakKit.getFriendsStreak("hujjify_playback", friendIds) { rankingsJsonArray ->
    // Returns sorted list: [{ userId: "user_sam", currentStreak: 25, extendedToday: true }, ...]
}
```

### 4. Spotify-Style "Wrapped" Synthesis (`StreakKit.getWrapped`)
Generate shareable year-in-review metrics in one call:

```kotlin
StreakKit.getWrapped("hujjify_playback", currentUserId, year = 2026) { wrapped ->
    val daysActive = wrapped?.optInt("daysActive", 0)
    val longestStreak = wrapped?.optInt("longestStreak", 0)
    val percentile = wrapped?.optInt("percentile", 99) // Top 1% of listeners!
}
```

### 5. Per-User Goal Customization (`StreakKit.setUserPreferences`)
Empower casual vs. power users to customize their daily goals and rest days:

```kotlin
// Casual user sets target to 1; power user sets target to 5
StreakKit.setUserPreferences(
    ruleSlug = "hujjify_playback",
    userId = currentUserId,
    customTarget = 5,
    daysOff = listOf(0, 6) // Rest on weekends
)
```

---

## 5. Visual Layer & Animation Architecture

StreakKit uses a 3-tier animation cascade:

1. **Custom Vector Animation:** Developers can pass a custom Lottie JSON URL via `?animationUrl=https://...` or SDK config.
2. **Built-in Duolingo-Grade Flame:** Defaults to a tested, live vector animation running at 60fps via `lottie-web`.
3. **Graceful Zero-Network Fallback:** If offline or the Lottie CDN is unavailable, it automatically falls back to an inline CSS/SVG glowing flame/ice block.

---

## 6. HTTP REST API Reference

All endpoints accept authentication via `Authorization: Bearer <API_KEY>` (Public Key `pk_live_...` or Secret Key `sk_live_...`).

### State & Ingestion
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/v1/ping` | Ingests a single event, provisions rule if missing, and returns state |
| `POST` | `/v1/events/batch` | Batch ingestion with strict idempotency and clock-tamper protection |
| `GET` | `/v1/streaks/:ruleSlug/:userId` | Retrieves current streak state and 14-day history |
| `GET` | `/v1/embed/:ruleSlug/:userId` | Renders the universal dopamine HTML/Lottie UI |

### Moat & Lifecycle Endpoints
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/v1/streak/restore` | Restores a broken streak within 90 days |
| `POST` | `/v1/streak/pause` | Creates a date-range vacation pause |
| `DELETE`| `/v1/streak/pause/:id` | Cancels a vacation pause |
| `POST` | `/v1/streak/friends` | Returns sorted streak rankings for a list of `userIds` |
| `GET` | `/v1/streak/wrapped` | Compiles year-in-review stats (`daysActive`, `percentile`) |
| `POST` | `/v1/streak/preferences` | Sets custom daily target and rest-day overrides |
| `POST` | `/v1/rules/sync` | Batch registers/syncs developer rules |

---

## 7. Verification & Test Coverage Summary

The system is tested across 4 distinct test suites:

- **Pure Domain Evaluator Tests (`backend/tests/features.unit.test.ts`):** 14/14 passed.
- **Moat Service Integration Tests (`backend/tests/moat-service.unit.test.ts`):** 6/6 passed.
- **Moat REST API E2E Tests (`backend/tests/moat-routes.e2e.test.ts`):** 5/5 passed.
- **Core Engine & Hujjify Simulation Tests (`dist/tests/*.js`):** 24/24 passed.
- **Total:** **49 / 49 automated tests passing with zero failures.**
