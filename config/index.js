'use strict';

require('dotenv').config();

const SECRET_HELP =
  'JWT_SECRET must be set to a random string of at least 32 characters.\n' +
  'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
  'then set it in your .env file locally, or in your host\'s environment variables.';

/**
 * Returns a message when JWT_SECRET is unusable, or null when it is fine.
 *
 * Checking without throwing matters on serverless: app.js is imported as the
 * request handler, so an exception at module scope takes the whole function
 * down and the platform serves a blank error page with no explanation. app.js
 * uses this to answer with a clear 503 instead.
 */
function secretProblem() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    return SECRET_HELP;
  }

  return null;
}

/** Throws if the secret is unusable. Used where failing fast is right. */
function requiredSecret() {
  const problem = secretProblem();

  if (problem) {
    throw new Error(problem);
  }

  return process.env.JWT_SECRET;
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

/**
 * Reduces a configured value to the exact string a browser sends as `Origin`.
 *
 * An Origin header is scheme + host + port and nothing else — no path, no
 * trailing slash. But a URL copied from the address bar has a trailing slash,
 * and the comparison in app.js is an exact match, so `https://site.com/` never
 * matches the `https://site.com` the browser actually sends. The request is
 * then refused with a CORS error that says nothing about the stray character.
 *
 * Normalising here makes the setting forgiving of how people really copy URLs.
 */
function toOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    // Not a parseable URL — keep it as typed so a misconfiguration surfaces as
    // a refusal rather than being silently rewritten into something else.
    return value;
  }
}

function corsOrigins() {
  const raw = process.env.CORS_ORIGIN;

  if (!raw) {
    return ['http://localhost:5173', 'http://127.0.0.1:5173'];
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(toOrigin);
}

module.exports = {
  requiredSecret,
  secretProblem,
  SECRET_HELP,
  TOKEN,
  PAGINATION,
  PASSWORD,
  corsOrigins,
  isProduction: process.env.NODE_ENV === 'production',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
};
