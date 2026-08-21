'use strict';

require('dotenv').config();

const path = require('path');

/**
 * The API ships with a bundled SQLite database so it runs with no external
 * services. Set DATABASE_URL to point it at MySQL instead (the original
 * deployment target).
 */
const SQLITE_FILE = process.env.SQLITE_FILE
  ? path.resolve(process.env.SQLITE_FILE)
  : path.join(__dirname, 'data', 'movies.db');

const migrations = {
  directory: path.join(__dirname, 'db', 'migrations'),
  tableName: 'knex_migrations',
};

const mysqlConfig = {
  client: 'mysql2',
  connection: process.env.DATABASE_URL,
  pool: { min: 0, max: 10 },
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
