// ============================================================
// app.js — boot, session flow, game loops, combat wiring.
// ============================================================
import { api } from './api.js';
import * as Engine from './engine.js';
import { UI, esc, formatNum } from './ui.js';
import { Auth } from './auth.js';
import { GM } from './gm.js';

const TICK_MS = 250;
const AUTOSAVE_MS = 15000;
const ENEMY_ATTACK_S = 2.0;
const RESPAWN_MS = 3000;
const SKILL_CD_MS = 12000;
const SKILL_MULT = 2.5;

const App = {
  user: null,
  state: null,
  enemy: null,
  dead: false,
  respawnAt: 0,
  heroTimer: 0,
  enemyTimer: 0,
  companionTimers: {}, // companion id -> seconds accumulated
  skillReadyAt: 0,
  tapCombo: 0,
  lastTapAt: 0,
  frenzyUntil: 0,
  lastZone: null,
  lastBossModalStage: 0,
  lastDeathStage: 0,
  deathStreak: 0,
  saveTimer: null,
  tickTimer: null,
  started: false,
};

// ---------------- boot ----------------
async function boot() {
  UI.handlers = {
    onTap: doTap,
    onSkill: usePowerStrike,
    onMode: setMode,
    onPrestige: doPrestige,
    onEquip: doEquip,
    onSell: doSell,
    onUpgrade: doUpgrade,
    onRecruit: doRecruit,
    onDismiss: doDismiss,
    onRedeem: doRedeem,
    onLogout: doLogout,
    onOpenGM: () => GM.open(App.user),
    onTalent: doTalent,
    onProfession: doProfession,
    onSaveState: () => saveNow(),
    onExternalState: applyExternalState,
    onTab: onTabSwitch,
  };
  UI.init();

  let user = null;
  try {
    const res = await api.me();
    user = res.user;
  } catch (e) {
    if (e.status !== 401) UI.toast('Could not reach the server.', 'error');
  }

  if (!user) {
    UI.showView('auth');
    Auth.init({ onAuthed: (u) => enterApp(u) });
  } else {
    enterApp(user);
  }
}

async function enterApp(user) {
  App.user = user;
  let raw, lastSeenAt;
  try {
    const res = await api.getState();
    raw = res.state; lastSeenAt = res.lastSeenAt;
  } catch (e) {
    UI.showView('auth');
    Auth.init({ onAuthed: (u) => enterApp(u) });
    UI.toast('Session expired — please log in again.', 'error');
    return;
  }

  let state = Engine.ensureState(raw);

  // First run: no race chosen yet.
  if (!state.race) {
    UI.showView('race');
    UI.renderRaceSelect(async (race) => {
      App.state = Engine.defaultState(race);
      try { await api.saveState(App.state); } catch { /* offline-tolerant */ }
      startGame();
    });
    return;
  }

  App.state = state;
  UI.showView('app');

  // Offline earnings (lastSeenAt null on brand-new accounts).
  if (lastSeenAt) {
    const off = Engine.offlineEarnings(state, lastSeenAt, Date.now());
    if (off && (off.gold > 0 || off.xp > 0)) {
      state.gold += off.gold;
      const xpRes = Engine.gainXp(state, off.xp);
      await saveNow();
      UI.offlineModal({ ...off, gains_xp: xpRes.gained }, xpRes.levels);
      // Well-rested: +25% XP for 30 minutes after returning.
      state.restedUntil = Date.now() + 30 * 60 * 1000;
      await saveNow();
    }
  }

  startGame();
}

function startGame() {
  if (App.started) return;
  App.started = true;
  UI.showView('app');
  spawnEnemy();
  UI.renderBattle(App.state);
  UI.renderGear(App.state);
  UI.renderParty(App.state);
  UI.renderMore(App.state, App.user);
  UI.updateHUD(App.state, App.user);
  UI.showTab('battle');

  App.tickTimer = setInterval(tick, TICK_MS);
  App.saveTimer = setInterval(() => saveNow(), AUTOSAVE_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow(true);
  });
  window.addEventListener('beforeunload', () => {
    if (App.state) api.saveStateBeacon(App.state);
  });
  window.addEventListener('pagehide', () => {
    if (App.state) api.saveStateBeacon(App.state);
  });
}

