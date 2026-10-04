// Focused test: guild level cap (20) + officer chat-delete.
// Run: node test/guild-moderation.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// Patch 'pg' to pg-mem before db.js loads.
const { newDb } = require('/home/hatch/workspace/orbit-idle/node_modules/pg-mem');
const mem = newDb();
const pgShim = mem.adapters.createPg();
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'pg') return pgShim;
  return origLoad.call(this, request, parent, isMain);
};

// Minimal schema for the chat-delete round trip.
mem.public.none(`CREATE TABLE guilds (id SERIAL PRIMARY KEY, name TEXT NOT NULL);`);
mem.public.none(`CREATE TABLE guild_chat (
  id SERIAL PRIMARY KEY,
  guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  username TEXT NOT NULL, message TEXT NOT NULL, created_at BIGINT NOT NULL
);`);

const db = require('../src/db');

let passed = 0;
function ok(cond, name) {
  assert(cond, `FAIL: ${name}`);
  passed++;
  console.log(`  ok - ${name}`);
}

(async () => {
  console.log('guild level cap:');
  ok(db.guildPerks(50).xpPct === 40, 'perks clamp level 50 -> 20 (+40% XP, not +100%)');
  ok(db.guildPerks(20).xpPct === 40, 'level 20 gives +40% XP');
  ok(db.guildPerks(1).xpPct === 2, 'level 1 gives +2% XP');
  ok(db.guildLevelForXp(1e12) === 20, 'guildLevelForXp caps at 20');
  ok(db.xpForGuildLevel(21) > 0, 'xpForGuildLevel defined past cap (harmless)');

  console.log('chat delete:');
  mem.public.none(`INSERT INTO guilds (name) VALUES ('Wolves'), ('Ravens')`);
  mem.public.none(`INSERT INTO guild_chat (guild_id, username, message, created_at)
    VALUES (1, 'Ashley', 'hello', 1), (1, 'Bob', 'hi', 2), (2, 'Eve', 'other guild', 3)`);
  ok(await db.deleteGuildChat(1, 1) === true, 'deletes own-guild message');
  ok(await db.deleteGuildChat(1, 1) === false, 'second delete returns false');
  ok(await db.deleteGuildChat(1, 3) === false, 'cannot delete another guild\u2019s message');
  const remaining = mem.public.many(`SELECT id FROM guild_chat ORDER BY id`);
  ok(remaining.length === 2 && remaining[0].id === 2 && remaining[1].id === 3,
    'only the targeted row was removed');

  console.log(`\nPASS: ${passed} checks`);
})().catch((e) => { console.error(e.message); process.exit(1); });
