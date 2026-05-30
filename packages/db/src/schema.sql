CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS monitored_apis (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  url                  TEXT NOT NULL,
  method               TEXT NOT NULL DEFAULT 'GET' CHECK (method IN ('GET','POST','PUT','PATCH','DELETE','HEAD')),
  headers              JSONB NOT NULL DEFAULT '{}',
  body                 TEXT,
  expected_status      INT NOT NULL DEFAULT 200,
  timeout_ms           INT NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 500 AND 30000),
  interval_sec         INT NOT NULL DEFAULT 60 CHECK (interval_sec >= 10),
  tags                 TEXT[] NOT NULL DEFAULT '{}',
  region               TEXT NOT NULL DEFAULT 'us-east',
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  state                TEXT NOT NULL DEFAULT 'UP' CHECK (state IN ('UP', 'DEGRADED', 'DOWN')),
  consecutive_failures INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_apis_user_id ON monitored_apis(user_id);
CREATE INDEX IF NOT EXISTS idx_apis_active  ON monitored_apis(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_apis_state   ON monitored_apis(state);
CREATE INDEX IF NOT EXISTS idx_apis_tags    ON monitored_apis USING GIN(tags);

CREATE TABLE IF NOT EXISTS health_checks (
  id            BIGSERIAL,
  api_id        UUID NOT NULL REFERENCES monitored_apis(id) ON DELETE CASCADE,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_code   INT,
  response_ms   INT,
  is_success    BOOLEAN NOT NULL,
  error_message TEXT,
  region        TEXT NOT NULL DEFAULT 'us-east',
  PRIMARY KEY (id, checked_at)
);

SELECT create_hypertable('health_checks','checked_at',chunk_time_interval => INTERVAL '7 days',if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_hc_api_time ON health_checks(api_id, checked_at DESC) INCLUDE (is_success, response_ms);

ALTER TABLE health_checks SET (timescaledb.compress, timescaledb.compress_segmentby = 'api_id', timescaledb.compress_orderby = 'checked_at DESC');

SELECT add_compression_policy('health_checks', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy('health_checks', INTERVAL '90 days', if_not_exists => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_metrics
WITH (timescaledb.continuous) AS
SELECT
  api_id,
  time_bucket('1 hour', checked_at)                                    AS bucket,
  COUNT(*)                                                             AS total_checks,
  COUNT(*) FILTER (WHERE is_success)                                   AS successful_checks,
  ROUND(AVG(response_ms)::numeric, 2)                                  AS avg_latency_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_ms)           AS p95_latency_ms,
  MAX(response_ms)                                                     AS max_latency_ms,
  COUNT(*) FILTER (WHERE NOT is_success)                              AS failed_checks
FROM health_checks
GROUP BY api_id, time_bucket('1 hour', checked_at)
WITH NO DATA;

SELECT add_continuous_aggregate_policy('hourly_metrics',start_offset => INTERVAL '3 hours',end_offset => INTERVAL '1 minute',schedule_interval => INTERVAL '1 hour',if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS alert_configs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_id               UUID UNIQUE NOT NULL REFERENCES monitored_apis(id) ON DELETE CASCADE,
  failure_threshold    INT NOT NULL DEFAULT 3 CHECK (failure_threshold >= 1),
  latency_threshold_ms INT NOT NULL DEFAULT 2000,
  cooldown_minutes     INT NOT NULL DEFAULT 15 CHECK (cooldown_minutes >= 1),
  notify_email         TEXT[] NOT NULL DEFAULT '{}',
  notify_webhooks      JSONB NOT NULL DEFAULT '[]',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_history (
  id           BIGSERIAL PRIMARY KEY,
  api_id       UUID NOT NULL REFERENCES monitored_apis(id) ON DELETE CASCADE,
  alert_type   TEXT NOT NULL CHECK (alert_type IN ('failure', 'latency_spike', 'recovery')),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  details      JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_alert_history_api ON alert_history(api_id, triggered_at DESC);

CREATE TABLE IF NOT EXISTS status_pages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug       TEXT UNIQUE NOT NULL,
  title      TEXT NOT NULL,
  api_ids    UUID[] NOT NULL DEFAULT '{}',
  is_public  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_pages_slug    ON status_pages(slug);
CREATE INDEX IF NOT EXISTS idx_status_pages_user_id ON status_pages(user_id);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER trg_apis_updated_at BEFORE UPDATE ON monitored_apis FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER trg_alert_configs_updated_at BEFORE UPDATE ON alert_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