// ---------------- saving ----------------
let _saving = false;
async function saveNow(beaconOnly = false) {
  if (!App.state || _saving) return;
  if (beaconOnly) { api.saveStateBeacon(App.state); return; }
  _saving = true;
  UI.setSaveIndicator('… saving');
  try {
    await api.saveState(App.state);
    UI.setSaveIndicator('● saved');
  } catch (e) {
    UI.setSaveIndicator('● save failed', false);
  } finally {
    _saving = false;
  }
}

// ---------------- combat ----------------
function spawnEnemy() {
  const s = App.state;
  App.enemy = Engine.enemyFor(s.stage);
  App.enemyTimer = 0;
  App.heroTimer = 0;
  App.companionTimers = {};
  // revive downed companions on a fresh enemy
  for (const c of s.party) if (c.hp <= 0) c.hp = c.maxHp;
  UI.setEnemy(App.enemy);
  // zone change toast
  const zone = Engine.zoneFor(s.stage);
  if (App.lastZone && App.lastZone !== zone.name) {
    UI.toast(`${zone.emoji} Entered ${zone.name}`, 'info');
  }
  App.lastZone = zone.name;
  UI.updateHeroPanel(s, Engine.computeStats(s), App);
  if (App.enemy.boss && App.lastBossModalStage !== s.stage) {
    App.lastBossModalStage = s.stage;
    UI.bossModal(App.enemy);
  }
}

function heroStrike(stats, mult = 1) {
  const { dmg, crit } = Engine.playerAttack(stats, App.enemy);
  const final = Math.max(1, Math.round(dmg * mult));
  damageEnemy(final, crit ? 'CRIT ' : '', 'hero');
  // lifesteal
  if (stats.lifesteal > 0 && !App.dead) {
    const heal = final * (stats.lifesteal / 100);
    const s = App.state;
    s.hero.hp = Math.min(stats.maxHp, s.hero.hp + heal);
  }
}

function companionStrike(c) {
  const cs = Engine.companionStats(c);
  const { dmg, crit } = Engine.playerAttack(cs, App.enemy);
  damageEnemy(dmg, crit, c.emoji + ' ');
}

function damageEnemy(dmg, prefix, sourceLabel) {
  const enemy = App.enemy;
  if (!enemy || App.dead) return;
  enemy.hp -= dmg;
  const isCrit = String(prefix).includes('CRIT');
  UI.floatText(`${prefix}${formatNum(dmg)}`, isCrit ? 'crit' : 'dmg');
  if (enemy.hp <= 0) onKillEnemy();
}

function onKillEnemy() {
  const s = App.state;
  const enemy = App.enemy;
  const stage = enemy.stage;
  const stats = Engine.computeStats(s);

  const gold = Engine.goldForKill(stage, stats.goldBonus + (stats.talentGoldPct || 0), s.prestigeBonus);
  s.gold += gold;
  s.stats.kills += 1;
  if (enemy.boss) {
    s.bossesKilled += 1;
    s.stars += 1; // bosses grant a star
    UI.combatLog(`👹 Boss slain! +${formatNum(gold)} gold, +1 ⭐`, 'boss');
    UI.toast(`Boss slain! +${formatNum(gold)} gold, +1 ⭐`, 'success');
  }
  const xpRes = Engine.gainXp(s, Engine.xpForKill(stage));
  const loot = Engine.rollLoot(stage, enemy.boss);
  if (loot) {
    s.inventory.push(loot);
    UI.toast(`🎒 Loot: ${loot.name}`, 'loot');
    UI.combatLog(`🎒 Looted ${loot.name} (${loot.rarity})`, 'loot');
    if (UI.activeTab === 'gear') UI.renderGear(s);
  }
  if (xpRes.levels.length) {
    UI.levelUpModal(xpRes.levels);
    UI.combatLog(`⬆️ Level ${xpRes.levels[xpRes.levels.length - 1]}!`, 'level');
    const mp = xpRes.levels.filter(l => l % 10 === 0).length;
    if (mp > 0) {
      UI.toast(`🧠 +${mp} Mastery point${mp > 1 ? 's' : ''}! Spend in More → Mastery.`, 'success');
      if (UI.activeTab === 'more') UI.renderMore(s, App.user);
    }
  }
  checkAch();

  s.stage += 1;
  spawnEnemy();
  UI.updateHUD(s, App.user);
  // prestige unlock may have appeared
  if (s.stage >= 50) UI.renderBattle(s);
}

