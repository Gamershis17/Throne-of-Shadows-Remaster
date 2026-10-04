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
  const hero = {
    name, classId,
    level: 1, xp: 0,
    gold: 0,
    stage: 1,
    gear: { weapon: null, armor: null, trinket: null },
    inventory: [],
  };
  // Hunter starts with 1 pet — simple companion, no complex system
  if (classId === 'hunter') {
    hero.pet = { name: 'Wolf', emoji: '🐺', loyalty: 100, level: 1, diet: 'carnivore' };
  }
  return hero;
}

// Pet attacks — damage scales with loyalty: 50% at 0, 150% at full
export function petAttack(hero, enemy) {
  if (!hero.pet || hero.pet.loyalty <= 0) return null;
  const loyaltyMult = 0.5 + (hero.pet.loyalty / 100) * 1.0;
  const dmg = Math.max(1, Math.floor(hero.level * 2 * loyaltyMult));
  enemy.hp = Math.max(0, enemy.hp - dmg);
  return { damage: dmg, killed: enemy.hp <= 0 };
}

// Check if pet leaves (loyalty hit 0)
export function checkPetLeave(hero) {
  if (hero.pet && hero.pet.loyalty <= 0) {
    const name = hero.pet.name;
    hero.pet = null;
    return name;
  }
  return null;
}

// Hunter can find a new pet (costs gold)
export function findPet(hero) {
  if (hero.classId !== 'hunter') return { ok: false, reason: 'class' };
  if (hero.pet) return { ok: false, reason: 'has_pet' };
  const cost = 100 * hero.level;
  if (hero.gold < cost) return { ok: false, reason: 'gold', cost };
  hero.gold -= cost;
  const pets = [
    { name: 'Wolf', emoji: '🐺', diet: 'carnivore' },
    { name: 'Bear', emoji: '🐻', diet: 'omnivore' },
    { name: 'Hawk', emoji: '🦅', diet: 'carnivore' },
  ];
  const p = pets[Math.floor(Math.random() * pets.length)];
  hero.pet = { ...p, loyalty: 50, level: 1 };
  return { ok: true, pet: hero.pet, cost };
}

// Pet food — type matters! Feed the right food for full effect.
export const PET_FOODS = {
  meat: { emoji: '🍖', name: 'Meat', loyalty: 25, cost: 10, for: ['carnivore'] },
  fish: { emoji: '🐟', name: 'Fish', loyalty: 25, cost: 10, for: ['carnivore', 'piscivore'] },
  berries: { emoji: '🫐', name: 'Berries', loyalty: 15, cost: 5, for: ['herbivore', 'omnivore'] },
  honey: { emoji: '🍯', name: 'Honey', loyalty: 30, cost: 20, for: ['omnivore'] },
};

// Feed pet — right food = full loyalty, wrong food = half
export function feedPet(hero, foodId) {
  if (!hero.pet) return { ok: false };
  const food = PET_FOODS[foodId];
  if (!food) return { ok: false };
  const cost = food.cost * hero.level;
  if (hero.gold < cost) return { ok: false, reason: 'gold' };
  hero.gold -= cost;
  const diet = hero.pet.diet || 'carnivore';
  const isRight = food.for.includes(diet);
  const gain = isRight ? food.loyalty : Math.floor(food.loyalty / 2);
  hero.pet.loyalty = Math.min(100, hero.pet.loyalty + gain);
  return { ok: true, gain, rightFood: isRight, food };
}

// Calculate hero stats from level + gear
export function heroStats(hero) {
  const cls = CLASSES[hero.classId];
  let hp = cls.baseHp + cls.hpPerLevel * (hero.level - 1);
  let atk = cls.baseAtk + cls.atkPerLevel * (hero.level - 1);
  let def = cls.baseDef + cls.defPerLevel * (hero.level - 1);
  let critChance = cls.critChance;
  let critMult = cls.critMult;
  // Mana scales with level
  let mana = 50 + hero.level * 5;

  for (const slot of Object.values(hero.gear)) {
    if (!slot) continue;
    hp += slot.hp || 0;
    atk += slot.atk || 0;
    def += slot.def || 0;
    critChance += slot.critChance || 0;
    mana += slot.mana || 0;
  }

  return { hp: Math.floor(hp), atk: Math.floor(atk), def: Math.floor(def), critChance, critMult, mana: Math.floor(mana) };
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

// Spells — each class gets unique abilities
export const SPELLS = {
  warrior: [
    { id: 'slash', name: 'Power Slash', emoji: '⚔️', desc: 'Heavy strike: 200% damage', mana: 10, mult: 2.0, cd: 5 },
    { id: 'shield', name: 'Shield Wall', emoji: '🛡️', desc: 'Block: take 50% less damage for 10s', mana: 15, cd: 15 },
  ],
  mage: [
    { id: 'fireball', name: 'Fireball', emoji: '🔥', desc: 'Explosive: 250% damage', mana: 15, mult: 2.5, cd: 6 },
    { id: 'frost', name: 'Frost Nova', emoji: '❄️', desc: 'Freeze: enemy skips 1 attack', mana: 12, cd: 12 },
  ],
  hunter: [
    { id: 'aimed', name: 'Aimed Shot', emoji: '🎯', desc: 'Precise: 220% damage, always crits', mana: 12, mult: 2.2, cd: 6, alwaysCrit: true },
    { id: 'mend', name: 'Mend Pet', emoji: '💚', desc: 'Heal pet loyalty + feed', mana: 8, cd: 10 },
  ],
};

// Cast a spell — returns result
export function castSpell(hero, spellId, enemy, heroHp, maxHp) {
  const spells = SPELLS[hero.classId] || [];
  const spell = spells.find(s => s.id === spellId);
  if (!spell) return null;
  // TODO: mana/cooldown tracking in game.js
  const stats = heroStats(hero);
  let damage = 0;
  let healing = 0;
  if (spell.mult) {
    const isCrit = spell.alwaysCrit || Math.random() < stats.critChance;
    damage = Math.max(1, Math.floor(stats.atk * spell.mult * (isCrit ? stats.critMult : 1)));
    enemy.hp = Math.max(0, enemy.hp - damage);
  }
  return { spell, damage, healing, killed: enemy.hp <= 0 };
}

// Dungeons — special multi-wave challenges
export const DUNGEONS = [
  { id: 'crypt', name: 'Shadow Crypt', emoji: '🪦', waves: 5, unlockStage: 10, desc: 'Undead lurk in the dark.' },
  { id: 'cavern', name: 'Ember Cavern', emoji: '🌋', waves: 8, unlockStage: 25, desc: 'Fire and stone.' },
  { id: 'abyss', name: 'Void Abyss', emoji: '🕳️', waves: 12, unlockStage: 50, desc: 'The darkness stares back.' },
];

// Compare gear — returns true if new item is better for its slot
export function isUpgrade(hero, item) {
  const current = hero.gear[item.slot];
  if (!current) return true;
  const score = (i) => (i.atk || 0) * 2 + (i.def || 0) * 1.5 + (i.hp || 0) * 0.1;
  return score(item) > score(current);
}
