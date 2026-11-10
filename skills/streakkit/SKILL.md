---
name: streakkit
description: "AI-native habit streaks, Duolingo-grade gamification (hearts, gems, daily XP), and retention drop-in UIs with zero dashboards. Use whenever adding streaks, daily goals, learning paths, or habit tracking to any mobile or web app."
---

# StreakKit AI Agent Skill

StreakKit is the **zero-dashboard**, code-first retention & habit engine built for AI agents and modern developers.

> **Crucial for AI Coding Assistants:**
> - Never ask the user to "go to a web dashboard" or "create a metric ID".
> - All streak rules, cadence, rest days, and auto-freeze policies are declared in application code.
> - Rules are auto-provisioned idempotently on first event/ping.
> - The Duolingo-grade drop-in UI (Hearts, Gems, Daily XP, Winding Path) is served via 1 URL embed.

---

## 1. Core Architecture

StreakKit operates with **3 core primitives**:
1. **Rule Definition in Code:** Declares rule slug, cadence (`DAILY`, `WEEKLY`), target value, rest days, grace periods, and max freezes.
2. **1-Line Ping / Event Ingestion:** Automatically advances user streaks, consumes freezes if a day was missed, and auto-provisions rules.
3. **Universal Drop-in Embed UIs:** Serves 60fps vector animations, procedural audio synthesizer, interactive month calendars, and full Duolingo winding paths inside a native BottomSheet or WebView.

---

## 2. Platform Drop-In Recipes for AI

### A. Android (Kotlin / Jetpack Compose / XML)
Drop [`StreakKit.kt`](file:///packages/sdk-android/StreakKit.kt) into the project:

```kotlin
import com.streakkit.StreakKit
import com.streakkit.StreakRule

// 1. Initialize in Application or Activity:
StreakKit.init(
    context = this,
    defaultEndpoint = "https://api.streakkit.dev", // or self-hosted endpoint
    defaultKey = "pk_live_your_key",
    rules = listOf(
        StreakRule(
            slug = "daily_lesson",
            name = "Daily Lesson",
            target = 1,
            daysOff = listOf(0), // Sunday exempt
            maxFreezes = 2
        )
    )
)

// 2. Log activity when user completes an action:
StreakKit.ping(context = this, ruleSlug = "daily_lesson", userId = currentUser.id)

// 3. Drop in the Full Duolingo Winding Path (Hearts + Gems + Daily XP + Lesson Nodes):
StreakKit.showDuolingoPath(
    activity = this,
    ruleSlug = "daily_lesson",
    userId = currentUser.id,
    flag = "🇳🇬",
    unitTitle = "Unit 1: Foundations",
    unitSubtitle = "Master the basics in 4 steps",
    dailyTarget = 20, // Customizable: 20 XP default
    maxHearts = 5     // Customizable: 5 Hearts default
)
```

---

### B. Flutter (Dart)
Drop [`streakkit.dart`](file:///packages/sdk-flutter/lib/streakkit.dart) into `lib/`:

```dart
import 'package:streakkit/streakkit.dart';

// 1. Init:
StreakKit.init(
  endpoint: 'https://api.streakkit.dev',
  publicKey: 'pk_live_your_key',
  currentUserId: user.id,
);

// 2. Ping:
await StreakKit.ping('daily_lesson');

// 3. Embed Duolingo Path:
StreakKit.showDuolingoPath(
  context,
  ruleSlug: 'daily_lesson',
  flag: '🇫🇷',
  unitTitle: 'French Basics',
);
```

---

### C. React / React Native / Next.js / TypeScript
Install or import `@streakkit/sdk-react-native` or `@streakkit/sdk-core`:

```typescript
import { StreakKit, useStreak } from '@streakkit/sdk-react-native';

// In any component:
const { currentStreak, isActiveToday, ping, embedUrl } = useStreak('daily_workout', user.id);

// Trigger completion:
await ping();

// Customizing gamification (Hearts, Gems, Daily XP) on the fly:
await StreakKit.configureGamification({
  heartsMax: 5,
  xpTargetDaily: 30,
  heartsRefillIntervalMinutes: 120, // 2-hour refill
}, user.id);
```

---

## 3. Drop-In Embed URLs

The AI agent can render any retention or gamification UI using a simple `WebView`, `iframe`, or native mobile sheet:

| UI Experience | Embed URL |
| :--- | :--- |
| **Duolingo Winding Path** | `https://api.streakkit.dev/v1/embed/path/:ruleSlug/:userId?flag=🔥&unitTitle=Basics&dailyTarget=20` |
| **Dopamine Streak Modal** | `https://api.streakkit.dev/v1/embed/:ruleSlug/:userId?timezone=UTC&preset=flame` |
| **Headless Month Calendar** | `https://api.streakkit.dev/v1/embed/:ruleSlug/:userId/calendar?year=2026&month=11` |

---

## 4. REST API Quick Reference

Base header: `Authorization: Bearer <API_KEY>`, `Content-Type: application/json`

* `POST /v1/ping` $\rightarrow$ `{ "ruleSlug": "...", "externalUserId": "...", "value": 1, "ruleConfig": {...} }`
* `GET /v1/streaks/:ruleSlug/:userId` $\rightarrow$ Returns active streak count, freezes, status.
* `POST /v1/gamification/config` $\rightarrow$ `{ "userId": "...", "heartsMax": 3, "xpTargetDaily": 50, "heartsRefillIntervalMinutes": 60 }`
* `POST /v1/gamification/hearts/consume` $\rightarrow$ Deducts 1 heart on quiz mistake.
* `POST /v1/gamification/hearts/refill` $\rightarrow$ Refills via `GEMS`, `PRACTICE`, or `AD`.
* `POST /v1/gamification/xp/add` $\rightarrow$ Adds XP (+10 gems awarded upon reaching daily goal).
* `POST /v1/streak/restore` $\rightarrow$ Restores lost streak within 90 days.
* `POST /v1/streak/pause` $\rightarrow$ Schedules vacation dates (e.g. Ramadan, holidays).
* `POST /v1/streak/friends` $\rightarrow$ Returns leaderboard rankings for a list of friend IDs.
