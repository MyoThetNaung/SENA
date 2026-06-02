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

ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS soul_user_id BIGINT;
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS month_key TEXT;

CREATE INDEX IF NOT EXISTS idx_llm_usage_user_month ON llm_usage (soul_user_id, month_key)
  WHERE soul_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  event_type TEXT NOT NULL,
  actor_role TEXT,
  actor_admin_id BIGINT,
  actor_soul_user_id BIGINT,
  target_soul_user_id BIGINT,
  ip_address TEXT,
  user_agent TEXT,
  http_method TEXT,
  http_path TEXT,
  status_code INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_soul ON audit_logs (actor_soul_user_id)
  WHERE actor_soul_user_id IS NOT NULL;

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

-- Google OAuth CSRF state (one-time; survives mobile Safari when cookies do not)
CREATE TABLE IF NOT EXISTS google_oauth_states (
  state_hash TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()))
);

CREATE INDEX IF NOT EXISTS idx_google_oauth_states_created ON google_oauth_states (created_at);

-- Per web-login user: own Telegram bot token(s) and who may chat on each bot
CREATE TABLE IF NOT EXISTS user_telegram_bots (
  id BIGSERIAL PRIMARY KEY,
  owner_soul_user_id BIGINT NOT NULL,
  bot_token TEXT NOT NULL,
  bot_id BIGINT NOT NULL,
  bot_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  UNIQUE (owner_soul_user_id, bot_id),
  UNIQUE (bot_id)
);

CREATE INDEX IF NOT EXISTS idx_user_telegram_bots_owner ON user_telegram_bots (owner_soul_user_id);

CREATE TABLE IF NOT EXISTS user_bot_access (
  id BIGSERIAL PRIMARY KEY,
  owner_soul_user_id BIGINT NOT NULL,
  bot_id BIGINT NOT NULL,
  scoped_user_id BIGINT NOT NULL,
  telegram_user_id BIGINT,
  username TEXT,
  first_name TEXT,
  first_message_preview TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  UNIQUE (owner_soul_user_id, bot_id, scoped_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_bot_access_owner_status ON user_bot_access (owner_soul_user_id, status);

-- Enterprise knowledge (RAG): sources, documents, chunks, ACL principals
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'wiki',
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()))
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES knowledge_sources (id) ON DELETE CASCADE,
  external_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  uri TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_source ON knowledge_documents (source_id);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES knowledge_documents (id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding_json JSONB NOT NULL DEFAULT '[]',
  token_estimate INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document ON knowledge_chunks (document_id);

CREATE TABLE IF NOT EXISTS knowledge_document_acl (
  document_id BIGINT NOT NULL REFERENCES knowledge_documents (id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL,
  principal_value TEXT NOT NULL,
  PRIMARY KEY (document_id, principal_type, principal_value)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_acl_principal
  ON knowledge_document_acl (principal_type, principal_value);

-- Personal assistant: tasks
CREATE TABLE IF NOT EXISTS user_tasks (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES soul (user_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_tasks_user_status ON user_tasks (user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_tasks_user_due ON user_tasks (user_id, due_at)
  WHERE due_at IS NOT NULL;

-- Proactive Telegram reminders (dedupe)
CREATE TABLE IF NOT EXISTS calendar_reminder_sent (
  event_id BIGINT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  lead_minutes INTEGER NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  PRIMARY KEY (event_id, lead_minutes)
);

CREATE TABLE IF NOT EXISTS task_reminder_sent (
  task_id BIGINT NOT NULL REFERENCES user_tasks (id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  lead_minutes INTEGER NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  PRIMARY KEY (task_id, lead_minutes)
);

-- Daily morning briefing (one per user per local date)
CREATE TABLE IF NOT EXISTS daily_briefing_sent (
  user_id BIGINT NOT NULL REFERENCES soul (user_id) ON DELETE CASCADE,
  briefing_date DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  PRIMARY KEY (user_id, briefing_date)
);

-- Per-user connector credentials (encrypted at rest)
CREATE TABLE IF NOT EXISTS user_connector_credentials (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES soul (user_id) ON DELETE CASCADE,
  connector_type TEXT NOT NULL,
  credentials_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now())),
  UNIQUE (user_id, connector_type)
);

CREATE INDEX IF NOT EXISTS idx_user_connector_user ON user_connector_credentials (user_id);
