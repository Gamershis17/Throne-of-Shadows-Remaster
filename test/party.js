'use strict';
/**
 * Multiplayer party API tests (batch/multiplayer-party).
 *
 * Covers the server-side invite-code party system:
 *   - create / join / leave / leader kick / disband
 *   - one-party-per-human enforcement
 *   - 4-slot roster cap shared by humans + NPC allies (human joins bump NPCs)
 *   - invite code uniqueness + unambiguous alphabet validation
 *   - flattened members[] (isNpc/npcId) with server-read stats
 *   - server-calculated bonuses (+8% XP/+5% gold per other online human,
 *     +4% XP per own active NPC) and offline-member exclusion
 *   - level cap 90: save clamp, GM grant caps
 *
 * Boot the pg-mem harness first (fresh for a clean DB):
 *   PORT=3211 node test/pgtest-boot.js &
 * Then: PORT=3211 node test/party.js
 *
 * Stateful sections register their own dedicated users so the suite is
 * hermetic: re-running against the same harness DB can't pollute results.
 */
const assert = require('assert');

const BASE = `http://localhost:${process.env.PORT || 3211}`;
let failures = 0;
let userSeq = 0;

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

async function register(prefix) {
  const seq = userSeq++;
  // Keep usernames <= 20 chars; rotate the forwarded IP so the register
  // rate limiter (10/hour per IP) doesn't choke a 30+ user test run.
  const username = `${prefix}${seq}`;
  const j = jar();
  const r = await j.fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'X-Forwarded-For': `10.9.0.${(seq % 250) + 1}` },
    body: { username, password: 'password123' },
  });
  assert.strictEqual(r.status, 201, `register ${username}: ${JSON.stringify(r.body)}`);
  return { jar: j, username };
}

