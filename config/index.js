'use strict';

require('dotenv').config();

function requiredSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be set to a random string of at least 32 characters.\n' +
        'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
        'then put it in your .env file (see .env.example).'
    );
  }

  return secret;
}

/**
 * Token lifetimes are fixed server-side. They used to be read straight from the
 * request body, which let any caller mint a token that never expired.
 */
const TOKEN = {
  bearerExpiresInSeconds: 600, // 10 minutes
  refreshExpiresInSeconds: 86400, // 24 hours
  longRefreshExpiresInSeconds: 604800, // 7 days, when longExpiry is requested
  algorithm: 'HS256',
};

const PAGINATION = {
  defaultPerPage: 20,
  maxPerPage: 100,
};

const PASSWORD = {
  minLength: 8,
  maxLength: 128,
};

function corsOrigins() {
  const raw = process.env.CORS_ORIGIN;

  if (!raw) {
    return ['http://localhost:5173', 'http://127.0.0.1:5173'];
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

module.exports = {
  requiredSecret,
  TOKEN,
  PAGINATION,
  PASSWORD,
  corsOrigins,
  isProduction: process.env.NODE_ENV === 'production',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
};
