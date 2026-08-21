'use strict';

const { PASSWORD } = require('../config');

// Deliberately permissive: enough to catch typos, not an attempt to implement
// RFC 5322. The authoritative check is whether mail to it is deliverable.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateEmail(email) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 320) {
    return 'A valid email address is required';
  }

  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string') {
    return 'Password is required';
  }

  if (password.length < PASSWORD.minLength) {
    return `Password must be at least ${PASSWORD.minLength} characters`;
  }

  if (password.length > PASSWORD.maxLength) {
    return `Password must be at most ${PASSWORD.maxLength} characters`;
  }

  return null;
}

/**
 * True only for a real calendar date written as YYYY-MM-DD. `new Date()` alone
 * is too forgiving — it happily rolls 2023-02-31 over into March.
 */
function isRealDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isPastDate(value) {
  return new Date(`${value}T00:00:00Z`).getTime() < Date.now();
}

module.exports = { validateEmail, validatePassword, isRealDate, isPastDate };
