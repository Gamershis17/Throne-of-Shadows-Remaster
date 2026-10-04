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
  // TODO: dungeon run logic
}

// --- Tabs ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'party') renderParty();
    if (btn.dataset.tab === 'dungeon') renderDungeons();
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
    startBattle();
    updateHUD();
  }
} catch { /* fresh start */ }
