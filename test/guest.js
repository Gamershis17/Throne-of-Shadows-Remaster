'use strict';
/**
 * Guest-mode unit tests (no server, no DOM).
 * Stubs localStorage, imports public/js/guest.js, and verifies the
 * local profile lifecycle: name sanitizing, save/load round-trip,
 * reload persistence, corrupt-blob tolerance, and clearing.
 *
 * Run: node test/guest.js
 */
const assert = require('assert');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${name}: ${e.message}`);
  }
}

// --- localStorage stub (Map-backed, survives "reload" by re-import) ---
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

(async () => {
  const store = makeStorage();
  globalThis.localStorage = store;
  const guest = await import('../public/js/guest.js');

  console.log('== guest storage ==');
  check('no save initially -> loadGuest null', () => {
    assert.strictEqual(guest.loadGuest(), null);
    assert.strictEqual(guest.hasGuestSave(), false);
  });

  check('sanitize: empty/blank -> "Guest"', () => {
    assert.strictEqual(guest.sanitizeGuestName(''), 'Guest');
    assert.strictEqual(guest.sanitizeGuestName('   '), 'Guest');
    assert.strictEqual(guest.sanitizeGuestName(null), 'Guest');
  });

  check('sanitize: trims, caps at 16 chars, strips controls', () => {
    assert.strictEqual(guest.sanitizeGuestName('  Hero123  '), 'Hero123');
    assert.strictEqual(guest.sanitizeGuestName('abcdefghijklmnopqrs'), 'abcdefghijklmnop');
    assert.strictEqual(guest.sanitizeGuestName('a\u0000b\u0007c'), 'abc');
    assert.strictEqual(guest.sanitizeGuestName('a  b   c'), 'a b c');
  });

  const fakeState = { race: 'human', level: 5, gold: 1234, stats: { kills: 42 } };
  check('saveGuest -> loadGuest round-trip', () => {
    assert.strictEqual(guest.saveGuest('TestHero', fakeState), true);
    const g = guest.loadGuest();
    assert.ok(g);
    assert.strictEqual(g.name, 'TestHero');
    assert.deepStrictEqual(g.state, fakeState);
    assert.ok(Number(g.lastSeen) > 0);
    assert.strictEqual(guest.hasGuestSave(), true);
  });

  check('guest blob survives "reload" (fresh import, same storage)', async () => {
    const g2 = await import('../public/js/guest.js?reload=1');
    const g = g2.loadGuest();
    assert.ok(g);
    assert.strictEqual(g.name, 'TestHero');
    assert.strictEqual(g.state.gold, 1234);
    assert.strictEqual(g.state.stats.kills, 42);
  });

  check('corrupt blob -> loadGuest null, never throws', () => {
    store._map.set(guest.GUEST_KEY, 'not-json{{{');
    assert.strictEqual(guest.loadGuest(), null);
    store._map.set(guest.GUEST_KEY, JSON.stringify({ v: 1, name: 'x' })); // missing state
    assert.strictEqual(guest.loadGuest(), null);
    store._map.delete(guest.GUEST_KEY);
  });

  check('clearGuest removes the save', () => {
    guest.saveGuest('Hero', fakeState);
    assert.strictEqual(guest.hasGuestSave(), true);
    guest.clearGuest();
    assert.strictEqual(guest.hasGuestSave(), false);
    assert.strictEqual(guest.loadGuest(), null);
  });

  check('saveGuest with no storage -> false, no throw', () => {
    delete globalThis.localStorage;
    assert.strictEqual(guest.saveGuest('H', fakeState), false);
    assert.strictEqual(guest.loadGuest(), null);
    globalThis.localStorage = store;
  });

  console.log('== guest + engine integration ==');
  const Engine = await import('../public/js/engine.js');
  check('engine defaultState passes through guest save/load', () => {
    const st = Engine.defaultState('elf');
    st.level = 7;
    assert.strictEqual(guest.saveGuest('ElfGuest', st), true);
    const g = guest.loadGuest();
    const ensured = Engine.ensureState(g.state);
    assert.strictEqual(ensured.race, 'elf');
    assert.strictEqual(ensured.level, 7);
    assert.ok(Array.isArray(ensured.pets.collection));
  });

  console.log(failures === 0 ? '\nGUEST TESTS PASSED' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
