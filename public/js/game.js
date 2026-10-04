// ============================================================
// game.js — Classic MMORPG idle game logic
// Fresh start: clean, simple, from the bottom up.
// ============================================================
import * as Engine from './engine.js';

const $ = (id) => document.getElementById(id);

let hero = null;
let enemy = null;
let heroHp = 0;
let selectedClass = 'warrior';
let autoTimer = null;

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
  heroHp = Engine.heroStats(hero).hp;

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
  updateHUD();
  startAutoAttack();
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
  localStorage.setItem('tos-hero', JSON.stringify(hero));
}

// --- Tabs ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.remove('hidden');
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
    $('view-class').classList.add('hidden');
    $('view-game').classList.remove('hidden');
    startBattle();
    updateHUD();
  }
} catch { /* fresh start */ }
