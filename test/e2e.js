'use strict';
/**
 * End-to-end test suite for the King of Project PostgreSQL server.
 * Run:  DATABASE_URL=... OWNER_USERNAME=... OWNER_PASSWORD=... node test/e2e.js
 * The server must already be running on PORT (default 3000).
 */
const assert = require('assert');

const BASE = `http://localhost:${process.env.PORT || 3000}`;
let failures = 0;

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
          if (m) {
            if (/expires=thu, 01 jan 1970/i.test(part)) delete cookies[m[1]];
            else cookies[m[1]] = m[2];
          }
        }
      }
      let body = null;
      try { body = await res.json(); } catch { /* empty */ }
      return { status: res.status, body };
    },
  };
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${name}: ${e.message}`);
    if (e.actual !== undefined) console.error(`       actual=${JSON.stringify(e.actual)}`);
  }
}

(async () => {
  console.log('== auth ==');
  const anon = jar();
  await check('leaderboard is public + 200', async () => {
    const r = await anon.fetch('/api/leaderboard');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.entries));
  });

  const alice = jar();
  await check('register alice -> 201', async () => {
    const r = await alice.fetch('/api/auth/register', { method: 'POST', body: { username: 'alice', password: 'secret123' } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.user.username, 'alice');
    assert.strictEqual(r.body.user.role, 'player');
  });
  await check('duplicate ALICE -> 409 (case-insensitive)', async () => {
    const r = await anon.fetch('/api/auth/register', { method: 'POST', body: { username: 'ALICE', password: 'secret123' } });
    assert.strictEqual(r.status, 409);
  });
  await check('bad username -> 400', async () => {
    const r = await anon.fetch('/api/auth/register', { method: 'POST', body: { username: 'ab', password: 'secret123' } });
    assert.strictEqual(r.status, 400);
  });
  await check('short password -> 400', async () => {
    const r = await anon.fetch('/api/auth/register', { method: 'POST', body: { username: 'alice2', password: '12345' } });
    assert.strictEqual(r.status, 400);
  });
  await check('wrong password -> 401', async () => {
    const r = await anon.fetch('/api/auth/login', { method: 'POST', body: { username: 'alice', password: 'wrongpass' } });
    assert.strictEqual(r.status, 401);
  });
  await check('unknown user -> 401 (same message)', async () => {
    const r = await anon.fetch('/api/auth/login', { method: 'POST', body: { username: 'nobody', password: 'whatever1' } });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.body.error, 'Invalid username or password.');
  });

  const hero = jar();
  await check('register Hero (mixed case)', async () => {
    const r = await hero.fetch('/api/auth/register', { method: 'POST', body: { username: 'Hero', password: 'secret123' } });
    assert.strictEqual(r.status, 201);
  });
  await check('logout -> 200 + me -> 401', async () => {
    const r = await hero.fetch('/api/auth/logout', { method: 'POST' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body, { ok: true });
    const me = await hero.fetch('/api/auth/me');
    assert.strictEqual(me.status, 401);
  });
  await check('login "hero" (lowercase) finds "Hero"', async () => {
    const r = await hero.fetch('/api/auth/login', { method: 'POST', body: { username: 'hero', password: 'secret123' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.user.username, 'Hero');
  });

  console.log('== state ==');
  await check('GET /state fresh -> default blob, lastSeenAt null', async () => {
    const r = await alice.fetch('/api/state');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.lastSeenAt, null);
    assert.strictEqual(r.body.state.level, 1);
    assert.strictEqual(r.body.state.race, 'human');
  });
  await check('POST /state round-trip', async () => {
    const blob = { level: 5, stage: 7, bossesKilled: 2, rebirthCount: 1, gold: 999, stars: 10, race: 'orc' };
    const r = await alice.fetch('/api/state', { method: 'POST', body: { state: blob } });
    assert.deepStrictEqual(r.body, { ok: true });
    const g = await alice.fetch('/api/state');
    assert.strictEqual(g.body.state.level, 5);
    assert.strictEqual(g.body.state.stage, 7);
    assert.strictEqual(g.body.state.bossesKilled, 2);
    assert.strictEqual(g.body.state.rebirthCount, 1);
    assert.strictEqual(g.body.state.gold, 999);
    assert.ok(typeof g.body.lastSeenAt === 'number');
  });
  await check('POST /state garbage -> 400', async () => {
    const r = await alice.fetch('/api/state', { method: 'POST', body: { state: [1, 2] } });
    assert.strictEqual(r.status, 400);
  });
  await check('POST /state clamps absurd values', async () => {
    const r = await alice.fetch('/api/state', { method: 'POST', body: { state: { level: 999999999, gold: 1e30, stage: -5 } } });
    assert.strictEqual(r.status, 200);
    const g = await alice.fetch('/api/state');
    assert.strictEqual(g.body.state.level, 100000);
    assert.strictEqual(g.body.state.gold, 1e15);
    assert.strictEqual(g.body.state.stage, 1);
  });
  // restore sane state for later leaderboard assertions
  await alice.fetch('/api/state', { method: 'POST', body: { state: { level: 5, stage: 7, bossesKilled: 2, rebirthCount: 1, gold: 999, race: 'orc' } } });

  console.log('== leaderboard ==');
  const bob = jar();
  await check('register bob + save level 10', async () => {
    const r = await bob.fetch('/api/auth/register', { method: 'POST', body: { username: 'bob', password: 'secret123' } });
    assert.strictEqual(r.status, 201);
    await bob.fetch('/api/state', { method: 'POST', body: { state: { level: 10, stage: 20, bossesKilled: 1, rebirthCount: 0, race: 'human' } } });
  });
  await check('leaderboard ordered level desc, has race + fields', async () => {
    const r = await anon.fetch('/api/leaderboard');
    assert.strictEqual(r.status, 200);
    const e = r.body.entries;
    assert.ok(e.length >= 2);
    assert.strictEqual(e[0].username, 'bob');
    assert.strictEqual(e[0].level, 10);
    assert.strictEqual(e[0].race, 'human');
    assert.strictEqual(e[0].bossesKilled, 1);
    assert.strictEqual(e[0].rebirth, 0);
    assert.ok('stage' in e[0]);
    const aliceEntry = e.find((x) => x.username === 'alice');
    assert.strictEqual(aliceEntry.level, 5);
    assert.strictEqual(aliceEntry.race, 'orc');
  });

  console.log('== owner + GM ==');
  const owner = jar();
  await check('owner login (case-insensitive)', async () => {
    const r = await owner.fetch('/api/auth/login', {
      method: 'POST',
      body: { username: process.env.OWNER_USERNAME.toLowerCase(), password: process.env.OWNER_PASSWORD },
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.user.role, 'owner');
  });
  await check('gm overview', async () => {
    const r = await owner.fetch('/api/gm/overview');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.role, 'owner');
    assert.ok(r.body.playerCount >= 4, JSON.stringify(r.body));
    assert.ok(typeof r.body.codeCount === 'number');
  });
  await check('player cannot access gm overview -> 403; anon -> 401', async () => {
    const r1 = await alice.fetch('/api/gm/overview');
    assert.strictEqual(r1.status, 403);
    const r2 = await anon.fetch('/api/gm/overview');
    assert.strictEqual(r2.status, 401);
  });
  await check('grant stars to alice', async () => {
    const r = await owner.fetch('/api/gm/grant', { method: 'POST', body: { username: 'alice', kind: 'stars', amount: 500 } });
    assert.deepStrictEqual(r.body, { ok: true });
    const g = await alice.fetch('/api/state');
    assert.strictEqual(g.body.state.stars, 500);
  });
  await check('grant stars invalid amount -> 400', async () => {
    for (const amount of [0, 100001, 1.5, 'lots']) {
      const r = await owner.fetch('/api/gm/grant', { method: 'POST', body: { username: 'alice', kind: 'stars', amount } });
      assert.strictEqual(r.status, 400, `amount=${amount}`);
    }
  });
  await check('grant stars unknown user -> 404', async () => {
    const r = await owner.fetch('/api/gm/grant', { method: 'POST', body: { username: 'ghost', kind: 'stars', amount: 5 } });
    assert.strictEqual(r.status, 404);
  });
  await check('owner promotes bob to gm', async () => {
    const r = await owner.fetch('/api/roles', { method: 'POST', body: { username: 'bob', role: 'gm' } });
    assert.deepStrictEqual(r.body, { ok: true });
  });
  await check('owner cannot change own role -> 403; cannot change owner -> 403', async () => {
    const me = await owner.fetch('/api/auth/me');
    const r1 = await owner.fetch('/api/roles', { method: 'POST', body: { username: me.body.user.username, role: 'player' } });
    assert.strictEqual(r1.status, 403);
  });
  await check('gm (bob) cannot grant sovereign -> 403; can grant warden', async () => {
    const r1 = await bob.fetch('/api/gm/grant', { method: 'POST', body: { username: 'alice', kind: 'gear', set: 'sovereign' } });
    assert.strictEqual(r1.status, 403);
    const r2 = await bob.fetch('/api/gm/grant', { method: 'POST', body: { username: 'alice', kind: 'gear', set: 'warden' } });
    assert.deepStrictEqual(r2.body, { ok: true });
    const g = await alice.fetch('/api/state');
    const sets = g.body.state.inventory.map((i) => i.set);
    assert.ok(sets.includes('warden'), JSON.stringify(sets));
    assert.strictEqual(g.body.state.inventory.length, 5);
  });
  await check('gm cannot use /api/roles -> 403', async () => {
    const r = await bob.fetch('/api/roles', { method: 'POST', body: { username: 'alice', role: 'admin' } });
    assert.strictEqual(r.status, 403);
  });
  await check('owner grants sovereign to alice', async () => {
    const r = await owner.fetch('/api/gm/grant', { method: 'POST', body: { username: 'alice', kind: 'gear', set: 'sovereign' } });
    assert.deepStrictEqual(r.body, { ok: true });
    const g = await alice.fetch('/api/state');
    assert.strictEqual(g.body.state.inventory.length, 10);
  });
  await check('roster add/remove admin', async () => {
    let r = await owner.fetch('/api/gm/roster', { method: 'POST', body: { username: 'alice', action: 'add-admin' } });
    assert.deepStrictEqual(r.body, { ok: true });
    r = await owner.fetch('/api/gm/roster');
    assert.ok(r.body.admins.includes('alice'));
    assert.ok(r.body.gms.includes('bob'));
    r = await owner.fetch('/api/gm/roster', { method: 'POST', body: { username: 'alice', action: 'remove-admin' } });
    assert.deepStrictEqual(r.body, { ok: true });
  });

  console.log('== gift codes ==');
  let code2;
  await check('create code maxUses=2 -> 201 + format', async () => {
    const r = await owner.fetch('/api/gm/codes', { method: 'POST', body: { set: 'fateweaver', maxUses: 2 } });
    assert.strictEqual(r.status, 201);
    assert.match(r.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    code2 = r.body.code;
  });
  await check('create code invalid set/maxUses -> 400', async () => {
    const r1 = await owner.fetch('/api/gm/codes', { method: 'POST', body: { set: 'nope', maxUses: 1 } });
    assert.strictEqual(r1.status, 400);
    const r2 = await owner.fetch('/api/gm/codes', { method: 'POST', body: { set: 'warden', maxUses: 0 } });
    assert.strictEqual(r2.status, 400);
  });
  await check('gm codes list shows the code', async () => {
    const r = await bob.fetch('/api/gm/codes');
    assert.ok(r.body.codes.some((c) => c.code === code2 && c.gear_set === 'fateweaver' && c.max_uses === 2 && c.uses === 0));
  });
  await check('alice redeems (lowercase code accepted)', async () => {
    const before = (await alice.fetch('/api/state')).body.state.inventory.length;
    const r = await alice.fetch('/api/redeem', { method: 'POST', body: { code: code2.toLowerCase() } });
    assert.deepStrictEqual(r.body, { ok: true, set: 'fateweaver' });
    const after = await alice.fetch('/api/state');
    assert.strictEqual(after.body.state.inventory.length, before + 5);
    assert.ok(after.body.state.codesRedeemed.includes(code2));
  });
  await check('alice re-redeems -> 409 already', async () => {
    const r = await alice.fetch('/api/redeem', { method: 'POST', body: { code: code2 } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.error, 'You have already redeemed this code.');
  });
  await check('bob redeems (2nd use) -> ok', async () => {
    const r = await bob.fetch('/api/redeem', { method: 'POST', body: { code: code2 } });
    assert.deepStrictEqual(r.body, { ok: true, set: 'fateweaver' });
  });
  const carol = jar();
  await check('carol registers; redeem exhausted code -> 409', async () => {
    const reg = await carol.fetch('/api/auth/register', { method: 'POST', body: { username: 'carol', password: 'secret123' } });
    assert.strictEqual(reg.status, 201);
    const r = await carol.fetch('/api/redeem', { method: 'POST', body: { code: code2 } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.error, 'Code has been fully redeemed.');
  });
  await check('redeem unknown code -> 404; empty -> 400', async () => {
    const r1 = await alice.fetch('/api/redeem', { method: 'POST', body: { code: 'ZZZZ-ZZZZ-ZZZZ' } });
    assert.strictEqual(r1.status, 404);
    const r2 = await alice.fetch('/api/redeem', { method: 'POST', body: { code: '   ' } });
    assert.strictEqual(r2.status, 400);
  });

  console.log('== misc ==');
  await check('bad JSON -> 400', async () => {
    // raw malformed body (body parser runs before auth)
    const statusCode = await new Promise((resolve, reject) => {
      const http = require('http');
      const u = new URL(BASE);
      const req = http.request(
        { host: u.hostname, port: u.port, path: '/api/state', method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => resolve(res.statusCode)
      );
      req.on('error', reject);
      req.end('{bad json');
    });
    assert.strictEqual(statusCode, 400);
  });
  await check('unknown route -> 404 json', async () => {
    const r = await anon.fetch('/api/nope');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error, 'Not found.');
  });

  console.log(failures === 0 ? '\nALL E2E TESTS PASSED' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(1);
});
