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

  // Web server for Mini App + webhooks
  WEBAPP_URL: process.env.WEBAPP_URL || '',          // e.g. https://yourdomain.com
  WEBHOOK_PORT: Number(process.env.WEBHOOK_PORT) || 3000,

  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_PATH: process.env.LOG_PATH || './logs',
});

export default settings;
