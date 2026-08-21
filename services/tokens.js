'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { TOKEN, requiredSecret } = require('../config');

/**
 * Refresh tokens are stored as a SHA-256 digest, never in the clear, so a dump
 * of the tokens table does not hand an attacker a set of live sessions.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function sign(email, expiresInSeconds, extraClaims = {}) {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const token = jwt.sign({ email, exp, ...extraClaims }, requiredSecret(), {
    algorithm: TOKEN.algorithm,
  });

  return { token, exp };
}

/**
 * Verifies a JWT with the algorithm pinned. Without `algorithms`, jsonwebtoken
 * accepts whatever the token's own header claims, which is how algorithm
 * confusion attacks get in.
 */
function verify(token) {
  return jwt.verify(token, requiredSecret(), { algorithms: [TOKEN.algorithm] });
}

function bearerFor(email) {
  const { token } = sign(email, TOKEN.bearerExpiresInSeconds);

  return {
    token,
    token_type: 'Bearer',
    expires_in: TOKEN.bearerExpiresInSeconds,
  };
}

/**
 * Issues a refresh token belonging to `family`. Every refresh mints a new token
 * in the same family and retires the old one; replaying a retired token revokes
 * the family (see consumeRefreshToken).
 */
async function issueRefreshToken(db, email, { longExpiry = false, family } = {}) {
  const expiresIn = longExpiry
    ? TOKEN.longRefreshExpiresInSeconds
    : TOKEN.refreshExpiresInSeconds;

  // jti makes every refresh token unique. Without it, two tokens minted for the
  // same user in the same second carry identical claims and therefore serialise
  // to the identical string — so "rotation" would hand back the token it was
  // supposed to retire, and a replay of the stolen one would still work.
  const { token, exp } = sign(email, expiresIn, { jti: crypto.randomUUID() });

  await db('tokens').insert({
    token_hash: hashToken(token),
    email,
    family: family || crypto.randomUUID(),
    expires_at: exp,
  });

  return {
    token,
    token_type: 'Refresh',
    expires_in: expiresIn,
  };
}

/**
 * Exchanges a refresh token for its stored row and deletes it, so the token
 * cannot be used twice.
 *
 * Returns one of:
 *   { status: 'ok', row }        rotate and issue a new pair
 *   { status: 'expired' }        JWT past its exp, or row past expires_at
 *   { status: 'invalid' }        malformed, wrong signature, or unknown
 *   { status: 'reused' }         valid JWT whose row is already gone
 */
async function consumeRefreshToken(db, token) {
  let payload;

  try {
    payload = verify(token);
  } catch (err) {
    return { status: err.name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }

  const tokenHash = hashToken(token);
  const row = await db('tokens').where({ token_hash: tokenHash }).first();

  if (!row) {
    // The signature is good but we have no record of it: either it was already
    // rotated out (replay) or it was revoked at logout. Nothing to revoke here
    // since the family id lived on the row we no longer have.
    return { status: 'reused' };
  }

  await db('tokens').where({ token_hash: tokenHash }).del();

  if (Number(row.expires_at) <= Math.floor(Date.now() / 1000)) {
    return { status: 'expired' };
  }

  return { status: 'ok', row, email: payload.email };
}

async function revokeFamily(db, family) {
  await db('tokens').where({ family }).del();
}

async function revokeAllForUser(db, email) {
  await db('tokens').where({ email }).del();
}

/** Housekeeping so the tokens table does not grow without bound. */
async function purgeExpired(db) {
  const now = Math.floor(Date.now() / 1000);

  return db('tokens').where('expires_at', '<=', now).del();
}

module.exports = {
  hashToken,
  verify,
  bearerFor,
  issueRefreshToken,
  consumeRefreshToken,
  revokeFamily,
  revokeAllForUser,
  purgeExpired,
};