function enemyStrikeTick(stats) {
  const s = App.state;
  const enemy = App.enemy;
  // pick target: hero, or random alive fighter in dungeon mode
  let target = { kind: 'hero' };
  if (s.mode === 'dungeon') {
    const alive = s.party.filter(c => c.hp > 0);
    const pool = ['hero', ...alive.map(c => c.id)];
    const pickId = pool[Math.floor(Math.random() * pool.length)];
    target = pickId === 'hero' ? { kind: 'hero' } : { kind: 'comp', c: s.party.find(c => c.id === pickId) };
  }
  const tStats = target.kind === 'hero' ? stats : Engine.companionStats(target.c);
  const res = Engine.enemyStrike(tStats, enemy.attack);
  const tName = target.kind === 'hero' ? 'You' : target.c.name;

  if (res.dodged) {
    UI.floatText('DODGE', 'dodge');
    return;
  }
  if (res.parried) {
    UI.floatText('PARRY', 'parry');
    UI.combatLog(`🛡️ ${tName} parried and countered!`);
    damageEnemy(res.counter, '', 'counter');
    return;
  }
  if (res.dmg <= 0) return;
  if (target.kind === 'hero') {
    s.hero.hp -= res.dmg;
    UI.floatText(`-${formatNum(res.dmg)}`, 'hurt');
    if (s.hero.hp <= 0) { s.hero.hp = 0; onDefeat(); }
  } else {
    target.c.hp -= res.dmg;
    UI.combatLog(`💔 ${target.c.name} took ${formatNum(res.dmg)}.`);
    if (target.c.hp <= 0) {
      target.c.hp = 0;
      UI.toast(`${target.c.emoji} ${target.c.name} is down!`, 'error');
    }
  }
}

function onDefeat() {
  const s = App.state;
  App.dead = true;
  App.respawnAt = Date.now() + RESPAWN_MS;
  const lost = Math.floor(s.gold * 0.02);
  s.gold -= lost;
  // Mercy rule: dying 3x in a row to the same boss retreats you 5 stages,
  // so a wall becomes a farming trip instead of an endless death loop.
  if (App.enemy && App.enemy.boss) {
    if (App.lastDeathStage === s.stage) App.deathStreak += 1;
    else { App.lastDeathStage = s.stage; App.deathStreak = 1; }
    if (App.deathStreak >= 3) {
      App.deathStreak = 0;
      s.stage = Math.max(1, s.stage - 5);
      UI.toast(`💨 Overwhelmed! You retreat to stage ${s.stage} to grow stronger.`, 'info');
      UI.combatLog(`💨 Overwhelmed by the boss — retreated to stage ${s.stage}.`, 'death');
      saveNow();
    }
  } else {
    App.deathStreak = 0;
  }
  UI.setDead(true);
  UI.combatLog(`💀 You fell! Lost ${formatNum(lost)} gold. Reviving…`, 'death');
  UI.toast(`You fell! −${formatNum(lost)} gold. Reviving…`, 'error');
}

function respawn() {
  const s = App.state;
  const stats = Engine.computeStats(s);
  App.dead = false;
  s.hero.hp = stats.maxHp;
  for (const c of s.party) c.hp = c.maxHp;
  UI.setDead(false);
  spawnEnemy();
  UI.updateHUD(s, App.user);
}

