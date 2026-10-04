'use strict';
/**
 * Guest-mode server tests: the guest feature itself is client-side
 * (localStorage only), but the register-from-guest migration path and
 * the "guests can't touch auth endpoints" guarantee are server-side.
 *
 * Boot the server first with the pg-mem harness:
 *   PORT=3210 node /tmp/pgtest/boot.js &
 * Then: node test/guest-server.js
 */
const assert = require('assert');

const BASE = `http://localhost:${process.env.PORT || 3210}`;
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
  }
}

// A guest-style state blob: what the browser's localStorage would hold
// after a guest plays (built by the same engine shape).
function guestBlob() {
  return {
    race: 'elf', mode: 'clicker', level: 12, xp: 500, xpNext: 1000,
    gold: 3450, stars: 3, stage: 14, bossesKilled: 1,
    rebirthCount: 0,
    hero: { hp: 90, maxHp: 120, attack: 25, defense: 8 },
    party: [], inventory: [], upgrades: { weapon: 2, armor: 1, skill: 1, tap: 1 },
    skills: ['power-strike'], companions: [], codesRedeemed: [],
    stats: { taps: 300, kills: 120, playTimeSec: 3600, maxCombo: 25 },
    playerClass: 'warrior', spec: 'dps',
    pets: { collection: [], activeUid: null, eggs: 0 },
  };
}

(async () => {
  console.log('== guest server guarantees ==');
  const anon = jar();

  await check('/api/status -> 200 (health)', async () => {
    const r = await anon.fetch('/api/status');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
  });

  await check('anon GET /api/state -> 401 (no guest server reads)', async () => {
    const r = await anon.fetch('/api/state');
    assert.strictEqual(r.status, 401);
  });

  await check('anon POST /api/state -> 401 (no guest server writes)', async () => {
    const r = await anon.fetch('/api/state', { method: 'POST', body: { state: guestBlob() } });
    assert.strictEqual(r.status, 401);
  });

  await check('anon /api/guilds/mine -> 401', async () => {
    const r = await anon.fetch('/api/guilds/mine');
    assert.strictEqual(r.status, 401);
  });

  console.log('== register-from-guest migration ==');
  const mig = jar();
  const migrantName = 'guestmigrant' + Math.floor(Math.random() * 1e6);
  await check('register migrant -> 200 + session', async () => {
    const r = await mig.fetch('/api/auth/register', {
      method: 'POST',
      body: { username: migrantName, password: 'password123' },
    });
    assert.ok(r.status === 200 || r.status === 201, `status ${r.status}`);
    assert.strictEqual(r.body.user.username, migrantName);
  });

  await check('upload guest blob -> 200', async () => {
    const r = await mig.fetch('/api/state', { method: 'POST', body: { state: guestBlob() } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
  });

  await check('migrated save round-trips (level/gold/race/class preserved)', async () => {
    const r = await mig.fetch('/api/state');
    assert.strictEqual(r.status, 200);
    const s = r.body.state;
    assert.strictEqual(s.level, 12);
    assert.strictEqual(s.gold, 3450);
    assert.strictEqual(s.race, 'elf');
    assert.strictEqual(s.playerClass, 'warrior');
    assert.strictEqual(s.stats.kills, 120);
  });

  await check('leaderboard is public -> 200', async () => {
    const r = await anon.fetch('/api/leaderboard');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.entries));
  });

  await check('logout -> me 401', async () => {
    const r = await mig.fetch('/api/auth/logout', { method: 'POST', body: {} });
    assert.strictEqual(r.status, 200);
    const me = await mig.fetch('/api/auth/me');
    assert.strictEqual(me.status, 401);
  });

  console.log(failures === 0 ? '\nGUEST SERVER TESTS PASSED' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
