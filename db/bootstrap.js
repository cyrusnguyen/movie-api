'use strict';

/**
 * Brings the database up to date, once per process.
 *
 * `bin/www` used to do this itself, but a serverless platform never runs
 * bin/www — it imports app.js and calls it as a request handler — so a Vercel
 * deployment came up with no tables at all and every query returned
 * "no such table: basics". Both entry points now share this.
 */

const knexConfig = require('../knexfile');

let ready = null;

async function migrateAndSeed(knex, { quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  await knex.migrate.latest();

  const [{ count }] = await knex('basics').count({ count: '*' });

  if (Number(count) === 0) {
    log('Empty catalogue detected — loading bundled sample data…');
    const { seed } = require('../scripts/seed');
    await seed({ quiet: true });
    log('Sample catalogue loaded.');
  }
}

/**
 * Memoised so concurrent requests during a cold start share one run rather than
 * racing each other through the migrations.
 */
function ensureReady(knex, options) {
  if (!ready) {
    ready = migrateAndSeed(knex, options).catch((err) => {
      // Let the next request try again rather than caching the failure forever.
      ready = null;
      throw err;
    });
  }

  return ready;
}

/** Express middleware form, for routes that touch the database. */
function ensureReadyMiddleware(req, res, next) {
  ensureReady(req.db, { quiet: knexConfig.isServerless })
    .then(() => next())
    .catch(next);
}

module.exports = { ensureReady, ensureReadyMiddleware };
