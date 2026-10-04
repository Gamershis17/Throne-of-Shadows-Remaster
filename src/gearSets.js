'use strict';

/**
 * Privileged gear sets with fixed stats.
 *
 * Sovereign Founder's Regalia (owner) is the reference set.
 * Fateweaver Regalia (GM)   = ~60% of sovereign values.
 * Admin Warden Arsenal (admin) = ~35% of sovereign values.
 *
 * Each set is 5 pieces (weapon, armor, helmet, boots, trinket), all rarity
 * 'mythic'. Both the gift-code redeem flow and the GM grant flow use
 * makeGearItems(setId) to get fresh items (each with a unique id).
 */

const { randomUUID } = require('crypto');

const SOVEREIGN_PIECES = [
  {
    slot: 'weapon',
    name: "Sovereign Blade of the Founder",
    stats: { attack: 500, critDamage: 50 },
  },
  {
    slot: 'armor',
    name: "Sovereign Aegis Plate",
    stats: { defense: 500, maxHp: 2000 },
  },
  {
    slot: 'helmet',
    name: "Sovereign Crown of Dominion",
    stats: { defense: 200, critChance: 20, critDamage: 25 },
  },
  {
    slot: 'boots',
    name: "Sovereign Stride",
    stats: { defense: 150, dodge: 15, parry: 15 },
  },
  {
    slot: 'trinket',
    name: "Sovereign Heart of Creation",
    stats: { critChance: 10, lifesteal: 10, regen: 20 },
  },
];

function scalePieces(pieces, setName, factor) {
  return pieces.map((p) => ({
    slot: p.slot,
    name: p.name.replace('Sovereign', setName),
    stats: Object.fromEntries(
      Object.entries(p.stats).map(([k, v]) => [k, Math.max(1, Math.round(v * factor))])
    ),
  }));
}

// Fateweaver Regalia ≈ 60% of sovereign values.
const FATEWEAVER_PIECES = scalePieces(SOVEREIGN_PIECES, 'Fateweaver', 0.6);
// Admin Warden Arsenal ≈ 35% of sovereign values.
const WARDEN_PIECES = scalePieces(SOVEREIGN_PIECES, 'Warden', 0.35);

// Voidwalker Regalia ≈ 75% of sovereign power, dodge/crit themed.
const VOIDWALKER_PIECES = [
  { slot: 'weapon',  name: 'Voidfang Blade',   stats: { attack: 375, critDamage: 38 } },
  { slot: 'armor',   name: 'Voidweave Shroud', stats: { defense: 375, dodge: 10 } },
  { slot: 'helmet',  name: 'Voidgaze Hood',    stats: { critChance: 12, attack: 190 } },
  { slot: 'boots',   name: 'Voidstep Boots',   stats: { dodge: 11, attackSpeed: 0.15, defense: 110 } },
  { slot: 'trinket', name: 'Void Heart',       stats: { critChance: 7, lifesteal: 7, regen: 15 } },
];

// Game Master Regalia ≈ 70% of sovereign power, judgment/balance themed.
// Entitlement: gm + owner (granted through the GM console like Fateweaver).
const GAMEMASTER_PIECES = [
  { slot: 'weapon',  name: 'Judgment Gavel',      stats: { attack: 350, critChance: 8 } },
  { slot: 'armor',   name: "Arbiter's Plate",     stats: { defense: 350, maxHp: 1400 } },
  { slot: 'helmet',  name: 'Crown of Verdicts',   stats: { defense: 140, critDamage: 35 } },
  { slot: 'boots',   name: 'Stride of Justice',   stats: { dodge: 8, attackSpeed: 0.14, defense: 105 } },
  { slot: 'trinket', name: 'Scales of the Master', stats: { goldBonus: 25, xpBonus: 25, lifesteal: 5 } },
];

