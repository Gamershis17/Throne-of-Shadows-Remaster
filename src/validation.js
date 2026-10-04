'use strict';

/**
 * Input validation and player-state sanity clamps.
 */

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MAX_BLOB_BYTES = 1024 * 1024; // 1 MB

// Canonical name-effect ids. Mirrors the client's ALL_NAME_FX_IDS in
// public/js/engine.js (BASE_NAME_FX_IDS + TOKEN_NAME_FX + STAFF_NAME_FX).
// Single source of truth: db.js imports this instead of keeping its own
// copy, so the server can never drift from the client list again.
const NAME_FX_IDS = new Set([
  'none', 'fire', 'neon', 'rainbow', 'shine', 'galaxy',
  'ice', 'lightning', 'shadow', 'glitch', 'falling-leaves', 'harvest-ember', 'autumn-mist', 'snowfall', 'aurora', 'frostbite', 'tidal', 'sunscorched', 'wildfire', 'fireworks', 'champagne', 'midnight',
  'voidborn', 'goldleaf', 'bloodmoon', 'stormsurge', 'celestial', 'throneflame',
  'gavelstrike', 'allseeing', 'worldforge', 'archlight', 'shadowcrown', 'everflame', 'rainbowblood',
]);

// Server gold cap (owner-adjustable via server_settings). sanitizeStateBlob
// clamps player gold to it on every save. Refreshed from the DB at boot and
// whenever the owner changes it (see db.refreshGoldCap).
let goldCap = 9.99e44; // 999Td default (was 999Dc)
function setGoldCap(cap) {
  if (Number.isFinite(cap) && cap >= 1e12) goldCap = cap;
}
function getGoldCapValue() { return goldCap; }

// Server-side mirror of the client XP curve in public/js/engine.js (v19):
// levels 1-30 use a 1.30 exponent, 31-60 continue from the level-30 value
// with a 1.35 exponent, 61-90 continue from the level-60 value with a 1.44
// exponent, 91-120 continue from the level-90 value with a 1.47 exponent
// (continuous at every kink), and every rebirth multiplies
// requirements by 1.35^rebirths.
// Keep in sync if the client formula ever changes.
const SV_XP_V30 = 80 * Math.pow(1.30, 29);
const SV_XP_V60 = SV_XP_V30 * Math.pow(1.35, 30);
const SV_XP_V90 = SV_XP_V60 * Math.pow(1.44, 30);
function xpForLevelServer(level, rebirthCount) {
  const l = Math.max(1, Math.floor(Number(level) || 1));
  const base = l <= 30
    ? 80 * Math.pow(1.30, l - 1)
    : l <= 60
    ? SV_XP_V30 * Math.pow(1.35, l - 30)
    : l <= 90
    ? SV_XP_V60 * Math.pow(1.44, l - 60)
    : SV_XP_V90 * Math.pow(1.47, l - 90);
  const rb = Math.min(200, Math.max(0, Math.floor(Number(rebirthCount) || 0)));
  const mult = Math.pow(1.35, rb);
  return Math.max(1, Math.round(base * mult));
}

// All roles recognized by the server, highest privilege first.
const VALID_ROLES = ['owner', 'gm', 'admin', 'moderator', 'tester', 'player'];

// Valid class/spec ids (mirror Engine.CLASSES / Engine.SPECS in
// public/js/engine.js; the client is ESM so the lists are duplicated here
// for the CJS server). Single source of truth for gameApi.js and gmApi.js.
const VALID_CLASSES = new Set(['hunter', 'warrior', 'mage', 'assassin', 'necromancer', 'berserker', 'druid']);
const VALID_SPECS = new Set(['tank', 'dps', 'healer', 'classic']);

function validateUsername(username) {
  if (typeof username !== 'string') return 'Username is required.';
  const trimmed = username.trim();
  if (!USERNAME_RE.test(trimmed)) {
    return 'Username must be 3-20 characters: letters, numbers, underscore.';
  }
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  return null;
}

// Named root fields and their clamp ranges [min, max]. Only applied when the
// field exists and holds a finite number; non-finite numbers become the min.
const CLAMPED_FIELDS = {
  level: [1, 120],
  stage: [1, 100000],
  gold: [0, 9.99e35], // 999Dc
  stars: [0, 1e15],
  xp: [0, 1e21], // xpForLevel(120) alone is ~7.7e18
  xpNext: [0, 1e21],
  bossesKilled: [0, 100000000],
  rebirthCount: [0, 100000],
  rebirthTokens: [0, 100000], // earned 1 per rebirth, spent in the token shop
};

function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Deep-sanitize a state blob: every number must be finite (non-finite become
 * 0), then named root fields are clamped to their allowed ranges.
 * Mutates and returns the blob.
 */
function sanitizeNumbers(node) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === 'number') {
        node[i] = Number.isFinite(v) ? v : 0;
      } else if (v && typeof v === 'object') {
        sanitizeNumbers(v);
      }
    }
    return;
  }
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (typeof v === 'number') {
      node[key] = Number.isFinite(v) ? v : 0;
    } else if (v && typeof v === 'object') {
      sanitizeNumbers(v);
    }
  }
}

/**
 * Validate + sanitize a state blob sent by the client.
 * Returns { ok: true, state } or { ok: false, error }.
 */
