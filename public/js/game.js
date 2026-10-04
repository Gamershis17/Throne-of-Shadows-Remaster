// ============================================================
// game.js — Classic MMORPG idle game logic
// Fresh start: clean, simple, from the bottom up.
// ============================================================
import * as Engine from './engine.js';

const $ = (id) => document.getElementById(id);

let hero = null;
let enemy = null;
let heroHp = 0;
let heroMana = 0;
let party = null;
let selectedClass = 'warrior';
let autoTimer = null;
let manaTimer = null;
let spellCooldowns = {};

// --- Class Select ---
function renderClasses() {
  const wrap = $('class-cards');
  wrap.innerHTML = '';
  for (const cls of Object.values(Engine.CLASSES)) {
    const div = document.createElement('div');
    div.className = 'class-card' + (cls.id === selectedClass ? ' selected' : '');
    div.innerHTML = `
      <div class="cls-emoji">${cls.emoji}</div>
      <div class="cls-name">${cls.name}</div>
      <div class="cls-desc">${cls.desc}</div>
    `;
    div.onclick = () => {
      selectedClass = cls.id;
      renderClasses();
    };
    wrap.appendChild(div);
  }
}

$('start-btn').onclick = async () => {
  const name = ($('hero-name').value || 'Hero').slice(0, 16);
  hero = Engine.createHero(name, selectedClass);
  const st = Engine.heroStats(hero);
  heroHp = st.hp;
  heroMana = st.mana;
  party = Engine.createParty(selectedClass);

  // Save to server session
  try {
    await fetch('/api/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, classId: selectedClass }),
    });
  } catch { /* offline ok */ }

  // Save locally too
  localStorage.setItem('tos-hero', JSON.stringify(hero));

  $('view-class').classList.add('hidden');
  $('view-game').classList.remove('hidden');
  checkGM();
  startBattle();
  updateHUD();
};

// --- Battle ---
function startBattle() {
  enemy = Engine.makeEnemy(hero.stage);
  renderEnemy();
  renderSpells();
  renderPet();
  updateHUD();
  startAutoAttack();
}

function renderSpells() {
  const bar = $('spell-bar');
  bar.innerHTML = '';
  const spells = Engine.SPELLS[hero.classId] || [];
  for (const spell of spells) {
    const btn = document.createElement('button');
    btn.className = 'spell-btn';
    btn.innerHTML = `${spell.emoji}<span>${spell.name}</span>`;
    btn.title = spell.desc;
    btn.onclick = () => {
      // Check cooldown
      const now = Date.now();
      if (spellCooldowns[spell.id] && now < spellCooldowns[spell.id]) {
        const s = Math.ceil((spellCooldowns[spell.id] - now) / 1000);
        toast(`⏳ ${spell.name} ready in ${s}s`);
        return;
      }
      // Check mana
      if (heroMana < spell.mana) {
        toast(`💧 Not enough mana!`);
        return;
      }
      heroMana -= spell.mana;
      spellCooldowns[spell.id] = now + (spell.cd * 1000);
      updateManaBar();

      const result = Engine.castSpell(hero, spell.id, enemy, heroHp, Engine.heroStats(hero).hp);
      if (!result) return;
      if (result.damage > 0) {
        floatText(`${spell.emoji} ${result.damage}`, 'crit', false);
        updateEnemyBar();
        if (result.killed) onKill();
      }
      if (spell.id === 'mend' && hero.pet) {
        const r = Engine.feedPet(hero, 'meat');
        if (r.ok) {
          renderPet();
          toast('💚 Pet fed and happy!');
        }
      }
      // Visual cooldown
      btn.style.opacity = '0.5';
      setTimeout(() => btn.style.opacity = '1', spell.cd * 1000);
    };
    bar.appendChild(btn);
  }
}

