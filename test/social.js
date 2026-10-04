'use strict';
/**
 * Social API test: friends + player inspect.
 * Boot the harness first:  PORT=3220 node test/social-boot.js &
 * Then:                     node test/social.js
 */
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 3220);

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

function jar() {
  let cookie = '';
  return {
    get headers() { return cookie ? { Cookie: cookie } : {}; },
    store(res) {
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
    },
  };
}

async function req(method, path, body, j) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(j ? j.headers : {}) } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  if (j) j.store(res);
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

async function main() {
  const alice = jar();
  const bob = jar();

  console.log('— auth —');
  let r = await req('POST', '/api/auth/login', { username: 'alice', password: 'password123' }, alice);
  check('alice login', r.status === 200, r.status);
  r = await req('POST', '/api/auth/login', { username: 'bob', password: 'password123' }, bob);
  check('bob login', r.status === 200, r.status);

  console.log('— friend requests —');
  r = await req('POST', '/api/friends/request', { username: 'alice' }, alice);
  check('self request rejected (400)', r.status === 400, r.status);
  r = await req('POST', '/api/friends/request', { username: 'ghost' }, alice);
  check('unknown user (404)', r.status === 404, r.status);
  r = await req('POST', '/api/friends/request', { username: 'bob' }, alice);
  check('alice → bob request (200)', r.status === 200 && r.data.username === 'bob', JSON.stringify(r.data));
  r = await req('POST', '/api/friends/request', { username: 'bob' }, alice);
  check('duplicate request (409)', r.status === 409, r.status);
  r = await req('POST', '/api/friends/request', { username: 'alice' }, bob);
  check('reverse-direction duplicate (409)', r.status === 409, r.status);

  console.log('— request lists —');
  r = await req('GET', '/api/friends', undefined, bob);
  check('bob sees incoming from alice',
    r.status === 200 && r.data.incoming.includes('alice') && r.data.friends.length === 0,
    JSON.stringify(r.data));
  r = await req('GET', '/api/friends', undefined, alice);
  check('alice sees outgoing to bob',
    r.status === 200 && r.data.outgoing.includes('bob'), JSON.stringify(r.data));

  console.log('— respond —');
  r = await req('POST', '/api/friends/respond', { username: 'alice', accept: true }, alice);
  check('requester cannot accept own request (404)', r.status === 404, r.status);
  r = await req('POST', '/api/friends/respond', { username: 'alice', accept: true }, bob);
  check('bob accepts (200)', r.status === 200 && r.data.accepted === true, JSON.stringify(r.data));
  r = await req('POST', '/api/friends/respond', { username: 'alice', accept: true }, bob);
  check('double accept (404)', r.status === 404, r.status);

  console.log('— friends list —');
  r = await req('GET', '/api/friends', undefined, alice);
  const fa = r.data.friends || [];
  check('alice has 1 friend (bob)',
    r.status === 200 && fa.length === 1 && fa[0].username === 'bob',
    JSON.stringify(r.data));
  check('bob shows online for alice (recent login)', fa.length === 1 && fa[0].online === true,
    JSON.stringify(fa[0]));
  check('friend profile has level/stage/class', fa.length === 1 && fa[0].level === 52 && fa[0].playerClass === 'warrior',
    JSON.stringify(fa[0]));

  console.log('— inspect —');
  r = await req('GET', '/api/player/bob/inspect', undefined, alice);
  const d = r.data || {};
  check('inspect bob (200)', r.status === 200, r.status);
  check('username/level/stage', d.username === 'bob' && d.level === 52 && d.stage === 140, `${d.username}/${d.level}/${d.stage}`);
  check('class/spec/race names', d.playerClass && d.playerClass.name && d.spec && d.spec.name && d.race && d.race.name,
    JSON.stringify({ c: d.playerClass, s: d.spec, r: d.race }));
  check('power is a positive number', typeof d.power === 'number' && d.power > 0, d.power);
  check('power matches client formula (attack>base)',
    d.power > 1200, `power=${d.power}`);
  check('bestRaidWave/kills', d.bestRaidWave === 34 && d.kills === 4200, `${d.bestRaidWave}/${d.kills}`);
  check('title', d.title === 'the Slayer', d.title);
  check('gear: weapon+armor equipped', Array.isArray(d.gear) && d.gear.length === 5 &&
    d.gear[0].item && d.gear[0].item.name === 'Duskfang Blade' && d.gear[0].item.enchant === 5,
    JSON.stringify(d.gear && d.gear[0]));
  check('gear stats present', d.gear[0].item.stats.attack === 4500, JSON.stringify(d.gear[0].item.stats));
  check('full stats block', d.stats && d.stats.attack === d.power && d.stats.maxHp > 0, JSON.stringify(d.stats && {a: d.stats.attack, p: d.power}));
  check('active pets', Array.isArray(d.pets) && d.pets.length === 2 && d.pets[0].name === 'Cinder Pup',
    JSON.stringify(d.pets));
  check('relation=friends for alice', d.relation === 'friends', d.relation);
  check('online flag', d.online === true, d.online);
  check('no sensitive fields', !('password_hash' in d) && !('role' in d) && !('gold' in d) && !('stars' in d) && !('email' in d),
    Object.keys(d).join(','));

  r = await req('GET', '/api/player/bob/inspect');
  check('anonymous inspect works, relation=none', r.status === 200 && r.data.relation === 'none', r.status);
  r = await req('GET', '/api/player/ghost/inspect');
  check('unknown player (404)', r.status === 404, r.status);
  r = await req('GET', '/api/player/ab/inspect');
  check('bad username (400)', r.status === 400, r.status);

  console.log('— remove —');
  r = await req('DELETE', '/api/friends/bob', undefined, alice);
  check('alice removes bob (200)', r.status === 200, r.status);
  r = await req('GET', '/api/friends', undefined, alice);
  check('friends empty after remove', r.status === 200 && r.data.friends.length === 0, JSON.stringify(r.data));
  r = await req('DELETE', '/api/friends/bob', undefined, alice);
  check('remove again (404)', r.status === 404, r.status);

  console.log('— decline flow —');
  r = await req('POST', '/api/friends/request', { username: 'alice' }, bob);
  check('bob → alice request (200)', r.status === 200, r.status);
  r = await req('POST', '/api/friends/respond', { username: 'bob', accept: false }, alice);
  check('alice declines (200)', r.status === 200 && r.data.accepted === false, JSON.stringify(r.data));
  r = await req('GET', '/api/friends', undefined, alice);
  check('no friendship after decline', r.data.friends.length === 0 && r.data.incoming.length === 0,
    JSON.stringify(r.data));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
