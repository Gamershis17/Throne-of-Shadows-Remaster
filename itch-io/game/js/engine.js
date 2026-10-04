// ============================================================
// engine.js — pure game logic for King of Project.
// No DOM access. Safe to unit-test in Node.
// Follows ~/workspace/rpg-server/API_CONTRACT.md exactly.
// ============================================================

// ---------------- Races ----------------
export const RACES = {
  human:     { name: 'Human Vanguard', emoji: '🛡️', trait: 'Balanced: +10% XP gain',
               xpMult: 1.10 },
  orc:       { name: 'Orc Warborn',    emoji: '🪓', trait: '+20% attack, −5% dodge',
               atkMult: 1.20, dodgeMod: -5 },
  celestial: { name: 'Celestial',      emoji: '✨', trait: '+15% max HP, +2 HP/s regen',
               hpMult: 1.15, regenBonus: 2 },
  dragonkin: { name: 'Dragonkin',      emoji: '🐉', trait: '+25% crit damage',
               critDmgBonus: 25 },
  fae:       { name: 'Fae Vanguard',   emoji: '🧚', trait: '+10% dodge, +10% attack speed',
               dodgeBonus: 10, atkSpdMult: 1.10 },
  revenant:  { name: 'Revenant',       emoji: '💀', trait: '+5% lifesteal, +5% parry',
               lifestealBonus: 5, parryBonus: 5 },
};

// ---------------- Rarity / slots / stats ----------------
export const RARITIES = [
  { id: 'common',    weight: 50,  color: '#9aa0a6', stats: 1, mult: 1,   prefix: 'Iron' },
  { id: 'magic',     weight: 25,  color: '#4da3ff', stats: 2, mult: 1.6, prefix: 'Runed' },
  { id: 'rare',      weight: 13,  color: '#ffd23f', stats: 2, mult: 2.5, prefix: 'Gilded' },
  { id: 'epic',      weight: 7,   color: '#b366ff', stats: 3, mult: 4,   prefix: 'Arcane' },
  { id: 'legendary', weight: 3.5, color: '#ff8c1a', stats: 3, mult: 6.5, prefix: 'Mythril' },
  { id: 'mythic',    weight: 1.5, color: '#ff3b3b', stats: 4, mult: 10,  prefix: 'Eternal' },
];
export const RARITY_BY_ID = Object.fromEntries(RARITIES.map(r => [r.id, r]));
export const RARITY_IDX = Object.fromEntries(RARITIES.map((r, i) => [r.id, i]));

export const SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'trinket'];
export const SLOT_INFO = {
  weapon:  { name: 'Weapon',  emoji: '⚔️' },
  armor:   { name: 'Armor',   emoji: '🛡️' },
  helmet:  { name: 'Helmet',  emoji: '⛑️' },
  boots:   { name: 'Boots',   emoji: '🥾' },
  trinket: { name: 'Trinket', emoji: '📿' },
};

export const STAT_LABELS = {
  attack: 'Attack', defense: 'Defense', maxHp: 'Max HP',
  critChance: 'Crit %', critDamage: 'Crit Dmg %',
  parry: 'Parry %', dodge: 'Dodge %', lifesteal: 'Lifesteal %',
  attackSpeed: 'Atk Speed', regen: 'Regen/s',
  goldBonus: 'Gold %', xpBonus: 'XP %',
};

// ---------------- Small utils ----------------
let _uidCounter = 0;
export function uid() {
  return 'i' + Date.now().toString(36) + (_uidCounter++).toString(36) +
    Math.floor(Math.random() * 1e6).toString(36);
}
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function round1(v) { return Math.round(v * 10) / 10; }
export function round2(v) { return Math.round(v * 100) / 100; }

