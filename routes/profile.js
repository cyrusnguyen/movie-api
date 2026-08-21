'use strict';

const express = require('express');

const { optionalAuth, requireAuth } = require('../middleware/authorization');
const { isRealDate, isPastDate } = require('../services/validation');

const router = express.Router();

const PUBLIC_FIELDS = ['email', 'firstName', 'lastName'];
const OWNER_FIELDS = [...PUBLIC_FIELDS, 'dob', 'address'];

const pick = (user, fields) =>
  Object.fromEntries(fields.map((field) => [field, user[field] ?? null]));

/**
 * Anonymous callers and other users see three fields; the owner sees five.
 *
 * The old implementation decided this through an isOwner() helper that
 * referenced `res` from outside its scope — so a bad token threw a
 * ReferenceError instead of replying, and one branch fell through without
 * sending anything at all, leaving the socket open until it timed out.
 */
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const email = String(req.email).toLowerCase();
    const user = await req.db('users').where({ email }).first();

    if (!user) {
      return res.status(404).json({ error: true, message: 'User not found' });
    }

    const isOwner = req.auth?.email?.toLowerCase() === email;

    return res.status(200).json(pick(user, isOwner ? OWNER_FIELDS : PUBLIC_FIELDS));
  } catch (err) {
    return next(err);
  }
});

router.put('/', requireAuth, async (req, res, next) => {
  try {
    const email = String(req.email).toLowerCase();
    const { firstName, lastName, dob, address } = req.body;

    if (!firstName || !lastName || !dob || !address) {
      return res.status(400).json({
        error: true,
        message: 'Request body incomplete: firstName, lastName, dob and address are required.',
      });
    }

    if (
      typeof firstName !== 'string' ||
      typeof lastName !== 'string' ||
      typeof address !== 'string' ||
      typeof dob !== 'string'
    ) {
      return res.status(400).json({
        error: true,
        message: 'Request body invalid: firstName, lastName and address must be strings only.',
      });
    }

    if (!isRealDate(dob)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid input: dob must be a real date in format YYYY-MM-DD.',
      });
    }

    if (!isPastDate(dob)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid input: dob must be a date in the past.',
      });
    }

    // Authorisation before existence: telling a stranger whether an account
    // exists is the same leak the login route was closed against.
    if (req.auth.email?.toLowerCase() !== email) {
      return res.status(403).json({ error: true, message: 'Forbidden' });
    }

    const user = await req.db('users').where({ email }).first();

    if (!user) {
      return res.status(404).json({ error: true, message: 'User not found' });
    }

    await req.db('users').where({ email }).update({
      firstName,
      lastName,
      dob,
      address,
      updated_at: req.db.fn.now(),
    });

    const updated = await req.db('users').where({ email }).first();

    return res.status(200).json(pick(updated, OWNER_FIELDS));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
