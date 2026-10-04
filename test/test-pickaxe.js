'use strict';
/**
 * Pickaxe upgrade unit tests (no server, no DOM).
 * Covers: PICKAXE_TIERS shape, buy/apply + damage mult in mineTap,
 * can't-afford-ore, can't-afford-gold, maxed-tier error, pickaxeTier
 * defensiveness, ensureState persistence, mining counters, forge
 * counters (crafts/superCrafted), rebirth preserving pickaxe+ores,
 * server validation clamps, and the GM `grant pickaxe` path.
 *
 * Run: node test/pickaxe.js
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

// Minimal playable state with a full ore wallet.
function makeState(overrides) {
  const s = {
    level: 10,
    gold: 1e9,
    upgrades: { tap: 1 },
    mine: {
      depth: 5,
      ores: {
        copper: 100, iron: 100, silver: 100, gold: 100,
        mithril: 100, adamant: 100, galaxy: 100, supergalaxy: 100,
      },
    },
  };
  return Object.assign(s, overrides || {});
}

(async () => {
  const E = await import('../public/js/engine.js');
  const V = require('../src/validation.js');

  console.log('== pickaxe tiers ==');
  check('11 tiers, index 0..10, mults ascend', () => {
    assert.strictEqual(E.PICKAXE_TIERS.length, 11);
    const mults = E.PICKAXE_TIERS.map(t => t.mult);
    assert.deepStrictEqual(mults, [1, 1.6, 2.5, 4, 6.5, 10, 16, 25, 40, 65, 100]);
    assert.strictEqual(E.PICKAXE_TIERS[0].cost, null);
    assert.deepStrictEqual(E.PICKAXE_TIERS[1].cost, { copper: 20, gold: 500 });
    assert.deepStrictEqual(E.PICKAXE_TIERS[7].cost, { supergalaxy: 10, gold: 500000000 });
    assert.deepStrictEqual(E.PICKAXE_TIERS[10].cost, { supergalaxy: 120, gold: 500000000000 });
    assert.strictEqual(E.MAX_PICKAXE_TIER, 10);
  });

  console.log('== ensureMine defaults ==');
  check('pickaxe + counters default to 0 on a fresh state', () => {
    const s = makeState();
    E.ensureMine(s);
    assert.strictEqual(s.mine.pickaxe, 0);
    assert.strictEqual(s.mine.totalTaps, 0);
    assert.strictEqual(s.mine.totalMined, 0);
    assert.strictEqual(s.mine.maxDepth, 0);
    assert.strictEqual(s.forge.crafts, 0);
    assert.strictEqual(s.forge.superCrafted, false);
  });
  check('ensureMine clamps a tampered pickaxe into 0..10', () => {
    const s = makeState();
    s.mine.pickaxe = 99;
    E.ensureMine(s);
    assert.strictEqual(s.mine.pickaxe, 10);
    s.mine.pickaxe = -3;
    E.ensureMine(s);
    assert.strictEqual(s.mine.pickaxe, 0);
    s.mine.pickaxe = 2.7;
    E.ensureMine(s);
    assert.strictEqual(s.mine.pickaxe, 2);
    s.mine.totalTaps = -5;
    s.mine.totalMined = Infinity;
    E.ensureMine(s);
    assert.strictEqual(s.mine.totalTaps, 0);
    assert.strictEqual(s.mine.totalMined, 0);
  });

  console.log('== buy / apply ==');
  check('buyPickaxeUpgrade buys tier 1, deducts copper + gold, applies damage mult', () => {
    const s = makeState();
    E.ensureMine(s);
    const before = E.mineDamage(s);
    const res = E.buyPickaxeUpgrade(s);
    assert.strictEqual(res, true);
    assert.strictEqual(s.mine.pickaxe, 1);
    assert.strictEqual(s.mine.ores.copper, 80);
    assert.strictEqual(s.gold, 1e9 - 500);
    assert.strictEqual(E.mineDamage(s), Math.max(1, Math.round(before * 1.6)));
  });
  check('upgrade cost preview returns next tier cost, null at max', () => {
    const s = makeState();
    E.ensureMine(s);
    assert.deepStrictEqual(E.pickaxeUpgradeCost(s), { copper: 20, gold: 500 });
    s.mine.pickaxe = 10;
    assert.strictEqual(E.pickaxeUpgradeCost(s), null);
  });
  check("can't-afford-ore returns an error string, no deduction", () => {
    const s = makeState();
    s.mine.ores.copper = 5;
    E.ensureMine(s);
    const res = E.buyPickaxeUpgrade(s);
    assert.strictEqual(typeof res, 'string');
    assert.ok(/Need 15 more Copper/.test(res), `unexpected: ${res}`);
    assert.strictEqual(s.mine.pickaxe, 0);
    assert.strictEqual(s.mine.ores.copper, 5);
  });
  check("can't-afford-gold returns an error string, ores untouched", () => {
    const s = makeState();
    s.gold = 10;
    E.ensureMine(s);
    const res = E.buyPickaxeUpgrade(s);
    assert.strictEqual(typeof res, 'string');
    assert.ok(/gold/i.test(res), `unexpected: ${res}`);
    assert.strictEqual(s.mine.pickaxe, 0);
    assert.strictEqual(s.mine.ores.copper, 100);
    assert.strictEqual(s.gold, 10);
  });
  check('maxed tier returns an error string', () => {
    const s = makeState();
    s.mine.pickaxe = 10;
    E.ensureMine(s);
    const res = E.buyPickaxeUpgrade(s);
    assert.strictEqual(typeof res, 'string');
    assert.ok(/MAX/i.test(res), `unexpected: ${res}`);
    assert.strictEqual(s.mine.pickaxe, 10);
  });
  check('infGold bypasses the gold cost', () => {
    const s = makeState();
    s.gold = 0;
    s.infGold = true;
    E.ensureMine(s);
    assert.strictEqual(E.buyPickaxeUpgrade(s), true);
    assert.strictEqual(s.mine.pickaxe, 1);
    assert.strictEqual(s.gold, 0);
  });
  check('multi-ore cost (tier 3 steel) deducts both ores', () => {
    const s = makeState();
    s.mine.pickaxe = 2;
    E.ensureMine(s);
    assert.strictEqual(E.buyPickaxeUpgrade(s), true);
    assert.strictEqual(s.mine.pickaxe, 3);
    assert.strictEqual(s.mine.ores.iron, 60);
    assert.strictEqual(s.mine.ores.silver, 80);
    assert.strictEqual(s.gold, 1e9 - 50000);
  });

  console.log('== pickaxeTier defensive ==');
  check('pickaxeTier never throws on garbage state', () => {
    assert.strictEqual(E.pickaxeTier(null).mult, 1);
    assert.strictEqual(E.pickaxeTier({}).mult, 1);
    assert.strictEqual(E.pickaxeTier({ mine: { pickaxe: 'x' } }).mult, 1);
    assert.strictEqual(E.pickaxeTier({ mine: { pickaxe: 99 } }).mult, 100);
    assert.strictEqual(E.pickaxeTier({ mine: { pickaxe: 4 } }).name, 'Mithril Pick');
  });

  console.log('== mineTap counters ==');
  check('totalTaps/totalMined/maxDepth increment on taps and breaks', () => {
    const s = makeState();
    E.ensureMine(s);
    E.mineTap(s);
    assert.strictEqual(s.mine.totalTaps, 1);
    assert.strictEqual(s.mine.totalMined, 1);
    // Force a break on the next tap: 1 HP rock, any damage breaks it.
    s.mine.rockHp = 1;
    const d0 = s.mine.depth;
    const res = E.mineTap(s);
    assert.strictEqual(res.broke, true);
    assert.strictEqual(s.mine.totalTaps, 2);
    assert.strictEqual(s.mine.totalMined, 2 + res.bonus.length);
    assert.strictEqual(s.mine.depth, d0 + 1);
    assert.strictEqual(s.mine.maxDepth, d0 + 1);
  });
  check('pickaxe mult is applied inside mineTap damage', () => {
    const s0 = makeState();
    s0.mine.pickaxe = 0;
    const s7 = makeState();
    s7.mine.pickaxe = 7;
    const d0 = E.mineDamage(s0);
    const d7 = E.mineDamage(s7);
    assert.strictEqual(d7, Math.max(1, Math.round(d0 * 25)));
    assert.ok(d7 > d0 * 20);
  });

  console.log('== forge counters ==');
  check('craftGalaxyItem bumps crafts; super sets superCrafted', () => {
    const s = makeState();
    E.ensureMine(s);
    const item = E.craftGalaxyItem(s, 'weapon', 'star', ['attack']);
    assert.ok(item && typeof item === 'object', `craft failed: ${item}`);
    assert.strictEqual(s.forge.crafts, 1);
    assert.strictEqual(s.forge.superCrafted, false);
    const superItem = E.craftGalaxyItem(s, 'armor', 'super', ['attack', 'defense']);
    assert.ok(superItem && typeof superItem === 'object', `super craft failed: ${superItem}`);
    assert.strictEqual(s.forge.crafts, 2);
    assert.strictEqual(s.forge.superCrafted, true);
  });

  console.log('== persistence ==');
  check('pickaxe + ores + counters survive ensureState round-trip', () => {
    const s = makeState();
    s.mine.pickaxe = 5;
    s.mine.totalTaps = 42;
    s.mine.totalMined = 120;
    s.mine.maxDepth = 12;
    const back = E.ensureState(JSON.parse(JSON.stringify(s)));
    assert.strictEqual(back.mine.pickaxe, 5);
    assert.strictEqual(back.mine.totalTaps, 42);
    assert.strictEqual(back.mine.totalMined, 120);
    assert.strictEqual(back.mine.maxDepth, 12);
    assert.strictEqual(back.mine.ores.adamant, 100);
  });

  console.log('== rebirth ==');
  check('rebirth keeps pickaxe, ores, and counters; resets level/xp', () => {
    const s = makeState();
    s.level = E.MAX_LEVEL;
    s.mine.pickaxe = 6;
    s.mine.totalTaps = 500;
    s.mine.ores.galaxy = 77;
    const out = E.rebirth(s);
    assert.ok(out, 'rebirth should succeed at max level');
    assert.strictEqual(out.level, 1);
    assert.strictEqual(out.xp, 0);
    assert.strictEqual(out.mine.pickaxe, 6);
    assert.strictEqual(out.mine.ores.galaxy, 77);
    assert.strictEqual(out.mine.totalTaps, 500);
  });

  console.log('== server validation ==');
  check('sanitizeStateBlob clamps pickaxe 99 -> 10 and -1 -> 0, defaults missing -> 0', () => {
    const b1 = { level: 10, mine: { depth: 5, ores: { copper: 3 }, pickaxe: 99 } };
    const r1 = V.sanitizeStateBlob(b1);
    assert.strictEqual(r1.state.mine.pickaxe, 10);
    const b2 = { level: 10, mine: { depth: 5, ores: {}, pickaxe: -1 } };
    assert.strictEqual(V.sanitizeStateBlob(b2).state.mine.pickaxe, 0);
    const b3 = { level: 10, mine: { depth: 5, ores: {} } };
    assert.strictEqual(V.sanitizeStateBlob(b3).state.mine.pickaxe, 0);
    const b4 = { level: 10, mine: { depth: 5, ores: {}, pickaxe: 3.9 } };
    assert.strictEqual(V.sanitizeStateBlob(b4).state.mine.pickaxe, 3);
  });
  check('validation sanitizes mining counters and forge counters', () => {
    const b = {
      level: 10,
      mine: { depth: 5, ores: {}, totalTaps: -2, totalMined: NaN, maxDepth: 4.5 },
      forge: { crafts: -1, superCrafted: 1 },
    };
    const r = V.sanitizeStateBlob(b);
    assert.strictEqual(r.state.mine.totalTaps, 0);
    assert.strictEqual(r.state.mine.totalMined, 0);
    assert.strictEqual(r.state.mine.maxDepth, 4);
    assert.strictEqual(r.state.forge.crafts, 0);
    assert.strictEqual(r.state.forge.superCrafted, false);
  });

  console.log('== GM grant pickaxe (server path) ==');
  check('gmApi registers a /gm/grant handler accepting kind=pickaxe (route-level smoke)', async () => {
    // gmApi only exports the router; verify the handler exists by mounting
    // it is out of scope here — instead verify the module loads and the
    // grant route is defined for the pickaxe kind via source check.
    const fs = require('fs');
    const src = fs.readFileSync(__dirname + '/../src/gmApi.js', 'utf8');
    assert.ok(src.includes("kind === 'pickaxe'"), 'gmApi missing pickaxe kind branch');
    assert.ok(src.includes('Tier must be an integer between 0 and 7.'), 'gmApi missing tier validation');
    assert.ok(src.includes('blob.mine.pickaxe'), 'gmApi does not set mine.pickaxe');
    // Simulate the exact server-side mutation sequence for tier 5.
    const blob = { mine: { depth: 5, ores: { copper: 1 } } };
    const tier = 5;
    if (!blob.mine || typeof blob.mine !== 'object') blob.mine = { depth: 1, ores: {} };
    blob.mine.pickaxe = Math.max(0, Math.min(7, tier));
    const back = V.sanitizeStateBlob(blob);
    assert.strictEqual(back.state.mine.pickaxe, 5);
  });

  console.log(failures === 0 ? '\nALL PICKAXE TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