// ---------------- State ----------------
export function defaultState(race) {
  return {
    race: race || null,
    mode: 'clicker',
    level: 1, xp: 0, xpNext: xpForLevel(1),
    gold: 0, stars: 0,
    stage: 1, bossesKilled: 0,
    prestigeCount: 0, prestigeBonus: 0,
    hero: {
      hp: 100, maxHp: 100, attack: 10, defense: 2,
      critChance: 5, critDamage: 150, parry: 0, dodge: 5,
      lifesteal: 0, attackSpeed: 1.0, regen: 0,
    },
    party: [],
    inventory: [],
    equipped: { weapon: null, armor: null, helmet: null, boots: null, trinket: null },
    upgrades: { weapon: 1, armor: 1, skill: 1, tap: 1 },
    skills: ['power-strike'],
    companions: [],
    codesRedeemed: [],
    stats: { taps: 0, kills: 0, playTimeSec: 0, maxCombo: 0 },
    mastery: { points: 0, spent: { might: 0, vitality: 0, fortune: 0 } },
    professions: { herbalism: 1, smithing: 1 },
    achievements: [],
    restedUntil: 0,
  };
}

// Merge a server blob with defaults so old/missing fields never crash the client.
export function ensureState(raw) {
  const d = defaultState('human');
  if (!raw || typeof raw !== 'object') { d.race = null; return d; }
  const s = { ...d, ...raw };
  if (!raw.race) s.race = null; // first run -> race select
  s.hero = { ...d.hero, ...(raw.hero || {}) };
  s.equipped = { ...d.equipped, ...(raw.equipped || {}) };
  s.upgrades = { ...d.upgrades, ...(raw.upgrades || {}) };
  s.stats = { ...d.stats, ...(raw.stats || {}) };
  s.mastery = { points: 0, spent: {}, ...(raw.mastery || {}) };
  s.mastery.spent = { might: 0, vitality: 0, fortune: 0, ...(s.mastery.spent || {}) };
  s.mastery.points = Math.max(0, Math.floor(s.mastery.points || 0));
  s.professions = { herbalism: 1, smithing: 1, ...(raw.professions || {}) };
  if (!Array.isArray(s.achievements)) s.achievements = [];
  s.restedUntil = Number(raw.restedUntil) || 0;
  if (!Array.isArray(s.party)) s.party = [];
  if (!Array.isArray(s.inventory)) s.inventory = [];
  if (!Array.isArray(s.skills) || !s.skills.length) s.skills = ['power-strike'];
  if (!Array.isArray(s.codesRedeemed)) s.codesRedeemed = [];
  if (!Array.isArray(s.companions)) s.companions = [];
  if (!['clicker', 'auto', 'dungeon'].includes(s.mode)) s.mode = 'clicker';
  s.level = Math.max(1, Math.floor(s.level || 1));
  s.stage = Math.max(1, Math.floor(s.stage || 1));
  s.xpNext = xpForLevel(s.level);
  s.hero.hp = clamp(s.hero.hp, 0, s.hero.maxHp);
  for (const c of s.party) c.hp = clamp(c.hp, 0, c.maxHp);
  return s;
}

// ---------------- XP / levels / gold ----------------
export const xpForLevel = (level) => Math.max(1, Math.round(80 * Math.pow(1.30, level - 1)));
export const xpForKill = (stage) => Math.max(1, Math.round(10 * Math.pow(1.15, stage)));
export function goldForKill(stage, goldBonusPct = 0, prestigeBonusPct = 0) {
  return Math.max(1, Math.round(
    6 * Math.pow(1.12, stage) *
    (1 + goldBonusPct / 100) * (1 + prestigeBonusPct / 100)
  ));
}

// Adds XP (applying race + gear + rested multipliers), handles level-ups.
// Level-up: +3 attack, +25 maxHp, +2 defense; heals 25% max HP.
// Every 10th level also grants a Mastery point.
export function gainXp(state, baseAmount, nowMs = Date.now()) {
  const race = RACES[state.race] || {};
  const stats = computeStats(state);
  const rested = state.restedUntil && nowMs < state.restedUntil;
  const amount = Math.max(1, Math.round(
    baseAmount * (race.xpMult || 1) * (1 + (stats.xpBonus || 0) / 100) * (rested ? 1.25 : 1)
  ));
  state.xp += amount;
  const levels = [];
  let guard = 0;
  while (state.xp >= state.xpNext && guard++ < 10000) {
    state.xp -= state.xpNext;
    state.level += 1;
    state.hero.attack += 3;
    state.hero.maxHp += 25;
    state.hero.defense += 2;
    state.xpNext = xpForLevel(state.level);
    levels.push(state.level);
    if (state.level % 10 === 0 && state.mastery) state.mastery.points += 1;
  }
  if (levels.length) {
    const s2 = computeStats(state);
    state.hero.hp = Math.min(s2.maxHp, state.hero.hp + s2.maxHp * 0.25);
  }
  return { gained: amount, levels };
}

