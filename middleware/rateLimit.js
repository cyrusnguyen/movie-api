'use strict';

const rateLimit = require('express-rate-limit');

const json = (message) => (req, res) => res.status(429).json({ error: true, message });

const common = {
  standardHeaders: true,
  legacyHeaders: false,
};

/**
 * Credential endpoints. Without this, /user/login accepted unlimited guesses —
 * the web client already had a branch for a 429 the server never sent.
 */
const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  // Only failed attempts count, so a legitimately busy user is not locked out.
  skipSuccessfulRequests: true,
  handler: json('Too many attempts from this address. Please try again later.'),
});

const registerLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  handler: json('Too many accounts created from this address. Please try again later.'),
});

/** Broad backstop for everything else. */
const apiLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 600,
  handler: json('Too many requests. Please slow down.'),
});

module.exports = { authLimiter, registerLimiter, apiLimiter };
