'use strict';
/**
 * Nerf-batch unit tests (no server, no DOM).
 * Covers Stream 1: v19 four-segment XP curve (kinks at 30, 60 and 90),
 * rebirth scaling, kill-XP formula, +40% xpBonus clamp in gainXp
 * (lowered from 50% for the party bonus), server-side xpNext anti-spoof,
 * the level cap 120, and the fresh v18/v19 balance log JSON.
 *
 * Run: node test/nerf.js
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

async function main() {
  const E = await import('../public/js/engine.js');
  const V = require('../src/validation.js');

  console.log('== xp curve (v19: kinks at 30, 60 and 90) ==');
  const oldCurve = (l) => l <= 60
    ? 80 * Math.pow(1.30, l - 1)
    : 80 * Math.pow(1.30, 59) * Math.pow(1.42, l - 60);
  check('xpForLevel(1) = 80', () => {
    assert.strictEqual(E.xpForLevel(1, 0), 80);
  });
  check('curve unchanged 1-30: L30 matches old 1.30 formula', () => {
    assert.strictEqual(E.xpForLevel(30, 0), Math.round(80 * Math.pow(1.30, 29)));
  });
  check('first kink continuous at 30; growth shifts 1.30 -> 1.35', () => {
    const r30 = E.xpForLevel(30, 0), r31 = E.xpForLevel(31, 0);
    assert.strictEqual(r30, Math.round(oldCurve(30)));
    const g = r31 / r30;
    assert.ok(g > 1.34 && g < 1.36, `30->31 growth ${g}`);
  });
  check('second kink continuous at 60; growth shifts 1.35 -> 1.44', () => {
    const r60 = E.xpForLevel(60, 0), r61 = E.xpForLevel(61, 0);
    const g = r61 / r60;
    assert.ok(g > 1.43 && g < 1.45, `60->61 growth ${g}`);
  });
  check('third kink continuous at 90; growth shifts 1.44 -> 1.47', () => {
    const r90 = E.xpForLevel(90, 0), r91 = E.xpForLevel(91, 0);
    const g = r91 / r90;
    assert.ok(g > 1.46 && g < 1.48, `90->91 growth ${g}`);
    // continuity: 91 must equal V90 * 1.47^1
    const V90 = 80 * Math.pow(1.30, 29) * Math.pow(1.35, 30) * Math.pow(1.44, 30);
    assert.ok(Math.abs(r91 - Math.round(V90 * 1.47)) / r91 < 1e-9, `L91 ${r91}`);
  });
  check('level 120 costs ~104,600x the level-90 cost (1.47^30)', () => {
    const r = E.xpForLevel(120, 0) / E.xpForLevel(90, 0);
    assert.ok(r > 100000 && r < 110000, `L120/L90 ${r}`);
  });
  check('v18 nerf ratios vs old curve (within 1%)', () => {
    const expected = { 40: 1.46, 50: 2.13, 55: 2.57, 60: 3.10, 70: 3.57, 90: 4.72 };
    for (const [L, want] of Object.entries(expected)) {
      const got = E.xpForLevel(Number(L), 0) / oldCurve(Number(L));
      assert.ok(Math.abs(got - want) / want < 0.01, `L${L} ratio ${got} vs ${want}`);
    }
  });
  check('level 70 ~3.5x steeper than the old curve', () => {
    const old70 = Math.round(oldCurve(70));
    const r = E.xpForLevel(70, 0) / old70;
    assert.ok(r > 3.4 && r < 3.7, `L70 ratio ${r}`);
  });
  check('total XP 1->90 nerfed to ~167.8T (old ~37.25T)', () => {
    let total = 0;
    for (let L = 1; L <= 89; L++) total += E.xpForLevel(L, 0);
    assert.ok(total > 167e12 && total < 168.5e12, `total ${total}`);
  });

  console.log('== rebirth scaling ==');
  check('rebirthXpMult: 0->1, 1->1.35, 2->1.8225', () => {
    assert.strictEqual(E.rebirthXpMult(0), 1);
    assert.ok(Math.abs(E.rebirthXpMult(1) - 1.35) < 1e-9);
    assert.ok(Math.abs(E.rebirthXpMult(2) - 1.8225) < 1e-9);
  });
  check('xpForLevel scales with rebirthCount', () => {
    const base = E.xpForLevel(10, 0);
    // allow ±1 for double-rounding: round(round(base)*mult) vs round(base*mult)
    assert.ok(Math.abs(E.xpForLevel(10, 2) - base * 1.8225) < 1.5,
      `got ${E.xpForLevel(10, 2)} vs base ${base}`);
  });
  check('rebirth() bumps count and scales xpNext', () => {
    const s = E.ensureState({ race: 'orc', level: 120, rebirthCount: 0 });
    s.xpNext = E.xpForLevel(120, 0);
    const out = E.rebirth(s);
    assert.ok(out, 'rebirth should succeed at 120');
    assert.strictEqual(s.rebirthCount, 1);
    assert.strictEqual(s.level, 1);
    assert.strictEqual(s.xpNext, E.xpForLevel(1, 1));
  });
  check('ensureState recomputes xpNext with rebirth scaling', () => {
    const s = E.ensureState({ race: 'orc', level: 70, rebirthCount: 2, xpNext: 1 });
    assert.strictEqual(s.xpNext, E.xpForLevel(70, 2));
  });

  console.log('== kill xp nerf ==');
  check('xpForKill uses 10 x 1.12^stage (party branch)', () => {
    assert.strictEqual(E.xpForKill(1), Math.round(10 * 1.12));
  });
  check('xpForKill(148) nerfed below 1B (was ~9.6B)', () => {
    assert.ok(E.xpForKill(148) < 1e9, `got ${E.xpForKill(148)}`);
  });

  console.log('== xpBonus clamp in gainXp ==');
  check('computeStats still reports the true (unclamped) xpBonus', () => {
    const s = E.ensureState({ race: 'orc', level: 60, xp: 0 });
    s.mine = { ores: { galaxy: 10, supergalaxy: 5 } };
    const item = E.craftGalaxyItem(s, 'weapon', 'super', ['xpBonus']);
    assert.ok(item && typeof item === 'object', `craft failed: ${item}`);
    assert.ok(E.equipGalaxy(s, 'weapon'), 'equip failed');
    const stats = E.computeStats(s);
    assert.strictEqual(stats.xpBonus, 600, `tooltip xpBonus ${stats.xpBonus}`);
  });
  check('gainXp caps gear xpBonus at +40% (600% item -> 1.4x, not 7x)', () => {
    const mk = () => E.ensureState({ race: 'orc', level: 60, xp: 0 });
    const plain = mk();
    E.gainXp(plain, 10000);
    assert.strictEqual(plain.xp, 10000, `plain ${plain.xp}`);
    const geared = mk();
    geared.mine = { ores: { galaxy: 10, supergalaxy: 5 } };
    E.craftGalaxyItem(geared, 'weapon', 'super', ['xpBonus']);
    E.equipGalaxy(geared, 'weapon');
    E.gainXp(geared, 10000);
    assert.strictEqual(geared.xp, 14000, `geared ${geared.xp}`);
  });
  check('gainXp applies party XP bonus multiplicatively', () => {
    const s = E.ensureState({ race: 'orc', level: 60, xp: 0 });
    E.gainXp(s, 10000, Date.now(), 24); // full human party: +24%
    assert.strictEqual(s.xp, 12400, `party xp ${s.xp}`);
    const npc = E.ensureState({ race: 'orc', level: 60, xp: 0 });
    E.gainXp(npc, 10000, Date.now(), 36); // + max NPC allies: +36%
    assert.strictEqual(npc.xp, 13600, `max party xp ${npc.xp}`);
    const evil = E.ensureState({ race: 'orc', level: 60, xp: 0 });
    E.gainXp(evil, 10000, Date.now(), 9999); // tampered value clamps at +40%
    assert.strictEqual(evil.xp, 14000, `clamped party xp ${evil.xp}`);
  });

  console.log('== level cap 120 ==');
  check('MAX_LEVEL is 120', () => {
    assert.strictEqual(E.MAX_LEVEL, 120, `MAX_LEVEL ${E.MAX_LEVEL}`);
  });
  check('xpForLevel uses the 1.44 exponent through 61-90 and 1.47 through 91-120', () => {
    // continuous at 60->61 and smooth growth after
    const r60 = E.xpForLevel(60, 0), r61 = E.xpForLevel(61, 0);
    assert.ok(r61 > r60 && r61 < r60 * 1.5, `60->61 ${r60} -> ${r61}`);
    const ratio = E.xpForLevel(90, 0) / E.xpForLevel(89, 0);
    assert.ok(ratio > 1.43 && ratio < 1.45, `89->90 ratio ${ratio}`);
    const r120 = E.xpForLevel(120, 0), r119 = E.xpForLevel(119, 0);
    const g = r120 / r119;
    assert.ok(g > 1.46 && g < 1.48, `119->120 growth ${g}`);
  });
  check('total XP 1->90 is ~167.84T (old pre-v18 ~37.25T)', () => {
    let total = 0;
    for (let L = 1; L <= 89; L++) total += E.xpForLevel(L, 0);
    assert.ok(total > 167e12 && total < 168.5e12, `total ${total}`);
  });
  check('enemy HP growth is 1.115 per stage (v19 TTK sanity)', () => {
    // compare same foe types: 101/102 are normal, 100/110 are bosses
    const g = E.enemyFor(102).hp / E.enemyFor(101).hp;
    assert.ok(g > 1.11 && g < 1.12, `101->102 hp growth ${g}`);
    const gb = E.enemyFor(110).hp / E.enemyFor(100).hp;
    assert.ok(gb > Math.pow(1.11, 10) && gb < Math.pow(1.12, 10), `100->110 boss hp ${gb}`);
    // boss x2.5 vs normal x0.6 at adjacent stages: (2.5/0.6)/1.115 ~= 3.74
    const ratio = E.enemyFor(110).hp / E.enemyFor(111).hp;
    assert.ok(ratio > 3.5 && ratio < 4.0, `boss/normal ${ratio}`);
  });
  check('total XP 1->120 is a proper endgame grind (far above 1->90)', () => {
    let t90 = 0, t120 = 0;
    for (let L = 1; L <= 89; L++) t90 += E.xpForLevel(L, 0);
    for (let L = 1; L <= 119; L++) t120 += E.xpForLevel(L, 0);
    const ratio = t120 / t90;
    assert.ok(ratio > 50000, `1->120 should dwarf 1->90, ratio ${ratio}`);
  });
  check('rebirth available at 120 and resets to 1', () => {
    const s = E.ensureState({ race: 'orc', level: 120, xp: 0 });
    assert.ok(E.rebirth(s) !== null || s.level === 1, 'rebirth failed at 120');
    assert.strictEqual(s.level, 1, `level after rebirth ${s.level}`);
    assert.strictEqual(s.rebirthCount, 1, `rebirthCount ${s.rebirthCount}`);
    const lo = E.ensureState({ race: 'orc', level: 119, xp: 0 });
    assert.strictEqual(E.rebirth(lo), null, 'rebirth offered below cap');
    assert.strictEqual(lo.level, 119, 'level changed below cap');
  });

  console.log('== npc buffs (v15) ==');
  check('companionRole assigns tank/healer/dps', () => {
    assert.strictEqual(E.companionRole({ recruitId: 'mira' }), 'tank');
    assert.strictEqual(E.companionRole({ recruitId: 'ember' }), 'tank');
    assert.strictEqual(E.companionRole({ recruitId: 'anselm' }), 'healer');
    assert.strictEqual(E.companionRole({ recruitId: 'lyra' }), 'dps');
    assert.strictEqual(E.companionRole({ recruitId: 'nyx' }), 'dps');
    assert.strictEqual(E.companionRole({ recruitId: 'gromm' }), 'dps');
  });
  check('NPC max HP scales exponentially and beats the old flat curve', () => {
    const lyra = E.RECRUIT_BY_ID.lyra;
    const now60 = E.companionMaxHp(lyra, 60);
    assert.ok(now60 > (lyra.hp + 20 * 59) * 3, `lyra L60 hp ${now60}`);
    const mira = E.RECRUIT_BY_ID.mira;
    const nowM60 = E.companionMaxHp(mira, 60);
    assert.ok(nowM60 > (mira.hp + 20 * 59) * 8, `mira L60 hp ${nowM60}`);
    // growth is level-exponential, not flat
    assert.ok(E.companionMaxHp(lyra, 60) > E.companionMaxHp(lyra, 30) * 3, 'not exponential');
  });
  check('tank takes far less damage than dps (damageTakenMult)', () => {
    const tank = E.makeCompanion(E.RECRUIT_BY_ID.mira, 60);
    const dps = E.makeCompanion(E.RECRUIT_BY_ID.lyra, 60);
    const t = E.companionStats(tank), d = E.companionStats(dps);
    assert.strictEqual(t.damageTakenMult, 0.35);
    assert.strictEqual(d.damageTakenMult, 0.60);
    assert.ok(t.damageTakenMult < d.damageTakenMult, 'tank should be tougher');
  });
  check('tank and dps strike damage increased vs the old formula', () => {
    const dps = E.makeCompanion(E.RECRUIT_BY_ID.lyra, 60);
    const d = E.companionStats(dps);
    assert.strictEqual(d.damageMult, 2.0);
    assert.ok(dps.attack * d.damageMult > (10 + 3 * 59) * 2, `dps ${dps.attack * d.damageMult}`);
    const tank = E.makeCompanion(E.RECRUIT_BY_ID.mira, 60);
    const t = E.companionStats(tank);
    assert.strictEqual(t.damageMult, 1.5);
    assert.ok(tank.attack * t.damageMult > (34 + 3 * 59) * 1.5, `tank ${tank.attack * t.damageMult}`);
  });
  check('healer mend restores PLAYER hp (not just its own)', () => {
    const s = E.ensureState({ race: 'orc', level: 60 });
    const maxHp = 20000; // simulated computeStats().maxHp
    const healer = E.makeCompanion(E.RECRUIT_BY_ID.anselm, 60);
    s.hero.hp = maxHp - Math.round(maxHp * 0.5);
    const healed = E.applyHealerMend(s, healer, maxHp);
    assert.strictEqual(healed, Math.round(maxHp * E.HEALER_MEND_PCT), `healed ${healed}`);
    assert.strictEqual(s.hero.hp, maxHp - Math.round(maxHp * 0.5) + healed);
    // a DPS companion never mends
    const dps = E.makeCompanion(E.RECRUIT_BY_ID.lyra, 60);
    s.hero.hp = maxHp - 1000;
    assert.strictEqual(E.applyHealerMend(s, dps, maxHp), 0, 'dps should not heal');
    assert.strictEqual(s.hero.hp, maxHp - 1000, 'dps heal changed hp');
    // no overheal past max
    s.hero.hp = maxHp;
    assert.strictEqual(E.applyHealerMend(s, healer, maxHp), 0, 'should not overheal');
    // mend never exceeds missing hp
    s.hero.hp = maxHp - 5;
    assert.strictEqual(E.applyHealerMend(s, healer, maxHp), 5, 'should clamp to missing');
    assert.strictEqual(s.hero.hp, maxHp);
  });
  check('levelUpCompanion matches a fresh recruit at the same level', () => {
    const s = E.ensureState({ race: 'orc', level: 60 });
    s.gold = 1e12;
    const r = E.RECRUIT_BY_ID.vex;
    const fresh = E.makeCompanion(r, 60);
    const c = E.makeCompanion(r, 59);
    s.party = [c];
    const res = E.levelUpCompanion(s, c.id);
    assert.ok(res.ok, 'level up failed');
    assert.strictEqual(c.level, 60);
    assert.strictEqual(c.attack, fresh.attack, `atk ${c.attack} vs ${fresh.attack}`);
    assert.strictEqual(c.defense, fresh.defense, `def ${c.defense} vs ${fresh.defense}`);
    assert.strictEqual(c.maxHp, fresh.maxHp, `hp ${c.maxHp} vs ${fresh.maxHp}`);
  });
  check('pre-v15 allies migrate to new stats on load', () => {
    const legacy = { id: 'leg1', name: 'Lyra Swiftbow', recruitId: 'lyra', role: 'Ranger',
      level: 60, attack: 187, defense: 60, maxHp: 1250, hp: 625 };
    const s = E.ensureState({ race: 'orc', level: 60, party: [legacy] });
    const c = s.party[0];
    assert.strictEqual(c.roleKind, 'dps');
    assert.ok(c.maxHp > 1250, `migrated hp ${c.maxHp}`);
    assert.strictEqual(c.hp, Math.round(c.maxHp / 2), 'hp fraction should be preserved');
  });
  console.log('== server anti-spoof (validation.js) ==');
  check('sanitizeStateBlob recomputes xpNext from level+rebirthCount', () => {
    const blob = {
      level: 70, rebirthCount: 3, xpNext: 5, xp: 0, stage: 1,
      bossesKilled: 0, gold: 0, stars: 0, inventory: [], codesRedeemed: [],
    };
    const res = V.sanitizeStateBlob(blob);
    assert.ok(res.ok, `not ok: ${res.error}`);
    assert.strictEqual(res.state.xpNext, E.xpForLevel(70, 3),
      `xpNext ${res.state.xpNext}`);
  });
  check('tampered rebirthCount is clamped before the recompute', () => {
    const blob = {
      level: 10, rebirthCount: 1e12, xpNext: 1, xp: 0, stage: 1,
      bossesKilled: 0, gold: 0, stars: 0, inventory: [], codesRedeemed: [],
    };
    const res = V.sanitizeStateBlob(blob);
    assert.ok(res.ok);
    assert.strictEqual(res.state.rebirthCount, 100000);
    assert.strictEqual(res.state.xpNext, E.xpForLevel(10, 100000));
  });

  console.log('== balance log json ==');
  check('balance-log.json parses and entries are newest-first with version/date/changes', () => {
    const fs = require('fs');
    const path = require('path');
    const raw = fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'balance-log.json'), 'utf8');
    const log = JSON.parse(raw);
    assert.ok(Array.isArray(log) && log.length > 0, 'must be a non-empty array');
    for (const e of log) {
      assert.ok(typeof e.version === 'string' && e.version.length > 0, 'entry needs version');
      assert.ok(typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date), `bad date ${e.date}`);
      assert.ok(Array.isArray(e.changes) && e.changes.length > 0, 'entry needs changes');
      for (const c of e.changes) {
        assert.ok(typeof c.system === 'string' && c.system.length > 0, 'change needs system');
        assert.ok(typeof c.before === 'string' && c.before.length > 0, 'change needs before');
        assert.ok(typeof c.after === 'string' && c.after.length > 0, 'change needs after');
      }
    }
    // newest first: dates non-increasing
    for (let i = 1; i < log.length; i++) {
      assert.ok(log[i - 1].date >= log[i].date, 'entries must be newest first');
    }
  });

  console.log(failures === 0 ? 'NERF TESTS PASSED' : `${failures} NERF TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