function renderPet() {
  const bar = $('pet-bar');
  if (!hero.pet) {
    // Hunter with no pet — offer to find one
    if (hero.classId === 'hunter') {
      bar.classList.remove('hidden');
      bar.innerHTML = `<span>💔 No pet</span><button id="find-pet-btn" class="btn small gold">🔍 Find Pet</button>`;
      $('find-pet-btn').onclick = () => {
        const r = Engine.findPet(hero);
        if (!r.ok) {
          toast(r.reason === 'gold' ? `Need ${r.cost}g for a pet!` : 'Cannot find pet');
          return;
        }
        // Rebuild pet bar
        bar.innerHTML = `<span id="pet-emoji">🐺</span><span id="pet-loyalty"></span><div id="food-btns" class="food-btns"></div>`;
        renderPet();
        updateHUD();
        saveHero();
        toast(`🎉 ${r.pet.emoji} ${r.pet.name} joined you!`);
      };
    } else {
      bar.classList.add('hidden');
    }
    return;
  }
  bar.classList.remove('hidden');
  $('pet-emoji').textContent = hero.pet.emoji;
  $('pet-loyalty').textContent = `${hero.pet.name} · Loyalty ${hero.pet.loyalty}%`;

  // Food buttons — right food for diet = full effect
  const fb = $('food-btns');
  fb.innerHTML = '';
  const diet = hero.pet.diet || 'carnivore';
  for (const [fid, food] of Object.entries(Engine.PET_FOODS)) {
    const isRight = food.for.includes(diet);
    const btn = document.createElement('button');
    btn.className = 'btn small' + (isRight ? ' gold' : '');
    btn.textContent = `${food.emoji}`;
    btn.title = `${food.name} — ${isRight ? '✓ loves it' : 'meh'} (${food.cost * hero.level}g)`;
    btn.onclick = () => {
      const r = Engine.feedPet(hero, fid);
      if (!r.ok) {
        toast(r.reason === 'gold' ? 'Not enough gold!' : 'Cannot feed');
        return;
      }
      renderPet();
      updateHUD();
      toast(r.rightFood ? `${r.food.emoji} ${hero.pet.name} loved it! +${r.gain}` : `${r.food.emoji} ${hero.pet.name} nibbled... +${r.gain}`);
    };
    fb.appendChild(btn);
  }
}

function renderEnemy() {
  $('enemy-emoji').textContent = enemy.emoji;
  $('enemy-name').textContent = enemy.name;
  $('boss-badge').classList.toggle('hidden', !enemy.isBoss);
  updateEnemyBar();
}

function updateEnemyBar() {
  const pct = (enemy.hp / enemy.maxHp) * 100;
  $('enemy-hp-fill').style.width = pct + '%';
  $('enemy-hp-text').textContent = `${enemy.hp} / ${enemy.maxHp}`;
}

function updateHeroBar() {
  const stats = Engine.heroStats(hero);
  const pct = (heroHp / stats.hp) * 100;
  $('hero-hp-fill').style.width = pct + '%';
  $('hero-hp-text').textContent = `${heroHp} / ${stats.hp}`;
}

function updateHUD() {
  const cls = Engine.CLASSES[hero.classId];
  const stats = Engine.heroStats(hero);
  $('hud-emoji').textContent = cls.emoji;
  $('hud-name').textContent = hero.name;
  $('hud-level').textContent = `Lv ${hero.level} ${cls.name}`;
  $('hud-gold').textContent = hero.gold;
  $('hud-stage').textContent = hero.stage;
  $('char-name').textContent = hero.name;

  // XP bar
  const xpNeed = Engine.xpForLevel(hero.level);
  $('hero-xp-fill').style.width = (hero.xp / xpNeed * 100) + '%';

  updateHeroBar();

  // Character tab
  $('char-stats').innerHTML = `
    <div class="stat-row"><span>❤️ HP</span><span class="val">${stats.hp}</span></div>
    <div class="stat-row"><span>⚔️ Attack</span><span class="val">${stats.atk}</span></div>
    <div class="stat-row"><span>🛡️ Defense</span><span class="val">${stats.def}</span></div>
    <div class="stat-row"><span>💥 Crit</span><span class="val">${Math.floor(stats.critChance * 100)}%</span></div>
  `;

  // Equipped
  const eq = $('equipped-list');
  eq.innerHTML = '';
  for (const [slot, item] of Object.entries(hero.gear)) {
    const div = document.createElement('div');
    div.className = 'gear-item';
    div.innerHTML = item
      ? `<div><div class="g-name" style="color:${item.color}">${item.name}</div>
         <div class="g-stats">${slot} · +${item.atk} atk +${item.def} def +${item.hp} hp</div></div>`
      : `<div><div class="g-name" style="color:#555">Empty ${slot}</div></div>`;
    eq.appendChild(div);
  }

  // Inventory
  const inv = $('inventory-list');
  inv.innerHTML = hero.inventory.length ? '' : '<p style="color:#666">No items yet. Defeat enemies for loot!</p>';
  for (const item of hero.inventory) {
    const div = document.createElement('div');
    div.className = 'gear-item';
    const better = Engine.isUpgrade(hero, item);
    div.innerHTML = `
      <div><div class="g-name" style="color:${item.color}">${item.name}</div>
      <div class="g-stats">${item.slot} · +${item.atk} atk +${item.def} def +${item.hp} hp</div></div>
      <button class="btn ${better ? 'gold' : ''}" data-equip="${item.id}">${better ? '⬆️ Equip' : 'Equip'}</button>
    `;
    inv.appendChild(div);
  }
  inv.querySelectorAll('[data-equip]').forEach(btn => {
    btn.onclick = () => equipItem(btn.dataset.equip);
  });
}

