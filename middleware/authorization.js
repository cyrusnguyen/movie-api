'use strict';

const tokens = require('../services/tokens');

/**
 * Response bodies are user-facing, so they say what happened, not how the
 * mechanism works. The scheme and the machine-readable reason belong in the
 * WWW-Authenticate header, which is where RFC 6750 puts them and where an API
 * client will look for them.
 */
function challenge(res, { error, description } = {}) {
  const parts = ['Bearer realm="api"'];

  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description}"`);

  res.set('WWW-Authenticate', parts.join(', '));
}

/**
 * Requires a valid `Authorization: Bearer <token>` header and attaches the
 * decoded payload to req.auth.
 *
 * This replaces the near-duplicate authorizationPutProfile middleware that used
 * to guard the profile routes with slightly different, weaker logic.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !/^Bearer \S+$/.test(header)) {
    challenge(res, header ? { error: 'invalid_request' } : undefined);

    return res.status(401).json({ error: true, message: 'Authentication required' });
  }

  const token = header.slice('Bearer '.length);

  try {
    req.auth = tokens.verify(token);
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';

    challenge(res, { error: 'invalid_token', description: expired ? 'expired' : 'invalid' });

    return res.status(401).json({
      error: true,
      message: expired ? 'Your session has expired' : 'Authentication failed',
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
