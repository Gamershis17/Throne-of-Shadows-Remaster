'use strict';
/**
 * Test for POST /api/gm/grant-forge-box and /api/gm/grant-class-gear.
 * Boot harness first: PORT=3211 node test/pgtest-boot.js &
 * Then: PORT=3211 node test/gm-forge-box-class-gear.js
 */
const assert = require('assert');

const BASE = `http://localhost:${process.env.PORT || 3211}`;
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
  const r = await j.fetch('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.strictEqual(r.status, 200, `login ${username}: ${JSON.stringify(r.body)}`);
  return j;
}

(async () => {
  const gm = await login('gm1');
  const mod = await login('mod1');
  const player = await login('player1');

  console.log('== grant-forge-box ==');

  await check('gm grants forge box to self, ores land in state', async () => {
    const r = await gm.fetch('/api/gm/grant-forge-box', { method: 'POST', body: { username: 'gm1' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, true);
    const ores = (((r.body.state || {}).mine || {}).ores) || {};
    assert.ok((ores.galaxy || 0) >= 25, `galaxy ores: ${JSON.stringify(ores)}`);
    assert.ok((ores.adamant || 0) >= 40, `adamant ores: ${JSON.stringify(ores)}`);
  });

  await check('forge box stacks on repeat grant', async () => {
    const r = await gm.fetch('/api/gm/grant-forge-box', { method: 'POST', body: { username: 'gm1' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const ores = (((r.body.state || {}).mine || {}).ores) || {};
    assert.ok((ores.galaxy || 0) >= 50, `galaxy ores after 2 boxes: ${JSON.stringify(ores)}`);
  });

  await check('unknown user -> 404', async () => {
    const r = await gm.fetch('/api/gm/grant-forge-box', { method: 'POST', body: { username: 'no_such_user_xyz' } });
    assert.strictEqual(r.status, 404, JSON.stringify(r.body));
  });

  await check('player cannot grant (403)', async () => {
    const r = await player.fetch('/api/gm/grant-forge-box', { method: 'POST', body: { username: 'player1' } });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  });

  await check('moderator cannot grant (403)', async () => {
    const r = await mod.fetch('/api/gm/grant-forge-box', { method: 'POST', body: { username: 'player1' } });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  });

  console.log('== grant-class-gear ==');

  let grantedName = null;
  await check('gm grants class weapon to self, mythic, lands in inventory', async () => {
    const r = await gm.fetch('/api/gm/grant-class-gear', { method: 'POST', body: { username: 'gm1', slot: 'weapon' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, true);
    assert.ok(r.body.item, 'expected item name in response');
    grantedName = r.body.item;
    const invItems = ((r.body.state || {}).inventory) || [];
    const hit = invItems.find((it) => it.name === grantedName);
    assert.ok(hit, `granted item not in state inventory: ${grantedName}`);
    assert.strictEqual(hit.rarity, 'mythic', `rarity: ${JSON.stringify(hit)}`);
    assert.strictEqual(hit.slot, 'weapon', `slot: ${JSON.stringify(hit)}`);
  });

  await check('gm grants class armor to self', async () => {
    const r = await gm.fetch('/api/gm/grant-class-gear', { method: 'POST', body: { username: 'gm1', slot: 'armor' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.item, 'expected item name in response');
  });

  await check('bad slot -> 400', async () => {
    const r = await gm.fetch('/api/gm/grant-class-gear', { method: 'POST', body: { username: 'gm1', slot: 'helmet' } });
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
  });

  await check('unknown user -> 404', async () => {
    const r = await gm.fetch('/api/gm/grant-class-gear', { method: 'POST', body: { username: 'no_such_user_xyz', slot: 'weapon' } });
    assert.strictEqual(r.status, 404, JSON.stringify(r.body));
  });

  await check('player cannot grant (403)', async () => {
    const r = await player.fetch('/api/gm/grant-class-gear', { method: 'POST', body: { username: 'player1', slot: 'weapon' } });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  });

  await check('audit log records both grants', async () => {
    const a = await gm.fetch('/api/gm/audit');
    const entries = a.body.entries || [];
    assert.ok(entries.find((e) => e.action === 'grant-forge-box' && e.target === 'gm1'), 'forge-box audit entry missing');
    assert.ok(entries.find((e) => e.action === 'grant-class-gear' && e.target === 'gm1'), 'class-gear audit entry missing');
  });

  console.log(failures ? `\n${failures} FAILURES` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