function equipItem(itemId) {
  const idx = hero.inventory.findIndex(i => i.id === itemId);
  if (idx === -1) return;
  const item = hero.inventory[idx];
  const old = hero.gear[item.slot];
  hero.gear[item.slot] = item;
  hero.inventory.splice(idx, 1);
  if (old) hero.inventory.push(old);
  // Recalc HP (keep same %)
  const stats = Engine.heroStats(hero);
  heroHp = Math.min(heroHp, stats.hp);
  saveHero();
  updateHUD();
  toast(`Equipped ${item.name}`);
}

function floatText(text, cls, isPlayer) {
  const layer = $('float-layer');
  const el = document.createElement('div');
  el.className = `float-dmg ${cls}`;
  el.textContent = text;
  el.style.left = (30 + Math.random() * 40) + '%';
  el.style.top = (isPlayer ? 60 : 30) + '%';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

function doAttack() {
  if (!enemy || enemy.hp <= 0) return;
  const result = Engine.playerAttack(hero, enemy);
  floatText(result.crit ? `💥 ${result.damage}!` : result.damage, result.crit ? 'crit' : 'normal', false);

  // Hunter pet attacks too
  if (hero.pet && !result.killed) {
    const petResult = Engine.petAttack(hero, enemy);
    if (petResult) {
      floatText(`🐾 ${petResult.damage}`, 'normal', false);
      // Loyalty drains slowly
      hero.pet.loyalty = Math.max(0, hero.pet.loyalty - 1);
      const left = Engine.checkPetLeave(hero);
      if (left) {
        toast(`💔 ${left} left you... (loyalty hit 0)`);
        renderPet();
        updateHUD();
      } else {
        renderPet();
      }
      if (petResult.killed) {
        updateEnemyBar();
        onKill();
        return;
      }
    }
  }

  updateEnemyBar();

  if (result.killed) {
    onKill();
  } else {
    // Enemy counterattacks
    setTimeout(() => {
      if (!enemy || enemy.hp <= 0) return;
      const dmg = Engine.enemyAttack(enemy, hero);
      heroHp = Math.max(0, heroHp - dmg);
      floatText(`-${dmg}`, 'player-hit', true);
      updateHeroBar();
      if (heroHp <= 0) onDeath();
    }, 400);
  }
}

function onKill() {
  const stats = Engine.heroStats(hero);
  hero.gold += enemy.goldReward;
  const levels = Engine.awardXp(hero, enemy.xpReward);

  // Gear drop
  const drop = Engine.rollGearDrop(enemy.stage, enemy.isBoss);
  if (drop) {
    hero.inventory.push(drop);
    if (Engine.isUpgrade(hero, drop)) {
      toast(`🎁 ${drop.name} — UPGRADE! Check Gear tab`);
    } else {
      toast(`🎁 Found ${drop.name}`);
    }
  }
  // Material drop (for quests)
  const mat = Engine.rollMaterialDrop(enemy);
  if (mat) {
    hero.materials[mat.id] = (hero.materials[mat.id] || 0) + mat.qty;
    // Don't spam toast for materials, just update quest tab silently
  }

  if (levels > 0) {
    heroHp = Engine.heroStats(hero).hp; // Full heal on level up
    toast(`🎉 Level ${hero.level}! HP restored`);
  }

  hero.stage++;
  saveHero();

  // Next enemy after short delay
  setTimeout(() => {
    heroHp = Math.min(heroHp + Math.floor(stats.hp * 0.1), Engine.heroStats(hero).hp);
    startBattle();
  }, 800);
}

function onDeath() {
  clearInterval(autoTimer);
  toast('💀 You fell! Reviving...');
  setTimeout(() => {
    heroHp = Engine.heroStats(hero).hp;
    updateHeroBar();
    startAutoAttack();
    toast('✨ Revived with full HP');
  }, 2000);
}

function startAutoAttack() {
  clearInterval(autoTimer);
  autoTimer = setInterval(() => {
    if (enemy && enemy.hp > 0 && heroHp > 0) doAttack();
  }, 3000); // Auto-attack every 3s
  // Mana regen
  clearInterval(manaTimer);
  manaTimer = setInterval(() => {
    const max = Engine.heroStats(hero).mana;
    heroMana = Math.min(max, heroMana + Math.floor(max * 0.05));
    updateManaBar();
  }, 1000);
}

function updateManaBar() {
  const max = Engine.heroStats(hero).mana;
  const pct = (heroMana / max) * 100;
  const fill = $('hero-mana-fill');
  const text = $('hero-mana-text');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = `${heroMana} / ${max}`;
}

$('attack-btn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  doAttack();
});

