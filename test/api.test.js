'use strict';

/**
 * Regression tests for the behaviours that were broken or unsafe before.
 *
 * Runs against a throwaway SQLite file so it never touches data/movies.db.
 *
 *   npm test
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { after, before, describe, it } = require('node:test');

const TMP_DB = path.join(os.tmpdir(), `movie-api-test-${process.pid}.db`);

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_that_is_long_enough_to_pass_validation';
process.env.SQLITE_FILE = TMP_DB;
delete process.env.DATABASE_URL;

const app = require('../app');
const { seed } = require('../scripts/seed');

let server;
let base;

const json = (path, options = {}) =>
  fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));

const post = (path, body, headers) =>
  json(path, { method: 'POST', body: JSON.stringify(body), headers });

const put = (path, body, headers) =>
  json(path, { method: 'PUT', body: JSON.stringify(body), headers });

const auth = (token) => ({ Authorization: `Bearer ${token}` });

before(async () => {
  await app.knex.migrate.latest();
  await seed({ force: true, quiet: true });

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await app.knex.destroy();
  fs.rmSync(TMP_DB, { force: true });
});

describe('error handling', () => {
  it('returns JSON for an unknown route instead of a rendered stack trace', async () => {
    const res = await json('/definitely-not-a-route');

    assert.equal(res.status, 404);
    assert.equal(res.body.error, true);
    // The old handler called res.render() with no view engine configured,
    // which returned the full stack including absolute server paths.
    assert.ok(!JSON.stringify(res.body).includes('node_modules'));
    assert.ok(!JSON.stringify(res.body).includes('at Function'));
  });
});

describe('movie search', () => {
  it('finds a film by title', async () => {
    const res = await json('/movies/search?title=matrix');

    assert.equal(res.status, 200);
    assert.equal(res.body.data[0].title, 'The Matrix');
    assert.ok(res.body.pagination.total >= 1);
  });

  it('clamps per_page so one request cannot pull the whole table', async () => {
    const res = await json('/movies/search?per_page=999999');

    assert.equal(res.body.pagination.perPage, 100);
  });

  it('rejects a malformed year', async () => {
    const res = await json('/movies/search?year=nineteen');

    assert.equal(res.status, 400);
  });

  it('filters by minimum rating', async () => {
    const res = await json('/movies/search?minRating=9');

    assert.ok(res.body.data.length > 0);
    assert.ok(res.body.data.every((movie) => movie.imdbRating >= 9));
  });

  it('404s for an unknown film', async () => {
    const res = await json('/movies/data/tt0000000');

    assert.equal(res.status, 404);
  });
});

describe('registration', () => {
  it('rejects a short password', async () => {
    const res = await post('/user/register', { email: 'short@test.co', password: 'abc' });

    assert.equal(res.status, 400);
  });

  it('rejects a malformed email', async () => {
    const res = await post('/user/register', { email: 'nope', password: 'longenoughpassword' });

    assert.equal(res.status, 400);
  });

  it('creates a user and rejects the duplicate', async () => {
    const created = await post('/user/register', { email: 'dupe@test.co', password: 'longenoughpassword' });
    assert.equal(created.status, 201);

    const again = await post('/user/register', { email: 'dupe@test.co', password: 'longenoughpassword' });
    assert.equal(again.status, 409);
  });
});

describe('login', () => {
  const account = { email: 'login@test.co', password: 'longenoughpassword' };

  before(async () => {
    await post('/user/register', account);
  });

  it('gives the same message for an unknown user and a wrong password', async () => {
    const unknown = await post('/user/login', { email: 'ghost@test.co', password: 'longenoughpassword' });
    const wrong = await post('/user/login', { email: account.email, password: 'wrongpassword123' });

    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    // Different messages here turned the login form into a registered-address oracle.
    assert.equal(unknown.body.message, wrong.body.message);
  });

  it('ignores a client-supplied token lifetime', async () => {
    const res = await post('/user/login', {
      ...account,
      bearerExpiresInSeconds: 3153600000,
      refreshExpiresInSeconds: 3153600000,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.bearerToken.expires_in, 600);
    assert.equal(res.body.refreshToken.expires_in, 86400);
  });
});

describe('refresh token rotation', () => {
  const account = { email: 'rotate@test.co', password: 'longenoughpassword' };

  it('issues a new token and rejects the spent one', async () => {
    await post('/user/register', account);
    const login = await post('/user/login', account);
    const first = login.body.refreshToken.token;

    const refreshed = await post('/user/refresh', { refreshToken: first });
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.body.refreshToken.token, first);

    const replay = await post('/user/refresh', { refreshToken: first });
    assert.equal(replay.status, 401);
  });

  it('revokes the whole family when a spent token is replayed', async () => {
    const email = 'family@test.co';
    await post('/user/register', { email, password: 'longenoughpassword' });
    const login = await post('/user/login', { email, password: 'longenoughpassword' });

    const first = login.body.refreshToken.token;
    const second = (await post('/user/refresh', { refreshToken: first })).body.refreshToken.token;

    // An attacker replays the stolen, already-rotated token.
    await post('/user/refresh', { refreshToken: first });

    // The legitimate holder's current token must now be dead too.
    const legitimate = await post('/user/refresh', { refreshToken: second });
    assert.equal(legitimate.status, 401);
  });

  it('does not store the raw refresh token', async () => {
    const email = 'hashed@test.co';
    await post('/user/register', { email, password: 'longenoughpassword' });
    const login = await post('/user/login', { email, password: 'longenoughpassword' });

    const rows = await app.knex('tokens').where({ email });
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.token_hash !== login.body.refreshToken.token));
  });
});

describe('authorization', () => {
  it('rejects a request with no token', async () => {
    const res = await json('/people/nm9000001');

    assert.equal(res.status, 401);
  });

  it('rejects an alg=none forged token', async () => {
    const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const forged = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      email: 'login@test.co',
      exp: 9999999999,
    })}.`;

    const res = await json('/people/nm9000001', { headers: auth(forged) });

    assert.equal(res.status, 401);
  });

  it('accepts a genuine token', async () => {
    const login = await post('/user/login', { email: 'login@test.co', password: 'longenoughpassword' });
    const res = await json('/people/nm9000001', { headers: auth(login.body.bearerToken.token) });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.roles));
  });
});

describe('profile', () => {
  const owner = { email: 'owner@test.co', password: 'longenoughpassword' };
  const other = { email: 'other@test.co', password: 'longenoughpassword' };
  let ownerToken;
  let otherToken;

  before(async () => {
    await post('/user/register', owner);
    await post('/user/register', other);
    ownerToken = (await post('/user/login', owner)).body.bearerToken.token;
    otherToken = (await post('/user/login', other)).body.bearerToken.token;
  });

  it('shows three fields to an anonymous caller', async () => {
    const res = await json(`/user/${owner.email}/profile`);

    assert.deepEqual(Object.keys(res.body).sort(), ['email', 'firstName', 'lastName']);
  });

  it('shows five fields to the owner', async () => {
    const res = await json(`/user/${owner.email}/profile`, { headers: auth(ownerToken) });

    assert.deepEqual(
      Object.keys(res.body).sort(),
      ['address', 'dob', 'email', 'firstName', 'lastName']
    );
  });

  it('shows only three fields to a different signed-in user', async () => {
    const res = await json(`/user/${owner.email}/profile`, { headers: auth(otherToken) });

    assert.deepEqual(Object.keys(res.body).sort(), ['email', 'firstName', 'lastName']);
  });

  it('answers a malformed token instead of hanging', async () => {
    // isOwner() used to reference an out-of-scope `res`, throwing a
    // ReferenceError and leaving the request without a reply.
    const res = await json(`/user/${owner.email}/profile`, { headers: auth('not.a.token') });

    assert.equal(res.status, 401);
  });

  it('forbids updating someone else’s profile', async () => {
    const res = await put(
      `/user/${owner.email}/profile`,
      { firstName: 'E', lastName: 'V', dob: '1990-01-01', address: 'x' },
      auth(otherToken)
    );

    assert.equal(res.status, 403);
  });

  it('rejects a date that does not exist', async () => {
    const res = await put(
      `/user/${owner.email}/profile`,
      { firstName: 'A', lastName: 'B', dob: '2023-02-31', address: 'x' },
      auth(ownerToken)
    );

    assert.equal(res.status, 400);
  });

  it('updates the owner’s profile', async () => {
    const res = await put(
      `/user/${owner.email}/profile`,
      { firstName: 'Minh', lastName: 'Nguyen', dob: '1998-02-06', address: 'Brisbane QLD' },
      auth(ownerToken)
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.firstName, 'Minh');
    assert.equal(res.body.address, 'Brisbane QLD');
  });
});

describe('CORS configuration', () => {
  it('tolerates a trailing slash and a comma-separated list', () => {
    // A URL copied from the address bar carries a trailing slash, but the
    // Origin header never does. Without normalising, the exact-match check in
    // app.js silently refuses the very site the setting was meant to allow.
    const original = process.env.CORS_ORIGIN;

    const load = () => {
      delete require.cache[require.resolve('../config')];
      return require('../config').corsOrigins();
    };

    try {
      process.env.CORS_ORIGIN = 'https://site.com/';
      assert.deepEqual(load(), ['https://site.com']);

      process.env.CORS_ORIGIN = 'https://a.vercel.app/, https://b.example.com';
      assert.deepEqual(load(), ['https://a.vercel.app', 'https://b.example.com']);
    } finally {
      process.env.CORS_ORIGIN = original;
      delete require.cache[require.resolve('../config')];
    }
  });
});

describe('API reference page', () => {
  // node:http rather than fetch: Host is a forbidden header for fetch, and
  // setting it is the whole point of this test.
  const getWithHost = (host) =>
    new Promise((resolve, reject) => {
      const { port } = server.address();
      const req = http.request(
        { host: '127.0.0.1', port, path: '/', method: 'GET', headers: { Host: host } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });

  it('does not let the Host header inject script into the inlined spec', async () => {
    // JSON.stringify escapes quotes but not `<`, so a Host containing
    // `</script>` used to close the tag early and run what followed.
    const res = await getWithHost('evil.com</script><script>alert(1)</script>');

    assert.equal(res.status, 200);
    assert.ok(!res.body.includes('alert(1)'), 'Host header payload reached the page');
    assert.ok(!res.body.includes('evil.com'), 'Host header is reflected into the page');
  });

  it('targets the serving origin with a relative server URL', async () => {
    // A hard-coded absolute URL broke "Try it out" on every deployment, and
    // building one from the request was what opened the injection.
    const { body } = await json('/openapi.json');

    assert.deepEqual(body.servers, [{ url: '/', description: 'This server' }]);
  });
});
