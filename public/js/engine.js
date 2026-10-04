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
    materials: {},
    completedQuests: [],
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

// Loot materials — for quests and crafting
export const MATERIALS = {
  fang: { emoji: '🦷', name: 'Sharp Fang', desc: 'Dropped by beasts' },
  claw: { emoji: '🐾', name: 'Beast Claw', desc: 'Dropped by beasts' },
  bone: { emoji: '🦴', name: 'Bone Fragment', desc: 'Dropped by undead' },
  ectoplasm: { emoji: '👻', name: 'Ectoplasm', desc: 'Dropped by spirits' },
  scale: { emoji: '🐉', name: 'Dragon Scale', desc: 'Dropped by dragons' },
  ore: { emoji: '⛏️', name: 'Iron Ore', desc: 'Dropped by golems' },
};

// Roll material drop
export function rollMaterialDrop(enemy) {
  if (Math.random() > 0.3) return null; // 30% chance
  const pools = {
    '🐺': ['fang', 'claw'], '🐗': ['fang', 'claw'], '🕷️': ['claw'],
    '🧟': ['bone'], '👺': ['bone', 'claw'], '👹': ['claw', 'fang'],
    '🐉': ['scale'], '🤖': ['ore'], '🧛': ['ectoplasm'], '👿': ['ectoplasm', 'claw'],
  };
  const pool = pools[enemy.emoji] || ['bone', 'fang'];
  const matId = pool[Math.floor(Math.random() * pool.length)];
  return { id: matId, ...MATERIALS[matId], qty: 1 };
}

// --- Quests ---
export const QUESTS = [
  {
    id: 'q1', name: 'Wolf Hunter', emoji: '🐺',
    desc: 'Collect 5 Sharp Fangs from beasts',
    need: { fang: 5 }, reward: { gold: 100, xp: 50 },
  },
  {
    id: 'q2', name: 'Bone Collector', emoji: '🦴',
    desc: 'Collect 8 Bone Fragments from undead',
    need: { bone: 8 }, reward: { gold: 200, xp: 120 },
  },
  {
    id: 'q3', name: 'Spider Bane', emoji: '🕷️',
    desc: 'Collect 6 Beast Claws', need: { claw: 6 },
    reward: { gold: 350, xp: 200 },
  },
  {
    id: 'q4', name: 'Dragon Slayer', emoji: '🐉',
    desc: 'Collect 3 Dragon Scales (bosses only)',
    need: { scale: 3 }, reward: { gold: 1000, xp: 500 },
  },
];

// --- Vendors ---
export const VENDORS = [
  {
    id: 'blacksmith', name: 'Gromm the Blacksmith', emoji: '🔨',
    desc: 'Weapons and armor',
    sells: ['weapon', 'armor'], // gear slots
  },
  {
    id: 'trader', name: 'Mira the Trader', emoji: '🧺',
    desc: 'Food and supplies',
    sells: ['food'],
  },
  {
    id: 'alchemist', name: 'Zoltar the Alchemist', emoji: '⚗️',
    desc: 'Potions and trinkets',
    sells: ['potion', 'trinket'],
  },
];

