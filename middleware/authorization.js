'use strict';

const tokens = require('../services/tokens');

/**
 * Requires a valid `Authorization: Bearer <token>` header and attaches the
 * decoded payload to req.auth.
 *
 * This replaces the near-duplicate authorizationPutProfile middleware that used
 * to guard the profile routes with slightly different, weaker logic.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({
      error: true,
      message: "Authorization header ('Bearer token') not found",
    });
  }

  if (!/^Bearer \S+$/.test(header)) {
    return res.status(401).json({ error: true, message: 'Authorization header is malformed' });
  }

  const token = header.slice('Bearer '.length);

  try {
    req.auth = tokens.verify(token);
  } catch (err) {
    return res.status(401).json({
      error: true,
      message: err.name === 'TokenExpiredError' ? 'JWT token has expired' : 'Invalid JWT token',
    });
  }

  return next();
}

/**
 * Same checks, but a missing header is allowed. Routes that show more detail to
 * the owner of a record than to an anonymous caller use this.
 *
 * A header that is present but broken is still rejected — quietly treating a
 * malformed token as "anonymous" hides real client bugs.
 */
function optionalAuth(req, res, next) {
  if (!req.headers.authorization) {
    req.auth = null;
    return next();
  }

  return requireAuth(req, res, next);
}

module.exports = requireAuth;
module.exports.requireAuth = requireAuth;
module.exports.optionalAuth = optionalAuth;
