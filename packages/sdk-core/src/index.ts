// packages/sdk-core/src/index.ts: Public StreakClient class & Pub/Sub store
import { createStorage, StorageAdapter, OutboxEvent } from './storage.js';
import { computeOptimisticState, StreakStateDTO } from './optimistic.js';
import { SyncEngine } from './sync.js';

export * from './storage.js';
export * from './optimistic.js';
export * from './sync.js';
export * from './micro.js';

export interface StreakClientConfig {
  publicKey: string;
  endpoint: string;
  userId: string;
  timezone?: string;
  storage?: StorageAdapter;
}

type StateListener = (state: StreakStateDTO) => void;

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class StreakClient {
  public readonly publicKey: string;
  public readonly endpoint: string;
  public readonly userId: string;
  public readonly timezone: string;

  private storage: StorageAdapter;
  private syncEngine: SyncEngine;
  private subscribers = new Map<string, Set<StateListener>>();
  private memoryCache = new Map<string, StreakStateDTO>();
  private lastEventHash: string | null = null;

  constructor(config: StreakClientConfig) {
    if (!config.publicKey) throw new Error('StreakClient: publicKey is required');
    if (!config.endpoint) throw new Error('StreakClient: endpoint is required');
    if (!config.userId) throw new Error('StreakClient: userId is required');

    this.publicKey = config.publicKey;
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.userId = config.userId;
    this.timezone =
      config.timezone ||
      (typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : 'UTC');

    this.storage = config.storage || createStorage();
    this.syncEngine = new SyncEngine({
      publicKey: this.publicKey,
      endpoint: this.endpoint,
      userId: this.userId,
      timezone: this.timezone,
      storage: this.storage,
      onStateSynced: (states) => {
        for (const [slug, state] of Object.entries(states)) {
          this.memoryCache.set(slug, state);
          this.notifySubscribers(slug, state);
        }
      }
    });

    // Initial background sync
    this.syncEngine.flush();
  }

  /**
   * Subscribes a listener to live streak state updates.
   * Returns an unsubscribe function.
   */
  public subscribe(ruleSlug: string, callback: StateListener): () => void {
    let set = this.subscribers.get(ruleSlug);
    if (!set) {
      set = new Set();
      this.subscribers.set(ruleSlug, set);
    }
    set.add(callback);

    // If state is already cached, notify immediately
    const cached = this.memoryCache.get(ruleSlug);
    if (cached) {
      callback(cached);
    } else {
      this.storage.getState(ruleSlug).then((saved) => {
        if (saved) {
          this.memoryCache.set(ruleSlug, saved);
          callback(saved);
        } else {
          // Fetch from server
          this.refresh(ruleSlug);
        }
      });
    }

    return () => {
      set?.delete(callback);
    };
  }

  /**
   * Fetches latest state from server or returns cached state.
   */
  public async getState(ruleSlug: string): Promise<StreakStateDTO | null> {
    if (this.memoryCache.has(ruleSlug)) {
      return this.memoryCache.get(ruleSlug)!;
    }
    const saved = await this.storage.getState(ruleSlug);
    if (saved) {
      this.memoryCache.set(ruleSlug, saved);
      return saved;
    }
    return this.refresh(ruleSlug);
  }

  /**
   * Forces a refresh from the server GET /v1/streaks/:ruleSlug/:userId.
   */
  public async refresh(ruleSlug: string): Promise<StreakStateDTO | null> {
    try {
      const url = `${this.endpoint}/v1/streaks/${encodeURIComponent(ruleSlug)}/${encodeURIComponent(this.userId)}?timezone=${encodeURIComponent(this.timezone)}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.publicKey}`
        }
      });

      if (res.ok) {
        const state: StreakStateDTO = await res.json();
        this.memoryCache.set(ruleSlug, state);
        await this.storage.saveState(ruleSlug, state);
        this.notifySubscribers(ruleSlug, state);
        return state;
      }
    } catch {}
    return this.memoryCache.get(ruleSlug) || null;
  }

  /**
   * Synchronously logs an activity:
   * 1. Queues event to offline storage with monotonic timestamp and hash
   * 2. Optimistically updates state and fires UI subscribers in <5ms
   * 3. Triggers background flush to server
   */
  public async ping(
    ruleSlug: string,
    value: number = 1,
    metadata: Record<string, unknown> = {}
  ): Promise<StreakStateDTO> {
    const eventId = generateUUID();
    const occurredAtUtc = new Date().toISOString();
    const monotonicMs = typeof performance !== 'undefined' ? Math.round(performance.now()) : 0;

    // Simple hash chain for offline integrity
    const payloadStr = `${this.lastEventHash || 'ROOT'}:${eventId}:${occurredAtUtc}:${value}`;
    let hash = '';
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const buffer = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(payloadStr)
        );
        hash = Array.from(new Uint8Array(buffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      } catch {
        hash = eventId;
      }
    } else {
      hash = eventId;
    }

    const event: OutboxEvent = {
      eventId,
      ruleSlug,
      value,
      occurredAtUtc,
      monotonicMs,
      prevEventHash: this.lastEventHash,
      metadata
    };
    this.lastEventHash = hash;

    // 1. Write to storage queue
    await this.storage.addEvent(event);

    // 2. Optimistic update
    const current = this.memoryCache.get(ruleSlug) || (await this.storage.getState(ruleSlug));
    const optimisticState = computeOptimisticState(
      current,
      ruleSlug,
      this.userId,
      this.timezone,
      value
    );

    this.memoryCache.set(ruleSlug, optimisticState);
    await this.storage.saveState(ruleSlug, optimisticState);
    this.notifySubscribers(ruleSlug, optimisticState);

    // 3. Trigger async background flush
    this.syncEngine.flush().catch(() => {});

    return optimisticState;
  }

  private notifySubscribers(ruleSlug: string, state: StreakStateDTO): void {
    const set = this.subscribers.get(ruleSlug);
    if (set) {
      for (const callback of set) {
        try {
          callback(state);
        } catch (err) {
          console.error('[StreakClient] Error in subscriber callback:', err);
        }
      }
    }
  }

  public destroy(): void {
    this.syncEngine.destroy();
    this.subscribers.clear();
  }
}

// Global browser registration
if (typeof window !== 'undefined') {
  (window as any).StreakClient = StreakClient;
  (window as any).StreakSDK = {
    Client: StreakClient,
    instance: null as StreakClient | null,
    init: (config: StreakClientConfig) => {
      const client = new StreakClient(config);
      (window as any).StreakSDK.instance = client;
      return client;
    },
    subscribe: (ruleSlug: string, callback: StateListener) => {
      const instance = (window as any).StreakSDK.instance;
      if (!instance) {
        throw new Error('StreakSDK is not initialized. Call StreakSDK.init() first.');
      }
      return instance.subscribe(ruleSlug, callback);
    },
    ping: (ruleSlug: string, value?: number, metadata?: Record<string, unknown>) => {
      const instance = (window as any).StreakSDK.instance;
      if (!instance) {
        throw new Error('StreakSDK is not initialized. Call StreakSDK.init() first.');
      }
      return instance.ping(ruleSlug, value, metadata);
    }
  };
}