// ---------------- Enemies ----------------
const ENEMY_NAMES = [
  'Gloomfang Wolf', 'Moss Troll', 'Cave Stalker', 'Ember Imp',
  'Stone Sentinel', 'Plague Rat', 'Dark Acolyte', 'Ridgeback Boar',
  'Frost Wisp', 'Sand Reaver', 'Bone Archer', 'Crimson Slime',
  'Grave Hound', 'Thorn Lurker', 'Ash Serpent', 'Mire Shambler',
  'Hollow Bat', 'Rune Scarab', 'Dusk Panther', 'Cinder Sprite',
];
const BOSS_NAMES = [
  'Warlord Ghash', 'The Hollow King', 'Broodmother Xix',
  'Ancient Wyrm Vex', 'Dreadlord Malachar', 'The Starless One',
];
const ENEMY_EMOJI = ['🐺', '👺', '🦇', '🕷️', '🐗', '💀', '🧌', '🐍', '🦂', '👻'];

export const isBossStage = (stage) => stage % 10 === 0;

export function enemyFor(stage) {
  const boss = isBossStage(stage);
  const hp = Math.round(18 * Math.pow(1.13, stage));
  const atk = Math.round(4 * Math.pow(1.085, stage));
  return {
    name: boss ? pick(BOSS_NAMES) : pick(ENEMY_NAMES),
    stage, boss,
    hp: boss ? Math.round(hp * 2.5) : hp,
    maxHp: boss ? Math.round(hp * 2.5) : hp,
    attack: boss ? Math.round(atk * 1.35) : atk,
    emoji: boss ? '👹' : pick(ENEMY_EMOJI),
  };
}

// ---------------- Combat ----------------
// Effective hero stats = base + level gains + equipped gear,
// x race traits x upgrade multipliers x prestige x full-set bonus.
export function computeStats(state) {
  const race = RACES[state.race] || {};
  const gear = {};
  for (const k of Object.keys(STAT_LABELS)) gear[k] = 0;
  for (const slot of SLOTS) {
    const id = state.equipped && state.equipped[slot];
    if (!id) continue;
    const item = (state.inventory || []).find(i => i.id === id);
    if (!item || item.slot !== slot || !item.stats) continue;
    for (const [k, v] of Object.entries(item.stats)) {
      if (k in gear && Number.isFinite(v)) gear[k] += v;
    }
  }
  const setInfo = equippedSetInfo(state);
  const setMult = 1 + (setInfo ? setInfo.pct : 0) / 100;
  // Mastery talents + professions (original systems, WoW-inspired).
  const tal = (state.mastery && state.mastery.spent) || {};
  const mightMult = 1 + 0.04 * (tal.might || 0);
  const vitMult = 1 + 0.04 * (tal.vitality || 0);
  const prof = state.professions || {};
  const smithMult = 1 + 0.015 * (prof.smithing || 1);
  const herbRegen = 0.5 * (prof.herbalism || 1);
  const prestDmgMult = 1 + (state.prestigeBonus || 0) / 100; // damage & gold only
  const up = state.upgrades || { weapon: 1, armor: 1, skill: 1 };
  const dmgUpMult = Math.pow(1.12, Math.max(0, up.weapon - 1)) *
                    Math.pow(1.12, Math.max(0, up.skill - 1));
  const defUpMult = Math.pow(1.12, Math.max(0, up.armor - 1));
  const h = state.hero;
  return {
    attack: Math.max(1, (h.attack + gear.attack) * (race.atkMult || 1) * prestDmgMult * setMult * dmgUpMult * mightMult * smithMult),
    defense: Math.max(0, (h.defense + gear.defense) * defUpMult * setMult),
    maxHp: Math.max(1, Math.round((h.maxHp + gear.maxHp) * (race.hpMult || 1) * setMult * vitMult)),
    critChance: clamp(h.critChance + gear.critChance, 0, 100),
    critDamage: Math.max(100, h.critDamage + gear.critDamage + (race.critDmgBonus || 0)),
    parry: clamp(h.parry + gear.parry + (race.parryBonus || 0), 0, 60),
    dodge: clamp(h.dodge + gear.dodge + (race.dodgeBonus || 0) + (race.dodgeMod || 0), 0, 75),
    lifesteal: Math.max(0, h.lifesteal + gear.lifesteal + (race.lifestealBonus || 0)),
    attackSpeed: clamp((h.attackSpeed + gear.attackSpeed) * (race.atkSpdMult || 1), 0.2, 5),
    regen: Math.max(0, h.regen + gear.regen + (race.regenBonus || 0) + herbRegen),
    goldBonus: gear.goldBonus,
    xpBonus: gear.xpBonus,
    talentGoldPct: 4 * (tal.fortune || 0),
    setInfo,
  };
}

