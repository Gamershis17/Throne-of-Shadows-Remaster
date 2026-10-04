'use strict';
/**
 * GM console reorg tests (batch/gm-console-reorg).
 *
 * Covers the new/changed server behavior for the reorganized GM console:
 *   - role-gated permissions on the new endpoints
 *   - POST /api/gm/grant-pet   (owner|gm, amount 1-99, bumps blob.pets.eggs)
 *   - POST /api/gm/set-rebirth (owner|gm, count 0-999, sets blob.rebirthCount)
 *   - POST /api/gm/kick        (owner|admin, bumps users.session_version)
 *   - POST /api/gm/maintenance (owner, runtime override for /api/status)
 *   - gift codes with gear/gold/stars reward kinds + redemption
 *   - kick invalidates the victim's session everywhere (incl. /api/auth/me)
 *   - no other-player state blob leakage via selfState()
 *
 * Boot the pg-mem harness first (fresh for a clean DB):
 *   PORT=3210 node test/pgtest-boot.js &
 * Then: node test/gm-console-reorg.js
 * The harness seeds owner1/gm1/admin1/mod1/player1 (password: password123).
 *
 * Stateful sections register their own dedicated users so the suite is
 * hermetic: re-running against the same harness DB can't pollute results.
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
    if (e.actual !== undefined) console.error(`       actual=${JSON.stringify(e.actual)}`);
    if (e.expected !== undefined) console.error(`       expected=${JSON.stringify(e.expected)}`);
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

async function stateOf(j) {
  const r = await j.fetch('/api/state');
  assert.strictEqual(r.status, 200, `GET /api/state: ${JSON.stringify(r.body)}`);
  return r.body.state;
}

(async () => {
  const owner = await login('owner1');
  const gm = await login('gm1');
  const admin = await login('admin1');
  const mod = await login('mod1');
  const player = await login('player1');

  console.log('== permissions ==');
  await check('player cannot grant pet eggs (403)', async () => {
    const r = await player.fetch('/api/gm/grant-pet', { method: 'POST', body: { username: 'player1', amount: 1 } });
    assert.strictEqual(r.status, 403);
  });
  await check('moderator cannot grant pet eggs (403)', async () => {
    const r = await mod.fetch('/api/gm/grant-pet', { method: 'POST', body: { username: 'player1', amount: 1 } });
    assert.strictEqual(r.status, 403);
  });
  await check('v23: admin CAN grant pet eggs (admin is senior staff: owner > admin > gm)', async () => {
    const r = await admin.fetch('/api/gm/grant-pet', { method: 'POST', body: { username: 'player1', amount: 1 } });
    assert.ok(r.status === 200 || r.status === 201, `expected 200/201, got ${r.status}`);
  });
  await check('player cannot set rebirth (403)', async () => {
    const r = await player.fetch('/api/gm/set-rebirth', { method: 'POST', body: { username: 'player1', count: 1 } });
    assert.strictEqual(r.status, 403);
  });
  await check('player cannot kick (403)', async () => {
    const r = await player.fetch('/api/gm/kick', { method: 'POST', body: { username: 'player1' } });
    assert.strictEqual(r.status, 403);
  });
  await check('moderator cannot kick (403)', async () => {
    const r = await mod.fetch('/api/gm/kick', { method: 'POST', body: { username: 'player1' } });
    assert.strictEqual(r.status, 403);
  });
  await check('gm cannot toggle maintenance (403, owner only)', async () => {
    const r = await gm.fetch('/api/gm/maintenance', { method: 'POST', body: { enabled: true } });
    assert.strictEqual(r.status, 403);
  });
  await check('moderator CAN broadcast (201)', async () => {
    const r = await mod.fetch('/api/gm/broadcast', { method: 'POST', body: { message: 'hello from mod' } });
    // 429 is the broadcast anti-spam limiter (5 per 10 min per IP) when the
    // suite re-runs against the same harness; either way a moderator passes
    // the role gate (a 403 here would mean the permission check failed).
    assert.ok(r.status === 201 || r.status === 429, `status=${r.status}`);
  });
  await check('player cannot broadcast (403)', async () => {
    const r = await player.fetch('/api/gm/broadcast', { method: 'POST', body: { message: 'hi' } });
    assert.strictEqual(r.status, 403);
  });
  await check('player cannot create codes (403)', async () => {
    const r = await player.fetch('/api/gm/codes', { method: 'POST', body: { rewardKind: 'gold', amount: 5, maxUses: 1 } });
    assert.strictEqual(r.status, 403);
  });

  console.log('== grant-pet ==');
  const petp = await freshPlayer('petp');
  await check('amount 0 -> 400', async () => {
    const r = await gm.fetch('/api/gm/grant-pet', { method: 'POST', body: { username: petp.username, amount: 0 } });
    assert.strictEqual(r.status, 400);
  });
  await check('amount 100 -> 400', async () => {
    const r = await gm.fetch('/api/gm/grant-pet', { method: 'POST', body: { username: petp.username, amount: 100 } });
    assert.strictEqual(r.status, 400);
  });
  await check('amount -5 -> 400', async () => {
    const r = await gm.fetch('/api/gm/grant-pet', { method: 'POST', body: { username: petp.username, amount: -5 } });
    assert.strictEqual(r.status, 400);
  });
  await check('grant 5 eggs then 3 more (accumulates)', async () => {
    let r = await gm.fetch('/api/gm/grant-pet', { method: 'POST', body: { username: petp.username, amount: 5 } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.eggs, 5);
    r = await gm.fetch('/api/gm/grant-pet', { method: 'POST', body: { username: petp.username, amount: 3 } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.eggs, 8);
    const st = await stateOf(petp.jar);
    assert.strictEqual(st.pets.eggs, 8);
  });
  await check('grant eggs to unknown player -> 404', async () => {
    const r = await gm.fetch('/api/gm/grant-pet', { method: 'POST', body: { username: 'nope_nobody', amount: 1 } });
    assert.strictEqual(r.status, 404);
  });

  console.log('== set-rebirth ==');
  const rebp = await freshPlayer('rebp');
  await check('count -1 -> 400', async () => {
    const r = await gm.fetch('/api/gm/set-rebirth', { method: 'POST', body: { username: rebp.username, count: -1 } });
    assert.strictEqual(r.status, 400);
  });
  await check('count 1000 -> 400', async () => {
    const r = await gm.fetch('/api/gm/set-rebirth', { method: 'POST', body: { username: rebp.username, count: 1000 } });
    assert.strictEqual(r.status, 400);
  });
  await check('set rebirth count to 7', async () => {
    const r = await gm.fetch('/api/gm/set-rebirth', { method: 'POST', body: { username: rebp.username, count: 7 } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.rebirthCount, 7);
    const st = await stateOf(rebp.jar);
    assert.strictEqual(st.rebirthCount, 7);
  });

  console.log('== kick ==');
  await check('admin cannot kick the owner (403)', async () => {
    const r = await admin.fetch('/api/gm/kick', { method: 'POST', body: { username: 'owner1' } });
    assert.strictEqual(r.status, 403);
  });
  await check('admin cannot kick themselves (400)', async () => {
    const r = await admin.fetch('/api/gm/kick', { method: 'POST', body: { username: 'admin1' } });
    assert.strictEqual(r.status, 400);
  });
  await check('kick invalidates the victim session (state + me -> 401)', async () => {
    const victim = await freshPlayer('victim');
    const before = await victim.jar.fetch('/api/state');
    assert.strictEqual(before.status, 200);
    const r = await admin.fetch('/api/gm/kick', { method: 'POST', body: { username: victim.username } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.kicked, true);
    const after = await victim.jar.fetch('/api/state');
    assert.strictEqual(after.status, 401);
    const me = await victim.jar.fetch('/api/auth/me');
    assert.strictEqual(me.status, 401);
  });
  await check('kicked player can sign straight back in', async () => {
    const victim = await freshPlayer('victim2');
    const kick = await admin.fetch('/api/gm/kick', { method: 'POST', body: { username: victim.username } });
    assert.strictEqual(kick.status, 200);
    const j = await login(victim.username);
    const r = await j.fetch('/api/state');
    assert.strictEqual(r.status, 200);
  });

  console.log('== maintenance ==');
  await check('owner enables maintenance: /api/status reflects it', async () => {
    const r = await owner.fetch('/api/gm/maintenance', { method: 'POST', body: { enabled: true, message: 'Upgrading hamsters' } });
    assert.strictEqual(r.status, 200);
    const s = await (await fetch(`${BASE}/api/status`)).json();
    assert.strictEqual(s.maintenance, true);
    assert.strictEqual(s.message, 'Upgrading hamsters');
  });
  await check('owner disables maintenance: /api/status back to off', async () => {
    const r = await owner.fetch('/api/gm/maintenance', { method: 'POST', body: { enabled: false, message: '' } });
    assert.strictEqual(r.status, 200);
    const s = await (await fetch(`${BASE}/api/status`)).json();
    assert.strictEqual(s.maintenance, false);
  });
  await check('enabled must be boolean (400)', async () => {
    const r = await owner.fetch('/api/gm/maintenance', { method: 'POST', body: { enabled: 'yes' } });
    assert.strictEqual(r.status, 400);
  });

  console.log('== gift codes: create ==');
  let gearCode, goldCode, starCode;
  await check('create gear code', async () => {
    const r = await gm.fetch('/api/gm/codes', { method: 'POST', body: { rewardKind: 'gear', set: 'warden', maxUses: 5 } });
    assert.strictEqual(r.status, 201);
    assert.ok(r.body.code);
    assert.strictEqual(r.body.rewardKind, 'gear');
    gearCode = r.body.code;
  });
  await check('create gold code (5000)', async () => {
    const r = await gm.fetch('/api/gm/codes', { method: 'POST', body: { rewardKind: 'gold', amount: 5000, maxUses: 2 } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.rewardKind, 'gold');
    assert.strictEqual(r.body.rewardAmount, 5000);
    goldCode = r.body.code;
  });
  await check('create stars code (250)', async () => {
    const r = await gm.fetch('/api/gm/codes', { method: 'POST', body: { rewardKind: 'stars', amount: 250, maxUses: 2 } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.rewardKind, 'stars');
    starCode = r.body.code;
  });
  await check('bad rewardKind -> 400', async () => {
    const r = await gm.fetch('/api/gm/codes', { method: 'POST', body: { rewardKind: 'diamonds', amount: 5, maxUses: 1 } });
    assert.strictEqual(r.status, 400);
  });
  await check('gold code with amount 0 -> 400', async () => {
    const r = await gm.fetch('/api/gm/codes', { method: 'POST', body: { rewardKind: 'gold', amount: 0, maxUses: 1 } });
    assert.strictEqual(r.status, 400);
  });
  await check('code list shows reward kinds', async () => {
    const r = await gm.fetch('/api/gm/codes');
    assert.strictEqual(r.status, 200);
    const codes = Array.isArray(r.body) ? r.body : r.body.codes;
    const kinds = Object.fromEntries(codes.map((c) => [c.code, c.reward_kind]));
    assert.strictEqual(kinds[gearCode], 'gear');
    assert.strictEqual(kinds[goldCode], 'gold');
    assert.strictEqual(kinds[starCode], 'stars');
  });

  console.log('== gift codes: redeem ==');
  const codep = await freshPlayer('codep');
  await check('redeem gold code: gold increases, code recorded', async () => {
    const r = await codep.jar.fetch('/api/redeem', { method: 'POST', body: { code: goldCode } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.reward.kind, 'gold');
    assert.strictEqual(r.body.reward.amount, 5000);
    assert.strictEqual(r.body.set, null);
    const st = await stateOf(codep.jar);
    assert.strictEqual(st.gold, 5000);
    assert.strictEqual(st.stars, 0);
    assert.ok(st.codesRedeemed.includes(goldCode));
  });
  await check('redeem stars code: stars increase', async () => {
    const r = await codep.jar.fetch('/api/redeem', { method: 'POST', body: { code: starCode } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.reward.kind, 'stars');
    assert.strictEqual(r.body.reward.amount, 250);
    const st = await stateOf(codep.jar);
    assert.strictEqual(st.stars, 250);
  });
  await check('redeem gear code: 5 warden pieces land in inventory', async () => {
    const before = (await stateOf(codep.jar)).inventory.length;
    const r = await codep.jar.fetch('/api/redeem', { method: 'POST', body: { code: gearCode } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.reward.kind, 'gear');
    assert.strictEqual(r.body.set, 'warden');
    const st = await stateOf(codep.jar);
    assert.strictEqual(st.inventory.length, before + 5);
    assert.ok(st.inventory.slice(-5).every((i) => i.set === 'warden'));
  });
  await check('redeem same code twice -> 409', async () => {
    const r = await codep.jar.fetch('/api/redeem', { method: 'POST', body: { code: goldCode } });
    assert.strictEqual(r.status, 409);
  });
  await check('redeem unknown code -> 404', async () => {
    const r = await codep.jar.fetch('/api/redeem', { method: 'POST', body: { code: 'NOPE-1234' } });
    assert.strictEqual(r.status, 404);
  });

  console.log('== gift codes: gold cap behavior ==');
  await check('gold code respects the cap for normal players', async () => {
    const capp = await freshPlayer('capp');
    // Park gold at the cap via a save, then redeem: must stay clamped.
    const st0 = await stateOf(capp.jar);
    const r0 = await capp.jar.fetch('/api/state', { method: 'POST', body: { state: { ...st0, gold: 9e15 } } });
    assert.strictEqual(r0.status, 200);
    const c = await gm.fetch('/api/gm/codes', { method: 'POST', body: { rewardKind: 'gold', amount: 5000, maxUses: 1 } });
    const r = await capp.jar.fetch('/api/redeem', { method: 'POST', body: { code: c.body.code } });
    assert.strictEqual(r.status, 200);
    const st = await stateOf(capp.jar);
    assert.strictEqual(st.gold, 9e15);
  });
  await check('infinite-gold perk bypasses the cap on code redemption', async () => {
    const infp = await freshPlayer('infp');
    const r0 = await owner.fetch('/api/gm/inf-gold', { method: 'POST', body: { username: infp.username, enabled: true } });
    assert.strictEqual(r0.status, 200);
    const st1 = await stateOf(infp.jar);
    assert.strictEqual(st1.infGold, true);
    const r1 = await infp.jar.fetch('/api/state', { method: 'POST', body: { state: { ...st1, gold: 9e15 } } });
    assert.strictEqual(r1.status, 200);
    const c = await gm.fetch('/api/gm/codes', { method: 'POST', body: { rewardKind: 'gold', amount: 5000, maxUses: 1 } });
    const r = await infp.jar.fetch('/api/redeem', { method: 'POST', body: { code: c.body.code } });
    assert.strictEqual(r.status, 200);
    const st = await stateOf(infp.jar);
    assert.strictEqual(st.gold, 9e15 + 5000);
  });

  console.log('== state leakage ==');
  await check('gm grant to ANOTHER player does not include their state blob', async () => {
    const r = await gm.fetch('/api/gm/grant', { method: 'POST', body: { username: 'player1', kind: 'stars', amount: 1 } });
    assert.strictEqual(r.status, 200);
    assert.ok(!('state' in r.body) || r.body.state === null || r.body.state === undefined);
  });
  await check('gm grant to SELF includes own state blob', async () => {
    const r = await gm.fetch('/api/gm/grant', { method: 'POST', body: { username: 'gm1', kind: 'stars', amount: 1 } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.state && typeof r.body.state === 'object');
  });
  await check('grant-pet to another player does not leak state', async () => {
    const leakp = await freshPlayer('leakp');
    const r = await gm.fetch('/api/gm/grant-pet', { method: 'POST', body: { username: leakp.username, amount: 1 } });
    assert.strictEqual(r.status, 200);
    assert.ok(!('state' in r.body) || r.body.state === null || r.body.state === undefined);
  });

  console.log(failures ? `\n${failures} FAILURES` : '\nall green');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('harness error:', e);
  process.exit(1);
});