// Generate vendor stock (scales with hero level)
export function vendorStock(vendorId, heroLevel) {
  const vendor = VENDORS.find(v => v.id === vendorId);
  if (!vendor) return [];
  const stock = [];
  const scale = Math.pow(1.1, heroLevel - 1);
  for (const type of vendor.sells) {
    if (type === 'food') {
      for (const [fid, food] of Object.entries(PET_FOODS)) {
        stock.push({
          id: 'food-' + fid, type: 'food', foodId: fid,
          name: `${food.emoji} ${food.name}`,
          desc: `Pet food (+${food.loyalty} loyalty)`,
          price: food.cost * heroLevel,
        });
      }
    } else if (type === 'potion') {
      stock.push({
        id: 'potion-hp', type: 'potion',
        name: '🧪 Health Potion',
        desc: `Restores ${50 * heroLevel} HP`,
        price: 25 * heroLevel, heal: 50 * heroLevel,
      });
      stock.push({
        id: 'potion-mana', type: 'potion',
        name: '💧 Mana Potion',
        desc: `Restores ${30 * heroLevel} Mana`,
        price: 20 * heroLevel, mana: 30 * heroLevel,
      });
    } else {
      // Gear (weapon/armor/trinket)
      for (let i = 0; i < 3; i++) {
        const slot = type;
        const names = {
          weapon: ['Sword', 'Axe', 'Dagger'],
          armor: ['Plate', 'Leather', 'Robe'],
          trinket: ['Amulet', 'Ring', 'Charm'],
        };
        const item = {
          id: `v-${vendorId}-${slot}-${i}-${Date.now()}`,
          type: 'gear', slot,
          name: `${names[slot][i % 3]}`,
          atk: slot === 'weapon' ? Math.floor(8 * scale) : Math.floor(2 * scale),
          def: slot === 'armor' ? Math.floor(6 * scale) : 0,
          hp: slot === 'trinket' ? Math.floor(30 * scale) : Math.floor(10 * scale),
          price: Math.floor(100 * scale),
          color: '#4a90d9', rarity: 'Magic',
        };
        stock.push(item);
      }
    }
  }
  return stock;
}

// Buy from vendor
export function buyFromVendor(hero, item) {
  if (hero.gold < item.price) return { ok: false, reason: 'gold' };
  hero.gold -= item.price;
  if (item.type === 'gear') {
    hero.inventory.push(item);
  } else if (item.type === 'food') {
    hero.food = hero.food || {};
    hero.food[item.foodId] = (hero.food[item.foodId] || 0) + 1;
  } else if (item.type === 'potion') {
    hero.potions = hero.potions || [];
    hero.potions.push(item);
  }
  return { ok: true };
}

// Sell price — low early, better at higher levels/zones
// Formula: base * (1 + level/50) * (1 + stage/100)
export function sellPrice(item, hero) {
  const base = (item.atk || 0) * 2 + (item.def || 0) * 2 + (item.hp || 0) * 0.5;
  const levelMult = 1 + hero.level / 50;
  const stageMult = 1 + hero.stage / 100;
  return Math.max(1, Math.floor(base * 0.3 * levelMult * stageMult));
}

// --- Auction House ---
// List an item for sale
export function listAuction(hero, itemId, price) {
  const idx = hero.inventory.findIndex(i => i.id === itemId);
  if (idx === -1) return { ok: false };
  if (price < 1) return { ok: false, reason: 'price' };
  const item = hero.inventory[idx];
  hero.inventory.splice(idx, 1);
  hero.auctions = hero.auctions || [];
  hero.auctions.push({ ...item, listPrice: price, listedAt: Date.now() });
  return { ok: true };
}

// Cancel auction (get item back)
export function cancelAuction(hero, itemId) {
  hero.auctions = hero.auctions || [];
  const idx = hero.auctions.findIndex(a => a.id === itemId);
  if (idx === -1) return { ok: false };
  const item = hero.auctions[idx];
  delete item.listPrice;
  delete item.listedAt;
  hero.inventory.push(item);
  hero.auctions.splice(idx, 1);
  return { ok: true };
}

// Simulate NPC buyers (called periodically)
export function checkAuctionSales(hero) {
  hero.auctions = hero.auctions || [];
  const sold = [];
  const now = Date.now();
  hero.auctions = hero.auctions.filter(a => {
    // 10% chance per check to sell (if listed for >30s)
    if (now - a.listedAt > 30000 && Math.random() < 0.1) {
      hero.gold += a.listPrice;
      sold.push(a);
      return false;
    }
    return true;
  });
  return sold;
}

// --- Mail ---
// Send mail to hero
export function sendMail(hero, subject, body, gold, item) {
  hero.mail = hero.mail || [];
  hero.mail.push({
    id: 'm' + Date.now() + Math.floor(Math.random() * 9999),
    subject, body, gold: gold || 0, item: item || null,
    read: false, at: Date.now(),
  });
}

// Claim mail attachments
export function claimMail(hero, mailId) {
  hero.mail = hero.mail || [];
  const m = hero.mail.find(x => x.id === mailId);
  if (!m) return false;
  if (m.gold) hero.gold += m.gold;
  if (m.item) hero.inventory.push(m.item);
  m.gold = 0;
  m.item = null;
  m.read = true;
  return true;
}

