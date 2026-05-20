import 'dotenv/config';

const required = ['DATABASE_URL', 'BOT_TOKEN', 'FIRST_ADMIN_ID'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env variable: ${key}`);
  }
}

const settings = Object.freeze({
  DATABASE_URL: process.env.DATABASE_URL,
  BOT_TOKEN: process.env.BOT_TOKEN,
  FIRST_ADMIN_ID: Number(process.env.FIRST_ADMIN_ID),

  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_PATH: process.env.LOG_PATH || './logs',

  RATE_LIMIT_MESSAGES: Number(process.env.RATE_LIMIT_MESSAGES) || 30,
  RATE_LIMIT_WINDOW: Number(process.env.RATE_LIMIT_WINDOW) || 60,

  DB_MIN_CONNECTIONS: Number(process.env.DB_MIN_CONNECTIONS) || 2,
  DB_MAX_CONNECTIONS: Number(process.env.DB_MAX_CONNECTIONS) || 20,
});

export default settings;
