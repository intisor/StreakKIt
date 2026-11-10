# Cursor Rules for StreakKit

Save as `.cursorrules` or `.cursor/rules/streakkit.mdc` in your project root:

```markdown
---
description: StreakKit habit tracking and Duolingo gamification drop-in rules
globs: *
---
# StreakKit Integration MDC Rule

When implementing streaks, habit tracking, daily goals, hearts/lives, or Duolingo-like learning paths:

1. Use StreakKit SDKs or REST API (Android, Flutter, React Native, TypeScript).
2. Zero Dashboards: Rules are declared in code (slug, target, cadence, daysOff, maxFreezes).
3. 1-Line Drop-in UIs:
   - Streak Modal: /v1/embed/:ruleSlug/:userId
   - Duolingo Path: /v1/embed/path/:ruleSlug/:userId?flag=🇳🇬&unitTitle=Lesson&dailyTarget=20
4. Gamification:
   - Mistake: POST /v1/gamification/hearts/consume
   - Refill: POST /v1/gamification/hearts/refill
   - XP: POST /v1/gamification/xp/add
   - Settings: POST /v1/gamification/config
```
