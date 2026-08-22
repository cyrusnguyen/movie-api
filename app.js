'use strict';

require('dotenv').config();

const path = require('path');

const createError = require('http-errors');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const logger = require('morgan');
const config = require('./config');
const knexConfig = require('./knexfile');
const { apiLimiter } = require('./middleware/rateLimit');
const { ensureReadyMiddleware } = require('./db/bootstrap');

const moviesRouter = require('./routes/movies');
const peopleRouter = require('./routes/people');
const usersRouter = require('./routes/users');
const profileRouter = require('./routes/profile');
const docsRouter = require('./routes/docs');

// Checked, not thrown: a throw at module scope would take down a serverless
// function and serve a blank page. If it is missing, every route answers with
// a 503 that says so (see below).
const secretProblem = config.secretProblem();

if (secretProblem) {
  console.error(`\nRefusing to serve: ${secretProblem}\n`);
}

/**
 * Created on first use, not at import.
 *
 * better-sqlite3 is a native addon, and knex resolves its driver eagerly. If
 * that binary will not load on the host's runtime, building the instance here
 * would throw while the module loads and take the whole app with it — no
 * Swagger, no 404 handler, nothing. Deferring it keeps everything that does not
 * need the database working, and turns a driver problem into one clear error on
 * the routes that do.
 */
let knexInstance = null;

function getKnex() {
  if (!knexInstance) {
    knexInstance = require('knex')(knexConfig);
  }

  return knexInstance;
}

const app = express();

// Behind Vercel/Render/nginx, so the rate limiter sees the real client IP.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    // Only the API reference page needs these: it loads Swagger UI from a CDN
    // and boots it with an inline script. Everything else here is JSON.
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", "'unsafe-inline'", docsRouter.CDN_CSP],
        'style-src': ["'self'", "'unsafe-inline'", docsRouter.CDN_CSP],
        'img-src': ["'self'", 'data:', 'https:'],
        'connect-src': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

const allowedOrigins = config.corsOrigins();

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin and non-browser callers (curl, server-to-server) send no
      // Origin header at all; there is nothing to protect them from here.
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }

      return callback(createError(403, 'Origin not allowed by CORS policy'));
    },
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);

app.use(logger(config.isProduction ? 'combined' : 'dev'));
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(apiLimiter);

/**
 * Attaches the database handle. Applied only to the routes that need one, so a
 * driver that will not load still leaves the API reference and the error
 * handlers working — and says plainly which part is broken.
 */
function attachDb(req, res, next) {
  try {
    req.db = getKnex();
  } catch (err) {
    console.error('Could not initialise the database driver:', err);

    return res.status(503).json({
      error: true,
      message: 'The database is unavailable.',
      reason: err.message,
    });
  }

  return next();
}

const withDb = [attachDb, ensureReadyMiddleware];

if (secretProblem) {
  // Serve one honest error rather than failing to boot. The message names the
  // missing setting; it reveals no secret and no internals.
  app.use((req, res) => {
    res.status(503).json({
      error: true,
      message: 'The API is not configured correctly: JWT_SECRET is missing or too short.',
    });
  });
}

app.get('/health', attachDb, async (req, res) => {
  try {
    await req.db.raw('select 1');
    res.json({ status: 'ok', database: 'up' });
  } catch (err) {
    console.error(err);
    res.status(503).json({ status: 'degraded', database: 'down' });
  }
});

app.use('/movies', withDb, moviesRouter);
app.use('/people', withDb, peopleRouter);
app.use('/user', withDb, usersRouter);
app.use(
  '/user/:email/profile',
  withDb,
  (req, res, next) => {
    req.email = req.params.email;
    next();
  },
  profileRouter
);

app.use('/', docsRouter);

app.use((req, res, next) => {
  next(createError(404, `Cannot ${req.method} ${req.path}`));
});

/**
 * JSON error handler.
 *
 * The previous version called res.render('error') against a Jade view, but no
 * view engine was ever configured — so every 404 returned a full stack trace
 * with absolute server paths in it. Stacks are now logged, never sent.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies handlers by arity
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({
    error: true,
    message: status >= 500 ? 'Internal server error' : err.message,
    ...(config.isProduction || status >= 500 ? {} : { status }),
  });
});

module.exports = app;

// A getter, so importing the app never forces the driver to load.
Object.defineProperty(module.exports, 'knex', { get: getKnex, configurable: true });