function toast(msg) {
  const t = $('loot-toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2500);
}

function saveHero() {
  hero.party = party;
  localStorage.setItem('tos-hero', JSON.stringify(hero));
}

// --- Party ---
function renderParty() {
  const counts = { tank: 0, healer: 0, dps: 0 };
  for (const m of party.members) counts[m.role]++;

  $('party-count').textContent = `(${party.members.length}/5)`;

  const pl = $('party-list');
  pl.innerHTML = '';
  for (const m of party.members) {
    const div = document.createElement('div');
    div.className = 'gear-item';
    const role = Engine.ROLES[m.role];
    if (m.isPlayer) {
      const cls = Engine.CLASSES[hero.classId];
      div.innerHTML = `<div><div class="g-name">${cls.emoji} ${hero.name} (You)</div>
        <div class="g-stats">${role.emoji} ${role.name} · Lv ${hero.level}</div></div>`;
    } else {
      div.innerHTML = `<div><div class="g-name">${m.emoji} ${m.name}</div>
        <div class="g-stats">${role.emoji} ${role.name} · ${m.hp}/${m.maxHp} HP</div></div>
        <button class="btn small" data-dismiss="${m.id}">Dismiss</button>`;
    }
    pl.appendChild(div);
  }
  pl.querySelectorAll('[data-dismiss]').forEach(btn => {
    btn.onclick = () => {
      party.members = party.members.filter(m => m.id !== btn.dataset.dismiss);
      saveHero();
      renderParty();
      renderDungeons();
    };
  });

  // Recruit list
  const rl = $('recruit-list');
  rl.innerHTML = '';
  for (const comp of Engine.COMPANIONS) {
    if (party.members.some(m => m.id === comp.id)) continue;
    const role = Engine.ROLES[comp.role];
    const div = document.createElement('div');
    div.className = 'gear-item';
    div.innerHTML = `<div><div class="g-name">${comp.emoji} ${comp.name}</div>
      <div class="g-stats">${role.emoji} ${role.name} · ${comp.desc} · ${comp.cost}g</div></div>
      <button class="btn small gold" data-hire="${comp.id}">Hire</button>`;
    rl.appendChild(div);
  }
  rl.querySelectorAll('[data-hire]').forEach(btn => {
    btn.onclick = () => {
      const r = Engine.hireCompanion(hero, party, btn.dataset.hire);
      if (!r.ok) {
        toast(r.reason === 'gold' ? 'Not enough gold!' : r.reason === 'full' ? 'Party full!' : 'Cannot hire');
        return;
      }
      saveHero();
      renderParty();
      renderDungeons();
      updateHUD();
      toast(`🎉 ${r.companion.emoji} ${r.companion.name} joined!`);
    };
  });
}

// --- Dungeon Runs ---
let dungeonRun = null;
let dungeonTimer = null;

function enterDungeon(dungeonId) {
  if (!Engine.validateParty(party)) {
    toast('Need full 5-man party!');
    return;
  }
  dungeonRun = Engine.startDungeon(dungeonId, hero, party);
  dungeonRun.party = party;
  // Init party HP
  for (const m of party.members) {
    if (!m.isPlayer) dungeonRun.partyHp[m.id] = m.maxHp;
  }
  $('dungeon-run').classList.remove('hidden');
  $('dr-name').textContent = `${dungeonRun.dungeon.emoji} ${dungeonRun.dungeon.name}`;
  startDungeonWave();
}

function startDungeonWave() {
  const enemies = Engine.spawnDungeonWave(dungeonRun, hero);
  $('dr-wave').textContent = `Wave ${dungeonRun.wave}/${dungeonRun.dungeon.waves}`;
  renderDungeonParty();
  renderDungeonEnemies();
  startDungeonCombat();
}

function renderDungeonParty() {
  const el = $('dr-party');
  el.innerHTML = '';
  // Player
  const stats = Engine.heroStats(hero);
  const pdiv = document.createElement('div');
  pdiv.className = 'dr-member';
  pdiv.innerHTML = `${Engine.CLASSES[hero.classId].emoji}<br>${hero.name}<br>
    <div class="m-hp"><div class="m-hp-fill" id="dr-php" style="width:${heroHp/stats.hp*100}%"></div></div>`;
  el.appendChild(pdiv);
  // NPCs
  for (const m of party.members) {
    if (m.isPlayer) continue;
    const hp = dungeonRun.partyHp[m.id] || m.maxHp;
    const div = document.createElement('div');
    div.className = 'dr-member';
    div.innerHTML = `${m.emoji}<br>${m.name}<br>
      <div class="m-hp"><div class="m-hp-fill" id="dr-hp-${m.id}" style="width:${hp/m.maxHp*100}%"></div></div>`;
    el.appendChild(div);
  }
}

function renderDungeonEnemies() {
  const el = $('dr-enemies');
  el.innerHTML = '';
  dungeonRun.enemies.forEach((e, i) => {
    const div = document.createElement('div');
    div.className = 'dr-enemy';
    div.innerHTML = `${e.emoji}<div style="font-size:14px">${e.name}</div>
      <div class="e-hp"><div class="e-hp-fill" id="dr-ehp-${i}" style="width:${e.hp/e.maxHp*100}%"></div></div>`;
    el.appendChild(div);
  });
}

function startDungeonCombat() {
  clearInterval(dungeonTimer);
  dungeonTimer = setInterval(() => {
    if (!dungeonRun) return;
    // Party auto-attacks
    for (const m of party.members) {
      if (m.isPlayer) continue; // Player taps manually
      if (m.role === 'healer') {
        const h = Engine.healerAct(m, dungeonRun, hero, heroHp);
        if (h) {
          if (h.target === 'player') {
            heroHp = Math.min(Engine.heroStats(hero).hp, heroHp + h.amount);
            const f = $('dr-php');
            if (f) f.style.width = (heroHp / Engine.heroStats(hero).hp * 100) + '%';
          } else {
            const f = $(`dr-hp-${dungeonRun.party.members.find(x => x.name === h.target)?.id}`);
            // Update bar
          }
          renderDungeonParty();
        }
        continue;
      }
      // DPS and Tank attack
      const r = Engine.partyAttack(m, dungeonRun.enemies, hero);
      if (r) {
        const idx = dungeonRun.enemies.indexOf(r.target);
        const bar = $(`dr-ehp-${idx}`);
        if (bar) bar.style.width = (r.target.hp / r.target.maxHp * 100) + '%';
        if (dungeonRun.enemies.every(e => e.hp <= 0)) {
          onDungeonWaveClear();
          return;
        }
      }
    }
    // Enemies attack random party member
    const alive = dungeonRun.enemies.filter(e => e.hp > 0);
    if (alive.length) {
      const e = alive[Math.floor(Math.random() * alive.length)];
      // Tank takes hits first (50% chance to intercept)
      const tank = party.members.find(m => m.role === 'tank' && !m.isPlayer);
      let target = null;
      if (tank && Math.random() < 0.5 && (dungeonRun.partyHp[tank.id] > 0)) {
        target = tank;
      } else {
        // Random target
        const candidates = party.members.filter(m => !m.isPlayer && (dungeonRun.partyHp[m.id] || 0) > 0);
        if (Math.random() < 0.3 || !candidates.length) {
          // Hit player
          const dmg = Math.max(1, Math.floor(e.atk * 0.5));
          heroHp = Math.max(0, heroHp - dmg);
          const f = $('dr-php');
          if (f) f.style.width = (heroHp / Engine.heroStats(hero).hp * 100) + '%';
          if (heroHp <= 0) {
            onDungeonWipe();
            return;
          }
        } else {
          target = candidates[Math.floor(Math.random() * candidates.length)];
        }
      }
      if (target) {
        const dmg = Math.max(1, Math.floor(e.atk * (0.85 + Math.random() * 0.3)));
        dungeonRun.partyHp[target.id] = Math.max(0, (dungeonRun.partyHp[target.id] || target.maxHp) - dmg);
        const bar = $(`dr-hp-${target.id}`);
        if (bar) bar.style.width = (dungeonRun.partyHp[target.id] / target.maxHp * 100) + '%';
      }
    }
  }, 2000);
}

$('dr-attack').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!dungeonRun) return;
  const r = Engine.partyAttack({ isPlayer: true }, dungeonRun.enemies, hero);
  if (r) {
    const idx = dungeonRun.enemies.indexOf(r.target);
    const bar = $(`dr-ehp-${idx}`);
    if (bar) bar.style.width = (r.target.hp / r.target.maxHp * 100) + '%';
    if (dungeonRun.enemies.every(e => e.hp <= 0)) onDungeonWaveClear();
  }
});