// ---------------- main tick ----------------
function tick() {
  const s = App.state;
  if (!s || !App.enemy) return;
  const dt = TICK_MS / 1000;
  s.stats.playTimeSec += dt;

  if (App.dead) {
    if (Date.now() >= App.respawnAt) respawn();
    return;
  }

  const stats = Engine.computeStats(s);

  // regen
  if (stats.regen > 0 && s.hero.hp < stats.maxHp) {
    s.hero.hp = Math.min(stats.maxHp, s.hero.hp + stats.regen * dt);
  }
  for (const c of s.party) {
    if (c.hp > 0 && c.hp < c.maxHp && c.regen > 0) c.hp = Math.min(c.maxHp, c.hp + c.regen * dt);
  }

  // hero attacks: full rate in auto/dungeon, 35% idle rate in clicker mode
  // (taps remain the main damage there, boosted by combo + frenzy).
  {
    App.heroTimer += dt * (s.mode === 'clicker' ? 0.35 : 1);
    const iv = 1 / Math.max(0.2, stats.attackSpeed);
    let guard = 0;
    while (App.heroTimer >= iv && guard++ < 10) {
      App.heroTimer -= iv;
      heroStrike(stats);
      if (App.dead || !App.enemy) break;
    }
  }

  // companions attack in dungeon mode
  if (s.mode === 'dungeon') {
    for (const c of s.party) {
      if (c.hp <= 0 || App.dead) continue;
      App.companionTimers[c.id] = (App.companionTimers[c.id] || 0) + dt;
      const iv = 1 / 1.2;
      let guard = 0;
      while (App.companionTimers[c.id] >= iv && guard++ < 10) {
        App.companionTimers[c.id] -= iv;
        companionStrike(c);
        if (App.dead || !App.enemy) break;
      }
    }
  }

  // enemy counter-attacks
  App.enemyTimer += dt;
  if (App.enemyTimer >= ENEMY_ATTACK_S) {
    App.enemyTimer = 0;
    if (!App.dead) enemyStrikeTick(stats);
  }

  UI.updateBattle(s, stats, { enemy: App.enemy, user: App.user, skillReadyAt: App.skillReadyAt });
  // keep chips / hero panel fresh at low frequency
  if (!tick._n) tick._n = 0;
  if (++tick._n % 8 === 0) UI.updateHeroPanel(s, stats, App);
}

// ---------------- player actions ----------------
function doTap() {
  const s = App.state;
  if (!s || App.dead || s.mode !== 'clicker') return;
  const now = Date.now();
  // Combo: taps within the combo window keep it alive.
  if (now - App.lastTapAt < Engine.COMBO_WINDOW_MS) App.tapCombo += 1;
  else App.tapCombo = 1;
  App.lastTapAt = now;
  if (App.tapCombo > (s.stats.maxCombo || 0)) s.stats.maxCombo = App.tapCombo;
  if (App.tapCombo === Engine.FRENZY_COMBO) {
    App.frenzyUntil = now + Engine.FRENZY_MS;
    UI.toast('⚡ FRENZY! Double tap damage for 10s!', 'success');
  }
  const frenzy = now < App.frenzyUntil;
  s.stats.taps += 1;
  heroStrike(Engine.computeStats(s), Engine.tapDamageMult(s, App.tapCombo, frenzy));
  UI.updateCombo(App.tapCombo, frenzy, App.frenzyUntil - now);
  checkAch();
}

// Unlock check helper: toasts + logs newly earned achievements.
function checkAch() {
  const s = App.state;
  if (!s) return;
  const fresh = Engine.checkAchievements(s);
  for (const a of fresh) {
    UI.toast(`🏆 ${a.name}! +${a.stars} ⭐`, 'success');
    UI.combatLog(`🏆 Achievement: ${a.name} (+${a.stars} ⭐)`, 'level');
  }
  if (fresh.length) {
    if (UI.activeTab === 'more') UI.renderMore(s, App.user);
    UI.updateHUD(s, App.user);
    saveNow();
  }
}

