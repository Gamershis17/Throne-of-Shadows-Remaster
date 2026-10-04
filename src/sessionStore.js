'use strict';

/**
 * express-session Store backed by PostgreSQL via `connect-pg-simple`.
 *
 * Uses the `sessions` table created by src/schema.sql
 * (sid TEXT PK, sess JSON, expire TIMESTAMPTZ).
 * createTableIfMissing is false — schema is owned by migrate().
 */

const { pool } = require('./db');

function createSessionStore(session) {
  const PgStore = require('connect-pg-simple')(session);
  return new PgStore({
    pool,
    tableName: 'sessions',
    createTableIfMissing: false,
    // Prune expired sessions every 15 minutes.
    pruneSessionInterval: 15 * 60,
  });
}

module.exports = createSessionStore;
