'use strict';

require('dotenv').config();

const path = require('path');

const createError = require('http-errors');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const logger = require('morgan');
const swaggerUI = require('swagger-ui-express');

const config = require('./config');
const knexConfig = require('./knexfile');
const swaggerDocument = require('./docs/swagger.json');
const { apiLimiter } = require('./middleware/rateLimit');

const moviesRouter = require('./routes/movies');
const peopleRouter = require('./routes/people');
const usersRouter = require('./routes/users');
const profileRouter = require('./routes/profile');

// Fail loudly at boot rather than returning confusing 500s on the first login.
config.requiredSecret();

const knex = require('knex')(knexConfig);

const app = express();

// Behind Vercel/Render/nginx, so the rate limiter sees the real client IP.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    // The Swagger UI bundle needs inline styles and its own scripts. Everything
    // else on this origin is JSON, so this is the only page it applies to.
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'https:'],
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

app.use((req, res, next) => {
  req.db = knex;
  next();
});

app.get('/health', async (req, res) => {
  try {
    await req.db.raw('select 1');
    res.json({ status: 'ok', database: 'up' });
  } catch (err) {
    console.error(err);
    res.status(503).json({ status: 'degraded', database: 'down' });
  }
});

app.use('/movies', moviesRouter);
app.use('/people', peopleRouter);
app.use('/user', usersRouter);
app.use(
  '/user/:email/profile',
  (req, res, next) => {
    req.email = req.params.email;
    next();
  },
  profileRouter
);

app.use('/', swaggerUI.serve);
app.get('/', swaggerUI.setup(swaggerDocument, { customSiteTitle: 'Movie API — reference' }));

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
module.exports.knex = knex;
