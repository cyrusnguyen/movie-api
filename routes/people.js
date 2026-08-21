'use strict';

const express = require('express');

const requireAuth = require('../middleware/authorization');

const router = express.Router();

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    if (Object.keys(req.query).length > 0) {
      return res.status(400).json({
        error: true,
        message: 'Query parameters are not permitted.',
      });
    }

    const person = await req
      .db('names as n')
      .select({
        name: 'n.primaryName',
        birthYear: 'n.birthYear',
        deathYear: 'n.deathYear',
      })
      .where('n.nconst', req.params.id)
      .first();

    if (!person) {
      return res.status(404).json({
        error: true,
        message: 'No record exists of a person with this ID',
      });
    }

    const roles = await req
      .db('principals as p')
      .join('basics as b', 'b.tconst', 'p.tconst')
      .select({
        movieName: 'b.primaryTitle',
        movieId: 'b.tconst',
        imdbRating: 'b.imdbRating',
        year: 'b.year',
        characters: 'p.characters',
        category: 'p.category',
      })
      .where('p.nconst', req.params.id)
      .orderBy('b.year', 'desc');

    return res.status(200).json({
      name: person.name,
      birthYear: person.birthYear ?? null,
      deathYear: person.deathYear ?? null,
      roles: roles.map((row) => ({
        movieName: row.movieName,
        movieId: row.movieId,
        year: row.year ?? null,
        category: row.category,
        characters: parseCharacters(row.characters),
        imdbRating: Number.parseFloat(row.imdbRating) || null,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

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

module.exports = router;
