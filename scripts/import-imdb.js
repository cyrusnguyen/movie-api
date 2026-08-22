'use strict';

/**
 * Loads the catalogue from IMDb's official dataset dumps.
 *
 *   npm run import                      sensible defaults
 *   npm run import -- --min-votes 5000  more films, more obscure
 *   npm run import -- --help            all options
 *
 * The dumps are free and need no API key, but they are large (~1 GB) and are
 * licensed for personal and non-commercial use, so they are downloaded to a
 * gitignored cache and never committed. See https://developer.imdb.com/non-commercial-datasets/
 *
 * IMDb publishes no plot, poster, box office, country or certificate, and no
 * Rotten Tomatoes or Metacritic scores, so those columns are left null. The web
 * client already renders a generated poster and hides the missing sections.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

const config = require('../knexfile');

const BASE_URL = 'https://datasets.imdbws.com';
const CACHE_DIR = path.join(__dirname, '..', 'data', '.imdb-cache');

const FILES = {
  ratings: 'title.ratings.tsv.gz',
  basics: 'title.basics.tsv.gz',
  principals: 'title.principals.tsv.gz',
  names: 'name.basics.tsv.gz',
};

/** Roles worth showing on a film page, in the order we prefer to keep them. */
const KEEP_CATEGORIES = ['director', 'actor', 'actress', 'writer', 'producer', 'composer'];

