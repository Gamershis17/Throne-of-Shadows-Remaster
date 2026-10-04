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

const GEAR_SETS = {
  sovereign: SOVEREIGN,
  fateweaver: FATEWEAVER,
  warden: WARDEN,
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
  GEAR_SETS,
  isValidSetId,
  makeGearItems,
};
