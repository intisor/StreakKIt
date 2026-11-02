// workers/webhook-dispatcher.ts: At-risk streak scanner & transactional outbox dispatcher
import crypto from 'node:crypto';
import { getDb, DbAdapter } from '../config/db.js';

export interface DispatcherOptions {
  intervalMs?: number;
  db?: DbAdapter;
}

export class WebhookDispatcherWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private db: DbAdapter;
  private intervalMs: number;

  constructor(options: DispatcherOptions = {}) {
    this.intervalMs = options.intervalMs || 60000;
    this.db = options.db || getDb();
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[WebhookDispatcher] Worker started (interval: ${this.intervalMs}ms)`);
    this.runCycle();
    this.timer = setInterval(() => this.runCycle(), this.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    console.log('[WebhookDispatcher] Worker stopped');
  }

  public async runCycle(): Promise<{ atRiskFound: number; webhooksDispatched: number }> {
    let atRiskFound = 0;
    let webhooksDispatched = 0;

    try {
      atRiskFound = await this.scanAtRiskStreaks();
      webhooksDispatched = await this.dispatchOutbox();
    } catch (err) {
      console.error('[WebhookDispatcher] Error during worker cycle:', err);
    }

    return { atRiskFound, webhooksDispatched };
  }

  /**
   * Scans for streaks that are expiring soon and fires 'streak.at_risk' webhooks.
   */
  private async scanAtRiskStreaks(): Promise<number> {
    const now = new Date();
    const nowIso = now.toISOString();

    // Query candidates with window_expires_at_utc set
    const candidates = await this.db.query<any>(
      `SELECT us.*, sr.slug AS rule_slug, sr.at_risk_lead_minutes, t.id AS tenant_id
       FROM user_streaks us
       JOIN streak_rules sr ON us.rule_id = sr.id
       JOIN tenants t ON us.tenant_id = t.id
       WHERE us.current_streak > 0
         AND us.window_expires_at_utc IS NOT NULL
         AND us.window_expires_at_utc > $1`,
      [nowIso]
    );

    let atRiskCount = 0;

    for (const row of candidates) {
      const expiresAt = new Date(row.window_expires_at_utc);
      const leadMs = (row.at_risk_lead_minutes || 120) * 60 * 1000;
      const atRiskThreshold = new Date(now.getTime() + leadMs);

      // Check if within the lead time window and not already notified for this logical date
      if (
        expiresAt.getTime() <= atRiskThreshold.getTime() &&
        row.at_risk_notified_for_date !== row.current_logical_date
      ) {
        await this.db.transaction(async (tx) => {
          // Mark as notified
          await tx.execute(
            'UPDATE user_streaks SET at_risk_notified_for_date = $1 WHERE id = $2',
            [row.current_logical_date, row.id]
          );

          // Enqueue streak.at_risk webhook
          const payload = {
            ruleSlug: row.rule_slug,
            externalUserId: row.external_user_id,
            currentStreak: row.current_streak,
            windowExpiresAtUtc: row.window_expires_at_utc,
            secondsUntilExpiry: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
            leadMinutes: row.at_risk_lead_minutes
          };

          await tx.execute(
            `INSERT INTO webhook_outbox (id, tenant_id, event_type, payload, status)
             VALUES ($1, $2, 'streak.at_risk', $3, 'PENDING')`,
            [crypto.randomUUID(), row.tenant_id, JSON.stringify(payload)]
          );
        });

        atRiskCount++;
      }
    }

    return atRiskCount;
  }

  /**
   * Fetches PENDING webhooks and attempts delivery with HMAC-SHA256 signature.
   */
  private async dispatchOutbox(): Promise<number> {
    const nowIso = new Date().toISOString();

    const pending = await this.db.query<any>(
      `SELECT wo.*, t.webhook_url, t.webhook_secret
       FROM webhook_outbox wo
       JOIN tenants t ON wo.tenant_id = t.id
       WHERE wo.status = 'PENDING'
         AND wo.next_attempt_at <= $1
       LIMIT 50`,
      [nowIso]
    );

    let dispatched = 0;

    for (const item of pending) {
      if (!item.webhook_url) {
        // No webhook URL configured, mark DELIVERED so outbox doesn't clog
        await this.db.execute(
          "UPDATE webhook_outbox SET status = 'DELIVERED' WHERE id = $1",
          [item.id]
        );
        dispatched++;
        continue;
      }

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const rawBody = typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload);

      let signature = '';
      if (item.webhook_secret) {
        signature = crypto
          .createHmac('sha256', item.webhook_secret)
          .update(`${timestamp}.${rawBody}`)
          .digest('hex');
      }

      try {
        const response = await fetch(item.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-StreakKit-Event': item.event_type,
            'X-StreakKit-Timestamp': timestamp,
            'X-StreakKit-Signature': signature
          },
          body: rawBody,
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          await this.db.execute(
            "UPDATE webhook_outbox SET status = 'DELIVERED' WHERE id = $1",
            [item.id]
          );
          dispatched++;
        } else {
          await this.handleFailedAttempt(item);
        }
      } catch (err) {
        await this.handleFailedAttempt(item);
      }
    }

    return dispatched;
  }

  private async handleFailedAttempt(item: any): Promise<void> {
    const attempts = (item.attempts || 0) + 1;
    if (attempts >= 6) {
      // Max attempts reached, mark as FAILED
      await this.db.execute(
        "UPDATE webhook_outbox SET status = 'FAILED', attempts = $1 WHERE id = $2",
        [attempts, item.id]
      );
    } else {
      // Exponential backoff: 2^attempts * 30 seconds
      const backoffSec = Math.pow(2, attempts) * 30;
      const nextAttempt = new Date(Date.now() + backoffSec * 1000).toISOString();
      await this.db.execute(
        'UPDATE webhook_outbox SET attempts = $1, next_attempt_at = $2 WHERE id = $3',
        [attempts, nextAttempt, item.id]
      );
    }
  }
}
