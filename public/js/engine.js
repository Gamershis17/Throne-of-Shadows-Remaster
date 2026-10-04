// ============================================================
// engine.js — Classic MMORPG idle game math
// Clean, data-driven, no legacy baggage.
// ============================================================

export const CLASSES = {
  warrior: {
    id: 'warrior', name: 'Warrior', emoji: '🛡️',
    desc: 'Heavy armor, high HP. A wall of steel.',
    baseHp: 120, hpPerLevel: 18,
    baseAtk: 12, atkPerLevel: 2.2,
    baseDef: 8, defPerLevel: 1.2,
    critChance: 0.05, critMult: 1.5,
  },
  mage: {
    id: 'mage', name: 'Mage', emoji: '🔮',
    desc: 'Devastating spells, fragile body.',
    baseHp: 70, hpPerLevel: 10,
    baseAtk: 18, atkPerLevel: 3.2,
    baseDef: 3, defPerLevel: 0.5,
    critChance: 0.10, critMult: 2.0,
  },
  hunter: {
    id: 'hunter', name: 'Hunter', emoji: '🏹',
    desc: 'Balanced fighter, swift and deadly.',
    baseHp: 90, hpPerLevel: 13,
    baseAtk: 14, atkPerLevel: 2.6,
    baseDef: 5, defPerLevel: 0.8,
    critChance: 0.08, critMult: 1.75,
  },
};

export const ENEMY_TYPES = [
  { emoji: '🐺', name: 'Dire Wolf' },
  { emoji: '👺', name: 'Goblin Raider' },
  { emoji: '🧟', name: 'Risen Soldier' },
  { emoji: '🕷️', name: 'Cave Spider' },
  { emoji: '🐗', name: 'Fell Boar' },
  { emoji: '👹', name: 'Shadow Imp' },
];

export const BOSS_TYPES = [
  { emoji: '🐉', name: 'Ancient Dragon' },
  { emoji: '👿', name: 'Demon Lord' },
  { emoji: '🧛', name: 'Vampire King' },
  { emoji: '🤖', name: 'Iron Golem' },
];

// XP needed for level N (cumulative)
export function xpForLevel(level) {
  return Math.floor(100 * Math.pow(level, 1.5));
}

// Create a new hero
export function createHero(name, classId) {
  const cls = CLASSES[classId] || CLASSES.warrior;
  return {
    name, classId,
    level: 1, xp: 0,
    gold: 0,
    stage: 1,
    gear: { weapon: null, armor: null, trinket: null },
    inventory: [],
  };
}

// Calculate hero stats from level + gear
export function heroStats(hero) {
  const cls = CLASSES[hero.classId];
  let hp = cls.baseHp + cls.hpPerLevel * (hero.level - 1);
  let atk = cls.baseAtk + cls.atkPerLevel * (hero.level - 1);
  let def = cls.baseDef + cls.defPerLevel * (hero.level - 1);
  let critChance = cls.critChance;
  let critMult = cls.critMult;

  for (const slot of Object.values(hero.gear)) {
    if (!slot) continue;
    hp += slot.hp || 0;
    atk += slot.atk || 0;
    def += slot.def || 0;
    critChance += slot.critChance || 0;
  }

  return { hp: Math.floor(hp), atk: Math.floor(atk), def: Math.floor(def), critChance, critMult };
}

// Generate an enemy for a stage
export function makeEnemy(stage) {
  const isBoss = stage % 10 === 0;
  const pool = isBoss ? BOSS_TYPES : ENEMY_TYPES;
  const base = pool[Math.floor(Math.random() * pool.length)];
  const scale = Math.pow(1.12, stage - 1);
  const hp = Math.floor((isBoss ? 120 : 40) * scale * (0.9 + Math.random() * 0.2));
  const atk = Math.floor((isBoss ? 14 : 6) * scale * (0.9 + Math.random() * 0.2));
  return {
    ...base, stage, isBoss,
    hp, maxHp: hp, atk,
    xpReward: Math.floor((isBoss ? 60 : 15) * Math.pow(1.08, stage - 1)),
    goldReward: Math.floor((isBoss ? 50 : 8) * Math.pow(1.06, stage - 1)),
  };
}

// Player attacks enemy — returns { damage, crit, killed }
export function playerAttack(hero, enemy) {
  const stats = heroStats(hero);
  const isCrit = Math.random() < stats.critChance;
  const raw = stats.atk * (0.85 + Math.random() * 0.3);
  const damage = Math.max(1, Math.floor(raw * (isCrit ? stats.critMult : 1)));
  enemy.hp = Math.max(0, enemy.hp - damage);
  return { damage, crit: isCrit, killed: enemy.hp <= 0 };
}

// Enemy attacks player — returns damage dealt
export function enemyAttack(enemy, hero) {
  const stats = heroStats(hero);
  const raw = enemy.atk * (0.85 + Math.random() * 0.3);
  const mitigated = raw * (100 / (100 + stats.def * 3));
  return Math.max(1, Math.floor(mitigated));
}

// Award XP, handle level ups — returns levels gained
export function awardXp(hero, amount) {
  hero.xp += amount;
  let gained = 0;
  while (hero.xp >= xpForLevel(hero.level)) {
    hero.xp -= xpForLevel(hero.level);
    hero.level++;
    gained++;
  }
  return gained;
}

// Maybe drop gear — returns gear item or null
export function rollGearDrop(stage, isBoss) {
  const chance = isBoss ? 0.5 : 0.08;
  if (Math.random() > chance) return null;
  const slots = ['weapon', 'armor', 'trinket'];
  const slot = slots[Math.floor(Math.random() * slots.length)];
  const scale = Math.pow(1.1, stage - 1);
  const rarities = [
    { name: 'Common', mult: 1.0, color: '#9d9d9d' },
    { name: 'Magic', mult: 1.5, color: '#4a90d9' },
    { name: 'Rare', mult: 2.2, color: '#ffd23f' },
  ];
  const r = Math.random();
  const rarity = isBoss && r > 0.5 ? rarities[2] : r > 0.85 ? rarities[2] : r > 0.6 ? rarities[1] : rarities[0];
  const names = {
    weapon: ['Sword', 'Axe', 'Dagger', 'Staff', 'Bow'],
    armor: ['Plate', 'Leather', 'Robe', 'Chainmail'],
    trinket: ['Amulet', 'Ring', 'Charm', 'Talisman'],
  };
  const item = {
    id: 'g' + Date.now() + Math.floor(Math.random() * 9999),
    slot,
    name: `${rarity.name} ${names[slot][Math.floor(Math.random() * names[slot].length)]}`,
    rarity: rarity.name, color: rarity.color,
    atk: slot === 'weapon' ? Math.floor(5 * scale * rarity.mult) : Math.floor(1 * scale * rarity.mult),
    def: slot === 'armor' ? Math.floor(4 * scale * rarity.mult) : 0,
    hp: slot === 'trinket' ? Math.floor(20 * scale * rarity.mult) : Math.floor(5 * scale * rarity.mult),
  };
  return item;
}

// Compare gear — returns true if new item is better for its slot
export function isUpgrade(hero, item) {
  const current = hero.gear[item.slot];
  if (!current) return true;
  const score = (i) => (i.atk || 0) * 2 + (i.def || 0) * 1.5 + (i.hp || 0) * 0.1;
  return score(item) > score(current);
}
