'use strict';

require('dotenv').config();

const os = require('os');
const path = require('path');

/**
 * The API ships with a bundled SQLite database so it runs with no external
 * services. Set DATABASE_URL to point it at MySQL instead (the original
 * deployment target).
 */

// Vercel and Lambda both set these. Their filesystem is read-only apart from
// /tmp, so SQLite cannot open a database anywhere inside the deployment.
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function sqliteFile() {
  if (process.env.SQLITE_FILE) {
    return path.resolve(process.env.SQLITE_FILE);
  }

  // On serverless the database is rebuilt from the committed seed on each cold
  // start. Reads are fine; anything written (accounts, profiles) lives only as
  // long as that instance. Set DATABASE_URL for durable storage.
  if (isServerless) {
    return path.join(os.tmpdir(), 'movies.db');
  }

  return path.join(__dirname, 'data', 'movies.db');
}

const SQLITE_FILE = sqliteFile();

const { migrationSource } = require('./db/migrations');

const migrations = {
  // A static source, not a directory scan — see db/migrations/index.js.
  migrationSource,
  tableName: 'knex_migrations',
};

const mysqlConfig = {
  client: 'mysql2',
  connection: process.env.DATABASE_URL,
  // One connection per instance: serverless scales by process, so a large pool
  // per instance just exhausts the database's connection limit.
  pool: isServerless ? { min: 0, max: 1 } : { min: 0, max: 10 },
  migrations,
};

const sqliteConfig = {
  client: 'better-sqlite3',
  connection: { filename: SQLITE_FILE },
  // SQLite has no native "default value" for inserts that omit a column.
  useNullAsDefault: true,
  pool: {
    min: 1,
    max: 1,
    afterCreate(conn, done) {
      // Enforce the foreign keys declared in the migrations.
      conn.pragma('foreign_keys = ON');
      done(null, conn);
    },
  },
  migrations,
};

const config = process.env.DATABASE_URL ? mysqlConfig : sqliteConfig;

module.exports = config;
module.exports.sqliteFile = SQLITE_FILE;
module.exports.isSqlite = !process.env.DATABASE_URL;
module.exports.isServerless = isServerless;