// Hero (or companion) attacks the enemy. Returns {dmg, crit}.
export function playerAttack(stats, enemy) {
  const crit = Math.random() * 100 < stats.critChance;
  const raw = stats.attack * (crit ? stats.critDamage / 100 : 1);
  return { dmg: Math.max(1, Math.round(raw)), crit };
}

// Enemy strikes a defender with `stats`. Returns {dmg, dodged, parried, counter}.
export function enemyStrike(stats, enemyAttack) {
  const r = Math.random() * 100;
  if (r < stats.dodge) return { dmg: 0, dodged: true, parried: false, counter: 0 };
  if (r < stats.dodge + stats.parry) {
    return { dmg: 0, dodged: false, parried: true, counter: Math.max(1, Math.round(stats.attack * 0.5)) };
  }
  return { dmg: Math.max(1, Math.round(enemyAttack - stats.defense)), dodged: false, parried: false, counter: 0 };
}

// ---------------- Loot ----------------
export function rollRarity(minIdx = 0) {
  const pool = RARITIES.map((r, i) => ({ r, i })).filter(x => x.i >= minIdx);
  const total = pool.reduce((a, x) => a + x.r.weight, 0);
  let roll = Math.random() * total;
  for (const x of pool) { roll -= x.r.weight; if (roll <= 0) return x.r; }
  return pool[pool.length - 1].r;
}

const SLOT_NAMES = {
  weapon: ['Blade', 'Sword', 'Axe', 'Dagger'],
  armor: ['Plate', 'Mail', 'Carapace'],
  helmet: ['Helm', 'Crown', 'Hood'],
  boots: ['Boots', 'Greaves', 'Treads'],
  trinket: ['Charm', 'Idol', 'Sigil'],
};
const SUFFIX = {
  attack: 'of the Tiger', defense: 'of the Bear', maxHp: 'of the Ox',
  critChance: 'of the Falcon', critDamage: 'of Ruin', parry: 'of the Wall',
  dodge: 'of Shadows', lifesteal: 'of the Leech', attackSpeed: 'of Swiftness',
  regen: 'of Renewal', goldBonus: 'of Greed', xpBonus: 'of Wisdom',
};
const STAT_GEN = {
  attack:      (m, s) => Math.max(1, Math.round((2 + s * 0.9) * m)),
  defense:     (m, s) => Math.max(1, Math.round((1 + s * 0.55) * m)),
  maxHp:       (m, s) => Math.max(5, Math.round((12 + s * 5) * m)),
  critChance:  (m) => round1(1 + m * 0.9),
  critDamage:  (m) => Math.round(4 + m * 6),
  parry:       (m) => round1(0.5 + m * 0.7),
  dodge:       (m) => round1(0.5 + m * 0.8),
  lifesteal:   (m) => round1(0.5 + m * 0.6),
  attackSpeed: (m) => round2(0.04 + m * 0.03),
  regen:       (m, s) => round1((0.5 + s * 0.15) * m),
  goldBonus:   (m) => Math.round(2 + m * 4),
  xpBonus:     (m) => Math.round(2 + m * 4),
};
const SLOT_PRIMARY = { weapon: 'attack', armor: 'defense', helmet: 'maxHp', boots: 'dodge', trinket: 'lifesteal' };