function onDungeonWaveClear() {
  clearInterval(dungeonTimer);
  // Rewards for wave
  let gold = 0, xp = 0;
  for (const e of dungeonRun.enemies) {
    gold += e.goldReward;
    xp += e.xpReward;
  }
  hero.gold += gold;
  const levels = Engine.awardXp(hero, xp);
  toast(`Wave ${dungeonRun.wave} cleared! +${gold}g +${xp}xp`);

  dungeonRun.wave++;
  if (dungeonRun.wave > dungeonRun.dungeon.waves) {
    onDungeonComplete();
  } else {
    setTimeout(() => startDungeonWave(), 1500);
  }
}

function onDungeonComplete() {
  clearInterval(dungeonTimer);
  const bonus = dungeonRun.dungeon.waves * 100;
  hero.gold += bonus;
  // Guaranteed gear drop
  const drop = Engine.rollGearDrop(hero.stage + 10, true);
  if (drop) hero.inventory.push(drop);
  saveHero();
  updateHUD();
  $('dungeon-run').classList.add('hidden');
  dungeonRun = null;
  toast(`🎉 Dungeon complete! +${bonus}g${drop ? ` + ${drop.name}` : ''}`);
}

function onDungeonWipe() {
  clearInterval(dungeonTimer);
  $('dungeon-run').classList.add('hidden');
  dungeonRun = null;
  heroHp = Engine.heroStats(hero).hp;
  toast('💀 Party wiped! Try again when stronger.');
}

