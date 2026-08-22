#!/usr/bin/env node
'use strict';

/**
 * Container entry point.
 *
 * Runs as root so it can fix ownership of a freshly-mounted volume, then
 * drops to the unprivileged `node` user in this same process — no su/gosu
 * and no wrapping shell — before starting the server, so the server itself
 * stays PID 1 and receives Docker/Fly's shutdown signals directly instead of
 * a wrapper process having to forward them.
 *
 * A volume (a Fly Volume, a Docker named volume, ...) mounts empty and
 * root-owned, but better-sqlite3 needs to create and write its file as
 * `node`. There is nothing to fix when there is no SQLITE_FILE, e.g. running
 * against DATABASE_URL/MySQL instead.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const sqliteFile = process.env.SQLITE_FILE;

if (sqliteFile) {
  const dir = path.dirname(path.resolve(sqliteFile));

  execFileSync('mkdir', ['-p', dir]);
  execFileSync('chown', ['-R', 'node:node', dir]);
}

if (typeof process.getuid === 'function' && process.getuid() === 0) {
  process.setgid('node');
  process.setuid('node');
}

require('./www');
