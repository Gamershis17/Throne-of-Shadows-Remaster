'use strict';
/**
 * Rebirth batch tests (no server, no DOM).
 * Covers: stage-gated rarities, rebirth token awards, streak drop bonus,
 * radiant enemies (3% rate, guaranteed gear, bonus gold, never bosses),
 * token shop rotation/stock/purchase permanence, pet breeding/combining,
 * token-egg hatch pool, and name-fx unlock backfill.
 *
 * Run: node test/rebirth-batch.js
 */
const assert = require('assert');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
}
function makeState(E) {
  const s = E.defaultState('human');
  s.gold = 1e12; s.level = 120;
  return s;
}

(async () => {
  const E = await import('../public/js/engine.js');

  console.log('== stage-gated rarities ==');
  check('maxRarityIdxForStage gates new tiers by stage', () => {
    const id = (st) => E.RARITIES[E.maxRarityIdxForStage(st)].id;
    assert.strictEqual(id(1), 'mythic');
    assert.strictEqual(id(39), 'mythic');
    assert.strictEqual(id(40), 'divine');
    assert.strictEqual(id(59), 'divine');
    assert.strictEqual(id(60), 'cosmic');
    assert.strictEqual(id(79), 'cosmic');
    assert.strictEqual(id(80), 'enduring');
    assert.strictEqual(id(99), 'enduring');
    assert.strictEqual(id(100), 'infinite');
    assert.strictEqual(id(500), 'infinite');
  });
  check('rollLoot respects stage gates (no infinite before stage 100)', () => {
    for (let i = 0; i < 3000; i++) {
      const l = E.rollLoot(1, false);
      if (l) assert.ok(E.RARITY_IDX[l.rarity] <= E.RARITY_IDX.mythic, `stage 1 dropped ${l.rarity}`);
      const l40 = E.rollLoot(40, false);
      if (l40) assert.ok(E.RARITY_IDX[l40.rarity] <= E.RARITY_IDX.divine, `stage 40 dropped ${l40.rarity}`);
    }
  });
  check('bosses can drop new rarities at stage 100+', () => {
    const seen = new Set();
    for (let i = 0; i < 20000; i++) {
      const l = E.rollLoot(100, true);
      if (l) seen.add(l.rarity);
    }
    for (const r of ['divine', 'cosmic', 'enduring', 'infinite']) {
      assert.ok(seen.has(r), `never saw ${r} in 20k boss rolls`);
    }
  });

  console.log('== rebirth tokens ==');
  check('rebirth awards exactly 1 token and keeps them', () => {
    const s = makeState(E);
    E.rebirth(s);
    assert.strictEqual(s.rebirthTokens, 1);
    assert.strictEqual(s.level, 1);
    s.level = 120;
    E.rebirth(s);
    assert.strictEqual(s.rebirthTokens, 2);
  });
  check('normalizeState clamps rebirthTokens', () => {
    const s = makeState(E);
    s.rebirthTokens = -5;
    const n = E.ensureState(s);
    assert.strictEqual(n.rebirthTokens, 0);
  });

  console.log('== kill streaks + radiant enemies ==');
  check('streakDropBonus scales +1/25, capped +10', () => {
    assert.strictEqual(E.streakDropBonus(0), 0);
    assert.strictEqual(E.streakDropBonus(24), 0);
    assert.strictEqual(E.streakDropBonus(25), 1);
    assert.strictEqual(E.streakDropBonus(250), 10);
    assert.strictEqual(E.streakDropBonus(10000), 10);
  });
  check('radiant enemies spawn ~3% on non-boss stages, never on bosses', () => {
    let rad = 0, bossRad = 0;
    for (let i = 0; i < 20000; i++) {
      const e = E.enemyFor(11);
      if (e.radiant) rad++;
      if (e.boss) { /* stage 11 has no bosses */ }
    }
    const rate = rad / 20000;
    assert.ok(rate > 0.02 && rate < 0.045, `radiant rate ${rate} out of range`);
    for (let i = 0; i < 2000; i++) {
      const b = E.enemyFor(10); // boss stage
      if (b.boss) assert.ok(!b.radiant, 'boss was radiant');
      if (b.radiant) bossRad++;
    }
    assert.strictEqual(bossRad, 0);
  });

  console.log('== token shop ==');
  check('stock has 6 items: 2 staples + 4 rotating', () => {
    const st = E.tokenShopStock(Date.now());
    assert.strictEqual(st.items.length, 6);
    assert.strictEqual(st.items.filter(i => i.staple).length, 2);
    assert.strictEqual(st.windowEnd - st.windowStart, E.TOKEN_SHOP_ROTATION_MS);
  });
  check('rotation changes daily but is deterministic within a window', () => {
    const a = E.tokenShopStock(Date.now());
    const b = E.tokenShopStock(Date.now() + 60000);
    assert.deepStrictEqual(a.items.map(i => i.id), b.items.map(i => i.id));
    const c = E.tokenShopStock(a.windowEnd + 1);
    assert.notDeepStrictEqual(a.items.map(i => i.id), c.items.map(i => i.id));
  });
  check('buying spends tokens and unlocks permanently', () => {
    const s = makeState(E);
    s.rebirthTokens = 10;
    const st = E.tokenShopStock(Date.now());
    const titleItem = st.items.find(i => i.kind === 'title');
    const r1 = E.buyTokenItem(s, titleItem.id);
    assert.ok(r1.ok, JSON.stringify(r1));
    assert.strictEqual(s.rebirthTokens, 10 - titleItem.cost);
    assert.ok(s.titlesUnlocked.includes(titleItem.ref));
    const r2 = E.buyTokenItem(s, titleItem.id);
    assert.ok(!r2.ok && r2.reason === 'owned');
    // fx purchase unlocks + backfill keeps base effects
    const fxItem = st.items.find(i => i.kind === 'fx');
    const r3 = E.buyTokenItem(s, fxItem.id);
    assert.ok(r3.ok);
    assert.ok(E.fxIsUnlocked(s, fxItem.ref));
    assert.ok(E.fxIsUnlocked(s, 'fire'));
  });
  check('cannot buy items outside the current window or without tokens', () => {
    const s = makeState(E);
    s.rebirthTokens = 0;
    const st = E.tokenShopStock(Date.now());
    const r = E.buyTokenItem(s, st.items[0].id);
    assert.ok(!r.ok && r.reason === 'tokens');
    const old = E.tokenShopStock(st.windowStart - 1);
    const oldItem = old.items.find(i => !st.items.some(x => x.id === i.id));
    if (oldItem) {
      const r2 = E.buyTokenItem(s, oldItem.id);
      assert.ok(!r2.ok && (r2.reason === 'not-in-stock' || r2.reason === 'bad-item'));
    }
  });

  console.log('== pet breeding / combining ==');
  function petState(E) {
    const s = makeState(E);
    const p = E.ensurePets(s);
    const mk = (species, level) => {
      const pet = { uid: 'u' + Math.random().toString(36).slice(2), species, level, xp: 0, xpNext: 1, hunger: 100 };
      p.collection.push(pet);
      return pet;
    };
    return { s, p, mk };
  }
  check('breeding keeps parents, adds a level-1 child, charges gold', () => {
    const { s, p, mk } = petState(E);
    const a = mk('cinderpup', 10), b = mk('ashmouse', 20);
    const before = s.gold;
    const r = E.breedPets(s, a.uid, b.uid);
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(p.collection.length, 3);
    assert.strictEqual(r.pet.level, 1);
    assert.strictEqual(s.gold, before - 5000 * 30);
    const sp = E.PET_SPECIES[r.pet.species];
    const pa = E.PET_SPECIES.a, pb = 'ashmouse';
    void pa; void pb;
    assert.ok(['cinderpup', 'ashmouse'].includes(r.pet.species) || E.PET_RARITY_INDEX[sp.rarity] >= E.PET_RARITY_INDEX[E.PET_SPECIES['cinderpup'].rarity],
      `unexpected child species ${r.pet.species}`);
  });
  check('breeding rejects same pet / missing / insufficient gold', () => {
    const { s, p, mk } = petState(E);
    const a = mk('cinderpup', 10);
    assert.ok(!E.breedPets(s, a.uid, a.uid).ok);
    assert.ok(!E.breedPets(s, a.uid, 'nope').ok);
    s.gold = 0;
    const b = mk('ashmouse', 1);
    const r = E.breedPets(s, a.uid, b.uid);
    assert.ok(!r.ok && r.reason === 'gold');
  });
  check('combining 3 same-rarity pets -> next rarity, keeps highest level', () => {
    const { s, p, mk } = petState(E);
    const a = mk('cinderpup', 5), b = mk('ashmouse', 12), c = mk('tiger', 8);
    const r = E.combinePets(s, [a.uid, b.uid, c.uid]);
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(p.collection.length, 1);
    assert.strictEqual(E.PET_SPECIES[r.pet.species].rarity, 'magic');
    assert.strictEqual(r.pet.level, 12);
  });
  check('combining rejects mixed rarities and celestial (max)', () => {
    const { s, p, mk } = petState(E);
    const a = mk('cinderpup', 1), b = mk('frostsprite', 1), c = mk('tiger', 1);
    assert.strictEqual(E.combinePets(s, [a.uid, b.uid, c.uid]).reason, 'same-rarity');
    const s2 = petState(E);
    const r2 = E.combinePets(s2.s, [s2.mk('starwisp', 1).uid, s2.mk('lunacub', 1).uid, s2.mk('astraldrake', 1).uid]);
    assert.strictEqual(r2.reason, 'max-rarity');
  });
  check('token egg hatches from the shadow+celestial pool', () => {
    const { s, p } = petState(E);
    p.shopEggs.token = 3;
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      p.shopEggs.token = 1;
      const pet = E.hatchPet(s, 'token');
      assert.ok(pet, 'token egg hatch returned null');
      seen.add(E.PET_SPECIES[pet.species].rarity);
    }
    assert.ok(seen.has('shadow') || seen.has('celestial'), `unexpected pool ${[...seen]}`);
  });

  console.log('== name fx unlocks ==');
  check('backfill grants all base effects, token effects stay locked', () => {
    const s = {};
    const ids = E.ensureFxUnlocked(s);
    assert.ok(E.BASE_NAME_FX_IDS.every(id => ids.includes(id)));
    for (const f of E.TOKEN_NAME_FX) {
      assert.ok(!E.fxIsUnlocked(s, f.id), `${f.id} should start locked`);
    }
  });

  console.log(failures === 0 ? '\nALL REBIRTH-BATCH TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
