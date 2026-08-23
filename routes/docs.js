'use strict';

const express = require('express');

const swaggerDocument = require('../docs/swagger.json');

const router = express.Router();

/**
 * Serves the API reference.
 *
 * This used to use swagger-ui-express, which mounts express.static over the
 * swagger-ui-dist package and reads its CSS and JS off disk at request time.
 * Serverless bundlers only ship files they can see in a `require`, so those
 * assets were never deployed: the HTML arrived, every asset 404'd, and the page
 * rendered blank.
 *
 * Building the page here removes the filesystem from the path entirely. The
 * spec is inlined, so the page needs no second request for it, and if the
 * viewer cannot reach the CDN the page says so and links to the raw spec rather
 * than showing nothing.
 */
const SWAGGER_VERSION = '5.17.14';
const CDN = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}`;

/**
 * The CDN's origin, for Content-Security-Policy.
 *
 * Deliberately the bare origin rather than the versioned path: a CSP source
 * whose path lacks a trailing slash is an *exact* path match, so naming the
 * directory refuses every file inside it and the page renders blank — and
 * helmet strips a trailing slash, so the prefix form cannot be expressed here.
 */
const CDN_CSP = 'https://cdn.jsdelivr.net';

/**
 * The URL Swagger UI should send "Try it out" requests to.
 *
 * The spec used to hard-code http://localhost:3000, and Swagger UI picks the
 * first server — so the reference served from a deployment fired every request
 * at the reader's own machine, which over HTTPS the browser refuses as mixed
 * content, reporting only "Failed to fetch".
 *
 * A *relative* URL fixes that without consulting the request at all: Swagger UI
 * resolves it against the page's own origin, so the docs always target whatever
 * host served them, on any deployment.
 *
 * The previous version built this from `req.get('host')`, which was a mistake.
 * The Host header is attacker-controlled, and it was interpolated into the
 * inline <script> below via JSON.stringify — which escapes quotes but not `<`,
 * so a Host containing `</script>` closed the tag and everything after it ran
 * as script. Not taking the value at all removes the vector outright, and it
 * also means one cacheable page instead of one per Host seen.
 */
const SPEC = { ...swaggerDocument, servers: [{ url: '/', description: 'This server' }] };

/**
 * JSON safe to sit inside a <script> block.
 *
 * JSON.stringify alone is not: `<` passes through untouched, so `</script>` in
 * any string value ends the block early. U+2028 and U+2029 are valid in JSON
 * but are line terminators in older JS parsers. Belt and braces — nothing
 * user-controlled reaches this any more, but the next person to add a field
 * should not have to rediscover that.
 */
function inlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Movie API — reference</title>
    <link rel="stylesheet" href="${CDN}/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .swagger-ui .topbar { display: none; }
      #fallback {
        display: none;
        max-width: 40rem;
        margin: 4rem auto;
        padding: 0 1.5rem;
        font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        color: #1f2328;
      }
      #fallback h1 { font-size: 1.5rem; margin-bottom: .5rem; }
      #fallback code {
        background: #eff1f3;
        padding: .15em .4em;
        border-radius: 4px;
        font-size: .9em;
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>

    <div id="fallback">
      <h1>Movie API</h1>
      <p>
        The interactive reference could not load, because the Swagger UI assets
        on <code>cdn.jsdelivr.net</code> are unreachable from this browser.
      </p>
      <p>
        The API itself is unaffected. The specification is at
        <a href="openapi.json">openapi.json</a>, and a health check at
        <a href="health">health</a>.
      </p>
    </div>

    <noscript>
      <div style="display:block; max-width:40rem; margin:4rem auto; padding:0 1.5rem;
                  font:16px/1.6 system-ui, sans-serif;">
        <h1>Movie API</h1>
        <p>The interactive reference needs JavaScript. The specification is at
        <a href="openapi.json">openapi.json</a>.</p>
      </div>
    </noscript>

    <script src="${CDN}/swagger-ui-bundle.js"></script>
    <script>
      window.addEventListener('load', function () {
        if (typeof SwaggerUIBundle === 'undefined') {
          document.getElementById('fallback').style.display = 'block';
          return;
        }

        window.ui = SwaggerUIBundle({
          spec: ${inlineJson(SPEC)},
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
          layout: 'BaseLayout',
          tryItOutEnabled: true,
        });
      });
    </script>
  </body>
</html>
`;

// One page for every caller, built once. The previous version kept a Map keyed
// by the request's Host, which an attacker could grow without bound by sending
// a fresh Host each time until the process ran out of memory.
router.get('/', (req, res) => {
  res.type('html').send(page);
});

/** The raw spec, for generators and clients. */
router.get('/openapi.json', (req, res) => {
  res.json(SPEC);
});

module.exports = router;
module.exports.CDN = CDN;
module.exports.CDN_CSP = CDN_CSP;
