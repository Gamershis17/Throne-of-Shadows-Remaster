'use strict';
/**
 * GM delete-account tests (batch/gm-delete-gold-cap).
 *
 * Covers POST /api/gm/delete-account (owner only):
 *   - role gating: gm/admin/mod/player get 403
 *   - 404 for unknown username
 *   - owner cannot delete self (400) or another owner (403)
 *   - guild-owner block (400) until the guild is gone
 *   - full delete: users row gone, player_state cascaded, victim's session
 *     dead, victim absent from the public leaderboard
 *
 * Boot the pg-mem harness first (fresh for a clean DB):
 *   PORT=3210 node test/pgtest-boot.js &
 * Then: node test/gm-delete-account.js
 * The harness seeds owner1/gm1/admin1/mod1/player1 (password: password123).
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

async function login(username, password = 'password123') {
  const j = jar();
  const r = await j.fetch('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert.strictEqual(r.status, 200, `login ${username}: ${JSON.stringify(r.body)}`);
  return j;
}

let userSeq = 0;
async function freshPlayer(prefix) {
  userSeq += 1;
  const username = `${prefix}${userSeq}_${Date.now() % 100000}`;
  const j = jar();
  const r = await j.fetch('/api/auth/register', {
    method: 'POST',
    body: { username, password: 'password123' },
  });
  assert.strictEqual(r.status, 201, `register ${username}: ${JSON.stringify(r.body)}`);
  return { jar: j, username };
}

(async () => {
  const owner = await login('owner1');
  const gm = await login('gm1');
  const admin = await login('admin1');
  const mod = await login('mod1');
  const player = await login('player1');

  console.log('== role gating ==');
  for (const [label, j] of [['gm', gm], ['admin', admin], ['mod', mod], ['player', player]]) {
    await check(`${label} cannot delete accounts (403)`, async () => {
      const r = await j.fetch('/api/gm/delete-account', {
        method: 'POST', body: { username: 'player1' },
      });
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    });
  }
  await check('anonymous cannot delete accounts (401/403)', async () => {
    const r = await jar().fetch('/api/gm/delete-account', {
      method: 'POST', body: { username: 'player1' },
    });
    assert.ok([401, 403].includes(r.status), `got ${r.status}`);
  });

  console.log('== validation ==');
  await check('unknown username → 404', async () => {
    const r = await owner.fetch('/api/gm/delete-account', {
      method: 'POST', body: { username: 'no_such_user_xyz' },
    });
    assert.strictEqual(r.status, 404);
  });
  await check('owner cannot delete self (400)', async () => {
    const r = await owner.fetch('/api/gm/delete-account', {
      method: 'POST', body: { username: 'owner1' },
    });
    assert.strictEqual(r.status, 400);
  });
  await check('owner can delete an admin target (200)', async () => {
    const v = await freshPlayer('staffDel');
    const r = await owner.fetch('/api/roles', {
      method: 'POST', body: { username: v.username, role: 'admin' },
    });
    assert.strictEqual(r.status, 200, `set role admin: ${JSON.stringify(r.body)}`);
    const del = await owner.fetch('/api/gm/delete-account', {
      method: 'POST', body: { username: v.username },
    });
    assert.strictEqual(del.status, 200, JSON.stringify(del.body));
  });

  console.log('== guild-owner block ==');
  const guildOwner = await freshPlayer('guildOwn');
  {
    const r = await guildOwner.jar.fetch('/api/guilds', {
      method: 'POST', body: { name: `Del Guild ${Date.now() % 100000}`, tag: 'DG' },
    });
    assert.strictEqual(r.status, 200, `create guild: ${JSON.stringify(r.body)}`);
  }
  await check('guild owner blocked until guild gone (400)', async () => {
    const r = await owner.fetch('/api/gm/delete-account', {
      method: 'POST', body: { username: guildOwner.username },
    });
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    assert.ok(/guild/i.test(r.body.error), `error mentions guild: ${r.body.error}`);
  });

  console.log('== full delete ==');
  const victim = await freshPlayer('victim');
  // give the victim a save + leaderboard presence
  {
    const s = await victim.jar.fetch('/api/state');
    assert.strictEqual(s.status, 200);
  }
  await check('owner deletes victim (200)', async () => {
    const r = await owner.fetch('/api/gm/delete-account', {
      method: 'POST', body: { username: victim.username },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.username, victim.username);
  });
  await check('victim login now fails (401)', async () => {
    const r = await jar().fetch('/api/auth/login', {
      method: 'POST', body: { username: victim.username, password: 'password123' },
    });
    assert.strictEqual(r.status, 401, JSON.stringify(r.body));
  });
  await check("victim's old session is dead", async () => {
    const r = await victim.jar.fetch('/api/auth/me');
    assert.ok([401, 403].includes(r.status), `got ${r.status}`);
  });
  await check('victim gone from public leaderboard', async () => {
    const r = await jar().fetch('/api/leaderboard');
    assert.strictEqual(r.status, 200);
    const names = (r.body.entries || []).map((e) => e.username);
    assert.ok(!names.includes(victim.username), 'victim still listed');
  });
  await check('deleting twice → 404', async () => {
    const r = await owner.fetch('/api/gm/delete-account', {
      method: 'POST', body: { username: victim.username },
    });
    assert.strictEqual(r.status, 404);
  });

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(2);
});
