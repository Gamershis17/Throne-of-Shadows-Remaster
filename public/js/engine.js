// ============================================================
// engine.js — pure game logic for King of Project.
// No DOM access. Safe to unit-test in Node.
// Follows ~/workspace/rpg-server/API_CONTRACT.md exactly.
// ============================================================

// ---------------- Player cosmetic styles ----------------
// Custom button / background presets (Settings). Cosmetic only —
// unknown values normalize to 'default' in ensureState().
export const BTN_STYLE_IDS = ['default', 'ocean', 'crimson', 'emerald', 'gold', 'mono'];
export const BG_STYLE_IDS = ['default', 'deepspace', 'crimson', 'emerald', 'midnight', 'shadow-eyes', 'orbs', 'ember-drift'];

// ---------------- Level cap ----------------
// Hard level cap: no XP gains, GM grants, or loaded saves may push a
// REMASTER: Level caps - 60 for accounts, 20 for guests.
// character past this.
export const MAX_LEVEL = 60;
export const GUEST_MAX_LEVEL = 20;

// ---------------- Seasonal Event Framework ----------------
// Central event key: "HALLOWEEN", "HARVEST", "WINTER", "VALENTINES",
// "LUCK", "SPRING", "SUMMER", "NONE". Drives Armory tabs and drop routing.
export const ACTIVE_EVENT = "HALLOWEEN";
// Event windows (timestamps). Halloween 2026: Oct 3 – Oct 31.
export const EVENT_WINDOWS = {
  HALLOWEEN: { start: new Date('2026-10-03T00:00:00').getTime(), end: new Date('2026-10-31T23:59:59').getTime() },
};
export function isEventActive(key) {
  const w = EVENT_WINDOWS[key || ACTIVE_EVENT];
  if (!w) return false;
  const now = Date.now();
  return now >= w.start && now <= w.end;
}

// ---------------- Guild perks ----------------
// Set by the guild module after fetching the player's guild (server-side
// guild level). Applied in computeStats / gainXp below. Defaults to no
// bonus so guests / guildless players are unaffected.
let GUILD_PERKS = { xpPct: 0, goldPct: 0, dmgPct: 0, minePct: 0 };
export function setGuildPerks(p) {
  GUILD_PERKS = {
    xpPct: Math.max(0, Number(p && p.xpPct) || 0),
    goldPct: Math.max(0, Number(p && p.goldPct) || 0),
    dmgPct: Math.max(0, Number(p && p.dmgPct) || 0),
    minePct: Math.max(0, Number(p && p.minePct) || 0),
  };
}
export function getGuildPerks() {
  return { ...GUILD_PERKS };
}

// ---------------- Inn (AFK safe zone) ----------------
// Session-only rest state: while inside the inn combat is fully
// suspended (no damage in or out) and the hero regenerates.
// Pure functions — safe to unit-test in Node.
export const INN_REGEN_PER_SEC = 0.02; // 2% of max HP per second
export function innRegen(hp, maxHp, dt) {
  if (!(hp < maxHp) || !(maxHp > 0) || !(dt > 0)) return hp;
  return Math.min(maxHp, hp + maxHp * INN_REGEN_PER_SEC * dt);
}

// ---------------- Mining & Forging ----------------
// Mine tab: tap the rock to chip ores loose. Deeper rock unlocks rarer
// ore tiers. The Galaxy Forge (Gear tab) turns ores into Super Galaxy
// gear with player-chosen custom stats. Only ONE forged weapon and ONE
// forged armor can exist at a time — enforced structurally by the two
// forge slots below.
export const ORE_TIERS = [
  { id: 'copper',      name: 'Copper',            emoji: '🟤', power: 1,    unlockDepth: 1 },
  { id: 'iron',        name: 'Iron',              emoji: '⚙️', power: 3,    unlockDepth: 3 },
  { id: 'silver',      name: 'Silver',            emoji: '⚪', power: 8,    unlockDepth: 6 },
  { id: 'gold',        name: 'Gold Ore',          emoji: '🟡', power: 20,   unlockDepth: 10 },
  { id: 'mithril',     name: 'Mithril',           emoji: '🔷', power: 50,   unlockDepth: 15 },
  { id: 'adamant',     name: 'Adamant',           emoji: '🟣', power: 130,  unlockDepth: 21 },
  { id: 'galaxy',      name: 'Galaxy Shard',      emoji: '🌌', power: 350,  unlockDepth: 28 },
  { id: 'supergalaxy', name: 'Super Galaxy Core', emoji: '💜', power: 1000, unlockDepth: 36 },
];
export const ORE_BY_ID = Object.fromEntries(ORE_TIERS.map(o => [o.id, o]));
export const MAX_MINE_DEPTH = 60;

// Pickaxe tiers: each tier multiplies tap damage in mineDamage().
// Tier 0 is the starting stick (free). Upgrades cost the named ore +
// gold and are bought from the Mine tab via buyPickaxeUpgrade().
export const PICKAXE_TIERS = [
  { name: 'Cracked Stick',    emoji: '🪵', mult: 1,    cost: null },
  { name: 'Copper Pick',      emoji: '⛏️', mult: 1.6,  cost: { copper: 20, gold: 500 } },
  { name: 'Iron Pick',        emoji: '⛏️', mult: 2.5,  cost: { iron: 30, gold: 5000 } },
  { name: 'Steel Pick',       emoji: '⛏️', mult: 4,    cost: { iron: 40, silver: 20, gold: 50000 } },
  { name: 'Mithril Pick',     emoji: '⛏️', mult: 6.5,  cost: { mithril: 30, gold: 500000 } },
  { name: 'Adamant Pick',     emoji: '⛏️', mult: 10,   cost: { adamant: 25, gold: 5000000 } },
  { name: 'Galaxy Pick',      emoji: '🌌', mult: 16,   cost: { galaxy: 20, gold: 50000000 } },
  { name: 'Super Galaxy Pick',emoji: '💜', mult: 25,   cost: { supergalaxy: 10, gold: 500000000 } },
  { name: 'Void Pick',        emoji: '🕳️', mult: 40,   cost: { supergalaxy: 25, gold: 5000000000 } },
  { name: 'Cosmic Pick',      emoji: '🌠', mult: 65,   cost: { supergalaxy: 60, gold: 50000000000 } },
  { name: "Thronebreaker's Pick", emoji: '👑', mult: 100, cost: { supergalaxy: 120, gold: 500000000000 } },
];
export const MAX_PICKAXE_TIER = PICKAXE_TIERS.length - 1;

// Forge tiers: pick a tier when crafting; higher tiers cost rarer ores
// and multiply the custom stat values. Super Galaxy is deliberately OP.
export const FORGE_TIERS = [
  { id: 'star',   name: 'Starforged',   emoji: '⭐', mult: 1,  cost: { iron: 25, silver: 10 } },
  { id: 'void',   name: 'Voidforged',   emoji: '🌑', mult: 3,  cost: { gold: 20, mithril: 10 } },
  { id: 'galaxy', name: 'Galaxyforged', emoji: '🌌', mult: 10, cost: { adamant: 15, galaxy: 8 } },
  { id: 'super',  name: 'Super Galaxy', emoji: '💜', mult: 30, cost: { galaxy: 10, supergalaxy: 5 } },
];
export const FORGE_TIER_BY_ID = Object.fromEntries(FORGE_TIERS.map(t => [t.id, t]));
// Forgeable equipment slots — weapon & armor plus helmets, boots, trinkets.
export const FORGE_SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'trinket'];
// Class-driven forge identity: the forge reads your class and assigns what
// it needs — no stat picking. Primary converts to attack at craft time
// (agility/strength = attack power; intellect is "spell power" in name only,
// spells still scale off attack — see File 2 proposal).
export const CLASS_FORGE = {
  hunter:      { armor: 'Mail',    primary: 'agility',   primaryName: 'Agility' },
  assassin:    { armor: 'Leather', primary: 'agility',   primaryName: 'Agility' },
  mage:        { armor: 'Cloth',   primary: 'intellect', primaryName: 'Intellect' },
  warrior:     { armor: 'Plate',   primary: 'strength',  primaryName: 'Strength' },
  necromancer: { armor: 'Shroud',  primary: 'intellect', primaryName: 'Intellect' },
  berserker:   { armor: 'Hide',    primary: 'strength',  primaryName: 'Strength' },
  druid:       { armor: 'Leafmail', primary: 'intellect', primaryName: 'Intellect' },
};
// Display labels for auto-forged stats (primary label lives on the item).
export const FORGE_STAT_LABELS = { maxHp: 'Stamina', critChance: 'Critical Strike', attackSpeed: 'Haste' };
// Craftable custom stats (pick up to MAX_FORGE_PICKS per item).
export const FORGE_STATS = ['attack', 'defense', 'maxHp', 'critChance', 'critDamage', 'lifesteal', 'attackSpeed', 'xpBonus', 'goldBonus'];
export const FORGE_STAT_BASE = {
  attack: 500, defense: 400, maxHp: 1500, critChance: 8, critDamage: 30,
  lifesteal: 3, attackSpeed: 0.15, xpBonus: 20, goldBonus: 20,
};
export const FORGE_STAT_EMOJI = {
  attack: '⚔️', defense: '🛡️', maxHp: '❤️', critChance: '🎯', critDamage: '💥',
  lifesteal: '🩸', attackSpeed: '👆', xpBonus: '✨', goldBonus: '💰',
};
export const MAX_FORGE_PICKS = 3;
export const CRAFT_STAT_CAP = 1e9; // sane upper bound: never Infinity
export const GALAXY_EQUIP_ID = 'galaxy'; // sentinel id in state.equipped

export function mineRockMaxHp(depth) {
  // Safety: sanitize depth (NaN/null guard) and cap at 5000 to prevent overflow.
  const d = Math.max(1, Math.min(Math.floor(Number(depth) || 1), 5000));
  return Math.max(10, Math.round(30 * Math.pow(1.15, d - 1)));
}
export function mineDamage(state) {
  // Safety: return base damage if state is missing (prevents crash on null).
  if (!state || typeof state !== 'object') return 1;
  const tapLvl = (state.upgrades && state.upgrades.tap) || 1;
  const base = Math.max(1, Math.round(4 + (state.level || 1) * 1.5 + (tapLvl - 1) * 4));
  // Equipped pickaxe multiplies tap damage (rounded).
  return Math.max(1, Math.round(base * pickaxeTier(state).mult));
}
// Defensive pickaxe tier lookup: clamps a tampered/missing value to 0..MAX_PICKAXE_TIER.
export function pickaxeTier(state) {
  const raw = state && state.mine && state.mine.pickaxe;
  const idx = Number.isFinite(Number(raw))
    ? Math.max(0, Math.min(MAX_PICKAXE_TIER, Math.floor(Number(raw))))
    : 0;
  return PICKAXE_TIERS[idx];
}
// Cost object ({oreId: n, gold}) of the NEXT pickaxe tier, or null when
// already at MAX tier.
export function pickaxeUpgradeCost(state) {
  ensureMine(state);
  const next = PICKAXE_TIERS[state.mine.pickaxe + 1];
  return next && next.cost ? { ...next.cost } : null;
}
// Buy the next pickaxe tier. Returns true on success, or an error string
// (maxed / missing ore / missing gold). Deducts ores + gold (spendGold
// so the infinite-gold perk bypasses the gold cost).
export function buyPickaxeUpgrade(state) {
  ensureMine(state);
  const cur = state.mine.pickaxe;
  const next = PICKAXE_TIERS[cur + 1];
  if (!next || !next.cost) return 'Pickaxe is already at MAX tier.';
  const cost = next.cost;
  for (const [k, n] of Object.entries(cost)) {
    if (k === 'gold') continue;
    const have = state.mine.ores[k] || 0;
    if (have < n) {
      const od = ORE_BY_ID[k];
      return `Need ${n - have} more ${(od && od.name) || k}.`;
    }
  }
  const goldCost = cost.gold || 0;
  const goldHave = state.gold || 0;
  if (!spendGold(state, goldCost)) return `Need ${goldCost - goldHave} more gold.`;
  for (const [k, n] of Object.entries(cost)) {
    if (k === 'gold') continue;
    state.mine.ores[k] = Math.max(0, (state.mine.ores[k] || 0) - n);
  }
  state.mine.pickaxe = cur + 1;
  return true;
}
export function unlockedOres(depth) {
  return ORE_TIERS.filter(o => depth >= o.unlockDepth);
}
// Weighted roll among unlocked tiers; common ores drop more often.
export function rollOre(depth) {
  const tiers = unlockedOres(depth);
  if (!tiers.length) return 'copper';
  const n = tiers.length;
  let total = 0;
  const weights = tiers.map((_, i) => { const w = n - i; total += w; return w; });
  let r = Math.random() * total;
  for (let i = 0; i < tiers.length; i++) {
    r -= weights[i];
    if (r <= 0) return tiers[i].id;
  }
  return tiers[tiers.length - 1].id;
}
export function ensureMine(s) {
  // Safety: guard against null/undefined state (prevents TypeError crash).
  if (!s || typeof s !== 'object') return;
  if (!s.mine || typeof s.mine !== 'object') s.mine = {};
  const m = s.mine;
  m.depth = Math.max(1, Math.min(MAX_MINE_DEPTH, Math.floor(Number(m.depth) || 1)));
  m.rockMaxHp = mineRockMaxHp(m.depth);
  if (!Number.isFinite(Number(m.rockHp)) || m.rockHp < 0 || m.rockHp > m.rockMaxHp) {
    m.rockHp = m.rockMaxHp;
  }
  if (!m.ores || typeof m.ores !== 'object' || Array.isArray(m.ores)) m.ores = {};
  for (const o of ORE_TIERS) {
    const v = m.ores[o.id];
    m.ores[o.id] = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  }
  // Pickaxe tier (0..MAX_PICKAXE_TIER) + lifetime mining counters. All default 0 and stay
  // finite/non-negative so tampered saves can't smuggle weird values in.
  const pk = Math.floor(Number(m.pickaxe));
  m.pickaxe = Number.isFinite(pk) ? Math.max(0, Math.min(MAX_PICKAXE_TIER, pk)) : 0;
  for (const k of ['totalTaps', 'totalMined', 'maxDepth']) {
    const v = m[k];
    m[k] = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  }
  if (!s.forge || typeof s.forge !== 'object') s.forge = {};
  // Forge lifetime counters (read by title unlocks): total crafts ever
  // plus whether a Super Galaxy item has ever been crafted.
  const f = s.forge;
  const cr = Math.floor(Number(f.crafts));
  f.crafts = Number.isFinite(cr) ? Math.max(0, cr) : 0;
  f.superCrafted = f.superCrafted === true;
  for (const slot of FORGE_SLOTS) {
    const it = s.forge[slot];
    if (!it || typeof it !== 'object' || it.slot !== slot || !it.galaxy) {
      s.forge[slot] = null;
      continue;
    }
    // Normalize a forged item from an older save: finite stats, sane cap.
    const stats = {};
    for (const k of FORGE_STATS) {
      const v = it.stats && it.stats[k];
      stats[k] = Number.isFinite(v) ? Math.min(CRAFT_STAT_CAP, Math.max(0, v)) : 0;
    }
    it.stats = stats;
    it.enchant = 0;
    it.unsellable = true;
  }
  return s;
}
// One tap on the rock. Returns { ore, broke, bonus } for UI feedback.
export function mineTap(state) {
  ensureMine(state);
  // Safety: bail if state is unusable (ensureMine couldn't initialize it).
  if (!state || !state.mine) return { ore: 'copper', broke: false, bonus: [] };
  const m = state.mine;
  const dmg = mineDamage(state);
  m.rockHp -= dmg;
  const ore = rollOre(m.depth);
  m.ores[ore] = (m.ores[ore] || 0) + 1;
  m.totalTaps++;
  m.totalMined++;
  let broke = false;
  const bonus = [];
  if (m.rockHp <= 0) {
    broke = true;
    // Forge Shrine guild perk: +minePct% bonus ore on rock break.
    const mineMult = 1 + (GUILD_PERKS.minePct || 0) / 100;
    const n = Math.floor((3 + Math.floor(m.depth / 2)) * mineMult);
    for (let i = 0; i < n; i++) {
      const b = rollOre(m.depth);
      m.ores[b] = (m.ores[b] || 0) + 1;
      m.totalMined++;
      bonus.push(b);
    }
    m.depth = Math.min(MAX_MINE_DEPTH, m.depth + 1);
    m.rockMaxHp = mineRockMaxHp(m.depth);
    m.rockHp = m.rockMaxHp;
  }
  m.maxDepth = Math.max(m.maxDepth, m.depth);
  return { ore, broke, bonus };
}
// Slow passive trickle while the game runs (called ~every 30s by the tick).
export function trickleOre(state) {
  ensureMine(state);
  const ore = rollOre(state.mine.depth);
  state.mine.ores[ore] = (state.mine.ores[ore] || 0) + 1;
  state.mine.totalMined++;
  return ore;
}
export function forgeCost(tierId) {
  const t = FORGE_TIER_BY_ID[tierId];
  return t ? { ...t.cost } : null;
}
export function canCraft(state, tierId) {
  ensureMine(state);
  const cost = forgeCost(tierId);
  if (!cost) return false;
  return Object.entries(cost).every(([ore, n]) => (state.mine.ores[ore] || 0) >= n);
}
function forgeStatValue(stat, mult) {
  const base = FORGE_STAT_BASE[stat] || 0;
  const v = base * mult;
  const r = (stat === 'attackSpeed') ? round1(v) : Math.round(v);
  return Math.min(CRAFT_STAT_CAP, r);
}
// Craft a class-forged item into the forge slot (weapon|armor|helmet|boots|
// trinket). Stats are automatic — primary (class) + stamina + crit + haste,
// scaled by tier. Reforging replaces the old item. Returns the item, or an
// error string.
export function craftGalaxyItem(state, slot, tierId) {
  ensureMine(state);
  if (!FORGE_SLOTS.includes(slot)) return 'Invalid forge slot.';
  const tier = FORGE_TIER_BY_ID[tierId];
  if (!tier) return 'Invalid forge tier.';
  const cost = forgeCost(tierId);
  for (const [ore, n] of Object.entries(cost)) {
    if ((state.mine.ores[ore] || 0) < n) {
      const od = ORE_BY_ID[ore];
      return `Need ${n} ${(od && od.name) || ore}.`;
    }
  }
  for (const [ore, n] of Object.entries(cost)) state.mine.ores[ore] -= n;
  const cf = CLASS_FORGE[state.playerClass] || CLASS_FORGE.warrior;
  const stats = {
    attack: forgeStatValue('attack', tier.mult),
    maxHp: forgeStatValue('maxHp', tier.mult),
    critChance: forgeStatValue('critChance', tier.mult),
    attackSpeed: forgeStatValue('attackSpeed', tier.mult),
  };
  const slotLabel = (SLOT_INFO[slot] || {}).name || slot;
  const itemName = slot === 'weapon'
    ? `${tier.emoji} ${tier.name} ${weaponNameFor(state.playerClass)}`
    : `${tier.emoji} ${tier.name} ${cf.armor} ${slotLabel}`;
  const item = {
    id: uid(), galaxy: true, unsellable: true, enchant: 0,
    name: itemName,
    slot, rarity: 'galaxy', forgeTier: tier.id, stats, value: 0,
    primaryName: cf.primaryName, // display label for the attack stat
  };
  state.forge[slot] = item;
  // Lifetime forge counters (read by title unlocks).
  state.forge.crafts = (state.forge.crafts || 0) + 1;
  if (tierId === 'super') state.forge.superCrafted = true;
  // If a galaxy item was equipped here it is replaced by the new one.
  if (state.equipped && state.equipped[slot] === GALAXY_EQUIP_ID) {
    // stays equipped — the new item takes effect immediately
  }
  return item;
}
export function galaxyItemFor(state, slot) {
  if (!state.forge || !state.forge[slot] || !state.forge[slot].galaxy) return null;
  return state.forge[slot];
}
export function equipGalaxy(state, slot) {
  if (!FORGE_SLOTS.includes(slot)) return false;
  if (!galaxyItemFor(state, slot)) return false;
  if (!state.equipped) state.equipped = {};
  state.equipped[slot] = GALAXY_EQUIP_ID;
  return true;
}
export function unequipGalaxy(state, slot) {
  if (state.equipped && state.equipped[slot] === GALAXY_EQUIP_ID) {
    state.equipped[slot] = null;
    return true;
  }
  return false;
}

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

// ---------------- Classes ----------------
// Permanent per-character choice (state.playerClass). Bonuses apply in
// computeStats; hunter's pet perks hook into petStrikeDamage / petFeedCost.
export const CLASSES = {
  hunter: {
    name: 'Hunter', emoji: '🏹',
    desc: 'Master of beasts. Field two pets at once — they fight harder and eat cheaper.',
    perks: ['Field 2 pets at once', 'Pets deal +50% damage', 'Feeding costs 30% less', '+5% dodge'],
    petDmgMult: 1.5, feedCostMult: 0.7, dodgeBonus: 5,
  },
  warrior: {
    name: 'Warrior', emoji: '⚔️',
    desc: 'An unbreakable wall. Outlasts anything the dark throws at you.',
    perks: ['+50% max HP', '+30% defense', '+15% attack'],
    hpMult: 1.50, defMult: 1.30, atkMult: 1.15,
  },
  mage: {
    name: 'Mage', emoji: '🔮',
    desc: 'Glass cannon. Overwhelming power in a fragile frame.',
    perks: ['+25% attack', '+10% crit chance', '−10% max HP'],
    atkMult: 1.25, critChBonus: 10, hpMult: 0.90,
  },
  assassin: {
    name: 'Rogue', emoji: '🗡️',
    desc: 'Strikes from shadow. Every hit could be the last one.',
    perks: ['+40% crit damage', '+10% dodge', '+5% attack speed'],
    critDmgBonus: 40, dodgeBonus: 10, atkSpdBonus: 0.05,
    resource: 'energy',
  },
  necromancer: {
    name: 'Necromancer', emoji: '💀',
    desc: 'Master of death. Every fallen enemy feeds your dark power.',
    perks: ['+15% attack', '+10% crit damage', '−10% max HP'],
    atkMult: 1.15, critDmgBonus: 10, hpMult: 0.90,
  },
  berserker: {
    name: 'Berserker', emoji: '🩸',
    desc: 'Unstoppable rage. Hits like a siege engine, defends like one too.',
    perks: ['+30% attack', '+10% attack speed', '−15% defense'],
    atkMult: 1.30, atkSpdBonus: 0.10, defMult: 0.85,
  },
  druid: {
    name: 'Druid', emoji: '🌿',
    desc: 'Shapeshifter of the wild. Heals over time, strikes as beast or moonfire.',
    perks: ['+10% max HP', '+10% attack', '+5% dodge'],
    hpMult: 1.10, atkMult: 1.10, dodgeBonus: 5,
    resource: 'mana',
  },
};
export function classDef(id) { return CLASSES[id] || null; }

// ---------------- Specializations ----------------
// Second permanent choice (state.spec), picked after class. Any spec pairs
// with any class. Modifiers stack multiplicatively/additively with class
// bonuses in computeStats. 'classic' = no modifiers (original game feel).
export const SPECS = {
  tank: {
    name: 'Tank', emoji: '🛡️',
    desc: 'An immovable bulwark. Soak hits that would flatten anyone else.',
    perks: ['+20% max HP', '+20% defense', '−10% attack'],
    hpMult: 1.20, defMult: 1.20, atkMult: 0.90,
  },
  dps: {
    name: 'DPS', emoji: '⚔️',
    desc: 'Pure damage. End fights before they can hurt you.',
    perks: ['+20% attack', '+10% crit chance', '−10% defense'],
    atkMult: 1.20, critChBonus: 10, defMult: 0.90,
  },
  healer: {
    name: 'Healer', emoji: '💚',
    desc: 'Sustains through anything. Outlast the darkness.',
    perks: ['+3 HP/s regen', '+5% lifesteal', '+10% max HP'],
    regenBonus: 3, lifestealBonus: 5, hpMult: 1.10,
  },
  classic: {
    name: 'Classic', emoji: '📜',
    desc: 'The classic way — no specialization bonuses. Exactly the original feel.',
    perks: ['No bonuses', 'The original game feel'],
  },
};
export function specDef(id) { return SPECS[id] || null; }

// ---------------- Rarity / slots / stats ----------------
export const RARITIES = [
  { id: 'common',    weight: 50,  color: '#9aa0a6', stats: 1, mult: 1,   prefix: 'Iron' },
  { id: 'magic',     weight: 25,  color: '#4da3ff', stats: 2, mult: 1.6, prefix: 'Runed' },
  { id: 'rare',      weight: 13,  color: '#ffd23f', stats: 2, mult: 2.5, prefix: 'Gilded' },
  { id: 'epic',      weight: 7,   color: '#b366ff', stats: 3, mult: 4,   prefix: 'Arcane' },
  { id: 'legendary', weight: 3.5, color: '#ff8c1a', stats: 3, mult: 6.5, prefix: 'Mythril' },
  { id: 'mythic',    weight: 1.5, color: '#ff3b3b', stats: 4, mult: 10,  prefix: 'Eternal' },
  { id: 'divine',    weight: 0.7,  color: '#ffe87a', stats: 4, mult: 15, prefix: 'Divine',   emoji: '💛' },
  { id: 'cosmic',    weight: 0.35, color: '#7df9ff', stats: 5, mult: 22, prefix: 'Cosmic',   emoji: '🌌' },
  { id: 'enduring',  weight: 0.18, color: '#e0a458', stats: 5, mult: 45, prefix: 'Enduring', emoji: '🛡️' },
  { id: 'infinite',  weight: 0.09, color: '#ff6ef5', stats: 6, mult: 65, prefix: 'Infinite', emoji: '♾️' },
  { id: 'rainbowstar', weight: 0.04, color: '#ff00ff', stats: 7, mult: 100, prefix: 'Rainbow', emoji: '🌈⭐' },
];
export const RARITY_BY_ID = Object.fromEntries(RARITIES.map(r => [r.id, r]));
export const RARITY_IDX = Object.fromEntries(RARITIES.map((r, i) => [r.id, i]));
// Player-facing rarity names. Ids stay stable for saves; only the label changes.
export const RARITY_NAMES = {
  common: 'Common', magic: 'Uncommon', rare: 'Rare', epic: 'Epic',
  legendary: 'Legendary', mythic: 'Mythic', divine: 'Divine',
  cosmic: 'Cosmic', enduring: 'Enduring', infinite: 'Infinite',
  rainbowstar: 'Rainbow Star',
};
export function rarityName(id) { return RARITY_NAMES[id] || String(id); }

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
    gold: 500, stars: 0,
    stage: 1, bossesKilled: 0,
    rebirthCount: 0, rebirthTokens: 0,
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
    stats: { taps: 0, kills: 0, playTimeSec: 0, maxCombo: 0, questsCompleted: 0 },
    mastery: { points: 0, spent: { might: 0, vitality: 0, fortune: 0 } },
    professions: { herbalism: 1, smithing: 1 },
    achievements: [],
    titlesUnlocked: ['wanderer'],
    activeTitle: 'wanderer',
    badge: null,      // GM-granted creator badge id (e.g. 'youtuber') — shown on leaderboard
    country: null,    // ISO-3166 country code (e.g. 'US') — flag shown on leaderboard
    infGold: false,   // owner-only perk: infinite gold (purchases never deduct)
    restedUntil: 0,
    playerClass: null, // permanent class choice: hunter|warrior|mage|assassin|necromancer|berserker (null = not chosen)
    // NOTE: the 'assassin' key displays as Rogue (renamed 2026-09-30) — the key is kept so existing saves keep working.
    classTokens: 0,   // 🔄 class-change tokens (Token Shop); spent in the character sheet
    energy: 100,      // rogue resource — refills to full on load (see ensureState backfill)
    focus: 100, rage: 0, mana: 100, // hunter/warrior/mage resources (rage builds in combat)
    spellSlots: [],   // customizable 6-slot spell loadout (auto-filled per class)
    buffs: [],        // transient timed buffs (shouts, shields, blink)
    hots: [],         // druid heals-over-time
    potions: { health: 0, resource: 0 },
    potionReadyAt: 0, // timestamp (ms) when the potion cooldown ends — survives reloads
    spec: null,       // permanent specialization: tank|dps|healer|classic (null = not chosen)
    pets: { collection: [], activeUid: null, eggs: 0 }, // pet system (all players)
    mine: { depth: 1, rockHp: 30, rockMaxHp: 30, ores: {} }, // mining (backfilled by ensureMine)
    forge: { weapon: null, armor: null }, // at most ONE forged galaxy weapon + ONE forged armor
    npcHealer: null, // NPC druid healer "Sylvara" — {name, level, lastResurrect, resurrectedThisBattle}
  };
}

// Merge a server blob with defaults so old/missing fields never crash the client.
export function ensureState(raw) {
  const d = defaultState('human');
  if (!raw || typeof raw !== 'object') { d.race = null; return d; }
  const s = { ...d, ...raw };
  if (!raw.race) s.race = null; // first run -> race select
  // Permanent class choice; unknown values reset to "not chosen".
  s.playerClass = (raw.playerClass && CLASSES[raw.playerClass]) ? raw.playerClass : null;
  // Permanent specialization; unknown values reset to "not chosen".
  s.spec = (raw.spec && SPECS[raw.spec]) ? raw.spec : null;
  s.hero = { ...d.hero, ...(raw.hero || {}) };
  s.equipped = { ...d.equipped, ...(raw.equipped || {}) };
  s.upgrades = { ...d.upgrades, ...(raw.upgrades || {}) };
  s.stats = { ...d.stats, ...(raw.stats || {}) };
  s.mastery = { points: 0, spent: {}, ...(raw.mastery || {}) };
  s.mastery.spent = { might: 0, vitality: 0, fortune: 0, ...(s.mastery.spent || {}) };
  s.mastery.points = Math.max(0, Math.floor(s.mastery.points || 0));
  // Class talent points (level-system rework): banked for the per-class talent
  // trees. First run grants 1 point per milestone already cleared; the
  // reconcile below tops up the 1-per-5-levels points retroactively.
  if (!raw.classTalents) {
    let banked = 0;
    for (const m of MILESTONE_LEVELS) if ((s.level || 1) >= m) banked += 1;
    s.classTalents = { points: banked, spent: {} };
  } else {
    s.classTalents = { points: 0, spent: {}, ...raw.classTalents };
    s.classTalents.points = Math.max(0, Math.floor(s.classTalents.points || 0));
  }
  reconcileTalentPoints(s);
  if (!Number.isFinite(s.classTokens)) s.classTokens = 0;
  s.energy = ENERGY_MAX; // energy always refills to full on load
  if (!Number.isFinite(s.focus)) s.focus = 100;
  s.rage = 0; // rage never persists between sessions — it builds in combat
  if (!Number.isFinite(s.mana)) s.mana = 100;
  if (!Array.isArray(s.spellSlots)) s.spellSlots = [];
  ensureSpellSlots(s);
  if (!Array.isArray(s.buffs)) s.buffs = [];
  if (!s.potions || typeof s.potions !== 'object') s.potions = { health: 0, resource: 0 };
  if (typeof s.potionReadyAt !== 'number') s.potionReadyAt = 0;
  s.professions = { herbalism: 1, smithing: 1, ...(raw.professions || {}) };
  if (!Array.isArray(s.achievements)) s.achievements = [];
  if (!Array.isArray(s.titlesUnlocked) || !s.titlesUnlocked.length) s.titlesUnlocked = ['wanderer'];
  if (typeof s.activeTitle !== 'string' || !s.activeTitle) s.activeTitle = s.titlesUnlocked[0];
  if (typeof s.badge !== 'string' || !BADGE_BY_ID[s.badge]) s.badge = null; // unknown badges cleared
  if (typeof s.country !== 'string' || !isValidCountry(s.country)) s.country = null;
  // Guide-chain progress flags (e.g. tabs visited for the onboarding quests).
  if (!s.guideTabs || typeof s.guideTabs !== 'object') s.guideTabs = {};
  // Custom button/background styles; unknown values reset to default.
  if (!BTN_STYLE_IDS.includes(s.btnStyle)) s.btnStyle = 'default';
  if (!BG_STYLE_IDS.includes(s.bgStyle)) s.bgStyle = 'default';
  // Audio prefs are cosmetic; unknown values reset to defaults
  // (SFX on, music off / opt-in).
  s.audio = { sfx: !s.audio || s.audio.sfx !== false, music: !!(s.audio && s.audio.music) };
  s.infGold = s.infGold === true; // owner-only perk flag
  s.restedUntil = Number(raw.restedUntil) || 0;
  // Clamp over-cap gold (e.g. after the owner lowers the cap). The
  // infinite-gold perk bypasses the cap entirely.
  if (s.infGold !== true && Number.isFinite(s.gold)) {
    s.gold = Math.min(Math.max(0, s.gold), GOLD_CAP);
  }
  ensurePets(s);
  if (!Array.isArray(s.party)) s.party = [];
  if (!Array.isArray(s.inventory)) s.inventory = [];
  // Notification prefs live on the save (per player / guest) so they sync with
  // the account. Backfill defaults: every category ON.
  if (!s.settings || typeof s.settings !== 'object') s.settings = {};
  if (!s.settings.notif || typeof s.settings.notif !== 'object') s.settings.notif = {};
  for (const cat of ['level', 'death', 'loot', 'quest']) {
    if (s.settings.notif[cat] === undefined) s.settings.notif[cat] = true;
  }
  // Animated background scene options (Settings → Background).
  if (!['violet', 'ember', 'gold'].includes(s.settings.eyeColor)) s.settings.eyeColor = 'violet';
  if (!Array.isArray(s.settings.orbColors) || s.settings.orbColors.length !== 3 ||
      !s.settings.orbColors.every((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))) {
    s.settings.orbColors = ['#a855f7', '#7c3aed', '#22d3ee'];
  }
  if (!Array.isArray(s.skills) || !s.skills.length) s.skills = ['power-strike'];
  // Old saves: grant every skill the player's current level has unlocked.
  for (const id of SKILL_ORDER) {
    if (s.level >= SKILLS[id].unlockLevel && !s.skills.includes(id)) s.skills.push(id);
  }
  // Old saves: skill-use counters for the mastery track (default 0 casts).
  if (!s.skillUses || typeof s.skillUses !== 'object') s.skillUses = {};
  for (const id of SKILL_ORDER) {
    if (!Number.isFinite(Number(s.skillUses[id]))) s.skillUses[id] = 0;
  }
  // Old saves: normalize enchant levels on inventory items (0–10 ints).
  for (const it of s.inventory) {
    it.enchant = Math.max(0, Math.min(ENCHANT_MAX, Math.floor(Number(it.enchant) || 0)));
  }
  ensureQuests(s); // backfill the quest board on old saves
  ensureStoryQuests(s); // backfill one-time class + mastery quests
  ensureMine(s); // backfill mining + forge slots on old saves
  if (!Array.isArray(s.codesRedeemed)) s.codesRedeemed = [];
  if (!Array.isArray(s.companions)) s.companions = [];
  if (!['clicker', 'auto', 'dungeon'].includes(s.mode)) s.mode = 'clicker';
  s.level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(s.level || 1)));
  // Legacy prestige saves: fold the old count into rebirths, drop the bonus.
  if (raw.rebirthCount === undefined && raw.prestigeCount !== undefined) s.rebirthCount = raw.prestigeCount;
  delete s.prestigeCount; delete s.prestigeBonus;
  // Achievement id rename: prestige-1 -> rebirth-1 (same feat, new name).
  if (Array.isArray(s.achievements)) {
    const i = s.achievements.indexOf('prestige-1');
    if (i !== -1) s.achievements[i] = 'rebirth-1';
  }
  s.rebirthCount = Math.max(0, Math.floor(s.rebirthCount || 0));
  s.rebirthTokens = Math.max(0, Math.floor(s.rebirthTokens || 0));
  // Kill streak: consecutive kills without dying; boosts loot drop chance.
  s.streak = Math.max(0, Math.floor(s.streak || 0));
  s.stage = Math.max(1, Math.floor(s.stage || 1));
  s.xpNext = xpForLevel(s.level);
  s.hero.hp = clamp(s.hero.hp, 0, s.hero.maxHp);
  for (const c of s.party) {
    c.hp = clamp(c.hp, 0, c.maxHp);
    if (!c.role) c.role = 'Companion';
    // Normalize companions from older saves: default missing level, and
    // backfill the recruit's base cost (used by the level-up cost curve)
    // by matching the recruit by id or name.
    c.level = Math.max(1, Math.floor(c.level || 1));
    if (!Number.isFinite(Number(c.baseCost)) || Number(c.baseCost) <= 0) {
      const r = (c.recruitId && RECRUIT_BY_ID[c.recruitId])
        || RECRUITS.find(x => x.name === c.name);
      c.baseCost = r ? r.cost : 50;
      if (r && !c.recruitId) c.recruitId = r.id;
    }
    // v15 NPC buff: recompute combat stats from role + level (idempotent,
    // preserves HP fraction) so pre-buff allies gain the new scaling.
    recomputeCompanion(c);
  }
  return s;
}