$('dr-leave').onclick = () => {
  clearInterval(dungeonTimer);
  $('dungeon-run').classList.add('hidden');
  dungeonRun = null;
};

// --- Dungeons ---
function renderDungeons() {
  const dl = $('dungeon-list');
  dl.innerHTML = '';
  const valid = Engine.validateParty(party);
  for (const d of Engine.DUNGEONS) {
    const unlocked = hero.stage >= d.unlockStage;
    const div = document.createElement('div');
    div.className = 'gear-item';
    div.innerHTML = `<div><div class="g-name">${d.emoji} ${d.name}</div>
      <div class="g-stats">${d.waves} waves · Unlocks at stage ${d.unlockStage} · ${d.desc}</div></div>
      <button class="btn small ${unlocked && valid ? 'gold' : ''}" ${!unlocked || !valid ? 'disabled' : ''} data-dungeon="${d.id}">
        ${!unlocked ? `🔒 Stage ${d.unlockStage}` : !valid ? 'Need 5-man' : 'Enter'}
      </button>`;
    dl.appendChild(div);
  }
  dl.querySelectorAll('[data-dungeon]').forEach(btn => {
    btn.onclick = () => enterDungeon(btn.dataset.dungeon);
  });
}

// --- Quests ---
function renderQuests() {
  const ql = $('quest-list');
  ql.innerHTML = '';
  for (const q of Engine.QUESTS) {
    const done = (hero.completedQuests || []).includes(q.id);
    const progress = Engine.questProgress(hero, q);
    const div = document.createElement('div');
    div.className = 'gear-item';
    let needText = Object.entries(q.need).map(([mid, n]) => {
      const have = (hero.materials || {})[mid] || 0;
      const mat = Engine.MATERIALS[mid];
      return `${mat.emoji} ${have}/${n}`;
    }).join(' ');
    div.innerHTML = `<div><div class="g-name">${q.emoji} ${q.name} ${done ? '✅' : ''}</div>
      <div class="g-stats">${q.desc}<br>${needText}<br>Reward: ${q.reward.gold}g + ${q.reward.xp}xp</div></div>
      ${!done && progress ? `<button class="btn small gold" data-quest="${q.id}">Turn In</button>` : ''}`;
    ql.appendChild(div);
  }
  ql.querySelectorAll('[data-quest]').forEach(btn => {
    btn.onclick = () => {
      const r = Engine.turnInQuest(hero, btn.dataset.quest);
      if (r) {
        saveHero();
        renderQuests();
        updateHUD();
        toast(`📜 Quest complete! +${r.quest.reward.gold}g +${r.quest.reward.xp}xp${r.levels ? ` (Lv up!)` : ''}`);
      }
    };
  });

  // Materials
  const ml = $('material-list');
  ml.innerHTML = '';
  const mats = hero.materials || {};
  const hasMats = Object.keys(mats).some(k => mats[k] > 0);
  if (!hasMats) ml.innerHTML = '<p style="color:#666">No materials yet. Defeat enemies!</p>';
  for (const [mid, qty] of Object.entries(mats)) {
    if (qty <= 0) continue;
    const mat = Engine.MATERIALS[mid];
    const div = document.createElement('div');
    div.className = 'gear-item';
    div.innerHTML = `<div><div class="g-name">${mat.emoji} ${mat.name} ×${qty}</div>
      <div class="g-stats">${mat.desc}</div></div>`;
    ml.appendChild(div);
  }
}

