'use strict';
/**
 * Name-style visibility tests (batch/name-style-visibility).
 *
 * Covers: other players' nameColor/nameFx are served on public payloads —
 *   - GET /api/leaderboard entries include nameColor/nameFx
 *   - GET /api/player/:username/inspect includes nameColor/nameFx
 *   - malicious values saved in a blob are sanitized before serving
 *     (sanitizeStateBlob strips them on save; nameStyleOf is a second net)
 *   - unit tests for nameStyleOf() edge cases
 *
 * Boot the pg-mem harness first (fresh for a clean DB):
 *   PORT=3210 node test/pgtest-boot.js &
 * Then: node test/name-style-visibility.js
 * The harness seeds owner1/gm1/admin1/mod1/player1 (password: password123).
 */
const assert = require('assert');

const BASE = `http://localhost:${process.env.PORT || 3210}`;
let failures = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ok   ${name}`))
    .catch((e) => {
      failures++;
      console.error(`  FAIL ${name}: ${e.message}`);
    });
}

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

(async () => {
  console.log('== nameStyleOf unit ==');
  const { nameStyleOf } = require('../src/db.js');
  await check('keeps valid color + fx', () => {
    assert.deepStrictEqual(nameStyleOf({ nameColor: '#ff5b5b', nameFx: 'fire' }),
      { nameColor: '#ff5b5b', nameFx: 'fire' });
  });
  await check('rejects non-hex color', () => {
    assert.deepStrictEqual(nameStyleOf({ nameColor: 'red', nameFx: 'fire' }),
      { nameColor: null, nameFx: 'fire' });
  });
  await check('rejects 3-digit hex', () => {
    assert.deepStrictEqual(nameStyleOf({ nameColor: '#fff', nameFx: 'fire' }),
      { nameColor: null, nameFx: 'fire' });
  });
  await check('rejects unknown fx id', () => {
    assert.deepStrictEqual(nameStyleOf({ nameColor: '#ff5b5b', nameFx: 'sparkle";alert(1)' }),
      { nameColor: '#ff5b5b', nameFx: 'none' });
  });
  await check('handles null/undefined/non-object', () => {
    assert.deepStrictEqual(nameStyleOf(null), { nameColor: null, nameFx: 'none' });
    assert.deepStrictEqual(nameStyleOf(undefined), { nameColor: null, nameFx: 'none' });
    assert.deepStrictEqual(nameStyleOf('x'), { nameColor: null, nameFx: 'none' });
  });
  await check('missing fields default safely', () => {
    assert.deepStrictEqual(nameStyleOf({}), { nameColor: null, nameFx: 'none' });
  });

  console.log('== public payloads ==');
  const p1 = jar();
  // login as player1 (seeded by the harness)
  const login = await p1.fetch('/api/auth/login', {
    method: 'POST',
    body: { username: 'player1', password: 'password123' },
  });
  assert.strictEqual(login.status, 200, `login failed: ${JSON.stringify(login.body)}`);

  // Save a styled name via the public save endpoint.
  const styled = {
    nameColor: '#ff5b5b',
    nameFx: 'fire',
    level: 1, stage: 1,
  };
  const save = await p1.fetch('/api/state', { method: 'POST', body: { state: styled } });
  assert.strictEqual(save.status, 200, `save failed: ${JSON.stringify(save.body)}`);

  await check('leaderboard serves player1 name style', async () => {
    const lb = await p1.fetch('/api/leaderboard?by=level');
    assert.strictEqual(lb.status, 200);
    const en = (lb.body.entries || []).find((e) => e.username === 'player1');
    assert.ok(en, 'player1 missing from leaderboard');
    assert.strictEqual(en.nameColor, '#ff5b5b');
    assert.strictEqual(en.nameFx, 'fire');
  });

  await check('inspect serves player1 name style', async () => {
    const ins = await p1.fetch('/api/player/player1/inspect');
    assert.strictEqual(ins.status, 200);
    assert.strictEqual(ins.body.nameColor, '#ff5b5b');
    assert.strictEqual(ins.body.nameFx, 'fire');
  });

  await check('unstyled player defaults safely', async () => {
    const g1 = jar();
    const gl = await g1.fetch('/api/auth/login', {
      method: 'POST',
      body: { username: 'gm1', password: 'password123' },
    });
    assert.strictEqual(gl.status, 200);
    const gs = await g1.fetch('/api/state', { method: 'POST', body: { state: { level: 1, stage: 1 } } });
    assert.strictEqual(gs.status, 200);
    const lb = await p1.fetch('/api/leaderboard?by=level');
    const en = (lb.body.entries || []).find((e) => e.username === 'gm1');
    assert.ok(en, 'gm1 missing from leaderboard');
    assert.strictEqual(en.nameColor, null);
    assert.strictEqual(en.nameFx, 'none');
  });

  await check('malicious style values never reach payloads', async () => {
    // Save with junk: sanitizer should strip on save; nameStyleOf is the net.
    const bad = { nameColor: 'red";alert(1)//', nameFx: 'sparkle', level: 1, stage: 1 };
    const s2 = await p1.fetch('/api/state', { method: 'POST', body: { state: bad } });
    assert.strictEqual(s2.status, 200);
    const lb = await p1.fetch('/api/leaderboard?by=level');
    const en = (lb.body.entries || []).find((e) => e.username === 'player1');
    assert.strictEqual(en.nameColor, null);
    assert.strictEqual(en.nameFx, 'none');
  });

  if (failures) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nall name-style-visibility tests passed');
})();