// Returns an item or null. Bosses always drop (rare+ guaranteed).
export function rollLoot(stage, isBoss = false) {
  if (Math.random() > (isBoss ? 1 : 0.25)) return null;
  const rarity = rollRarity(isBoss ? 2 : 0);
  const slot = pick(SLOTS);
  const stats = {};
  const primary = SLOT_PRIMARY[slot];
  stats[primary] = STAT_GEN[primary](rarity.mult, stage);
  const pool = Object.keys(STAT_GEN).filter(k => k !== primary);
  for (let i = 1; i < rarity.stats && pool.length; i++) {
    const k = pick(pool);
    pool.splice(pool.indexOf(k), 1);
    stats[k] = STAT_GEN[k](rarity.mult, stage);
  }
  const rIdx = RARITY_IDX[rarity.id];
  let name = `${rarity.prefix} ${pick(SLOT_NAMES[slot])}`;
  if (rIdx >= 2 && SUFFIX[primary]) name += ` ${SUFFIX[primary]}`;
  return {
    id: uid(), name, slot, rarity: rarity.id,
    stats, set: null, setName: null,
    value: Math.max(1, Math.round((4 + stage * 1.5) * rarity.mult)),
    unsellable: false,
  };
}

export function equipItem(state, itemId) {
  const item = (state.inventory || []).find(i => i.id === itemId);
  if (!item) return false;
  state.equipped[item.slot] = itemId;
  return true;
}

// Sells an item, returns gold gained (0 if not found / unsellable).
export function sellItem(state, itemId) {
  const idx = (state.inventory || []).findIndex(i => i.id === itemId);
  if (idx < 0) return 0;
  const item = state.inventory[idx];
  if (item.unsellable) return 0;
  if (state.equipped[item.slot] === itemId) state.equipped[item.slot] = null;
  state.inventory.splice(idx, 1);
  const gold = Math.max(1, Math.round(item.value || 1));
  state.gold += gold;
  return gold;
}

// ---------------- Privileged gear sets ----------------
// Fixed stats, granted via gift codes / GM console / staff roster.
export const PRIVILEGED_SETS = {
  sovereign: {
    name: 'Sovereign Founder\'s Regalia', minRole: 'owner', setBonus: 100,
    pieces: {
      weapon:  { name: 'Sovereign Blade',  stats: { attack: 500, critDamage: 50 } },
      armor:   { name: 'Sovereign Aegis',  stats: { defense: 500, maxHp: 2000 } },
      helmet:  { name: 'Sovereign Crown',  stats: { critChance: 15, attack: 250 } },
      boots:   { name: 'Sovereign Greaves', stats: { dodge: 10, attackSpeed: 0.2, defense: 200 } },
      trinket: { name: 'Sovereign Sigil',  stats: { lifesteal: 5, regen: 20, xpBonus: 50 } },
    },
  },
  fateweaver: {
    name: 'Fateweaver Regalia', minRole: 'gm', setBonus: 60,
    pieces: {
      weapon:  { name: 'Fateweaver Edge',    stats: { attack: 300, critDamage: 30 } },
      armor:   { name: 'Fateweaver Shroud',  stats: { defense: 300, maxHp: 1200 } },
      helmet:  { name: 'Fateweaver Circlet', stats: { critChance: 9, attack: 150 } },
      boots:   { name: 'Fateweaver Steps',   stats: { dodge: 6, attackSpeed: 0.12, defense: 120 } },
      trinket: { name: 'Fateweaver Thread',  stats: { lifesteal: 3, regen: 12, xpBonus: 30 } },
    },
  },
  warden: {
    name: 'Admin Warden Arsenal', minRole: 'admin', setBonus: 35,
    pieces: {
      weapon:  { name: 'Warden Brand',   stats: { attack: 175, critDamage: 18 } },
      armor:   { name: 'Warden Bulwark', stats: { defense: 175, maxHp: 700 } },
      helmet:  { name: 'Warden Helm',    stats: { critChance: 5, attack: 90 } },
      boots:   { name: 'Warden Treads',  stats: { dodge: 4, attackSpeed: 0.07, defense: 70 } },
      trinket: { name: 'Warden Badge',   stats: { lifesteal: 2, regen: 7, xpBonus: 17 } },
    },
  },
};

export function makeSetItem(setId, slot) {
  const def = PRIVILEGED_SETS[setId];
  if (!def || !def.pieces[slot]) throw new Error('Unknown set/slot: ' + setId + '/' + slot);
  const piece = def.pieces[slot];
  return {
    id: uid(), name: piece.name, slot, rarity: 'mythic',
    stats: { ...piece.stats }, set: setId, setName: def.name,
    value: 0, unsellable: true,
  };
}

