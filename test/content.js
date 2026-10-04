'use strict';
/**
 * Content-batch unit tests (no server, no DOM).
 * Covers: new egg tiers + prices, new pet species, sell-pet system
 * (price scaling, gold cap, active-pet reassignment, unsellable guard),
 * worlds + stage thresholds + enemy rosters, and coming-soon teasers.
 *
 * Run: node test/content.js
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

function mkState(gold = 0) {
  return { gold, pets: null, playerClass: 'warrior', infGold: false };
}
function mkPet(E, species, level = 1) {
  const s = mkState();
  const p = E.ensurePets(s);
  const pet = { uid: 'u-' + species + '-' + level, species, level, xp: 0, xpNext: E.petXpForLevel(level), hunger: 100 };
  p.collection.push(pet);
  p.activeUid = pet.uid;
  return { s, pet };
}

async function main() {
  const E = await import('../public/js/engine.js');

  console.log('== new egg tiers ==');
  check('mythic egg costs 250,000', () => {
    assert.strictEqual(E.EGG_TIERS.mythic.price, 250000);
  });
  check('shadow egg costs 500,000', () => {
    assert.strictEqual(E.EGG_TIERS.shadow.price, 500000);
  });
  check('shop tier order starts with stray, ends with the new tiers', () => {
    assert.deepStrictEqual(E.SHOP_EGG_TIERS, ['stray', 'common', 'glowing', 'radiant', 'mythic', 'shadow', 'celestial', 'token']);
  });
  check('mythic pool hatches stormdrake or prismhorn', () => {
    assert.deepStrictEqual([...E.EGG_TIERS.mythic.pool].sort(), ['prismhorn', 'stormdrake']);
  });
  check('shadow pool hatches the shadow line', () => {
    assert.deepStrictEqual([...E.EGG_TIERS.shadow.pool].sort(), ['gloomstalker', 'shadowwisp', 'voidreaver']);
  });
  check('buyEgg works for new tiers and rejects bad tier', () => {
    const s = mkState(1000000);
    E.ensurePets(s);
    assert.ok(E.buyEgg(s, 'mythic').ok);
    assert.ok(E.buyEgg(s, 'shadow').ok);
    assert.strictEqual(s.gold, 1000000 - 250000 - 500000);
    assert.strictEqual(s.pets.shopEggs.mythic, 1);
    assert.strictEqual(s.pets.shopEggs.shadow, 1);
    assert.ok(!E.buyEgg(s, 'nope').ok);
    const poor = mkState(10);
    E.ensurePets(poor);
    assert.strictEqual(E.buyEgg(poor, 'mythic').reason, 'gold');
  });
  check('hatchPet consumes new-tier eggs and yields pool species', () => {
    const s = mkState();
    const p = E.ensurePets(s);
    p.shopEggs.mythic = 3; p.shopEggs.shadow = 3;
    const m = E.hatchPet(s, 'mythic');
    assert.ok(['stormdrake', 'prismhorn'].includes(m.species));
    const sh = E.hatchPet(s, 'shadow');
    assert.ok(['shadowwisp', 'gloomstalker', 'voidreaver'].includes(sh.species));
    assert.strictEqual(p.shopEggs.mythic, 2);
    assert.strictEqual(p.shopEggs.shadow, 2);
  });
  check('old saves normalize the new shop-egg keys', () => {
    const s = { gold: 0, pets: { collection: [], activeUid: null, eggs: 0, shopEggs: { common: 1 } } };
    const p = E.ensurePets(s);
    assert.strictEqual(p.shopEggs.mythic, 0);
    assert.strictEqual(p.shopEggs.shadow, 0);
    assert.strictEqual(p.shopEggs.common, 1);
  });

  console.log('== new species power ==');
  check('mythic/shadow species outgun the legendary tide turtle', () => {
    const t = E.PET_SPECIES.tideturtle;
    for (const id of ['stormdrake', 'prismhorn', 'shadowwisp', 'gloomstalker', 'voidreaver']) {
      const sp = E.PET_SPECIES[id];
      assert.ok(sp.baseDmg > t.baseDmg, `${id} baseDmg ${sp.baseDmg} <= ${t.baseDmg}`);
      assert.ok(sp.growth >= t.growth, `${id} growth ${sp.growth} < ${t.growth}`);
    }
  });
  check('new species have rarity ids mythic/shadow', () => {
    assert.strictEqual(E.PET_SPECIES.stormdrake.rarity, 'mythic');
    assert.strictEqual(E.PET_SPECIES.voidreaver.rarity, 'shadow');
  });

  console.log('== sell pets ==');
  check('sell price scales with rarity and level', () => {
    const { s, pet } = mkPet(E, 'cinderpup', 1);
    assert.strictEqual(E.petSellPrice(pet), 800);
    const hi = mkPet(E, 'voidreaver', 10);
    const expect = Math.round(120000 * (1 + 0.15 * 9));
    assert.strictEqual(E.petSellPrice(hi.pet), expect);
    assert.ok(E.petSellPrice(hi.pet) > E.petSellPrice(pet));
  });
  check('sellPet pays gold and removes the pet', () => {
    const { s, pet } = mkPet(E, 'emberfox', 5);
    const before = s.gold;
    const price = E.petSellPrice(pet);
    const res = E.sellPet(s, pet.uid);
    assert.ok(res.ok);
    assert.strictEqual(res.gold, Math.min(price, 9e15 - before));
    assert.strictEqual(s.gold, before + res.gold);
    assert.strictEqual(s.pets.collection.length, 0);
  });
  check('selling the active pet reassigns to the next pet', () => {
    const s = mkState();
    const p = E.ensurePets(s);
    const a = { uid: 'a', species: 'cinderpup', level: 1, xp: 0, xpNext: 40, hunger: 100 };
    const b = { uid: 'b', species: 'stormdrake', level: 1, xp: 0, xpNext: 40, hunger: 100 };
    p.collection.push(a, b);
    p.activeUid = 'a';
    E.sellPet(s, 'a');
    assert.strictEqual(p.activeUid, 'b');
    assert.strictEqual(p.collection.length, 1);
  });
  check('selling the last pet clears the active slot', () => {
    const { s, pet } = mkPet(E, 'cinderpup', 1);
    E.sellPet(s, pet.uid);
    assert.strictEqual(s.pets.activeUid, null);
  });
  check('unsellable species cannot be sold', () => {
    // Simulate a GM-only/special species via the unsellable flag.
    E.PET_SPECIES.__testRelic = { name: 'Test Relic', rarity: 'mythic', unsellable: true, baseDmg: 1, growth: 1.15 };
    try {
      const s = mkState();
      const p = E.ensurePets(s);
      const pet = { uid: 'x', species: '__testRelic', level: 9, xp: 0, xpNext: 40, hunger: 100 };
      p.collection.push(pet);
      p.activeUid = 'x';
      assert.strictEqual(E.canSellPet(pet), false);
      assert.strictEqual(E.petSellPrice(pet), 0);
      const res = E.sellPet(s, 'x');
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.reason, 'unsellable');
      assert.strictEqual(p.collection.length, 1, 'unsellable pet stays');
    } finally {
      delete E.PET_SPECIES.__testRelic;
    }
  });
  check('sellPet respects the gold cap', () => {
    E.setGoldCap(1e12);
    try {
      const { s, pet } = mkPet(E, 'voidreaver', 50);
      s.gold = 1e12 - 100;
      const price = E.petSellPrice(pet);
      assert.ok(price > 100, `price ${price} should exceed remaining room`);
      const res = E.sellPet(s, pet.uid);
      assert.ok(res.ok);
      assert.strictEqual(res.capped, true);
      assert.strictEqual(s.gold, 1e12);
    } finally {
      E.setGoldCap(9e15);
    }
  });
  check('sellPet on unknown uid fails cleanly', () => {
    const s = mkState();
    E.ensurePets(s);
    const res = E.sellPet(s, 'nope');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'not-found');
  });

  console.log('== worlds ==');
  check('world thresholds', () => {
    assert.strictEqual(E.worldForStage(1).id, 'gloomwood');
    assert.strictEqual(E.worldForStage(99).id, 'gloomwood');
    assert.strictEqual(E.worldForStage(100).id, 'ember-wastes');
    assert.strictEqual(E.worldForStage(249).id, 'ember-wastes');
    assert.strictEqual(E.worldForStage(250).id, 'void-abyss');
    assert.strictEqual(E.worldForStage(499).id, 'void-abyss');
    assert.strictEqual(E.worldForStage(500).id, 'throne-of-shadows');
    assert.strictEqual(E.worldForStage(5000).id, 'throne-of-shadows');
  });
  check('each world has enemies, bosses, and a bg scene', () => {
    assert.strictEqual(E.WORLDS.length, 4);
    for (const w of E.WORLDS) {
      assert.ok(w.enemies.length >= 6, `${w.id} enemies`);
      assert.ok(w.bosses.length >= 2, `${w.id} bosses`);
      assert.ok(w.bgScene, `${w.id} bgScene`);
      assert.ok(w.tagline, `${w.id} tagline`);
    }
  });
  check('enemyFor draws from the stage world roster and stamps world id', () => {
    for (let i = 0; i < 30; i++) {
      const e = E.enemyFor(301); // non-boss stage in the void
      assert.strictEqual(e.world, 'void-abyss');
      assert.ok(!e.boss);
      assert.ok(E.WORLDS[2].enemies.some(x => x.name === e.name), `unexpected ${e.name}`);
    }
    for (let i = 0; i < 30; i++) {
      const e = E.enemyFor(601); // non-boss stage at the throne
      assert.strictEqual(e.world, 'throne-of-shadows');
    }
    const b = E.enemyFor(500); // boss stage in throne world
    assert.ok(b.boss);
    assert.ok(E.WORLDS[3].bosses.some(x => x.name === b.name));
    const b2 = E.enemyFor(300); // boss stage in the void
    assert.ok(b2.boss);
    assert.ok(E.WORLDS[2].bosses.some(x => x.name === b2.name));
  });
  check('world stat scaling unchanged (balance-neutral)', () => {
    // Same stage => same HP/ATK formula regardless of world roster.
    // v19: growth constant is 1.115 (was 1.125) — the TTK tune is the only
    // intended change; worlds stay cosmetic.
    const e1 = E.enemyFor(251); // non-boss
    const expectedHp = Math.round(18 * Math.pow(1.115, 251) * 0.6);
    assert.strictEqual(e1.hp, expectedHp);
  });

  console.log('== teasers ==');
  check('shadow demons teased, locked, unobtainable', () => {
    assert.strictEqual(E.PET_TEASERS.length, 1);
    const ids = E.PET_TEASERS.map(t => t.id);
    assert.ok(ids.includes('shadow-demons'));
    for (const t of E.PET_TEASERS) {
      assert.ok(!E.PET_SPECIES[t.id], `${t.id} must not be a hatchable species`);
      for (const tier of Object.values(E.EGG_TIERS)) {
        assert.ok(!(tier.pool || []).includes(t.id), `${t.id} must not be in any egg pool`);
      }
    }
  });

  console.log(failures === 0 ? '\nPASS: all content checks' : `\nFAIL: ${failures} checks failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
