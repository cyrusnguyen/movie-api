'use strict';

const express = require('express');

const { PAGINATION } = require('../config');

const router = express.Router();

const SEARCH_COLUMNS = [
  'primaryTitle',
  'year',
  'tconst',
  'imdbRating',
  'rottenTomatoesRating',
  'metacriticRating',
  'rated',
  'genres',
  // Added so the web client can render a results grid in one request instead of
  // fetching /movies/data/:id once per row.
  'poster',
];

const SORTS = {
  relevance: [{ column: 'primaryTitle', order: 'asc' }],
  rating: [{ column: 'imdbRating', order: 'desc' }, { column: 'primaryTitle', order: 'asc' }],
  newest: [{ column: 'year', order: 'desc' }, { column: 'primaryTitle', order: 'asc' }],
  oldest: [{ column: 'year', order: 'asc' }, { column: 'primaryTitle', order: 'asc' }],
};

const toInt = (value) => {
  const parsed = Number.parseInt(value, 10);

  return Number.isNaN(parsed) ? null : parsed;
};

router.get('/search', async (req, res, next) => {
  try {
    const { title, year, genre, minRating, sort } = req.query;

    if (year !== undefined && !/^\d{4}$/.test(year)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid year format. Format must be yyyy.',
      });
    }

    if (req.query.page !== undefined && !/^\d+$/.test(req.query.page)) {
      return res.status(400).json({
        error: true,
        message: 'Invalid page format. page must be a number.',
      });
    }

    const page = Math.max(1, toInt(req.query.page) ?? 1);
    // Clamped: an unbounded per_page let a single request ask for the whole table.
    const perPage = Math.min(
      PAGINATION.maxPerPage,
      Math.max(1, toInt(req.query.per_page) ?? PAGINATION.defaultPerPage)
    );
    const offset = (page - 1) * perPage;

    // Knex parameterises these values, so the LIKE patterns are not injectable.
    const applyFilters = (query) => {
      if (title) {
        query.where('primaryTitle', 'like', `%${title}%`);
      }

      if (year) {
        query.where('year', '=', Number(year));
      }

      if (genre) {
        query.where('genres', 'like', `%${genre}%`);
      }

      const min = Number.parseFloat(minRating);
      if (!Number.isNaN(min)) {
        query.where('imdbRating', '>=', min);
      }

      return query;
    };

    const [{ total }] = await applyFilters(req.db('basics')).count({ total: '*' });
    const totalCount = Number(total);
    const lastPage = Math.max(1, Math.ceil(totalCount / perPage));

    const query = applyFilters(req.db('basics').select(SEARCH_COLUMNS));

    for (const { column, order } of SORTS[sort] || SORTS.relevance) {
      query.orderBy(column, order);
    }

    const rows = await query.limit(perPage).offset(offset);

    const data = rows.map((row) => ({
      title: row.primaryTitle,
      year: toInt(row.year),
      imdbID: row.tconst,
      imdbRating: Number.parseFloat(row.imdbRating) || null,
      rottenTomatoesRating: toInt(row.rottenTomatoesRating),
      metacriticRating: toInt(row.metacriticRating),
      classification: row.rated,
      genres: row.genres ? row.genres.split(',') : [],
      poster: row.poster || null,
    }));

    return res.status(200).json({
      data,
      pagination: {
        total: totalCount,
        lastPage,
        perPage,
        currentPage: page,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: page < lastPage ? page + 1 : null,
        from: offset,
        to: offset + rows.length,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/data/:id', async (req, res, next) => {
  try {
    if (Object.keys(req.query).length > 0) {
      return res.status(400).json({
        error: true,
        message: 'Query parameters are not permitted.',
      });
    }

    const movie = await req
      .db('basics as b')
      .select({
        title: 'b.primaryTitle',
        year: 'b.year',
        runtime: 'b.runtimeMinutes',
        genres: 'b.genres',
        country: 'b.country',
        boxoffice: 'b.boxoffice',
        poster: 'b.poster',
        plot: 'b.plot',
        classification: 'b.rated',
        imdbRating: 'b.imdbRating',
      })
      .where('b.tconst', req.params.id)
      .first();

    if (!movie) {
      return res.status(404).json({ error: true, message: 'No record exists of a movie with this ID' });
    }

    const [ratingRows, principalRows] = await Promise.all([
      req.db('ratings as r').select('r.source', 'r.value').where('r.tconst', req.params.id),
      req
        .db('principals as p')
        .select({ id: 'p.nconst', category: 'p.category', name: 'p.name', characters: 'p.characters' })
        .where('p.tconst', req.params.id),
    ]);

    return res.status(200).json({
      title: movie.title,
      year: toInt(movie.year),
      runtime: toInt(movie.runtime),
      genres: movie.genres ? movie.genres.split(',') : [],
      country: movie.country,
      classification: movie.classification,
      imdbRating: Number.parseFloat(movie.imdbRating) || null,
      principals: principalRows.map((row) => ({
        id: row.id,
        category: row.category,
        name: row.name,
        characters: parseCharacters(row.characters),
      })),
      ratings: ratingRows.map((row) => ({
        source: row.source,
        value: parseRatingValue(row.value),
      })),
      boxoffice: movie.boxoffice === null ? null : Number(movie.boxoffice),
      poster: movie.poster || null,
      plot: movie.plot,
    });
  } catch (err) {
    return next(err);
  }
});

/** Characters are stored as a JSON array; tolerate blank and malformed values. */
function parseCharacters(value) {
  if (!value || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return [value];
  }
}

/** Ratings arrive as "8.7/10", "94%" or "84/100"; pull the leading number out. */
function parseRatingValue(value) {
  const match = String(value).match(/\d+(?:\.\d+)?/);

  return match ? Number.parseFloat(match[0]) : null;
}

module.exports = router;
