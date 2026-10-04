'use strict';
/**
 * Restart-persistence test.
 * Phase 1 (before restart): login as alice, save a marker state, print cookie.
 * Phase 2 (after restart): pass COOKIE=... — verifies /api/auth/me and /api/state.
 * Run: node test/restart-check.js save   -> prints COOKIE
 *      node test/restart-check.js verify (with COOKIE env)
 */
const BASE = `http://localhost:${process.env.PORT || 3000}`;

(async () => {
  const mode = process.argv[2];
  if (mode === 'save') {
    const res = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'secret123' }),
    });
    if (res.status !== 200) throw new Error('login failed: ' + res.status);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const marker = { level: 42, stage: 77, bossesKilled: 9, rebirthCount: 3, gold: 123456, stars: 777, race: 'fae' };
    const put = await fetch(BASE + '/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ state: marker }),
    });
    if (put.status !== 200) throw new Error('save failed: ' + put.status);
    require('fs').writeFileSync('/tmp/kop-cookie.txt', cookie);
    console.log('MARKER_SAVED (cookie written to /tmp/kop-cookie.txt)');
  } else if (mode === 'verify') {
    const cookie = process.env.COOKIE;
    if (!cookie) throw new Error('COOKIE env required');
    const me = await fetch(BASE + '/api/auth/me', { headers: { Cookie: cookie } });
    const meBody = await me.json();
    console.log('me status:', me.status, JSON.stringify(meBody));
    if (me.status !== 200) throw new Error('session did not survive restart');
    const st = await fetch(BASE + '/api/state', { headers: { Cookie: cookie } });
    const stBody = await st.json();
    const s = stBody.state;
    console.log('state:', JSON.stringify({ level: s.level, stage: s.stage, bossesKilled: s.bossesKilled, rebirthCount: s.rebirthCount, gold: s.gold, stars: s.stars, race: s.race }));
    const ok = s.level === 42 && s.stage === 77 && s.bossesKilled === 9 &&
      s.rebirthCount === 3 && s.gold === 123456 && s.stars === 777 && s.race === 'fae';
    if (!ok) throw new Error('state mismatch after restart');
    console.log('RESTART-PERSISTENCE OK');
  } else {
    throw new Error('usage: save|verify');
  }
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