function usePowerStrike() {
  const s = App.state;
  if (!s || App.dead || !s.skills.includes('power-strike')) return;
  const now = Date.now();
  if (now < App.skillReadyAt) return;
  App.skillReadyAt = now + SKILL_CD_MS;
  s.stats.taps += 1;
  UI.floatText('POWER STRIKE', 'skill');
  heroStrike(Engine.computeStats(s), SKILL_MULT);
}

function setMode(mode) {
  const s = App.state;
  if (!s || s.mode === mode) { UI.setMode(mode); return; }
  s.mode = mode;
  App.heroTimer = 0;
  App.companionTimers = {};
  UI.setMode(mode);
  UI.renderBattle(s);
  UI.updateHeroPanel(s, Engine.computeStats(s), App);
  UI.toast({ clicker: '👆 Clicker mode — tap to attack!', auto: '🤖 Auto mode — your hero fights alone.', dungeon: '🏰 Dungeon mode — party fights with you!' }[mode] || mode);
  saveNow();
}

function doEquip(id) {
  const s = App.state;
  if (Engine.equipItem(s, id)) {
    UI.renderGear(s);
    UI.toast('Equipped.', 'success');
    saveNow();
  }
}

function doSell(id) {
  const s = App.state;
  const item = s.inventory.find(i => i.id === id);
  if (!item) return;
  const gold = Engine.sellItem(s, id);
  if (gold > 0) {
    UI.toast(`Sold ${item.name} for 💰${formatNum(gold)}.`, 'success');
    UI.renderGear(s);
    UI.updateHUD(s, App.user);
    saveNow();
  }
}

function doUpgrade(kind) {
  const s = App.state;
  const lvl = (s.upgrades && s.upgrades[kind]) || 1;
  const cost = Engine.upgradeCost(kind, lvl);
  if (s.gold < cost) { UI.toast('Not enough gold.', 'error'); return; }
  s.gold -= cost;
  s.upgrades[kind] = lvl + 1;
  UI.renderGear(s);
  UI.updateHUD(s, App.user);
  UI.toast(`${Engine.UPGRADE_INFO[kind].name} → Lv ${lvl + 1}!`, 'success');
  saveNow();
}

function doTalent(id) {
  const s = App.state;
  if (!s) return;
  if (Engine.spendTalent(s, id)) {
    UI.renderMore(s, App.user);
    UI.updateHUD(s, App.user);
    UI.toast(`🧠 ${Engine.TALENTS[id].name} ranked up!`, 'success');
    saveNow();
  } else {
    UI.toast('Need a Mastery point — earn 1 per 10 levels.', 'error');
  }
}

function doProfession(id) {
  const s = App.state;
  if (!s) return;
  const cost = Engine.levelProfession(s, id);
  if (cost == null) { UI.toast('Max level reached.', 'error'); return; }
  if (s.gold < cost) { UI.toast('Not enough gold.', 'error'); return; }
  s.gold -= cost;
  s.professions[id] = ((s.professions && s.professions[id]) || 1) + 1;
  UI.renderMore(s, App.user);
  UI.updateHUD(s, App.user);
  UI.toast(`${Engine.PROFESSIONS[id].emoji} ${Engine.PROFESSIONS[id].name} → Lv ${s.professions[id]}!`, 'success');
  saveNow();
}

function doRecruit(recruitId) {
  const s = App.state;
  const r = Engine.RECRUITS.find(x => x.id === recruitId);
  if (!r) return;
  if (s.party.length >= Engine.MAX_PARTY) { UI.toast('Party is full (3).', 'error'); return; }
  if (s.party.some(c => c.name === r.name)) { UI.toast('Already recruited.', 'error'); return; }
  if (s.gold < r.cost) { UI.toast('Not enough gold.', 'error'); return; }
  s.gold -= r.cost;
  const c = Engine.makeCompanion(r, s.level);
  s.party.push(c);
  UI.renderParty(s);
  UI.updateHUD(s, App.user);
  UI.toast(`${r.emoji} ${r.name} joined your party!`, 'success');
  saveNow();
}

