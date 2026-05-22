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

  // Web server for webhooks + future mini app
  WEBHOOK_PORT: Number(process.env.WEBHOOK_PORT) || 3000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',  // e.g. https://yourdomain.com
});

export default settings;