export function grantFullSet(state, setId) {
  const items = SLOTS.map(slot => makeSetItem(setId, slot));
  state.inventory.push(...items);
  return items;
}

// Full 5-piece match of one set -> {setId, name, pct} else null.
export function equippedSetInfo(state) {
  const counts = {};
  for (const slot of SLOTS) {
    const id = state.equipped && state.equipped[slot];
    if (!id) return null;
    const item = (state.inventory || []).find(i => i.id === id);
    if (!item || !item.set || item.slot !== slot) return null;
    counts[item.set] = (counts[item.set] || 0) + 1;
  }
  const setId = Object.keys(counts)[0];
  if (setId && counts[setId] === SLOTS.length) {
    const def = PRIVILEGED_SETS[setId];
    return { setId, name: def ? def.name : setId, pct: def ? def.setBonus : 0 };
  }
  return null;
}

// ---------------- Upgrades ----------------
export const UPGRADE_INFO = {
  weapon: { name: 'Weapon', emoji: '⚔️', desc: '+12% damage / level' },
  armor:  { name: 'Armor',  emoji: '🛡️', desc: '+12% defense / level' },
  skill:  { name: 'Skill',  emoji: '✨', desc: '+12% damage / level' },
  tap:    { name: 'Tap Power', emoji: '👆', desc: '+15% tap damage / level' },
};
export const upgradeCost = (kind, level) => Math.round(30 * Math.pow(1.7, Math.max(0, level - 1)));

// ---------------- Companions / Party ----------------
export const RECRUITS = [
  { id: 'gromm',  name: 'Gromm the Axe',    race: 'orc',       emoji: '🪓', cost: 50,   atk: 6,  def: 1, hp: 60,  dodge: 5,  crit: 5 },
  { id: 'lyra',   name: 'Lyra Swiftbow',    race: 'fae',       emoji: '🧚', cost: 150,  atk: 10, def: 1, hp: 70,  dodge: 15, crit: 10 },
  { id: 'anselm', name: 'Brother Anselm',   race: 'celestial', emoji: '✨', cost: 300,  atk: 12, def: 3, hp: 120, dodge: 5,  crit: 5, regen: 2 },
  { id: 'vex',    name: 'Vex Nightwhisper', race: 'revenant',  emoji: '💀', cost: 600,  atk: 18, def: 2, hp: 90,  dodge: 10, crit: 10 },
  { id: 'ember',  name: 'Ember Scaleborn',  race: 'dragonkin', emoji: '🐉', cost: 1200, atk: 26, def: 3, hp: 110, dodge: 5,  crit: 15 },
  { id: 'mira',   name: 'Mira Ironhold',    race: 'human',     emoji: '🛡️', cost: 2500, atk: 34, def: 5, hp: 160, dodge: 5,  crit: 10 },
];
export const MAX_PARTY = 3;

export function makeCompanion(recruit, playerLevel) {
  const L = Math.max(1, Math.floor(playerLevel || 1));
  const maxHp = recruit.hp + 15 * (L - 1);
  return {
    id: uid(), name: recruit.name, race: recruit.race, emoji: recruit.emoji,
    level: L,
    attack: recruit.atk + 2 * (L - 1),
    defense: recruit.def + Math.floor((L - 1) / 2),
    maxHp, hp: maxHp,
    dodge: recruit.dodge || 5, critChance: recruit.crit || 5,
    regen: recruit.regen || 0,
  };
}

// Lightweight combat stats view for a companion (dodge/parry/counter support).
export function companionStats(c) {
  return {
    attack: c.attack, defense: c.defense,
    critChance: c.critChance || 5, critDamage: 150,
    dodge: c.dodge || 5, parry: 0,
  };
}