// ---------------- XP / levels / gold ----------------
// XP curve (v19 mega-update: cap raised to 120): four segments, continuous
// at every kink.
//   Levels 1-30:   80 * 1.30^(l-1) — unchanged; early game stays snappy for
//                  new players.
//   Levels 31-60:  V30 * 1.35^(l-30), where V30 = 80 * 1.30^29 (the level-30
//                  value), so the curve is continuous at 30.
//   Levels 61-90:  V60 * 1.44^(l-60), where V60 = V30 * 1.35^30 (the level-60
//                  value), so the curve is continuous at 60.
//   Levels 91-120: V90 * 1.47^(l-90), where V90 = V60 * 1.44^30 (the level-90
//                  value), so the curve is continuous at 90. The steepest
//                  segment guards the new endgame: total XP 1->120 is ~98,000x
//                  the total 1->90, so the last 30 levels are a proper grind
//                  even with quest XP and the +40% party bonus in the math.
// Versus the old curve: level 40 ~1.46x, 50 ~2.13x, 60 ~3.10x, 70 ~3.57x,
// 90 ~4.72x. The steepening was sized with the +40% party XP bonus in the
// math, so even a full party still climbs ~2.5x slower at level 70.
const XP_V30 = 80 * Math.pow(1.30, 29); // value at the first kink (level 30)
const XP_V60 = XP_V30 * Math.pow(1.35, 30); // value at the second kink (level 60)
const XP_V90 = XP_V60 * Math.pow(1.44, 30); // value at the third kink (level 90)
const xpForLevelBase = (level) => {
  const l = Math.max(1, Math.floor(level || 1));
  if (l <= 30) return 80 * Math.pow(1.30, l - 1);
  if (l <= 60) return XP_V30 * Math.pow(1.35, l - 30);
  if (l <= 90) return XP_V60 * Math.pow(1.44, l - 60);
  return XP_V90 * Math.pow(1.47, l - 90);
};
// REMASTER: Rebirth removed. XP is purely level-based, no multipliers.
// (rebirthXpMult and MAX_EFFECTIVE_REBIRTHS kept as no-ops for save compat.)
export const MAX_EFFECTIVE_REBIRTHS = 200;
export const rebirthXpMult = () => 1;
export const xpForLevel = (level) =>
  Math.max(1, Math.round(xpForLevelBase(level)));
export const xpForKill = (stage) => Math.max(1, Math.round(10 * Math.pow(1.12, stage)));
// Level-system rework: no single kill can grant more than this fraction of the
// XP needed for the current level. Late-game kill XP outran level requirements
// (nearly a full level per kill); this caps the pace at 20 kills/level minimum.
// Early game is untouched (kills there are worth far less than the cap).
// Tune freely — lower is slower.
export const KILL_XP_CAP_FRAC = 0.05;
export function killXpFor(state, stage) {
  const raw = Math.floor(xpForKill(stage) * eventXpMult());
  const cap = Math.max(1, Math.floor((state.xpNext || 1) * KILL_XP_CAP_FRAC));
  return Math.max(1, Math.min(raw, cap));
}
// Deducts gold for a purchase. Returns false when the player can't afford
// it. Infinite-gold perk holders never pay.
export function spendGold(s, cost) {
  if (s.infGold) return true;
  if ((s.gold || 0) < cost) return false;
  s.gold -= cost;
  return true;
}

// Server gold cap (owner-adjustable, default 999Dc). The client refreshes it
// from GET /api/settings at boot via setGoldCap().
let GOLD_CAP = 9.99e44; // 999Td (was 999Dc)
export function setGoldCap(cap) {
  if (Number.isFinite(cap) && cap >= 1e12) GOLD_CAP = cap;
}
export function goldCap() { return GOLD_CAP; }

// Server event buff (double-XP weekend etc.), set by staff via
// POST /api/gm/event-buff and refreshed from GET /api/settings at boot.
let EVENT_BUFF = null;
export function setEventBuff(buff) {
  if (buff && buff.endsAt > Date.now() && buff.xpMult >= 1 && buff.goldMult >= 1) {
    EVENT_BUFF = { xpMult: buff.xpMult, goldMult: buff.goldMult, endsAt: buff.endsAt, label: buff.label || 'Event' };
  } else {
    EVENT_BUFF = null;
  }
}
export function eventBuff() {
  if (EVENT_BUFF && EVENT_BUFF.endsAt <= Date.now()) EVENT_BUFF = null;
  return EVENT_BUFF;
}
export function eventXpMult() { const b = eventBuff(); return b ? b.xpMult : 1; }
export function eventGoldMult() { const b = eventBuff(); return b ? b.goldMult : 1; }

// Adds gold, clamped to the server gold cap. The infinite-gold perk bypasses
// the cap entirely. Returns the amount actually added.
export function addGold(s, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  // GM gold buff: multiply gains
  amount = amount * getBuffMult(s, 'gold');
  const cur = Math.max(0, Number(s.gold) || 0);
  if (s.infGold === true) { s.gold = cur + amount; return amount; }
  const room = Math.max(0, GOLD_CAP - cur);
  const added = Math.min(amount, room);
  s.gold = cur + added;
  return added;
}

export function goldForKill(stage, goldBonusPct = 0) {
  return Math.max(1, Math.round(
    6 * Math.pow(1.12, stage) *
    (1 + goldBonusPct / 100)
  ));
}

// Adds XP (applying race + gear + rested multipliers), handles level-ups.
// Level-up: +3 attack, +25 maxHp, +2 defense; heals 25% max HP.
// Every 10th level also grants a Mastery point.
// ---------------- Active skills ----------------
// Cooldown-only combat skills (no mana). power-strike is the default;
// the rest unlock automatically on level-up via gainXp().
export const SKILLS = {
  'power-strike': { name: 'Power Strike', emoji: '✨', unlockLevel: 1, cdMs: 12000, mult: 2.5,
    desc: 'A mighty blow dealing 2.5× attack damage.' },
  'fireball': { name: 'Fireball', emoji: '🔥', unlockLevel: 10, cdMs: 20000, mult: 3,
    desc: 'Hurl a fireball dealing 3× attack damage.' },
  'heal': { name: 'Heal', emoji: '💚', unlockLevel: 25, cdMs: 45000, healPct: 35,
    desc: 'Restore 35% of max HP.' },
  'execute': { name: 'Execute', emoji: '⚔️', unlockLevel: 40, cdMs: 30000, mult: 6, executeMult: 1.5, threshold: 0.3,
    desc: '6× damage if the enemy is below 30% HP, else 1.5×.' },
};
export const SKILL_ORDER = ['power-strike', 'fireball', 'heal', 'execute'];

// ---------------- Class spellbooks ----------------
// Per-class kits replacing the old class-blind SKILLS for hunter/warrior/
// mage. Rogue/necromancer/berserker keep SKILLS until their books land.
//
// Effect kinds: strike {mult} · execute {mult, threshold, weakMult}
// · heal {healPct} · petHeal {healPct} · petStrike {mult}
// · trap {mult, dotMult?, dotTicks?, dotEveryMs?, slowPct?, slowSec?}
// · slow {mult, slowPct, slowSec} · dot {mult, dotMult, dotTicks, dotEveryMs}
// · shield {pct, sec} · shout {atkPct?, dmgTakenPct?, sec} · dodge {pct, sec}
// · strikeInt {mult, interruptSec}
// cost = resource spent (default 0); gain = resource generated on cast.
export const SPELL_SLOT_COUNT = 6;
// Spell icon paths (WoW-style square icons). Maps spell ID → icon URL.
// Icons live in public/icons/spells/. If an icon is missing or fails to load,
// the UI falls back to the spell's emoji. Add entries as icons are created.
export const SPELL_ICONS = {
  // Hunter
  'steady-shot': 'icons/spells/steady-shot.png',
  'arcane-shot': 'icons/spells/arcane-shot.png',
  'mend-pet': 'icons/spells/mend-pet.png',
  'aimed-shot': 'icons/spells/aimed-shot.png',
  'frost-trap': 'icons/spells/frost-trap.png',
  'multi-shot': 'icons/spells/multi-shot.png',
  'kill-command': 'icons/spells/kill-command.png',
  'explosive-trap': 'icons/spells/explosive-trap.png',
  // Warrior
  'charge': 'icons/spells/charge.png',
  'slam': 'icons/spells/slam.png',
  'shield-block': 'icons/spells/shield-block.png',
  'w-exec': 'icons/spells/w-exec.png',
  'whirlwind': 'icons/spells/whirlwind.png',
  'battle-shout': 'icons/spells/battle-shout.png',
  'pummel': 'icons/spells/pummel.png',
  'challenging-shout': 'icons/spells/challenging-shout.png',
  // Mage
  'arcane-blast': 'icons/spells/arcane-blast.png',
  'fireball': 'icons/spells/fireball.png',
  'frostbolt': 'icons/spells/frostbolt.png',
  'arcane-missiles': 'icons/spells/arcane-missiles.png',
  'frost-nova': 'icons/spells/frost-nova.png',
  'pyroblast': 'icons/spells/pyroblast.png',
  'blizzard': 'icons/spells/blizzard.png',
  'blink': 'icons/spells/blink.png',
  // Druid
  'moonfire': 'icons/spells/moonfire.png',
  'wrath': 'icons/spells/wrath.png',
  'rejuvenation': 'icons/spells/rejuvenation.png',
  'bear-form': 'icons/spells/bear-form.png',
  'cat-form': 'icons/spells/cat-form.png',
  'rake': 'icons/spells/rake.png',
  'regrowth': 'icons/spells/regrowth.png',
  'tranquility': 'icons/spells/tranquility.png',
};
// Get the icon path for a spell, or null if none is defined.
export function spellIcon(id) {
  return SPELL_ICONS[id] || null;
}
export const CLASS_SPELLS = {
  hunter: [
    { id: 'steady-shot', name: 'Steady Shot', emoji: '🏹', school: 'Marksmanship', gain: 15, cdMs: 5000, unlockLevel: 1,
      effect: { kind: 'strike', mult: 1.0 }, desc: 'Deal 1× damage. Generates 15 Focus.' },
    { id: 'arcane-shot', name: 'Arcane Shot', emoji: '✨', school: 'Marksmanship', cost: 20, cdMs: 8000, unlockLevel: 1,
      effect: { kind: 'strike', mult: 2.5 }, desc: 'Deal 2.5× damage as Arcane.' },
    { id: 'mend-pet', name: 'Mend Pet', emoji: '💚', school: 'Beast Mastery', cost: 25, cdMs: 20000, unlockLevel: 10,
      effect: { kind: 'mendPet', petDmgPct: 25, sec: 15 }, desc: 'Restore your pets to full hunger and inspire them: +25% pet damage for 15s.' },
    { id: 'aimed-shot', name: 'Aimed Shot', emoji: '🎯', school: 'Marksmanship', cost: 35, cdMs: 15000, unlockLevel: 15,
      effect: { kind: 'strike', mult: 4.0 }, desc: 'A careful shot dealing 4× damage.' },
    { id: 'frost-trap', name: 'Frost Trap', emoji: '🧊', school: 'Survival', cost: 25, cdMs: 20000, unlockLevel: 20,
      effect: { kind: 'trap', mult: 1.5, slowPct: 40, slowSec: 10 }, desc: '1.5× damage and the enemy attacks 40% slower for 10s.' },
    { id: 'multi-shot', name: 'Multi-Shot', emoji: '🌪️', school: 'Marksmanship', cost: 30, cdMs: 12000, unlockLevel: 25,
      effect: { kind: 'strike', mult: 2.0 }, desc: 'A volley dealing 2× damage.' },
    { id: 'kill-command', name: 'Kill Command', emoji: '🐺', school: 'Beast Mastery', cost: 20, cdMs: 10000, unlockLevel: 30,
      effect: { kind: 'petStrike', mult: 3.0, debuffKind: 'bleed', debuffMult: 0.25, debuffSec: 10 }, desc: 'Your pet strikes for 3× damage and causes bleeding: 0.25× attack for 10s.' },
    { id: 'explosive-trap', name: 'Explosive Trap', emoji: '💥', school: 'Survival', cost: 30, cdMs: 25000, unlockLevel: 35,
      effect: { kind: 'trap', mult: 2.0, dotMult: 1.0, dotTicks: 4, dotEveryMs: 2000 }, desc: '2× damage plus 1× burn every 2s, 4 times.' },
  ],
  warrior: [
    { id: 'charge', name: 'Charge', emoji: '💨', school: 'Arms', gain: 10, cdMs: 8000, unlockLevel: 1,
      effect: { kind: 'strike', mult: 1.5 }, desc: 'Charge in for 1.5× damage. Generates 10 Rage.' },
    { id: 'slam', name: 'Slam', emoji: '🔨', school: 'Arms', cost: 15, cdMs: 8000, unlockLevel: 1,
      effect: { kind: 'strike', mult: 2.5 }, desc: 'Slam for 2.5× damage.' },
    { id: 'shield-block', name: 'Shield Block', emoji: '🛡️', school: 'Protection', cost: 20, cdMs: 25000, unlockLevel: 15,
      effect: { kind: 'shield', pct: 30, sec: 8 }, desc: 'Absorb damage up to 30% of max HP for 8s.' },
    { id: 'w-exec', name: 'Execute', emoji: '⚔️', school: 'Arms', cost: 25, cdMs: 20000, unlockLevel: 20,
      effect: { kind: 'execute', mult: 6, threshold: 0.3, weakMult: 1.5 }, desc: '6× damage below 30% HP, else 1.5×.' },
    { id: 'whirlwind', name: 'Whirlwind', emoji: '🌀', school: 'Fury', cost: 30, cdMs: 15000, unlockLevel: 20,
      effect: { kind: 'strike', mult: 3.0 }, desc: 'Spin for 3× damage.' },
    { id: 'battle-shout', name: 'Battle Shout', emoji: '📯', school: 'Fury', cost: 15, cdMs: 30000, unlockLevel: 25,
      effect: { kind: 'shout', atkPct: 20, sec: 12 }, desc: '+20% attack for 12s.' },
    { id: 'pummel', name: 'Pummel', emoji: '👊', school: 'Arms', cost: 10, cdMs: 12000, unlockLevel: 30,
      effect: { kind: 'strikeInt', mult: 1.5, interruptSec: 3 }, desc: "1.5× damage and delay the enemy's next attack by 3s." },
    { id: 'challenging-shout', name: 'Challenging Shout', emoji: '🗣️', school: 'Protection', cost: 15, cdMs: 25000, unlockLevel: 35,
      effect: { kind: 'shout', dmgTakenPct: -30, sec: 10 }, desc: 'Take 30% less damage for 10s.' },
  ],
  mage: [
    { id: 'arcane-blast', name: 'Arcane Blast', emoji: '🔮', school: 'Arcane', cost: 15, cdMs: 6000, unlockLevel: 1,
      effect: { kind: 'strike', mult: 2.0 }, desc: 'Blast for 2× Arcane damage.' },
    { id: 'fireball', name: 'Fireball', emoji: '🔥', school: 'Fire', cost: 25, cdMs: 10000, unlockLevel: 1,
      effect: { kind: 'debuff', mult: 3.0, debuffKind: 'burn', debuffMult: 0.3, debuffSec: 8 }, desc: 'Hurl a fireball for 3× damage plus burn: 0.3× attack for 8s.' },
    { id: 'frostbolt', name: 'Frostbolt', emoji: '❄️', school: 'Frost', cost: 20, cdMs: 8000, unlockLevel: 10,
      effect: { kind: 'slow', mult: 2.5, slowPct: 30, slowSec: 8 }, desc: '2.5× damage and the enemy attacks 30% slower for 8s.' },
    { id: 'arcane-missiles', name: 'Arcane Missiles', emoji: '🌠', school: 'Arcane', cost: 35, cdMs: 14000, unlockLevel: 15,
      effect: { kind: 'strike', mult: 4.0 }, desc: 'A barrage dealing 4× Arcane damage.' },
    { id: 'frost-nova', name: 'Frost Nova', emoji: '🧊', school: 'Frost', cost: 30, cdMs: 25000, unlockLevel: 20,
      effect: { kind: 'slow', mult: 1.5, slowPct: 60, slowSec: 8 }, desc: "1.5× damage and slow the enemy's attacks 60% for 8s." },
    { id: 'pyroblast', name: 'Pyroblast', emoji: '☄️', school: 'Fire', cost: 50, cdMs: 20000, unlockLevel: 25,
      effect: { kind: 'strike', mult: 5.5 }, desc: 'A massive pyroblast for 5.5× damage.' },
    { id: 'blizzard', name: 'Blizzard', emoji: '🌨️', school: 'Frost', cost: 45, cdMs: 22000, unlockLevel: 30,
      effect: { kind: 'dot', mult: 2.0, dotMult: 0.75, dotTicks: 4, dotEveryMs: 2000 }, desc: '2× damage plus 0.75× chill every 2s, 4 times.' },
    { id: 'blink', name: 'Blink', emoji: '💫', school: 'Arcane', cost: 20, cdMs: 30000, unlockLevel: 35,
      effect: { kind: 'dodge', pct: 40, sec: 6 }, desc: '+40% dodge for 6s.' },
  ],
  druid: [
    { id: 'moonfire', name: 'Moonfire', emoji: '🌙', school: 'Balance', cost: 15, cdMs: 8000, unlockLevel: 1,
      effect: { kind: 'dot', mult: 1.5, dotMult: 0.5, dotTicks: 4, dotEveryMs: 2000 }, desc: '1.5× damage plus moonburn: 0.5× every 2s, 4 times.' },
    { id: 'wrath', name: 'Wrath', emoji: '🌩️', school: 'Balance', cost: 20, cdMs: 6000, unlockLevel: 1,
      effect: { kind: 'strike', mult: 2.5 }, desc: "Call down nature's wrath for 2.5× damage." },
    { id: 'rejuvenation', name: 'Rejuvenation', emoji: '🌱', school: 'Restoration', cost: 25, cdMs: 15000, unlockLevel: 10,
      effect: { kind: 'hot', healPct: 4, ticks: 6, everyMs: 2000 }, desc: 'Heal 4% max HP every 2s for 12s.' },
    { id: 'bear-form', name: 'Bear Form', emoji: '🐻', school: 'Feral', cost: 30, cdMs: 40000, unlockLevel: 15,
      effect: { kind: 'form', hpPct: 40, defPct: 25, sec: 20 }, desc: 'Shapeshift: +40% max HP and +25% defense for 20s.' },
    { id: 'cat-form', name: 'Cat Form', emoji: '🐱', school: 'Feral', cost: 30, cdMs: 40000, unlockLevel: 20,
      effect: { kind: 'form', atkPct: 15, atkSpdPct: 20, sec: 20 }, desc: 'Shapeshift: +15% attack and +20% attack speed for 20s.' },
    { id: 'rake', name: 'Rake', emoji: '🐾', school: 'Feral', cost: 20, cdMs: 12000, unlockLevel: 25,
      effect: { kind: 'dot', mult: 1.5, dotMult: 0.5, dotTicks: 5, dotEveryMs: 2000, bleed: true }, desc: '1.5× damage plus bleeding: 0.5× every 2s, 5 times.' },
    { id: 'regrowth', name: 'Regrowth', emoji: '🌿', school: 'Restoration', cost: 35, cdMs: 20000, unlockLevel: 30,
      effect: { kind: 'hot', instantPct: 15, healPct: 3, ticks: 5, everyMs: 2000 }, desc: 'Heal 15% instantly plus 3% max HP every 2s for 10s.' },
    { id: 'tranquility', name: 'Tranquility', emoji: '✨', school: 'Restoration', cost: 50, cdMs: 60000, unlockLevel: 35,
      effect: { kind: 'hot', healPct: 6, ticks: 6, everyMs: 2000 }, desc: 'Heal 6% max HP every 2s for 12s.' },
  ],
  assassin: [
    { id: 'sinister-strike', name: 'Sinister Strike', emoji: '🗡️', school: 'Combat', gain: 10, cdMs: 6000, unlockLevel: 1,
      effect: { kind: 'strike', mult: 1.5 }, desc: 'Strike for 1.5× damage. Generates 10 Energy.' },
    { id: 'eviscerate', name: 'Eviscerate', emoji: '💥', school: 'Assassination', cost: 25, cdMs: 10000, unlockLevel: 1,
      effect: { kind: 'strike', mult: 3.0 }, desc: 'Finishing blow for 3× damage.' },
    { id: 'stealth', name: 'Stealth', emoji: '🌙', school: 'Subtlety', cost: 15, cdMs: 30000, unlockLevel: 10,
      effect: { kind: 'dodge', dodgePct: 30, sec: 10 }, desc: '+30% dodge for 10s.' },
    { id: 'backstab', name: 'Backstab', emoji: '🔪', school: 'Subtlety', cost: 20, cdMs: 8000, unlockLevel: 15,
      effect: { kind: 'strike', mult: 2.5 }, desc: 'Strike from the shadows for 2.5× damage.' },
    { id: 'poison-blade', name: 'Poison Blade', emoji: '☠️', school: 'Assassination', cost: 20, cdMs: 15000, unlockLevel: 20,
      effect: { kind: 'debuff', mult: 1.2, debuffKind: 'poison', debuffMult: 0.4, debuffSec: 10 }, desc: '1.2× damage plus poison: 0.4× attack every tick for 10s.' },
    { id: 'evasion', name: 'Evasion', emoji: '💨', school: 'Subtlety', cost: 25, cdMs: 45000, unlockLevel: 25,
      effect: { kind: 'dodge', dodgePct: 50, sec: 12 }, desc: '+50% dodge for 12s.' },
    { id: 'kidney-shot', name: 'Kidney Shot', emoji: '👊', school: 'Combat', cost: 15, cdMs: 20000, unlockLevel: 30,
      effect: { kind: 'strikeInt', mult: 1.5, interruptSec: 4 }, desc: "1.5× damage and delay the enemy's next attack by 4s." },
    { id: 'blade-flurry', name: 'Blade Flurry', emoji: '🌀', school: 'Combat', cost: 35, cdMs: 25000, unlockLevel: 35,
      effect: { kind: 'strike', mult: 4.0 }, desc: 'Whirl of blades for 4× damage.' },
  ],
  necromancer: [
    { id: 'shadow-bolt', name: 'Shadow Bolt', emoji: '🌑', school: 'Shadow', cost: 15, cdMs: 5000, unlockLevel: 1,
      effect: { kind: 'strike', mult: 2.0 }, desc: 'Hurl shadow for 2× damage.' },
    { id: 'raise-skeleton', name: 'Raise Skeleton', emoji: '💀', school: 'Summoning', cost: 30, cdMs: 30000, unlockLevel: 1,
      effect: { kind: 'petStrike', mult: 2.0 }, desc: 'A skeleton strikes for 2× damage.' },
    { id: 'drain-life', name: 'Drain Life', emoji: '🩸', school: 'Blood', cost: 20, cdMs: 12000, unlockLevel: 10,
      effect: { kind: 'dot', mult: 1.5, dotMult: 0.3, dotTicks: 4, dotEveryMs: 2000, lifesteal: true }, desc: '1.5× damage, siphoning life back to you.' },
    { id: 'bone-shield', name: 'Bone Shield', emoji: '🦴', school: 'Summoning', cost: 25, cdMs: 30000, unlockLevel: 15,
      effect: { kind: 'shield', pct: 25, sec: 10 }, desc: 'Absorb damage up to 25% of max HP for 10s.' },
    { id: 'plague', name: 'Plague', emoji: '🤢', school: 'Blood', cost: 20, cdMs: 15000, unlockLevel: 20,
      effect: { kind: 'dot', mult: 1.0, dotMult: 0.6, dotTicks: 6, dotEveryMs: 2000 }, desc: '1× damage plus plague: 0.6× every 2s, 6 times.' },
    { id: 'blood-pact', name: 'Blood Pact', emoji: '❤️', school: 'Blood', cost: 30, cdMs: 25000, unlockLevel: 25,
      effect: { kind: 'hot', instantPct: 20, healPct: 2, ticks: 5, everyMs: 2000 }, desc: 'Heal 20% instantly plus 2% max HP every 2s for 10s.' },
    { id: 'soul-harvest', name: 'Soul Harvest', emoji: '👻', school: 'Shadow', cost: 40, cdMs: 20000, unlockLevel: 30,
      effect: { kind: 'strike', mult: 4.5 }, desc: 'Rip the soul for 4.5× damage.' },
    { id: 'army-of-dead', name: 'Army of the Dead', emoji: '⚰️', school: 'Summoning', cost: 50, cdMs: 60000, unlockLevel: 35,
      effect: { kind: 'petStrike', mult: 5.0 }, desc: 'The dead rise to strike for 5× damage.' },
  ],
  berserker: [
    { id: 'raging-blow', name: 'Raging Blow', emoji: '😤', school: 'Rage', gain: 12, cdMs: 6000, unlockLevel: 1,
      effect: { kind: 'strike', mult: 1.8 }, desc: 'Strike for 1.8× damage. Generates 12 Rage.' },
    { id: 'bloodthirst', name: 'Bloodthirst', emoji: '🩸', school: 'Butchery', cost: 20, cdMs: 10000, unlockLevel: 1,
      effect: { kind: 'dot', mult: 2.5, dotMult: 0.2, dotTicks: 3, dotEveryMs: 2000, lifesteal: true }, desc: '2.5× damage, healing you for a portion.' },
    { id: 'enrage', name: 'Enrage', emoji: '💢', school: 'Rage', cost: 15, cdMs: 30000, unlockLevel: 10,
      effect: { kind: 'shout', atkPct: 25, sec: 12 }, desc: '+25% attack for 12s.' },
    { id: 'rampage', name: 'Rampage', emoji: '🌪️', school: 'Butchery', cost: 30, cdMs: 15000, unlockLevel: 15,
      effect: { kind: 'strike', mult: 3.5 }, desc: 'Unleash a rampage for 3.5× damage.' },
    { id: 'intimidating-shout', name: 'Intimidating Shout', emoji: '🗣️', school: 'Resilience', cost: 15, cdMs: 25000, unlockLevel: 20,
      effect: { kind: 'shout', dmgTakenPct: -25, sec: 10 }, desc: 'Take 25% less damage for 10s.' },
    { id: 'second-wind', name: 'Second Wind', emoji: '💚', school: 'Resilience', cost: 25, cdMs: 30000, unlockLevel: 25,
      effect: { kind: 'hot', healPct: 5, ticks: 5, everyMs: 2000 }, desc: 'Heal 5% max HP every 2s for 10s.' },
    { id: 'recklessness', name: 'Recklessness', emoji: '🎯', school: 'Rage', cost: 20, cdMs: 40000, unlockLevel: 30,
      effect: { kind: 'shout', atkPct: 40, sec: 8 }, desc: '+40% attack for 8s. No mercy.' },
    { id: 'titans-grip', name: "Titan's Grip", emoji: '💪', school: 'Butchery', cost: 40, cdMs: 25000, unlockLevel: 35,
      effect: { kind: 'strike', mult: 5.0 }, desc: 'Crush with titanic might for 5× damage.' },
  ],
};

export function spellsForClass(classId) { return CLASS_SPELLS[classId] || []; }
export function hasSpellbook(classId) { return spellsForClass(classId).length > 0; }
export function spellById(id) {
  for (const [cls, list] of Object.entries(CLASS_SPELLS)) {
    const d = list.find(x => x.id === id);
    if (d) return { ...d, classId: cls };
  }
  return null;
}
export function unlockedSpells(s) {
  if (!s) return [];
  return spellsForClass(s.playerClass)
    .filter(d => (s.level || 1) >= (d.unlockLevel || 1)).map(d => d.id);
}
// The customizable loadout: up to 6 unlocked spell ids. Auto-fills on
// unlock; the Spell Book UI writes via setSpellSlots.
export function ensureSpellSlots(s) {
  if (!s) return [];
  if (!Array.isArray(s.spellSlots)) s.spellSlots = [];
  const unlocked = new Set(unlockedSpells(s));
  s.spellSlots = s.spellSlots.filter(id => unlocked.has(id)).slice(0, SPELL_SLOT_COUNT);
  for (const id of unlocked) {
    if (s.spellSlots.length >= SPELL_SLOT_COUNT) break;
    if (!s.spellSlots.includes(id)) s.spellSlots.push(id);
  }
  return s.spellSlots;
}
export function setSpellSlots(s, slots) {
  if (!s || !Array.isArray(slots) || !slots.length || slots.length > SPELL_SLOT_COUNT) return false;
  const unlocked = new Set(unlockedSpells(s));
  if (!slots.every(id => typeof id === 'string' && unlocked.has(id))) return false;
  s.spellSlots = slots.slice();
  return true;
}

