# StreakKit Master Documentation (2026 Developer Manual)

> **StreakKit** is an open-source, code-first retention and gamification engine designed to replace \$299/month commercial platforms (such as Trophy.so and StriveCloud). It requires **zero web dashboards**—all metrics, daily targets, rest days, and auto-freeze policies are declared directly in application code.

---

## 1. Architectural Philosophy: The Code-First Paradigm

Commercial gamification tools force developers to manage state across fragmented web consoles, manually mapping metric keys and syncing webhook URLs.

StreakKit reverses this:
- **Code-First Auto-Provisioning:** Your application source code is the single source of truth. Rules are declared in `StreakKit.init()` as typed objects or JSON and auto-registered by the engine.
- **Client Resilience:** If network connectivity drops, action pings are safely queued on-device in persistent storage and automatically flushed upon reconnection.
- **Embedded Dopamine UI:** A single SDK call mounts a native bottom sheet containing a hardware-accelerated 60fps vector Lottie animation, dynamic streak metrics, and viral share triggers.
- **Anti-Cheat Verifier:** Prevents device clock manipulation using client monotonic timestamps and server-side skew clamping.

---

## 2. Core Mechanics & Mathematical Engine

### A. The Logical Local Date & Grace Period
To prevent users from losing their streak when active past midnight (e.g., 01:30 AM), StreakKit calculates the user's **Logical Local Date** using an adjustable grace period (default: 120 minutes):
$$\text{ShiftedUtc} = \text{occurredAtUtc} - (\text{gracePeriodMinutes} \times 60 \times 1000)$$
$$\text{LogicalDate} = \text{Intl.DateTimeFormat}(\text{userTimezone}, \text{ShiftedUtc})$$

### B. Rest Days (`daysOff`)
Specific weekdays can be designated as non-breaking rest days (`0 = Sunday, 1 = Monday, ..., 6 = Saturday`):
- If a user is inactive on a designated rest day, their streak is preserved without consuming safety freezes.
- If a user completes an activity on a rest day, their streak increments normally.

### C. Auto-Earned Freezes (`freezeAutoEarnDays`)
Rather than requiring manual administrative intervention, the engine automatically calculates and awards safety freeze shields when users hit milestone streak lengths:
$$\text{MilestonesCrossed} = \left\lfloor \frac{\text{newStreak}}{\text{freezeAutoEarnDays}} \right\rfloor - \left\lfloor \frac{\text{previousStreak}}{\text{freezeAutoEarnDays}} \right\rfloor$$
Awards are clamped so the user's balance never exceeds `freezeMaxCount`.

---

## 3. Drop-In SDK Integration (Android Kotlin)

### 3.1 SDK Initialization
Initialize once during application startup (e.g., `MainActivity.onCreate()` or `Application.onCreate()`):

```kotlin
import com.streakkit.StreakKit
import com.streakkit.StreakRule

StreakKit.init(
    context = this,
    defaultEndpoint = "https://streaks.yourdomain.com", // Or "http://10.0.2.2:3000" for local emulator
    defaultKey = "pk_live_hujjify_456",
    rules = listOf(
        StreakRule(
            slug = "hujjify_playback",
            name = "Conscious Audio Streak",
            target = 1,                      // Daily target to extend streak
            cadence = "DAILY",
            gracePeriodMinutes = 120,        // Extends window to 02:00 AM local time
            maxFreezes = 3,                  // Maximum freeze inventory cap
            daysOff = listOf(5),             // Rest on Fridays (5) without breaking
            freezeAutoEarnDays = 7,          // Automatically award +1 freeze every 7 streak days
            restoreWindowDays = 90           // Allow repairing broken streaks up to 90 days
        )
    )
)

// Listen for streak updates across the app
StreakKit.onStateChange { stateJson ->
    val currentStreak = stateJson.optInt("currentStreak", 0)
    Log.d("StreakKit", "Streak updated: $currentStreak days")
}
```

### 3.2 Logging Activity (`ping`)
Record an event when the user completes an eligible habit action:

```kotlin
// Whenever user completes a track or action:
StreakKit.ping(
    context = this,
    ruleSlug = "hujjify_playback",
    userId = currentUserId,
    value = 1
) { updatedState ->
    val completed = updatedState.optJSONObject("todayProgress")?.optBoolean("completed") ?: false
    if (completed) {
        // Trigger celebratory toast or animation
    }
}
```