async function loginAs(username, password = 'password123') {
  const j = jar();
  const r = await j.fetch('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert.strictEqual(r.status, 200, `login ${username}: ${JSON.stringify(r.body)}`);
  return j;
}

function npc(id, name, emoji) {
  return { id, name, emoji, level: 5, attack: 50, defense: 10, maxHp: 1000, hp: 1000 };
}

async function saveState(j, patch) {
  const r = await j.fetch('/api/state', { method: 'POST', body: { state: patch } });
  assert.strictEqual(r.status, 200, `save: ${JSON.stringify(r.body)}`);
}

async function partyView(j) {
  const r = await j.fetch('/api/party');
  assert.strictEqual(r.status, 200, `get party: ${JSON.stringify(r.body)}`);
  return r.body.party;
}

async function main() {
  console.log('== party create / join / view ==');
  const u1 = await register('pa');
  const u2 = await register('pb');

  let code;
  await check('create returns a 6-char unambiguous code', async () => {
    const r = await u1.jar.fetch('/api/party/create', { method: 'POST', body: {} });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    code = r.body.code;
    assert.ok(/^[A-HJ-NP-Z2-9]{6}$/.test(code), `bad code ${code}`);
    const v = r.body.party;
    assert.ok(v && v.id, 'no party view');
    assert.strictEqual(v.leaderUsername, u1.username);
    assert.strictEqual(v.members.length, 1);
    assert.strictEqual(v.members[0].isNpc, false);
    assert.strictEqual(v.members[0].username, u1.username);
  });

  await check('join by code adds a human member', async () => {
    const r = await u2.jar.fetch('/api/party/join', { method: 'POST', body: { code } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const v = await partyView(u1.jar);
    const humans = v.members.filter(m => !m.isNpc);
    assert.strictEqual(humans.length, 2, `humans ${humans.length}`);
    assert.ok(humans.some(m => m.username === u2.username), 'u2 missing');
  });

  await check('join is case-insensitive and trims whitespace', async () => {
    const u = await register('pc');
    const r = await u.jar.fetch('/api/party/join', { method: 'POST', body: { code: '  ' + code.toLowerCase() + ' ' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    await u.jar.fetch('/api/party/leave', { method: 'POST', body: {} });
  });

  await check('ambiguous/invalid codes are rejected with 404', async () => {
    const u = await register('pd');
    for (const bad of ['ABCDEF0', 'AB1IAB', 'ab o ab', 'SHORT', 'TOOLONGCODE', '']) {
      const r = await u.jar.fetch('/api/party/join', { method: 'POST', body: { code: bad } });
      assert.strictEqual(r.status, 404, `code ${JSON.stringify(bad)} -> ${r.status}`);
    }
  });

  console.log('== one party per human ==');
  await check('cannot create a second party while in one', async () => {
    const r = await u2.jar.fetch('/api/party/create', { method: 'POST', body: {} });
    assert.strictEqual(r.status, 409, `status ${r.status}`);
  });

  await check('cannot join a second party while in one', async () => {
    const other = await register('pe');
    const rc = await other.jar.fetch('/api/party/create', { method: 'POST', body: {} });
    assert.strictEqual(rc.status, 200);
    const r = await u2.jar.fetch('/api/party/join', { method: 'POST', body: { code: rc.body.code } });
    assert.strictEqual(r.status, 409, `status ${r.status}`);
    await other.jar.fetch('/api/party/disband', { method: 'POST', body: {} });
  });

  console.log('== NPC attach + 4-slot roster ==');
  // u1 saves with 3 NPC allies AFTER joining (save hook attaches them).
  await check('owned NPC allies attach as flattened isNpc rows', async () => {
    await saveState(u1.jar, { party: [npc('n1', 'Lyra', '🧚'), npc('n2', 'Mira', '🛡️'), npc('n3', 'Gromm', '🪓')] });
    const v = await partyView(u1.jar);
    // 2 humans + 3 NPCs = 5 > 4 slots: only 2 NPCs attach
    const npcs = v.members.filter(m => m.isNpc);
    assert.strictEqual(v.members.length, 4, `roster ${v.members.length}`);
    assert.strictEqual(npcs.length, 2, `npcs ${npcs.length}`);
    for (const n of npcs) {
      assert.ok(n.npcId, 'npcId missing');
      assert.strictEqual(n.ownerUsername, u1.username);
      assert.ok(n.name && n.emoji, 'npc name/emoji missing');
    }
    // NPCs removed from the roster stay owned in the save
    const st = await u1.jar.fetch('/api/state');
    assert.strictEqual(st.body.state.party.length, 3, 'save lost an NPC');
  });

  await check('a joining human bumps NPC rows before "party full"', async () => {
    const u3 = await register('pf');
    const r = await u3.jar.fetch('/api/party/join', { method: 'POST', body: { code } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const v = await partyView(u1.jar);
    const humans = v.members.filter(m => !m.isNpc);
    const npcs = v.members.filter(m => m.isNpc);
    assert.strictEqual(humans.length, 3, `humans ${humans.length}`);
    assert.ok(v.members.length <= 4, `roster overflow ${v.members.length}`);
    assert.ok(npcs.length < 2, 'no NPC was bumped for the joining human');
  });

  await check('4th human fills the roster; 5th gets PARTY_FULL', async () => {
    const u4 = await register('pg');
    const r4 = await u4.jar.fetch('/api/party/join', { method: 'POST', body: { code } });
    assert.strictEqual(r4.status, 200, JSON.stringify(r4.body));
    const v = await partyView(u1.jar);
    assert.strictEqual(v.members.filter(m => !m.isNpc).length, 4, 'not 4 humans');
    assert.strictEqual(v.members.filter(m => m.isNpc).length, 0, 'NPCs should all be bumped');
    const u5 = await register('ph');
    const r5 = await u5.jar.fetch('/api/party/join', { method: 'POST', body: { code } });
    assert.strictEqual(r5.status, 409, `5th join -> ${r5.status}`);
    assert.ok(/full/i.test(r5.body.error || ''), `error ${r5.body.error}`);
  });

  console.log('== leave / kick / disband ==');
  await check('leave removes the member', async () => {
    // fresh party for leave semantics
    const a = await register('pi');
    const b = await register('pj');
    const rc = await a.jar.fetch('/api/party/create', { method: 'POST', body: {} });
    await b.jar.fetch('/api/party/join', { method: 'POST', body: { code: rc.body.code } });
    const rl = await b.jar.fetch('/api/party/leave', { method: 'POST', body: {} });
    assert.strictEqual(rl.status, 200);
    assert.strictEqual(await partyView(b.jar), null, 'leaver still sees party');
    const va = await partyView(a.jar);
    assert.strictEqual(va.members.filter(m => !m.isNpc).length, 1, 'leader view wrong');
  });

  await check('leader can kick; non-leader cannot', async () => {
    const a = await register('pk');
    const b = await register('pl');
    const rc = await a.jar.fetch('/api/party/create', { method: 'POST', body: {} });
    await b.jar.fetch('/api/party/join', { method: 'POST', body: { code: rc.body.code } });
    // resolve b's userId from the leader's view
    const va = await partyView(a.jar);
    const bRow = va.members.find(m => m.username === b.username);
    const rk = await b.jar.fetch('/api/party/kick', { method: 'POST', body: { userId: bRow.userId } });
    assert.strictEqual(rk.status, 403, `non-leader kick -> ${rk.status}`);
    const rk2 = await a.jar.fetch('/api/party/kick', { method: 'POST', body: { userId: bRow.userId } });
    assert.strictEqual(rk2.status, 200, JSON.stringify(rk2.body));
    assert.strictEqual(await partyView(b.jar), null, 'kicked user still sees party');
  });

  await check('leader leaving promotes oldest member; last leaving disbands', async () => {
    const a = await register('pm');
    const b = await register('pn');
    const rc = await a.jar.fetch('/api/party/create', { method: 'POST', body: {} });
    await b.jar.fetch('/api/party/join', { method: 'POST', body: { code: rc.body.code } });
    await a.jar.fetch('/api/party/leave', { method: 'POST', body: {} });
    const vb = await partyView(b.jar);
    assert.strictEqual(vb.leaderUsername, b.username, 'leadership not promoted');
    const rl = await b.jar.fetch('/api/party/leave', { method: 'POST', body: {} });
    assert.strictEqual(rl.body.disbanded, true, 'last leave should disband');
    assert.strictEqual(await partyView(b.jar), null);
  });

  await check('disband clears the party for everyone', async () => {
    const a = await register('po');
    const b = await register('pp');
    const rc = await a.jar.fetch('/api/party/create', { method: 'POST', body: {} });
    await b.jar.fetch('/api/party/join', { method: 'POST', body: { code: rc.body.code } });
    const rd = await b.jar.fetch('/api/party/disband', { method: 'POST', body: {} });
    assert.strictEqual(rd.status, 403, `non-leader disband -> ${rd.status}`);
    const rd2 = await a.jar.fetch('/api/party/disband', { method: 'POST', body: {} });
    assert.strictEqual(rd2.status, 200);
    assert.strictEqual(await partyView(a.jar), null);
    assert.strictEqual(await partyView(b.jar), null);
  });

  console.log('== server bonuses + offline exclusion ==');
  await check('bonuses: +8% XP/+5% gold per other ONLINE human, +4% XP per own NPC', async () => {
    const a = await register('pq');
    const b = await register('pr');
    const rc = await a.jar.fetch('/api/party/create', { method: 'POST', body: {} });
    // both save (online) — a owns 2 NPCs
    await saveState(a.jar, { party: [npc('bn1', 'Lyra', '🧚'), npc('bn2', 'Mira', '🛡️')] });
    await saveState(b.jar, { level: 10 });
    await b.jar.fetch('/api/party/join', { method: 'POST', body: { code: rc.body.code } });
    const va = await partyView(a.jar);
    assert.deepStrictEqual(va.bonuses, {
      onlineOtherHumans: 1, activeNpcs: 2, xpPct: 16, goldPct: 5,
    }, `a bonuses ${JSON.stringify(va.bonuses)}`);
    const vb = await partyView(b.jar);
    assert.deepStrictEqual(vb.bonuses, {
      onlineOtherHumans: 1, activeNpcs: 0, xpPct: 8, goldPct: 5,
    }, `b bonuses ${JSON.stringify(vb.bonuses)}`);
    await a.jar.fetch('/api/party/disband', { method: 'POST', body: {} });
  });

  await check('offline humans are visible but grant no bonus', async () => {
    const a = await register('ps'); // never saves -> offline
    const b = await register('pt');
    const rc = await a.jar.fetch('/api/party/create', { method: 'POST', body: {} });
    await saveState(b.jar, { level: 10 }); // b is online
    await b.jar.fetch('/api/party/join', { method: 'POST', body: { code: rc.body.code } });
    const vb = await partyView(b.jar);
    const aRow = vb.members.find(m => m.username === a.username);
    assert.ok(aRow, 'offline member missing from roster');
    assert.strictEqual(aRow.online, false, 'member without save should be offline');
    assert.strictEqual(vb.bonuses.onlineOtherHumans, 0, 'offline human granted bonus');
    assert.strictEqual(vb.bonuses.xpPct, 0);
    assert.strictEqual(vb.bonuses.goldPct, 0);
    await a.jar.fetch('/api/party/disband', { method: 'POST', body: {} });
  });

  await check('member stats are server-read; client cannot inject them', async () => {
    const a = await register('pu');
    await saveState(a.jar, { level: 42, stage: 77 });
    const rc = await a.jar.fetch('/api/party/create', { method: 'POST', body: {} });
    // try to smuggle stats through join payload on a second user
    const b = await register('pv');
    await b.jar.fetch('/api/party/join', {
      method: 'POST', body: { code: rc.body.code, level: 9999, attack: 1e12 },
    });
    const v = await partyView(a.jar);
    const aRow = v.members.find(m => m.username === a.username);
    assert.strictEqual(aRow.level, 42, `level ${aRow.level}`);
    assert.strictEqual(aRow.stage, 77, `stage ${aRow.stage}`);
    const bRow = v.members.find(m => m.username === b.username);
    assert.ok(bRow.level < 9999 && bRow.level >= 1, `injected level ${bRow.level}`);
    await a.jar.fetch('/api/party/disband', { method: 'POST', body: {} });
  });

  console.log('== level cap 90 ==');
  await check('save at level 95 clamps to 90', async () => {
    const u = await register('pw');
    await saveState(u.jar, { level: 95 });
    const st = await u.jar.fetch('/api/state');
    assert.strictEqual(st.body.state.level, 90, `level ${st.body.state.level}`);
  });

  await check('GM level grant cannot pass 90', async () => {
    const gm = await loginAs('gm1');
    const u = await register('px');
    await saveState(u.jar, { level: 85 });
    const r = await gm.fetch('/api/gm/grant', {
      method: 'POST', body: { username: u.username, kind: 'levels', amount: 20 },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const st = await u.jar.fetch('/api/state');
    assert.strictEqual(st.body.state.level, 90, `expected cap 90, got ${st.body.state.level}`);
  });

  await check('GM xp grant cannot level past 90', async () => {
    const gm = await loginAs('gm1');
    const u = await register('py');
    await saveState(u.jar, { level: 89 });
    const r = await gm.fetch('/api/gm/grant', {
      method: 'POST', body: { username: u.username, kind: 'xp', amount: 1e12 },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const st = await u.jar.fetch('/api/state');
    assert.ok(st.body.state.level <= 90, `xp-granted to ${st.body.state.level}`);
  });

  console.log(failures === 0 ? 'PARTY TESTS PASSED' : `${failures} PARTY TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