// Auction expiry: 1 hour. Unsold items return via mail.
export function checkAuctionExpiry(hero) {
  hero.auctions = hero.auctions || [];
  const now = Date.now();
  const expired = [];
  hero.auctions = hero.auctions.filter(a => {
    if (now - a.listedAt > 3600000) { // 1 hour
      const { listPrice, listedAt, ...item } = a;
      expired.push(item);
      return false;
    }
    return true;
  });
  for (const item of expired) {
    sendMail(hero, '📦 Auction Expired', `${item.name} didn't sell. Returned to you.`, 0, item);
  }
  return expired;
}

// Updated: sales go to mail, not direct gold
export function checkAuctionSalesMail(hero) {
  hero.auctions = hero.auctions || [];
  const now = Date.now();
  const sold = [];
  hero.auctions = hero.auctions.filter(a => {
    if (now - a.listedAt > 30000 && Math.random() < 0.1) {
      sold.push(a);
      return false;
    }
    return true;
  });
  for (const s of sold) {
    sendMail(hero, '💰 Auction Sold!', `${s.name} sold for ${s.listPrice}g.`, s.listPrice, null);
  }
  return sold;
}

// Check quest progress
export function questProgress(hero, quest) {
  const mats = hero.materials || {};
  let done = true;
  for (const [mid, need] of Object.entries(quest.need)) {
    if ((mats[mid] || 0) < need) done = false;
  }
  return done;
}

