'use strict';
/**
 * Concurrent gift-code redemption test.
 * Proves SELECT ... FOR UPDATE prevents double-spend under race conditions.
 * Run against a live server: PORT=3101 node test/redeem-race.js
 */
const assert = require('assert');
const bcrypt = require('bcryptjs');

const BASE = `http://localhost:${process.env.PORT || 3000}`;
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://koptest:koptest@localhost:5432/kop_test';

function jar() {
  const cookies = {};
  return {
    async fetch(path, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      const ck = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
      if (ck) headers.Cookie = ck;
      if (opts.body && typeof opts.body === 'object') {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(opts.body);
      }
      const res = await fetch(BASE + path, { ...opts, headers });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        for (const part of setCookie.split(',')) {
          const m = part.trim().match(/^([^=;]+)=([^;]*)/);
          if (m) cookies[m[1]] = m[2];
        }
      }
      let body = null;
      try { body = await res.json(); } catch { /* empty */ }
      return { status: res.status, body };
    },
  };
}

(async () => {
  const db = require('../src/db');
  await db.migrate();
  const owner = await db.getUserByUsername('GameMaster');
  assert.ok(owner, 'owner must exist (server seeds it)');

  // 5 race users, created directly in the DB (avoids the auth rate limiter)
  const users = ['racer1', 'racer2', 'racer3', 'racer4', 'racer5'];
  for (const u of users) {
    if (!(await db.getUserByUsername(u))) {
      await db.createUser(u, bcrypt.hashSync('secret123', 4));
    }
  }
  // 1-use code for the 5-way race
  const code1 = 'RACE-1111-AAAA';
  if (!(await db.getGiftCode(code1))) {
    await db.createGiftCode(code1, 'warden', 1, owner.id);
  }
  // 2-use code for the 3-way race
  const code2 = 'RACE-2222-BBBB';
  if (!(await db.getGiftCode(code2))) {
    await db.createGiftCode(code2, 'warden', 2, owner.id);
  }
  // 5-use code for the same-user double-redeem race
  const code3 = 'RACE-3333-CCCC';
  if (!(await db.getGiftCode(code3))) {
    await db.createGiftCode(code3, 'warden', 5, owner.id);
  }

  // log everyone in (parallel is fine)
  const jars = {};
  await Promise.all(users.map(async (u) => {
    const j = jar();
    const r = await j.fetch('/api/auth/login', { method: 'POST', body: { username: u, password: 'secret123' } });
    assert.strictEqual(r.status, 200, `login ${u}: ${JSON.stringify(r.body)}`);
    jars[u] = j;
  }));

  // TEST 1: 5 users race a 1-use code -> exactly 1 wins
  const results1 = await Promise.all(
    users.map((u) => jars[u].fetch('/api/redeem', { method: 'POST', body: { code: code1 } }))
  );
  const wins1 = results1.filter((r) => r.status === 200).length;
  const exhausted1 = results1.filter((r) => r.status === 409 && r.body.error === 'Code has been fully redeemed.').length;
  console.log(`1-use code, 5 racers: ${wins1} won, ${exhausted1} exhausted-rejected, others: ${results1.filter((r) => r.status !== 200 && r.status !== 409).length}`);
  assert.strictEqual(wins1, 1, 'exactly one winner: ' + JSON.stringify(results1.map((r) => [r.status, r.body])));
  assert.strictEqual(exhausted1, 4);

  // TEST 2: 3 users race a 2-use code -> exactly 2 win
  const trio = users.slice(0, 3);
  const results2 = await Promise.all(
    trio.map((u) => jars[u].fetch('/api/redeem', { method: 'POST', body: { code: code2 } }))
  );
  const wins2 = results2.filter((r) => r.status === 200).length;
  console.log(`2-use code, 3 racers: ${wins2} won`);
  assert.strictEqual(wins2, 2, JSON.stringify(results2.map((r) => [r.status, r.body])));

  // TEST 3: same user fires 2 concurrent redeems -> 1 ok + 1 already-redeemed
  const results3 = await Promise.all([
    jars.racer5.fetch('/api/redeem', { method: 'POST', body: { code: code3 } }),
    jars.racer5.fetch('/api/redeem', { method: 'POST', body: { code: code3 } }),
  ]);
  const wins3 = results3.filter((r) => r.status === 200).length;
  const dup3 = results3.filter((r) => r.status === 409 && r.body.error === 'You have already redeemed this code.').length;
  console.log(`same-user double redeem: ${wins3} won, ${dup3} already-redeemed`);
  assert.strictEqual(wins3, 1);
  assert.strictEqual(dup3, 1);

  // TEST 4: DB-level integrity — uses counters match redemption rows
  for (const [code, expectedUses] of [[code1, 1], [code2, 2], [code3, 1]]) {
    const gc = await db.getGiftCode(code);
    const { rows } = await db.pool.query('SELECT COUNT(*) AS n FROM code_redemptions WHERE code = $1', [code]);
    assert.strictEqual(Number(gc.uses), expectedUses, `${code} uses`);
    assert.strictEqual(Number(rows[0].n), expectedUses, `${code} redemption rows`);
  }
  await db.closePool();

  console.log('\nALL REDEEM-RACE TESTS PASSED');
})().catch((e) => {
  console.error('RACE TEST FAILURE:', e.message);
  process.exit(1);
});
