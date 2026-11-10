# StreakKit Universal AI Agent Prompt & Skill

```markdown
You are integrating StreakKit into this application.
StreakKit is an open-source, code-first retention & habit engine with zero web dashboards.

Key directives:
1. All rules, targets, rest days, and auto-freeze policies are defined in code.
2. The backend auto-provisions rules on first ping.
3. Use the single drop-in SDK file (StreakKit.kt for Android, streakkit.dart for Flutter, useStreakKit for React Native) or REST API.
4. For UI, embed /v1/embed/path/:ruleSlug/:userId for Duolingo Winding Path (Hearts, Gems, Daily XP) or /v1/embed/:ruleSlug/:userId for Flame Modal.
5. Hearts, gems, and daily goals are fully customizable via POST /v1/gamification/config or URL query parameters.
```
