'use strict';
/**
 * Test for POST /api/gm/clear-guild-chat (new GM console command).
 * Boot harness first: PORT=3210 node test/pgtest-boot.js &
 * Then: node test/gm-clear-guild-chat.js
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
  const r = await j.fetch('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.strictEqual(r.status, 200, `login ${username}: ${JSON.stringify(r.body)}`);
  return j;
}

let userSeq = 0;
async function freshPlayer(prefix) {
  userSeq += 1;
  const username = `${prefix}${userSeq}_${Date.now() % 100000}`;
  const j = jar();
  const r = await j.fetch('/api/auth/register', { method: 'POST', body: { username, password: 'password123' } });
  assert.strictEqual(r.status, 201, `register ${username}: ${JSON.stringify(r.body)}`);
  return { jar: j, username };
}

(async () => {
  const gm = await login('gm1');
  const mod = await login('mod1');
  const player = await login('player1');

  console.log('== clear-guild-chat ==');

  // Victim: fresh player with a guild and 2 chat messages.
  const { jar: vj, username: victim } = await freshPlayer('chatvictim');
  let r = await vj.fetch('/api/guilds', { method: 'POST', body: { name: `Test Guild ${Date.now() % 100000}`, tag: 'TGC' } });
  assert.strictEqual(r.status, 200, `create guild: ${JSON.stringify(r.body)}`);
  for (const msg of ['hello world', 'second message']) {
    r = await vj.fetch('/api/guilds/chat', { method: 'POST', body: { message: msg } });
    assert.strictEqual(r.status, 200, `post chat: ${JSON.stringify(r.body)}`);
  }
  r = await vj.fetch('/api/guilds/chat?after=0');
  assert.strictEqual(r.body.messages.length, 2, 'expected 2 messages before clear');

  await check('gm clears chat, reports count', async () => {
    const r = await gm.fetch('/api/gm/clear-guild-chat', { method: 'POST', body: { username: victim } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.removed, 2, `removed count: ${JSON.stringify(r.body)}`);
  });

  await check('chat is empty but guild still exists', async () => {
    const c = await vj.fetch('/api/guilds/chat?after=0');
    assert.strictEqual(c.body.messages.length, 0, `messages after clear: ${JSON.stringify(c.body)}`);
    const m = await vj.fetch('/api/guilds/mine');
    assert.strictEqual(m.status, 200, `guild mine: ${JSON.stringify(m.body)}`);
    assert.ok(m.body.guild || m.body.guildId, 'guild should still exist');
  });

  await check('audit log records the wipe', async () => {
    const a = await gm.fetch('/api/gm/audit');
    const entries = a.body.entries || [];
    const hit = entries.find(e => e.action === 'clear-guild-chat' && e.target === victim);
    assert.ok(hit, `audit entry missing: ${JSON.stringify(entries.slice(0, 3))}`);
  });

  await check('unknown user -> 404', async () => {
    const r = await gm.fetch('/api/gm/clear-guild-chat', { method: 'POST', body: { username: 'no_such_user_xyz' } });
    assert.strictEqual(r.status, 404, JSON.stringify(r.body));
  });

  await check('target with no guild -> 404', async () => {
    const { username: loner } = await freshPlayer('loner');
    const r = await gm.fetch('/api/gm/clear-guild-chat', { method: 'POST', body: { username: loner } });
    assert.strictEqual(r.status, 404, JSON.stringify(r.body));
    assert.match(r.body.error || '', /not in a guild/);
  });

  await check('moderator cannot clear (403)', async () => {
    const r = await mod.fetch('/api/gm/clear-guild-chat', { method: 'POST', body: { username: victim } });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  });

  await check('player cannot clear (403)', async () => {
    const r = await player.fetch('/api/gm/clear-guild-chat', { method: 'POST', body: { username: victim } });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  });

  await check('admin can clear (200)', async () => {
    const admin = await login('admin1');
    const { jar: vj2, username: victim2 } = await freshPlayer('chatvictim');
    let r = await vj2.fetch('/api/guilds', { method: 'POST', body: { name: `TG2 ${Date.now() % 100000}`, tag: 'TG2' } });
    assert.strictEqual(r.status, 200, `create guild2: ${JSON.stringify(r.body)}`);
    r = await vj2.fetch('/api/guilds/chat', { method: 'POST', body: { message: 'admin clear me' } });
    assert.strictEqual(r.status, 200);
    r = await admin.fetch('/api/gm/clear-guild-chat', { method: 'POST', body: { username: victim2 } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.removed, 1);
  });

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
