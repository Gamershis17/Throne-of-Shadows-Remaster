'use strict';
/**
 * Player-feedback batch unit tests (no server, no DOM).
 * Covers:
 *  1. Boss name match — deterministic boss per stage (announced == spawned).
 *  2. Damage meter last-fight fallback (source-level: spawnEnemy stashes,
 *     meterSnapshot prefers last fight when the current one has no samples).
 *  3. Level-up queue (source-level: UI._levelUpOpen/_levelUpQueue + onClose).
 *  4. Quest live sync hooks (source-level: data-qcard attrs + sync timer).
 *  6. Guided onboarding quest chain (defs, requires gating, new metrics).
 *  7. Cheap starter pet (Stray Egg 500g -> Ash Mouse).
 *  8. Bigger boss name pool (8 bosses per world, unique names).
 * (5. Dying while browsing is covered by the pause feature + test/pause.js.)
 *
 * Run: node test/feedback.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

const repo = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(repo, f), 'utf8');

async function main() {
  const E = await import('../public/js/engine.js');
  const appSrc = src('public/js/app.js');
  const uiSrc = src('public/js/ui.js');

  console.log('== 1. boss name match (deterministic per stage) ==');
  check('same boss stage always spawns the same boss', () => {
    for (const stage of [10, 90, 100, 250, 500, 510, 1000]) {
      const a = E.enemyFor(stage);
      const b = E.enemyFor(stage);
      assert.strictEqual(a.boss, true);
      assert.strictEqual(a.name, b.name, `stage ${stage}: ${a.name} != ${b.name}`);
      assert.strictEqual(a.emoji, b.emoji);
    }
  });
  check('announced boss (one roll) == spawned boss (later roll)', () => {
    // Simulates: modal announces boss from spawn #1, death-respawn re-rolls.
    for (const stage of [30, 120, 260, 520]) {
      const announced = E.enemyFor(stage).name;
      const spawned = E.enemyFor(stage).name;
      assert.strictEqual(announced, spawned);
    }
  });
  check('normal enemies still vary (not deterministic)', () => {
    const names = new Set();
    for (let i = 0; i < 40; i++) names.add(E.enemyFor(7).name);
    assert.ok(names.size > 1, 'expected variety in normal enemies');
  });

  console.log('== 8. bigger boss name pool ==');
  check('every world has 8 bosses with unique names', () => {
    for (const w of E.WORLDS) {
      assert.ok(w.bosses.length >= 8, `${w.id} has ${w.bosses.length}`);
      const names = new Set(w.bosses.map((b) => b.name));
      assert.strictEqual(names.size, w.bosses.length, `${w.id} dup names`);
      for (const b of w.bosses) assert.ok(b.emoji, `${w.id}/${b.name} missing emoji`);
    }
  });
  check('original boss names preserved', () => {
    const all = E.WORLDS.flatMap((w) => w.bosses.map((b) => b.name));
    for (const n of ['The Hollow King', 'Dreadlord Malachar', 'Ancient Wyrm Vex',
      'The Shadow Sovereign', 'Voidlord Zerath', 'The Starless One',
      'Warlord Ghash', 'Broodmother Xix']) {
      assert.ok(all.includes(n), `missing ${n}`);
    }
  });

  console.log('== 7. cheap starter pet ==');
  check('stray egg is first shop tier at 500g', () => {
    assert.strictEqual(E.SHOP_EGG_TIERS[0], 'stray');
    assert.strictEqual(E.EGG_TIERS.stray.price, 500);
    assert.deepStrictEqual(E.EGG_TIERS.stray.pool, ['ashmouse']);
  });
  check('buy + hatch stray egg with 500 gold', () => {
    const s = { gold: 500, pets: null, playerClass: 'warrior', infGold: false };
    const bought = E.buyEgg(s, 'stray');
    assert.ok(bought.ok, JSON.stringify(bought));
    assert.strictEqual(s.gold, 0);
    const pet = E.hatchPet(s, 'stray');
    assert.ok(pet, 'hatch failed');
    assert.strictEqual(pet.species, 'ashmouse');
    assert.strictEqual(E.PET_SPECIES.ashmouse.name, 'Ash Mouse');
  });
  check('ash mouse is weaker than cinder pup and excluded from wild eggs', () => {
    assert.ok(E.PET_SPECIES.ashmouse.baseDmg < E.PET_SPECIES.cinderpup.baseDmg);
    assert.strictEqual(E.PET_SPECIES.ashmouse.weight, 0);
  });
  check('old saves normalize shopEggs.stray', () => {
    const s = { pets: { collection: [], shopEggs: { common: 1 } } };
    const p = E.ensurePets(s);
    assert.strictEqual(p.shopEggs.stray, 0);
  });

  console.log('== 6. guided onboarding chain ==');
  const guide = () => E.STORY_QUEST_DEFS.filter((d) => d.group === 'guide');
  check('8 guide quests in order with a requires chain', () => {
    const g = guide();
    assert.strictEqual(g.length, 8);
    const ids = g.map((d) => d.id);
    assert.deepStrictEqual(ids, ['q-guide-1','q-guide-2','q-guide-3','q-guide-4',
      'q-guide-5','q-guide-6','q-guide-7','q-guide-8']);
    for (let i = 1; i < g.length; i++) {
      assert.strictEqual(g[i].requires, ids[i - 1], `${g[i].id} requires`);
    }
    assert.ok(!g[0].requires, 'first step has no prerequisite');
  });
  check('locked reason present until prerequisite claimed', () => {
    const s = E.ensureState({});
    E.ensureStoryQuests(s);
    const g2 = E.STORY_QUEST_DEFS.find((d) => d.id === 'q-guide-2');
    const reason = E.storyQuestLockedReason(s, g2);
    assert.ok(reason && reason.includes('First Blood'), `got: ${reason}`);
    // claim the first step, then the second unlocks
    const e1 = s.quests.story.find((e) => e.id === 'q-guide-1');
    e1.claimed = true;
    assert.strictEqual(E.storyQuestLockedReason(s, g2), null);
  });
  check('claimQuest refuses a locked guide step', () => {
    const s = E.ensureState({});
    E.ensureStoryQuests(s);
    // give progress toward step 2 without claiming step 1
    s.mine = s.mine || {};
    s.mine.totalMined = 50;
    const res = E.claimQuest(s, 'story', 'q-guide-2');
    assert.strictEqual(res.ok, false);
  });
  check('guide metrics compute from state', () => {
    const s = E.ensureState({});
    E.ensureStoryQuests(s);
    s.stats.kills = 3;
    s.mine.totalMined = 12;
    s.guideTabs.guild = true;
    s.stats.questsCompleted = 2;
    s.activeTitle = 'slayer';
    s.professions.smithing = 2;
    s.pets.collection.push({ uid: 'x', species: 'ashmouse', level: 1, xp: 0, xpNext: 10, hunger: 100 });
    const prog = (id) => {
      const def = E.STORY_QUEST_DEFS.find((d) => d.id === id);
      const entry = s.quests.story.find((e) => e.id === id);
      return E.storyQuestProgress(s, entry).progress;
    };
    // bases snapshotted at first sight (all zero) -> progress equals totals
    assert.strictEqual(prog('q-guide-1'), 3);
    assert.strictEqual(prog('q-guide-2'), 12);
    assert.strictEqual(prog('q-guide-3'), 1);
    assert.strictEqual(prog('q-guide-5'), 1);
    assert.strictEqual(prog('q-guide-6'), 1);
    assert.strictEqual(prog('q-guide-7'), 1);
    assert.strictEqual(prog('q-guide-8'), 2);
  });
  check('forge metric counts forged items and enchants', () => {
    const s = E.ensureState({});
    assert.strictEqual(E.storyQuestProgress(s, { id: 'q-guide-4', target: 1, base: 0 }).progress, 0);
    s.equipped.weapon = { name: 'Sword', enchant: 3 };
    assert.strictEqual(E.storyQuestProgress(s, { id: 'q-guide-4', target: 1, base: 0 }).progress, 1);
  });

  console.log('== 2. meter last-fight fallback (source) ==');
  check('spawnEnemy stashes lastMeter before reset', () => {
    assert.ok(appSrc.includes('App.lastMeter = meterSnapshot()'), 'stash missing');
  });
  check('meterSnapshot falls back to last fight when empty', () => {
    assert.ok(appSrc.includes('stale: true'), 'stale flag missing');
  });
  check('renderMeter shows LAST FIGHT pill for stale snapshots', () => {
    assert.ok(uiSrc.includes('LAST FIGHT'), 'pill text missing');
    assert.ok(uiSrc.includes("getElementById('meter-live')"), 'pill lookup missing');
  });

  console.log('== 3. level-up queue (source) ==');
  check('levelUpModal queues while one is open', () => {
    assert.ok(uiSrc.includes('_levelUpQueue'), 'queue missing');
    assert.ok(uiSrc.includes('_levelUpOpen'), 'open flag missing');
  });
  check('modal supports onClose for queue draining', () => {
    assert.ok(uiSrc.includes('onClose = null'), 'onClose param missing');
  });

  console.log('== 4. quest first-open sync (source) ==');
  check('quest cards carry data-qcard hooks', () => {
    assert.ok(uiSrc.includes('data-qcard='), 'data-qcard missing');
    assert.ok(uiSrc.includes('data-qfill'), 'data-qfill missing');
  });
  check('live sync timer runs while quests tab is open', () => {
    assert.ok(uiSrc.includes('_startQuestSync'), 'sync starter missing');
    assert.ok(uiSrc.includes('_stopQuestSync'), 'sync stopper missing');
  });
  check('guide section rendered in quests tab', () => {
    assert.ok(uiSrc.includes("renderStoryList('guide'"), 'guide section missing');
  });

  console.log('');
  if (failures) {
    console.error(`${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log('all feedback checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