// ---------------- Prestige ----------------
// Stage >= 50. Returns a FRESH state blob: level/stage/gold/inventory reset,
// privileged set items + stars + lifetime stats kept, prestigeBonus += 25%.
export function prestige(state) {
  if ((state.stage || 1) < 50) return null;
  const kept = (state.inventory || []).filter(i => i && i.set);
  const keptIds = new Set(kept.map(i => i.id));
  const equipped = {};
  for (const slot of SLOTS) {
    const id = state.equipped && state.equipped[slot];
    equipped[slot] = (id && keptIds.has(id)) ? id : null;
  }
  const fresh = defaultState(state.race);
  fresh.prestigeCount = (state.prestigeCount || 0) + 1;
  fresh.prestigeBonus = (state.prestigeBonus || 0) + 25;
  fresh.stars = state.stars || 0;
  fresh.stats = state.stats || fresh.stats;
  fresh.inventory = kept;
  fresh.equipped = equipped;
  fresh.codesRedeemed = state.codesRedeemed || [];
  fresh.mode = state.mode || 'clicker';
  return fresh;
}

// ---------------- Offline earnings ----------------
// Capped at 8h. Returns null when away < 1 minute.
export function offlineEarnings(state, lastSeenAt, nowMs) {
  const elapsedMs = nowMs - lastSeenAt;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60 * 1000) return null;
  const cappedMs = Math.min(elapsedMs, 8 * 3600 * 1000);
  const minutes = Math.floor(cappedMs / 60000);
  const kills = Math.max(1, Math.floor(minutes * 6)); // estimated kills/min
  const stats = computeStats(state);
  const gold = kills * goldForKill(state.stage, stats.goldBonus + (stats.talentGoldPct || 0), state.prestigeBonus);
  const xp = kills * xpForKill(state.stage); // gainXp applies race/gear mults
  return { minutes, kills, gold, xp, capped: elapsedMs > 8 * 3600 * 1000 };
}

// ---------------- Zones ----------------
// Original fantasy zones, one per 10 stages. Pure flavor — no licensed IP.
export const ZONES = [
  { name: 'Greenwood Vale', emoji: '🌲' },
  { name: 'Ember Wastes', emoji: '🔥' },
  { name: 'Frostfall Peaks', emoji: '❄️' },
  { name: 'The Sunken Hollow', emoji: '🌊' },
  { name: 'Ashen Badlands', emoji: '🌋' },
  { name: 'Stormcrag Highlands', emoji: '⛈️' },
  { name: 'The Whispering Deep', emoji: '🕳️' },
  { name: 'Crimson Expanse', emoji: '🩸' },
  { name: 'The Shattered Isles', emoji: '🏝️' },
  { name: 'The Eternal Throne', emoji: '👑' },
];
export const zoneFor = (stage) =>
  ZONES[Math.min(ZONES.length - 1, Math.max(0, Math.floor(((stage || 1) - 1) / 10)))];

// ---------------- Mastery talents ----------------
// Earned: 1 Mastery point per 10 levels. Each branch has 5 ranks, 1 point per rank.
export const TALENTS = {
  might:    { name: 'Might',    emoji: '⚔️', desc: '+4% attack per rank', max: 5 },
  vitality: { name: 'Vitality', emoji: '❤️', desc: '+4% max HP per rank', max: 5 },
  fortune:  { name: 'Fortune',  emoji: '💰', desc: '+4% gold per rank', max: 5 },
};
export function spendTalent(state, id) {
  const def = TALENTS[id];
  if (!def || !state.mastery) return false;
  const spent = state.mastery.spent[id] || 0;
  if (state.mastery.points < 1 || spent >= def.max) return false;
  state.mastery.points -= 1;
  state.mastery.spent[id] = spent + 1;
  return true;
}

// ---------------- Professions ----------------
// Leveled with gold; passive always-on bonuses. Generic fantasy crafts.
export const PROFESSIONS = {
  herbalism: { name: 'Herb Gathering', emoji: '🌿', desc: '+0.5 HP/s regen per level', max: 20 },
  smithing:  { name: 'Smithing', emoji: '⚒️', desc: '+1.5% attack per level', max: 20 },
};
export const professionCost = (level) =>
  Math.round(60 * Math.pow(2.1, Math.max(0, (level || 1) - 1)));
// Returns the gold cost to go from current level to next, or null if maxed.
export function levelProfession(state, id) {
  const def = PROFESSIONS[id];
  if (!def) return null;
  const lvl = (state.professions && state.professions[id]) || 1;
  if (lvl >= def.max) return null;
  return professionCost(lvl);
}