// Turn in quest
export function turnInQuest(hero, questId) {
  const quest = QUESTS.find(q => q.id === questId);
  if (!quest || (hero.completedQuests || []).includes(questId)) return null;
  if (!questProgress(hero, quest)) return null;
  // Remove materials
  for (const [mid, need] of Object.entries(quest.need)) {
    hero.materials[mid] -= need;
  }
  hero.gold += quest.reward.gold;
  const levels = awardXp(hero, quest.reward.xp);
  hero.completedQuests = hero.completedQuests || [];
  hero.completedQuests.push(questId);
  return { quest, levels };
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

// Party roles
export const ROLES = {
  tank: { emoji: '🛡️', name: 'Tank' },
  healer: { emoji: '💚', name: 'Healer' },
  dps: { emoji: '⚔️', name: 'DPS' },
};

// NPC companions for hire
export const COMPANIONS = [
  { id: 'bromm', name: 'Bromm', emoji: '🧔', role: 'tank', desc: 'Sturdy dwarf, takes hits', hp: 200, atk: 10, def: 15, cost: 500 },
  { id: 'sylvara', name: 'Sylvara', emoji: '🧝', role: 'healer', desc: 'Elven healer, mends wounds', hp: 100, atk: 5, def: 5, heal: 30, cost: 500 },
  { id: 'karg', name: 'Karg', emoji: '👹', role: 'dps', desc: 'Orc berserker', hp: 120, atk: 25, def: 5, cost: 300 },
  { id: 'lyra', name: 'Lyra', emoji: '🧙', role: 'dps', desc: 'Human mage', hp: 80, atk: 30, def: 3, cost: 300 },
  { id: 'finn', name: 'Finn', emoji: '🥷', role: 'dps', desc: 'Halfling rogue', hp: 90, atk: 28, def: 4, cost: 300 },
];

// Create empty party — player fills 1 slot, recruit 4 NPCs
export function createParty(playerClass) {
  const roleMap = { warrior: 'tank', mage: 'dps', hunter: 'dps' };
  return {
    members: [
      { id: 'player', role: roleMap[playerClass] || 'dps', isPlayer: true },
    ],
    // Need: 1 tank, 1 healer, 3 dps total (player fills one)
  };
}

// --- Dungeon Runs ---
// Start a dungeon run
export function startDungeon(dungeonId, hero, party) {
  const dungeon = DUNGEONS.find(d => d.id === dungeonId);
  if (!dungeon) return null;
  return {
    dungeon,
    wave: 1,
    enemies: [],
    partyHp: {}, // member id -> current hp
    done: false,
  };
}

// Spawn wave enemies (scaled to dungeon difficulty)
export function spawnDungeonWave(run, hero) {
  const d = run.dungeon;
  const isFinal = run.wave === d.waves;
  const count = isFinal ? 1 : 2 + Math.floor(Math.random() * 2); // 2-3 normal, 1 boss
  run.enemies = [];
  for (let i = 0; i < count; i++) {
    const baseStage = hero.stage + (d.unlockStage / 2);
    const enemy = makeEnemy(Math.floor(baseStage));
    if (isFinal) {
      // Final wave = boss
      enemy.isBoss = true;
      enemy.hp = enemy.maxHp = Math.floor(enemy.hp * 2);
      enemy.atk = Math.floor(enemy.atk * 1.5);
      enemy.xpReward = Math.floor(enemy.xpReward * 3);
      enemy.goldReward = Math.floor(enemy.goldReward * 3);
    }
    run.enemies.push(enemy);
  }
  return run.enemies;
}

// Party member attacks (NPC AI)
export function partyAttack(member, enemies, hero) {
  // Find alive enemy
  const target = enemies.find(e => e.hp > 0);
  if (!target) return null;
  let dmg = 0;
  if (member.isPlayer) {
    const stats = heroStats(hero);
    dmg = Math.max(1, Math.floor(stats.atk * (0.85 + Math.random() * 0.3)));
  } else {
    dmg = Math.max(1, Math.floor(member.atk * (0.85 + Math.random() * 0.3)));
  }
  target.hp = Math.max(0, target.hp - dmg);
  return { damage: dmg, target, killed: target.hp <= 0 };
}

// Healer heals lowest HP party member
export function healerAct(healer, run, hero, heroHp) {
  // Find lowest HP member (including player)
  let lowest = null;
  let lowestPct = 2;
  // Check player
  const maxHp = heroStats(hero).hp;
  const playerPct = heroHp / maxHp;
  if (playerPct < lowestPct) {
    lowestPct = playerPct;
    lowest = { isPlayer: true };
  }
  // Check NPCs
  for (const m of run.party.members) {
    if (m.isPlayer || m.role !== 'tank' && m.role !== 'dps') continue;
    if (m.id === healer.id) continue;
    const pct = (run.partyHp[m.id] || m.maxHp) / m.maxHp;
    if (pct < lowestPct) {
      lowestPct = pct;
      lowest = m;
    }
  }
  if (!lowest || lowestPct > 0.8) return null; // Only heal if below 80%
  const amount = healer.heal || 30;
  if (lowest.isPlayer) {
    return { target: 'player', amount };
  } else {
    run.partyHp[lowest.id] = Math.min(lowest.maxHp, (run.partyHp[lowest.id] || lowest.maxHp) + amount);
    return { target: lowest.name, amount };
  }
}

// Check if party is full and valid (1 tank, 1 healer, 3 dps)
export function validateParty(party) {
  const counts = { tank: 0, healer: 0, dps: 0 };
  for (const m of party.members) counts[m.role]++;
  return counts.tank === 1 && counts.healer === 1 && counts.dps === 3;
}

// Hire a companion
export function hireCompanion(hero, party, companionId) {
  const comp = COMPANIONS.find(c => c.id === companionId);
  if (!comp) return { ok: false };
  if (party.members.length >= 5) return { ok: false, reason: 'full' };
  if (party.members.some(m => m.id === companionId)) return { ok: false, reason: 'have' };
  if (hero.gold < comp.cost) return { ok: false, reason: 'gold' };
  // Check role not already filled (except DPS which needs 3)
  const roleCount = party.members.filter(m => m.role === comp.role).length;
  const maxForRole = comp.role === 'dps' ? 3 : 1;
  if (roleCount >= maxForRole) return { ok: false, reason: 'role' };
  hero.gold -= comp.cost;
  party.members.push({ ...comp, hp: comp.hp, maxHp: comp.hp });
  return { ok: true, companion: comp };
}

// Compare gear — returns true if new item is better for its slot
export function isUpgrade(hero, item) {
  const current = hero.gear[item.slot];
  if (!current) return true;
  const score = (i) => (i.atk || 0) * 2 + (i.def || 0) * 1.5 + (i.hp || 0) * 0.1;
  return score(item) > score(current);
}
