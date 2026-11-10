# GitHub Copilot & OpenAI Codex Instructions for StreakKit

When asked to implement streak tracking, daily habits, hearts/lives, or retention features in an application:

## Architecture Principles
- **Zero Dashboards:** StreakKit does not require manual metric or rule configuration on a web console. Rules are declared in code and automatically provisioned by the backend engine on the first event.
- **Pre-built Drop-In UIs:** Never construct custom streak calendar grids or complex SVG bezier winding paths from scratch. Use StreakKit's `/v1/embed/:ruleSlug/:userId` and `/v1/embed/path/:ruleSlug/:userId` endpoints inside a WebView or iframe.

## Standard SDK Usage

### Android (Kotlin)
```kotlin
// In MainActivity or Activity:
StreakKit.ping(this, "daily_reading", userId = "user_42")
StreakKit.showDuolingoPath(this, "daily_reading", userId = "user_42", flag = "📖", unitTitle = "Daily Reading")
```

### Flutter (Dart)
```dart
await StreakKit.ping("daily_reading");
StreakKit.showDuolingoPath(context, ruleSlug: "daily_reading");
```

### TypeScript / React
```typescript
import { StreakKit, useStreak } from '@streakkit/sdk-react-native';

const { currentStreak, isActiveToday, ping } = useStreak("daily_reading");
await ping();
```

## REST API
- `POST /v1/ping`: Log activity or auto-provision rule
- `POST /v1/gamification/config`: Customize heartsMax, xpTargetDaily, refillInterval
- `POST /v1/gamification/hearts/consume`: Deduct heart on mistake
- `POST /v1/gamification/hearts/refill`: Refill hearts via GEMS, PRACTICE, or AD
- `POST /v1/gamification/xp/add`: Award XP (+10 gems on daily target completion)
