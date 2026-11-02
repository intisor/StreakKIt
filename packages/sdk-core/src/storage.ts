// packages/sdk-core/src/storage.ts: IndexedDB with LocalStorage and memory fallbacks
export interface OutboxEvent {
  eventId: string;
  ruleSlug: string;
  value: number;
  occurredAtUtc: string;
  monotonicMs: number;
  prevEventHash: string | null;
  metadata?: Record<string, unknown>;
}

export interface StorageAdapter {
  addEvent(event: OutboxEvent): Promise<void>;
  getPendingEvents(limit?: number): Promise<OutboxEvent[]>;
  removeEvents(eventIds: string[]): Promise<void>;
  saveState(ruleSlug: string, state: any): Promise<void>;
  getState(ruleSlug: string): Promise<any | null>;
}

const DB_NAME = 'streakkit_db';
const DB_VERSION = 1;
const STORE_EVENTS = 'outbox_events';
const STORE_STATES = 'cached_states';

export class IndexedDbStorage implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB not supported'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result as IDBDatabase;
        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          db.createObjectStore(STORE_EVENTS, { keyPath: 'eventId' });
        }
        if (!db.objectStoreNames.contains(STORE_STATES)) {
          db.createObjectStore(STORE_STATES, { keyPath: 'ruleSlug' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async addEvent(event: OutboxEvent): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, 'readwrite');
      const store = tx.objectStore(STORE_EVENTS);
      const req = store.put(event);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getPendingEvents(limit: number = 50): Promise<OutboxEvent[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, 'readonly');
      const store = tx.objectStore(STORE_EVENTS);
      const req = store.getAll();
      req.onsuccess = () => {
        const res = req.result as OutboxEvent[];
        resolve(res.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async removeEvents(eventIds: string[]): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, 'readwrite');
      const store = tx.objectStore(STORE_EVENTS);
      for (const id of eventIds) {
        store.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveState(ruleSlug: string, state: any): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_STATES, 'readwrite');
      const store = tx.objectStore(STORE_STATES);
      const req = store.put({ ruleSlug, state, cachedAt: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getState(ruleSlug: string): Promise<any | null> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_STATES, 'readonly');
      const store = tx.objectStore(STORE_STATES);
      const req = store.get(ruleSlug);
      req.onsuccess = () => {
        resolve(req.result ? req.result.state : null);
      };
      req.onerror = () => reject(req.error);
    });
  }
}

export class FallbackStorage implements StorageAdapter {
  private events: OutboxEvent[] = [];
  private states = new Map<string, any>();
  private useLocalStorage = typeof localStorage !== 'undefined';

  constructor() {
    if (this.useLocalStorage) {
      try {
        const raw = localStorage.getItem('streakkit_outbox');
        if (raw) this.events = JSON.parse(raw);
      } catch {}
    }
  }

  private persistEvents() {
    if (this.useLocalStorage) {
      try {
        localStorage.setItem('streakkit_outbox', JSON.stringify(this.events));
      } catch {}
    }
  }

  async addEvent(event: OutboxEvent): Promise<void> {
    this.events.push(event);
    this.persistEvents();
  }

  async getPendingEvents(limit: number = 50): Promise<OutboxEvent[]> {
    return this.events.slice(0, limit);
  }

  async removeEvents(eventIds: string[]): Promise<void> {
    const set = new Set(eventIds);
    this.events = this.events.filter((e) => !set.has(e.eventId));
    this.persistEvents();
  }

  async saveState(ruleSlug: string, state: any): Promise<void> {
    this.states.set(ruleSlug, state);
    if (this.useLocalStorage) {
      try {
        localStorage.setItem(`streakkit_state_${ruleSlug}`, JSON.stringify(state));
      } catch {}
    }
  }

  async getState(ruleSlug: string): Promise<any | null> {
    if (this.states.has(ruleSlug)) return this.states.get(ruleSlug);
    if (this.useLocalStorage) {
      try {
        const raw = localStorage.getItem(`streakkit_state_${ruleSlug}`);
        if (raw) return JSON.parse(raw);
      } catch {}
    }
    return null;
  }
}

export function createStorage(): StorageAdapter {
  if (typeof indexedDB !== 'undefined') {
    return new IndexedDbStorage();
  }
  return new FallbackStorage();
}