// ---------------- Achievements ----------------
// One-time feats that grant ⭐ stars when unlocked.
export const ACHIEVEMENTS = [
  { id: 'first-blood', name: 'First Blood', emoji: '🩸', desc: 'Defeat your first enemy.', stars: 5, check: (s) => (s.stats.kills || 0) >= 1 },
  { id: 'tap-100', name: 'Warming Up', emoji: '👆', desc: 'Tap 100 times.', stars: 5, check: (s) => (s.stats.taps || 0) >= 100 },
  { id: 'tap-5000', name: 'Tap Storm', emoji: '🌪️', desc: 'Tap 5,000 times.', stars: 15, check: (s) => (s.stats.taps || 0) >= 5000 },
  { id: 'combo-50', name: 'Unstoppable', emoji: '⚡', desc: 'Reach a 50-tap combo.', stars: 10, check: (s) => (s.stats.maxCombo || 0) >= 50 },
  { id: 'boss-1', name: 'Boss Slayer', emoji: '👹', desc: 'Defeat a boss.', stars: 10, check: (s) => (s.bossesKilled || 0) >= 1 },
  { id: 'boss-10', name: 'Boss Hunter', emoji: '🏹', desc: 'Defeat 10 bosses.', stars: 25, check: (s) => (s.bossesKilled || 0) >= 10 },
  { id: 'level-10', name: 'Rising Hero', emoji: '⬆️', desc: 'Reach level 10.', stars: 5, check: (s) => (s.level || 1) >= 10 },
  { id: 'level-50', name: 'Veteran', emoji: '🎖️', desc: 'Reach level 50.', stars: 20, check: (s) => (s.level || 1) >= 50 },
  { id: 'rich-1', name: 'Gold Hoarder', emoji: '💰', desc: 'Hold 10,000 gold at once.', stars: 10, check: (s) => (s.gold || 0) >= 10000 },
  { id: 'collector', name: 'Collector', emoji: '🎒', desc: 'Hold 25 items at once.', stars: 10, check: (s) => (s.inventory || []).length >= 25 },
  { id: 'prestige-1', name: 'Reborn', emoji: '🔥', desc: 'Prestige once.', stars: 25, check: (s) => (s.prestigeCount || 0) >= 1 },
  { id: 'zone-5', name: 'Explorer', emoji: '🗺️', desc: 'Reach the Ashen Badlands (stage 41).', stars: 10, check: (s) => (s.stage || 1) >= 41 },
];
// Returns newly unlocked achievements (and applies their star rewards).
export function checkAchievements(state) {
  if (!Array.isArray(state.achievements)) state.achievements = [];
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (state.achievements.includes(a.id)) continue;
    let ok = false;
    try { ok = !!a.check(state); } catch { ok = false; }
    if (ok) {
      state.achievements.push(a.id);
      state.stars = (state.stars || 0) + a.stars;
      fresh.push(a);
    }
  }
  return fresh;
}

// ---------------- Tap combo ----------------
// Combo builds while tapping at least once per 1.5s (tracked in app.js).
// Combo mult: +0.5% tap damage per combo, capped at 2x (200 combo).
// Frenzy: hitting 50 combo triggers 10s of double tap damage.
export const COMBO_WINDOW_MS = 1500;
export const FRENZY_COMBO = 50;
export const FRENZY_MS = 10000;
export function tapDamageMult(state, combo, frenzyActive) {
  const tapLvl = (state.upgrades && state.upgrades.tap) || 1;
  const upMult = Math.pow(1.15, Math.max(0, tapLvl - 1));
  const comboMult = 1 + Math.min(combo || 0, 200) * 0.005;
  return upMult * comboMult * (frenzyActive ? 2 : 1);
}

// ---------------- GM helpers ----------------
// Grant N levels with the normal per-level stat gains + full heal.
export function grantLevels(state, n) {
  n = Math.max(1, Math.min(100, Math.floor(n) || 0));
  if (!n) return 0;
  for (let i = 0; i < n; i++) {
    state.level += 1;
    state.hero.attack += 3;
    state.hero.maxHp += 25;
    state.hero.defense += 2;
    if (state.level % 10 === 0 && state.mastery) state.mastery.points += 1;
  }
  state.xp = 0;
  state.xpNext = xpForLevel(state.level);
  const s2 = computeStats(state);
  state.hero.hp = s2.maxHp;
  return n;
}
