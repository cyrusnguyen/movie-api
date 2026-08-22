'use strict';

/**
 * Runs migrations and loads data/seed/*.json into whichever database the
 * knexfile resolved to.
 *
 *   npm run seed      populate, skipping the catalogue if it already has rows
 *   npm run reset     wipe the catalogue and reload it
 *
 * User accounts are never touched.
 */

const config = require('../knexfile');

/**
 * Required rather than read from disk: a serverless bundler ships what it can
 * see in a `require`, so an fs.readFileSync path is simply absent at runtime.
 */
const SEED = {
  basics: require('../data/seed/basics.json'),
  names: require('../data/seed/names.json'),
  principals: require('../data/seed/principals.json'),
  ratings: require('../data/seed/ratings.json'),
};

function readSeed(name) {
  return SEED[name];
}

/** SQLite caps the number of bound variables per statement, so insert in chunks. */
async function insertInChunks(knex, table, rows, size = 200) {
  for (let i = 0; i < rows.length; i += size) {
    await knex(table).insert(rows.slice(i, i + size));
  }
}

async function seed({ force = false, quiet = false } = {}) {
  const knex = require('knex')(config);
  const log = quiet ? () => {} : (...args) => console.log(...args);

  try {
    await knex.migrate.latest();

    const [{ count }] = await knex('basics').count({ count: '*' });
    const existing = Number(count);

    if (existing > 0 && !force) {
      log(`Catalogue already has ${existing} films — nothing to do. Use "npm run reset" to reload.`);
      return { skipped: true, films: existing };
    }

    if (existing > 0) {
      log('Clearing existing catalogue…');
      // Ordered so foreign keys are never left dangling.
      await knex('ratings').del();
      await knex('principals').del();
      await knex('names').del();
      await knex('basics').del();
    }

    const basics = readSeed('basics');
    const names = readSeed('names');
    const principals = readSeed('principals');
    const ratings = readSeed('ratings');

    await insertInChunks(knex, 'basics', basics);
    await insertInChunks(knex, 'names', names);
    await insertInChunks(knex, 'principals', principals);
    await insertInChunks(knex, 'ratings', ratings);

    log(
      `Seeded ${basics.length} films, ${names.length} people, ` +
        `${principals.length} credits, ${ratings.length} ratings.`
    );

    return { skipped: false, films: basics.length };
  } finally {
    await knex.destroy();
  }
}

module.exports = { seed };

if (require.main === module) {
  const force = process.argv.includes('--force');

  seed({ force })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding failed:', err.message);
      process.exit(1);
    });
}
