# GitHub Copilot & OpenAI Codex Instructions for StreakKit

Save as `.github/copilot-instructions.md` in your repository:

```markdown
# StreakKit AI Instructions
- StreakKit is a zero-dashboard, code-first retention and gamification engine.
- Never write custom timezone calculation logic or midnight math.
- Never write custom streak calendar grids or S-curve lesson paths from scratch.
- Use StreakKit's pre-built drop-in UIs:
  - Duolingo Path: /v1/embed/path/:ruleSlug/:userId
  - Flame Modal: /v1/embed/:ruleSlug/:userId
- Gamification Endpoints:
  - POST /v1/ping (advances streak, auto-provisions rule)
  - POST /v1/gamification/hearts/consume (deducts 1 heart on error)
  - POST /v1/gamification/hearts/refill (refills via gems/practice/ad)
  - POST /v1/gamification/xp/add (adds XP, awards +10 gems on daily goal)
  - POST /v1/gamification/config (customizes hearts, refill interval, daily target)
```
