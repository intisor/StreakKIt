-- 002_trophy_moats.sql: Add support for Rest Days, Auto-Earn Freezes, Streak Restoration, Vacation Pauses, and Per-User Preferences

-- 1. Upgrade streak_rules with Trophy-grade configuration
ALTER TABLE streak_rules ADD COLUMN days_off TEXT DEFAULT '[]';
ALTER TABLE streak_rules ADD COLUMN evaluation_mode VARCHAR(12) NOT NULL DEFAULT 'OR';
ALTER TABLE streak_rules ADD COLUMN freeze_start_count INT NOT NULL DEFAULT 1;
ALTER TABLE streak_rules ADD COLUMN freeze_max_count INT NOT NULL DEFAULT 3;
ALTER TABLE streak_rules ADD COLUMN freeze_auto_earn_days INT NOT NULL DEFAULT 0;
ALTER TABLE streak_rules ADD COLUMN restore_window_days INT NOT NULL DEFAULT 90;

-- 2. Upgrade user_streaks with tracking for last lost streak length & date
ALTER TABLE user_streaks ADD COLUMN last_broken_streak_length INT NOT NULL DEFAULT 0;
ALTER TABLE user_streaks ADD COLUMN last_broken_date DATE;

-- 3. Vacation / Scheduled Pauses
CREATE TABLE IF NOT EXISTS streak_pauses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL REFERENCES streak_rules(id) ON DELETE CASCADE,
    external_user_id VARCHAR(128) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_streak_pauses_user 
ON streak_pauses (rule_id, external_user_id, start_date, end_date);

-- 4. Per-User Preferences (Custom daily target and rest days override)
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL REFERENCES streak_rules(id) ON DELETE CASCADE,
    external_user_id VARCHAR(128) NOT NULL,
    custom_target INT,
    days_off_override TEXT, -- JSON array of [0..6]
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(rule_id, external_user_id)
);

-- 5. Persistent Streak History & Audit Log
CREATE TABLE IF NOT EXISTS streak_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL REFERENCES streak_rules(id) ON DELETE CASCADE,
    external_user_id VARCHAR(128) NOT NULL,
    period_date DATE NOT NULL,
    status VARCHAR(24) NOT NULL, -- 'EXTENDED', 'FROZEN', 'PAUSED', 'BROKEN'
    streak_length INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_streak_history_user_date
ON streak_history (rule_id, external_user_id, period_date);
