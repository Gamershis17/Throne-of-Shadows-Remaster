'use strict';
/**
 * pg-mem boot harness for the social (friends/inspect) API tests.
 *
 * Boots the REAL auth/game routers against in-memory PostgreSQL (pg-mem)
 * with MemoryStore sessions — no live Postgres needed.
 *
 *   PORT=3220 node test/social-boot.js &
 *   node test/social.js
 *
 * Seeds: alice / bob (password: password123 for both), each with a state
 * blob containing gear, pets, and progression so inspect has real data.
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

const PORT = Number(process.env.PORT) || 3220;

function blobFor(level, stage) {
  return {
    race: 'human',
    mode: 'clicker',
    playerClass: 'warrior',
    spec: 'dps',
    level,
    xp: 0,
    xpNext: 100,
    gold: 5000,
    stars: 10,
    stage,
    bossesKilled: level * 3,
    rebirthCount: 1,
    activeTitle: 'slayer',
    badge: 'founder',
    country: 'US',
    hero: {
      hp: 5000, maxHp: 5000, attack: 1200, defense: 300,
      critChance: 15, critDamage: 200, parry: 5, dodge: 10,
      lifesteal: 3, attackSpeed: 1.2, regen: 5,
    },
    party: [],
    inventory: [
      { id: 'w1', name: 'Duskfang Blade', slot: 'weapon', rarity: 'legendary', enchant: 5,
        stats: { attack: 4500, critChance: 8 } },
      { id: 'a1', name: 'Sable Plate', slot: 'armor', rarity: 'epic', enchant: 3,
        stats: { defense: 900, maxHp: 6000 } },
    ],
    equipped: { weapon: 'w1', armor: 'a1', helmet: null, boots: null, trinket: null },
    upgrades: { weapon: 3, armor: 2, skill: 2 },
    skills: ['power-strike', 'fireball'],
    companions: [],
    pets: {
      collection: [
        { uid: 'p1', species: 'cinderpup', level: 12, hunger: 90 },
        { uid: 'p2', species: 'stormhawk', level: 8, hunger: 60 },
      ],
      activeUid: 'p1',
      secondActiveUid: 'p2',
      eggs: 0,
    },
    codesRedeemed: [],
    stats: { taps: 1000, kills: 4200, playTimeSec: 3600 },
    raid: { best: 34 },
  };
}

async function main() {
  const db = require('../src/db');
  const { authRouter } = require('../src/auth');
  const { gameRouter } = require('../src/gameApi');

  await db.migrate();
  await db.refreshGoldCap();

  const hash = bcrypt.hashSync('password123', 10);
  for (const [u, blob] of [['alice', blobFor(45, 120)], ['bob', blobFor(52, 140)]]) {
    const user = await db.createUserWithRole(u, hash, 'player');
    await db.saveState(user.id, blob);
  }

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      secret: 'social-test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax' },
    })
  );
  app.use('/api/auth', authRouter);
  app.use('/api', gameRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[social-test] error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Server error.' });
  });

  app.listen(PORT, () => console.log(`[social-test] listening on ${PORT}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
