'use strict';

require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 10,
  },
  db: {
    // If DATABASE_URL is set, use PostgreSQL. Otherwise, use SQLite at SQLITE_PATH.
    url: process.env.DATABASE_URL || null,
    sqlitePath: process.env.SQLITE_PATH || './data/notes.db',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 300,
    authWindowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 20,
  },
  about: {
    name: process.env.OWNER_NAME || 'Your Name',
    email: process.env.OWNER_EMAIL || 'you@example.com',
  },
};

if (config.nodeEnv === 'production' && config.jwt.secret === 'dev-only-insecure-secret-change-me') {
  // eslint-disable-next-line no-console
  console.warn(
    '[config] WARNING: JWT_SECRET is not set in production. Set a strong secret via the JWT_SECRET environment variable.'
  );
}

module.exports = config;
