'use strict';

/**
 * Movie catalogue: films, people, the credits that link them, and per-source
 * ratings. Column names match the original IMDB-derived schema so existing
 * queries keep working.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('basics', (table) => {
    table.string('tconst', 16).primary();
    table.string('primaryTitle', 255).notNullable();
    table.integer('year');
    table.integer('runtimeMinutes');
    table.string('genres', 255);
    table.string('country', 128);
    table.string('rated', 32);
    table.bigInteger('boxoffice');
    table.string('poster', 512);
    table.text('plot');
    table.decimal('imdbRating', 3, 1);
    table.integer('rottenTomatoesRating');
    table.integer('metacriticRating');

    // /movies/search filters on title and year, and sorts by rating.
    table.index('primaryTitle', 'basics_primaryTitle_index');
    table.index('year', 'basics_year_index');
    table.index('imdbRating', 'basics_imdbRating_index');
  });

  await knex.schema.createTable('names', (table) => {
    table.string('nconst', 16).primary();
    table.string('primaryName', 255).notNullable();
    table.integer('birthYear');
    table.integer('deathYear');
    table.string('knownForTitles', 512);

    table.index('primaryName', 'names_primaryName_index');
  });

  await knex.schema.createTable('principals', (table) => {
    table.increments('id').primary();
    table.string('tconst', 16).notNullable().references('tconst').inTable('basics').onDelete('CASCADE');
    table.string('nconst', 16).notNullable().references('nconst').inTable('names').onDelete('CASCADE');
    table.string('category', 64).notNullable();
    table.string('name', 255).notNullable();
    table.text('characters');

    table.index('tconst', 'principals_tconst_index');
    table.index('nconst', 'principals_nconst_index');
  });

  await knex.schema.createTable('ratings', (table) => {
    table.increments('id').primary();
    table.string('tconst', 16).notNullable().references('tconst').inTable('basics').onDelete('CASCADE');
    table.string('source', 128).notNullable();
    table.string('value', 32).notNullable();

    table.index('tconst', 'ratings_tconst_index');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('ratings');
  await knex.schema.dropTableIfExists('principals');
  await knex.schema.dropTableIfExists('names');
  await knex.schema.dropTableIfExists('basics');
};
