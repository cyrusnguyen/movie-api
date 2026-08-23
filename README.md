# Movie API

REST API for searching a movie catalogue, browsing cast and crew, and managing
user accounts with JWT authentication. Built with Express, Knex and SQLite (or
MySQL), documented with OpenAPI.

## Screenshots

The OpenAPI reference is served at the root, so `npm start` gives you a browsable,
try-it-out console for every endpoint.

![Swagger UI listing the Movies, People and Authentication endpoints](docs/screenshots/swagger.png)

---

## Quick start

```bash
git clone https://github.com/cyrusnguyen/movie-api
cd movie-api
npm install
cp .env.example .env
# put a random secret in JWT_SECRET — the app refuses to boot without one:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm start
```

That is the whole setup. There is no database to provision: the app creates a
SQLite file at `data/movies.db` and loads the bundled catalogue on first run.

- API reference (Swagger UI): <http://localhost:3000/>
- Health check: <http://localhost:3000/health>

## The catalogue

The API ships with a small **sample catalogue** — 98 films, 327 people, 459
credits — committed as JSON in `data/seed/` and loaded automatically on first
run. That is what makes a fresh clone work with no setup.

For a real catalogue, import IMDb's official dataset dumps:

```bash
npm run import                      # ~6,000 films, 25,000+ votes, 1990 onwards
npm run import -- --min-votes 5000  # ~20,000 films, deeper into the back catalogue
npm run import -- --help            # all options
```

### This runs once, from your terminal

The import is a one-off batch job, not something the server or the browser ever
does:

```
you, once:   npm run import  →  downloads dumps  →  writes rows  →  exits
from then:   browser  →  your API  →  your database
```

The server never contacts IMDb. Neither does the client. The dumps are cached in
`data/.imdb-cache/` so re-importing does not re-download them; delete that
directory to reclaim the space.

### What the dumps do and do not contain

