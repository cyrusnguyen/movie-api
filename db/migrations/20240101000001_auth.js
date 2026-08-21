'use strict';

/**
 * Accounts and refresh tokens.
 *
 * These tables used to be created lazily by helpers that ran a schema check on
 * every single request. They are migrations now, so the check happens once.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('email', 320).notNullable();
    table.string('password', 255).notNullable();
    table.string('firstName', 128);
    table.string('lastName', 128);
    table.string('dob', 10);
    table.string('address', 512);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Without this, two concurrent registrations could both pass the
    // "does this user exist" check and create duplicate accounts.
    table.unique('email', { indexName: 'users_email_unique' });
  });

  await knex.schema.createTable('tokens', (table) => {
    table.increments('id').primary();
    // SHA-256 of the refresh token. The raw token is never stored, so a
    // database leak does not hand out live sessions.
    table.string('token_hash', 64).notNullable();
    table.string('email', 320).notNullable();
    // Tokens issued from the same login share a family id. Replaying a
    // rotated-out token revokes the whole family.
    table.string('family', 36).notNullable();
    table.bigInteger('expires_at').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.unique('token_hash', { indexName: 'tokens_token_hash_unique' });
    table.index('email', 'tokens_email_index');
    table.index('family', 'tokens_family_index');
    table.index('expires_at', 'tokens_expires_at_index');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('tokens');
  await knex.schema.dropTableIfExists('users');
};
