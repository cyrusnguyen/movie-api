'use strict';

const express = require('express');
const bcrypt = require('bcrypt');

const config = require('../config');
const tokens = require('../services/tokens');
const { validateEmail, validatePassword } = require('../services/validation');
const { authLimiter, registerLimiter } = require('../middleware/rateLimit');

const router = express.Router();

/**
 * One message for "no such account" and "wrong password" alike.
 *
 * The old version said "There's no account associated with this email address"
 * for an unknown email, which turned the login form into an oracle for checking
 * whether any given address had registered.
 */
const BAD_CREDENTIALS = 'Incorrect email or password';

const normaliseEmail = (email) => String(email).trim().toLowerCase();

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: true,
        message: 'Request body incomplete - email and password needed',
      });
    }

    const emailError = validateEmail(email);
    if (emailError) {
      return res.status(400).json({ error: true, message: emailError });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: true, message: passwordError });
    }

    const normalised = normaliseEmail(email);
    const hash = await bcrypt.hash(password, config.bcryptRounds);

    try {
      await req.db('users').insert({ email: normalised, password: hash });
    } catch (err) {
      // users.email carries a unique index, so this is the authoritative
      // duplicate check — a select-then-insert would race.
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: true, message: 'User already exists' });
      }

      throw err;
    }

    return res.status(201).json({ error: false, message: 'User created' });
  } catch (err) {
    return next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password, longExpiry } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: true,
        message: 'Request body incomplete - email and password needed',
      });
    }

    const user = await req.db('users').where({ email: normaliseEmail(email) }).first();

    // Hash against a dummy value when the account does not exist, so the
    // response time does not reveal which addresses are registered.
    const matches = user
      ? await bcrypt.compare(password, user.password)
      : await bcrypt.compare(password, DUMMY_HASH).then(() => false);

    if (!matches) {
      return res.status(401).json({ error: true, message: BAD_CREDENTIALS });
    }

    // Token lifetimes are chosen here, not by the caller. They used to come
    // straight from req.body, which let anyone mint a token valid for decades.
    const bearerToken = tokens.bearerFor(user.email);
    const refreshToken = await tokens.issueRefreshToken(req.db, user.email, {
      longExpiry: longExpiry === true,
    });

    // Opportunistic housekeeping; a failure here must not fail the login.
    tokens.purgeExpired(req.db).catch((err) => console.error('Token purge failed:', err));

    return res.status(200).json({ bearerToken, refreshToken });
  } catch (err) {
    return next(err);
  }
});

router.post('/refresh', authLimiter, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: true,
        message: 'Request body incomplete, refresh token required',
      });
    }

    const result = await tokens.consumeRefreshToken(req.db, refreshToken);

    if (result.status === 'expired') {
      return res.status(401).json({ error: true, message: 'JWT token has expired' });
    }

    if (result.status === 'reused') {
      // A correctly signed token with no row behind it means it was already
      // rotated out. Treat it as a possible theft and cut the session off.
      let payload;
      try {
        payload = tokens.verify(refreshToken);
      } catch {
        payload = null;
      }

      if (payload?.email) {
        await tokens.revokeAllForUser(req.db, payload.email);
      }

      return res.status(401).json({ error: true, message: 'Invalid JWT token' });
    }

    if (result.status !== 'ok') {
      return res.status(401).json({ error: true, message: 'Invalid JWT token' });
    }

    // Rotate: the token just spent is gone, and a fresh one takes its place in
    // the same family. The old code handed the very same refresh token back.
    const { row, email } = result;
    const newRefresh = await tokens.issueRefreshToken(req.db, email, { family: row.family });

    return res.status(200).json({
      bearerToken: tokens.bearerFor(email),
      refreshToken: newRefresh,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: true,
        message: 'Request body incomplete, refresh token required',
      });
    }

    const result = await tokens.consumeRefreshToken(req.db, refreshToken);

    if (result.status === 'invalid') {
      return res.status(401).json({ error: true, message: 'Invalid JWT token' });
    }

    if (result.status === 'expired') {
      return res.status(401).json({ error: true, message: 'JWT token has expired' });
    }

    // Log out everywhere this session reached, not just this one token.
    if (result.status === 'ok') {
      await tokens.revokeFamily(req.db, result.row.family);
    }

    return res.status(200).json({ error: false, message: 'Token successfully invalidated' });
  } catch (err) {
    return next(err);
  }
});

/** bcrypt hash of a value no user can have; used to equalise login timing. */
const DUMMY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

function isUniqueViolation(err) {
  return (
    err.code === 'ER_DUP_ENTRY' || // MySQL
    err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    /UNIQUE constraint failed/i.test(err.message || '')
  );
}

module.exports = router;
