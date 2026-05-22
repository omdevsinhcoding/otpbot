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
    btn_style        VARCHAR(20)  DEFAULT '',
    btn_text         VARCHAR(100) DEFAULT '',
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

CREATE TABLE IF NOT EXISTS user_wallets (
    user_id       BIGINT PRIMARY KEY REFERENCES users(user_id),
    balance       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_deposit DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
    id              SERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id),
    gateway         VARCHAR(50) NOT NULL,
    order_id        VARCHAR(100) UNIQUE,
    amount          DECIMAL(12,2) NOT NULL,
    status          VARCHAR(50) NOT NULL DEFAULT 'pending',
    gateway_txn_id  VARCHAR(255),
    gateway_data    JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    verified_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_txn_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_txn_order ON transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_txn_expiry ON transactions(status, expires_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS deposit_rules (
    id              SERIAL PRIMARY KEY,
    title           VARCHAR(255) NOT NULL,
    emoji           VARCHAR(10) DEFAULT '🎁',
    rule_type       VARCHAR(20) NOT NULL,
    min_deposit     DECIMAL(12,2) DEFAULT 0,
    max_deposit     DECIMAL(12,2) DEFAULT 0,
    rolling_30d_min DECIMAL(12,2) DEFAULT 0,
    rolling_period_days INT DEFAULT 30,
    percentage      DECIMAL(5,2) NOT NULL,
    priority        INT NOT NULL DEFAULT 100,
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    vip_only        BOOLEAN NOT NULL DEFAULT FALSE,
    custom_message  TEXT DEFAULT '',
    expires_at      TIMESTAMPTZ,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deposit_rules_type ON deposit_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_deposit_rules_priority ON deposit_rules(priority);
CREATE INDEX IF NOT EXISTS idx_deposit_rules_enabled ON deposit_rules(is_enabled);

CREATE TABLE IF NOT EXISTS bonus_history (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    order_id        VARCHAR(100),
    rule_id         INT,
    rule_title      VARCHAR(255),
    rule_type       VARCHAR(20) NOT NULL,
    deposit_amount  DECIMAL(12,2) NOT NULL,
    applied_pct     DECIMAL(5,2) NOT NULL,
    bonus_amount    DECIMAL(12,2) NOT NULL,
    rolling_30d     DECIMAL(12,2) DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bonus_history_user ON bonus_history(user_id);
CREATE INDEX IF NOT EXISTS idx_bonus_history_order ON bonus_history(order_id);
CREATE INDEX IF NOT EXISTS idx_bonus_history_created ON bonus_history(created_at);
`;

export const DEFAULT_SETTINGS = {
  force_join_enabled: false,
  welcome_enabled: true,
  maintenance_mode: false,
  bot_name: 'OTPBOT',
  support_username: '',
  paytm_enabled: false,
  paytm_upi_id: '',
  paytm_merchant_key: '',
  paytm_payee_name: 'Paytm Merchant',
  paytm_qr_code: '',
  paytm_time_limit: 600,
  paytm_min_amount: 10,
  paytm_max_amount: 50000,
  paytm_display_name: 'Pay via Automatic Gateway',
  bharatpay_enabled: false,
  bharatpay_merchant_id: '',
  bharatpay_token: '',
  bharatpay_upi_id: '',
  bharatpay_min_amount: 10,
  bharatpay_max_amount: 50000,
  bharatpay_qr_file_id: '',
  bharatpay_display_name: 'Pay via UTR / Transaction ID based Gateway',
  cryptomus_enabled: false,
  cryptomus_api_key: '',
  cryptomus_merchant_id: '',
  cryptomus_min_amount: 100,
  cryptomus_max_amount: 10000,
  tc_enabled: false,
  tc_buttons: [],
  tc_message: "Dear Users,\nThere Are Some Terms & Conditions Given Please Read Carefully, Else If You Face Any Problem Related To Terms And Conditions So We Can't Help You...",
  deposit_benefits_enabled: false,
};

export async function initDb(pool) {
  logger.info('Applying database schema…');

  // Migration: add expires_at column BEFORE schema (index needs it)
  try {
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
  } catch { /* table may not exist yet on fresh install — that's fine */ }

  // Migration: add btn_style, btn_text columns to force_join_channels
  try {
    await pool.query(`ALTER TABLE force_join_channels ADD COLUMN IF NOT EXISTS btn_style VARCHAR(20) DEFAULT ''`);
    await pool.query(`ALTER TABLE force_join_channels ADD COLUMN IF NOT EXISTS btn_text VARCHAR(100) DEFAULT ''`);
  } catch { /* table may not exist yet */ }

  // Migration: add rolling_period_days to deposit_rules
  try {
    await pool.query(`ALTER TABLE deposit_rules ADD COLUMN IF NOT EXISTS rolling_period_days INT DEFAULT 30`);
  } catch { /* table may not exist yet */ }

  await pool.query(SCHEMA_SQL);
  logger.info('Schema applied successfully.');

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await pool.query(
      `INSERT INTO bot_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
  }

  // Fix old default "OTP Bot" → "OTPBOT" (one-time migration)
  await pool.query(
    `UPDATE bot_settings SET value = $1::jsonb WHERE key = 'bot_name' AND value = $2::jsonb`,
    [JSON.stringify('OTPBOT'), JSON.stringify('OTP Bot')]
  );
  logger.info(`Default settings seeded (${Object.keys(DEFAULT_SETTINGS).length} keys).`);
}
