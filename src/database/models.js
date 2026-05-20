import logger from '../utils/logger.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    user_id        BIGINT       PRIMARY KEY,
    username       VARCHAR(255),
    full_name      VARCHAR(512),
    language_code  VARCHAR(10),
    is_banned      BOOLEAN      NOT NULL DEFAULT FALSE,
    is_premium     BOOLEAN      NOT NULL DEFAULT FALSE,
    referral_code  VARCHAR(50)  UNIQUE,
    referred_by    BIGINT       REFERENCES users(user_id) ON DELETE SET NULL,
    first_seen     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_active    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_users_username    ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users (last_active);
CREATE INDEX IF NOT EXISTS idx_users_first_seen  ON users (first_seen);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users (referred_by);
CREATE INDEX IF NOT EXISTS idx_users_is_active   ON users (is_active);

CREATE TABLE IF NOT EXISTS admins (
    admin_id    BIGINT      PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    role        VARCHAR(50) NOT NULL DEFAULT 'admin',
    permissions JSONB       NOT NULL DEFAULT '{}',
    added_by    BIGINT,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS bot_settings (
    key        VARCHAR(255) PRIMARY KEY,
    value      JSONB        NOT NULL,
    updated_by BIGINT,
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS welcome_messages (
    id             SERIAL       PRIMARY KEY,
    message_text   TEXT         NOT NULL,
    buttons        JSONB        NOT NULL DEFAULT '[]',
    media_type     VARCHAR(50),
    media_file_id  TEXT,
    is_enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
    parse_mode     VARCHAR(20)  NOT NULL DEFAULT 'HTML',
    updated_by     BIGINT,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS force_join_channels (
    id               SERIAL       PRIMARY KEY,
    channel_id       BIGINT       NOT NULL UNIQUE,
    channel_username VARCHAR(255),
    channel_title    VARCHAR(512),
    invite_link      TEXT,
    is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
    added_by         BIGINT,
    added_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broadcasts (
    id             SERIAL       PRIMARY KEY,
    message_text   TEXT,
    buttons        JSONB        NOT NULL DEFAULT '[]',
    media_type     VARCHAR(50),
    media_file_id  TEXT,
    parse_mode     VARCHAR(20)  NOT NULL DEFAULT 'HTML',
    created_by     BIGINT       NOT NULL,
    status         VARCHAR(50)  NOT NULL DEFAULT 'draft',
    total_users    INT          NOT NULL DEFAULT 0,
    sent_count     INT          NOT NULL DEFAULT 0,
    failed_count   INT          NOT NULL DEFAULT 0,
    started_at     TIMESTAMPTZ,
    completed_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_status     ON broadcasts (status);
CREATE INDEX IF NOT EXISTS idx_broadcasts_created_by ON broadcasts (created_by);

CREATE TABLE IF NOT EXISTS broadcast_failures (
    id            SERIAL       PRIMARY KEY,
    broadcast_id  INT          NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
    user_id       BIGINT,
    error_message TEXT,
    retry_count   INT          NOT NULL DEFAULT 0,
    last_retry    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_broadcast_failures_broadcast_id ON broadcast_failures (broadcast_id);

CREATE TABLE IF NOT EXISTS activity_logs (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     BIGINT,
    action_type VARCHAR(100) NOT NULL,
    action_data JSONB        NOT NULL DEFAULT '{}',
    chat_id     BIGINT,
    chat_type   VARCHAR(50),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id     ON activity_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action_type ON activity_logs (action_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at  ON activity_logs (created_at);

CREATE TABLE IF NOT EXISTS admin_logs (
    id             BIGSERIAL    PRIMARY KEY,
    admin_id       BIGINT       NOT NULL,
    admin_username VARCHAR(255),
    action_type    VARCHAR(100) NOT NULL,
    action_data    JSONB        NOT NULL DEFAULT '{}',
    target_user_id BIGINT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_id    ON admin_logs (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action_type ON admin_logs (action_type);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at  ON admin_logs (created_at);

CREATE TABLE IF NOT EXISTS user_sessions (
    id            BIGSERIAL    PRIMARY KEY,
    user_id       BIGINT       NOT NULL,
    session_start TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    session_end   TIMESTAMPTZ,
    actions_count INT          NOT NULL DEFAULT 0,
    last_action   VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id       ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_session_start ON user_sessions (session_start);

CREATE TABLE IF NOT EXISTS financial_logs (
    id               BIGSERIAL      PRIMARY KEY,
    user_id          BIGINT         NOT NULL,
    transaction_type VARCHAR(100)   NOT NULL,
    amount           DECIMAL(15,2)  NOT NULL,
    currency         VARCHAR(10)    NOT NULL DEFAULT 'INR',
    reference_id     VARCHAR(255),
    metadata         JSONB          NOT NULL DEFAULT '{}',
    status           VARCHAR(50)    NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_financial_logs_user_id          ON financial_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_financial_logs_transaction_type ON financial_logs (transaction_type);
CREATE INDEX IF NOT EXISTS idx_financial_logs_status           ON financial_logs (status);
CREATE INDEX IF NOT EXISTS idx_financial_logs_created_at       ON financial_logs (created_at);
`;

export const DEFAULT_SETTINGS = {
  force_join_enabled: false,
  welcome_enabled: true,
  maintenance_mode: false,
  bot_name: 'OTP Bot',
  support_username: '',
  rate_limit_enabled: true,
};

export async function initDb(pool) {
  logger.info('Applying database schema…');
  await pool.query(SCHEMA_SQL);
  logger.info('Schema applied successfully.');

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await pool.query(
      `INSERT INTO bot_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
  }
  logger.info(`Default settings seeded (${Object.keys(DEFAULT_SETTINGS).length} keys).`);
}