IMDb has no free API — their official developer API is enterprise-priced — but
they do publish free [dataset dumps](https://developer.imdb.com/non-commercial-datasets/),
which is where this schema's column names come from.

| Populated | Left null |
|---|---|
| title, year, runtime, genres | plot, poster, box office |
| IMDb rating and vote counts | country, certificate |
| cast, crew, characters | Rotten Tomatoes, Metacritic |
| birth and death years | |

The client handles the gaps: films without a poster get a generated gradient
tile keyed to the title, and the plot and box-office sections hide themselves.

The dumps are licensed for **personal and non-commercial use**, so they are
downloaded locally and never committed. The committed sample catalogue is
separate: titles, years and credits there are real, while ratings and
box-office figures are approximate, and its person IDs (`nm9000001`…) are
generated for this project rather than real IMDb identifiers.

To go back to the sample catalogue at any time:

```bash
npm run reset
```

## Configuration

All settings are read from `.env` (see `.env.example`).

| Variable | Required | Default | Notes |
|---|---|---|---|
| `JWT_SECRET` | **yes** | — | 32+ characters. The app exits at boot if this is missing or too short. |
| `PORT` | no | `3000` | |
| `DATABASE_URL` | no | — | Leave blank for the bundled SQLite file. Set a `mysql://` URL to use MySQL instead. |
| `SQLITE_FILE` | no | `data/movies.db` | Only used when `DATABASE_URL` is unset. |
| `CORS_ORIGIN` | no | `http://localhost:5173` | Comma-separated list of allowed browser origins. |
| `BCRYPT_ROUNDS` | no | `10` | bcrypt work factor. |

### Running against MySQL

```bash
DATABASE_URL=mysql://user:password@host:3306/movies npm run migrate
DATABASE_URL=mysql://user:password@host:3306/movies npm run seed
DATABASE_URL=mysql://user:password@host:3306/movies npm start
```

## Scripts

| Command | Does |
|---|---|
| `npm start` | Run the server (migrates, and seeds if the catalogue is empty). |
| `npm run dev` | Same, restarting on file changes. |
| `npm test` | Run the test suite against a throwaway database. |
| `npm run migrate` | Apply migrations only. |
| `npm run seed` | Load the sample catalogue if the database is empty. |
| `npm run reset` | Wipe and reload the sample catalogue. Accounts are untouched. |
| `npm run import` | Replace the catalogue with IMDb's dataset dumps. Accounts are untouched. |

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/movies/search` | — | Search by title, year, genre, minimum rating; sortable and paginated. |
| `GET` | `/movies/data/{imdbID}` | — | Full record for one film, with credits and ratings. |
| `GET` | `/people/{id}` | Bearer | A person and everything they are credited on. |
| `POST` | `/user/register` | — | Create an account. |
| `POST` | `/user/login` | — | Exchange credentials for a bearer and refresh token. |
| `POST` | `/user/refresh` | — | Rotate the refresh token and get a new bearer token. |
| `POST` | `/user/logout` | — | Revoke a refresh token and its whole family. |
| `GET` | `/user/{email}/profile` | optional | Three fields publicly, five to the owner. |
| `PUT` | `/user/{email}/profile` | Bearer | Owner-only update. |
| `GET` | `/health` | — | Liveness and database connectivity. |

Full request and response schemas are in the Swagger UI at `/`.

## Security

The 2023 version had a number of problems that have since been fixed:

- **Stack traces on every 404.** The error handler rendered a Jade view, but no
  view engine was ever configured — so the failure to render was itself returned
  to the client, complete with absolute server paths. Errors are JSON now and
  stacks are only ever logged.
- **Caller-chosen token lifetimes.** `bearerExpiresInSeconds` and
  `refreshExpiresInSeconds` were read from the request body, so anyone could ask
  for a token valid for a century. Lifetimes are fixed server-side.
- **Refresh tokens stored in the clear and never rotated.** They are stored as
  SHA-256 digests now, rotated on every use, and grouped into families —
  presenting a token that has already been rotated out revokes every token from
  that login.
- **Raw database errors returned to callers**, leaking SQL and schema detail.
- **No algorithm pinning on `jwt.verify`**, leaving the door open to algorithm
  confusion. `HS256` is now required explicitly.
- **No rate limiting** on login or registration.
- **`cors()` with no arguments**, allowing any origin. Now an allowlist.
- **User enumeration**: login distinguished "no such account" from "wrong
  password". One message covers both, with equalised timing.
- **A crash in the profile route**: its ownership helper referenced an
  out-of-scope `res`, so a malformed token threw instead of replying, and one
  branch never responded at all — leaving the connection open until it timed out.
- **No unique index on `users.email`**, so concurrent registrations could create
  duplicate accounts.
- **No password or email validation**, and an unbounded `per_page` that let a
  single request pull the entire table.

`helmet` sets security headers, request bodies are capped at 16 KB, and the
`/knex` endpoint that reported the database version has been removed.

### Found in review, since fixed

Two defects in the rewritten reference page, both introduced while fixing the
blank-page problem on serverless and both caught by a later audit:

- **Reflected XSS through the `Host` header.** The page inlines the OpenAPI
  spec into a `<script>` block, and the spec's server URL was built from
  `req.get('host')`. `JSON.stringify` escapes quotes and backslashes but not
  `<`, so a `Host` containing `</script>` closed the block early and everything
  after it ran as script. The spec now uses a **relative** server URL (`/`),
  which Swagger UI resolves against whatever origin served the page — the
  request is never consulted, so there is nothing to inject. Values inlined
  into script are additionally escaped (`<`, `>`, `&`, U+2028, U+2029).
- **Unbounded memory growth.** The rendered page was cached in a `Map` keyed by
  that same `Host`, so a caller sending a fresh `Host` each request grew the map
  until the process ran out of memory. There is now one page for every caller.

Both are covered by tests, and "Try it out" was re-verified end to end against
the real Swagger UI bundle in Chromium.

### Known and accepted

- **The reference page allows inline script in its CSP.** It boots Swagger UI
  with an inline `<script>`, so `script-src` includes `'unsafe-inline'`. With
  the `Host` reflection gone, no user-controlled value reaches that page, so
  there is no injection point for it to enable — but it is weaker than the
  front end's policy, and moving to a hash would close it.
- **Swagger UI's assets load from a CDN without Subresource Integrity.** A
  compromise of `cdn.jsdelivr.net` could serve modified script to the reference
  page. Adding `integrity` hashes would pin them.
- **The front end stores tokens in `localStorage`.** See that repo's README for
  why, and for the layered mitigations.

## Deployment

### Vercel

The repo is Vercel-ready: `api/index.js` exports the Express app as a serverless
function and `vercel.json` rewrites every path to it.

**Set `JWT_SECRET` in the Vercel project's environment variables before
deploying.** Without it the API refuses to serve and answers every request with
a 503 saying so. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Also set `CORS_ORIGIN` to the origin of whatever front end will call it.

| Variable | On Vercel |
|---|---|
| `JWT_SECRET` | **Required.** 32+ characters. |
| `CORS_ORIGIN` | Your front end's origin, e.g. `https://your-app.vercel.app`. |
| `DATABASE_URL` | Optional but recommended — see below. |

#### If the deployment looks broken

Every startup failure now answers with JSON rather than an empty page, so open
the URL and read the response:

| Response | Meaning |
|---|---|
| `"JWT_SECRET is missing or too short"` | Set `JWT_SECRET` in the project's environment variables and redeploy. |
| `"The database is unavailable"` | `better-sqlite3` is a native addon and some hosts skip install scripts, so its binary is never built. Set `DATABASE_URL` to use MySQL — `mysql2` is pure JavaScript. |
| `"The API failed to start"` | Something else threw during startup; `reason` names it and the full stack is in the function logs. |
| Genuinely blank, or a login page | Not the API. Vercel protects preview deployments by default — check **Settings → Deployment Protection**, or open the link while signed in to the Vercel account that owns it. |

"Try it out" in the reference sends its requests to whichever host served the
page, so it works the same locally and on a deployment. No CORS setup is needed
for it — the requests are same-origin.

#### Native dependencies

Vercel's installer does not run package install scripts by default, which the
build log reports as:

```
npm warn allow-scripts  better-sqlite3@11.10.0 (install: node-gyp rebuild)
```

`better-sqlite3` compiles a binary in that step, so on Vercel it has none and
cannot load. Password hashing used to have the same problem and no longer does —
`bcryptjs` is pure JavaScript and reads the same `$2b$` hashes. For the database,
set `DATABASE_URL`: the MySQL driver is pure JavaScript too.

Without it the API still serves its reference page and returns a clear 503 from
the data routes rather than failing silently.

#### A caveat about storage

Serverless filesystems are read-only apart from `/tmp`, and instances are
recycled without warning. With no `DATABASE_URL`, the API rebuilds the SQLite
database in `/tmp` from the committed sample catalogue on each cold start. That
means:

- searching, film pages and person pages work fine
- accounts and profiles are written successfully, but **disappear whenever the
  instance recycles**

Good enough to demonstrate the API; not a real deployment. Point `DATABASE_URL`
at a hosted MySQL instance for durable accounts. Migrations run automatically on
the first request that needs them, so no separate migration step is required.

### A host with a disk

For persistent SQLite and no cold starts, deploy to something with a real
filesystem instead of Vercel — Fly.io, Render and Railway all work.
`Dockerfile` is kept current:

```bash
docker build -t movie-api .
docker run -p 3000:3000 \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -v "$(pwd)/data:/data" -e SQLITE_FILE=/data/movies.db \
  movie-api
```

The container starts as root only long enough to `chown` a freshly-mounted,
empty volume so the unprivileged `node` user it then switches to can write to
it — see `bin/entrypoint.js`. Skip the `-v`/`SQLITE_FILE` pair and the database
just lives inside the container's own writable layer instead, which is fine
for a one-off `docker run` but is lost on the next `docker build`.

#### Fly.io

`fly.toml` is ready to go: a `movie_data` volume mounted at `/data`, a health
check on `/health`, and `SQLITE_FILE` already pointed at the volume.

```bash
fly launch --no-deploy        # reuses fly.toml and asks for an app name
fly volumes create movie_data --region syd --size 1
fly secrets set JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
fly deploy
```

**Start with `fly launch`, not `fly deploy`.** `fly launch` is what creates the
app under your account and writes its name into `fly.toml`. Fly app names are
globally unique across every account — the name becomes `<app>.fly.dev` — so
generic ones are already taken, and deploying to a name you do not own fails
with an error that sounds like a login problem but is not:

```
error listing active machines for <name> app: failed to list VMs: unauthorized
```

Check with `fly auth whoami` (are you logged in?) and `fly apps list` (do you
own that name?). If the name is taken, pick another — `fly launch` will offer
one, or create it explicitly and pass it through:

```bash
fly apps create movie-api-yourname
fly volumes create movie_data --app movie-api-yourname --region syd --size 1
fly secrets set JWT_SECRET=... --app movie-api-yourname
fly deploy --app movie-api-yourname
```

On Windows PowerShell, `openssl` may not be installed — the `node -e` command
above works everywhere Node does. Generating the secret inline like this keeps
it out of your shell history.

Then, once the frontend has a URL — or any time it changes:

```bash
fly secrets set CORS_ORIGIN=https://your-frontend.vercel.app
```

- **Anything that varies per environment goes in `fly secrets`, not
  `fly.toml`.** Despite the name, `fly secrets` is Fly's runtime environment:
  values are injected into the running machines and applied by a rolling
  restart, so changing one needs no code change, no commit and no rebuild.
  `fly.toml`'s `[env]` block is committed plain text baked in at deploy time,
  which suits `PORT` and `SQLITE_FILE` — identical on every deploy — and suits
  `CORS_ORIGIN` and `JWT_SECRET` badly.
- `JWT_SECRET` has the additional reason that it is a credential: it signs auth
  tokens, so anyone holding it can forge a login for any account. It must never
  be committed. `CORS_ORIGIN` is not sensitive — a frontend URL is public by
  definition — it simply belongs with the config that changes.
- Pass several origins as one comma-separated value, e.g. a production domain
  and a staging one:
  `fly secrets set CORS_ORIGIN=https://app.example.com,https://staging.example.com`
- Until `CORS_ORIGIN` is set, the API falls back to allowing `localhost:5173`
  only, so a deployed frontend's requests are refused by the browser. The API
  itself still serves fine — the reference page and `curl` are unaffected,
  since neither is subject to CORS.
- The volume makes the catalogue and any accounts durable across deploys and
  restarts — unlike the Vercel deployment above, which rebuilds SQLite from
  the sample catalogue on every cold start.
- `primary_region` defaults to `syd`; change it in `fly.toml` to deploy closer
  to your users, and create the volume in the same region.

## Frontend

The React client for this API lives at
[cyrusnguyen/movie-searching-website](https://github.com/cyrusnguyen/movie-searching-website).
Point its `VITE_API_URL` at wherever this API is running.

## Issues

Bug reports and suggestions are welcome on the GitHub issue tracker.