### 3.3 Displaying the Animated Embed Modal
Mount the animated streak modal inside a native BottomSheetDialog:

```kotlin
// In response to tapping a streak badge or completing an action:
StreakKit.showEmbed(this, "hujjify_playback", currentUserId)
```

---

## 4. Trophy-Grade Moat Features (Developer API)

### 4.1 Streak Repair & Restoration (`StreakKit.restore`)
Enables monetization paywalls (e.g., Pro subscription, microtransaction, or rewarded video ad) to resurrect a broken streak:

```kotlin
StreakKit.restore("hujjify_playback", currentUserId) { success, restoredLength, message ->
    if (success) {
        Toast.makeText(this, "Resurrected your $restoredLength-day streak! 🔥", Toast.LENGTH_LONG).show()
    } else {
        Log.e("StreakKit", "Restore ineligible: $message")
    }
}
```

### 4.2 Vacation & Sick Mode (`StreakKit.pause`)
Allows users to pause streak requirements during travel, holidays, or illness without consuming freeze shields:

```kotlin
StreakKit.pause("hujjify_playback", currentUserId, "2026-12-20", "2026-12-27") { success, _ ->
    if (success) {
        Log.d("StreakKit", "Vacation pause scheduled")
    }
}
```

### 4.3 Batch Friends Leaderboard (`StreakKit.getFriendsStreak`)
Query and rank streaks for a list of friend IDs:

```kotlin
val friendUserIds = listOf("user_omar", "user_zainab", "user_tariq")

StreakKit.getFriendsStreak("hujjify_playback", friendUserIds) { rankingsArray ->
    // Returns JSON array sorted by currentStreak descending:
    // [
    //   { "userId": "user_zainab", "currentStreak": 24, "extendedToday": true },
    //   { "userId": "user_omar", "currentStreak": 12, "extendedToday": false }
    // ]
}
```

### 4.4 Spotify-Style "Wrapped" Year-in-Review (`StreakKit.getWrapped`)
Compile annual activity and engagement metrics:

```kotlin
StreakKit.getWrapped("hujjify_playback", currentUserId, year = 2026) { wrappedJson ->
    val daysActive = wrappedJson?.optInt("daysActive", 0)
    val longestStreak = wrappedJson?.optInt("longestStreak", 0)
    val peakDay = wrappedJson?.optJSONObject("mostActiveDay")?.optString("date")
    val percentile = wrappedJson?.optInt("percentile", 99) // Top 1% of users!
}
```

### 4.5 Per-User Custom Goals (`StreakKit.setUserPreferences`)
Permit individual users to customize their daily targets and rest days:

```kotlin
StreakKit.setUserPreferences(
    ruleSlug = "hujjify_playback",
    userId = currentUserId,
    customTarget = 3,       // Casual = 1, Power user = 3
    daysOff = listOf(0, 6)  // Rest on weekends
)
```

---

## 5. Visual Vector Animation Pipeline

StreakKit embeds a hardware-accelerated `lottie-web` runtime into its universal embed view:

1. **Pre-Bundled Flame:** Uses an optimized 17KB Duolingo-style burning flame vector animation by default.
2. **Custom Developer Animations:** Custom Lottie JSON URLs can be supplied via the `?animationUrl=` query parameter.
3. **Graceful Offline Fallback:** If offline or if the vector CDN is unreachable, a DOM event listener (`data_failed`) immediately reveals an inline CSS/SVG flame without breaking the UI.

---

## 6. HTTP REST API Quick Reference

| Method | Route | Description |
| :--- | :--- | :--- |
| `POST` | `/v1/ping` | Ingests action, auto-provisions rule, and returns state |
| `POST` | `/v1/streak/restore` | Resurrects broken streaks within the 90-day restore window |
| `POST` | `/v1/streak/pause` | Schedules a date-range vacation pause |
| `DELETE`| `/v1/streak/pause/:id` | Cancels an active vacation pause |
| `POST` | `/v1/streak/friends` | Batch query ranking streaks across user IDs |
| `GET` | `/v1/streak/wrapped` | Generates annual Wrapped engagement analytics |
| `POST` | `/v1/streak/preferences` | Sets custom daily target and rest-day overrides |
| `GET` | `/v1/embed/:ruleSlug/:userId` | Serves the universal animated 60fps dopamine HTML UI |
| `POST` | `/v1/rules/sync` | Batch registers/syncs developer rules |
