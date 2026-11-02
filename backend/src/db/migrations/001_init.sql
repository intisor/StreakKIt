-- 001_init.sql: StreakKit Core Schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Tenants (Host Applications like ZikFash, Alify, VIIDII)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    public_key VARCHAR(64) UNIQUE NOT NULL,   -- pk_live_... (used by client SDK)
    secret_key_hash VARCHAR(128) NOT NULL,    -- sk_live_... (hashed, used by backend-to-backend)
    webhook_url TEXT,
    webhook_secret VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Streak Rules (Configured per Tenant)
CREATE TABLE IF NOT EXISTS streak_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    slug VARCHAR(64) NOT NULL,                -- e.g., 'daily_tailor_log', 'alify_playback'
    name VARCHAR(120) NOT NULL,
    cadence_type VARCHAR(24) NOT NULL CHECK (cadence_type IN ('DAILY', 'EXEMPT_DAYS', 'WEEKLY_QUOTA')),
    target_value INT NOT NULL DEFAULT 1,      -- e.g., 1 measurement, or 3 songs played
    exempt_days_bitmask INT NOT NULL DEFAULT 0, -- Bitmask for ISO days (Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64). E.g., 64 = Sunday exempt.
    grace_period_minutes INT NOT NULL DEFAULT 120, -- e.g., 120 mins = day extends until 02:00 AM local time
    max_freezes INT NOT NULL DEFAULT 2,
    auto_consume_freeze BOOLEAN NOT NULL DEFAULT TRUE,
    at_risk_lead_minutes INT NOT NULL DEFAULT 120, -- Fire webhook 2 hours before expiry
    milestone_days INT[] NOT NULL DEFAULT '{3,7,14,30,50,100,365}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);

-- 3. User Streak State Ledger
CREATE TABLE IF NOT EXISTS user_streaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL REFERENCES streak_rules(id) ON DELETE CASCADE,
    external_user_id VARCHAR(128) NOT NULL,   -- Host app's user ID
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC', -- Valid IANA timezone, e.g., 'Africa/Lagos'
    
    current_streak INT NOT NULL DEFAULT 0,
    highest_streak INT NOT NULL DEFAULT 0,
    
    -- Logical local date (YYYY-MM-DD) of the most recently completed window
    last_completed_logical_date DATE,
    -- Logical local date (YYYY-MM-DD) of the currently active/in-progress window
    current_logical_date DATE,
    current_window_progress INT NOT NULL DEFAULT 0,
    
    freezes_available INT NOT NULL DEFAULT 0,
    last_freeze_consumed_date DATE,
    
    -- Exact UTC timestamp when the current streak will break if no action is logged
    window_expires_at_utc TIMESTAMPTZ,
    at_risk_notified_for_date DATE,           -- Prevents duplicate "at_risk" webhooks for the same window
    
    -- Rolling 14-day history encoded as JSONB array of objects: [{"date": "2026-11-02", "state": "completed"}]
    recent_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    -- Anti-cheat tracking
    last_client_event_utc TIMESTAMPTZ,
    last_event_hash VARCHAR(64),
    
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(rule_id, external_user_id)
);

-- Critical index for the background webhook worker scanning expiring streaks
CREATE INDEX IF NOT EXISTS idx_user_streaks_at_risk 
ON user_streaks (window_expires_at_utc) 
WHERE current_streak > 0 AND window_expires_at_utc IS NOT NULL;

-- 4. Idempotent Event Audit Log
CREATE TABLE IF NOT EXISTS streak_events (
    event_id UUID PRIMARY KEY,                -- Client-generated UUIDv4/v7 for strict idempotency
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL REFERENCES streak_rules(id) ON DELETE CASCADE,
    external_user_id VARCHAR(128) NOT NULL,
    value INT NOT NULL DEFAULT 1,
    occurred_at_utc TIMESTAMPTZ NOT NULL,     -- Client timestamp (verified)
    received_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    logical_local_date DATE NOT NULL,         -- Computed via timezone + grace_period_minutes
    monotonic_ms BIGINT,                      -- performance.now() from client
    prev_event_hash VARCHAR(64),
    trust_flag VARCHAR(24) NOT NULL DEFAULT 'VERIFIED' CHECK (trust_flag IN ('VERIFIED', 'CLOCK_SKEW_SUSPECTED', 'CLAMPED')),
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_streak_events_user_date 
ON streak_events (rule_id, external_user_id, logical_local_date);

-- 5. Outbound Webhook Outbox (Transactional Outbox Pattern)
CREATE TABLE IF NOT EXISTS webhook_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type VARCHAR(48) NOT NULL,          -- 'streak.incremented' | 'streak.at_risk' | 'streak.frozen' | 'streak.broken' | 'streak.milestone'
    payload JSONB NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED')),
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_outbox_pending 
ON webhook_outbox (next_attempt_at) 
WHERE status = 'PENDING';
