'use strict';

/**
 * Serverless entry point (Vercel, and anything else that imports a handler).
 *
 * The platform never runs bin/www, so there is no listen() here — the Express
 * app is itself a (req, res) handler. Schema setup happens lazily on the first
 * request that needs it; see db/bootstrap.js.
 */
module.exports = require('../app');
