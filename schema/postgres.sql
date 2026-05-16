-- Create database once (run as superuser), then point DATABASE_URL at it:
--   CREATE DATABASE sena;

CREATE TABLE IF NOT EXISTS soul (
  user_id BIGINT PRIMARY KEY,
  display_name TEXT,
  preferences TEXT NOT NULL DEFAULT '{}',
  facts TEXT NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()))
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES soul (user_id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()))
);

CREATE INDEX IF NOT EXISTS idx_events_user_starts ON events (user_id, starts_at);

CREATE TABLE IF NOT EXISTS pending_confirm (
  user_id BIGINT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()))
);

CREATE TABLE IF NOT EXISTS chat_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()))
);

CREATE INDEX IF NOT EXISTS idx_chat_log_user ON chat_log (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_log_id ON chat_log (id);

CREATE TABLE IF NOT EXISTS telegram_users (
  user_id BIGINT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  username TEXT,
  first_name TEXT,
  first_message_preview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()))
);

CREATE INDEX IF NOT EXISTS idx_telegram_users_status ON telegram_users (status);

CREATE TABLE IF NOT EXISTS telegram_identity_map (
  id BIGSERIAL PRIMARY KEY,
  bot_id BIGINT NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  UNIQUE (bot_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_identity_bot_user ON telegram_identity_map (bot_id, telegram_user_id);

CREATE TABLE IF NOT EXISTS llm_usage (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  day_key TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_day ON llm_usage (day_key);

CREATE TABLE IF NOT EXISTS user_records (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES soul (user_id) ON DELETE CASCADE,
  record_type TEXT NOT NULL,
  occurred_on DATE,
  title TEXT NOT NULL,
  amount DOUBLE PRECISION,
  currency TEXT,
  notes TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()))
);

CREATE INDEX IF NOT EXISTS idx_user_records_user ON user_records (user_id);
CREATE INDEX IF NOT EXISTS idx_user_records_user_type ON user_records (user_id, record_type);
CREATE INDEX IF NOT EXISTS idx_user_records_occurred ON user_records (user_id, occurred_on);

-- Web auth: admin (email) and invite-only Telegram users
CREATE TABLE IF NOT EXISTS app_admins (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()))
);

CREATE TABLE IF NOT EXISTS telegram_allowlist (
  id BIGSERIAL PRIMARY KEY,
  username TEXT,
  telegram_user_id BIGINT UNIQUE,
  soul_user_id BIGINT UNIQUE,
  status TEXT NOT NULL DEFAULT 'invited',
  notes TEXT NOT NULL DEFAULT '',
  invited_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  first_login_at TIMESTAMPTZ,
  last_seen TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_allowlist_username_lower
  ON telegram_allowlist (LOWER(username))
  WHERE username IS NOT NULL AND username <> '';

CREATE INDEX IF NOT EXISTS idx_allowlist_status ON telegram_allowlist (status);

-- Google web login (invite by email)
ALTER TABLE telegram_allowlist ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE telegram_allowlist ADD COLUMN IF NOT EXISTS google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_allowlist_email_lower
  ON telegram_allowlist (LOWER(email))
  WHERE email IS NOT NULL AND email <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_allowlist_google_sub
  ON telegram_allowlist (google_sub)
  WHERE google_sub IS NOT NULL AND google_sub <> '';

CREATE TABLE IF NOT EXISTS web_sessions (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  admin_id BIGINT REFERENCES app_admins (id) ON DELETE CASCADE,
  soul_user_id BIGINT,
  telegram_user_id BIGINT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()))
);

CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions (expires_at);

-- One-time Telegram Login widget payloads (prevents hash replay within auth window)
CREATE TABLE IF NOT EXISTS telegram_login_used (
  login_hash TEXT PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()))
);

CREATE INDEX IF NOT EXISTS idx_telegram_login_used_at ON telegram_login_used (used_at);
