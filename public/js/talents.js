// ============================================================
// talents.js — Talent trees (1 point per level)
// WoW-style: each class has its own talent tree
// ============================================================

export const TALENT_TREES = {
  warrior: [
    { id: 'w1', name: 'Sword Mastery', emoji: '⚔️', desc: '+5% Attack per rank', maxRank: 5, perRank: { atkPct: 5 } },
    { id: 'w2', name: 'Iron Skin', emoji: '🛡️', desc: '+5% Defense per rank', maxRank: 5, perRank: { defPct: 5 } },
    { id: 'w3', name: 'Vitality', emoji: '❤️', desc: '+5% Max HP per rank', maxRank: 5, perRank: { hpPct: 5 } },
    { id: 'w4', name: 'Executioner', emoji: '💀', desc: '+3% Crit Chance per rank', maxRank: 3, perRank: { critChance: 0.03 } },
    { id: 'w5', name: 'Battle Fury', emoji: '🔥', desc: '+10% Crit Damage per rank', maxRank: 3, perRank: { critMult: 0.1 } },
  ],
  mage: [
    { id: 'm1', name: 'Arcane Power', emoji: '✨', desc: '+6% Attack per rank', maxRank: 5, perRank: { atkPct: 6 } },
    { id: 'm2', name: 'Mana Flow', emoji: '💧', desc: '+10% Max Mana per rank', maxRank: 5, perRank: { manaPct: 10 } },
    { id: 'm3', name: 'Spell Crit', emoji: '💥', desc: '+4% Crit Chance per rank', maxRank: 3, perRank: { critChance: 0.04 } },
    { id: 'm4', name: 'Glass Cannon', emoji: '🔮', desc: '+8% Attack, -3% HP per rank', maxRank: 3, perRank: { atkPct: 8, hpPct: -3 } },
    { id: 'm5', name: 'Frost Armor', emoji: '❄️', desc: '+6% Defense per rank', maxRank: 5, perRank: { defPct: 6 } },
  ],
  hunter: [
    { id: 'h1', name: 'Sharpshooter', emoji: '🎯', desc: '+5% Attack per rank', maxRank: 5, perRank: { atkPct: 5 } },
    { id: 'h2', name: 'Beast Bond', emoji: '🐺', desc: '+10% Pet Damage per rank', maxRank: 5, perRank: { petDmgPct: 10 } },
    { id: 'h3', name: 'Agility', emoji: '💨', desc: '+4% Crit Chance per rank', maxRank: 3, perRank: { critChance: 0.04 } },
    { id: 'h4', name: 'Survivalist', emoji: '🌿', desc: '+5% Max HP per rank', maxRank: 5, perRank: { hpPct: 5 } },
    { id: 'h5', name: 'Trap Master', emoji: '🪤', desc: '+6% Defense per rank', maxRank: 5, perRank: { defPct: 6 } },
  ],
};

// Calculate total talent bonuses for a hero
export function talentBonuses(hero) {
  const out = { atkPct: 0, defPct: 0, hpPct: 0, manaPct: 0, critChance: 0, critMult: 0, petDmgPct: 0 };
  const tree = TALENT_TREES[hero.classId] || [];
  const spent = hero.talents || {};
  for (const talent of tree) {
    const rank = spent[talent.id] || 0;
    if (rank <= 0) continue;
    for (const [key, val] of Object.entries(talent.perRank)) {
      out[key] = (out[key] || 0) + val * rank;
    }
  }
  return out;
}

// Available talent points
export function talentPointsAvailable(hero) {
  const earned = hero.level * 1; // 1 per level
  const spent = Object.values(hero.talents || {}).reduce((a, b) => a + b, 0);
  return earned - spent;
}

// Spend a talent point
export function spendTalent(hero, talentId) {
  const tree = TALENT_TREES[hero.classId] || [];
  const talent = tree.find(t => t.id === talentId);
  if (!talent) return { ok: false };
  if (talentPointsAvailable(hero) <= 0) return { ok: false, reason: 'points' };
  hero.talents = hero.talents || {};
  const current = hero.talents[talentId] || 0;
  if (current >= talent.maxRank) return { ok: false, reason: 'max' };
  hero.talents[talentId] += 1;
  return { ok: true };
}
