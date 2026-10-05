// ============================================================
// balance.js — Data-driven tuning numbers (WoW-style)
// All balance knobs live here. Code reads from this, never hardcodes.
// ============================================================

export const BALANCE = {
  // XP curve: xpForLevel = base * level^exp
  xp: { base: 100, exp: 1.5 },

  // Enemy scaling per stage
  enemy: {
    hpBase: 40, hpBoss: 120, hpScale: 1.12,
    atkBase: 6, atkBoss: 14, atkScale: 1.12,
    xpBase: 15, xpBoss: 60, xpScale: 1.08,
    goldBase: 8, goldBoss: 50, goldScale: 1.06,
    variance: 0.2, // ±20% random
  },

  // Gear drops
  drops: {
    normalChance: 0.08,
    bossChance: 0.5,
    bossRareThreshold: 0.5,
    rareThreshold: 0.85,
    magicThreshold: 0.6,
    scalePerStage: 1.1,
  },

  // Vendor
  vendor: {
    scalePerLevel: 1.1,
    priceMult: 100,
  },

  // Sell formula: base * 0.3 * (1 + level/50) * (1 + stage/100)
  sell: { baseMult: 0.3, levelDiv: 50, stageDiv: 100 },

  // Pet
  pet: {
    loyaltyDrainPerAttack: 2,
    findCostMult: 100, // gold = 100 * level
    loyaltyMin: 50, // starting loyalty for new pet
  },

  // Auction
  auction: {
    saleCheckDelay: 30000, // 30s before NPCs can buy
    saleChance: 0.1, // 10% per check
    expiryMs: 3600000, // 1 hour
  },

  // Party/Dungeon
  party: { maxSize: 5 },
  dungeon: { finalWaveHpMult: 2, finalWaveAtkMult: 1.5, rewardMult: 3 },

  // Combat
  combat: {
    autoAttackMs: 3000,
    manaRegenPct: 0.05, // 5% per second
    defenseMitigation: 3, // def * 3 in mitigation formula
    damageVariance: 0.3, // ±30%
  },
};

// Talent points: 1 per level
export const TALENT_POINTS_PER_LEVEL = 1;