function sanitizeStateBlob(blob) {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
    return { ok: false, error: 'State must be a JSON object.' };
  }
  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(blob), 'utf8');
  } catch (e) {
    return { ok: false, error: 'State is not serializable.' };
  }
  if (size > MAX_BLOB_BYTES) {
    return { ok: false, error: 'State too large (max 1 MB).' };
  }
  sanitizeNumbers(blob);
  for (const [field, [min, max]] of Object.entries(CLAMPED_FIELDS)) {
    if (typeof blob[field] === 'number') {
      // Gold clamps to the live owner-set cap; the infinite-gold perk
      // (owner-granted, server-side) bypasses it entirely.
      if (field === 'gold') {
        if (blob.infGold === true) continue;
        blob.gold = clamp(blob.gold, 0, goldCap);
        continue;
      }
      blob[field] = clamp(blob[field], min, max);
    }
  }
  // Indexed columns must exist as numbers for db.saveState.
  if (typeof blob.level !== 'number') blob.level = 1;
  if (typeof blob.stage !== 'number') blob.stage = 1;
  // Name styles are cosmetic: keep them only when well-formed so tampered
  // blobs can't smuggle junk (rendering escapes everything anyway).
  if (blob.nameColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(blob.nameColor))) delete blob.nameColor;
  if (blob.nameFx !== undefined && !NAME_FX_IDS.has(blob.nameFx)) delete blob.nameFx;
  // Battle background is cosmetic: keep only a known value.
  if (blob.battleBg !== undefined && !['world', 'mystyle', 'off'].includes(blob.battleBg)) delete blob.battleBg;
  if (typeof blob.bossesKilled !== 'number') blob.bossesKilled = 0;
  if (typeof blob.rebirthCount !== 'number') blob.rebirthCount = 0;
  if (!Array.isArray(blob.inventory)) blob.inventory = [];
  if (!Array.isArray(blob.codesRedeemed)) blob.codesRedeemed = [];
  // Anti-spoof: never trust client-supplied xpNext — recompute it from
  // level + rebirthCount so tampered saves can't grant cheap levels.
  // Mirrors public/js/engine.js xpForLevel (v19: kinks at 30/60/90 with
  // 1.30/1.35/1.44/1.47 exponents, 1.35^rebirths capped at 200).
  blob.xpNext = xpForLevelServer(blob.level, blob.rebirthCount);
  // Mining + forge: keep legit saves passing. Ores are plain finite
  // non-negative counts (clamped); forged item stats are clamped to a
  // sane cap so tampered values can't smuggle Infinity-scale numbers.
  if (blob.mine && typeof blob.mine === 'object' && !Array.isArray(blob.mine)) {
    if (typeof blob.mine.depth === 'number') {
      blob.mine.depth = clamp(Math.floor(blob.mine.depth), 1, 100);
    }
    // Pickaxe tier must be an int 0..7; lifetime mining counters must be
    // finite non-negative ints.
    blob.mine.pickaxe = typeof blob.mine.pickaxe === 'number'
      // Keep in sync with PICKAXE_TIERS.length - 1 in public/js/engine.js (11 tiers).
      ? clamp(Math.floor(blob.mine.pickaxe), 0, 10)
      : 0;
    for (const k of ['totalTaps', 'totalMined', 'maxDepth']) {
      const v = blob.mine[k];
      blob.mine[k] = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    }
    const ores = blob.mine.ores;
    if (ores && typeof ores === 'object' && !Array.isArray(ores)) {
      for (const k of Object.keys(ores)) {
        ores[k] = Number.isFinite(ores[k]) ? clamp(Math.floor(ores[k]), 0, 1e12) : 0;
      }
    }
  }
  if (blob.forge && typeof blob.forge === 'object' && !Array.isArray(blob.forge)) {
    // Forge lifetime counters: crafts is a non-negative int, superCrafted
    // is strictly boolean.
    const cr = blob.forge.crafts;
    blob.forge.crafts = Number.isFinite(cr) ? Math.max(0, Math.floor(cr)) : 0;
    blob.forge.superCrafted = blob.forge.superCrafted === true;
    for (const slot of ['weapon', 'armor']) {
      const it = blob.forge[slot];
      if (it && typeof it === 'object' && it.stats && typeof it.stats === 'object') {
        for (const k of Object.keys(it.stats)) {
          it.stats[k] = Number.isFinite(it.stats[k]) ? Math.min(1e9, Math.max(0, it.stats[k])) : 0;
        }
      }
    }
  }
  // Pet level cap: pets can't exceed player level (anti-inflation).
  // Clamp any over-leveled pets from before the cap was introduced.
  if (blob.pets && typeof blob.pets === 'object' && !Array.isArray(blob.pets)) {
    const playerLevel = Math.max(1, Math.floor(blob.level || 1));
    const coll = blob.pets.collection;
    if (Array.isArray(coll)) {
      for (const pet of coll) {
        if (pet && typeof pet === 'object' && typeof pet.level === 'number') {
          if (pet.level > playerLevel) {
            pet.level = playerLevel;
            pet.xp = 0;
          }
        }
      }
    }
  }
  return { ok: true, state: blob };
}

module.exports = {
  validateUsername,
  validatePassword,
  sanitizeStateBlob,
  xpForLevelServer,
  setGoldCap,
  getGoldCapValue,
  MAX_BLOB_BYTES,
  VALID_ROLES,
  VALID_CLASSES,
  VALID_SPECS,
  NAME_FX_IDS,
};
