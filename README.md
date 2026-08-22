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
filesystem — Render, Fly.io and Railway all work. `Dockerfile` is kept current:

```bash
docker build -t movie-api .
docker run -p 3000:3000 -e JWT_SECRET=$(openssl rand -hex 32) movie-api
```

## Frontend

The React client for this API lives at
[cyrusnguyen/movie-searching-website](https://github.com/cyrusnguyen/movie-searching-website).
Point its `VITE_API_URL` at wherever this API is running.

## Issues

Bug reports and suggestions are welcome on the GitHub issue tracker.