// ---- transient timed buffs (kept out of computeStats so core math is
// untouched; app.js applies them via applyBuffs after computeStats) ----
export function pruneBuffs(s) {
  if (!s || !Array.isArray(s.buffs)) return;
  const now = Date.now();
  const isShield = (k) => k === 'shield' || k === 'priest_shield' || k === 'pally_bubble';
  s.buffs = s.buffs.filter(b => b && b.until > now && (!isShield(b.kind) || b.amount > 0));
}
export function addBuff(s, kind, pct, sec) {
  if (!s) return;
  if (!Array.isArray(s.buffs)) s.buffs = [];
  const until = Date.now() + sec * 1000;
  const ex = s.buffs.find(b => b.kind === kind);
  if (ex) { ex.pct = pct; ex.until = until; } else s.buffs.push({ kind, pct, until });
}
// ---- Debuffs (damage over time, stuns, slows) ----
// Stored in s.debuffs, tick each round, shown with red icons
export const DEBUFF_DEFS = {
  bleed: { name: 'Bleed', icon: '🩸', desc: 'Taking physical damage over time' },
  poison: { name: 'Poisoned', icon: '☠️', desc: 'Taking nature damage over time' },
  burn: { name: 'Burning', icon: '🔥', desc: 'Taking fire damage over time' },
  stun: { name: 'Stunned', icon: '💫', desc: 'Cannot act' },
  slow: { name: 'Slowed', icon: '🐌', desc: 'Attack speed reduced' },
  weaken: { name: 'Weakened', icon: '📉', desc: 'Damage reduced' },
};
export function addDebuff(s, kind, value, sec) {
  if (!s || !DEBUFF_DEFS[kind]) return;
  if (!Array.isArray(s.debuffs)) s.debuffs = [];
  const until = Date.now() + sec * 1000;
  const ex = s.debuffs.find(d => d.kind === kind);
  if (ex) { ex.value = value; ex.until = until; } else s.debuffs.push({ kind, value, until });
}
export function pruneDebuffs(s) {
  if (!s || !Array.isArray(s.debuffs)) return;
  const now = Date.now();
  s.debuffs = s.debuffs.filter(d => d && d.until > now);
}
export function hasDebuff(s, kind) {
  if (!s || !Array.isArray(s.debuffs)) return false;
  return s.debuffs.some(d => d.kind === kind && d.until > Date.now());
}
export function tickDebuffs(s) {
  // Returns total DoT damage to apply this tick
  if (!s || !Array.isArray(s.debuffs)) return 0;
  pruneDebuffs(s);
  let dmg = 0;
  for (const d of s.debuffs) {
    if (d.kind === 'bleed' || d.kind === 'poison' || d.kind === 'burn') {
      dmg += d.value || 0;
    }
  }
  return dmg;
}
export function cleanseDebuffs(s) {
  if (!s) return;
  s.debuffs = [];
}
export function addShield(s, amount, sec) {
  if (!s) return;
  if (!Array.isArray(s.buffs)) s.buffs = [];
  s.buffs.push({ kind: 'shield', amount, until: Date.now() + sec * 1000 });
}
export function addPriestShield(s, amount, sec) {
  if (!s) return;
  if (!Array.isArray(s.buffs)) s.buffs = [];
  s.buffs.push({ kind: 'priest_shield', amount, until: Date.now() + sec * 1000 });
}
export function addPallyBubble(s, amount, sec) {
  if (!s) return;
  if (!Array.isArray(s.buffs)) s.buffs = [];
  s.buffs.push({ kind: 'pally_bubble', amount, until: Date.now() + sec * 1000 });
}
// Druid heals-over-time. Each hot ticks healPct% of max HP every everyMs.
export function addHot(s, fx) {
  if (!s || !fx) return;
  if (!Array.isArray(s.hots)) s.hots = [];
  if (fx.instantPct) {
    const stats = computeStats(s);
    s.hero.hp = Math.min(stats.maxHp, (s.hero.hp || 0) + Math.round(stats.maxHp * fx.instantPct / 100));
  }
  if (fx.healPct && fx.ticks > 0) {
    s.hots.push({ healPct: fx.healPct, ticksLeft: fx.ticks,
      everyMs: fx.everyMs || 2000, nextAt: Date.now() + (fx.everyMs || 2000) });
  }
}
export function tickHots(s) {
  if (!s || !Array.isArray(s.hots) || !s.hots.length) return 0;
  const now = Date.now();
  const stats = computeStats(s);
  let healed = 0;
  for (const h of s.hots) {
    if (h.ticksLeft > 0 && now >= h.nextAt) {
      h.ticksLeft -= 1;
      h.nextAt = now + h.everyMs;
      const amt = Math.max(1, Math.round(stats.maxHp * h.healPct / 100));
      s.hero.hp = Math.min(stats.maxHp, (s.hero.hp || 0) + amt);
      healed += amt;
    }
  }
  s.hots = s.hots.filter(h => h.ticksLeft > 0);
  return healed;
}
export function applyBuffs(stats, s) {
  if (!stats) return stats;
  pruneBuffs(s);
  for (const b of (s.buffs || [])) {
    if (b.kind === 'atkPct') stats.attack *= 1 + b.pct / 100;
    else if (b.kind === 'dodgePct') stats.dodge = (stats.dodge || 0) + b.pct;
    else if (b.kind === 'hpPct') stats.maxHp = Math.max(1, Math.round((stats.maxHp || 0) * (1 + b.pct / 100)));
    else if (b.kind === 'defPct') stats.defense = Math.max(0, Math.round((stats.defense || 0) * (1 + b.pct / 100)));
    else if (b.kind === 'atkSpdPct') stats.attackSpeed = (stats.attackSpeed || 0) * (1 + b.pct / 100);
  }
  return stats;
}
// Druid shapeshift: pushes one timed buff per stat the form grants.
export function addForm(s, fx) {
  if (!s || !fx) return;
  if (!Array.isArray(s.buffs)) s.buffs = [];
  const until = Date.now() + (fx.sec || 0) * 1000;
  for (const kind of ['hpPct', 'defPct', 'atkPct', 'atkSpdPct']) {
    const pct = fx[kind];
    if (!pct) continue;
    const ex = s.buffs.find(b => b.kind === kind);
    if (ex) { ex.pct = pct; ex.until = until; } else s.buffs.push({ kind, pct, until });
  }
}
export function damageTakenMult(s) {
  let m = 1;
  for (const b of ((s && s.buffs) || [])) {
    if (b.kind === 'dmgTakenPct' && b.until > Date.now()) m *= 1 + b.pct / 100;
  }
  return m;
}
export function absorbShield(s, dmg) {
  let rem = dmg;
  for (const b of ((s && s.buffs) || [])) {
    if ((b.kind !== 'shield' && b.kind !== 'priest_shield' && b.kind !== 'pally_bubble') || b.until <= Date.now() || b.amount <= 0) continue;
    const take = Math.min(b.amount, rem);
    b.amount -= take; rem -= take;
    if (rem <= 0) break;
  }
  pruneBuffs(s);
  return rem;
}

// ---- potions: independent 60s cooldown (app.js), never shared with spells ----
export const POTION_CD_MS = 60000;
export const POTION_DROP_CHANCE = 0.08;
export function grantPotionDrop(s) {
  if (!s) return null;
  if (!s.potions || typeof s.potions !== 'object') s.potions = { health: 0, resource: 0 };
  const kind = Math.random() < 0.5 ? 'health' : 'resource';
  s.potions[kind] = (s.potions[kind] || 0) + 1;
  return kind;
}
export function drinkPotion(s, kind, stats) {
  if (!s || !s.potions || (s.potions[kind] || 0) < 1) return { ok: false, reason: 'none' };
  s.potions[kind] -= 1;
  if (kind === 'health') {
    const amount = Math.round(((stats && stats.maxHp) || 1) * 0.4);
    s.hero.hp = Math.min(stats.maxHp, s.hero.hp + amount);
    return { ok: true, kind, amount };
  }
  const id = resourceIdFor(s);
  const d = resDef(id);
  if (!id || !d) { s.potions[kind] += 1; return { ok: false, reason: 'none' }; }
  gainRes(s, id, d.max * 0.5);
  return { ok: true, kind, amount: Math.round(d.max * 0.5), res: id };
}

// ---------------- Skill mastery ----------------
// Each active skill tracks lifetime casts in state.skillUses[id].
// Mastery level = min(10, floor(uses / 25)); each level grants +2%
// effectiveness (damage for strikes, healing for Heal).
export const MASTERY_USES_PER_LEVEL = 25;
export const MASTERY_MAX_LEVEL = 10;
export const MASTERY_PCT_PER_LEVEL = 0.02;

export function skillUses(state, id) {
  const m = state && state.skillUses;
  return (m && Number.isFinite(Number(m[id]))) ? Math.max(0, Math.floor(Number(m[id]))) : 0;
}
export function skillMastery(state, id) {
  const uses = skillUses(state, id);
  const level = Math.min(MASTERY_MAX_LEVEL, Math.floor(uses / MASTERY_USES_PER_LEVEL));
  return {
    uses,
    level,
    pct: level * MASTERY_PCT_PER_LEVEL,
    nextAt: (level + 1) * MASTERY_USES_PER_LEVEL,
  };
}
export function recordSkillUse(state, id) {
  // Mastery tracks both legacy skills and spellbook spells.
  if (!state || !(SKILLS[id] || spellById(id))) return null;
  if (!state.skillUses || typeof state.skillUses !== 'object') state.skillUses = {};
  const before = skillMastery(state, id).level;
  state.skillUses[id] = skillUses(state, id) + 1;
  const after = skillMastery(state, id);
  return { ...after, leveledUp: after.level > before };
}

// ---------------- Class resources ----------------
// Generic resource pools. Rogue energy came first; this table drives
// Focus (hunter), Rage (warrior/berserker) and Mana (mage/necromancer).
//
// Resource formulas (v1):
//   Focus:  +8/s in battle; Steady Shot generates +15 on cast.
//   Mana:   +6/s in battle.
//   Energy: +10/s in battle (unchanged).
//   Rage:   +2 per hero strike landed, +5 per enemy hit taken;
//           decays 5/s with no active enemy (dead / between spawns / inn);
//           resets to 0 on load and on class change.
export const ENERGY_MAX = 100;
export const ENERGY_REGEN = 10;
export const RAGE_PER_STRIKE = 2;
export const RAGE_PER_HIT_TAKEN = 5;
export const RAGE_DECAY_PER_SEC = 5;

export const RESOURCES = {
  focus:  { name: 'Focus',  emoji: '🎯', max: 100, regen: 8 },
  rage:   { name: 'Rage',   emoji: '😡', max: 100, regen: 0 }, // combat-built only
  mana:   { name: 'Mana',   emoji: '🔷', max: 100, regen: 6 },
  energy: { name: 'Energy', emoji: '⚡', max: 100, regen: 10 },
};
export const CLASS_RESOURCE = {
  hunter: 'focus', warrior: 'rage', mage: 'mana',
  assassin: 'energy', necromancer: 'mana', berserker: 'rage', druid: 'mana',
};

// The 'assassin' key displays as Rogue (renamed 2026-09-30); the key is
// kept so existing saves keep working.
export function isRogue(s) { return !!s && s.playerClass === 'assassin'; }

export function resourceIdFor(s) { return (s && CLASS_RESOURCE[s.playerClass]) || null; }
export function resDef(id) { return RESOURCES[id] || null; }
export function gainRes(s, id, n) {
  const d = resDef(id);
  if (!s || !d) return 0;
  s[id] = Math.min(d.max, Math.max(0, (s[id] || 0) + n));
  return s[id];
}
export function spendRes(s, id, n) {
  const d = resDef(id);
  if (!s || !d || (s[id] || 0) < n) return false;
  s[id] -= n;
  return true;
}
// Per-second regen for focus/mana/energy. Rage never regens — app.js
// grants it on dealing/taking damage and decays it out of combat.
export function tickResources(s, dt) {
  const id = resourceIdFor(s);
  if (!id || id === 'rage') return;
  const d = resDef(id);
  if (d.regen > 0) gainRes(s, id, d.regen * dt);
}
export function gainRage(s, n) { return gainRes(s, 'rage', n); }
export function decayRage(s, dt) { return gainRes(s, 'rage', -RAGE_DECAY_PER_SEC * dt); }
// Rogue wrappers now delegate (same API as before, already tested).
export function gainEnergy(s, n) { return gainRes(s, 'energy', n); }
export function spendEnergy(s, n) { return spendRes(s, 'energy', n); }
export function tickEnergy(s, dt) { if (isRogue(s)) gainRes(s, 'energy', ENERGY_REGEN * dt); }

export function gainXp(state, baseAmount, nowMs = Date.now(), partyXpPct = 0) {
  const race = RACES[state.race] || {};
  const stats = computeStats(state);
  const rested = state.restedUntil && nowMs < state.restedUntil;
  // Anti-power-creep: ONE +40% ceiling over gear + guild perk + party bonus
  // combined (v20 — was additive up to +120%: 40% gear, 40% guild, 40% party).
  // computeStats() still reports the true gear total so tooltips stay truthful.
  const gearPct = Math.min(40, stats.xpBonus || 0);
  const guildPct = Math.max(0, Math.min(40, GUILD_PERKS.xpPct || 0));
  const partyPct = Math.max(0, Math.min(40, Number(partyXpPct) || 0));
  const xpBonusPct = Math.min(40, gearPct + guildPct + partyPct);
  // Manual 2x event multiplier (staff toggle).
  // Auto 2x during Halloween event (Oct 3 - Nov 1, 2026).
  const halloween2x = isEventActive('HALLOWEEN') ? 2 : 1;
  const eventMult = Math.max(state.xpMultiplier || 1.0, halloween2x);
  // GM xp buff multiplier
  const buffMult = getBuffMult(state, 'xp');
  const amount = Math.max(1, Math.round(
    baseAmount * (race.xpMult || 1) * (1 + xpBonusPct / 100) * (rested ? 1.25 : 1) * eventMult * buffMult
  ));
  state.xp += amount;
  const levels = [];
  const milestones = [];
  let guard = 0;
  // REMASTER: Guest accounts cap at level 20, full accounts at 60.
  const levelCap = state.isGuest ? GUEST_MAX_LEVEL : MAX_LEVEL;
  while (state.xp >= state.xpNext && guard++ < 10000 && state.level < levelCap) {
    state.xp -= state.xpNext;
    state.level += 1;
    state.hero.attack += 3;
    state.hero.maxHp += 25;
    state.hero.defense += 2;
    state.xpNext = xpForLevel(state.level);
    levels.push(state.level);
    if (MILESTONE_LEVELS.includes(state.level)) {
      milestones.push(state.level);
    }
  }
  // Class talent points: 1 per 5 levels from 10 + milestone bonuses.
  // Reconciled (never reduced) so retroactive grants just work.
  const talentPoints = reconcileTalentPoints(state);
  if (state.level >= MAX_LEVEL) state.xp = 0; // cap reached: bank no XP past it
  if (levels.length) {
    const s2 = computeStats(state);
    state.hero.hp = Math.min(s2.maxHp, state.hero.hp + s2.maxHp * 0.25);
  }
  // Auto-unlock active skills whose level requirement was just met.
  // Spellbook classes (hunter/warrior/mage) unlock spells instead, via
  // ensureSpellSlots — they never draw from the generic SKILLS table.
  if (!Array.isArray(state.skills)) state.skills = ['power-strike'];
  const newSkills = [];
  if (!hasSpellbook(state.playerClass)) {
    for (const id of SKILL_ORDER) {
      const def = SKILLS[id];
      if (def.unlockLevel <= state.level && !state.skills.includes(id)) {
        state.skills.push(id);
        newSkills.push(id);
      }
    }
  } else {
    const before = new Set(state.spellSlots || []);
    ensureSpellSlots(state);
    for (const id of state.spellSlots) if (!before.has(id)) newSkills.push(id);
  }
  return { gained: amount, levels, milestones, skills: newSkills, talentPoints };
}

// ---------------- Quests ----------------
// Daily + weekly quest board. Progress uses snapshot baselines taken when
// quests roll, so leaving and returning never double-counts. All client-side
// in the save blob (gameplay is already client-simulated).
export const QUEST_DEFS = [
  { id: 'q-slay-d', period: 'daily', emoji: '⚔️', name: 'Monster Slayer', metric: 'kills', kind: 'gain',
    target: () => 150, desc: (t) => `Slay ${t} enemies` },
  { id: 'q-tap-d', period: 'daily', emoji: '👆', name: 'Relentless', metric: 'taps', kind: 'gain',
    target: () => 300, desc: (t) => `Tap ${t} times` },
  { id: 'q-stage-d', period: 'daily', emoji: '🗺️', name: 'Climber', metric: 'stage', kind: 'reach',
    target: (s) => (s.stage || 1) + 20, desc: (t) => `Reach stage ${t}` },
  { id: 'q-boss-d', period: 'daily', emoji: '👹', name: 'Boss Hunter', metric: 'bosses', kind: 'gain',
    target: () => 3, desc: (t) => `Defeat ${t} bosses` },
  { id: 'q-slay-w', period: 'weekly', emoji: '⚔️', name: 'Exterminator', metric: 'kills', kind: 'gain',
    target: () => 1200, desc: (t) => `Slay ${t} enemies` },
  { id: 'q-boss-w', period: 'weekly', emoji: '👹', name: 'Giantslayer', metric: 'bosses', kind: 'gain',
    target: () => 15, desc: (t) => `Defeat ${t} bosses` },
  { id: 'q-level-w', period: 'weekly', emoji: '⬆️', name: 'Ascendant', metric: 'level', kind: 'reach',
    target: (s) => Math.min(MAX_LEVEL, (s.level || 1) + 5), desc: (t) => `Reach level ${t}` },
  { id: 'q-raid-w', period: 'weekly', emoji: '🌀', name: 'Wave Rider', metric: 'raid', kind: 'reach',
    target: (s) => Math.max(10, ((s.raid && s.raid.best) || 0) + 5), desc: (t) => `Reach raid wave ${t}` },
  // Halloween 2026 event quests (Oct 3-31). Give shard rewards.
  { id: 'q-spooky-d', period: 'daily', emoji: '🎃', name: 'Spooky Slayers', metric: 'kills', kind: 'gain',
    target: () => 50, desc: (t) => `Slay ${t} enemies`, event: 'HALLOWEEN',
    reward: { xp: 15000, shards: 3 } },
  { id: 'q-exorcist-d', period: 'daily', emoji: '👻', name: 'Boss Exorcist', metric: 'bosses', kind: 'gain',
    target: () => 5, desc: (t) => `Defeat ${t} bosses`, event: 'HALLOWEEN',
    reward: { xp: 30000, gold: 20000, shards: 5 } },
];

// ---------------- One-time story quests ----------------
// Class questlines + the skill-mastery track. Unlike dailies/weeklies these
// never roll: each entry is created once (baseline snapshot at first sight)
// and stays until claimed. Class quests are only visible to that class.
export const STORY_QUEST_DEFS = [
  { id: 'q-mage-1', group: 'class', classId: 'mage', requiresSkill: 'fireball',
    emoji: '🔥', name: 'Spark of the Arcane',
    metric: 'fireballUses', kind: 'gain', target: 25,
    desc: (t) => `Cast Fireball ${t} times` },
  { id: 'q-mage-2', group: 'class', classId: 'mage',
    emoji: '⚔️', name: 'Battle Mage',
    metric: 'kills', kind: 'gain', target: 200,
    desc: (t) => `Defeat ${t} enemies as a mage` },
  { id: 'q-mage-3', group: 'class', classId: 'mage',
    emoji: '🔮', name: "Archmage's Trial",
    metric: 'level', kind: 'reach', target: 30,
    desc: (t) => `Reach level ${t} as a mage` },
  // ---------------- Guided onboarding chain ----------------
  // One-time quests that introduce the game's systems one at a time, in the
  // order a new player should meet them. Each step unlocks only after the
  // previous one is claimed (see `requires` + storyQuestLockedReason).
  { id: 'q-guide-1', group: 'guide',
    emoji: '🗡️', name: 'First Blood',
    metric: 'kills', kind: 'gain', target: 1,
    desc: () => `Defeat 1 enemy (Battle tab)` },
  { id: 'q-guide-2', group: 'guide', requires: 'q-guide-1',
    emoji: '⛏️', name: 'Delve Deeper',
    metric: 'mine', kind: 'gain', target: 10,
    desc: (t) => `Mine ${t} ore (Mine tab)` },
  { id: 'q-guide-3', group: 'guide', requires: 'q-guide-2',
    emoji: '🐾', name: 'Loyal Companion',
    metric: 'pets', kind: 'gain', target: 1,
    desc: () => `Hatch or tame a pet (Party → Pets — try the cheap Stray Egg!)` },
  { id: 'q-guide-4', group: 'guide', requires: 'q-guide-3',
    emoji: '🔨', name: 'Forge Ahead',
    metric: 'forge', kind: 'gain', target: 1,
    desc: () => `Forge a Galaxy item or enchant any gear to +1 (Gear tab)` },
  { id: 'q-guide-5', group: 'guide', requires: 'q-guide-4',
    emoji: '🏰', name: 'Strength in Numbers',
    metric: 'guild', kind: 'reach', target: 1,
    desc: () => `Visit the Guilds tab (join one for perks!)` },
  { id: 'q-guide-6', group: 'guide', requires: 'q-guide-5',
    emoji: '👑', name: 'Make a Name',
    metric: 'title', kind: 'reach', target: 1,
    desc: () => `Equip a title (Titles tab)` },
  { id: 'q-guide-7', group: 'guide', requires: 'q-guide-6',
    emoji: '🌿', name: 'Specialize',
    metric: 'profession', kind: 'reach', target: 1,
    desc: () => `Invest a point in a profession (Settings → Professions)` },
  { id: 'q-guide-8', group: 'guide', requires: 'q-guide-7',
    emoji: '📜', name: 'Daily Grind',
    metric: 'questsCompleted', kind: 'gain', target: 1,
    desc: () => `Complete any daily or weekly quest — you're on your own now!` },
];

export function storyQuestVisible(state, def) {
  if (def.group === 'class' && (!state || state.playerClass !== def.classId)) return false;
  return true;
}

// Sequential gating for the guided onboarding chain: a quest with
// `requires` stays locked until the named quest is claimed.
export function storyQuestLockedReason(state, def) {
  if (!def || !def.requires) return null;
  const prev = STORY_QUEST_DEFS.find((d) => d.id === def.requires);
  const entry = (state && state.quests && Array.isArray(state.quests.story))
    ? state.quests.story.find((e) => e.id === def.requires) : null;
  if (entry && entry.claimed) return null;
  return `Complete “${prev ? prev.name : def.requires}” first`;
}

// Creates missing story entries once (with baseline snapshots for 'gain'
// quests so prior progress never double-counts). Safe to call often.
export function ensureStoryQuests(state, nowMs = Date.now()) {
  ensureQuests(state, nowMs);
  const q = state.quests;
  if (!Array.isArray(q.story)) q.story = [];
  for (const def of STORY_QUEST_DEFS) {
    if (!q.story.find((e) => e.id === def.id)) {
      q.story.push({
        id: def.id,
        target: def.target,
        base: questMetric(state, def.metric),
        claimed: false,
      });
    }
  }
  return q.story;
}

export function storyQuestProgress(state, entry) {
  const def = STORY_QUEST_DEFS.find((d) => d.id === entry.id);
  if (!def) return { progress: 0, target: 1, complete: false, def: null };
  const cur = questMetric(state, def.metric);
  const progress = def.kind === 'reach' ? cur : Math.max(0, cur - (entry.base || 0));
  return { progress, target: entry.target, complete: progress >= entry.target, def };
}

function questMetric(state, metric) {
  // Mastery metrics: 'mastery:<skill-id>' or 'mastery:any' (best skill level).
  if (typeof metric === 'string' && metric.startsWith('mastery:')) {
    const which = metric.slice('mastery:'.length);
    if (which === 'any') return Math.max(0, ...SKILL_ORDER.map((id) => skillMastery(state, id).level));
    return skillMastery(state, which).level;
  }
  switch (metric) {
    case 'taps': return (state.stats && state.stats.taps) || 0;
    case 'kills': return (state.stats && state.stats.kills) || 0;
    case 'bosses': return state.bossesKilled || 0;
    case 'stage': return state.stage || 1;
    case 'level': return state.level || 1;
    case 'raid': return (state.raid && state.raid.best) || 0;
    case 'fireballUses': return skillUses(state, 'fireball');
    case 'mine': return ((state.mine || {}).totalMined) || 0;
    case 'pets': return (state.pets && Array.isArray(state.pets.collection)) ? state.pets.collection.length : 0;
    case 'guild': return (state.guideTabs && state.guideTabs.guild) ? 1 : 0;
    case 'questsCompleted': return (state.stats && state.stats.questsCompleted) || 0;
    case 'title': return (state.activeTitle && state.activeTitle !== 'wanderer') ? 1 : 0;
    case 'profession': {
      const prof = state.professions || {};
      return Math.max(1, ...Object.values(prof).map((v) => Number(v) || 1)) > 1 ? 1 : 0;
    }
    case 'forge': {
      const f = state.forge || {};
      let n = (f.weapon ? 1 : 0) + (f.armor ? 1 : 0);
      // Enchanting any gear to +1 also counts as "forging ahead". Count every
      // enchanted piece (not just "any exists") so the metric keeps climbing
      // as you enchant more — otherwise a veteran whose snapshot already
      // includes an enchanted item could never move the counter again.
      const slots = state.equipped || {};
      const inv = Array.isArray(state.inventory) ? state.inventory : [];
      const items = [...Object.values(slots), ...inv];
      n += items.filter((it) => it && Number(it.enchant) > 0).length;
      return n;
    }
    default: return 0;
  }
}

