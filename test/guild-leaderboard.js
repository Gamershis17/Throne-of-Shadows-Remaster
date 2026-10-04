'use strict';
/**
 * Guild leaderboard tests (pg-mem, no live Postgres).
 * Covers: guild_tag on /api/leaderboard rows (null when guildless),
 * and getGuildRankings ordering: level DESC, total member power DESC,
 * member count DESC, oldest guild first.
 *
 * Run: node test/guild-leaderboard.js
 */
const assert = require('assert');
const Module = require('module');
const { newDb } = require('/home/hatch/workspace/orbit-idle/node_modules/pg-mem');

const mem = newDb();
const pgShim = mem.adapters.createPg();
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'pg') return pgShim;
  return origLoad.call(this, request, parent, isMain);
};
const db = require('../src/db');

let failures = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ok   ${name}`))
    .catch((e) => { failures++; console.error(`  FAIL ${name}: ${e.message}`); });
}

(async () => {
  await db.migrate();
  const u1 = await db.createUser('Ashley', 'x');
  const u2 = await db.createUser('Bob', 'x');
  const u3 = await db.createUser('Cara', 'x');
  await db.saveState(u1.id, { level: 50, stage: 300, bossesKilled: 5, rebirthCount: 0, power: 1000 });
  await db.saveState(u2.id, { level: 60, stage: 100, bossesKilled: 2, rebirthCount: 0, power: 2000 });
  await db.saveState(u3.id, { level: 10, stage: 5, bossesKilled: 0, rebirthCount: 0, power: 50000 });
  await db.createGuild('Shadow Legion', 'SHDW', 'Ashley');
  const gA = await db.getGuildByName('Shadow Legion');
  await db.joinGuild(gA.id, 'Bob');
  const u4 = await db.createUser('Eve', 'x');
  await db.saveState(u4.id, { level: 5, stage: 2, bossesKilled: 0, rebirthCount: 0, power: 50 });

  console.log('== leaderboard guild tags ==');
  await check('members carry their guild tag', async () => {
    const rows = await db.getLeaderboardRows(100);
    const byName = Object.fromEntries(rows.map((r) => [r.username, r.guild_tag]));
    assert.strictEqual(byName.Ashley, 'SHDW');
    assert.strictEqual(byName.Bob, 'SHDW');
  });
  await db.createGuild('Void Walkers', 'VOID', 'Cara');
  await check('guildless players show no tag', async () => {
    const rows = await db.getLeaderboardRows(100);
    const eve = rows.find((r) => r.username === 'Eve');
    assert.ok(eve, 'Eve on leaderboard');
    assert.strictEqual(eve.guild_tag, null);
  });

  console.log('== guild rankings ==');
  await check('rows carry name/tag/level/memberCount/totalPower', async () => {
    const ranks = await db.getGuildRankings(50);
    const legion = ranks.find((g) => g.tag === 'SHDW');
    assert.ok(legion);
    assert.strictEqual(legion.name, 'Shadow Legion');
    assert.strictEqual(legion.memberCount, 2);
    assert.strictEqual(legion.totalPower, 3000); // 1000 + 2000
    assert.strictEqual(legion.level, 1);
  });
  await check('ordering: level, then power, then members, then oldest', async () => {
    mem.public.none(`UPDATE guilds SET level = 5 WHERE name = 'Void Walkers'`);
    mem.public.none(`UPDATE guilds SET level = 5 WHERE name = 'Shadow Legion'`);
    // Both level 5: VOID power 50000 > SHDW power 3000 -> VOID first.
    let ranks = await db.getGuildRankings(50);
    assert.strictEqual(ranks[0].tag, 'VOID');
    assert.strictEqual(ranks[1].tag, 'SHDW');
    // Tie level AND power: more members wins.
    await db.createUser('Dan', 'x');
    const dan = await db.getUserByUsername('Dan');
    await db.saveState(dan.id, { level: 1, stage: 1, bossesKilled: 0, rebirthCount: 0, power: 47000 });
    await db.joinGuild(gA.id, 'Dan');
    // SHDW now: level 5, power 50000, members 3 vs VOID: level 5, power 50000, members 1
    ranks = await db.getGuildRankings(50);
    assert.strictEqual(ranks[0].tag, 'SHDW');
    assert.strictEqual(ranks[1].tag, 'VOID');
  });

  console.log(failures === 0 ? '\nPASS: guild leaderboard checks' : `\nFAIL: ${failures} checks failed`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