// --- Auction House ---
function renderAuction() {
  // Check for sales (goes to mail) and expiry (returns via mail)
  const sold = Engine.checkAuctionSalesMail(hero);
  const expired = Engine.checkAuctionExpiry(hero);
  if (sold.length || expired.length) {
    saveHero();
    updateHUD();
    if (sold.length) toast(`📬 ${sold.length} auction(s) sold! Check mail.`);
    if (expired.length) toast(`📬 ${expired.length} expired! Check mail.`);
  }

  // Your listings
  const al = $('auction-list');
  al.innerHTML = '';
  const auctions = hero.auctions || [];
  if (!auctions.length) al.innerHTML = '<p style="color:#666">No listings. List items from your inventory below.</p>';
  for (const a of auctions) {
    const div = document.createElement('div');
    div.className = 'gear-item';
    div.innerHTML = `<div><div class="g-name" style="color:${a.color}">${a.name}</div>
      <div class="g-stats">Listed for ${a.listPrice}g</div></div>
      <button class="btn small" data-cancel="${a.id}">Cancel</button>`;
    al.appendChild(div);
  }
  al.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.onclick = () => {
      Engine.cancelAuction(hero, btn.dataset.cancel);
      saveHero();
      renderAuction();
      updateHUD();
      toast('Listing cancelled');
    };
  });

  // Inventory (listable items)
  const inv = $('auction-inventory');
  inv.innerHTML = '';
  if (!hero.inventory.length) inv.innerHTML = '<p style="color:#666">Inventory empty</p>';
  for (const item of hero.inventory) {
    const div = document.createElement('div');
    div.className = 'gear-item';
    const suggested = Engine.sellPrice(item, hero) * 3; // Suggest 3x vendor price
    div.innerHTML = `<div><div class="g-name" style="color:${item.color}">${item.name}</div>
      <div class="g-stats">+${item.atk} atk +${item.def} def +${item.hp} hp</div></div>
      <div style="display:flex;gap:4px;align-items:center">
        <input type="number" id="price-${item.id}" value="${suggested}" min="1" style="width:70px;padding:6px;background:#1a1528;border:1px solid #2a2440;border-radius:4px;color:#fff">
        <button class="btn small gold" data-list="${item.id}">List</button>
      </div>`;
    inv.appendChild(div);
  }
  inv.querySelectorAll('[data-list]').forEach(btn => {
    btn.onclick = () => {
      const priceInput = $(`price-${btn.dataset.list}`);
      const price = parseInt(priceInput.value) || 1;
      const r = Engine.listAuction(hero, btn.dataset.list, price);
      if (r.ok) {
        saveHero();
        renderAuction();
        updateHUD();
        toast(`📋 Listed for ${price}g`);
      }
    };
  });
}

// --- Mail ---
function renderMail() {
  const ml = $('mail-list');
  ml.innerHTML = '';
  const mail = hero.mail || [];
  const unread = mail.filter(m => !m.read && (m.gold || m.item)).length;
  $('mail-count').textContent = unread ? `(${unread} new)` : '';

  if (!mail.length) {
    ml.innerHTML = '<p style="color:#666">No mail. Auction sales and returns arrive here.</p>';
    return;
  }
  // Newest first
  for (const m of [...mail].reverse()) {
    const hasItems = m.gold > 0 || m.item;
    const div = document.createElement('div');
    div.className = 'gear-item';
    div.innerHTML = `<div><div class="g-name">${m.subject} ${!m.read && hasItems ? '📩' : ''}</div>
      <div class="g-stats">${m.body}</div>
      ${m.gold ? `<div class="g-stats">💰 ${m.gold}g</div>` : ''}
      ${m.item ? `<div class="g-stats">📦 ${m.item.name}</div>` : ''}</div>
      ${hasItems ? `<button class="btn small gold" data-claim="${m.id}">Claim</button>` : ''}`;
    ml.appendChild(div);
  }
  ml.querySelectorAll('[data-claim]').forEach(btn => {
    btn.onclick = () => {
      Engine.claimMail(hero, btn.dataset.claim);
      saveHero();
      renderMail();
      updateHUD();
      toast('📬 Claimed!');
    };
  });
}

// --- Chat ---
let chatTimer = null;