export function questDailyKey(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

export function questWeeklyKey(nowMs = Date.now()) {
  // ISO week id YYYY-Www (UTC).
  const d = new Date(nowMs);
  const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  thu.setUTCDate(thu.getUTCDate() - ((thu.getUTCDay() + 6) % 7) + 3);
  const firstThu = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  firstThu.setUTCDate(firstThu.getUTCDate() - ((firstThu.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((thu - firstThu) / (7 * 864e5));
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollQuestSet(state, period, key, count) {
  const pool = QUEST_DEFS.filter((q) => q.period === period);
  const rnd = mulberry32(hashStr(key + ':' + period));
  const order = pool.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, count).map((def) => ({
    id: def.id,
    target: def.target(state),
    base: questMetric(state, def.metric),
    claimed: false,
  }));
}

// Rolls fresh quest sets when the day/week key changes. Safe to call often.
export function ensureQuests(state, nowMs = Date.now()) {
  if (!state.quests || typeof state.quests !== 'object') state.quests = {};
  const q = state.quests;
  const dk = questDailyKey(nowMs);
  if (q.dailyKey !== dk || !Array.isArray(q.daily)) {
    q.dailyKey = dk;
    q.daily = rollQuestSet(state, 'daily', dk, 3);
  }
  const wk = questWeeklyKey(nowMs);
  if (q.weeklyKey !== wk || !Array.isArray(q.weekly)) {
    q.weeklyKey = wk;
    q.weekly = rollQuestSet(state, 'weekly', wk, 2);
  }
  return q;
}

export function questProgress(state, entry) {
  const def = QUEST_DEFS.find((d) => d.id === entry.id);
  if (!def) return { progress: 0, target: 1, complete: false, def: null };
  const cur = questMetric(state, def.metric);
  const progress = def.kind === 'reach' ? cur : Math.max(0, cur - (entry.base || 0));
  return { progress, target: entry.target, complete: progress >= entry.target, def };
}

// Reward preview (also used by claimQuest). Scales with level at claim time.
export function questRewardPreview(state, period) {
  const L = Math.max(1, state.level || 1);
  if (period === 'weekly') {
    return { gold: 10000 * L, stars: 40, xp: Math.round(xpForLevel(L) * 1.5) };
  }
  if (period === 'story') {
    return { gold: 5000 * L, stars: 20, xp: Math.round(xpForLevel(L) * 0.75) };
  }
  return { gold: 2000 * L, stars: 8, xp: Math.round(xpForLevel(L) * 0.3) };
}

export function claimQuest(state, period, id, nowMs = Date.now()) {
  ensureQuests(state, nowMs);
  ensureStoryQuests(state, nowMs);
  const list = period === 'weekly' ? state.quests.weekly
    : period === 'story' ? state.quests.story
    : state.quests.daily;
  const entry = (list || []).find((e) => e.id === id);
  if (!entry || entry.claimed) return { ok: false };
  const prog = period === 'story' ? storyQuestProgress(state, entry) : questProgress(state, entry);
  if (!prog.complete) return { ok: false };
  // Defense in depth: class quests can't be claimed by another class even if
  // a crafted client sends the id.
  if (period === 'story') {
    const def = STORY_QUEST_DEFS.find((d) => d.id === id);
    if (!def || !storyQuestVisible(state, def)) return { ok: false };
    // Guided chain: a step can't be claimed before its prerequisite.
    if (storyQuestLockedReason(state, def)) return { ok: false };
  }
  entry.claimed = true;
  const rw = questRewardPreview(state, period);
  // Halloween event quests have custom fixed rewards (including shards).
  const def = QUEST_DEFS.find((d) => d.id === id);
  if (def && def.reward) {
    if (def.reward.xp) {
      const xpRes = gainXp(state, def.reward.xp, nowMs);
      rw.xp = def.reward.xp;
      rw.levels = xpRes.levels;
    }
    if (def.reward.gold) {
      addGold(state, def.reward.gold);
      rw.gold = def.reward.gold;
    }
    if (def.reward.shards) {
      if (!state.materials) state.materials = {};
      state.materials.pumpkin_shard = (state.materials.pumpkin_shard || 0) + def.reward.shards;
      rw.shards = def.reward.shards;
    }
    rw.stars = 0; // Event quests don't give stars, they give shards.
  } else {
    addGold(state, rw.gold);
  }
  if (!state.stats || typeof state.stats !== 'object') state.stats = {};
  state.stats.questsCompleted = Math.max(0, Math.floor(Number(state.stats.questsCompleted) || 0)) + 1;
  state.stars = Math.min(1e15, Math.max(0, Number(state.stars) || 0) + rw.stars);
  if (!def || !def.reward || !def.reward.xp) {
    const xpRes = gainXp(state, rw.xp, nowMs);
    rw.levels = xpRes.levels;
  }
  return { ok: true, rewards: rw, levels: rw.levels, skills: [] };
}

// ---------------- Worlds ----------------
// Battle areas unlocked at stage thresholds. Each world has its own enemy
// roster, boss roster, tagline, and ambient background scene. Enemy STATS
// still scale purely with stage (see enemyFor) — worlds change who you fight
// and the art direction, never the numbers (balance-neutral by design).
const _E = (name, emoji) => ({ name, emoji });
export const WORLDS = [
  { id: 'gloomwood', name: 'Gloomwood', emoji: '🌲', minStage: 1,
    bgScene: 'shadow-eyes', tagline: 'Where the dark first learned to hunt.',
    enemies: [
      _E('Gloomfang Wolf', '🐺'), _E('Moss Troll', '🧌'), _E('Cave Stalker', '🥷'),
      _E('Ridgeback Boar', '🐗'), _E('Thorn Lurker', '🦔'), _E('Dusk Panther', '🐆'),
      _E('Hollow Bat', '🦇'), _E('Plague Rat', '🐀'), _E('Frost Wisp', '👻'),
      _E('Grave Hound', '🐕'),
    ],
    bosses: [ _E('Warlord Ghash', '👹'), _E('Broodmother Xix', '🕷️'),
      _E('The Briar Tyrant', '🌳'), _E('Duskmaw the Render', '🐺'),
      _E('The Hollow Druid', '🧙'), _E('Carrion Queen Vess', '🦅'),
      _E('Thornback Colossus', '🦏'), _E('The Weeping Treant', '🌲') ] },
  { id: 'ember-wastes', name: 'Ember Wastes', emoji: '🔥', minStage: 100,
    bgScene: 'ember-drift', tagline: 'Ash falls like snow. Nothing here forgives.',
    enemies: [
      _E('Ember Imp', '👺'), _E('Cinder Sprite', '🔥'), _E('Ash Serpent', '🐍'),
      _E('Crimson Slime', '🩸'), _E('Sand Reaver', '🦂'), _E('Rune Scarab', '🪲'),
      _E('Stone Sentinel', '🗿'), _E('Mire Shambler', '🧟'), _E('Dark Acolyte', '🧙'),
      _E('Bone Archer', '💀'),
    ],
    bosses: [ _E('Ancient Wyrm Vex', '🐉'), _E('Dreadlord Malachar', '😈'),
      _E('The Cinder Matriarch', '🔥'), _E('Ashfall Behemoth', '🦣'),
      _E('Pyrelord Ignix', '👺'), _E('The Obsidian Golem', '🗿'),
      _E('Searwing Terror', '🦇'), _E('The Scorched Prophet', '🧙') ] },
  { id: 'void-abyss', name: 'The Void Abyss', emoji: '🌀', minStage: 250,
    bgScene: 'void-tide', tagline: 'Below the world, the dark dreams of you.',
    enemies: [
      _E('Void Stalker', '🌀'), _E('Abyss Maw', '👁️'), _E('Null Wraith', '🌫️'),
      _E('Rift Horror', '🕳️'), _E('Umbral Knight', '⚔️'), _E('Nether Wisp', '💫'),
      _E('Gloom Devourer', '🧛'), _E('Duskrend Hound', '🐕‍🦺'),
    ],
    bosses: [ _E('Voidlord Zerath', '🌌'), _E('The Starless One', '🌑'),
      _E('Riftmother Nyx', '🕳️'), _E('The Unraveled King', '👑'),
      _E('Duskmother Vhara', '🧛'), _E('The Silent Maw', '👁️'),
      _E('Nulltide Leviathan', '🐋'), _E('The Fractured Saint', '💫') ] },
  { id: 'throne-of-shadows', name: 'Throne of Shadows', emoji: '👑', minStage: 500,
    bgScene: 'throne-storm', tagline: 'Kneel. The Throne is waiting.',
    enemies: [
      _E('Shadow Acolyte', '🌒'), _E('Throne Guard', '🛡️'), _E('Nightmare Spawn', '😱'),
      _E('Umbral Assassin', '🎭'), _E('Dread Herald', '📯'), _E('Soul Reaver', '🪦'),
      _E('Dread Leech', '🪱'), _E('Gloom Herald', '🌚'),
    ],
    bosses: [ _E('The Hollow King', '👑'), _E('The Shadow Sovereign', '🖤'),
      _E('The Gloom Empress', '👸'), _E('Dread Inquisitor Morvain', '⚔️'),
      _E('The Pale Chancellor', '🎭'), _E('Nightmare Herald Xhul', '😱'),
      _E('The Thronebreaker', '🛡️'), _E('Umbral Pontiff Vexar', '🌚') ] },
];
export function worldForStage(stage) {
  let w = WORLDS[0];
  for (const cand of WORLDS) if ((stage || 1) >= cand.minStage) w = cand;
  return w;
}

export const isBossStage = (stage) => stage % 10 === 0;

// 😈 World Boss: Malakor the Blood Demon King (Halloween event)
// Spawns every 4 hours, massive HP scaled to player, huge rewards.
export const WORLD_BOSS = {
  id: 'malakor',
  name: 'Malakor the Blood Demon King',
  emoji: '😈',
  respawnMs: 4 * 60 * 60 * 1000, // 4 hours
  durationMs: 30 * 60 * 1000, // 30 min fight window
};

export function worldBossFor(playerStats) {
  const maxHp = Math.max(1000000, Math.round((playerStats?.maxHp || 1000) * 500));
  return {
    name: WORLD_BOSS.name,
    emoji: WORLD_BOSS.emoji,
    hp: maxHp,
    maxHp: maxHp,
    attack: Math.round((playerStats?.maxHp || 1000) * 0.10),
    isWorldBoss: true,
    stage: -1, // special flag
  };
}

export function worldBossRewards(playerLevel) {
  return {
    xp: playerLevel * 5000,
    gold: playerLevel * 2000,
    pumpkin_shards: 10,
    title: 'slayer-demon-king',
  };
}

// Balance: normal enemies are weaker (less HP, die faster) but still hit
// hard; no single hit can ever one-shot (capped in enemyStrike). Boss
// damage is tuned "around your level" when player stats are provided.
// v19: enemy HP growth 1.125 -> 1.115 per stage. The flatter exponent means
// enemies at the 90-120 frontier (stages ~250-350, where kill XP roughly
// matches the level requirements) carry ~9-20x less HP than under 1.125,
// and ~1,265x less by stage 800. Early game is untouched (already one-taps
// there); the boss x2.5 HP multiplier and incoming-damage auto-tuning stay
// as the guardrails. Absolute TTK swings by orders of magnitude with build
// investment (upgrades, galaxy forge, sets, pets, active skills), so this
// only flattens the curve rather than targeting a specific TTK.
// v25: boss HP multiplier 2.5 -> 1.5. Boss time-to-kill was out of hand
// (e.g. ~98Qi boss HP vs single-digit-T DPS); normal enemies untouched.
export function enemyFor(stage, playerStats = null) {
  const boss = isBossStage(stage);
  const world = worldForStage(stage);
  // v26: boss HP growth 1.115 -> 1.10 (was 8+ hours per boss at high stages).
  // Safety: cap stage at 5000 to prevent Math.pow overflow to Infinity.
  // Hybrid curve (Gemini suggestion): 1.10^stage up to 500, then 1.05^stage
  // past 500 to prevent the Stage 666+ HP explosion / soft-lock.
  const safeStage = Math.max(1, Math.min(Math.floor(Number(stage) || 1), 5000));
  const stageCurve = Math.pow(1.10, Math.min(safeStage, 500)) * Math.pow(1.05, Math.max(0, safeStage - 500));
  const hp = Math.round(18 * stageCurve * (boss ? 1 : 0.6));
  const atk = Math.round(4 * Math.pow(1.085, stage));
  const roster = boss ? world.bosses : world.enemies;
  // Boss identity is deterministic per stage: the announced boss and the
  // spawned boss can never disagree, even when a death-respawn or a delayed
  // spawn re-rolls the same stage. Normal enemies stay random for variety.
  const roll = boss ? mulberry32(((stage * 2654435761) >>> 0))() : Math.random();
  const foe = roster[Math.floor(roll * roster.length)] || { name: 'Shade', emoji: '👹' };
  let attack = boss ? Math.round(atk * 1.35) : atk;
  if (boss && playerStats && playerStats.maxHp > 0) {
    // Bosses hit around your level: after your defense, a clean hit lands
    // between 15% and 30% of your max HP — threatening, never a one-shot.
    const def = Math.max(0, playerStats.defense || 0);
    const lo = def + playerStats.maxHp * 0.15;
    const hi = def + playerStats.maxHp * 0.30;
    attack = Math.max(1, Math.round(Math.min(Math.max(attack, lo), hi)));
  }
  return {
    name: foe.name,
    stage, boss,
    hp: boss ? Math.round(hp * 1.2) : hp,
    maxHp: boss ? Math.round(hp * 1.2) : hp,
    attack,
    emoji: foe.emoji,
    world: world.id,
    // Radiant enemies: rare shimmering foes (3% of non-boss spawns) with
    // guaranteed loot and bonus gold. Never bosses.
    radiant: !boss && Math.random() < 0.03,
  };
}

// Kill-streak loot bonus: +1% drop chance per 25-streak, capped at +10%.
export function streakDropBonus(streak) {
  return Math.min(10, Math.floor(Math.max(0, streak || 0) / 25));
}

// ---------------- Enchanting ----------------
// Items carry `enchant` 0–10 (backfilled as 0 on old saves). Every numeric
// gear stat is multiplied by (1 + 0.08 × level). Enchants live on the item,
// so they survive rebirth.
export const ENCHANT_MAX = 10;
export const ENCHANT_PCT = 0.08;
const ENCHANT_BASE_COST = {
  common: 100, magic: 500, rare: 2500, epic: 15000, legendary: 100000, mythic: 500000,
  divine: 2500000, cosmic: 12000000, enduring: 50000000, infinite: 200000000,
};
export function enchantLevel(item) {
  return Math.min(ENCHANT_MAX, Math.max(0, (item && item.enchant) | 0));
}
export function enchantMult(item) {
  return 1 + ENCHANT_PCT * enchantLevel(item);
}
export function enchantCost(item) {
  const lvl = enchantLevel(item);
  const base = ENCHANT_BASE_COST[item && item.rarity] || 100;
  return Math.round(base * Math.pow(lvl + 1, 2));
}

// ---------------- Combat ----------------
// Effective hero stats = base + level gains + equipped gear,
// x race traits x upgrade multipliers x full-set bonus.
export function computeStats(state) {
  const race = RACES[state.race] || {};
  const cls = CLASSES[state.playerClass] || {};
  const spec = SPECS[state.spec] || {};
  const gear = {};
  for (const k of Object.keys(STAT_LABELS)) gear[k] = 0;
  for (const slot of SLOTS) {
    const id = state.equipped && state.equipped[slot];
    if (!id) continue;
    // Forged galaxy gear lives in state.forge, not the inventory.
    const item = id === GALAXY_EQUIP_ID
      ? galaxyItemFor(state, slot)
      : (state.inventory || []).find(i => i.id === id);
    if (!item || item.slot !== slot || !item.stats) continue;
    const em = enchantMult(item);
    for (const [k, v] of Object.entries(item.stats)) {
      if (k in gear && Number.isFinite(v)) gear[k] += v * em;
    }
  }
  const setInfo = equippedSetInfo(state);
  const setMult = 1 + (setInfo ? setInfo.pct : 0) / 100;
  // Earnable player sets: 3pc / 5pc bonuses (see PLAYER_SETS).
  const pSetInfo = playerSetInfo(state);
  let pAtkMult = 1, pDefMult = 1, pHpMult = 1;
  let pCritCh = 0, pAtkSpd = 0, pDodge = 0;
  let pLifesteal = 0, pRegen = 0, pGoldPct = 0, pXpPct = 0, pCritDmg = 0;
  for (const [setId, count] of Object.entries(equippedPlayerSets(state))) {
    if (count < 3) continue;
    const five = count >= 5;
    if (setId === 'emberheart') {
      pAtkMult *= five ? 1.30 : 1.15;
      if (five) pCritCh += 10;
    } else if (setId === 'frostbound') {
      pHpMult *= five ? 1.40 : 1.20;
      if (five) pDefMult *= 1.20;
    } else if (setId === 'stormcaller') {
      pAtkSpd += five ? 0.35 : 0.20;
      if (five) pDodge += 12;
    } else if (setId === 'bloodmoon') {
      pLifesteal += five ? 20 : 10;
      if (five) pRegen += 15;
    } else if (setId === 'gilded') {
      pGoldPct += five ? 80 : 40;
      if (five) pXpPct += 40;
    } else if (setId === 'nightfall') {
      pCritDmg += five ? 70 : 35;
      if (five) pDodge += 8;
    }
  }
  // Professions (original system, WoW-inspired). Mastery talents removed.
  // Class talent trees (Hunter prototype): aggregated % bonuses.
  const cte = classTalentEffects(state);
  const prof = state.professions || {};
  const smithMult = 1 + 0.015 * (prof.smithing || 1);
  const herbRegen = 0.5 * (prof.herbalism || 1);
  const up = state.upgrades || { weapon: 1, armor: 1, skill: 1 };
  const dmgUpMult = Math.pow(1.12, Math.max(0, up.weapon - 1)) *
                    Math.pow(1.12, Math.max(0, up.skill - 1));
  const defUpMult = Math.pow(1.12, Math.max(0, up.armor - 1));
  // Pet bond: flat bonuses from the ACTIVE pet, added AFTER all multiplicative
  // bonuses (predictable, no double-dipping). Hunger-gated; benched pets give nothing.
  const bond = petBond(state);
  // Guild perks: multiplicative damage, additive XP/gold percentages.
  const gp = GUILD_PERKS;
  const guildDmgMult = 1 + (gp.dmgPct || 0) / 100;
  // Active title stat boost (if the equipped title has one).
  const titleDef = state.activeTitle && TITLE_DEFS[state.activeTitle];
  const tb = (titleDef && titleDef.boost) || {};
  const tAtkMult = 1 + (tb.atkPct || 0) / 100;
  const tDefMult = 1 + (tb.defPct || 0) / 100;
  const tHpMult = 1 + (tb.hpPct || 0) / 100;
  const h = state.hero;
  // Balance v26: 2x global attack buff (2026-10-03).
  const BALANCE_ATK_MULT = 2;
  return {
    attack: Math.max(1, (h.attack + gear.attack) * (race.atkMult || 1) * (cls.atkMult || 1) * (spec.atkMult || 1) * setMult * pAtkMult * tAtkMult * dmgUpMult * smithMult * guildDmgMult * (1 + (cte.atkPct || 0) / 100) * (1 + (cte.spellPowerPct || 0) / 100) * BALANCE_ATK_MULT + bond.atk),
    defense: Math.max(0, (h.defense + gear.defense) * defUpMult * setMult * pDefMult * tDefMult * (cls.defMult || 1) * (spec.defMult || 1) * (1 + (cte.defPct || 0) / 100) + bond.def),
    maxHp: Math.max(1, Math.round((h.maxHp + gear.maxHp) * (race.hpMult || 1) * (cls.hpMult || 1) * (spec.hpMult || 1) * setMult * pHpMult * tHpMult * (1 + (cte.maxHpPct || 0) / 100)) + bond.hp),
    critChance: clamp(h.critChance + gear.critChance + pCritCh + (tb.critCh || 0) + (cte.critCh || 0) + (cls.critChBonus || 0) + (spec.critChBonus || 0), 0, 100),
    critDamage: Math.max(100, h.critDamage + gear.critDamage + pCritDmg + (cte.critDmgPct || 0) + (race.critDmgBonus || 0) + (cls.critDmgBonus || 0)),
    parry: clamp(h.parry + gear.parry + (race.parryBonus || 0), 0, 60),
    dodge: clamp(h.dodge + gear.dodge + pDodge + (tb.dodge || 0) + (cte.dodge || 0) + (race.dodgeBonus || 0) + (race.dodgeMod || 0) + (cls.dodgeBonus || 0), 0, 75),
    lifesteal: Math.max(0, h.lifesteal + gear.lifesteal + pLifesteal + (tb.lifesteal || 0) + (cte.lifesteal || 0) + (race.lifestealBonus || 0) + (spec.lifestealBonus || 0)),
    attackSpeed: clamp((h.attackSpeed + gear.attackSpeed + pAtkSpd + (cls.atkSpdBonus || 0)) * (race.atkSpdMult || 1) * (1 + (cte.atkSpdPct || 0) / 100) * (1 + (tb.atkSpdPct || 0) / 100), 0.2, 5),
    regen: Math.max(0, h.regen + gear.regen + pRegen + (race.regenBonus || 0) + (spec.regenBonus || 0) + herbRegen),
    goldBonus: gear.goldBonus + (gp.goldPct || 0) + pGoldPct + (tb.goldPct || 0),
    xpBonus: gear.xpBonus + pXpPct + (tb.xpPct || 0),
    talentGoldPct: 0, // Mastery removed: Fortune gold bonus no longer exists
    setInfo,
    playerSetInfo: pSetInfo,
    bond,
    // Class-talent pass-throughs for battle logic (app.js).
    talentPetDmgPct: (cte.petDmgPct || 0) + (tb.petDmgPct || 0),
    talentPetHpPct: cte.petHpPct || 0,
    talentCounterCh: cte.counterCh || 0,
    talentExecutePct: cte.executePct || 0,
    talentMendInspirePct: cte.mendInspirePct || 0,
    talentReviveFrac: cte.reviveFrac || 0,
    talentBlockCh: cte.blockCh || 0,
    talentRageGenPct: cte.rageGenPct || 0,
    talentDotPct: cte.dotPct || 0,
    talentMinionDmgPct: cte.minionDmgPct || 0,
    talentMinionHpPct: cte.minionHpPct || 0,
    talentBleedPct: cte.bleedPct || 0,
    talentDmgReducPct: cte.dmgReducPct || 0,
    talentHealPct: cte.healPct || 0,
    talentManaCostPct: cte.manaCostPct || 0,
    talentSpellPowerPct: cte.spellPowerPct || 0,
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
  let dmg = Math.max(1, Math.round(enemyAttack - stats.defense));
  // One-shot guard: a single hit can never deal more than 60% of max HP.
  if (stats.maxHp > 0) dmg = Math.min(dmg, Math.max(1, Math.ceil(stats.maxHp * 0.6)));
  return { dmg, dodged: false, parried: false, counter: 0 };
}

// ---------------- GM Buffs ----------------
// Temporary buffs granted by owner/GM via the Powers tab.
export function getActiveBuff(state, type) {
  const now = Date.now();
  const buffs = state.activeBuffs || [];
  // Clean expired
  state.activeBuffs = buffs.filter(b => b.expiresAt > now);
  return state.activeBuffs.find(b => b.type === type) || null;
}
export function getBuffMult(state, type) {
  const b = getActiveBuff(state, type);
  return b ? 1 + (b.value / 100) : 1;
}
export function hasImmunity(state) {
  return !!getActiveBuff(state, 'immunity');
}
// Apply shield absorption; returns remaining damage after shield
export function absorbWithShield(state, dmg) {
  const now = Date.now();
  // Check all shield types: shield, priest_shield, pally_bubble
  const shieldTypes = ['shield', 'priest_shield', 'pally_bubble'];
  for (const stype of shieldTypes) {
    const shield = (state.activeBuffs || []).find(b => b.type === stype && b.expiresAt > now);
    if (!shield || shield.value <= 0) continue;
    const absorbed = Math.min(shield.value, dmg);
    shield.value -= absorbed;
    dmg -= absorbed;
    if (shield.value <= 0) {
      state.activeBuffs = (state.activeBuffs || []).filter(b => b.id !== shield.id);
    }
    if (dmg <= 0) break;
  }
  return Math.max(0, dmg);
}

// ---- REMASTER: Balance Config Cache ----
// The UI loads balance.json once and injects it here via setBalanceConfig().
// Engine functions read from here first, falling back to hardcoded defaults
// only if the config was never loaded (e.g. unit tests).
let _balanceConfig = null;
export function setBalanceConfig(config) { _balanceConfig = config; }
export function getBalanceConfig() { return _balanceConfig || {}; }
// Helper: get a nested value from balance config with fallback
export function balanceGet(path, fallback) {
  const cfg = getBalanceConfig();
  const parts = path.split('.');
  let cur = cfg;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return fallback;
    cur = cur[p];
  }
  return cur;
}

// ---- REMASTER: Elemental Resistance System ----
// Smooth diminishing returns: damage_taken = base * (1 - (res / (res + K)))
// K controls the curve steepness (lower K = faster diminishing returns).
export function resistedDamage(baseDamage, resistance, kConstant = 100) {
  const res = Math.max(0, resistance || 0);
  const k = Math.max(1, kConstant || 100);
  const reduction = res / (res + k);
  return Math.max(0, baseDamage * (1 - reduction));
}
// Total resistance of a given type from gear + buffs
export function getResistance(state, type) {
  let total = 0;
  // Gear resistance
  const gear = state.gear || state.loadout || {};
  for (const slot of Object.values(gear)) {
    if (slot && slot.resistances && slot.resistances[type]) {
      total += slot.resistances[type];
    }
  }
  // Buff resistance (e.g. fire protection potion)
  for (const b of (state.buffs || [])) {
    if (b.kind === type + '_resist' && b.until > Date.now()) {
      total += b.pct || 0;
    }
  }
  return total;
}

// ---- REMASTER: Farming Decision Logic (AI Director) ----
// Selects the optimal zone to farm based on missing FR gear.
// Uses efficiency score: (FR gain × drop rate) / run time.
// lootConfig: the tier_0_loot_tables from balance.json
// Returns { zone, reason } or { zone: "Ready", reason }
export function selectOptimalFarmingZone(state, lootConfig, targetFR = null, attunementChain = null) {
  // Default target from balance.json
  if (targetFR == null) {
    targetFR = balanceGet('content_tiers.tier_1_molten_depths.gate_mechanic.recommended_min_resistance', 150);
  }
  // REMASTER: If Tier 1 is locked out and Tier 2 attunement is incomplete, route to quest
  if (attunementChain && isRaidLockedOut(state)) {
    const prog = getAttunementProgress(state, attunementChain);
    if (!prog.complete) {
      const s = prog.step;
      return {
        zone: s.zone,
        reason: `Tier 2 Attunement (Step ${prog.currentStep}/${prog.totalSteps}): ${s.title} — ${prog.progress}/${prog.needed} ${s.required_item}`,
        attunementStep: prog.currentStep,
        targetItem: s.required_item,
      };
    }
  }
  if (!state || !lootConfig) return { zone: "Idle", reason: "No farming data available." };

  const gear = state.gear || state.loadout || {};
  const inv = state.inventory || [];
  const hasItem = (name) => inv.some(i => (i.name || i) === name);

  // 1. Guaranteed quest item first (100% return on time)
  if (!hasItem("Drakefire Ring")) {
    return { zone: "Blackrock Spire (Quest)", reason: "Guaranteed +25 FR from Attunement Chain" };
  }

  let bestZone = null;
  let highestScore = 0;

  // 2. Scan dungeon loot tables for best statistical upgrade
  for (const [zoneKey, zoneData] of Object.entries(lootConfig)) {
    for (const drop of (zoneData.drops || [])) {
      const equipped = gear[drop.slot];
      const currentFR = (equipped && equipped.fire_resistance) || 0;
      if (drop.fire_resistance > currentFR) {
        const frGain = drop.fire_resistance - currentFR;
        const runTime = zoneData.average_run_time_minutes || 25;
        const efficiencyScore = (frGain * (drop.drop_rate || 0.1)) / runTime;
        if (efficiencyScore > highestScore) {
          highestScore = efficiencyScore;
          bestZone = {
            zone: zoneKey,
            boss: zoneData.boss_name,
            reason: `Farming ${drop.item_name} (+${frGain} FR, ${Math.round((drop.drop_rate || 0) * 100)}% drop)`,
            targetItem: drop.item_name,
          };
        }
      }
    }
  }

  // 3. Fallback to crafting materials if dungeons are done but under target
  const currentFR = getResistance(state, "fire");
  if (!bestZone && currentFR < targetFR - 20) {
    return { zone: "Elemental Zones", reason: "Dungeon gear complete. Farming Essence of Fire for crafted gear." };
  }

  // 4. Ready for raid
  return bestZone || { zone: "Ready", reason: `Target FR (${targetFR}) achieved. Ready for Tier 1!` };
}

// ---- REMASTER: 40-Man Automated Raid Simulation ----
// Deterministic mathematical battle loop. Simulates a Ragnaros-style boss
// in 2-second combat rounds. Player FR directly affects survival.
// Returns { success, timeElapsedSeconds, survivingRaiders, healerManaRemainingPercent, bossRemainingHPPercent }
export function simulateRaid(state, config = {}) {
  // REMASTER: Merge passed config over balance.json defaults
  const _b = getBalanceConfig();
  const _tierKey = config._tierKey || 'tier_1_molten_depths';
  const _tierDefaults = ((_b.content_tiers || {})[_tierKey] || {});
  const _simDefaults = _tierDefaults.raid_sim || {};
  const _gateDefaults = _tierDefaults.gate_mechanic || {};
  // Passed config wins, then balance.json, then hardcoded fallback
  const cfg = {
    boss_hp: config.boss_hp ?? _simDefaults.boss_hp ?? 1500000,
    dps_per_raider: config.dps_per_raider ?? _simDefaults.dps_per_raider ?? 150,
    healer_mana_pool: config.healer_mana_pool ?? _simDefaults.healer_mana_pool ?? 500000,
    mana_per_hp: config.mana_per_hp ?? _simDefaults.mana_per_hp ?? 0.2,
    max_fight_seconds: config.max_fight_seconds ?? _simDefaults.max_fight_seconds ?? 600,
    gate_mechanic: {
      damage_type: (config.gate_mechanic && config.gate_mechanic.damage_type) ?? _gateDefaults.damage_type ?? 'fire',
      k_constant: (config.gate_mechanic && config.gate_mechanic.k_constant) ?? _gateDefaults.k_constant ?? 100,
      base_ambient_damage: (config.gate_mechanic && config.gate_mechanic.base_ambient_damage) ?? _gateDefaults.base_ambient_damage ?? 1000,
      required_equipped_item: (config.gate_mechanic && config.gate_mechanic.required_equipped_item) ?? _gateDefaults.required_equipped_item,
    },
  };
  // REMASTER: Binary gear gate (e.g. Onyxia Scale Cloak for Tier 2)
  const requiredItem = cfg.gate_mechanic.required_equipped_item;
  if (requiredItem) {
    const gear = state.gear || state.loadout || {};
    const backSlot = gear.back || gear.backSlot || {};
    const equippedName = backSlot.name || backSlot.item_name || '';
    if (equippedName !== requiredItem) {
      return {
        success: false,
        wipeReason: "SHADOW_FLAME_MELT",
        timeElapsedSeconds: 0,
        survivingRaiders: 0,
        healerManaRemainingPercent: 100,
        bossRemainingHPPercent: 100,
        log: `Shadow-Flame breath! Without the ${requiredItem}, your raid incinerated instantly.`,
      };
    }
  }

  const bossMaxHP = cfg.boss_hp;
  let bossCurrentHP = bossMaxHP;

  let livingRaiders = 40;
  const baseDpsPerRaider = cfg.dps_per_raider;

  const manaPoolMax = cfg.healer_mana_pool;
  let healerManaPool = manaPoolMax;
  const manaCostPerDamage = cfg.mana_per_hp;

  const resistType = cfg.gate_mechanic.damage_type;
  const playerRes = getResistance(state, resistType);
  const kConst = cfg.gate_mechanic.k_constant;
  const tickBase = cfg.gate_mechanic.base_ambient_damage;
  const tickDamagePerPerson = resistedDamage(tickBase, playerRes, kConst);

  let totalCombatSeconds = 0;
  const maxFightSeconds = cfg.max_fight_seconds;
  let oomTimestamp = 0; // REMASTER: exact second healers hit 0 mana

  while (bossCurrentHP > 0 && livingRaiders > 0 && totalCombatSeconds < maxFightSeconds) {
    totalCombatSeconds += 2;

    // 1. Raid DPS to boss
    const raidRoundDps = livingRaiders * baseDpsPerRaider * 2;
    bossCurrentHP -= raidRoundDps;

    // 2. Boss aura damage to raid
    const totalRaidDamageTaken = livingRaiders * tickDamagePerPerson;
    const requiredManaToHeal = totalRaidDamageTaken * manaCostPerDamage;

    // 3. Healer mana and casualties
    if (healerManaPool >= requiredManaToHeal) {
      healerManaPool -= requiredManaToHeal;
    } else {
      if (oomTimestamp === 0) oomTimestamp = totalCombatSeconds;
      healerManaPool = 0;
      const deathThreshold = Math.ceil(totalRaidDamageTaken / 5000);
      livingRaiders = Math.max(0, livingRaiders - deathThreshold);
    }
  }

  const isVictory = bossCurrentHP <= 0 && livingRaiders > 0;
  const isEnraged = totalCombatSeconds >= maxFightSeconds && bossCurrentHP > 0;
  return {
    success: isVictory,
    wipeReason: isEnraged ? "ENRAGE_TIMEOUT" : (isVictory ? "NONE" : (livingRaiders <= 0 ? "HEALER_OOM_COLLAPSE" : "NONE")),
    timeElapsedSeconds: totalCombatSeconds,
    survivingRaiders: livingRaiders,
    healerManaRemainingPercent: Math.round((healerManaPool / manaPoolMax) * 100),
    bossRemainingHPPercent: Math.round((Math.max(0, bossCurrentHP) / bossMaxHP) * 100),
    oomTimestampSeconds: oomTimestamp,
    playerFR: playerRes,
    playerResistance: playerRes,
    resistanceType: resistType,
    tickDamagePerPerson: Math.round(tickDamagePerPerson),
  };
}

// ---- REMASTER: Tier 2 Attunement Quest Tracking ----
// Returns { currentStep, totalSteps, step, progress } or { complete: true }
// questItems: object mapping item name -> count owned (from state.questItems)
export function getAttunementProgress(state, chainConfig) {
  if (!chainConfig || !chainConfig.steps) return { complete: true };
  const flags = state.flags || [];
  const attunements = state.attunements || {};
  if (flags.includes(chainConfig.final_reward_flag) || attunements[chainConfig.final_reward_flag]) {
    return { complete: true };
  }
  const questItems = state.questItems || {};
  for (let i = 0; i < chainConfig.steps.length; i++) {
    const step = chainConfig.steps[i];
    const owned = questItems[step.required_item] || 0;
    if (owned < step.required_count) {
      return {
        complete: false,
        currentStep: i + 1,
        totalSteps: chainConfig.steps.length,
        step: step,
        progress: owned,
        needed: step.required_count,
      };
    }
  }
  return { complete: true };
}

// Grant a quest item drop (call after boss kill / mob farm)
// Returns true if this completed the chain (amulet forged)
export function grantQuestItem(state, itemName, chainConfig) {
  if (!state.questItems) state.questItems = {};
  state.questItems[itemName] = (state.questItems[itemName] || 0) + 1;
  const prog = getAttunementProgress(state, chainConfig);
  if (prog.complete) {
    if (!state.attunements) state.attunements = {};
    state.attunements[chainConfig.final_reward_flag] = true;
    return true; // chain complete!
  }
  return false;
}

// Check if Tier 1 raid is currently on lockout
export function isRaidLockedOut(state, raidKey = 'molten_depths') {
  const expiry = (state.lockouts && state.lockouts[raidKey]) || 0;
  return expiry > Date.now();
}

// ---- REMASTER: War Effort Server Event ----
// Asynchronous contribution loop with dynamic population scaling.
// Small player bases can still unlock the event.
export function contributeToWarEffort(playerState, serverState, materialItem, quantity) {
  const event = serverState.server_events && serverState.server_events.the_war_effort;
  if (!event || event.is_unlocked) return event ? event.is_unlocked : false;

  const recipe = (event.accepted_materials || []).find(m => m.item_name === materialItem);
  if (!recipe) return false;

  const activePlayers = Math.max(1, serverState.active_accounts_count || 5);
  const scalingAdjustment = Math.max(0.1, activePlayers * (event.dynamic_population_scale_factor || 0.05));
  const scaledPoints = (quantity * recipe.points_per_item) / scalingAdjustment;

  event.current_contributions += scaledPoints;

  if (event.current_contributions >= event.global_target_contributions) {
    event.is_unlocked = true;
    if (!playerState.flags) playerState.flags = [];
    if (!playerState.flags.includes("war_effort_complete")) {
      playerState.flags.push("war_effort_complete");
    }
  }
  return event.is_unlocked;
}

// Get War Effort progress for UI
export function getWarEffortProgress(serverState) {
  const event = serverState.server_events && serverState.server_events.the_war_effort;
  if (!event) return null;
  return {
    isUnlocked: !!event.is_unlocked,
    current: Math.floor(event.current_contributions || 0),
    target: event.global_target_contributions || 10000,
    percent: Math.min(100, ((event.current_contributions || 0) / (event.global_target_contributions || 10000)) * 100),
  };
}

// ---- REMASTER: Global Server Event Polling ----
// Called from the 1-second tick. Triggers cinematic when War Effort unlocks.
export function checkGlobalServerEvents(playerState, serverState) {
  const effort = serverState.server_events && serverState.server_events.the_war_effort;
  if (!effort) return false;
  const flags = playerState.flags || [];
  if (effort.is_unlocked && !flags.includes("witnessed_gate_opening")) {
    return true; // UI should trigger the cinematic
  }
  return false;
}

// ---- REMASTER: Tier 2.5 Token Exchange ----
// Deducts token + gold, grants the gear piece. Returns { success, reason }
export function executeTokenExchange(state, config, itemKey) {
  const reqs = config.tier_2_5_token_exchange && config.tier_2_5_token_exchange.requirements;
  if (!reqs || !reqs[itemKey]) return { success: false, reason: "Invalid item" };
  const req = reqs[itemKey];

  // Check token
  const tokens = state.tokens || [];
  const tokenIdx = tokens.findIndex(t => (t.name || t) === req.token_required);
  if (tokenIdx < 0) return { success: false, reason: "Missing token" };

  // Check reputation
  const repWeights = { "Neutral": 0, "Friendly": 1, "Honored": 2, "Revered": 3, "Exalted": 4 };
  const currentRep = (state.reputation && state.reputation.brood_of_nozdormu) || "Neutral";
  const neededRep = (req.reputation_needed || "Brood_Neutral").split("_")[1];
  if ((repWeights[currentRep] || 0) < (repWeights[neededRep] || 0)) {
    return { success: false, reason: `Requires Brood ${neededRep}` };
  }

  // Check gold
  if ((state.gold || 0) < req.gold_cost) return { success: false, reason: "Not enough gold" };

  // Execute transaction
  tokens.splice(tokenIdx, 1);
  state.tokens = tokens;
  state.gold -= req.gold_cost;
  if (!state.inventory) state.inventory = [];
  state.inventory.push({
    name: req.reward_item_name,
    slot: req.slot,
    nature_resistance: (req.stats && req.stats.nature_resistance) || 0,
    rarity: "epic",
  });
  return { success: true, item: req.reward_item_name };
}

// ---- REMASTER: Offline Progress Calculator ----
// Calculates gold, resources, and reputation earned while the app was closed.
// Caps at 12 hours to prevent exploitation. Called on login.
// Returns { goldEarned, materialsEarned, repEarned, hoursOffline, capped }
export function calculateOfflineProgress(state, config = {}) {
  // Merge balance.json offline rates as defaults
  const _bal = balanceGet('systems.offline_progress', {});
  const _rates = { ...(_bal.offline_rates || {}), ...(config.offline_rates || {}) };
  const _maxH = config.offline_max_hours ?? _bal.offline_max_hours ?? 12;
  config = { ...config, offline_rates: _rates, offline_max_hours: _maxH };
  const now = Date.now();
  const lastSeen = state.lastSeenAt || state.lastSaveAt || now;
  const msOffline = Math.max(0, now - lastSeen);
  const hoursOffline = msOffline / (1000 * 60 * 60);

  // Cap at 12 hours
  const maxHours = config.offline_max_hours || 12;
  const effectiveHours = Math.min(hoursOffline, maxHours);
  const capped = hoursOffline > maxHours;

  if (effectiveHours < 0.05) { // less than 3 minutes, skip
    return { goldEarned: 0, materialsEarned: {}, repEarned: 0, hoursOffline: 0, capped: false, skipped: true };
  }

  // Only earn if player has an active directive (was farming something)
  const rates = config.offline_rates || {};
  const goldPerHour = rates.gold_per_hour || 500;
  const repPerHour = rates.rep_per_hour || 50;

  const goldEarned = Math.floor(effectiveHours * goldPerHour);
  const repEarned = Math.floor(effectiveHours * repPerHour);

  // Materials: small chance-based drip based on what they were farming
  const materialsEarned = {};
  const matRate = rates.materials_per_hour || {};
  for (const [mat, perHour] of Object.entries(matRate)) {
    const amount = Math.floor(effectiveHours * perHour * (0.8 + Math.random() * 0.4));
    if (amount > 0) materialsEarned[mat] = amount;
  }

  return {
    goldEarned, materialsEarned, repEarned,
    hoursOffline: Math.round(hoursOffline * 10) / 10,
    effectiveHours: Math.round(effectiveHours * 10) / 10,
    capped,
    skipped: false,
  };
}

// Apply offline gains to state. Returns the progress object.
export function applyOfflineProgress(state, config = {}) {
  const progress = calculateOfflineProgress(state, config);
  if (progress.skipped) return progress;

  state.gold = (state.gold || 0) + progress.goldEarned;

  if (!state.craftingMats) state.craftingMats = {};
  for (const [mat, qty] of Object.entries(progress.materialsEarned)) {
    state.craftingMats[mat] = (state.craftingMats[mat] || 0) + qty;
  }

  // Reputation: apply to Brood of Nozdormu (or active faction)
  if (!state.reputation) state.reputation = {};
  if (!state.reputationPoints) state.reputationPoints = {};
  const repKey = 'brood_of_nozdormu_points';
  state.reputationPoints[repKey] = (state.reputationPoints[repKey] || 0) + progress.repEarned;
  // Auto-promote through tiers
  const pts = state.reputationPoints[repKey];
  const tiers = [
    [0, 'Neutral'], [3000, 'Friendly'], [6000, 'Honored'], [12000, 'Revered'], [21000, 'Exalted']
  ];
  let current = 'Neutral';
  for (const [threshold, name] of tiers) {
    if (pts >= threshold) current = name;
  }
  state.reputation.brood_of_nozdormu = current;

  state.lastSeenAt = Date.now();
  return progress;
}

// ---------------- Loot ----------------
export function rollRarity(minIdx = 0, maxIdx = RARITIES.length - 1) {
  const pool = RARITIES.map((r, i) => ({ r, i })).filter(x => x.i >= minIdx && x.i <= maxIdx);
  const total = pool.reduce((a, x) => a + x.r.weight, 0);
  let roll = Math.random() * total;
  for (const x of pool) { roll -= x.r.weight; if (roll <= 0) return x.r; }
  return pool[pool.length - 1].r;
}

// Stage gate for the post-mythic tiers: divine 40+, cosmic 60+,
// enduring 80+, infinite 100+. Returns the max RARITIES index allowed.
export function maxRarityIdxForStage(stage) {
  const s = Math.max(1, Math.floor(Number(stage) || 1));
  if (s >= 100) return RARITY_IDX.infinite;
  if (s >= 80) return RARITY_IDX.enduring;
  if (s >= 60) return RARITY_IDX.cosmic;
  if (s >= 40) return RARITY_IDX.divine;
  return RARITY_IDX.mythic;
}

const SLOT_NAMES = {
  weapon: ['Blade', 'Sword', 'Axe', 'Dagger'],
  armor: ['Plate', 'Mail', 'Carapace'],
  helmet: ['Helm', 'Crown', 'Hood'],
  boots: ['Boots', 'Greaves', 'Treads'],
  trinket: ['Charm', 'Idol', 'Sigil'],
};
// Class-flavored weapon names (Option A: flavor only — stats/slots unchanged).
// Unknown/missing class falls back to SLOT_NAMES.weapon (the old behavior).
const WEAPON_NAMES_BY_CLASS = {
  hunter:     ['Longbow', 'Recurve Bow', 'Crossbow', 'Blunderbuss', 'Flintlock'],
  assassin:   ['Dagger', 'Stiletto', 'Kris', 'Fang', 'Shiv'],
  warrior:    ['Sword', 'Claymore', 'Blade', 'Warbrand'],
  mage:       ['Staff', 'Wand', 'Tome', 'Orb'],
  necromancer:['Scythe', 'Grimwand', 'Bonestaff', 'Soulreaver'],
  berserker:  ['Greataxe', 'Axe', 'Maul', 'Cleaver'],
  druid:      ['Grove Staff', 'Thornstaff', 'Wildwood Branch', 'Oakheart'],
};
function weaponNameFor(classId) {
  const pool = (classId && WEAPON_NAMES_BY_CLASS[classId]) || SLOT_NAMES.weapon;
  return pick(pool);
}
// Class-flavored armor names (same flavor-only approach as weapons).
// Warrior → Plate, Hunter → Mail, Assassin/Berserker → Leather, Mage/Necromancer → Cloth.
const ARMOR_NAMES_BY_CLASS = {
  warrior:     ['Plate', 'Platemail', 'Bulwark Plate'],
  hunter:      ['Mail', 'Chainmail', "Ranger's Mail"],
  assassin:    ['Leather', 'Shadow Leather', 'Nightwraps'],
  mage:        ['Cloth', 'Silkweave', 'Arcanist Robes'],
  necromancer: ['Shroud', 'Gravecloth', 'Soulweave'],
  berserker:   ['Hide', 'Warhide', 'Bloodhide'],
  druid:       ['Barkweave', 'Leafmail', 'Wildhide'],
};
function armorNameFor(classId) {
  const pool = (classId && ARMOR_NAMES_BY_CLASS[classId]) || SLOT_NAMES.armor;
  return pick(pool);
}
const SUFFIX = {
  attack: 'of the Tiger', defense: 'of the Bear', maxHp: 'of the Ox',
  critChance: 'of the Falcon', critDamage: 'of Ruin', parry: 'of the Wall',
  dodge: 'of Shadows', lifesteal: 'of the Leech', attackSpeed: 'of Swiftness',
  regen: 'of Renewal', goldBonus: 'of Greed', xpBonus: 'of Wisdom',
};
const STAT_GEN = {
  attack:      (m, s) => Math.max(1, Math.round((2 + s * 1.0) * m)),
  defense:     (m, s) => Math.max(1, Math.round((1 + s * 0.6) * m)),
  maxHp:       (m, s) => Math.max(5, Math.round((12 + s * 5.5) * m)),
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

// Builds one random-rarity item for a slot with stage-scaled stats.
// Used by rollLoot (drops) and the Gear Shop (purchases). Never produces
// privileged gear: shop/drop items always have set: null.
export function makeLootItem(stage, rarityId, slot, classId) {
  const rarity = RARITY_BY_ID[rarityId] || RARITIES[0];
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
  const baseName = slot === 'weapon' ? weaponNameFor(classId)
    : slot === 'armor' ? armorNameFor(classId)
    : pick(SLOT_NAMES[slot]);
  let name = `${rarity.prefix} ${baseName}`;
  if (rIdx >= 2 && SUFFIX[primary]) name += ` ${SUFFIX[primary]}`;
  return {
    id: uid(), name, slot, rarity: rarity.id,
    stats, set: null, setName: null,
    value: Math.max(1, Math.round((4 + stage * 1.5) * rarity.mult)),
    unsellable: false,
  };
}

// Returns an item or null. Drop chances (set pieces see rollSetDrop):
// normal enemies 10% (+streak bonus), bosses 80% (rare+ guaranteed, raid
// bosses epic+). Radiant enemies always drop. Post-mythic rarities are
// stage-gated via maxRarityIdxForStage().
export function rollLoot(stage, isBoss = false, minIdx = null, opts = {}) {
  const bonus = Math.max(0, Number(opts.bonusChance) || 0);
  const baseChance = opts.guaranteed ? 1 : (isBoss ? 0.80 : 0.10 + bonus / 100);
  if (Math.random() > baseChance) return null;
  const maxIdx = maxRarityIdxForStage(stage);
  const lo = Math.min(minIdx !== null ? minIdx : (isBoss ? 2 : 0), maxIdx);
  const rarity = rollRarity(lo, maxIdx);
  return makeLootItem(stage, rarity.id, pick(SLOTS), opts.classId);
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
  // Protect equipped gear: cannot sell what's currently worn
  if (state.equipped && state.equipped[item.slot] === itemId) return 0;
  state.inventory.splice(idx, 1);
  const gold = Math.max(1, Math.round(item.value || 1));
  return addGold(state, gold);
}

// Sell ALL sellable inventory gear at once (Clear Bags). Skips equipped
// items and unsellable keepsakes. Returns { count, gold }.
export function sellAllGear(state) {
  const ids = (state.inventory || [])
    .filter(i => !i.unsellable && (!state.equipped || state.equipped[i.slot] !== i.id))
    .map(i => i.id);
  let total = 0;
  for (const id of ids) total += sellItem(state, id);
  return { count: ids.length, gold: total };
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
  voidwalker: {
    name: 'Voidwalker Regalia', minRole: 'admin', setBonus: 75,
    aura: 'void', auraClass: 'set-voidwalker',
    pieces: {
      weapon:  { name: 'Voidfang Blade',   stats: { attack: 375, critDamage: 38 } },
      armor:   { name: 'Voidweave Shroud', stats: { defense: 375, dodge: 10 } },
      helmet:  { name: 'Voidgaze Hood',    stats: { critChance: 12, attack: 190 } },
      boots:   { name: 'Voidstep Boots',   stats: { dodge: 11, attackSpeed: 0.15, defense: 110 } },
      trinket: { name: 'Void Heart',       stats: { critChance: 7, lifesteal: 7, regen: 15 } },
    },
  },
  dragonscale: {
    name: 'Dragonscale Aegis', minRole: 'admin', setBonus: 80,
    aura: 'dragonfire', auraClass: 'set-dragonscale',
    pieces: {
      weapon:  { name: 'Dragonscale Fang',  stats: { attack: 400, lifesteal: 6 } },
      armor:   { name: 'Dragonscale Plate', stats: { defense: 400, maxHp: 1600 } },
      helmet:  { name: 'Dragonhorn Helm',   stats: { defense: 160, maxHp: 800, regen: 10 } },
      boots:   { name: 'Dragonclaw Greaves', stats: { defense: 120, maxHp: 500, regen: 8 } },
      trinket: { name: 'Dragonheart Ember', stats: { regen: 16, maxHp: 600, lifesteal: 4 } },
    },
  },
  gamemaster: {
    name: 'Game Master Regalia', minRole: 'gm', setBonus: 70,
    aura: 'judgment', auraClass: 'set-gamemaster',
    pieces: {
      weapon:  { name: 'Judgment Gavel',      stats: { attack: 350, critChance: 8 } },
      armor:   { name: "Arbiter's Plate",     stats: { defense: 350, maxHp: 1400 } },
      helmet:  { name: 'Crown of Verdicts',   stats: { defense: 140, critDamage: 35 } },
      boots:   { name: 'Stride of Justice',   stats: { dodge: 8, attackSpeed: 0.14, defense: 105 } },
      trinket: { name: 'Scales of the Master', stats: { goldBonus: 25, xpBonus: 25, lifesteal: 5 } },
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

// ---------------- Earnable player gear sets ----------------
// Unlike privileged sets (GM-granted, fixed stats), these drop from gameplay
// with stage-scaled stats and are the long-term gear chase for regular players.
// Drop sources (see rollSetDrop):
//   - any boss kill (normal / dungeon / raid) ... 1% for a random piece of a random set
// Regular enemies never drop set pieces.
// Set bonuses: 3 pieces and 5 pieces of the same set (applied in computeStats).
export const PLAYER_SETS = {
  emberheart: {
    name: 'Emberheart Arsenal', emoji: '🔥',
    desc: 'Attack and crit. 3pc: +15% attack. 5pc: +30% attack, +10% crit chance.',
    pieces: {
      weapon: 'Emberheart Blade', armor: 'Emberheart Plate', helmet: 'Emberheart Helm',
      boots: 'Emberheart Greaves', trinket: 'Emberheart Charm',
    },
    secondary: ['critChance', 'critDamage'],
  },
  frostbound: {
    name: 'Frostbound Aegis', emoji: '❄️',
    desc: 'Health and defense. 3pc: +20% max HP. 5pc: +40% max HP, +20% defense.',
    pieces: {
      weapon: 'Frostbound Blade', armor: 'Frostbound Plate', helmet: 'Frostbound Helm',
      boots: 'Frostbound Greaves', trinket: 'Frostbound Charm',
    },
    secondary: ['maxHp', 'defense'],
  },
  stormcaller: {
    name: 'Stormcaller Garb', emoji: '⛈️',
    desc: 'Speed and evasion. 3pc: +0.20 attack speed. 5pc: +0.35 attack speed, +12% dodge.',
    pieces: {
      weapon: 'Stormcaller Blade', armor: 'Stormcaller Plate', helmet: 'Stormcaller Helm',
      boots: 'Stormcaller Greaves', trinket: 'Stormcaller Charm',
    },
    secondary: ['attackSpeed', 'dodge'],
  },
  bloodmoon: {
    name: 'Bloodmoon Regalia', emoji: '🩸',
    desc: 'Sustain and hunger. 3pc: +10 lifesteal. 5pc: +20 lifesteal, +15 regen.',
    pieces: {
      weapon: 'Bloodmoon Fang', armor: 'Bloodmoon Carapace', helmet: 'Bloodmoon Crown',
      boots: 'Bloodmoon Treads', trinket: 'Bloodmoon Heart',
    },
    secondary: ['lifesteal', 'regen'],
  },
  gilded: {
    name: 'Gilded Fortune', emoji: '💰',
    desc: 'Wealth and wisdom. 3pc: +40% gold from kills. 5pc: +80% gold, +40% XP.',
    pieces: {
      weapon: 'Gilded Fortune Blade', armor: 'Gilded Fortune Plate', helmet: 'Gilded Fortune Helm',
      boots: 'Gilded Fortune Greaves', trinket: 'Gilded Fortune Charm',
    },
    secondary: ['goldBonus', 'xpBonus'],
  },
  nightfall: {
    name: 'Nightfall Shroud', emoji: '🌑',
    desc: 'Silent and lethal. 3pc: +35% crit damage. 5pc: +70% crit damage, +8% dodge.',
    pieces: {
      weapon: 'Nightfall Edge', armor: 'Nightfall Weave', helmet: 'Nightfall Hood',
      boots: 'Nightfall Striders', trinket: 'Nightfall Sigil',
    },
    secondary: ['critDamage', 'dodge'],
  },
};

// Builds one stage-scaled piece of an earnable set (rare-tier stat budget).
export function makePlayerSetPiece(stage, setId, slot) {
  const def = PLAYER_SETS[setId];
  if (!def || !def.pieces[slot]) throw new Error('Unknown player set/slot: ' + setId + '/' + slot);
  const mult = 2.5;
  const stats = {};
  const primary = SLOT_PRIMARY[slot];
  stats[primary] = STAT_GEN[primary](mult, stage);
  const sec = def.secondary[Math.floor(Math.random() * def.secondary.length)];
  if (sec !== primary && STAT_GEN[sec]) stats[sec] = STAT_GEN[sec](mult, stage);
  return {
    id: uid(), name: def.pieces[slot], slot, rarity: 'rare',
    stats, set: setId, setName: def.name,
    value: Math.max(1, Math.round((4 + stage * 1.5) * mult)),
    unsellable: false,
  };
}

// Counts equipped pieces per earnable player set -> { setId: count }.
export function equippedPlayerSets(state) {
  const counts = {};
  for (const slot of SLOTS) {
    const id = state.equipped && state.equipped[slot];
    if (!id) continue;
    const item = (state.inventory || []).find(i => i.id === id);
    if (!item || !item.set || item.slot !== slot || !PLAYER_SETS[item.set]) continue;
    counts[item.set] = (counts[item.set] || 0) + 1;
  }
  return counts;
}

// Best (most pieces) equipped player set for UI display, else null.
export function playerSetInfo(state) {
  const counts = equippedPlayerSets(state);
  let best = null;
  for (const [setId, count] of Object.entries(counts)) {
    if (!best || count > best.count) best = { setId, count };
  }
  if (!best) return null;
  const def = PLAYER_SETS[best.setId];
  return { setId: best.setId, name: def.name, emoji: def.emoji, count: best.count, desc: def.desc };
}

// Returns a set-piece item or null. Really good gear is rare by design:
// flat 1% on ANY boss kill (normal, dungeon, raid bosses). Regular enemies
// never drop set pieces.
export function rollSetDrop(stage, { boss = false, dungeonBoss = false, raidBoss = false } = {}) {
  const isBoss = boss || dungeonBoss || raidBoss;
  if (!isBoss || Math.random() >= 0.01) return null;
  const setIds = Object.keys(PLAYER_SETS);
  return makePlayerSetPiece(stage, setIds[Math.floor(Math.random() * setIds.length)], pick(SLOTS));
}

// ---------------- Gear Shop ----------------
// Armor & weapons purchasable with gold in the Gear tab. Items are generated
// on purchase (guaranteed rarity, stage-scaled stats — same stat budget as
// drops). Legendary/mythic rolls and earnable set pieces are NOT sold: those
// stay drop-only. Privileged gear (GM sets) is never sold or dropped —
// GM-grant only.
// ---------------- Armory ----------------
// Premium class-gear shop in the Armory tab. Items are generated on purchase
// (guaranteed rarity, stage-scaled stats — same stat budget as drops) via
// makeLootItem with the player's class, so names are class-flavored.
// Unlike the Gear Shop, the Armory DOES sell legendary/mythic — intentional
// per Cody 2026-09-30 ("rarest to very high quality gear you can get").
// Privileged gear (GM sets) is never sold — GM-grant only.
export const ARMORY_STOCK = [
  { id: 'armory-rare-weapon',      slot: 'weapon',  rarity: 'rare',      price: 250000,   emoji: '🗡️', name: 'Gilded Weapon',    desc: 'Guaranteed rare class weapon, scaled to your stage.' },
  { id: 'armory-rare-armor',       slot: 'armor',   rarity: 'rare',      price: 250000,   emoji: '🛡️', name: 'Gilded Armor',     desc: 'Guaranteed rare class armor, scaled to your stage.' },
  { id: 'armory-rare-helmet',      slot: 'helmet',  rarity: 'rare',      price: 250000,   emoji: '⛑️', name: 'Gilded Helmet',    desc: 'Guaranteed rare class helmet, scaled to your stage.' },
  { id: 'armory-rare-boots',       slot: 'boots',   rarity: 'rare',      price: 250000,   emoji: '🥾', name: 'Gilded Boots',     desc: 'Guaranteed rare class boots, scaled to your stage.' },
  { id: 'armory-rare-trinket',     slot: 'trinket', rarity: 'rare',      price: 250000,   emoji: '📿', name: 'Gilded Trinket',   desc: 'Guaranteed rare class trinket, scaled to your stage.' },
  { id: 'armory-epic-weapon',      slot: 'weapon',  rarity: 'epic',      price: 1000000,  emoji: '⚔️', name: 'Arcane Weapon',    desc: 'Guaranteed epic class weapon — a real upgrade.' },
  { id: 'armory-epic-armor',       slot: 'armor',   rarity: 'epic',      price: 1000000,  emoji: '🥋', name: 'Arcane Armor',     desc: 'Guaranteed epic class armor — a real upgrade.' },
  { id: 'armory-epic-helmet',      slot: 'helmet',  rarity: 'epic',      price: 1000000,  emoji: '⛑️', name: 'Arcane Helmet',    desc: 'Guaranteed epic class helmet — a real upgrade.' },
  { id: 'armory-epic-boots',       slot: 'boots',   rarity: 'epic',      price: 1000000,  emoji: '🥾', name: 'Arcane Boots',     desc: 'Guaranteed epic class boots — a real upgrade.' },
  { id: 'armory-epic-trinket',     slot: 'trinket', rarity: 'epic',      price: 1000000,  emoji: '📿', name: 'Arcane Trinket',   desc: 'Guaranteed epic class trinket — a real upgrade.' },
  { id: 'armory-legendary-weapon', slot: 'weapon',  rarity: 'legendary', price: 5000000,  emoji: '🔱', name: 'Mythril Weapon',   desc: 'Guaranteed legendary class weapon.' },
  { id: 'armory-legendary-armor',  slot: 'armor',   rarity: 'legendary', price: 5000000,  emoji: '🦾', name: 'Mythril Armor',    desc: 'Guaranteed legendary class armor.' },
  { id: 'armory-legendary-helmet', slot: 'helmet',  rarity: 'legendary', price: 5000000,  emoji: '⛑️', name: 'Mythril Helmet',   desc: 'Guaranteed legendary class helmet.' },
  { id: 'armory-legendary-boots',  slot: 'boots',   rarity: 'legendary', price: 5000000,  emoji: '🥾', name: 'Mythril Boots',    desc: 'Guaranteed legendary class boots.' },
  { id: 'armory-legendary-trinket', slot: 'trinket', rarity: 'legendary', price: 5000000,  emoji: '📿', name: 'Mythril Trinket',  desc: 'Guaranteed legendary class trinket.' },
  { id: 'armory-mythic-weapon',    slot: 'weapon',  rarity: 'mythic',    price: 25000000, emoji: '💫', name: 'Eternal Weapon',   desc: 'Guaranteed mythic class weapon — the finest steel.' },
  { id: 'armory-mythic-armor',     slot: 'armor',   rarity: 'mythic',    price: 25000000, emoji: '🌟', name: 'Eternal Armor',    desc: 'Guaranteed mythic class armor — the finest steel.' },
  { id: 'armory-mythic-helmet',    slot: 'helmet',  rarity: 'mythic',    price: 25000000, emoji: '⛑️', name: 'Eternal Helmet',   desc: 'Guaranteed mythic class helmet — the finest steel.' },
  { id: 'armory-mythic-boots',     slot: 'boots',   rarity: 'mythic',    price: 25000000, emoji: '🥾', name: 'Eternal Boots',    desc: 'Guaranteed mythic class boots — the finest steel.' },
  { id: 'armory-mythic-trinket',   slot: 'trinket', rarity: 'mythic',    price: 25000000, emoji: '📿', name: 'Eternal Trinket',  desc: 'Guaranteed mythic class trinket — the finest steel.' },
];

// Armory restock: 1-hour cycle.
export const ARMORY_RESTOCK_MS = 60 * 60 * 1000; // 1 hour
export function checkArmoryRestock(s) {
  const now = Date.now();
  if (!s.armoryRestockAt || s.armoryRestockAt <= now) {
    s.armoryRestockAt = now + ARMORY_RESTOCK_MS;
    return true;
  }
  return false;
}
export function getArmoryRestockMs(s) {
  const now = Date.now();
  const at = s.armoryRestockAt || 0;
  return Math.max(0, at - now);
}

// Returns the Armory stock for a given player class. Currently returns all
// 20 entries — class flavor is applied at purchase time via makeLootItem(),
// which picks class-flavored names (WEAPON_NAMES_BY_CLASS / ARMOR_NAMES_BY_CLASS).
// Kept as a separate helper so future class-restricted stock can slot in here.
export function getArmoryStockForClass(playerClass) {
  return ARMORY_STOCK;
}

// Buys an Armory item for gold. The item lands in the
// inventory. Purchases go through spendGold so the owner infinite-gold perk
// and the gold cap apply. Selling needs no new code: the Armory sell list
// reuses the existing sellItem() (same Sell buttons as the Gear tab), which
// already respects unsellable flags and the gold cap.
export function buyArmoryItem(s, stockId) {
  const entry = ARMORY_STOCK.find(e => e.id === stockId);
  if (!entry) return { ok: false, reason: 'bad-item' };
  if (!spendGold(s, entry.price)) return { ok: false, reason: 'gold' };
  const item = makeLootItem(Math.max(1, s.stage || 1), entry.rarity, entry.slot, s.playerClass);
  (s.inventory || (s.inventory = [])).push(item);
  return { ok: true, item };
}

// ---------------- Pets ----------------
// Available to ALL players; the Hunter class boosts them (see CLASSES).
// Pet eggs drop from bosses (see rollPetEgg); hatching is instant in the
// Pets UI (Party tab). The active pet strikes every 4s in every combat mode
// (see App.tick / petStrike in app.js), gains 15% of kill XP, and survives
// rebirth. Hunger 0-100 decays with play time (-1 per 5 min); feeding costs
// gold scaling with pet level and restores +35 hunger.
// Hunger gating: >50 full damage, 1-50 → 40% damage, 0 → pet sits out.
// v23: pet stat growth flattened (was 1.12–1.21, now 1.055–1.09). The old
// curve put a Lv 85 Void Reaver at ~989M HP on the display; the new curve
// keeps high-level pet stats in sane ranges. Bond uses max(linear, 2% of
// these stats) so it stays relevant at high level (see petBondFor).
export const PET_SPECIES = {
  cinderpup:   { name: 'Cinder Pup',   emoji: '🐶', icon: 'img/pets/cinderpup.webp', rarity: 'common',    weight: 40, baseDmg: 8,  growth: 1.06,
                 flavor: 'A loyal pup — always by your side, through every battle.', style: 'Loyal · balanced companion',
                 baseStats: { atk: 8,  def: 3,  hp: 50  }, bond: { atk: 2, def: 1, hp: 15 } },
  frostsprite: { name: 'Frost Sprite', emoji: '🧚', icon: 'img/pets/frostsprite.webp', rarity: 'magic',     weight: 28, baseDmg: 12, growth: 1.065,
                 baseStats: { atk: 12, def: 2,  hp: 40  }, bond: { atk: 3, def: 0, hp: 10 } },
  stormhawk:   { name: 'Storm Hawk',   emoji: '🦅', icon: 'img/pets/stormhawk.webp', rarity: 'rare',      weight: 17, baseDmg: 18, growth: 1.07,
                 baseStats: { atk: 16, def: 4,  hp: 55  }, bond: { atk: 2, def: 1, hp: 15 } },
  emberfox:    { name: 'Ember Fox',    emoji: '🦊', icon: 'img/pets/emberfox.webp', rarity: 'epic',      weight: 10, baseDmg: 26, growth: 1.075,
                 baseStats: { atk: 22, def: 5,  hp: 65  }, bond: { atk: 3, def: 1, hp: 12 } },
  tideturtle:  { name: 'Tide Turtle',  emoji: '🐢', icon: 'img/pets/tideturtle.webp', rarity: 'legendary', weight: 5,  baseDmg: 38, growth: 1.08,
                 baseStats: { atk: 20, def: 12, hp: 120 }, bond: { atk: 1, def: 3, hp: 40 } },
  // Mythic line — hatchable from Mythic Eggs (rarely from wild eggs). Stronger
  // than anything below; priced to match (see EGG_TIERS).
  stormdrake:   { name: 'Storm Drake',  emoji: '🐉', icon: 'img/pets/stormdrake.webp', rarity: 'mythic',    weight: 2,   baseDmg: 46, growth: 1.085,
                 flavor: 'A young drake — every wingbeat smells of ozone and war.', style: 'Majestic · soaring strikes',
                 baseStats: { atk: 40, def: 10, hp: 100 }, bond: { atk: 3, def: 2, hp: 30 } },
  prismhorn:    { name: 'Prismhorn',    emoji: '🦄', icon: 'img/pets/prismhorn.webp', rarity: 'mythic',    weight: 1,   baseDmg: 52, growth: 1.09,
                 flavor: 'Its horn refracts the last light of dying stars.', style: 'Radiant · piercing strikes',
                 baseStats: { atk: 46, def: 12, hp: 110 }, bond: { atk: 4, def: 2, hp: 30 } },
  // Shadow line — Throne of Shadows natives, hatchable from Shadow Eggs
  // (rarely from wild eggs). Dark, loyal, and hungry for the light.
  shadowwisp:   { name: 'Shadow Wisp',  emoji: '👻', icon: 'img/pets/shadowwisp.webp', rarity: 'shadow',    weight: 2,   baseDmg: 42, growth: 1.085,
                 flavor: 'A whisper of the dark — it drinks the light around it.', style: 'Eerie · chilling strikes',
                 baseStats: { atk: 30, def: 10, hp: 95  }, bond: { atk: 2, def: 2, hp: 30 } },
  gloomstalker: { name: 'Gloomstalker', emoji: '🐈‍⬛', icon: 'img/pets/gloomstalker.webp', rarity: 'shadow',   weight: 1.5, baseDmg: 48, growth: 1.085,
                 flavor: 'You never see it move. You only see what it leaves behind.', style: 'Silent · ruthless strikes',
                 baseStats: { atk: 36, def: 9,  hp: 90  }, bond: { atk: 3, def: 1, hp: 25 } },
  voidreaver:   { name: 'Void Reaver',  emoji: '💀', icon: 'img/pets/voidreaver.webp', rarity: 'shadow',    weight: 1,   baseDmg: 56, growth: 1.09,
                 flavor: 'It remembers every throne that fell — and how.', style: 'Dread · devastating strikes',
                 baseStats: { atk: 44, def: 12, hp: 110 }, bond: { atk: 3, def: 2, hp: 35 } },
  // Starlight line — celestial natives, hatchable from Starlight Eggs
  // (rarely from wild eggs). Born of dying stars; loyal to the light.
  starwisp:    { name: 'Star Wisp',    emoji: '💫', icon: 'img/pets/starwisp.webp', rarity: 'celestial', weight: 2,   baseDmg: 42, growth: 1.085,
                 flavor: 'A spark that refused to go out — it chose you instead.', style: 'Bright · searing strikes',
                 baseStats: { atk: 30, def: 10, hp: 95  }, bond: { atk: 2, def: 2, hp: 30 } },
  lunacub:     { name: 'Luna Cub',     emoji: '🐻‍❄️', icon: 'img/pets/lunacub.webp', rarity: 'celestial', weight: 1.5, baseDmg: 48, growth: 1.085,
                 flavor: 'Raised under a moon that never sets.', style: 'Loyal · crushing strikes',
                 baseStats: { atk: 36, def: 9,  hp: 90  }, bond: { atk: 3, def: 1, hp: 25 } },
  astraldrake: { name: 'Astral Drake', emoji: '🐲', icon: 'img/pets/astraldrake.webp', rarity: 'celestial', weight: 1,   baseDmg: 56, growth: 1.09,
                 flavor: 'It has seen the end of everything — and decided to fight beside you.', style: 'Cosmic · devastating strikes',
                 baseStats: { atk: 44, def: 12, hp: 110 }, bond: { atk: 3, def: 2, hp: 35 } },
  // Hunter starter beasts (not hatchable from eggs — starterOnly). Note: 🐺 is
  // taken by the Gloomfang Wolf enemy, so the wolf-ish slot uses 🦁 Lion.
  // Budget starter: the Ash Mouse is Stray-Egg-only (weight 0 keeps it out
  // of the wild-egg pool) — a cheap first pet for brand-new players.
  ashmouse:   { name: 'Ash Mouse',   emoji: '🐁', icon: 'img/pets/ashmouse.webp', rarity: 'common',    weight: 0,  baseDmg: 5,  growth: 1.055,
                 flavor: 'Small, scrappy, and first into the fray. Every legend starts somewhere.', style: 'Scrappy · eager starter',
                 baseStats: { atk: 5,  def: 2,  hp: 35  }, bond: { atk: 1, def: 1, hp: 10 } },
  tiger: { name: 'Tiger', emoji: '🐯', icon: 'img/pets/tiger.webp', rarity: 'common', weight: 0, baseDmg: 14, growth: 1.065,
           starterOnly: true, flavor: 'A fierce striker — hits hardest from the very first hunt.', style: 'Fierce · high base damage',
           baseStats: { atk: 14, def: 4, hp: 60 }, bond: { atk: 3, def: 1, hp: 15 } },
  bear:  { name: 'Bear',  emoji: '🐻', icon: 'img/pets/bear.webp', rarity: 'common', weight: 0, baseDmg: 10, growth: 1.08,
           starterOnly: true, flavor: 'A steady guardian — grows mightier with every level.', style: 'Steady · best late scaling',
           baseStats: { atk: 10, def: 8, hp: 90 }, bond: { atk: 1, def: 2, hp: 30 } },
  lion:  { name: 'Lion',  emoji: '🦁', icon: 'img/pets/lion.webp', rarity: 'common', weight: 0, baseDmg: 12, growth: 1.065,
           starterOnly: true, flavor: 'A keen hunter — swift, sharp, and sure.', style: 'Keen · balanced strikes',
           baseStats: { atk: 12, def: 5, hp: 70 }, bond: { atk: 2, def: 1, hp: 20 } },
  // Halloween 2026 pets (mega-spec). Obtainable during the event.
  shadowbat: { name: 'Shadow Bat', emoji: '🦇', rarity: 'mythic', weight: 0, baseDmg: 30, growth: 1.08,
           event: 'HALLOWEEN', flavor: '+5% movement speed, auto-collects gold drops.', style: 'Swift · eerie strikes',
           baseStats: { atk: 25, def: 8, hp: 80 }, bond: { atk: 2, def: 1, hp: 20 } },
  obsidiancat: { name: 'Obsidian Black Cat', emoji: '🐈‍⬛', rarity: 'mythic', weight: 0, baseDmg: 28, growth: 1.08,
           event: 'HALLOWEEN', flavor: '+5% luck/drop rate.', style: 'Lucky · mysterious strikes',
           baseStats: { atk: 22, def: 10, hp: 85 }, bond: { atk: 2, def: 2, hp: 20 } },
  pumpkingolem: { name: 'Pumpkin Golem', emoji: '🎃', rarity: 'mythic', weight: 0, baseDmg: 35, growth: 1.075,
           event: 'HALLOWEEN', flavor: '+300 HP, draws enemy aggro.', style: 'Sturdy · crushing strikes',
           baseStats: { atk: 30, def: 15, hp: 400 }, bond: { atk: 2, def: 3, hp: 50 } },
};

// ---------------- Pet Shop ----------------
// The Pet Shop (Party tab → Pets) sells tiered eggs for gold; tier eggs
// guarantee a minimum rarity, unlike wild eggs dropped by bosses.
// pool: null = weighted roll over all non-starter species; otherwise a
// fixed list the egg hatches from (equal chance within the list).
export const EGG_TIERS = {
  wild:    { name: 'Wild Egg',    emoji: '🥚', price: 0,
             desc: 'Dropped by bosses — hatches any companion species.', pool: null },
  stray:   { name: 'Stray Egg',   emoji: '🐣', price: 500,
             desc: 'Hatches an Ash Mouse — small, scrappy, and cheap. Every legend starts somewhere.', pool: ['ashmouse'] },
  common:  { name: 'Common Egg',  emoji: '🐣', price: 5000,
             desc: 'Guaranteed Cinder Pup — a loyal, balanced starter.', pool: ['cinderpup'] },
  glowing: { name: 'Glowing Egg', emoji: '✨', price: 25000,
             desc: 'Hatches a Frost Sprite or Storm Hawk.', pool: ['frostsprite', 'stormhawk'] },
  radiant: { name: 'Radiant Egg', emoji: '💎', price: 100000,
             desc: 'Hatches an Ember Fox or Tide Turtle.', pool: ['emberfox', 'tideturtle'] },
  mythic:  { name: 'Mythic Egg',  emoji: '🌟', price: 250000,
             desc: 'Hatches a Storm Drake or Prismhorn — stronger than any lesser pet.', pool: ['stormdrake', 'prismhorn'] },
  shadow:  { name: 'Shadow Egg',  emoji: '🌑', price: 500000,
             desc: 'Hatches a Shadow Wisp, Gloomstalker, or Void Reaver — children of the dark.', pool: ['shadowwisp', 'gloomstalker', 'voidreaver'] },
  celestial: { name: 'Starlight Egg', emoji: '🌠', price: 500000,
             desc: 'Hatches a Star Wisp, Luna Cub, or Astral Drake — children of the light.', pool: ['starwisp', 'lunacub', 'astraldrake'] },
  // Token-shop only (not sold for gold): shadow + celestial pool.
  token:   { name: 'Token Egg',   emoji: '🌀', price: null,
             desc: 'Token Shop exclusive — hatches a shadow or celestial pet.', pool: ['shadowwisp', 'gloomstalker', 'voidreaver', 'starwisp', 'lunacub', 'astraldrake'] },
};
export const SHOP_EGG_TIERS = ['stray', 'common', 'glowing', 'radiant', 'mythic', 'shadow', 'celestial', 'token'];

export function defaultPets() {
  const shopEggs = {};
  for (const t of SHOP_EGG_TIERS) shopEggs[t] = 0;
  return { collection: [], activeUid: null, eggs: 0, shopEggs };
}

// Normalizes s.pets in place and returns it.
export function ensurePets(s) {
  // Safety: return fresh defaults if state is missing (battle loop calls this).
  if (!s || typeof s !== 'object') return defaultPets();
  if (!s.pets || typeof s.pets !== 'object') s.pets = defaultPets();
  const p = s.pets;
  if (!Array.isArray(p.collection)) p.collection = [];
  p.collection = p.collection.filter(
    x => x && PET_SPECIES[x.species] && Number.isFinite(x.level)
  );
  for (const x of p.collection) {
    x.level = Math.max(1, Math.floor(x.level));
    x.xp = Math.max(0, Number(x.xp) || 0);
    x.xpNext = petXpForLevel(x.level);
    x.hunger = Math.max(0, Math.min(100, Number(x.hunger) || 0));
    if (!x.uid) x.uid = uid();
  }
  p.eggs = Math.max(0, Math.floor(Number(p.eggs) || 0));
  // Shop eggs: tiered purchases from the Pet Shop. Normalize for old saves
  // that predate the shop (wild boss-drop eggs live in p.eggs).
  if (!p.shopEggs || typeof p.shopEggs !== 'object') p.shopEggs = {};
  for (const t of SHOP_EGG_TIERS) {
    p.shopEggs[t] = Math.max(0, Math.floor(Number(p.shopEggs[t]) || 0));
  }
  if (p.activeUid && !p.collection.some(x => x.uid === p.activeUid)) p.activeUid = null;
  // Hunters may field a second pet. Non-hunters (or a stale uid) lose it.
  if (p.secondUid && !p.collection.some(x => x.uid === p.secondUid)) p.secondUid = null;
  if (s.playerClass !== 'hunter') p.secondUid = null;
  if (p.secondUid && p.secondUid === p.activeUid) p.secondUid = null;
  return p;
}

export function activePets(s) {
  const p = ensurePets(s);
  const out = [];
  const primary = p.collection.find(x => x.uid === p.activeUid);
  if (primary) out.push(primary);
  if (s.playerClass === 'hunter') {
    const second = p.collection.find(x => x.uid === p.secondUid);
    if (second) out.push(second);
  }
  return out;
}

export function activePet(s) {
  const p = ensurePets(s);
  return p.collection.find(x => x.uid === p.activeUid) || null;
}

export function petSpeciesOf(pet) {
  return (pet && PET_SPECIES[pet.species]) || null;
}

// ---------------------------------------------------------------------------
// NPC Druid Healer "Sylvara"
// ---------------------------------------------------------------------------
// A recruitable NPC companion who heals the party in battle and can resurrect
// a fallen member once per battle (5-minute cooldown).
// ---------------------------------------------------------------------------

export const HEALER_RECRUIT_COST = 10000; // gold
export const HEALER_NAME = 'Sylvara';
export const HEALER_TICK_SEC = 5;        // heals every 5 seconds in battle
export const HEALER_HEAL_FRAC = 0.15;    // heals 15% of target's max HP
export const HEALER_RES_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
export const HEALER_RES_HP_FRAC = 0.5;   // resurrect at 50% HP

// Recruit Sylvara for gold. Returns true on success, false if already have her
// or not enough gold. Does NOT deduct if infGold (owner perk) — matches shop.
export function recruitHealer(s) {
  // Safety: guard against null/undefined state (prevents TypeError crash).
  if (!s || typeof s !== 'object') return false;
  if (s.npcHealer) return false;
  if (!s.infGold && (s.gold || 0) < HEALER_RECRUIT_COST) return false;
  if (!s.infGold) s.gold -= HEALER_RECRUIT_COST;
  s.npcHealer = {
    name: HEALER_NAME,
    level: Math.max(1, s.level || 1),
    lastResurrect: 0,          // timestamp ms of last resurrect (cooldown)
    resurrectedThisBattle: false,
  };
  return true;
}

export function hasHealer(s) {
  return !!(s && s.npcHealer);
}

// ---------------------------------------------------------------------------
// NPC Tank "Bromm"
// ---------------------------------------------------------------------------
// A recruitable NPC tank who absorbs 25% of incoming hero damage in battle.
export const TANK_RECRUIT_COST = 15000; // gold
export const TANK_NAME = 'Bromm';
export const TANK_ABSORB_FRAC = 0.25;   // absorbs 25% of hero damage

// Recruit Bromm for gold. Returns true on success, false if already have him
// or not enough gold.
export function recruitTank(s) {
  // Safety: guard against null/undefined state (prevents TypeError crash).
  if (!s || typeof s !== 'object') return false;
  if (s.npcTank) return false;
  if (!s.infGold && (s.gold || 0) < TANK_RECRUIT_COST) return false;
  if (!s.infGold) s.gold -= TANK_RECRUIT_COST;
  s.npcTank = {
    name: TANK_NAME,
    level: Math.max(1, s.level || 1),
  };
  return true;
}

export function hasTank(s) {
  return !!(s && s.npcTank);
}

// Pet HP: simple system so the healer (and UI) has something to work with.
// maxHp scales with pet level; hp is backfilled to full on first access.
export function petMaxHp(pet, playerMaxHp, petHpPct = 0) {
  const lvl = Math.max(1, Math.floor((pet && pet.level) || 1));
  const base = 50 + lvl * 25;
  // Scale with player progression: pet gets 50% of player max HP (min 1k)
  let max;
  if (playerMaxHp && playerMaxHp > 0) {
    max = Math.max(base, Math.floor(playerMaxHp * 0.5), 1000);
  } else {
    max = base;
  }
  // Class talents (Beast Mastery: Thick Hide, Beast God).
  if (petHpPct) max = Math.floor(max * (1 + petHpPct / 100));
  return max;
}

export function ensurePetHp(pet, playerMaxHp, petHpPct = 0) {
  if (!pet || typeof pet !== 'object') return null;
  const max = petMaxHp(pet, playerMaxHp, petHpPct);
  if (!Number.isFinite(pet.hp)) pet.hp = max;
  pet.hp = Math.max(0, Math.min(max, pet.hp));
  return pet;
}

// Pick the heal target: lowest HP fraction among player and active pets.
// Returns {kind:'player'} or {kind:'pet', pet}. Skips dead/knocked-out targets
// for the regular heal tick (resurrect is handled separately).
export function healerPickTarget(s, stats) {
  const cands = [];
  const pMax = (stats && stats.maxHp) || s.hero.maxHp || 1;
  const petHpPct = (stats && stats.talentPetHpPct) || 0;
  if (s.hero.hp > 0) cands.push({ kind: 'player', frac: s.hero.hp / pMax });
  for (const pet of activePets(s)) {
    ensurePetHp(pet, pMax, petHpPct);
    const pm = petMaxHp(pet, pMax, petHpPct);
    if (pet.hp > 0) cands.push({ kind: 'pet', pet, frac: pet.hp / pm });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.frac - b.frac);
  return cands[0];
}

// Apply one healer tick. Returns a description string, or null if nothing.
// Heals the lowest-HP-fraction target for HEALER_HEAL_FRAC of their max HP.
export function healerTick(s, stats) {
  if (!hasHealer(s)) return null;
  const t = healerPickTarget(s, stats);
  if (!t) return null;
  // Don't overheal a full target.
  if (t.frac >= 1) return null;
  if (t.kind === 'player') {
    const max = (stats && stats.maxHp) || s.hero.maxHp;
    const amt = Math.ceil(max * HEALER_HEAL_FRAC);
    s.hero.hp = Math.min(max, s.hero.hp + amt);
    return `${HEALER_NAME} heals you for ${amt}`;
  }
  const pMaxH = (stats && stats.maxHp) || s.hero.maxHp;
  const petHpPct = (stats && stats.talentPetHpPct) || 0;
  const pet = ensurePetHp(t.pet, pMaxH, petHpPct);
  const max = petMaxHp(pet, pMaxH, petHpPct);
  const amt = Math.ceil(max * HEALER_HEAL_FRAC);
  pet.hp = Math.min(max, pet.hp + amt);
  const sp = petSpeciesOf(pet) || {};
  return `${HEALER_NAME} heals ${sp.name || 'your pet'} for ${amt}`;
}

// Can the healer resurrect right now? (has her, cooldown elapsed, not used
// this battle yet)
export function healerCanResurrect(s) {
  if (!hasHealer(s)) return false;
  const h = s.npcHealer;
  if (h.resurrectedThisBattle) return false;
  return Date.now() - (h.lastResurrect || 0) >= HEALER_RES_COOLDOWN_MS;
}

// Resurrect the player at HEALER_RES_HP_FRAC of max HP. Returns true if done.
export function healerResurrect(s, stats) {
  if (!healerCanResurrect(s)) return false;
  const max = (stats && stats.maxHp) || s.hero.maxHp;
  s.hero.hp = Math.ceil(max * HEALER_RES_HP_FRAC);
  s.npcHealer.lastResurrect = Date.now();
  s.npcHealer.resurrectedThisBattle = true;
  return true;
}

// Call when a new battle starts so the once-per-battle resurrect refreshes.
export function healerNewBattle(s) {
  if (s && s.npcHealer) s.npcHealer.resurrectedThisBattle = false;
}

// Pet eggs drop from bosses: flat 15% on any boss kill (normal bosses,
// dungeon bosses, raid bosses). Regular enemies never drop eggs.
export function rollPetEgg({ boss = false, dungeonBoss = false, raidBoss = false } = {}) {
  const isBoss = boss || dungeonBoss || raidBoss;
  return isBoss && Math.random() < 0.15;
}

export function rollPetSpeciesId(tier = 'wild') {
  // Tiered shop eggs hatch from a fixed pool (equal chance within it);
  // starter-only species are never hatchable.
  if (tier && tier !== 'wild' && EGG_TIERS[tier] && EGG_TIERS[tier].pool) {
    const pool = EGG_TIERS[tier].pool.filter(id => PET_SPECIES[id] && !PET_SPECIES[id].starterOnly);
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  const pool = Object.keys(PET_SPECIES).filter(id => !PET_SPECIES[id].starterOnly);
  const ids = pool.length ? pool : Object.keys(PET_SPECIES);
  const total = ids.reduce((a, id) => a + PET_SPECIES[id].weight, 0);
  let roll = Math.random() * total;
  for (const id of ids) {
    roll -= PET_SPECIES[id].weight;
    if (roll <= 0) return id;
  }
  return ids[0];
}

// Hunter's chosen starter pet: level 1, full hunger, set active. Returns the pet or null.
export function addStarterPet(s, speciesId) {
  const p = ensurePets(s);
  if (!speciesId || !PET_SPECIES[speciesId] || !HUNTER_STARTERS.includes(speciesId)) return null;
  const pet = { uid: uid(), species: speciesId, level: 1, xp: 0, xpNext: petXpForLevel(1), hunger: 100 };
  p.collection.push(pet);
  p.activeUid = pet.uid;
  return pet;
}

// Consumes one egg and adds a new pet (auto-active if none). tier is
// 'wild' (boss-drop egg) or a shop tier id. Returns the pet or null.
export function hatchPet(s, tier = 'wild') {
  const p = ensurePets(s);
  if (tier && tier !== 'wild') {
    if (!SHOP_EGG_TIERS.includes(tier) || (p.shopEggs[tier] || 0) < 1) return null;
    p.shopEggs[tier] -= 1;
  } else {
    if (p.eggs < 1) return null;
    p.eggs -= 1;
    tier = 'wild';
  }
  const species = rollPetSpeciesId(tier);
  const pet = { uid: uid(), species, level: 1, xp: 0, xpNext: petXpForLevel(1), hunger: 100 };
  p.collection.push(pet);
  if (!p.activeUid) p.activeUid = pet.uid;
  return pet;
}

// Buys one shop egg for gold. Respects the owner infinite-gold perk
// (spendGold bypasses deduction). Returns {ok, reason}.
export function buyEgg(s, tier) {
  const p = ensurePets(s);
  if (!SHOP_EGG_TIERS.includes(tier)) return { ok: false, reason: 'bad-tier' };
  const price = EGG_TIERS[tier].price;
  if (price == null) return { ok: false, reason: 'token-only' }; // token shop only
  if (!spendGold(s, price)) return { ok: false, reason: 'gold' };
  p.shopEggs[tier] = (p.shopEggs[tier] || 0) + 1;
  return { ok: true, tier };
}

// ---------------- Pet breeding & combining ----------------
// Rarity ladder for combining (shadow/celestial are the top — nothing above).
export const PET_RARITY_ORDER = ['common', 'magic', 'rare', 'epic', 'legendary', 'mythic', 'shadow', 'celestial'];

// Breed two pets: parents are kept, gold fee scales with their levels.
// Offspring is level 1: 45% parent A species, 45% parent B species,
// 10% "mutation" — a random species of the higher parent's rarity.
export function breedPets(s, uidA, uidB) {
  const p = ensurePets(s);
  if (!uidA || !uidB || uidA === uidB) return { ok: false, reason: 'pick-two' };
  const a = p.collection.find(x => x.uid === uidA);
  const b = p.collection.find(x => x.uid === uidB);
  if (!a || !b) return { ok: false, reason: 'not-found' };
  const cost = 5000 * (Math.max(1, a.level) + Math.max(1, b.level));
  if (!spendGold(s, cost)) return { ok: false, reason: 'gold', cost };
  const ra = PET_RARITY_ORDER.indexOf(PET_SPECIES[a.species].rarity);
  const rb = PET_RARITY_ORDER.indexOf(PET_SPECIES[b.species].rarity);
  let species;
  const roll = Math.random();
  if (roll < 0.10) {
    // Mutation: random non-starter species of the higher parent's rarity.
    const topRarity = PET_RARITY_ORDER[Math.max(ra, rb)];
    const pool = Object.entries(PET_SPECIES)
      .filter(([, sp]) => sp.rarity === topRarity && !sp.starterOnly)
      .map(([id]) => id);
    species = pool.length ? pick(pool) : (roll < 0.05 ? a.species : b.species);
  } else {
    species = roll < 0.55 ? a.species : b.species;
  }
  const pet = { uid: uid(), species, level: 1, xp: 0, xpNext: petXpForLevel(1), hunger: 100 };
  p.collection.push(pet);
  if (!p.activeUid) p.activeUid = pet.uid;
  return { ok: true, pet, cost };
}

// Combine three pets of the same rarity into one pet of the next rarity up.
// The three are consumed; the new pet keeps the highest level. Top-rarity
// (shadow/celestial) pets cannot be combined further.
export function combinePets(s, uids) {
  const p = ensurePets(s);
  if (!Array.isArray(uids) || uids.length !== 3 || new Set(uids).size !== 3) {
    return { ok: false, reason: 'pick-three' };
  }
  const pets = uids.map(u => p.collection.find(x => x.uid === u));
  if (pets.some(x => !x)) return { ok: false, reason: 'not-found' };
  if (pets.some(x => petSpeciesOf(x).unsellable)) return { ok: false, reason: 'protected' };
  const rarities = pets.map(x => PET_SPECIES[x.species].rarity);
  if (new Set(rarities).size !== 1) return { ok: false, reason: 'same-rarity' };
  const idx = PET_RARITY_ORDER.indexOf(rarities[0]);
  if (idx < 0 || idx >= PET_RARITY_ORDER.length - 1) return { ok: false, reason: 'max-rarity' };
  const targetRarity = PET_RARITY_ORDER[idx + 1];
  const pool = Object.entries(PET_SPECIES)
    .filter(([, sp]) => sp.rarity === targetRarity && !sp.starterOnly)
    .map(([id]) => id);
  if (!pool.length) return { ok: false, reason: 'no-species' };
  const level = Math.max(...pets.map(x => Math.max(1, x.level)));
  const gone = new Set(uids);
  p.collection = p.collection.filter(x => !gone.has(x.uid));
  const pet = { uid: uid(), species: pick(pool), level, xp: 0, xpNext: petXpForLevel(level), hunger: 100 };
  p.collection.push(pet);
  if (gone.has(p.activeUid)) p.activeUid = pet.uid;
  if (gone.has(p.secondUid)) p.secondUid = null;
  if (!p.activeUid) p.activeUid = pet.uid;
  return { ok: true, pet, consumed: uids.length };
}

export function petFeedCost(pet, state) {
  const base = Math.floor(100 * Math.pow(Math.max(1, pet.level), 1.5));
  const mult = (state && CLASSES[state.playerClass] && CLASSES[state.playerClass].feedCostMult) || 1;
  return Math.max(1, Math.floor(base * mult));
}

// Feeds a pet (+35 hunger, capped 100) for gold. Returns {ok, reason}.
export function feedPet(s, petUid) {
  const p = ensurePets(s);
  const pet = p.collection.find(x => x.uid === petUid);
  if (!pet) return { ok: false, reason: 'not-found' };
  if (pet.hunger >= 100) return { ok: false, reason: 'full' };
  const cost = petFeedCost(pet, s);
  if (!spendGold(s, cost)) return { ok: false, reason: 'gold' };
  const tierOf = (h) => h > 50 ? 2 : h > 0 ? 1 : 0;
  const oldTier = tierOf(pet.hunger);
  pet.hunger = Math.min(100, pet.hunger + 35);
  const newTier = tierOf(pet.hunger);
  return { ok: true, cost, tierUp: newTier > oldTier };
}

// ---------------- Sell pets ----------------
// Sell price scales with rarity and level: rarity base × (1 + 15% per level
// past 1). Respects the gold cap via addGold. Species flagged unsellable
// (GM-only / special pets) can never be sold. Selling the active (or second)
// pet reassigns the slot to the first remaining pet, or clears it.
const PET_SELL_BASE = {
  common: 800, magic: 2000, rare: 5000, epic: 15000,
  legendary: 40000, mythic: 80000, shadow: 120000, celestial: 120000,
};
export function petSellPrice(pet) {
  const sp = petSpeciesOf(pet);
  if (!sp || sp.unsellable) return 0;
  const base = PET_SELL_BASE[sp.rarity] || 800;
  const lv = Math.max(1, Math.floor(pet.level) || 1);
  return Math.max(1, Math.round(base * (1 + 0.15 * (lv - 1))));
}
export function canSellPet(pet) {
  const sp = petSpeciesOf(pet);
  return !!(pet && sp && !sp.unsellable);
}
// Sells a pet for gold. Returns {ok, gold, name, reason}.
export function sellPet(s, petUid) {
  const p = ensurePets(s);
  const idx = p.collection.findIndex(x => x.uid === petUid);
  if (idx < 0) return { ok: false, reason: 'not-found' };
  const pet = p.collection[idx];
  if (!canSellPet(pet)) return { ok: false, reason: 'unsellable' };
  const price = petSellPrice(pet);
  const name = (petSpeciesOf(pet) || {}).name || 'Pet';
  p.collection.splice(idx, 1);
  if (p.activeUid === petUid) {
    const next = p.collection[0] || null;
    p.activeUid = next ? next.uid : null;
  }
  if (p.secondUid === petUid) {
    const next = p.collection.find(x => x.uid !== p.activeUid) || null;
    p.secondUid = next ? next.uid : null;
  }
  const gained = addGold(s, price);
  return { ok: true, gold: gained, name, capped: gained < price };
}

// ---------------- Coming-soon teasers ----------------
// Visible but unobtainable: shadow demons are teased in the Pet Shop as a
// locked entry. NOT a Seasons system — just a static teaser. (Starlight
// pets graduated from teaser to real species in v23.)
export const PET_TEASERS = [
  { id: 'shadow-demons', name: 'Shadow demons', emoji: '😈',
    desc: 'True demons of the Throne — not yet ready to be tamed.' },
];

// A pet's own stats: base × growth^(level-1). Display only — bond is separate.
export function petStats(pet) {
  const zero = { atk: 0, def: 0, hp: 0 };
  if (!pet) return zero;
  const sp = petSpeciesOf(pet);
  if (!sp) return zero;
  const g = Math.pow(sp.growth || 1.15, Math.max(0, pet.level - 1));
  const bs = sp.baseStats || { atk: sp.baseDmg || 1, def: 1, hp: 10 };
  return {
    atk: Math.max(1, Math.round(bs.atk * g)),
    def: Math.max(0, Math.round(bs.def * g)),
    hp: Math.max(1, Math.round(bs.hp * g)),
  };
}

// Bond: the ACTIVE pet grants the player flat ATK/DEF/maxHP =
// per-level species values × pet level, hunger-gated like strike damage.
// Applied AFTER class/spec multiplicative bonuses in computeStats;
// Hunter's +50% pet-damage bonus does NOT affect bond. Benched pets grant nothing.
export function petBondFor(pet, levelCap) {
  const zero = { atk: 0, def: 0, hp: 0 };
  if (!pet) return zero;
  const sp = petSpeciesOf(pet);
  const b = (sp && sp.bond) || zero;
  const mult = petHungerMult(pet);
  if (!mult) return zero;
  // Cap effective pet level at player level so bond bonuses scale with progression
  const cap = Number.isFinite(levelCap) && levelCap > 0 ? Math.floor(levelCap) : Infinity;
  const lv = Math.max(1, Math.min(pet.level || 1, cap));
  // v23: bond is the better of the classic per-level values and 2% of the
  // pet's own stats. Early game is unchanged (linear wins); at high level
  // the bond tracks the pet instead of collapsing to a rounding error.
  const ps = petStats(pet);
  const PCT = 0.02;
  return {
    atk: Math.round(Math.max(b.atk * lv, ps.atk * PCT) * mult),
    def: Math.round(Math.max(b.def * lv, ps.def * PCT) * mult),
    hp: Math.round(Math.max(b.hp * lv, ps.hp * PCT) * mult),
  };
}
export function petBond(s) {
  const zero = { atk: 0, def: 0, hp: 0 };
  const out = { ...zero };
  const pets = activePets(s);
  const playerLevel = Math.max(1, Math.floor(s.level || 1));
  // Pack Leader (Beast Mastery): second pet's bond bonuses are doubled.
  const cte = classTalentEffects(s);
  const secondMult = 1 + (cte.secondBondMult || 0);
  pets.forEach((pet, idx) => {
    const b = petBondFor(pet, playerLevel);
    const m = (idx === 1 && s.playerClass === 'hunter') ? secondMult : 1;
    out.atk += Math.round(b.atk * m); out.def += Math.round(b.def * m); out.hp += Math.round(b.hp * m);
  });
  return out;
}

// Hunger damage gating: >50 full, 1-50 → 40%, 0 → sits out.
export function petHungerMult(pet) {
  if (!pet) return 0;
  if (pet.hunger <= 0) return 0;
  return pet.hunger > 50 ? 1 : 0.4;
}

// Active pet(s) strike damage: (25% + 4%/level) of hero attack each, hunger-gated.
// Meaningful but never outshines the hero. Hunters get +50% pet damage and
// may field a second pet — both strike.
export function petStrikeDamage(s, stats) {
  const pets = activePets(s);
  if (!pets.length) return 0;
  const classMult = (s && CLASSES[s.playerClass] && CLASSES[s.playerClass].petDmgMult) || 1;
  let buffMult = 1; // Mend Pet inspiration
  for (const b of ((s && s.buffs) || [])) {
    if (b.kind === 'petDmgPct' && b.until > Date.now()) buffMult *= 1 + b.pct / 100;
  }
  let total = 0;
  // Class talents (Beast Mastery): multiplicative pet damage bonus.
  const talentPetMult = 1 + ((stats.talentPetDmgPct || 0) / 100);
  for (const pet of pets) {
    const mult = petHungerMult(pet);
    if (!mult) continue;
    const sp = petSpeciesOf(pet);
    // v23: strike scaling capped at 150% of hero attack per pet (was
    // uncapped 25% + 4%/level — a Lv 85 pet struck for 361% of your attack).
    // Pets stay meaningful without ever outshining the hero.
    const base = stats.attack * Math.min(0.25 + 0.04 * (pet.level - 1), 1.5);
    const speciesMult = 1 + (sp.baseDmg / 200); // rarer species hit a touch harder
    total += Math.max(1, Math.round(base * mult * speciesMult * classMult * buffMult * talentPetMult));
  }
  return total;
}

export function petXpForLevel(level) {
  return Math.max(1, Math.round(40 * Math.pow(1.28, Math.max(1, level) - 1)));
}

// Active pets gain xp (15% of the kill's XP each). Returns {gains} with one
// entry per pet that leveled: {name, levels}.
export function gainPetXp(s, xp) {
  const gains = [];
  if (!Number.isFinite(xp) || xp <= 0) return { gains };
  const playerLevel = Math.max(1, Math.floor(s.level || 1));
  for (const pet of activePets(s)) {
    pet.xp += xp;
    const levels = [];
    let guard = 0;
    while (pet.xp >= pet.xpNext && guard++ < 1000) {
      pet.xp -= pet.xpNext;
      // Cap pet level at player level — pets can't exceed their owner's level
      if (pet.level >= playerLevel) {
        pet.xp = 0;
        break;
      }
      pet.level += 1;
      pet.xpNext = petXpForLevel(pet.level);
      levels.push(pet.level);
    }
    // Clamp any existing over-leveled pets (from before the cap)
    if (pet.level > playerLevel) {
      pet.level = playerLevel;
      pet.xp = 0;
      pet.xpNext = petXpForLevel(pet.level);
    }
    if (levels.length) gains.push({ name: (petSpeciesOf(pet) || {}).name || 'Pet', levels });
  }
  return { gains };
}

// Decays every pet's hunger by `amount` (clamped at 0).
// Returns array of {pet, oldTier, newTier} for pets that crossed a bond tier.
export function decayPetHunger(s, amount = 1) {
  const p = ensurePets(s);
  const changes = [];
  const tierOf = (h) => h > 50 ? 2 : h > 0 ? 1 : 0;
  for (const pet of p.collection) {
    const oldTier = tierOf(pet.hunger);
    pet.hunger = Math.max(0, pet.hunger - amount);
    const newTier = tierOf(pet.hunger);
    if (oldTier !== newTier) changes.push({ pet, oldTier, newTier });
  }
  return { pets: p, changes };
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
// Companion combat roles (v15 buff). Tanks are durable with decent damage,
// healers mend the PLAYER with light personal damage, DPS are glass cannons.
// hpMult/hpFlat/hpGrowth drive max-HP scaling (exponential in companion
// level so allies stay relevant at high levels); atkPer/defPer are the
// per-level gains; dmgMult scales their strike damage; takenMult scales
// damage they take (applied in the battle tick).
export const COMPANION_ROLES = {
  tank:   { label: 'Tank',   hpMult: 2.0, hpFlat: 60, hpGrowth: 1.075, defPer: 4, atkPer: 4, dmgMult: 1.5, takenMult: 0.35 },
  healer: { label: 'Healer', hpMult: 1.5, hpFlat: 30, hpGrowth: 1.075, defPer: 2, atkPer: 2, dmgMult: 0.8, takenMult: 0.55 },
  dps:    { label: 'DPS',    hpMult: 1.2, hpFlat: 25, hpGrowth: 1.075, defPer: 2, atkPer: 6, dmgMult: 2.0, takenMult: 0.60 },
};

// Team Synergy: bonuses based on party composition
// Returns { defensePct, attackPct, healPct, label }
export function computeSynergy(party) {
  const roles = (party || []).map(c => {
    if (!c || (c.hp || 0) <= 0) return null;
    return (c.roleKind || companionRole(c));
  }).filter(Boolean);
  const hasTank = roles.includes('tank');
  const hasHealer = roles.includes('healer');
  const hasDps = roles.includes('dps');
  const count = roles.length;

  let defensePct = 0, attackPct = 0, healPct = 0;
  const bonuses = [];

  if (hasTank && hasHealer) {
    defensePct += 20;
    bonuses.push('🛡️+🌿 Tank+Healer: +20% Team Defense');
  }
  if (hasTank && hasDps) {
    attackPct += 15;
    bonuses.push('🛡️+⚔️ Tank+DPS: +15% Team Attack');
  }
  if (hasHealer && hasDps) {
    healPct += 25;
    bonuses.push('🌿+⚔️ Healer+DPS: +25% Healing');
  }
  if (count >= 3) {
    defensePct += 10;
    attackPct += 10;
    bonuses.push('👥 Full Party (3): +10% Attack & Defense');
  }

  return { defensePct, attackPct, healPct, bonuses, count };
}
export function companionRole(c) {
  const rid = (c && (c.recruitId || c.id)) || '';
  if (rid === 'ember' || rid === 'mira') return 'tank';
  if (rid === 'anselm') return 'healer';
  return 'dps';
}
export function companionMaxHp(recruit, level) {
  const role = COMPANION_ROLES[companionRole(recruit)] || COMPANION_ROLES.dps;
  const L = Math.max(1, Math.floor(level || 1));
  return Math.max(1, Math.round(
    (Number(recruit.hp) || 50) * role.hpMult * Math.pow(role.hpGrowth, L - 1) + role.hpFlat * (L - 1)
  ));
}
export function companionAttack(recruit, level) {
  const role = COMPANION_ROLES[companionRole(recruit)] || COMPANION_ROLES.dps;
  const L = Math.max(1, Math.floor(level || 1));
  return Math.max(1, Math.round((Number(recruit.atk) || 5) + role.atkPer * (L - 1)));
}
export function companionDefense(recruit, level) {
  const role = COMPANION_ROLES[companionRole(recruit)] || COMPANION_ROLES.dps;
  const L = Math.max(1, Math.floor(level || 1));
  return Math.max(0, Math.round((Number(recruit.def) || 0) + role.defPer * (L - 1)));
}
export const RECRUITS = [
  { id: 'gromm',  name: 'Gromm the Axe',    race: 'orc',       emoji: '🪓', role: 'Brute',        tier: 'common',    cost: 50,    atk: 6,  def: 1, hp: 60,  dodge: 5,  crit: 5 },
  { id: 'lyra',   name: 'Lyra Swiftbow',    race: 'fae',       emoji: '🧚', role: 'Ranger',       tier: 'common',    cost: 150,   atk: 10, def: 1, hp: 70,  dodge: 15, crit: 10 },
  { id: 'anselm', name: 'Brother Anselm',   race: 'celestial', emoji: '✨', role: 'Cleric',       tier: 'uncommon',  cost: 300,   atk: 12, def: 3, hp: 120, dodge: 5,  crit: 5, regen: 2 },
  { id: 'vex',    name: 'Vex Nightwhisper', race: 'revenant',  emoji: '💀', role: 'Assassin',     tier: 'uncommon',  cost: 600,   atk: 18, def: 2, hp: 90,  dodge: 10, crit: 10 },
  { id: 'ember',  name: 'Ember Scaleborn',  race: 'dragonkin', emoji: '🐉', role: 'Dragon Knight', tier: 'rare',     cost: 1200,  atk: 26, def: 3, hp: 110, dodge: 5,  crit: 15 },
  { id: 'mira',   name: 'Mira Ironhold',    race: 'human',     emoji: '🛡️', role: 'Guardian',     tier: 'epic',      cost: 2500,  atk: 34, def: 5, hp: 160, dodge: 5,  crit: 10 },
  { id: 'kaelith', name: 'Kaelith Doomwarden', race: 'abyssal', emoji: '🌑', role: 'Doomwarden',  tier: 'legendary', cost: 6000,  atk: 48, def: 7, hp: 220, dodge: 15, crit: 15, regen: 3 },
  { id: 'nyx',    name: 'Nyx Starreaver',   race: 'voidborn',  emoji: '🌠', role: 'Starreaver',   tier: 'mythic',    cost: 15000, atk: 70, def: 10, hp: 320, dodge: 20, crit: 20, regen: 5 },
];
export const RECRUIT_BY_ID = Object.fromEntries(RECRUITS.map(r => [r.id, r]));
export const MAX_PARTY = 3;

export function makeCompanion(recruit, playerLevel) {
  const L = Math.max(1, Math.floor(playerLevel || 1));
  const maxHp = companionMaxHp(recruit, L);
  const c = {
    id: uid(), name: recruit.name, race: recruit.race, emoji: recruit.emoji,
    role: recruit.role || 'Companion',
    roleKind: companionRole(recruit),
    recruitId: recruit.id,
    baseCost: recruit.cost,
    level: L,
    attack: companionAttack(recruit, L),
    defense: companionDefense(recruit, L),
    maxHp, hp: maxHp,
    dodge: recruit.dodge || 5, critChance: recruit.crit || 5,
    regen: recruit.regen || 0,
  };
  return c;
}

// Recompute a companion's combat stats from its role + level. Used by
// levelUpCompanion and by the save backfill (so pre-v15 allies get the buff
// retroactively). Preserves the current HP fraction — no free heal.
export function recomputeCompanion(c) {
  if (!c) return c;
  const r = (c.recruitId && RECRUIT_BY_ID[c.recruitId])
    || RECRUITS.find(x => x.name === c.name);
  const L = Math.max(1, Math.floor(c.level || 1));
  c.roleKind = companionRole(c);
  if (!r) return c; // unknown recruit: leave legacy stats alone
  const frac = c.maxHp > 0 ? Math.max(0, Math.min(1, (Number(c.hp) || 0) / c.maxHp)) : 1;
  c.attack = companionAttack(r, L);
  c.defense = companionDefense(r, L);
  c.maxHp = companionMaxHp(r, L);
  c.hp = Math.round(frac * c.maxHp);
  return c;
}

// Gold cost to level a companion from its current level to the next.
// Steep curve so cost (not a cap) is the limiter; never below 50g.
export function companionLevelCost(c) {
  const base = Math.max(50, Number(c && c.baseCost) || 50);
  const L = Math.max(1, Math.floor((c && c.level) || 1));
  return Math.max(50, Math.floor(base * 0.4 * Math.pow(L, 1.6)));
}

// Levels a party member up: role-based stat recompute (matches makeCompanion
// exactly, so a companion leveled from L1 is identical to a fresh recruit at
// the same level) plus a small heal. Routes through spendGold (respects the
// infinite-gold perk). No hard cap.
export function levelUpCompanion(s, companionId) {
  const c = (s.party || []).find(x => x && x.id === companionId);
  if (!c) return { ok: false, reason: 'not-found' };
  const cost = companionLevelCost(c);
  if (!spendGold(s, cost)) return { ok: false, reason: 'gold', cost };
  c.level = Math.max(1, Math.floor(c.level || 1)) + 1;
  recomputeCompanion(c);
  c.hp = Math.min(c.maxHp, (Number(c.hp) || 0) + 25);
  return { ok: true, cost, level: c.level };
}

// Lightweight combat stats view for a companion (dodge/parry/counter support).
// damageMult scales the companion's strike damage; damageTakenMult scales
// incoming damage (applied by the battle tick for companion targets).
export function companionStats(c) {
  const role = COMPANION_ROLES[(c && c.roleKind) || companionRole(c)] || COMPANION_ROLES.dps;
  return {
    attack: c.attack, defense: c.defense,
    critChance: c.critChance || 5, critDamage: 150,
    dodge: c.dodge || 5, parry: 0,
    damageMult: role.dmgMult, damageTakenMult: role.takenMult,
  };
}

// Healer mend: healer-role companions restore PLAYER hp every
// HEALER_MEND_SEC seconds for HEALER_MEND_PCT of player max HP.
// Pure function of (state, companion, playerMaxHp) so it's unit-testable;
// the battle tick owns the cooldown timer and passes computeStats().maxHp.
export const HEALER_MEND_SEC = 8;
export const HEALER_MEND_PCT = 0.10;
export function applyHealerMend(state, companion, playerMaxHp) {
  const roleKind = (companion && companion.roleKind) || companionRole(companion);
  if (roleKind !== 'healer') return 0;
  if (!state || !state.hero) return 0;
  const maxHp = Number(playerMaxHp) || 0;
  if (maxHp <= 0) return 0;
  const missing = maxHp - (Number(state.hero.hp) || 0);
  if (missing <= 0) return 0;
  const heal = Math.max(1, Math.min(missing, Math.round(maxHp * HEALER_MEND_PCT)));
  state.hero.hp = (Number(state.hero.hp) || 0) + heal;
  return heal;
}

// ---------------- Rebirth ----------------
// Level >= MAX_LEVEL. Sets the hero back to level 1; everything else
// (stage, gold, gear, pets, titles, styles) is kept. Each rebirth raises all
// future XP requirements by x1.35 (stacking), so the climb stays meaningful.
// REMASTER: Rebirth disabled. This is a no-op kept for save compatibility.
export function rebirth(state) {
  return null;
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
  const gold = Math.floor(kills * goldForKill(state.stage, stats.goldBonus + (stats.talentGoldPct || 0)) * eventGoldMult());
  const xp = kills * killXpFor(state, state.stage); // capped per-kill XP; gainXp applies race/gear mults
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

// ---------------- Mastery talents (REMOVED) ----------------
// The Might/Vitality/Fortune mastery panel was removed from the UI.
// The TALENTS constant and spendTalent() are deleted. Save data may still
// contain a stale `state.mastery` object — it is ignored and harmless.

// ---------------- Class talent milestones (level-system rework) ----------------
// Hitting one of these levels grants +1 class talent point (banked for the
// per-class talent trees) plus a commemorative title (auto-unlocked via
// TITLE_DEFS checks). Points persist through rebirth, like mastery.
export const MILESTONE_LEVELS = [25, 50, 75, 100];
export function ensureClassTalents(state) {
  if (!state.classTalents || typeof state.classTalents !== 'object') {
    state.classTalents = { points: 0, spent: {} };
  }
  const ct = state.classTalents;
  ct.points = Math.max(0, Math.floor(ct.points || 0));
  if (!ct.spent || typeof ct.spent !== 'object') ct.spent = {};
  return ct;
}

// ---------------- Class talent trees (Hunter prototype) ----------------
// Points: 1 per 5 levels starting at 10, +1 bonus at 25/50/75/100.
// Rows: row 1 open; row 2 needs 5 pts in tree; row 3 needs 10; row 4
// (capstone) needs 15. Points + spent ranks persist through rebirth.
// Respec is free while tuning (see refundClassTalents).
export const TALENT_TREES = {
  hunter: {
    beast: {
      id: 'beast', name: 'Beast Mastery', emoji: '🐾',
      desc: 'Bond with your pets. Bigger, tougher, deadlier companions.',
      talents: [
        { id: 'kindred-spirit', name: 'Kindred Spirit', emoji: '💞', row: 1, maxRank: 5, perRank: { petDmgPct: 2 }, desc: '+2% pet damage per rank' },
        { id: 'thick-hide', name: 'Thick Hide', emoji: '🛡️', row: 1, maxRank: 5, perRank: { petHpPct: 2 }, desc: '+2% pet max HP per rank' },
        { id: 'bestial-wrath', name: 'Bestial Wrath', emoji: '😡', row: 2, maxRank: 5, perRank: { petDmgPct: 4 }, desc: '+4% pet damage per rank' },
        { id: 'mend-mastery', name: 'Mend Mastery', emoji: '💚', row: 2, maxRank: 5, perRank: { reviveFrac: 0.05, mendInspirePct: 2 }, desc: 'Mend Pet revives at +5% HP per rank and inspires +2% pet damage per rank' },
        { id: 'alpha-predator', name: 'Alpha Predator', emoji: '👑', row: 3, maxRank: 5, perRank: { petDmgPct: 6 }, desc: '+6% pet damage per rank' },
        { id: 'pack-leader', name: 'Pack Leader', emoji: '🐺', row: 3, maxRank: 1, perRank: { secondBondMult: 1 }, desc: "Your second pet's bond bonuses are doubled" },
        { id: 'beast-god', name: 'Beast God', emoji: '⚡', row: 4, maxRank: 1, capstone: true, perRank: { petDmgPct: 50, petHpPct: 50 }, desc: 'CAPSTONE: +50% pet damage, +50% pet HP' },
      ],
    },
    marks: {
      id: 'marks', name: 'Marksmanship', emoji: '🎯',
      desc: 'Ranged precision. Crits that end fights before they start.',
      talents: [
        { id: 'deadeye', name: 'Deadeye', emoji: '👁️', row: 1, maxRank: 5, perRank: { critCh: 2 }, desc: '+2% crit chance per rank' },
        { id: 'steady-aim', name: 'Steady Aim', emoji: '🏹', row: 1, maxRank: 5, perRank: { atkPct: 2 }, desc: '+2% attack per rank' },
        { id: 'piercing-shots', name: 'Piercing Shots', emoji: '🏹', row: 2, maxRank: 5, perRank: { critDmgPct: 4 }, desc: '+4% crit damage per rank' },
        { id: 'rapid-fire', name: 'Rapid Fire', emoji: '🔥', row: 2, maxRank: 5, perRank: { atkSpdPct: 2 }, desc: '+2% attack speed per rank' },
        { id: 'sniper', name: 'Sniper', emoji: '🔭', row: 3, maxRank: 5, perRank: { critDmgPct: 6 }, desc: '+6% crit damage per rank' },
        { id: 'kill-shot', name: 'Kill Shot', emoji: '💀', row: 3, maxRank: 1, perRank: { executePct: 100 }, desc: 'Execute: +100% damage to enemies below 20% HP' },
        { id: 'one-shot', name: 'One Shot', emoji: '☄️', row: 4, maxRank: 1, capstone: true, perRank: { critDmgPct: 100, critCh: 20 }, desc: 'CAPSTONE: +100% crit damage, +20% crit chance' },
      ],
    },
    surv: {
      id: 'surv', name: 'Survival', emoji: '🌲',
      desc: 'Outlast everything. The wilderness provides.',
      talents: [
        { id: 'toughness', name: 'Toughness', emoji: '🪨', row: 1, maxRank: 5, perRank: { maxHpPct: 2 }, desc: '+2% max HP per rank' },
        { id: 'evasion', name: 'Evasion', emoji: '💨', row: 1, maxRank: 5, perRank: { dodge: 1 }, desc: '+1% dodge per rank' },
        { id: 'survivalist', name: 'Survivalist', emoji: '🎒', row: 2, maxRank: 5, perRank: { maxHpPct: 4 }, desc: '+4% max HP per rank' },
        { id: 'counterattack', name: 'Counterattack', emoji: '⚔️', row: 2, maxRank: 5, perRank: { counterCh: 2 }, desc: '+2% chance to counterattack per rank' },
        { id: 'unkillable', name: 'Unkillable', emoji: '💪', row: 3, maxRank: 5, perRank: { maxHpPct: 6 }, desc: '+6% max HP per rank' },
        { id: 'adrenaline', name: 'Adrenaline', emoji: '💉', row: 3, maxRank: 5, perRank: { lifesteal: 4 }, desc: '+4% lifesteal per rank' },
        { id: 'immortal', name: 'Immortal', emoji: '✨', row: 4, maxRank: 1, capstone: true, perRank: { maxHpPct: 50, dodge: 10, lifesteal: 10 }, desc: 'CAPSTONE: +50% max HP, +10% dodge, +10% lifesteal' },
      ],
    },
  },
  warrior: {
    prot: {
      id: 'prot', name: 'Protection', emoji: '🛡️',
      desc: 'An unbreakable wall. Taunt, block, and outlast.',
      talents: [
        { id: 'iron-skin', name: 'Iron Skin', emoji: '🪨', row: 1, maxRank: 5, perRank: { defPct: 3 }, desc: '+3% defense per rank' },
        { id: 'bulwark', name: 'Bulwark', emoji: '🧱', row: 1, maxRank: 5, perRank: { maxHpPct: 2 }, desc: '+2% max HP per rank' },
        { id: 'shield-wall', name: 'Shield Wall', emoji: '🛡️', row: 2, maxRank: 5, perRank: { blockCh: 2 }, desc: '+2% block chance per rank' },
        { id: 'taunt-mastery', name: 'Taunt Mastery', emoji: '📢', row: 2, maxRank: 5, perRank: { defPct: 4 }, desc: '+4% defense per rank' },
        { id: 'last-stand', name: 'Last Stand', emoji: '💪', row: 3, maxRank: 5, perRank: { maxHpPct: 6 }, desc: '+6% max HP per rank' },
        { id: 'revenge', name: 'Revenge', emoji: '⚔️', row: 3, maxRank: 5, perRank: { counterCh: 3 }, desc: '+3% counterattack chance per rank' },
        { id: 'unbreakable', name: 'Unbreakable', emoji: '💎', row: 4, maxRank: 1, capstone: true, perRank: { defPct: 30, maxHpPct: 30, blockCh: 15 }, desc: 'CAPSTONE: +30% defense, +30% max HP, +15% block' },
      ],
    },
    arms: {
      id: 'arms', name: 'Arms', emoji: '⚔️',
      desc: 'Master of weapons. Overwhelming single-target damage.',
      talents: [
        { id: 'weapon-mastery', name: 'Weapon Mastery', emoji: '🗡️', row: 1, maxRank: 5, perRank: { atkPct: 3 }, desc: '+3% attack per rank' },
        { id: 'deep-wounds', name: 'Deep Wounds', emoji: '🩸', row: 1, maxRank: 5, perRank: { critCh: 1 }, desc: '+1% crit chance per rank' },
        { id: 'mortal-strike', name: 'Mortal Strike', emoji: '💥', row: 2, maxRank: 5, perRank: { critDmgPct: 5 }, desc: '+5% crit damage per rank' },
        { id: 'sweeping-strikes', name: 'Sweeping Strikes', emoji: '🌪️', row: 2, maxRank: 5, perRank: { atkPct: 4 }, desc: '+4% attack per rank' },
        { id: 'colossus-smash', name: 'Colossus Smash', emoji: '🔨', row: 3, maxRank: 5, perRank: { critDmgPct: 8 }, desc: '+8% crit damage per rank' },
        { id: 'execute-arms', name: 'Execute', emoji: '💀', row: 3, maxRank: 1, perRank: { executePct: 100 }, desc: 'Execute: +100% damage to enemies below 20% HP' },
        { id: 'war-god', name: 'War God', emoji: '⚡', row: 4, maxRank: 1, capstone: true, perRank: { atkPct: 50, critDmgPct: 50 }, desc: 'CAPSTONE: +50% attack, +50% crit damage' },
      ],
    },
    fury: {
      id: 'fury', name: 'Fury', emoji: '🌀',
      desc: 'Uncontrolled rage. Faster, harder, relentless.',
      talents: [
        { id: 'bloodthirst', name: 'Bloodthirst', emoji: '🩸', row: 1, maxRank: 5, perRank: { lifesteal: 2 }, desc: '+2% lifesteal per rank' },
        { id: 'enrage', name: 'Enrage', emoji: '😡', row: 1, maxRank: 5, perRank: { atkSpdPct: 2 }, desc: '+2% attack speed per rank' },
        { id: 'raging-blow', name: 'Raging Blow', emoji: '👊', row: 2, maxRank: 5, perRank: { atkPct: 4 }, desc: '+4% attack per rank' },
        { id: 'frenzy', name: 'Frenzy', emoji: '🔥', row: 2, maxRank: 5, perRank: { atkSpdPct: 3 }, desc: '+3% attack speed per rank' },
        { id: 'bloodbath', name: 'Bloodbath', emoji: '🌊', row: 3, maxRank: 5, perRank: { lifesteal: 4 }, desc: '+4% lifesteal per rank' },
        { id: 'rampage', name: 'Rampage', emoji: '💢', row: 3, maxRank: 5, perRank: { atkPct: 6 }, desc: '+6% attack per rank' },
        { id: 'berserk', name: 'Berserk', emoji: '👹', row: 4, maxRank: 1, capstone: true, perRank: { atkPct: 40, atkSpdPct: 30, lifesteal: 10 }, desc: 'CAPSTONE: +40% attack, +30% attack speed, +10% lifesteal' },
      ],
    },
  },
  mage: {
    fire: {
      id: 'fire', name: 'Fire', emoji: '🔥',
      desc: 'Burn everything. Raw destructive power.',
      talents: [
        { id: 'ignite', name: 'Ignite', emoji: '🔥', row: 1, maxRank: 5, perRank: { spellPowerPct: 3 }, desc: '+3% spell power per rank' },
        { id: 'pyroblast', name: 'Pyroblast', emoji: '☄️', row: 1, maxRank: 5, perRank: { critCh: 2 }, desc: '+2% crit chance per rank' },
        { id: 'living-bomb', name: 'Living Bomb', emoji: '💣', row: 2, maxRank: 5, perRank: { dotPct: 5 }, desc: '+5% DoT damage per rank' },
        { id: 'critical-mass', name: 'Critical Mass', emoji: '💥', row: 2, maxRank: 5, perRank: { critDmgPct: 5 }, desc: '+5% crit damage per rank' },
        { id: 'inferno', name: 'Inferno', emoji: '🌋', row: 3, maxRank: 5, perRank: { spellPowerPct: 6 }, desc: '+6% spell power per rank' },
        { id: 'combustion', name: 'Combustion', emoji: '🧨', row: 3, maxRank: 5, perRank: { dotPct: 8 }, desc: '+8% DoT damage per rank' },
        { id: 'meteor', name: 'Meteor', emoji: '🌠', row: 4, maxRank: 1, capstone: true, perRank: { spellPowerPct: 50, critDmgPct: 50 }, desc: 'CAPSTONE: +50% spell power, +50% crit damage' },
      ],
    },
    frost: {
      id: 'frost', name: 'Frost', emoji: '❄️',
      desc: 'Control the battlefield. Slow, freeze, shatter.',
      talents: [
        { id: 'frostbite', name: 'Frostbite', emoji: '🥶', row: 1, maxRank: 5, perRank: { spellPowerPct: 2 }, desc: '+2% spell power per rank' },
        { id: 'ice-barrier', name: 'Ice Barrier', emoji: '🧊', row: 1, maxRank: 5, perRank: { maxHpPct: 3 }, desc: '+3% max HP per rank' },
        { id: 'shatter', name: 'Shatter', emoji: '💎', row: 2, maxRank: 5, perRank: { critCh: 3 }, desc: '+3% crit chance per rank' },
        { id: 'frozen-core', name: 'Frozen Core', emoji: '🔷', row: 2, maxRank: 5, perRank: { defPct: 4 }, desc: '+4% defense per rank' },
        { id: 'blizzard', name: 'Blizzard', emoji: '🌨️', row: 3, maxRank: 5, perRank: { spellPowerPct: 5 }, desc: '+5% spell power per rank' },
        { id: 'deep-freeze', name: 'Deep Freeze', emoji: '⛄', row: 3, maxRank: 5, perRank: { dodge: 2 }, desc: '+2% dodge per rank' },
        { id: 'frozen-orb', name: 'Frozen Orb', emoji: '🔮', row: 4, maxRank: 1, capstone: true, perRank: { spellPowerPct: 40, defPct: 20, maxHpPct: 20 }, desc: 'CAPSTONE: +40% spell power, +20% defense, +20% max HP' },
      ],
    },
    arcane: {
      id: 'arcane', name: 'Arcane', emoji: '✨',
      desc: 'Pure magic. Efficiency, power, and mastery over mana.',
      talents: [
        { id: 'arcane-intellect', name: 'Arcane Intellect', emoji: '🧠', row: 1, maxRank: 5, perRank: { spellPowerPct: 2 }, desc: '+2% spell power per rank' },
        { id: 'mana-efficiency', name: 'Mana Efficiency', emoji: '💧', row: 1, maxRank: 5, perRank: { manaCostPct: 3 }, desc: '-3% mana cost per rank' },
        { id: 'arcane-missiles', name: 'Arcane Missiles', emoji: '🌟', row: 2, maxRank: 5, perRank: { atkSpdPct: 3 }, desc: '+3% attack speed per rank' },
        { id: 'netherwind', name: 'Netherwind', emoji: '💫', row: 2, maxRank: 5, perRank: { spellPowerPct: 4 }, desc: '+4% spell power per rank' },
        { id: 'presence-of-mind', name: 'Presence of Mind', emoji: '🔯', row: 3, maxRank: 5, perRank: { critDmgPct: 6 }, desc: '+6% crit damage per rank' },
        { id: 'arcane-barrage', name: 'Arcane Barrage', emoji: '💜', row: 3, maxRank: 5, perRank: { spellPowerPct: 6 }, desc: '+6% spell power per rank' },
        { id: 'arcane-overload', name: 'Arcane Overload', emoji: '🌌', row: 4, maxRank: 1, capstone: true, perRank: { spellPowerPct: 60, manaCostPct: 20 }, desc: 'CAPSTONE: +60% spell power, -20% mana cost' },
      ],
    },
  },
  assassin: {
    assn: {
      id: 'assn', name: 'Assassination', emoji: '🗡️',
      desc: 'Silent death. Poisons, crits, and finishing blows.',
      talents: [
        { id: 'lethal-dose', name: 'Lethal Dose', emoji: '☠️', row: 1, maxRank: 5, perRank: { critCh: 2 }, desc: '+2% crit chance per rank' },
        { id: 'venom', name: 'Venom', emoji: '🐍', row: 1, maxRank: 5, perRank: { dotPct: 4 }, desc: '+4% poison damage per rank' },
        { id: 'mutilate', name: 'Mutilate', emoji: '🔪', row: 2, maxRank: 5, perRank: { atkPct: 4 }, desc: '+4% attack per rank' },
        { id: 'deadly-poison', name: 'Deadly Poison', emoji: '🧪', row: 2, maxRank: 5, perRank: { dotPct: 6 }, desc: '+6% poison damage per rank' },
        { id: 'vendetta', name: 'Vendetta', emoji: '🎯', row: 3, maxRank: 5, perRank: { critDmgPct: 8 }, desc: '+8% crit damage per rank' },
        { id: 'kill-shot-assn', name: 'Kill Shot', emoji: '💀', row: 3, maxRank: 1, perRank: { executePct: 100 }, desc: 'Execute: +100% damage to enemies below 20% HP' },
        { id: 'deathmark', name: 'Deathmark', emoji: '🎭', row: 4, maxRank: 1, capstone: true, perRank: { critCh: 25, critDmgPct: 75 }, desc: 'CAPSTONE: +25% crit chance, +75% crit damage' },
      ],
    },
    subt: {
      id: 'subt', name: 'Subtlety', emoji: '🌙',
      desc: 'Strike from shadow. Dodge, evade, and vanish.',
      talents: [
        { id: 'shadowstep', name: 'Shadowstep', emoji: '👣', row: 1, maxRank: 5, perRank: { dodge: 2 }, desc: '+2% dodge per rank' },
        { id: 'opener', name: 'Opener', emoji: '🌑', row: 1, maxRank: 5, perRank: { atkPct: 3 }, desc: '+3% attack per rank' },
        { id: 'elusiveness', name: 'Elusiveness', emoji: '💨', row: 2, maxRank: 5, perRank: { dodge: 3 }, desc: '+3% dodge per rank' },
        { id: 'find-weakness', name: 'Find Weakness', emoji: '🔍', row: 2, maxRank: 5, perRank: { critCh: 3 }, desc: '+3% crit chance per rank' },
        { id: 'shadow-dance-prep', name: 'Dance Prep', emoji: '💃', row: 3, maxRank: 5, perRank: { atkSpdPct: 4 }, desc: '+4% attack speed per rank' },
        { id: 'smoke-bomb', name: 'Smoke Bomb', emoji: '💣', row: 3, maxRank: 5, perRank: { dodge: 4 }, desc: '+4% dodge per rank' },
        { id: 'shadow-dance', name: 'Shadow Dance', emoji: '🌒', row: 4, maxRank: 1, capstone: true, perRank: { dodge: 20, critCh: 20, atkPct: 30 }, desc: 'CAPSTONE: +20% dodge, +20% crit, +30% attack' },
      ],
    },
    combat: {
      id: 'combat', name: 'Combat', emoji: '⚡',
      desc: 'Relentless assault. Speed, sustain, and combo strikes.',
      talents: [
        { id: 'blade-flurry', name: 'Blade Flurry', emoji: '🌀', row: 1, maxRank: 5, perRank: { atkSpdPct: 3 }, desc: '+3% attack speed per rank' },
        { id: 'combat-readiness', name: 'Combat Readiness', emoji: '🛡️', row: 1, maxRank: 5, perRank: { maxHpPct: 2 }, desc: '+2% max HP per rank' },
        { id: 'adrenaline-combat', name: 'Adrenaline', emoji: '💉', row: 2, maxRank: 5, perRank: { atkSpdPct: 4 }, desc: '+4% attack speed per rank' },
        { id: 'riposte', name: 'Riposte', emoji: '🤺', row: 2, maxRank: 5, perRank: { counterCh: 3 }, desc: '+3% counterattack chance per rank' },
        { id: 'killing-spree', name: 'Killing Spree', emoji: '🔪', row: 3, maxRank: 5, perRank: { atkPct: 6 }, desc: '+6% attack per rank' },
        { id: 'sustain', name: 'Sustain', emoji: '❤️', row: 3, maxRank: 5, perRank: { lifesteal: 3 }, desc: '+3% lifesteal per rank' },
        { id: 'adrenaline-rush', name: 'Adrenaline Rush', emoji: '⚡', row: 4, maxRank: 1, capstone: true, perRank: { atkSpdPct: 40, atkPct: 30, lifesteal: 10 }, desc: 'CAPSTONE: +40% attack speed, +30% attack, +10% lifesteal' },
      ],
    },
  },
  necromancer: {
    summ: {
      id: 'summ', name: 'Summoning', emoji: '💀',
      desc: 'Command the dead. Bigger, tougher, more minions.',
      talents: [
        { id: 'raise-dead', name: 'Raise Dead', emoji: '🧟', row: 1, maxRank: 5, perRank: { minionDmgPct: 4 }, desc: '+4% minion damage per rank' },
        { id: 'corpse-armor', name: 'Corpse Armor', emoji: '🦴', row: 1, maxRank: 5, perRank: { minionHpPct: 4 }, desc: '+4% minion HP per rank' },
        { id: 'dark-pact', name: 'Dark Pact', emoji: '📜', row: 2, maxRank: 5, perRank: { minionDmgPct: 6 }, desc: '+6% minion damage per rank' },
        { id: 'bone-shield', name: 'Bone Shield', emoji: '🛡️', row: 2, maxRank: 5, perRank: { minionHpPct: 6 }, desc: '+6% minion HP per rank' },
        { id: 'mass-raise', name: 'Mass Raise', emoji: '👥', row: 3, maxRank: 5, perRank: { minionDmgPct: 8 }, desc: '+8% minion damage per rank' },
        { id: 'soul-harvest', name: 'Soul Harvest', emoji: '👻', row: 3, maxRank: 5, perRank: { spellPowerPct: 5 }, desc: '+5% spell power per rank' },
        { id: 'army-of-dead', name: 'Army of the Dead', emoji: '💀', row: 4, maxRank: 1, capstone: true, perRank: { minionDmgPct: 50, minionHpPct: 50 }, desc: 'CAPSTONE: +50% minion damage, +50% minion HP' },
      ],
    },
    blood: {
      id: 'blood', name: 'Blood', emoji: '🩸',
      desc: 'Sacrifice HP for power. Lifesteal keeps you alive.',
      talents: [
        { id: 'bloodthirst-nec', name: 'Bloodthirst', emoji: '🩸', row: 1, maxRank: 5, perRank: { lifesteal: 3 }, desc: '+3% lifesteal per rank' },
        { id: 'sanguine', name: 'Sanguine', emoji: '❤️', row: 1, maxRank: 5, perRank: { maxHpPct: 3 }, desc: '+3% max HP per rank' },
        { id: 'blood-boil', name: 'Blood Boil', emoji: '♨️', row: 2, maxRank: 5, perRank: { spellPowerPct: 4 }, desc: '+4% spell power per rank' },
        { id: 'vampiric-embrace', name: 'Vampiric Embrace', emoji: '🧛', row: 2, maxRank: 5, perRank: { lifesteal: 4 }, desc: '+4% lifesteal per rank' },
        { id: 'hemorrhage', name: 'Hemorrhage', emoji: '💉', row: 3, maxRank: 5, perRank: { dotPct: 6 }, desc: '+6% bleed damage per rank' },
        { id: 'blood-shield', name: 'Blood Shield', emoji: '🛡️', row: 3, maxRank: 5, perRank: { maxHpPct: 6 }, desc: '+6% max HP per rank' },
        { id: 'blood-god', name: 'Blood God', emoji: '👑', row: 4, maxRank: 1, capstone: true, perRank: { lifesteal: 20, spellPowerPct: 40, maxHpPct: 30 }, desc: 'CAPSTONE: +20% lifesteal, +40% spell power, +30% max HP' },
      ],
    },
    shadow: {
      id: 'shadow', name: 'Shadow', emoji: '🌑',
      desc: 'Darkness consumes. DoTs, drains, and despair.',
      talents: [
        { id: 'shadow-bolt', name: 'Shadow Bolt', emoji: '🌑', row: 1, maxRank: 5, perRank: { spellPowerPct: 3 }, desc: '+3% spell power per rank' },
        { id: 'corruption', name: 'Corruption', emoji: '🖤', row: 1, maxRank: 5, perRank: { dotPct: 5 }, desc: '+5% DoT damage per rank' },
        { id: 'drain-life', name: 'Drain Life', emoji: '💜', row: 2, maxRank: 5, perRank: { lifesteal: 3 }, desc: '+3% lifesteal per rank' },
        { id: 'haunt', name: 'Haunt', emoji: '👻', row: 2, maxRank: 5, perRank: { dotPct: 6 }, desc: '+6% DoT damage per rank' },
        { id: 'soul-drain', name: 'Soul Drain', emoji: '🌀', row: 3, maxRank: 5, perRank: { spellPowerPct: 6 }, desc: '+6% spell power per rank' },
        { id: 'nightfall', name: 'Nightfall', emoji: '🌃', row: 3, maxRank: 5, perRank: { critCh: 4 }, desc: '+4% crit chance per rank' },
        { id: 'eclipse', name: 'Eclipse', emoji: '🌘', row: 4, maxRank: 1, capstone: true, perRank: { spellPowerPct: 50, dotPct: 50 }, desc: 'CAPSTONE: +50% spell power, +50% DoT damage' },
      ],
    },
  },
  berserker: {
    rage: {
      id: 'rage', name: 'Rage', emoji: '😡',
      desc: 'Fuel the fury. More rage, more damage, more carnage.',
      talents: [
        { id: 'anger-management', name: 'Anger Management', emoji: '🤬', row: 1, maxRank: 5, perRank: { rageGenPct: 5 }, desc: '+5% rage generation per rank' },
        { id: 'fueled-by-pain', name: 'Fueled by Pain', emoji: '😤', row: 1, maxRank: 5, perRank: { atkPct: 3 }, desc: '+3% attack per rank' },
        { id: 'enrage-ber', name: 'Enrage', emoji: '👹', row: 2, maxRank: 5, perRank: { atkPct: 5 }, desc: '+5% attack per rank' },
        { id: 'boiling-blood', name: 'Boiling Blood', emoji: '🩸', row: 2, maxRank: 5, perRank: { rageGenPct: 6 }, desc: '+6% rage generation per rank' },
        { id: 'wrecking-crew', name: 'Wrecking Crew', emoji: '💥', row: 3, maxRank: 5, perRank: { critDmgPct: 8 }, desc: '+8% crit damage per rank' },
        { id: 'recklessness', name: 'Recklessness', emoji: '🎲', row: 3, maxRank: 5, perRank: { critCh: 4 }, desc: '+4% crit chance per rank' },
        { id: 'unending-rage', name: 'Unending Rage', emoji: '♾️', row: 4, maxRank: 1, capstone: true, perRank: { atkPct: 50, rageGenPct: 50 }, desc: 'CAPSTONE: +50% attack, +50% rage generation' },
      ],
    },
    butch: {
      id: 'butch', name: 'Butchery', emoji: '🪓',
      desc: 'Cleave through crowds. Bleeds, executes, massacres.',
      talents: [
        { id: 'cleave', name: 'Cleave', emoji: '🪓', row: 1, maxRank: 5, perRank: { atkPct: 3 }, desc: '+3% attack per rank' },
        { id: 'gushing-wound', name: 'Gushing Wound', emoji: '🩸', row: 1, maxRank: 5, perRank: { bleedPct: 5 }, desc: '+5% bleed damage per rank' },
        { id: 'whirlwind', name: 'Whirlwind', emoji: '🌪️', row: 2, maxRank: 5, perRank: { atkSpdPct: 4 }, desc: '+4% attack speed per rank' },
        { id: 'deep-cuts', name: 'Deep Cuts', emoji: '🔪', row: 2, maxRank: 5, perRank: { bleedPct: 6 }, desc: '+6% bleed damage per rank' },
        { id: 'slaughter', name: 'Slaughter', emoji: '⚔️', row: 3, maxRank: 5, perRank: { atkPct: 6 }, desc: '+6% attack per rank' },
        { id: 'execute-ber', name: 'Execute', emoji: '💀', row: 3, maxRank: 1, perRank: { executePct: 100 }, desc: 'Execute: +100% damage to enemies below 20% HP' },
        { id: 'massacre', name: 'Massacre', emoji: '🌊', row: 4, maxRank: 1, capstone: true, perRank: { atkPct: 40, bleedPct: 50, critDmgPct: 30 }, desc: 'CAPSTONE: +40% attack, +50% bleed, +30% crit damage' },
      ],
    },
    resil: {
      id: 'resil', name: 'Resilience', emoji: '🩹',
      desc: 'Refuse to die. Regenerate, endure, and outlast.',
      talents: [
        { id: 'thick-skin', name: 'Thick Skin', emoji: '🦏', row: 1, maxRank: 5, perRank: { maxHpPct: 3 }, desc: '+3% max HP per rank' },
        { id: 'regeneration', name: 'Regeneration', emoji: '💚', row: 1, maxRank: 5, perRank: { lifesteal: 2 }, desc: '+2% lifesteal per rank' },
        { id: 'tough-as-nails', name: 'Tough as Nails', emoji: '🔩', row: 2, maxRank: 5, perRank: { dmgReducPct: 2 }, desc: '+2% damage reduction per rank' },
        { id: 'second-wind', name: 'Second Wind', emoji: '💨', row: 2, maxRank: 5, perRank: { maxHpPct: 4 }, desc: '+4% max HP per rank' },
        { id: 'die-hard', name: 'Die Hard', emoji: '💀', row: 3, maxRank: 5, perRank: { dmgReducPct: 3 }, desc: '+3% damage reduction per rank' },
        { id: 'unbreakable-will', name: 'Unbreakable Will', emoji: '🧠', row: 3, maxRank: 5, perRank: { maxHpPct: 6 }, desc: '+6% max HP per rank' },
        { id: 'undying', name: 'Undying', emoji: '⚡', row: 4, maxRank: 1, capstone: true, perRank: { maxHpPct: 50, dmgReducPct: 15, lifesteal: 10 }, desc: 'CAPSTONE: +50% max HP, +15% damage reduction, +10% lifesteal' },
      ],
    },
  },
  druid: {
    bear: {
      id: 'bear', name: 'Bear', emoji: '🐻',
      desc: 'Tank form. Massive HP, thick hide, unstoppable.',
      talents: [
        { id: 'thick-fur', name: 'Thick Fur', emoji: '🧥', row: 1, maxRank: 5, perRank: { maxHpPct: 3 }, desc: '+3% max HP per rank' },
        { id: 'bear-armor', name: 'Bear Armor', emoji: '🛡️', row: 1, maxRank: 5, perRank: { defPct: 3 }, desc: '+3% defense per rank' },
        { id: 'maul', name: 'Maul', emoji: '🐾', row: 2, maxRank: 5, perRank: { atkPct: 4 }, desc: '+4% attack per rank' },
        { id: 'frenzied-regen', name: 'Frenzied Regen', emoji: '💚', row: 2, maxRank: 5, perRank: { lifesteal: 3 }, desc: '+3% lifesteal per rank' },
        { id: 'ursine-vigor', name: 'Ursine Vigor', emoji: '💪', row: 3, maxRank: 5, perRank: { maxHpPct: 6 }, desc: '+6% max HP per rank' },
        { id: 'pulverize', name: 'Pulverize', emoji: '💥', row: 3, maxRank: 5, perRank: { defPct: 5 }, desc: '+5% defense per rank' },
        { id: 'unstoppable', name: 'Unstoppable', emoji: '🦏', row: 4, maxRank: 1, capstone: true, perRank: { maxHpPct: 50, defPct: 30, dmgReducPct: 10 }, desc: 'CAPSTONE: +50% max HP, +30% defense, +10% damage reduction' },
      ],
    },
    cat: {
      id: 'cat', name: 'Cat', emoji: '🐱',
      desc: 'DPS form. Speed, crits, and savage strikes.',
      talents: [
        { id: 'feline-grace', name: 'Feline Grace', emoji: '💨', row: 1, maxRank: 5, perRank: { dodge: 2 }, desc: '+2% dodge per rank' },
        { id: 'sharpened-claws', name: 'Sharpened Claws', emoji: '🐾', row: 1, maxRank: 5, perRank: { critCh: 2 }, desc: '+2% crit chance per rank' },
        { id: 'predatory-swiftness', name: 'Predatory Swiftness', emoji: '⚡', row: 2, maxRank: 5, perRank: { atkSpdPct: 4 }, desc: '+4% attack speed per rank' },
        { id: 'savage-roar', name: 'Savage Roar', emoji: '🦁', row: 2, maxRank: 5, perRank: { atkPct: 4 }, desc: '+4% attack per rank' },
        { id: 'rip', name: 'Rip', emoji: '🩸', row: 3, maxRank: 5, perRank: { bleedPct: 6 }, desc: '+6% bleed damage per rank' },
        { id: 'ferocious-bite', name: 'Ferocious Bite', emoji: '😼', row: 3, maxRank: 5, perRank: { critDmgPct: 8 }, desc: '+8% crit damage per rank' },
        { id: 'apex-predator', name: 'Apex Predator', emoji: '👑', row: 4, maxRank: 1, capstone: true, perRank: { atkPct: 40, critCh: 15, atkSpdPct: 20 }, desc: 'CAPSTONE: +40% attack, +15% crit, +20% attack speed' },
      ],
    },
    resto: {
      id: 'resto', name: 'Restoration', emoji: '🌿',
      desc: 'Heal and sustain. HoTs, cleanses, and tranquility.',
      talents: [
        { id: 'natures-touch', name: "Nature's Touch", emoji: '🌱', row: 1, maxRank: 5, perRank: { healPct: 4 }, desc: '+4% healing power per rank' },
        { id: 'rejuvenation-mastery', name: 'Rejuvenation', emoji: '🌿', row: 1, maxRank: 5, perRank: { maxHpPct: 2 }, desc: '+2% max HP per rank' },
        { id: 'gift-of-nature', name: 'Gift of Nature', emoji: '🎁', row: 2, maxRank: 5, perRank: { healPct: 6 }, desc: '+6% healing power per rank' },
        { id: 'natures-swiftness', name: "Nature's Swiftness", emoji: '💫', row: 2, maxRank: 5, perRank: { manaCostPct: 4 }, desc: '-4% mana cost per rank' },
        { id: 'flourish', name: 'Flourish', emoji: '🌸', row: 3, maxRank: 5, perRank: { healPct: 8 }, desc: '+8% healing power per rank' },
        { id: 'cleanse', name: 'Cleanse', emoji: '✨', row: 3, maxRank: 5, perRank: { lifesteal: 3 }, desc: '+3% lifesteal per rank' },
        { id: 'tranquility', name: 'Tranquility', emoji: '🕊️', row: 4, maxRank: 1, capstone: true, perRank: { healPct: 50, maxHpPct: 25, manaCostPct: 20 }, desc: 'CAPSTONE: +50% healing, +25% max HP, -20% mana cost' },
      ],
    },
  },
};

// REMASTER: 1 talent point per level (no milestones, no rebirth requirement).
export function talentPointsEarned(level) {
  const lv = Math.max(1, Math.floor(level || 1));
  return lv; // 1 point per level
}

// Total ranks ever spent (spent keys are "classId:treeId:talentId" -> rank).
export function classTalentSpentTotal(state) {
  const ct = ensureClassTalents(state);
  let total = 0;
  for (const k of Object.keys(ct.spent || {})) {
    total += Math.max(0, Math.floor(ct.spent[k] || 0));
  }
  return total;
}

// Points spent inside one tree (for row gating).
export function treePointsSpent(state, classId, treeId) {
  const ct = ensureClassTalents(state);
  const prefix = `${classId}:${treeId}:`;
  let total = 0;
  for (const [k, v] of Object.entries(ct.spent || {})) {
    if (k.indexOf(prefix) === 0) total += Math.max(0, Math.floor(v || 0));
  }
  return total;
}

// Grant any newly-earned points (reconciled, never reduced — retroactive
// grants just work). Returns the number of points newly added.
export function reconcileTalentPoints(state) {
  const ct = ensureClassTalents(state);
  const entitled = talentPointsEarned(state.level);
  const used = classTalentSpentTotal(state);
  const want = Math.max(0, entitled - used);
  const added = Math.max(0, want - ct.points);
  ct.points = want;
  return added;
}

// Spend one point on a talent. Returns {ok, reason?}.
export function spendClassTalent(state, classId, treeId, talentId) {
  const trees = TALENT_TREES[classId];
  if (!trees) return { ok: false, reason: 'no-trees' };
  if (state.playerClass !== classId) return { ok: false, reason: 'wrong-class' };
  const tree = trees[treeId];
  if (!tree) return { ok: false, reason: 'no-tree' };
  const def = tree.talents.find(t => t.id === talentId);
  if (!def) return { ok: false, reason: 'no-talent' };
  const ct = ensureClassTalents(state);
  const key = `${classId}:${treeId}:${talentId}`;
  const rank = Math.max(0, Math.floor(ct.spent[key] || 0));
  if (rank >= def.maxRank) return { ok: false, reason: 'maxed' };
  const need = (def.row - 1) * 5;
  if (treePointsSpent(state, classId, treeId) < need) return { ok: false, reason: 'row-locked' };
  if (ct.points < 1) return { ok: false, reason: 'no-points' };
  ct.points -= 1;
  ct.spent[key] = rank + 1;
  return { ok: true };
}

// Free respec while tuning: refund every spent rank back to the pool.
export function refundClassTalents(state) {
  const ct = ensureClassTalents(state);
  ct.points += classTalentSpentTotal(state);
  ct.spent = {};
  return ct.points;
}

// Aggregate all active class-talent bonuses for the player's current class.
export function classTalentEffects(state) {
  const zero = {
    petDmgPct: 0, petHpPct: 0, atkPct: 0, critCh: 0, critDmgPct: 0,
    atkSpdPct: 0, maxHpPct: 0, dodge: 0, lifesteal: 0, counterCh: 0,
    reviveFrac: 0, mendInspirePct: 0, executePct: 0, secondBondMult: 0,
    defPct: 0, blockCh: 0, rageGenPct: 0, spellPowerPct: 0, dotPct: 0,
    minionDmgPct: 0, minionHpPct: 0, bleedPct: 0, dmgReducPct: 0,
    healPct: 0, manaCostPct: 0,
  };
  if (!state || !state.playerClass) return zero;
  const classId = state.playerClass;
  const trees = TALENT_TREES[classId];
  if (!trees) return zero;
  const ct = ensureClassTalents(state);
  for (const [key, rank] of Object.entries(ct.spent || {})) {
    const parts = String(key).split(':');
    if (parts.length !== 3 || parts[0] !== classId) continue;
    const tree = trees[parts[1]];
    if (!tree) continue;
    const def = tree.talents.find(t => t.id === parts[2]);
    if (!def || !def.perRank) continue;
    const r = Math.max(0, Math.floor(rank || 0));
    if (!r) continue;
    for (const [k, v] of Object.entries(def.perRank)) {
      if (k in zero && Number.isFinite(v)) zero[k] += v * r;
    }
  }
  return zero;
}

// ---------------- Professions ----------------
// Leveled with gold; passive always-on bonuses. Generic fantasy crafts.
export const PROFESSIONS = {
  herbalism: { name: 'Herb Gathering', emoji: '🌿', desc: '+0.5 HP/s regen per level', max: 20 },
  smithing:  { name: 'Smithing', emoji: '⚒️', desc: '+1.5% attack per level', max: 20 },
};
export const professionCost = (level) =>
  Math.round(60 * Math.pow(2.1, Math.max(0, (level || 1) - 1)));
// ============================================================
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
  { id: 'rebirth-1', name: 'Reborn', emoji: '🔥', desc: 'Rebirth once.', stars: 25, check: (s) => (s.rebirthCount || 0) >= 1 },
  { id: 'zone-5', name: 'Explorer', emoji: '🗺️', desc: 'Reach the Ashen Badlands (stage 41).', stars: 10, check: (s) => (s.stage || 1) >= 41 },
];
// ---------------- Titles ----------------
// Hero titles: unlocked by feats, shown under the profile name and on the
// leaderboard. No stat effect — pure glory.
// ---------------- Titles ----------------
// Hero titles: unlocked by feats, shown under the profile name and on the
// leaderboard. No stat effect — pure glory.
//
// Single flat dictionary: id -> definition. This is the ONE source of truth
// for every title in the game (achievements, token-shop, staff).
//
// Visual layers (priority order, applied low → high by TitleManager):
//   1 = base text color / gradient  (.tl1-*)
//   2 = text shadow / glow          (.tl2-*)
//   3 = keyframe animation / motion (.tl3-*)
// A title's `fx` maps layer number -> CSS class. Titles without `fx` get
// FX_DEFAULT (gold glow + pulse). To restyle a title, change its `fx` here
// and/or add layer classes in style.css — never branch on title ids in JS.
const FX_DEFAULT = { 1: 'tl1-gold', 2: 'tl2-glow-gold', 3: 'tl3-pulse' };
// REMASTER: Titles removed. Empty for compatibility.
export const TITLE_DEFS = {};
// Every def carries its id (used by find/filter/map across the codebase).
for (const [id, t] of Object.entries(TITLE_DEFS)) t.id = id;

// Back-compat array views (insertion order = achievements, token, staff).
export const TITLES = Object.values(TITLE_DEFS);
export const TITLE_BY_ID = TITLE_DEFS;
export const TOKEN_TITLES = TITLES.filter(t => t.tokenOnly);
export const STAFF_TITLES = TITLES.filter(t => t.staffOnly);

// TitleManager: the only supported way to resolve + style a title.
// Pass a player profile (anything with `.activeTitle`); it looks up the
// title and returns the layered CSS classes in priority order.
function _escTitle(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const TitleManager = {
  /** Raw def for a title id, or null. */
  get(id) { return TITLE_DEFS[id] || null; },
  /** Display name for a title id (falls back to the id, like before). */
  name(id) { const t = TITLE_DEFS[id]; return (t && t.name) || id; },
  /** Layered CSS classes for a profile's active title, priority order 1→2→3. */
  classesFor(profile) {
    const t = profile ? TITLE_DEFS[profile.activeTitle] : null;
    const fx = (t && t.fx) || FX_DEFAULT;
    const classes = Object.keys(fx).map(Number).sort((a, b) => a - b)
      .map(k => fx[k]).filter(Boolean);
    // Role-based name badges (owner/admin/mod/vip/1year).
    const role = profile && profile.role;
    if (role === 'owner') classes.push('name-owner');
    else if (role === 'admin') classes.push('name-admin');
    else if (role === 'mod' || role === 'moderator') classes.push('name-mod');
    else if (role === 'vip') classes.push('name-vip');
    // 1-year veteran: account age >= 365 days.
    const created = profile && profile.createdAt;
    if (created && (Date.now() - new Date(created).getTime()) >= 365 * 24 * 60 * 60 * 1000) {
      classes.push('name-1year');
    }
    return classes.join(' ');
  },
  /** Ready-to-insert HTML: <span class="<layers>">name</span>. */
  render(profile) {
    const p = profile || {};
    return `<span class="${this.classesFor(p)}">${_escTitle(this.name(p.activeTitle))}</span>`;
  },
};
export function titleName(id) { return TitleManager.name(id); }

// ---------------- Creator badges & country flags ----------------
// Badges are granted by the owner/GM (GM console), shown next to the name
// on the leaderboard and profile. Country is picked by the player in
// Profile; its flag shows on the leaderboard.
export const BADGES = [
  { id: 'youtuber', emoji: '▶️', name: 'YouTuber' },
  { id: 'streamer', emoji: '🎥', name: 'Streamer' },
  { id: 'vip',      emoji: '💎', name: 'VIP' },
  { id: 'admin',    emoji: '🛡️', name: 'Admin' },
  { id: 'mod',      emoji: '🔨', name: 'Mod' },
];
export const BADGE_BY_ID = Object.fromEntries(BADGES.map(b => [b.id, b]));
export function badgeDef(id) { return BADGE_BY_ID[id] || null; }

export const COUNTRIES = [
  ['US','United States'],['CA','Canada'],['MX','Mexico'],['BR','Brazil'],['AR','Argentina'],
  ['CL','Chile'],['CO','Colombia'],['PE','Peru'],['GB','United Kingdom'],['IE','Ireland'],
  ['FR','France'],['DE','Germany'],['ES','Spain'],['IT','Italy'],['PT','Portugal'],
  ['NL','Netherlands'],['BE','Belgium'],['SE','Sweden'],['NO','Norway'],['DK','Denmark'],
  ['FI','Finland'],['PL','Poland'],['GR','Greece'],['TR','Türkiye'],['UA','Ukraine'],
  ['RU','Russia'],['IN','India'],['PK','Pakistan'],['BD','Bangladesh'],['JP','Japan'],
  ['KR','South Korea'],['CN','China'],['TW','Taiwan'],['HK','Hong Kong'],['SG','Singapore'],
  ['MY','Malaysia'],['ID','Indonesia'],['PH','Philippines'],['TH','Thailand'],['VN','Vietnam'],
  ['AU','Australia'],['NZ','New Zealand'],['ZA','South Africa'],['NG','Nigeria'],['EG','Egypt'],
  ['AE','UAE'],['SA','Saudi Arabia'],['IL','Israel'],
].map(([code, name]) => ({ code, name }));
export function isValidCountry(code) { return COUNTRIES.some(c => c.code === code); }
// Flag emoji from a 2-letter ISO code (regional indicator symbols).
export function countryFlag(code) {
  if (!/^[A-Z]{2}$/.test(code || '')) return '';
  return [...code].map(ch => String.fromCodePoint(0x1F1E6 + ch.charCodeAt(0) - 65)).join('');
}

// ---------------- Rebirth Token Shop ----------------
// Rebirth Tokens are earned 1 per rebirth and spent in a dedicated shop tab.
// Stock rotates every 24h: 2 fixed staples + 4 rotating slots, deterministic
// per day so every player sees the same offers. Purchases are permanent —
// rotation only changes what's for sale, never takes away what you own.

// Token-exclusive titles. tokenOnly: never auto-unlocked by checkTitles()
// (their check always fails); only buyTokenItem() can grant them.
// (token titles now live in TITLE_DEFS above)

// Staff titles. staffOnly: never auto-unlocked by checkTitles()
// (their check always fails) and never granted by "Grant all titles";
// they unlock automatically at boot for accounts whose staff role
// qualifies (owner → all tiers, admin → admin+gm, gm → gm).
// (staff titles now live in TITLE_DEFS above)

// Token-exclusive name effects (visual CSS classes .pname.fx-<id>).
export const TOKEN_NAME_FX = [
  { id: 'voidborn',   name: '🕳️ Voidborn' },
  { id: 'goldleaf',   name: '🍂 Goldleaf' },
  { id: 'bloodmoon',  name: '🌙 Blood Moon' },
  { id: 'stormsurge', name: '🌪️ Stormsurge' },
  { id: 'celestial',  name: '✨ Celestial' },
  { id: 'throneflame', name: '👑 Throneflame' },
];

// Staff-exclusive name effects (visual CSS classes .pname.fx-<id>).
// staffOnly: never sold or auto-unlocked; granted at boot by staff role
// (owner → all, admin → admin+gm, gm → gm), mirroring STAFF_TITLES.
export const STAFF_NAME_FX = [
  { id: 'gavelstrike', name: '🔨 Gavelstrike', desc: 'Staff only. Judgement, rendered in molten gold.', staffOnly: true, staffRole: 'gm' },
  { id: 'allseeing',   name: '👁️ All-Seeing',  desc: 'Staff only. Nothing escapes this gaze.',          staffOnly: true, staffRole: 'gm' },
  { id: 'worldforge',  name: '🌍 Worldforge',  desc: 'Staff only. The world, hammered into shape.',     staffOnly: true, staffRole: 'admin' },
  { id: 'archlight',   name: '📐 Archlight',   desc: 'Staff only. Drawn in lines of cold light.',       staffOnly: true, staffRole: 'admin' },
  { id: 'shadowcrown', name: '👑 Shadowcrown', desc: 'Staff only. The throne casts a long shadow.',     staffOnly: true, staffRole: 'owner' },
  { id: 'everflame',   name: '♾️ Everflame',    desc: 'Staff only. It has always burned. It always will.', staffOnly: true, staffRole: 'owner' },
  { id: 'rainbowblood', name: '🩸🌈 Rainbow Blood', desc: 'Owner only. Blood and stars rise from the rainbow.', staffOnly: true, staffRole: 'owner' },
];

// Name effects free for everyone (everything in the old picker).
export const BASE_NAME_FX_IDS = ['none', 'fire', 'neon', 'rainbow', 'shine', 'galaxy', 'ice',
  'lightning', 'shadow', 'glitch', 'falling-leaves', 'harvest-ember', 'autumn-mist',
  'snowfall', 'aurora', 'frostbite', 'tidal', 'sunscorched', 'wildfire', 'fireworks',
  'champagne', 'midnight'];
export const ALL_NAME_FX_IDS = [...BASE_NAME_FX_IDS, ...TOKEN_NAME_FX.map(f => f.id), ...STAFF_NAME_FX.map(f => f.id)];

// Backfill for old saves: everyone owns the free effects; token ones are
// only added by buyTokenItem().
export function ensureFxUnlocked(s) {
  if (!Array.isArray(s.fxUnlocked)) s.fxUnlocked = BASE_NAME_FX_IDS.slice();
  return s.fxUnlocked;
}
export function fxIsUnlocked(s, fxId) {
  return ensureFxUnlocked(s).includes(fxId);
}

// The shop catalog. kind: 'title' | 'fx' | 'egg'. staple: always in stock.
export const TOKEN_SHOP_CATALOG = [
  { id: 'ts-egg-token',   kind: 'egg',   name: '🥚 Token Egg',          desc: 'Hatches a shadow or celestial pet.',            cost: 2, staple: true },
  { id: 'ts-egg-wild5',   kind: 'eggs',  name: '🥚🥚 Egg Bundle',       desc: '5 wild pet eggs.',                              cost: 1, staple: true },
  { id: 'ts-class-token', kind: 'classToken', name: '🔄 Class Change Token',
    desc: 'Change your class anytime — from the Character sheet. Level, gear, and progress stay.',
    cost: 3, staple: true },
];
const TOKEN_SHOP_BY_ID = Object.fromEntries(TOKEN_SHOP_CATALOG.map(i => [i.id, i]));

export const TOKEN_SHOP_ROTATION_MS = 24 * 60 * 60 * 1000;

// Deterministic daily stock: 2 staples + 4 rotating picks seeded by day.
// Returns { items: [catalog entries], windowStart, windowEnd }.
export function tokenShopStock(nowMs = Date.now()) {
  const day = Math.floor(nowMs / TOKEN_SHOP_ROTATION_MS);
  const windowStart = day * TOKEN_SHOP_ROTATION_MS;
  const windowEnd = windowStart + TOKEN_SHOP_ROTATION_MS;
  const staples = TOKEN_SHOP_CATALOG.filter(i => i.staple);
  const rotating = TOKEN_SHOP_CATALOG.filter(i => !i.staple);
  // Seeded shuffle (mulberry32) so the rotation is stable all day.
  const rng = mulberry32(day >>> 0);
  const pool = rotating.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return { items: [...staples, ...pool.slice(0, 4)], windowStart, windowEnd };
}

// Buy a token shop item. Returns {ok, reason?}. Purchases are permanent.
export function buyTokenItem(s, itemId, nowMs = Date.now()) {
  const item = TOKEN_SHOP_BY_ID[itemId];
  if (!item) return { ok: false, reason: 'bad-item' };
  const stock = tokenShopStock(nowMs);
  if (!stock.items.some(i => i.id === itemId)) return { ok: false, reason: 'not-in-stock' };
  if ((s.rebirthTokens || 0) < item.cost) return { ok: false, reason: 'tokens', cost: item.cost };
  // Already-owned items can't be bought twice (titles/fx are one-time).
  if (item.kind === 'title' && (s.titlesUnlocked || []).includes(item.ref)) {
    return { ok: false, reason: 'owned' };
  }
  if (item.kind === 'fx' && (s.fxUnlocked || []).includes(item.ref)) {
    return { ok: false, reason: 'owned' };
  }
  s.rebirthTokens -= item.cost;
  if (item.kind === 'title') {
    if (!Array.isArray(s.titlesUnlocked)) s.titlesUnlocked = ['wanderer'];
    s.titlesUnlocked.push(item.ref);
  } else if (item.kind === 'fx') {
    ensureFxUnlocked(s);
    s.fxUnlocked.push(item.ref);
  } else if (item.kind === 'egg') {
    const p = ensurePets(s);
    p.shopEggs.token = (p.shopEggs.token || 0) + 1;
  } else if (item.kind === 'eggs') {
    const p = ensurePets(s);
    p.eggs = (p.eggs || 0) + 5;
  } else if (item.kind === 'classToken') {
    s.classTokens = (s.classTokens || 0) + 1;
  }
  return { ok: true, item };
}

// Consumes one class-change token and switches the hero's class.
// Level, gear, stats, and quests are untouched — only the class (and its
// perks) changes. The spell loadout is rebuilt for the new class so no
// invalid spell survives the swap; resources start fresh.
export function changeClass(s, newClass) {
  if (!s || !CLASSES[newClass]) return { ok: false, reason: 'bad-class' };
  if (s.playerClass === newClass) return { ok: false, reason: 'same' };
  if ((s.classTokens || 0) < 1) return { ok: false, reason: 'tokens' };
  s.classTokens -= 1;
  s.playerClass = newClass;
  s.energy = ENERGY_MAX; s.focus = 100; s.mana = 100; s.rage = 0;
  s.buffs = [];
  s.spellSlots = [];
  ensureSpellSlots(s);
  return { ok: true };
}

// Returns newly unlocked title defs (mutates state.titlesUnlocked).
export function checkTitles(state, user) {
  if (!Array.isArray(state.titlesUnlocked)) state.titlesUnlocked = ['wanderer'];
  // Lifetime gold tracking: no dedicated field exists, so accumulate
  // positive gold deltas between checks into stats.totalGoldEarned.
  // (Decreases from spending are ignored; the total survives rebirth
  // because stats are lifetime stats.)
  if (!state.stats || typeof state.stats !== 'object') state.stats = {};
  const goldNow = state.gold || 0;
  const goldLast = state.stats._lastGoldSeen || 0;
  if (goldNow > goldLast) {
    state.stats.totalGoldEarned = (state.stats.totalGoldEarned || 0) + (goldNow - goldLast);
  }
  state.stats._lastGoldSeen = goldNow;
  const fresh = [];
  for (const t of TITLES) {
    if (state.titlesUnlocked.includes(t.id)) continue;
    let ok = false;
    try { ok = !!t.check(state, user); } catch { ok = false; }
    if (ok) {
      state.titlesUnlocked.push(t.id);
      fresh.push(t);
    }
  }
  return fresh;
}

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
  let granted = 0;
  for (let i = 0; i < n && state.level < MAX_LEVEL; i++) {
    state.level += 1;
    state.hero.attack += 3;
    state.hero.maxHp += 25;
    state.hero.defense += 2;
    granted += 1;
  }
  state.xp = 0;
  state.xpNext = xpForLevel(state.level);
  const s2 = computeStats(state);
  state.hero.hp = s2.maxHp;
  return granted;
}

// RAID MODE (PvE endless waves) — appended 2026-09-25
// Pure logic. raid.js (Raid object) drives the combat loop with these.
// state.raid = { best: 0 } — best wave reached.
// Call ensureRaidState(state) on load.
// ============================================================

// Wave scaling: hp 1.18^wave, atk 1.10^wave, gold 1 + wave*0.15.
// Strictly increasing in wave — difficulty never plateaus.
export function raidWaveScaling(wave) {
  const w = Math.max(1, Math.floor(wave || 1));
  return {
    hpMult: Math.pow(1.18, w),
    atkMult: Math.pow(1.10, w),
    goldMult: 1 + w * 0.15,
  };
}

// Raid bosses appear every 5th wave (5, 10, 15, ...).
export function isRaidBoss(wave) {
  return Math.floor(wave || 0) % 5 === 0 && Math.floor(wave || 0) > 0;
}

// Builds the enemy for a raid wave. Base stats come from the player's
// current stage via enemyFor(), then wave scaling is applied.
// Raid bosses: 2.5x HP of the wave, epic+ loot tier (minIdx 3), 👹 emoji.
// Normal waves: common+ loot tier (minIdx 0).
export function raidEnemyFor(wave, playerStage) {
  const w = Math.max(1, Math.floor(wave || 1));
  const stage = Math.max(1, Math.floor(playerStage || 1));
  const boss = isRaidBoss(w);
  // Non-boss waves must never inherit the stage's boss identity
  // (e.g. player sitting on a x10 boss stage).
  const baseStage = (!boss && isBossStage(stage)) ? stage + 1 : stage;
  const base = enemyFor(baseStage);
  const s = raidWaveScaling(w);
  // v26: raid boss HP 2.5 -> 1.75 (30% reduction, matches dungeon balance).
  const hp = Math.max(1, Math.round(base.hp * s.hpMult * (boss ? 1.75 : 1)));
  return {
    name: boss ? pick(BOSS_NAMES) : base.name,
    stage, boss, raidWave: w,
    hp, maxHp: hp,
    attack: Math.max(1, Math.round(base.attack * s.atkMult)),
    emoji: boss ? '👹' : base.emoji,
    lootTier: boss ? 3 : 0, // minIdx into RARITIES for rollLoot()
    goldMult: s.goldMult,
  };
}

// Normalizes state.raid (safe on old saves that lack it).
export function ensureRaidState(state) {
  if (!state || typeof state !== 'object') return state;
  const r = state.raid;
  const best = r && Number.isFinite(+r.best) ? Math.max(0, Math.floor(+r.best)) : 0;
  state.raid = { best };
  return state;
}

// (Rebirth mutates the state in place, so raid progress survives it.)

// ---------------- Infinite Tower of Shadows ----------------
// Endless tower climb: each floor is a boss with escalating HP.
// Scaling: 1.18^(F-1), plus 50% HP jump every 10 floors (DPS check).
// Every 5 floors: random hazard modifier.
// Milestones at 25/50/75/100: Divine blueprint + Mythic pet egg + title.
export const TOWER_MILESTONES = {
  25: { titleId: 'tower-apprentice', titleName: 'Tower Apprentice' },
  50: { titleId: 'tower-master', titleName: 'Floor Master' },
  75: { titleId: 'tower-ascendant', titleName: 'Shadow Ascendant' },
  100: { titleId: 'tower-conqueror', titleName: 'Tower Conqueror' },
  250: { titleId: 'tower-warbringer', titleName: 'Warbringer' },
  500: { titleId: 'tower-doomcaller', titleName: 'Doomcaller' },
  750: { titleId: 'tower-abysswalker', titleName: 'Abysswalker' },
  1000: { titleId: 'tower-godslayer', titleName: 'Godslayer of the Tower' },
};
export const TOWER_HAZARDS = {
  vampiric: { name: 'Vampiric Heal', emoji: '🩸', desc: 'Boss heals 15% of damage it deals' },
  reflect: { name: 'Damage Reflect', emoji: '🪞', desc: 'Reflects 20% of damage back to you' },
  silence: { name: 'Void Silence', emoji: '🔇', desc: 'Your spells are silenced' },
  enrage: { name: 'Enrage Speed', emoji: '💢', desc: 'Boss attacks 40% faster' },
};

// Normalizes state.tower (safe on old saves). Survives rebirth.
export function ensureTowerState(state) {
  if (!state || typeof state !== 'object') return state;
  const t = state.tower || {};
  const floor = Number.isFinite(+t.floor) ? Math.max(0, Math.floor(+t.floor)) : 0;
  const checkpoint = Number.isFinite(+t.checkpoint) ? Math.max(0, Math.floor(+t.checkpoint)) : 0;
  const lastSweep = Number.isFinite(+t.lastSweep) ? +t.lastSweep : 0;
  const checkpointWeek = Number.isFinite(+t.checkpointWeek) ? +t.checkpointWeek : 0;
  state.tower = { floor, checkpoint, lastSweep, checkpointWeek };
  return state;
}

// Boss HP multiplier for a tower floor: 1.18^(F-1) * 1.5^floor(F/10).
export function towerHpMult(floor) {
  const f = Math.max(1, Math.floor(floor || 1));
  return Math.pow(1.18, f - 1) * Math.pow(1.5, Math.floor(f / 10));
}

// Returns the hazard id for a floor, or null if none (every 5 floors).
// Deterministic per floor so refresh doesn't reroll the hazard.
export function towerFloorHazard(floor) {
  const f = Math.max(1, Math.floor(floor || 1));
  if (f % 5 !== 0) return null;
  const keys = Object.keys(TOWER_HAZARDS);
  return keys[f % keys.length];
}

// Generates the tower enemy for a floor. Uses a fixed baseline (stage 100)
// so Floor 1 is challenging but doable, scaling purely by 1.18^(F-1).
// Floors 1-9, 11-19, etc. are normal enemies; every 10th floor is a boss
// (DPS check with the 50% HP jump). Player stage is intentionally NOT used.
export function towerEnemyFor(floor, playerStage) {
  const f = Math.max(1, Math.floor(floor || 1));
  const base = enemyFor(100);
  const isBoss = f % 10 === 0;
  const hp = Math.max(1, Math.round(base.hp * towerHpMult(f) * (isBoss ? 0.5 : 0.3)));
  const hazard = towerFloorHazard(f);
  return {
    name: isBoss ? `Tower Warden — Floor ${f}` : `Tower Shade — Floor ${f}`,
    stage: 100, boss: isBoss, towerFloor: f,
    hp, maxHp: hp,
    attack: Math.max(1, Math.round(base.attack * towerHpMult(f) * 0.25 * (isBoss ? 1 : 0.7))),
    emoji: isBoss ? '🗼' : '👤',
    hazard: isBoss ? hazard : null,
    lootTier: isBoss ? 3 : 1,
    goldMult: 1 + f * 0.1,
  };
}

// Returns milestone rewards for a floor, or null.
export function towerMilestoneFor(floor) {
  return TOWER_MILESTONES[floor] || null;
}

// ---------------- Boss Rush ----------------
// Time-attack gauntlet through tower bosses. Clear all 5 as fast as possible.
// Best times are tracked per player.
export const BOSS_RUSH_FLOORS = [10, 20, 30, 40, 50];

export function ensureBossRushState(state) {
  if (!state || typeof state !== 'object') return state;
  const br = state.bossRush || {};
  state.bossRush = {
    bestTimeMs: Number.isFinite(+br.bestTimeMs) ? +br.bestTimeMs : 0,
    runs: Number.isFinite(+br.runs) ? Math.max(0, Math.floor(+br.runs)) : 0,
    // Active run (not persisted across sessions):
    active: false,
    startTime: 0,
    currentIndex: 0,
  };
  // Preserve active run if one was in progress (don't wipe on refresh).
  if (br.active === true) {
    state.bossRush.active = true;
    state.bossRush.startTime = Number.isFinite(+br.startTime) ? +br.startTime : Date.now();
    state.bossRush.currentIndex = Number.isFinite(+br.currentIndex) ? Math.max(0, Math.floor(+br.currentIndex)) : 0;
  }
  return state;
}

export function startBossRush(state) {
  ensureBossRushState(state);
  state.bossRush.active = true;
  state.bossRush.startTime = Date.now();
  state.bossRush.currentIndex = 0;
  state.bossRush.runs += 1;
  return state.bossRush;
}

export function bossRushNext(state) {
  ensureBossRushState(state);
  const br = state.bossRush;
  if (!br.active) return null;
  if (br.currentIndex >= BOSS_RUSH_FLOORS.length) {
    // Run complete!
    const timeMs = Date.now() - br.startTime;
    if (!br.bestTimeMs || timeMs < br.bestTimeMs) {
      br.bestTimeMs = timeMs;
    }
    br.active = false;
    return { complete: true, timeMs, isBest: timeMs === br.bestTimeMs };
  }
  return { floor: BOSS_RUSH_FLOORS[br.currentIndex], index: br.currentIndex };
}

export function bossRushAdvance(state) {
  ensureBossRushState(state);
  state.bossRush.currentIndex += 1;
  return bossRushNext(state);
}

export function formatBossRushTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Daily sweep: claim rewards for all cleared floors up to the weekly checkpoint.
// Returns { ok, floors, rewards } or { ok: false, reason }.
export function towerSweep(s) {
  ensureTowerState(s);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  // One sweep per day
  if (s.tower.lastSweep && now - s.tower.lastSweep < dayMs) {
    return { ok: false, reason: 'swept' };
  }
  const maxFloor = Math.max(s.tower.floor, s.tower.checkpoint);
  if (maxFloor < 1) return { ok: false, reason: 'none' };
  // Rewards scale with floors cleared: gold + a pet egg every 10 floors
  const gold = Math.round(maxFloor * 1000 * (1 + maxFloor * 0.05));
  const eggs = Math.floor(maxFloor / 10);
  s.tower.lastSweep = now;
  // Weekly checkpoint: reset every Monday
  const d = new Date(now);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  if (!s.tower.checkpointWeek || s.tower.checkpointWeek < monday.getTime()) {
    s.tower.checkpoint = s.tower.floor;
    s.tower.checkpointWeek = monday.getTime();
  }
  return { ok: true, floors: maxFloor, gold, eggs };
}