const DEFAULTS = {
  minVotes: 25000,
  minYear: 1990,
  maxYear: null,
  maxCast: 12,
  dataDir: CACHE_DIR,
};

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];

    switch (arg) {
      case '--min-votes': options.minVotes = Number(next()); break;
      case '--min-year': options.minYear = Number(next()); break;
      case '--max-year': options.maxYear = Number(next()); break;
      case '--max-cast': options.maxCast = Number(next()); break;
      case '--data-dir': options.dataDir = path.resolve(next()); break;
      case '--help':
        console.log(`
Load the catalogue from IMDb's dataset dumps.

  --min-votes <n>   Minimum IMDb vote count. Lower means more, obscurer films.
                    25000 ≈ 6k films · 5000 ≈ 20k films · 1000 ≈ 50k films
                    (default ${DEFAULTS.minVotes})
  --min-year <y>    Earliest release year (default ${DEFAULTS.minYear})
  --max-year <y>    Latest release year (default: none)
  --max-cast <n>    Cast and crew kept per film (default ${DEFAULTS.maxCast})
  --data-dir <dir>  Read the .tsv.gz dumps from here instead of downloading
                    (default ${CACHE_DIR})
`);
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option ${arg}. Try --help.`);
          process.exit(1);
        }
    }
  }

  return options;
}

const fmt = (n) => n.toLocaleString('en-US');

function progress(label) {
  let count = 0;
  const started = Date.now();

  return {
    tick(step = 1) {
      count += step;
      if (count % 2_000_000 === 0) {
        process.stdout.write(`\r  ${label}: ${fmt(count)} rows read…`);
      }
    },
    done(kept) {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      process.stdout.write(
        `\r  ${label}: read ${fmt(count)} rows, kept ${fmt(kept)} (${secs}s)${' '.repeat(20)}\n`
      );
    },
  };
}

async function ensureFile(name, dataDir) {
  const dest = path.join(dataDir, name);

  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`  ${name} — already downloaded`);
    return dest;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`  ${name} — downloading…`);

  const response = await fetch(`${BASE_URL}/${name}`);

  if (!response.ok) {
    throw new Error(`Could not download ${name}: HTTP ${response.status}`);
  }

  const tmp = `${dest}.partial`;
  await pipeline(response.body, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);

  const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(0);
  console.log(`  ${name} — done (${mb} MB)`);

  return dest;
}

/**
 * Streams a gzipped IMDb TSV, calling onRow with each record as an object.
 *
 * The dumps are plain tab-separated with no quoting, and use \N for null.
 * They are far too large to read into memory — title.principals alone is
 * roughly 90 million rows.
 */
async function readTsv(file, onRow) {
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  let columns = null;

  for await (const line of lines) {
    const parts = line.split('\t');

    if (!columns) {
      columns = parts;
      continue;
    }

    const row = {};
    for (let i = 0; i < columns.length; i += 1) {
      const value = parts[i];
      row[columns[i]] = value === '\\N' || value === undefined ? null : value;
    }

    if (onRow(row) === false) break;
  }
}

const toInt = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
};

async function insertInChunks(knex, table, rows, size = 400) {
  for (let i = 0; i < rows.length; i += size) {
    await knex(table).insert(rows.slice(i, i + size));
  }
  return rows.length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const usingCache = options.dataDir === CACHE_DIR;

  console.log('\nImporting the catalogue from IMDb dataset dumps');
  console.log(
    `  filters: ${options.minVotes}+ votes, ${options.minYear}${options.maxYear ? `–${options.maxYear}` : ' onwards'}, ` +
      `up to ${options.maxCast} credits per film\n`
  );

  // ---------------------------------------------------------------- files
  const files = {};
  for (const [key, name] of Object.entries(FILES)) {
    files[key] = usingCache
      ? await ensureFile(name, options.dataDir)
      : path.join(options.dataDir, name);

    if (!fs.existsSync(files[key])) {
      throw new Error(`Missing ${files[key]}`);
    }
  }

  console.log('');

  // ------------------------------------------------------- 1. ratings
  // Filtering here first keeps every later pass small: of ~1.5M rated
  // titles only a few thousand clear a 25,000-vote bar.
  const rated = new Map();
  let bar = progress('title.ratings');

  await readTsv(files.ratings, (row) => {
    bar.tick();
    const votes = toInt(row.numVotes);

    if (votes !== null && votes >= options.minVotes) {
      rated.set(row.tconst, Number.parseFloat(row.averageRating));
    }
  });
  bar.done(rated.size);

  if (rated.size === 0) {
    throw new Error(`No titles have ${options.minVotes}+ votes. Try a lower --min-votes.`);
  }

  // -------------------------------------------------------- 2. titles
  const films = [];
  const selected = new Set();
  bar = progress('title.basics ');

  await readTsv(files.basics, (row) => {
    bar.tick();

    if (row.titleType !== 'movie' || row.isAdult === '1') return;
    if (!rated.has(row.tconst)) return;

    const year = toInt(row.startYear);
    if (year === null || year < options.minYear) return;
    if (options.maxYear && year > options.maxYear) return;

    selected.add(row.tconst);
    films.push({
      tconst: row.tconst,
      primaryTitle: row.primaryTitle,
      year,
      runtimeMinutes: toInt(row.runtimeMinutes),
      genres: row.genres,
      // IMDb publishes none of these; the client degrades gracefully.
      country: null,
      rated: null,
      boxoffice: null,
      poster: null,
      plot: null,
      imdbRating: rated.get(row.tconst),
      rottenTomatoesRating: null,
      metacriticRating: null,
    });
  });
  bar.done(films.length);

  if (films.length === 0) {
    throw new Error('No films matched those filters. Try a lower --min-votes or --min-year.');
  }

  // ---------------------------------------------------- 3. cast & crew
  const perFilm = new Map();
  const wantedPeople = new Set();
  bar = progress('title.princ. ');

  await readTsv(files.principals, (row) => {
    bar.tick();

    if (!selected.has(row.tconst)) return;
    if (!KEEP_CATEGORIES.includes(row.category)) return;

    const existing = perFilm.get(row.tconst);

    if (existing && existing.length >= options.maxCast) return;

    const credit = {
      tconst: row.tconst,
      nconst: row.nconst,
      category: row.category,
      // Already a JSON array string in the dump, e.g. ["Neo"].
      characters: row.characters || '',
    };

    if (existing) existing.push(credit);
    else perFilm.set(row.tconst, [credit]);

    wantedPeople.add(row.nconst);
  });

  const credits = [...perFilm.values()].flat();
  bar.done(credits.length);

  // -------------------------------------------------------- 4. people
  const people = [];
  bar = progress('name.basics  ');

  await readTsv(files.names, (row) => {
    bar.tick();

    if (!wantedPeople.has(row.nconst)) return;

    people.push({
      nconst: row.nconst,
      primaryName: row.primaryName,
      birthYear: toInt(row.birthYear),
      deathYear: toInt(row.deathYear),
      // Only point at titles we actually imported.
      knownForTitles: (row.knownForTitles || '')
        .split(',')
        .filter((id) => selected.has(id))
        .slice(0, 4)
        .join(','),
    });
  });
  bar.done(people.length);

  // Names arrive after credits, so drop any credit whose person is missing —
  // the foreign key would reject it.
  const knownPeople = new Set(people.map((p) => p.nconst));
  const validCredits = credits.filter((c) => knownPeople.has(c.nconst));
  const nameOf = new Map(people.map((p) => [p.nconst, p.primaryName]));

  // --------------------------------------------------------- 5. write
  console.log('\nWriting to the database…');
  const knex = require('knex')(config);

  try {
    await knex.migrate.latest();

    // Ordered so foreign keys are never left dangling. Accounts are untouched.
    await knex('ratings').del();
    await knex('principals').del();
    await knex('names').del();
    await knex('basics').del();

    await insertInChunks(knex, 'basics', films);
    await insertInChunks(knex, 'names', people);
    await insertInChunks(
      knex,
      'principals',
      validCredits.map((c) => ({ ...c, name: nameOf.get(c.nconst) }))
    );
    await insertInChunks(
      knex,
      'ratings',
      films.map((f) => ({
        tconst: f.tconst,
        source: 'Internet Movie Database',
        value: `${f.imdbRating.toFixed(1)}/10`,
      }))
    );

    console.log(
      `\nImported ${fmt(films.length)} films, ${fmt(people.length)} people, ` +
        `${fmt(validCredits.length)} credits.`
    );

    if (usingCache) {
      console.log(`\nThe dumps are cached in ${path.relative(process.cwd(), CACHE_DIR)}/`);
      console.log('Delete that directory to reclaim the space, or keep it to re-import faster.');
    }
  } finally {
    await knex.destroy();
  }
}

main().catch((err) => {
  console.error(`\nImport failed: ${err.message}`);
  process.exit(1);
});