// Dragonscale Aegis ≈ 80% of sovereign power, HP/regen themed.
const DRAGONSCALE_PIECES = [
  { slot: 'weapon',  name: 'Dragonscale Fang',   stats: { attack: 400, lifesteal: 6 } },
  { slot: 'armor',   name: 'Dragonscale Plate',  stats: { defense: 400, maxHp: 1600 } },
  { slot: 'helmet',  name: 'Dragonhorn Helm',    stats: { defense: 160, maxHp: 800, regen: 10 } },
  { slot: 'boots',   name: 'Dragonclaw Greaves', stats: { defense: 120, maxHp: 500, regen: 8 } },
  { slot: 'trinket', name: 'Dragonheart Ember',  stats: { regen: 16, maxHp: 600, lifesteal: 4 } },
];

function attachSetMeta(pieces, setId, displayName) {
  return pieces.map((p) => ({
    slot: p.slot,
    name: p.name,
    displaySetName: displayName,
    rarity: 'mythic',
    stats: p.stats,
    set: setId,
  }));
}

const SOVEREIGN = attachSetMeta(SOVEREIGN_PIECES, 'sovereign', "Sovereign Founder's Regalia");
const FATEWEAVER = attachSetMeta(FATEWEAVER_PIECES, 'fateweaver', 'Fateweaver Regalia');
const WARDEN = attachSetMeta(WARDEN_PIECES, 'warden', 'Admin Warden Arsenal');
const VOIDWALKER = attachSetMeta(VOIDWALKER_PIECES, 'voidwalker', 'Voidwalker Regalia');
const DRAGONSCALE = attachSetMeta(DRAGONSCALE_PIECES, 'dragonscale', 'Dragonscale Aegis');
const GAMEMASTER = attachSetMeta(GAMEMASTER_PIECES, 'gamemaster', 'Game Master Regalia');

const GEAR_SETS = {
  sovereign: SOVEREIGN,
  fateweaver: FATEWEAVER,
  warden: WARDEN,
  voidwalker: VOIDWALKER,
  dragonscale: DRAGONSCALE,
  gamemaster: GAMEMASTER,
};

// Aura metadata for set-item visuals (consumed by the client stylesheet;
// ui.js/style.css map cssClass -> glow styling).
const SET_AURAS = {
  sovereign:   { label: 'Sovereign Rainbow', cssClass: 'set-sovereign',   colors: ['#ff5e62', '#ffb800', '#3ee06f', '#3ea8ff', '#b45eff'] },
  fateweaver:  { label: 'Fateweave',         cssClass: null,             colors: ['#3ea8ff'] },
  warden:      { label: 'Warden Steel',      cssClass: null,             colors: ['#9aa7b8'] },
  voidwalker:  { label: 'Void',              cssClass: 'set-voidwalker',  colors: ['#8b2ff7', '#05050a'] },
  dragonscale: { label: 'Dragonfire',        cssClass: 'set-dragonscale', colors: ['#ff3b1f', '#ffb800'] },
  gamemaster:  { label: 'Judgment',          cssClass: 'set-gamemaster',  colors: ['#ffd700', '#fffbe6'] },
};

function isValidSetId(setId) {
  return Object.prototype.hasOwnProperty.call(GEAR_SETS, setId);
}

/**
 * Build a fresh inventory item list for a gear set: each piece gets a unique
 * id so the client can equip/sell them individually.
 */
function makeGearItems(setId) {
  const pieces = GEAR_SETS[setId];
  if (!pieces) return null;
  return pieces.map((p) => ({
    id: randomUUID(),
    name: p.name,
    slot: p.slot,
    rarity: p.rarity,
    stats: { ...p.stats },
    set: p.set,
    setName: p.displaySetName,
  }));
}

module.exports = {
  SOVEREIGN,
  FATEWEAVER,
  WARDEN,
  VOIDWALKER,
  DRAGONSCALE,
  GAMEMASTER,
  GEAR_SETS,
  SET_AURAS,
  isValidSetId,
  makeGearItems,
};