async function loadChat() {
  try {
    const r = await fetch('/api/chat');
    const d = await r.json();
    if (!d.ok) return;
    const box = $('chat-messages');
    box.innerHTML = '';
    for (const m of d.messages) {
      const div = document.createElement('div');
      div.className = 'chat-msg';
      div.innerHTML = `<span class="c-name ${m.isGM ? 'gm' : ''}">${escapeHtml(m.display)}</span>: <span class="c-text">${escapeHtml(m.text)}</span>`;
      box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
  } catch {}
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function sendChat() {
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    loadChat();
  } catch {}
}

$('chat-send').onclick = sendChat;
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

// --- GM ---
let isGMUser = false;
let lastAnnounceSeen = 0;

async function checkGM() {
  // GM if hero name matches (simple check)
  // Real check happens server-side on GM endpoints
  const gmNames = ['Gamershis17'];
  isGMUser = gmNames.includes(hero.name);
  if (isGMUser) {
    $('gm-tab-btn').classList.remove('hidden');
  }
}

async function loadGMFeedback() {
  try {
    const r = await fetch('/api/gm/feedback');
    const d = await r.json();
    if (!d.ok) return;
    const el = $('gm-feedback-list');
    el.innerHTML = d.feedback.length ? '' : '<p style="color:#666">No feedback yet.</p>';
    for (const f of d.feedback) {
      const div = document.createElement('div');
      div.className = 'gear-item';
      div.innerHTML = `<div><div class="g-name">${escapeHtml(f.from)}</div>
        <div class="g-stats">${escapeHtml(f.text)}</div></div>`;
      el.appendChild(div);
    }
  } catch {}
}

// Announcement polling
setInterval(async () => {
  if (!hero) return;
  try {
    const r = await fetch(`/api/announcement?since=${lastAnnounceSeen}`);
    const d = await r.json();
    if (d.ok && d.announcement) {
      lastAnnounceSeen = d.announcement.at;
      $('gm-announce-by').textContent = `<GM> ${d.announcement.by}`;
      $('gm-announce-text').textContent = d.announcement.text;
      $('gm-announce').classList.remove('hidden');
    }
  } catch {}
}, 5000);

$('gm-announce-close').onclick = () => $('gm-announce').classList.add('hidden');

// GM broadcast
$('gm-broadcast-btn') && ($('gm-broadcast-btn').onclick = async () => {
  const text = $('gm-broadcast-input').value.trim();
  if (!text) return;
  await fetch('/api/gm/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  $('gm-broadcast-input').value = '';
  toast('📢 Broadcast sent!');
});

// GM self stat editing
$('gm-gold-btn') && ($('gm-gold-btn').onclick = () => {
  const v = parseInt($('gm-gold-input').value);
  if (v >= 0) { hero.gold = v; saveHero(); updateHUD(); toast(`💰 Gold set to ${v}`); }
});
$('gm-level-btn') && ($('gm-level-btn').onclick = () => {
  const v = parseInt($('gm-level-input').value);
  if (v >= 1 && v <= 100) {
    hero.level = v;
    heroHp = Engine.heroStats(hero).hp;
    heroMana = Engine.heroStats(hero).mana;
    saveHero(); updateHUD(); toast(`🎉 Level set to ${v}`);
  }
});
$('gm-stage-btn') && ($('gm-stage-btn').onclick = () => {
  const v = parseInt($('gm-stage-input').value);
  if (v >= 1) { hero.stage = v; saveHero(); updateHUD(); startBattle(); toast(`🗺️ Stage set to ${v}`); }
});

// Feedback
$('feedback-btn') && ($('feedback-btn').onclick = async () => {
  const text = $('feedback-input').value.trim();
  if (!text) return;
  await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, type: 'feedback' }),
  });
  $('feedback-input').value = '';
  toast('📝 Feedback sent! Thanks.');
});

// --- Tabs ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'party') renderParty();
    if (btn.dataset.tab === 'dungeon') renderDungeons();
    if (btn.dataset.tab === 'quests') renderQuests();
    if (btn.dataset.tab === 'auction') renderAuction();
    if (btn.dataset.tab === 'mail') renderMail();
    if (btn.dataset.tab === 'gm') loadGMFeedback();
    if (btn.dataset.tab === 'chat') {
      loadChat();
      clearInterval(chatTimer);
      chatTimer = setInterval(loadChat, 3000);
    } else {
      clearInterval(chatTimer);
    }
    if (btn.dataset.tab !== 'battle') updateHUD();
  };
});

$('logout-btn').onclick = async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('tos-hero');
  location.reload();
};

// --- Init ---
renderClasses();

// Try to restore hero
try {
  const saved = localStorage.getItem('tos-hero');
  if (saved) {
    hero = JSON.parse(saved);
    heroHp = Engine.heroStats(hero).hp;
    heroMana = Engine.heroStats(hero).mana;
    party = hero.party || Engine.createParty(hero.classId);
    // Restore companion HP
    for (const m of party.members) {
      if (!m.isPlayer && m.maxHp) m.hp = m.maxHp;
    }
    $('view-class').classList.add('hidden');
    $('view-game').classList.remove('hidden');
    checkGM();
    startBattle();
    updateHUD();
  }
} catch { /* fresh start */ }
