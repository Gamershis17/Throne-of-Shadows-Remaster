'use strict';
/**
 * Stream-3 titles expansion tests (no server, no DOM).
 * Verifies each new title's check() unlocks when its condition is met,
 * stays locked on a fresh state (defensive against missing mine/forge
 * counters), that checkTitles() picks them all up as fresh unlocks,
 * and that equipping round-trips through state.activeTitle.
 *
 * Run: node test/test-titles.js
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

// Minimal fresh save shape: engine check functions must treat everything
// missing as locked, never throw.
const freshSave = () => ({});

(async () => {
  const Engine = await import('../public/js/engine.js');
  const { TITLES, TITLE_BY_ID, checkTitles } = Engine;

  const NEW = [
    { id: 'delver',        ok: { mine: { maxDepth: 20 } },      bad: { mine: { maxDepth: 19 } } },
    { id: 'deepdelver',    ok: { mine: { maxDepth: 40 } },      bad: { mine: { maxDepth: 39 } } },
    { id: 'corediver',     ok: { mine: { maxDepth: 60 } },      bad: { mine: { maxDepth: 59 } } },
    { id: 'rockbreaker',   ok: { mine: { totalTaps: 1000 } },   bad: { mine: { totalTaps: 999 } } },
    { id: 'orehoarder',    ok: { mine: { totalMined: 1000 } },  bad: { mine: { totalMined: 999 } } },
    { id: 'prospector',    ok: { mine: { pickaxe: 3 } },        bad: { mine: { pickaxe: 2 } } },
    { id: 'master-miner',  ok: { mine: { pickaxe: 7 } },        bad: { mine: { pickaxe: 6 } } },
    { id: 'starforger',    ok: { forge: { crafts: 1 } },        bad: { forge: { crafts: 0 } } },
    { id: 'galaxyforger',  ok: { forge: { crafts: 10 } },       bad: { forge: { crafts: 9 } } },
    { id: 'transcendent',  ok: { forge: { superCrafted: true } }, bad: { forge: { superCrafted: false } } },
    { id: 'ever-reborn',   ok: { rebirthCount: 100 },           bad: { rebirthCount: 99 } },
    { id: 'true-capped',   ok: { level: 120, rebirthCount: 1 }, bad: { level: 120, rebirthCount: 0 } },
  ];
  const defs = Object.fromEntries(TITLES.map(t => [t.id, t]));

  console.log('== titles exist & resolve ==');
  check('at least 12 new titles appended', () => {
    assert.ok(TITLES.length >= 48, `expected >=48, got ${TITLES.length}`);
  });
  for (const { id } of NEW) {
    check(`TITLE_BY_ID resolves ${id}`, () => {
      assert.ok(TITLE_BY_ID[id], `missing ${id}`);
      assert.strictEqual(typeof TITLE_BY_ID[id].desc, 'string');
      assert.ok(TITLE_BY_ID[id].desc.length > 0, 'desc empty');
    });
  }

  console.log('== checks unlock at threshold ==');
  for (const { id, ok, bad } of NEW) {
    check(`${id}: unlocks when condition met`, () => {
      assert.strictEqual(!!defs[id].check(ok), true);
    });
    check(`${id}: locked just below threshold`, () => {
      assert.strictEqual(!!defs[id].check(bad), false);
    });
    check(`${id}: locked on a fresh save (no crash)`, () => {
      assert.strictEqual(!!defs[id].check(freshSave()), false);
    });
  }

  console.log('== checkTitles integration ==');
  check('fresh save: no fresh unlocks, wanderer seeded', () => {
    const s = freshSave();
    const fresh = checkTitles(s);
    assert.deepStrictEqual(fresh, []);
    assert.deepStrictEqual(s.titlesUnlocked, ['wanderer']);
  });
  check('fully-progressed save: all 12 unlock fresh', () => {
    const s = {
      mine: { maxDepth: 60, totalTaps: 5000, totalMined: 5000, pickaxe: 7 },
      forge: { crafts: 10, superCrafted: true },
      rebirthCount: 100, level: 120, gold: 0, stats: {},
    };
    const fresh = checkTitles(s);
    const ids = fresh.map(t => t.id);
    for (const { id } of NEW) assert.ok(ids.includes(id), `${id} not in fresh`);
    assert.strictEqual(ids.filter(id => !NEW.some(n => n.id === id)).length, 8,
      'expected exactly the 8 old level/rebirth titles alongside the 12 new ones');
    // (idle-king, reborn, phoenix, immortal, paragon, demigod, worldforger, veteran)
  });
  check('already-unlocked titles never re-report', () => {
    const s = {
      mine: { maxDepth: 60 }, forge: {}, rebirthCount: 0, level: 1, gold: 0, stats: {},
    };
    const first = checkTitles(s);
    assert.ok(first.some(t => t.id === 'delver'));
    const second = checkTitles(s);
    assert.ok(!second.some(t => t.id === 'delver'), 'delver re-reported');
  });

  console.log('== equip path ==');
  check('equipping sets activeTitle (mirrors app.js onTitle guard)', () => {
    const s = freshSave();
    checkTitles(s);
    const id = 'delver';
    s.mine = { maxDepth: 20 };
    checkTitles(s);
    // app.js onTitle: if (!(s.titlesUnlocked||[]).includes(id)) return; s.activeTitle = id;
    assert.ok((s.titlesUnlocked || []).includes(id), 'delver must be unlocked first');
    s.activeTitle = id;
    assert.strictEqual(Engine.titleName(s.activeTitle), TITLE_BY_ID[id].name);
    assert.strictEqual(s.activeTitle, 'delver');
  });
  check('onTitle guard rejects locked ids', () => {
    const s = freshSave();
    checkTitles(s);
    const id = 'corediver';
    const allowed = (s.titlesUnlocked || []).includes(id);
    assert.strictEqual(allowed, false, 'locked title must fail the onTitle guard');
  });

  if (failures) {
    console.error(`\n${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log('\nAll title tests passed.');
})();