function doDismiss(id) {
  const s = App.state;
  const idx = s.party.findIndex(c => c.id === id);
  if (idx < 0) return;
  const [c] = s.party.splice(idx, 1);
  delete App.companionTimers[id];
  UI.renderParty(s);
  UI.toast(`${c.name} left the party.`, 'info');
  saveNow();
}

// A GM grant targeted this session's player: swap in the updated saved state
// and refresh every view so the grant is visible immediately.
function applyExternalState(srv) {
  if (!srv) return;
  App.state = Engine.ensureState(srv);
  const s = App.state;
  UI.updateHUD(s, App.user);
  UI.renderBattle(s);
  UI.renderGear(s);
  UI.renderParty(s);
  if (UI.activeTab === 'more') UI.renderMore(s, App.user);
  if (App.enemy) UI.setEnemy(App.enemy);
  UI.updateHeroPanel(s, Engine.computeStats(s), App);
  saveNow();
}

async function doPrestige() {
  const s = App.state;
  if (s.stage < 50) return;
  const nextBonus = (s.prestigeBonus || 0) + 25;
  const ok = await UI.confirm(
    '🔥 Prestige?',
    `<p>Reset to <b>level 1, stage 1</b> with no gold and no regular gear.</p>
     <p><b class="gold-text">+25% damage & gold</b> (→ +${nextBonus}% total).</p>
     <p class="muted">Kept: 👑 privileged gear sets, ⭐ stars, lifetime stats, race.</p>`,
    'Prestige!'
  );
  if (!ok) return;
  const fresh = Engine.prestige(s);
  if (!fresh) return;
  App.state = fresh;
  App.dead = false;
  UI.setDead(false);
  spawnEnemy();
  UI.renderBattle(fresh);
  UI.renderGear(fresh);
  UI.renderParty(fresh);
  UI.renderMore(fresh, App.user);
  UI.updateHUD(fresh, App.user);
  UI.toast(`🔥 Prestiged! +25% damage & gold (total +${fresh.prestigeBonus}%).`, 'success');
  checkAch();
  saveNow();
}

async function doRedeem() {
  const input = document.getElementById('redeem-input');
  const code = (input.value || '').trim().toUpperCase();
  if (!code) { UI.toast('Enter a gift code.', 'error'); return; }
  try {
    const res = await api.redeem(code);
    // Server merged the set into saved state; save local progress first, then pull inventory.
    await saveNow();
    const { state: srv } = await api.getState();
    const fresh = Engine.ensureState(srv);
    // keep local live progress, take the server-merged inventory + redemptions
    App.state.inventory = fresh.inventory;
    App.state.codesRedeemed = fresh.codesRedeemed;
    input.value = '';
    UI.renderGear(App.state);
    UI.renderMore(App.state, App.user);
    UI.toast(`🎁 Redeemed! ${res.set ? '(' + res.set + ' set added)' : ''}`, 'success');
    saveNow();
  } catch (e) {
    UI.toast(e.message || 'Redeem failed.', 'error');
  }
}

async function doLogout() {
  const ok = await UI.confirm('Logout?', '<p>Your progress is saved. See you soon, hero.</p>', 'Logout');
  if (!ok) return;
  try { await saveNow(); } catch { /* ignore */ }
  try { await api.logout(); } catch { /* ignore */ }
  location.reload();
}

// ---------------- tab switching ----------------
async function onTabSwitch(tab, force = false) {
  const s = App.state;
  if (!s) return;
  if (tab === 'gear') UI.renderGear(s);
  else if (tab === 'party') UI.renderParty(s);
  else if (tab === 'more') UI.renderMore(s, App.user);
  else if (tab === 'battle') {
    UI.renderBattle(s);
    if (App.enemy) UI.setEnemy(App.enemy);
  } else if (tab === 'ranks') {
    await loadRanks();
  }
  void force;
}

async function loadRanks() {
  try {
    const { entries } = await api.leaderboard();
    UI.renderRanks(entries || [], App.user ? App.user.username : null);
  } catch (e) {
    UI.toast('Could not load leaderboard.', 'error');
  }
}

// ---------------- go ----------------
document.addEventListener('DOMContentLoaded', boot);
