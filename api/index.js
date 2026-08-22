'use strict';

/**
 * Serverless entry point (Vercel, and anything else that imports a handler).
 *
 * The platform never runs bin/www, so there is no listen() here — the Express
 * app is itself a (req, res) handler. Schema setup happens lazily on the first
 * request that needs it; see db/bootstrap.js.
 *
 * The require is guarded because anything that throws while the module loads —
 * a native dependency that will not load on this runtime, a bad environment
 * variable — takes the whole function down, and the platform then serves its
 * own empty error page. A blank screen is the one failure that tells you
 * nothing, so this turns it into a readable answer instead.
 */

let handler;

try {
  handler = require('../app');
} catch (err) {
  // The full stack goes to the platform's function logs, where an operator can
  // read it. The response carries only the message.
  console.error('The API failed to start:', err);

  handler = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify(
        {
          error: true,
          message: 'The API failed to start.',
          reason: err.message,
          hint:
            'Check the deployment\'s function logs for the full stack trace. ' +
            'Common causes: JWT_SECRET not set, or the SQLite driver failing to ' +
            'load on this runtime (set DATABASE_URL to use MySQL instead).',
        },
        null,
        2
      )
    );
  };
}

module.exports = handler;
