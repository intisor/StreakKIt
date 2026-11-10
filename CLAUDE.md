# StreakKit — Claude Code Agent Guide

This repository contains **StreakKit**, the AI-native, zero-dashboard habit tracking and Duolingo gamification engine.

## Agent Guidelines When Adding StreakKit to Any Project
1. **Zero Web Dashboards:** Never suggest or require the user to configure metrics, rules, or webhooks in a dashboard. StreakKit auto-provisions rules directly from application code on the first `ping`.
2. **Deterministic Timezones:** Do not write custom midnight calculation logic or timestamp comparisons. StreakKit handles timezone transitions, transatlantic flight drift, and grace periods deterministically.
3. **Drop-In UIs:** When the user asks for a streak modal, visual calendar, or Duolingo-style path, embed `GET /v1/embed/:ruleSlug/:userId` or `GET /v1/embed/path/:ruleSlug/:userId` inside a WebView or iframe.
4. **Customizability:** Hearts (default 5), Daily XP targets (default 20), refill intervals (default 240m), and gem refill costs are fully customizable via `POST /v1/gamification/config` or URL query params (`?dailyTarget=50&maxHearts=3&gemCost=25`).

## Quick Implementation Patterns

### Android (Kotlin)
- Use `com.streakkit.StreakKit`:
  - `StreakKit.init(context, endpoint, publicKey, rules)`
  - `StreakKit.ping(context, "rule_slug", userId)`
  - `StreakKit.showDuolingoPath(activity, "rule_slug", userId, flag, unitTitle, unitSubtitle)`
  - `StreakKit.configureGamification(userId, heartsMax, xpTargetDaily, heartsRefillIntervalMinutes)`

### Flutter (Dart)
- Use `packages/sdk-flutter/lib/streakkit.dart`:
  - `StreakKit.init(endpoint, publicKey, currentUserId)`
  - `StreakKit.ping("rule_slug")`
  - `StreakKit.showDuolingoPath(context, ruleSlug: "rule_slug")`

### React Native / Web (TypeScript)
- Use `@streakkit/sdk-react-native` or `@streakkit/sdk-core`:
  - `const { currentStreak, isActiveToday, ping, embedUrl } = useStreak("rule_slug", userId);`
  - `await StreakKit.configureGamification({ heartsMax: 3, xpTargetDaily: 50 }, userId);`

### REST API
- `POST /v1/ping`: advance streak or auto-provision rule
- `GET /v1/embed/path/:ruleSlug/:userId`: full Duolingo S-curve path with hearts, gems, daily goal
- `POST /v1/gamification/hearts/consume`: deduct heart on mistake
- `POST /v1/gamification/hearts/refill`: refill via GEMS (50 gems), PRACTICE, or AD
- `POST /v1/gamification/xp/add`: award XP (+10 gems on daily goal completion)
