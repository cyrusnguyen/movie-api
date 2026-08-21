# Movie API

REST API for searching a movie catalogue, browsing cast and crew, and managing
user accounts with JWT authentication. Built with Express, Knex and SQLite (or
MySQL), documented with OpenAPI.

Originally built as a QUT coursework project; revived and hardened since.

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

## About the data

The original deployment read an IMDB-derived dataset from a MySQL database on
PlanetScale. PlanetScale ended its free tier in April 2024 and that database is
gone, which is why the old hosted API stopped working.

`data/seed/` now holds a small **curated sample catalogue** — 98 films, 327
people and 459 credits — committed as JSON and loaded by `npm run seed`. Titles,
years, runtimes and credits are real. Ratings and box-office figures are
approximate and rounded, and person IDs (`nm9000001`…) are generated for this
project rather than real IMDB identifiers. It is enough to exercise every
endpoint; it is not a substitute for the real dataset.

To regenerate the JSON after editing the catalogue in
`scripts/build-seed.js`:

```bash
node scripts/build-seed.js   # rewrite data/seed/*.json
npm run reset                # wipe and reload the database from it
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
| `npm run seed` | Load the catalogue if it is empty. |
| `npm run reset` | Wipe and reload the catalogue. User accounts are left alone. |

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
| `GET` | `/me` | — | Author details. |

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

This repository is not currently deployed — the previous Vercel and PlanetScale
deployments are both gone. `vercel.json` and `Dockerfile` are kept up to date so
it can be redeployed.

Wherever you host it, set `JWT_SECRET` and `CORS_ORIGIN`, and set `DATABASE_URL`
to a real MySQL instance. The bundled SQLite file is fine for local use and
demos, but most serverless platforms have an ephemeral or read-only filesystem,
so writes (registration, login) will not survive.

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
