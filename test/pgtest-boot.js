'use strict';
/**
 * pg-mem boot harness for server tests.
 *
 * Boots the REAL auth/game/GM routers against an in-memory PostgreSQL
 * (pg-mem) with MemoryStore sessions — no live Postgres needed.
 *
 *   PORT=3210 node test/pgtest-boot.js &
 *   node test/gm-console-reorg.js
 *
 * Seeds: owner1/gm1/admin1/mod1/player1 (password: password123 for all).
 * gmApi route guard roles: owner|gm grants, owner|admin player-mgmt,
 * owner|admin|gm|moderator moderation, owner server settings.
 */
const Module = require('module');
const { newDb } = require('/home/hatch/workspace/orbit-idle/node_modules/pg-mem');

// Intercept require('pg') so src/db.js gets pg-mem's Pool instead of a
// real connection. Must happen before any src/ module loads.
const pgMem = newDb();
const pgShim = pgMem.adapters.createPg();
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'pg') return pgShim;
  return origLoad.apply(this, arguments);
};

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const PORT = Number(process.env.PORT) || 3210;

async function main() {
  const db = require('../src/db');
  const { authRouter } = require('../src/auth');
  const { gameRouter } = require('../src/gameApi');
  const { gmRouter } = require('../src/gmApi');

  await db.migrate();
  await db.refreshGoldCap();

  const hash = bcrypt.hashSync('password123', 10);
  for (const [u, r] of [
    ['owner1', 'owner'],
    ['gm1', 'gm'],
    ['admin1', 'admin'],
    ['mod1', 'moderator'],
    ['player1', 'player'],
  ]) {
    await db.createUserWithRole(u, hash, r);
  }

  const app = express();
  // Test-only: let the suite rotate X-Forwarded-For so the register
  // rate limiter (10/hour/IP) doesn't choke a 30+ user test run.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      secret: 'pgtest-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 60 * 60 * 1000 },
    })
  );
  app.use('/api/auth', authRouter);
  app.use('/api', gameRouter);
  app.use('/api', gmRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[pgtest] error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Server error.' });
  });

  app.listen(PORT, () => console.log(`[pgtest] listening on ${PORT}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
