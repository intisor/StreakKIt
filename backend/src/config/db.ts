// config/db.ts: Connection pool & database abstraction supporting PostgreSQL & SQLite WAL mode
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DbAdapter {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  get<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<{ rowCount: number }>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  migrate(): Promise<void>;
}

class SqliteAdapter implements DbAdapter {
  private db: any;

  constructor(filePath: string = ':memory:') {
    // Dynamic import of node:sqlite
    const { DatabaseSync } = (process as any).getBuiltinModule('node:sqlite');
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  private normalizeSql(sql: string): string {
    // Replace PostgreSQL $1, $2 with SQLite ?
    return sql.replace(/\$(\d+)/g, '?');
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const normalized = this.normalizeSql(sql);
    const stmt = this.db.prepare(normalized);
    return stmt.all(...params) as T[];
  }

  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  async execute(sql: string, params: any[] = []): Promise<{ rowCount: number }> {
    const normalized = this.normalizeSql(sql);
    const stmt = this.db.prepare(normalized);
    const result = stmt.run(...params);
    return { rowCount: Number(result.changes || 0) };
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const res = await fn(this);
      this.db.exec('COMMIT');
      return res;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async migrate(): Promise<void> {
    // SQLite schema equivalent
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        public_key TEXT UNIQUE NOT NULL,
        secret_key_hash TEXT NOT NULL,
        webhook_url TEXT,
        webhook_secret TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS streak_rules (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        cadence_type TEXT NOT NULL,
        target_value INTEGER NOT NULL DEFAULT 1,
        exempt_days_bitmask INTEGER NOT NULL DEFAULT 0,
        grace_period_minutes INTEGER NOT NULL DEFAULT 120,
        max_freezes INTEGER NOT NULL DEFAULT 2,
        auto_consume_freeze INTEGER NOT NULL DEFAULT 1,
        at_risk_lead_minutes INTEGER NOT NULL DEFAULT 120,
        milestone_days TEXT NOT NULL DEFAULT '[3,7,14,30,50,100,365]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(tenant_id, slug)
      );

      CREATE TABLE IF NOT EXISTS user_streaks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        rule_id TEXT NOT NULL REFERENCES streak_rules(id) ON DELETE CASCADE,
        external_user_id TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        current_streak INTEGER NOT NULL DEFAULT 0,
        highest_streak INTEGER NOT NULL DEFAULT 0,
        last_completed_logical_date TEXT,
        current_logical_date TEXT,
        current_window_progress INTEGER NOT NULL DEFAULT 0,
        freezes_available INTEGER NOT NULL DEFAULT 0,
        last_freeze_consumed_date TEXT,
        window_expires_at_utc TEXT,
        at_risk_notified_for_date TEXT,
        recent_history TEXT NOT NULL DEFAULT '[]',
        last_client_event_utc TEXT,
        last_event_hash TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(rule_id, external_user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_user_streaks_at_risk 
      ON user_streaks (window_expires_at_utc);

      CREATE TABLE IF NOT EXISTS streak_events (
        event_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        rule_id TEXT NOT NULL REFERENCES streak_rules(id) ON DELETE CASCADE,
        external_user_id TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 1,
        occurred_at_utc TEXT NOT NULL,
        received_at_utc TEXT NOT NULL DEFAULT (datetime('now')),
        logical_local_date TEXT NOT NULL,
        monotonic_ms INTEGER,
        prev_event_hash TEXT,
        trust_flag TEXT NOT NULL DEFAULT 'VERIFIED',
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_streak_events_user_date 
      ON streak_events (rule_id, external_user_id, logical_local_date);

      CREATE TABLE IF NOT EXISTS webhook_outbox (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_outbox_pending 
      ON webhook_outbox (next_attempt_at);
    `);
  }
}

class PostgresAdapter implements DbAdapter {
  private pool: any;

  constructor(connectionString: string) {
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString });
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows;
  }

  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  async execute(sql: string, params: any[] = []): Promise<{ rowCount: number }> {
    const res = await this.pool.query(sql, params);
    return { rowCount: res.rowCount ?? 0 };
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txAdapter: DbAdapter = {
        query: (s, p) => client.query(s, p).then((r: any) => r.rows),
        get: (s, p) => client.query(s, p).then((r: any) => (r.rows.length > 0 ? r.rows[0] : null)),
        execute: (s, p) => client.query(s, p).then((r: any) => ({ rowCount: r.rowCount ?? 0 })),
        transaction: () => {
          throw new Error('Nested transactions not supported');
        },
        close: async () => {},
        migrate: async () => {}
      };
      const res = await fn(txAdapter);
      await client.query('COMMIT');
      return res;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async migrate(): Promise<void> {
    const possiblePaths = [
      path.resolve(__dirname, '../db/migrations/001_init.sql'),
      path.resolve(__dirname, '../../src/db/migrations/001_init.sql'),
      path.resolve(process.cwd(), 'src/db/migrations/001_init.sql'),
      path.resolve(process.cwd(), 'backend/src/db/migrations/001_init.sql')
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        const sql = fs.readFileSync(p, 'utf8');
        await this.pool.query(sql);
        break;
      }
    }
  }
}

let activeDb: DbAdapter | null = null;

export function getDb(databaseUrl?: string): DbAdapter {
  if (activeDb) return activeDb;

  const url = databaseUrl || process.env.DATABASE_URL;
  if (url && (url.startsWith('postgres://') || url.startsWith('postgresql://'))) {
    activeDb = new PostgresAdapter(url);
  } else {
    const dbPath = process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'streakkit.db');
    activeDb = new SqliteAdapter(dbPath);
  }

  return activeDb;
}

export function createInMemoryDb(): DbAdapter {
  return new SqliteAdapter(':memory:');
}
