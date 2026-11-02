// packages/sdk-core/src/sync.ts: Network observer, exponential backoff batch sync
import { StorageAdapter, OutboxEvent } from './storage.js';
import { StreakStateDTO } from './optimistic.js';

export interface SyncOptions {
  publicKey: string;
  endpoint: string;
  userId: string;
  timezone: string;
  storage: StorageAdapter;
  onStateSynced?: (states: Record<string, StreakStateDTO>) => void;
}

export class SyncEngine {
  private publicKey: string;
  private endpoint: string;
  private userId: string;
  private timezone: string;
  private storage: StorageAdapter;
  private onStateSynced?: (states: Record<string, StreakStateDTO>) => void;

  private isSyncing = false;
  private backoffMs = 1000;
  private maxBackoffMs = 60000;
  private retryTimer: any = null;

  constructor(options: SyncOptions) {
    this.publicKey = options.publicKey;
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.userId = options.userId;
    this.timezone = options.timezone;
    this.storage = options.storage;
    this.onStateSynced = options.onStateSynced;

    this.setupListeners();
  }

  private setupListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.backoffMs = 1000;
        this.flush();
      });

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            this.flush();
          }
        });
      }
    }
  }

  public async flush(): Promise<void> {
    if (this.isSyncing) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    this.isSyncing = true;
    try {
      const pending = await this.storage.getPendingEvents(50);
      if (pending.length === 0) {
        this.isSyncing = false;
        return;
      }

      const payload = {
        externalUserId: this.userId,
        timezone: this.timezone,
        events: pending.map((e) => ({
          eventId: e.eventId,
          ruleSlug: e.ruleSlug,
          value: e.value,
          occurredAtUtc: e.occurredAtUtc,
          monotonicMs: e.monotonicMs,
          prevEventHash: e.prevEventHash,
          metadata: e.metadata
        }))
      };

      const res = await fetch(`${this.endpoint}/v1/events/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.publicKey}`
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        const syncedIds = pending.map((e) => e.eventId);
        await this.storage.removeEvents(syncedIds);

        // Update cached states
        if (data.states) {
          for (const [slug, state] of Object.entries(data.states)) {
            await this.storage.saveState(slug, state);
          }
          if (this.onStateSynced) {
            this.onStateSynced(data.states);
          }
        }

        this.backoffMs = 1000;
        this.isSyncing = false;

        // Check if more events remain
        const remaining = await this.storage.getPendingEvents(1);
        if (remaining.length > 0) {
          this.flush();
        }
      } else {
        this.handleFailure();
      }
    } catch (err) {
      this.handleFailure();
    } finally {
      this.isSyncing = false;
    }
  }

  private handleFailure(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.flush();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
  }

  public destroy(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
