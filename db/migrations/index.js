'use strict';

/**
 * Migrations as a static list rather than a directory scan.
 *
 * Knex's default migrator reads the directory at runtime. Serverless bundlers
 * only ship files they can see in a `require`, so a scanned directory arrives
 * empty and the deployment comes up with no tables. Requiring each migration by
 * name makes the bundler trace them.
 */

const migrations = {
  '20240101000000_movies.js': require('./20240101000000_movies'),
  '20240101000001_auth.js': require('./20240101000001_auth'),
};

const names = Object.keys(migrations).sort();

const migrationSource = {
  getMigrations: () => Promise.resolve(names),
  getMigrationName: (name) => name,
  getMigration: (name) => Promise.resolve(migrations[name]),
};

module.exports = { migrations, names, migrationSource };
