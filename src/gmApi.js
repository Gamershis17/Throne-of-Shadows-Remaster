'use strict';

/**
 * GM + role-management API:
 *   GET  /api/gm/overview     (gm|owner|admin)
 *   POST /api/gm/grant        (gm|owner|admin)
 *   POST /api/gm/grant-title  (gm|owner|admin)
 *   POST /api/gm/badge       (gm|owner|admin)
 *   POST /api/gm/grant-pet   (gm|owner|admin) — grant unhatched pet eggs
 *   POST /api/gm/set-rebirth (gm|owner|admin) — set a player's rebirth count
 *   POST /api/gm/inf-gold    (owner) — toggle infinite-gold perk
 *   POST /api/gm/settings    (owner) — update server tunables (gold_cap)
 *   POST /api/gm/maintenance (owner) — maintenance mode on/off + message
 *   POST /api/gm/set-stage    (gm|owner|admin)
 *   POST /api/gm/set-level    (gm|owner|admin) — set a player's level (1-120)
 *   POST /api/gm/set-gold     (gm|owner|admin) — set a player's gold (absolute)
 *   POST /api/gm/heal         (gm|owner|admin)
 *   POST /api/gm/reset        (gm|owner|admin)
 *   GET  /api/gm/codes        (gm|owner|admin)
 *   POST /api/gm/codes        (gm|owner|admin)
 *   GET  /api/gm/roster       (gm|owner|admin)
 *   POST /api/gm/roster       (gm|owner|admin)
 *   POST /api/gm/title        (owner|admin) — unlock a title for a player
 *   POST /api/gm/stage        (owner|admin) — set a player's stage
 *   POST /api/gm/ban          (owner|admin) — stub until users.banned exists
 *   POST /api/gm/unban        (owner|admin) — stub until users.banned exists
 *   POST /api/gm/kick         (owner|admin) — force-logout a player now
 *   POST /api/gm/broadcast    (owner|admin|moderator) — server announcement
 *   GET  /api/broadcasts/latest (public) — newest announcement
 *   GET  /api/gm/players      (owner|admin|moderator) — player list w/ search
 *   POST /api/gm/reset-player (owner|admin) — wipe a player's save
 *   POST /api/gm/delete-account (owner only) — permanently delete an account
 *   POST /api/roles           (owner only)
 *   POST /api/gm/inventory      (gm|owner|admin) — full inventory listing
 *   POST /api/gm/remove-item    (gm|owner|admin) — remove one inventory item
 *   POST /api/gm/mod-item       (owner) — override item stats (no caps)
 *   POST /api/gm/mod-pet        (owner) — modify pet level/species/hunger/xp
 *   POST /api/gm/remove-pet     (owner) — remove a pet by UID
 *   POST /api/gm/set-enchant    (gm|owner|admin) — set enchant 0-10 on inventory/equipped item
 *   POST /api/gm/reset-quests   (gm|owner|admin) — force re-roll of daily/weekly quests
 *   POST /api/gm/event-buff     (gm|owner|admin) — server-wide XP/gold multiplier w/ expiry
 *   GET  /api/gm/audit          (gm|owner|admin) — server-side staff action log
 *   POST /api/report            (any signed-in player) — file a bug report / feedback
 *   GET  /api/report/mine       (any signed-in player) — own reports w/ status
 *   GET  /api/gm/reports        (owner|admin) — report inbox, ?kind=&status=
 *   PATCH /api/gm/reports/:id   (owner|admin) — set report status
 *   GET  /api/gm/ideas          (owner|admin) — idea board listing
 *   POST /api/gm/ideas          (owner|admin) — add an idea
 *   PATCH /api/gm/ideas/:id     (owner|admin) — edit idea status/title/body
 *   DELETE /api/gm/ideas/:id    (owner|admin) — delete an idea
 *   GET  /api/gm/admin-chat     (owner|admin) — staff-only chat history, ?after=
 *   POST /api/gm/admin-chat     (owner|admin) — post a staff-chat message
 *   DELETE /api/gm/admin-chat/:id (owner|admin) — delete a staff-chat message
 *   POST /api/gm/clear-guild-chat (owner|admin|gm) — wipe the target player's guild chat history
 *   POST /api/gm/grant-forge-box (gm|owner|admin) — grant galaxy forge box (25 galaxy + 40 adamant ores)
 *   POST /api/gm/grant-class-gear (gm|owner|admin) — grant mythic class weapon/armor scaled to target's stage
 *
 * All database access is async (PostgreSQL).
 */

const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireRole, requireAuth, optionalAuth, asyncHandler } = require('./auth');
const { sanitizeStateBlob, VALID_ROLES, VALID_CLASSES, VALID_SPECS, NAME_FX_IDS, xpForLevelServer } = require('./validation');
const { makeGearItems, isValidSetId } = require('./gearSets');
const { loadBlob, defaultStateBlob, filterChangelog } = require('./gameApi');
const { addBroadcast, latestBroadcast, addSseClient, pushBuff, pushStateUpdate } = require('./broadcast');
const {
  getWebhookUrl,
  setWebhookUrl,
  getBugWebhookUrl,
  setBugWebhookUrl,
  getFeedbackWebhookUrl,
  setFeedbackWebhookUrl,
  getPatchnotesWebhookUrl,
  setPatchnotesWebhookUrl,
  getBalanceWebhookUrl,
  setBalanceWebhookUrl,
  maskWebhookUrl,
  postModlog,
  postReport,
  postPatchNotes,
  postBalanceLog,
} = require('./discordWebhook');
const {
  pool,
  getUserByUsername,
  setUserRole,
  getPlayerCount,
  getUsernamesByRole,
  saveState,
  createGiftCode,
  listGiftCodes,
  getCodeCount,
  getGiftCode,
  getGoldCap,
  setSetting,
  getSetting,
  refreshGoldCap,
  bumpSessionVersion,
  addAdminChat,
  getAdminChat,
  deleteAdminChat,
} = require('./db');

const router = express.Router();
// v23: admin is a senior staff role — it carries the GM grant powers too
// (owner > admin > gm > moderator). Previously admins could open the GM
// console but every grant/set-level/set-gold button 403'd on them.
const gmOrOwner = requireRole('gm', 'owner', 'admin');
const ownerOnly = requireRole('owner');
// Moderator tier: read-only staff tools + broadcasts. Sensitive grant
// endpoints stay on gmOrOwner; never widen those to this middleware.
const requireMod = requireRole('owner', 'admin', 'gm', 'moderator');
// Admin tier: player-management commands that don't grant power.
const adminPlus = requireRole('owner', 'admin');
// Owner + admin + GM: player-moderation tier (ban/kick/mute).
const ownerAdminGm = requireRole('owner', 'admin', 'gm');

// Announcement spam protection: broadcasts toast every active player, so
// cap them at 5 per 10 minutes per staff member.
const broadcastLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => (req.user && req.user.id ? `u:${req.user.id}` : req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many announcements. Try again later.' },
});

// Player bug-report spam protection: 10 reports per hour per staff member.
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req.user && req.user.id ? `u:${req.user.id}` : req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reports. Try again later.' },
});

const VALID_ROLES_FOR_ROLES_ROUTE = VALID_ROLES.filter((r) => r !== 'owner');
const STAR_GRANT_MIN = 1;
const STAR_GRANT_MAX = 100000;
// Ore ids mirrored from the client's Engine.ORE_TIERS (server is CJS,
// engine.js is ESM — keep this list in sync if tiers change).
const ORE_IDS = ['copper', 'iron', 'silver', 'gold', 'mithril', 'adamant', 'galaxy', 'supergalaxy'];
const ORE_GRANT_MIN = 1;
const ORE_GRANT_MAX = 1000000000;

// Unambiguous alphabet: no 0/O, 1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Client engine (public/js/engine.js) loaded as an .mjs module so GM item
// generation uses the exact same makeLootItem / class-name pools as the
// client. Same approach as gameApi.js.
let _enginePromise = null;
function serverEngine() {
  if (!_enginePromise) {
    _enginePromise = (async () => {
      const src = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'engine.js'),
        'utf8'
      );
      const tmp = path.join(os.tmpdir(), 'tos-engine-gm.mjs');
      fs.writeFileSync(tmp, src);
      return import(tmp);
    })();
  }
  return _enginePromise;
}

async function generateCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    let chars = '';
    const bytes = crypto.randomBytes(12);
    for (const b of bytes) chars += CODE_ALPHABET[b % CODE_ALPHABET.length];
    const code = `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
    if (!(await getGiftCode(code))) return code;
  }
  throw new Error('Failed to generate a unique gift code.');
}

async function persistMergedState(userId, blob) {
  const sanitized = sanitizeStateBlob(blob);
  await saveState(userId, sanitized.ok ? sanitized.state : blob);
}
// The client hot-reloads its live game state after a self-grant. Only ever
// include the blob when the GM targeted themselves — never leak another
// player's full state through a GM response.
function selfState(req, target, blob) {
  return target.id === req.user.id ? blob : undefined;
}


async function resolveTarget(username) {
  if (typeof username !== 'string' || !username.trim()) return null;
  return getUserByUsername(username.trim());
}

// ---------- overview ----------
router.get(
  '/gm/overview',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    res.json({
      role: req.user.role,
      playerCount: await getPlayerCount(),
      codeCount: await getCodeCount(),
    });
  })
);

// ---------- grants ----------
// XP math lives in validation.js (xpForLevelServer) so the GM console,
// save sanitizer, and client all use the same curve.
const GM_MAX_LEVEL = 120;

function ensureHero(blob) {
  if (!blob.hero || typeof blob.hero !== 'object') blob.hero = {};
  return blob.hero;
}

/** Mirrors client grantLevels(): per-level stat gains + mastery points + full heal. */
function applyLevelGrant(blob, n) {
  n = Math.max(1, Math.min(100, Math.floor(n) || 0));
  if (!n) return 0;
  blob.level = Math.max(1, Math.floor(Number(blob.level) || 1));
  const hero = ensureHero(blob);
  let granted = 0;
  for (let i = 0; i < n && blob.level < GM_MAX_LEVEL; i++) {
    blob.level += 1;
    hero.attack = (Number(hero.attack) || 0) + 3;
    hero.maxHp = (Number(hero.maxHp) || 0) + 25;
    hero.defense = (Number(hero.defense) || 0) + 2;
    if (blob.level % 10 === 0 && blob.mastery && typeof blob.mastery === 'object') {
      blob.mastery.points = Math.max(0, Math.floor(Number(blob.mastery.points) || 0)) + 1;
    }
    granted += 1;
  }
  blob.xp = 0;
  blob.xpNext = xpForLevelServer(blob.level, blob.rebirthCount);
  hero.hp = hero.maxHp;
  return granted;
}

/** Add XP and process level-ups server-side so stats stay consistent. */
function applyXpGrant(blob, amount) {
  blob.level = Math.max(1, Math.floor(Number(blob.level) || 1));
  blob.xp = Math.max(0, Number(blob.xp) || 0) + amount;
  if (!Number.isFinite(Number(blob.xpNext)) || Number(blob.xpNext) < 1) {
    blob.xpNext = xpForLevelServer(blob.level, blob.rebirthCount);
  }
  const hero = ensureHero(blob);
  let guard = 0;
  while (blob.xp >= blob.xpNext && guard++ < 10000 && blob.level < GM_MAX_LEVEL) {
    blob.xp -= blob.xpNext;
    blob.level += 1;
    hero.attack = (Number(hero.attack) || 0) + 3;
    hero.maxHp = (Number(hero.maxHp) || 0) + 25;
    hero.defense = (Number(hero.defense) || 0) + 2;
    blob.xpNext = xpForLevelServer(blob.level, blob.rebirthCount);
    if (blob.level % 10 === 0 && blob.mastery && typeof blob.mastery === 'object') {
      blob.mastery.points = Math.max(0, Math.floor(Number(blob.mastery.points) || 0)) + 1;
    }
  }
  if (blob.level >= GM_MAX_LEVEL) blob.xp = 0; // cap reached: bank no XP past it
}

const GOLD_GRANT_MIN = 1;
const GOLD_GRANT_MAX = 1000000;
const LEVEL_GRANT_MIN = 1;
const LEVEL_GRANT_MAX = 100;
const XP_GRANT_MIN = 1;
const XP_GRANT_MAX = 1e12;

router.post(
  '/gm/grant',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, kind, amount, set } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });

    if (kind === 'gold') {
      if (!Number.isInteger(amount) || amount < GOLD_GRANT_MIN || amount > GOLD_GRANT_MAX) {
        return res
          .status(400)
          .json({ error: `Amount must be an integer between ${GOLD_GRANT_MIN} and ${GOLD_GRANT_MAX}.` });
      }
      const blob = await loadBlob(target.id);
      const cur = Math.max(0, Number(blob.gold) || 0);
      // Infinite-gold perk holders bypass the cap; everyone else clamps to it.
      blob.gold = blob.infGold === true ? cur + amount : Math.min(await getGoldCap(), cur + amount);
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `gold x${amount}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'levels') {
      if (!Number.isInteger(amount) || amount < LEVEL_GRANT_MIN || amount > LEVEL_GRANT_MAX) {
        return res
          .status(400)
          .json({ error: `Amount must be an integer between ${LEVEL_GRANT_MIN} and ${LEVEL_GRANT_MAX}.` });
      }
      const blob = await loadBlob(target.id);
      applyLevelGrant(blob, amount);
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `levels x${amount}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'xp') {
      if (!Number.isInteger(amount) || amount < XP_GRANT_MIN || amount > XP_GRANT_MAX) {
        return res
          .status(400)
          .json({ error: `Amount must be an integer between ${XP_GRANT_MIN} and ${XP_GRANT_MAX}.` });
      }
      const blob = await loadBlob(target.id);
      applyXpGrant(blob, amount);
      blob.xp = Math.min(1e15, blob.xp);
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `xp x${amount}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'stars') {
      if (!Number.isInteger(amount) || amount < STAR_GRANT_MIN || amount > STAR_GRANT_MAX) {
        return res
          .status(400)
          .json({ error: `Amount must be an integer between ${STAR_GRANT_MIN} and ${STAR_GRANT_MAX}.` });
      }
      const blob = await loadBlob(target.id);
      blob.stars = Math.min(1e15, Math.max(0, Number(blob.stars) || 0) + amount);
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `stars x${amount}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'gear') {
      if (typeof set !== 'string' || !isValidSetId(set)) {
        return res.status(400).json({ error: 'Set must be one of sovereign, fateweaver, warden, voidwalker, dragonscale, gamemaster.' });
      }
      if (set === 'sovereign' && req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner may grant the sovereign set.' });
      }
      const items = makeGearItems(set);
      const blob = await loadBlob(target.id);
      if (!Array.isArray(blob.inventory)) blob.inventory = [];
      blob.inventory.push(...items);
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `gear set ${set}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'ore') {
      const { ore } = req.body || {};
      if (typeof ore !== 'string' || !ORE_IDS.includes(ore)) {
        return res.status(400).json({ error: `Ore must be one of: ${ORE_IDS.join(', ')}.` });
      }
      if (!Number.isInteger(amount) || amount < ORE_GRANT_MIN || amount > ORE_GRANT_MAX) {
        return res
          .status(400)
          .json({ error: `Amount must be an integer between ${ORE_GRANT_MIN} and ${ORE_GRANT_MAX}.` });
      }
      const blob = await loadBlob(target.id);
      if (!blob.mine || typeof blob.mine !== 'object') blob.mine = { depth: 1, ores: {} };
      if (!blob.mine.ores || typeof blob.mine.ores !== 'object') blob.mine.ores = {};
      blob.mine.ores[ore] = Math.min(1e12, Math.max(0, Math.floor(Number(blob.mine.ores[ore]) || 0)) + amount);
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `ore ${ore} x${amount}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    if (kind === 'pickaxe') {
      const { tier } = req.body || {};
      if (!Number.isInteger(tier) || tier < 0 || tier > 10) {
        return res.status(400).json({ error: 'Tier must be an integer between 0 and 10.' });
      }
      const blob = await loadBlob(target.id);
      if (!blob.mine || typeof blob.mine !== 'object') blob.mine = { depth: 1, ores: {} };
      blob.mine.pickaxe = Math.max(0, Math.min(10, tier));
      await persistMergedState(target.id, blob);
      await logAudit(req, 'grant', target.username, `pickaxe tier ${tier}`);
      return res.json({ ok: true, state: selfState(req, target, blob) });
    }

    return res.status(400).json({ error: 'Kind must be one of "gold", "levels", "xp", "stars", "gear", "ore", "pickaxe".' });
  })
);

// ---------- grant title ----------
router.post(
  '/gm/grant-title',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, titleId } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (typeof titleId !== 'string' || !titleId.trim() || titleId.length > 64) {
      return res
        .status(400)
        .json({ error: 'titleId must be a non-empty string of at most 64 characters.' });
    }
    const blob = await loadBlob(target.id);
    if (!Array.isArray(blob.titlesUnlocked)) blob.titlesUnlocked = [];
    const id = titleId.trim();
    if (!blob.titlesUnlocked.includes(id)) blob.titlesUnlocked.push(id);
    await persistMergedState(target.id, blob);
    await logAudit(req, 'grant-title', target.username, id);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- set badge (gm|owner|admin) ----------
// Grants a creator badge (e.g. 'youtuber') shown next to the name on the
// leaderboard. Pass badge: '' to clear it.
const VALID_BADGES = new Set(['youtuber', 'streamer', 'vip', 'admin', 'mod']);
router.post(
  '/gm/badge',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, badge } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const id = typeof badge === 'string' ? badge.trim().toLowerCase() : '';
    if (id !== '' && !VALID_BADGES.has(id)) {
      return res
        .status(400)
        .json({ error: 'Badge must be one of "youtuber", "streamer", "vip", "admin", "mod" or empty to clear.' });
    }
    const blob = await loadBlob(target.id);
    blob.badge = id === '' ? null : id;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'badge', target.username, id === '' ? 'cleared' : id);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- grant pet eggs (gm|owner|admin) ----------
// Adds unhatched pet eggs to a player's save. Mirrors the client shape in
// public/js/engine.js defaultPets(): { collection, activeUid, eggs, shopEggs }.
const PET_GRANT_MIN = 1;
const PET_GRANT_MAX = 99;
function ensurePets(blob) {
  if (!blob.pets || typeof blob.pets !== 'object' || Array.isArray(blob.pets)) {
    blob.pets = { collection: [], activeUid: null, eggs: 0 };
  }
  const p = blob.pets;
  if (!Array.isArray(p.collection)) p.collection = [];
  if (typeof p.eggs !== 'number' || !Number.isFinite(p.eggs)) p.eggs = 0;
  return p;
}
router.post(
  '/gm/grant-pet',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, amount } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(amount) || amount < PET_GRANT_MIN || amount > PET_GRANT_MAX) {
      return res
        .status(400)
        .json({ error: `Amount must be an integer between ${PET_GRANT_MIN} and ${PET_GRANT_MAX}.` });
    }
    const blob = await loadBlob(target.id);
    const pets = ensurePets(blob);
    pets.eggs = Math.min(9999, Math.max(0, Math.floor(pets.eggs)) + amount);
    await persistMergedState(target.id, blob);
    await logAudit(req, 'grant-pet', target.username, `eggs x${amount}`);
    res.json({ ok: true, eggs: pets.eggs, state: selfState(req, target, blob) });
  })
);

// ---------- set rebirth count (gm|owner|admin) ----------
const REBIRTH_SET_MIN = 0;
const REBIRTH_SET_MAX = 999;
router.post(
  '/gm/set-rebirth',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, count } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(count) || count < REBIRTH_SET_MIN || count > REBIRTH_SET_MAX) {
      return res
        .status(400)
        .json({ error: `Count must be an integer between ${REBIRTH_SET_MIN} and ${REBIRTH_SET_MAX}.` });
    }
    const blob = await loadBlob(target.id);
    blob.rebirthCount = count;
    await persistMergedState(target.id, blob);
    pushStateUpdate(target.id, { rebirthCount: count });
    await logAudit(req, 'set-rebirth', target.username, `count → ${count}`);
    res.json({ ok: true, rebirthCount: count, state: selfState(req, target, blob) });
  })
);

// ---------- infinite gold (owner only) ----------
// Toggles the infGold perk on a player's save: purchases never deduct gold
// and the HUD shows ∞. Survives rebirth. Pass enabled: false to revoke.
router.post(
  '/gm/inf-gold',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { username, enabled } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const blob = await loadBlob(target.id);
    blob.infGold = enabled === true;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'inf-gold', target.username, enabled === true ? 'enabled' : 'revoked');
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- server settings (owner only) ----------
// Owner-tunable tunables. Currently: goldCap (max player gold, default 999Dc).
// The client fetches the live value from GET /api/settings at boot.
router.post(
  '/gm/settings',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { goldCap } = req.body || {};
    if (goldCap !== undefined) {
      if (!Number.isFinite(goldCap) || goldCap < 1e12) {
        return res.status(400).json({ error: 'goldCap must be a number ≥ 1e12 (1T).' });
      }
      await setSetting('gold_cap', String(Math.floor(goldCap)));
    }
    await refreshGoldCap();
    const newCap = await getGoldCap();
    await logAudit(req, 'settings', '—', `goldCap → ${newCap}`);
    res.json({ ok: true, goldCap: newCap });
  })
);

// ---------- maintenance mode (owner + admin) ----------
// Runtime override for GET /api/status. When a maintenance_mode setting is
// present ('1'/'0') it wins over the MAINTENANCE_MODE env var; deleting the
// override is done by turning maintenance off (writes '0').
router.post(
  '/gm/maintenance',
  adminPlus,
  asyncHandler(async (req, res) => {
    const { enabled, message, delayMinutes } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean.' });
    }
    const msg = typeof message === 'string' ? message.trim().slice(0, 500) : '';
    // Scheduled maintenance: warn players first, go live when the countdown ends.
    const delay = Number(delayMinutes);
    if (enabled && Number.isFinite(delay) && delay > 0) {
      const mins = Math.min(Math.max(Math.round(delay), 1), 180); // 1 minute .. 3 hours
      const startsAt = Date.now() + mins * 60000;
      await setSetting('maintenance_mode', '0');
      await setSetting('maintenance_starts_at', String(startsAt));
      await setSetting('maintenance_message', msg);
      await logAudit(req, 'maintenance', '—', `SCHEDULED in ${mins}m: ${msg || 'no message'}`);
      return res.json({ ok: true, maintenance: false, scheduledIn: mins * 60, message: msg || null });
    }
    await setSetting('maintenance_mode', enabled ? '1' : '0');
    await setSetting('maintenance_starts_at', '');
    await setSetting('maintenance_message', msg);
    await logAudit(req, 'maintenance', '—', enabled ? `ON: ${msg || 'no message'}` : 'OFF');
    res.json({ ok: true, maintenance: enabled, message: msg || null });
  })
);

// ---------- pre-update warning (owner + admin) ----------
// Warn players from /staff.html BEFORE a deploy goes out; the client shows
// a banner. The notice is tied to the running commit so it vanishes from
// /api/status on its own once the new commit is live.
router.post(
  '/gm/update-notice',
  adminPlus,
  asyncHandler(async (req, res) => {
    const { message } = req.body || {};
    const msg = typeof message === 'string' ? message.trim().slice(0, 200) : '';
    if (!msg) return res.status(400).json({ error: 'Give the warning a message.' });
    const notice = { message: msg, at: Date.now(), commit: process.env.RENDER_GIT_COMMIT || null };
    await setSetting('update_notice', JSON.stringify(notice));
    await logAudit(req, 'update-notice', '—', `WARN: ${msg}`);
    res.json({ ok: true, notice: { message: notice.message, at: notice.at } });
  })
);

router.delete(
  '/gm/update-notice',
  adminPlus,
  asyncHandler(async (req, res) => {
    await setSetting('update_notice', '');
    await logAudit(req, 'update-notice', '—', 'cleared');
    res.json({ ok: true });
  })
);

// ---------- set stage ----------
router.post(
  '/gm/set-stage',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, stage } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(stage) || stage < 1 || stage > 10000) {
      return res.status(400).json({ error: 'stage must be an integer between 1 and 10000.' });
    }
    const blob = await loadBlob(target.id);
    blob.stage = stage;
    await persistMergedState(target.id, blob);
    const live = pushStateUpdate(target.id, { stage });
    await logAudit(req, 'set-stage', target.username, `stage → ${stage}${live ? ' [LIVE]' : ''}`);
    res.json({ ok: true, live, state: selfState(req, target, blob) });
  })
);

// ---------- set tower floor ----------
router.post(
  '/gm/set-tower',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, floor } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(floor) || floor < 1 || floor > 10000) {
      return res.status(400).json({ error: 'floor must be an integer between 1 and 10000.' });
    }
    const blob = await loadBlob(target.id);
    blob.tower = blob.tower && typeof blob.tower === 'object' ? blob.tower : {};
    blob.tower.floor = floor;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'set-tower', target.username, `tower floor → ${floor}`);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- give gear set (GM) ----------
// Grants a full privileged gear set (sovereign, fateweaver, etc.)
router.post(
  '/gm/give-gear-set',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, setId } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const eng = await serverEngine();
    const sets = eng.PRIVILEGED_SETS || {};
    const set = sets[setId];
    if (!set) return res.status(400).json({ error: 'Unknown set. Available: ' + Object.keys(sets).join(', ') });
    const blob = await loadBlob(target.id);
    if (!Array.isArray(blob.inventory)) blob.inventory = [];
    const granted = [];
    for (const [slot, piece] of Object.entries(set.pieces || {})) {
      const item = {
        id: 'gmset-' + setId + '-' + slot + '-' + Date.now(),
        name: piece.name,
        slot,
        rarity: 'mythic',
        stats: { ...(piece.stats || {}) },
        unsellable: true,
        gmGranted: true,
        setId,
      };
      blob.inventory.push(item);
      granted.push(piece.name);
    }
    await persistMergedState(target.id, blob);
    await logAudit(req, 'give-gear-set', target.username, `${setId} (${granted.length} pieces)`);
    res.json({ ok: true, granted });
  })
);

// ---------- clear bags (GM) ----------
// Removes all unequipped, sellable items from target's inventory.
router.post(
  '/gm/clear-bags',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const blob = await loadBlob(target.id);
    const before = (blob.inventory || []).length;
    blob.inventory = (blob.inventory || []).filter(i =>
      i.unsellable || (blob.equipped && blob.equipped[i.slot] === i.id)
    );
    const cleared = before - blob.inventory.length;
    await persistMergedState(target.id, blob);
    pushStateUpdate(target.id, { inventory: blob.inventory });
    await logAudit(req, 'clear-bags', target.username, `cleared ${cleared} items`);
    res.json({ ok: true, cleared });
  })
);

// ---------- set level (absolute) ----------
// Sets the target's level directly. Hero base stats are recomputed
// deterministically from the per-level formula (level 1 base 10 atk / 100 HP /
// 2 def, +3/+25/+2 per level) because level gains are the only thing that ever
// writes to hero.attack/maxHp/defense. Mastery points are left untouched.
router.post(
  '/gm/set-level',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, level, rebirths } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(level) || level < 1 || level > GM_MAX_LEVEL) {
      return res.status(400).json({ error: `level must be an integer between 1 and ${GM_MAX_LEVEL}.` });
    }
    const blob = await loadBlob(target.id);
    const hero = ensureHero(blob);
    hero.attack = 10 + 3 * (level - 1);
    hero.maxHp = 100 + 25 * (level - 1);
    hero.defense = 2 + 2 * (level - 1);
    blob.level = level;
    blob.xp = 0;
    // Optional rebirth reset (for fixing corrupted rebirth counts)
    if (rebirths !== undefined && Number.isInteger(rebirths) && rebirths >= 0) {
      blob.rebirthCount = rebirths;
    } else {
      blob.rebirthCount = Math.max(0, Math.floor(Number(blob.rebirthCount) || 0));
    }
    blob.xpNext = xpForLevelServer(level, blob.rebirthCount);
    hero.hp = hero.maxHp;
    await persistMergedState(target.id, blob);
    const live = pushStateUpdate(target.id, { level, xp: 0, xpNext: blob.xpNext, hero, rebirthCount: blob.rebirthCount });
    await logAudit(req, 'set-level', target.username, `level → ${level}${live ? ' [LIVE]' : ''}`);
    res.json({ ok: true, live, state: selfState(req, target, blob) });
  })
);

// ---------- set gold (absolute) ----------
// Sets the target's gold to an exact amount (0 clears it). Respects the
// dynamic gold cap unless the target has the infinite-gold perk.
router.post(
  '/gm/set-gold',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, amount } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(amount) || amount < 0) {
      return res.status(400).json({ error: 'amount must be a non-negative integer.' });
    }
    const blob = await loadBlob(target.id);
    const cap = blob.infGold === true ? amount : await getGoldCap();
    if (amount > cap) {
      return res.status(400).json({ error: `amount exceeds the gold cap (${cap}).` });
    }
    blob.gold = amount;
    await persistMergedState(target.id, blob);
    const live = pushStateUpdate(target.id, { gold: amount });
    await logAudit(req, 'set-gold', target.username, `gold → ${amount}${live ? ' [LIVE]' : ''}`);
    res.json({ ok: true, live, state: selfState(req, target, blob) });
  })
);

// ---------- set xp ----------
// Sets the player's EXACT xp then processes level-ups with the normal curve.
router.post(
  '/gm/set-xp',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, amount } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(amount) || amount < 0 || amount > 1e15) {
      return res.status(400).json({ error: 'amount must be an integer between 0 and 1000000000000000.' });
    }
    const blob = await loadBlob(target.id);
    blob.xp = 0;
    blob.level = Math.max(1, Math.floor(Number(blob.level) || 1));
    applyXpGrant(blob, amount);
    blob.xp = Math.min(1e15, blob.xp);
    await persistMergedState(target.id, blob);
    pushStateUpdate(target.id, { xp: blob.xp, level: blob.level, xpNext: blob.xpNext });
    await logAudit(req, 'set-xp', target.username, `xp → ${amount}`);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- grant single item ----------
// Grants one gear piece (by slot) from a set instead of the full 5-piece set.
const GRANT_ITEM_SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'trinket'];
router.post(
  '/gm/grant-item',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, set, slot } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (typeof set !== 'string' || !isValidSetId(set)) {
      return res.status(400).json({ error: 'Set must be one of sovereign, fateweaver, warden, voidwalker, dragonscale, gamemaster.' });
    }
    if (set === 'sovereign' && req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner may grant the sovereign set.' });
    }
    if (typeof slot !== 'string' || !GRANT_ITEM_SLOTS.includes(slot)) {
      return res.status(400).json({ error: 'Slot must be one of weapon, armor, helmet, boots, trinket.' });
    }
    const piece = makeGearItems(set).find((p) => p.slot === slot);
    if (!piece) return res.status(400).json({ error: 'That set has no piece for the requested slot.' });
    const blob = await loadBlob(target.id);
    if (!Array.isArray(blob.inventory)) blob.inventory = [];
    blob.inventory.push(piece);
    await persistMergedState(target.id, blob);
    await logAudit(req, 'grant-item', target.username, `${piece.name} [${slot}]`);
    res.json({ ok: true, item: piece.name, state: selfState(req, target, blob) });
  })
);

// ---------- grant galaxy forge box ----------
// One-click bundle of Galaxy Forge materials (bigger stash: 25 galaxy
// shards + 40 adamant). Single audit entry instead of two ore grants.
const FORGE_BOX = { galaxy: 25, adamant: 40 };
router.post(
  '/gm/grant-forge-box',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const blob = await loadBlob(target.id);
    if (!blob.mine || typeof blob.mine !== 'object') blob.mine = { depth: 1, ores: {} };
    if (!blob.mine.ores || typeof blob.mine.ores !== 'object') blob.mine.ores = {};
    for (const [ore, n] of Object.entries(FORGE_BOX)) {
      blob.mine.ores[ore] = Math.min(1e12, Math.max(0, Math.floor(Number(blob.mine.ores[ore]) || 0)) + n);
    }
    await persistMergedState(target.id, blob);
    await logAudit(req, 'grant-forge-box', target.username, 'galaxy x25 + adamant x40');
    res.json({ ok: true, box: FORGE_BOX, state: selfState(req, target, blob) });
  })
);

// ---------- grant class gear ----------
// Generates a mythic weapon/armor scaled to the target's stage with the
// class-flavored name for the target's own class (same generator as loot).
router.post(
  '/gm/grant-class-gear',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, slot } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (slot !== 'weapon' && slot !== 'armor') {
      return res.status(400).json({ error: 'Slot must be weapon or armor.' });
    }
    const blob = await loadBlob(target.id);
    const eng = await serverEngine();
    const stage = Math.max(1, Math.floor(Number(blob.stage) || 1));
    const item = eng.makeLootItem(stage, 'mythic', slot, blob.playerClass || null);
    if (!Array.isArray(blob.inventory)) blob.inventory = [];
    blob.inventory.push(item);
    await persistMergedState(target.id, blob);
    await logAudit(req, 'grant-class-gear', target.username, `${item.name} [${slot}]`);
    res.json({ ok: true, item: item.name, state: selfState(req, target, blob) });
  })
);

// ---------- mute / unmute ----------
// Timed guild-chat mute. minutes=0 (or omitted) clears the mute.
router.post(
  '/gm/mute',
  ownerAdminGm,
  asyncHandler(async (req, res) => {
    const { username, minutes } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const mins = minutes === undefined || minutes === null ? 0 : minutes;
    if (!Number.isInteger(mins) || mins < 0 || mins > 10080) {
      return res.status(400).json({ error: 'minutes must be an integer between 0 and 10080 (7 days).' });
    }
    const blob = await loadBlob(target.id);
    blob.chatMutedUntil = mins === 0 ? 0 : Date.now() + mins * 60000;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'mute', target.username, mins === 0 ? 'unmuted' : `${mins} min`);
    res.json({ ok: true, mutedUntil: blob.chatMutedUntil, state: selfState(req, target, blob) });
  })
);

// ---------- clear guild chat ----------
// Wipes the message history of the guild the target player belongs to.
// Moderation tool for spam raids; the guild itself is untouched.
router.post(
  '/gm/clear-guild-chat',
  ownerAdminGm,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const member = await pool.query('SELECT guild_id FROM guild_members WHERE username = $1', [target.username]);
    if (!member.rows.length) {
      return res.status(404).json({ error: `${target.username} is not in a guild.` });
    }
    const del = await pool.query('DELETE FROM guild_chat WHERE guild_id = $1', [member.rows[0].guild_id]);
    await logAudit(req, 'clear-guild-chat', target.username, `${del.rowCount} message(s) removed`);
    res.json({ ok: true, removed: del.rowCount });
  })
);

// ---------- name style ----------
// Sets a player's name color / effect directly. The valid effect ids come
// from validation.js (NAME_FX_IDS) — the same allowlist the save sanitizer
// uses, so the console can set anything the game itself accepts.
router.post(
  '/gm/name-style',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, color, fx } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (color !== undefined && color !== '' && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'color must be a hex like #ff8800, or empty to clear.' });
    }
    if (fx !== undefined && !NAME_FX_IDS.has(fx)) {
      return res.status(400).json({ error: 'fx must be a valid name effect id.' });
    }
    const blob = await loadBlob(target.id);
    if (color !== undefined) blob.nameColor = color || null;
    if (fx !== undefined) blob.nameFx = fx;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'name-style', target.username, `${color || 'cleared'} / ${fx || 'unchanged'}`);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- inspect (player dossier) ----------
// Read-only full view of a player's account for GMs: identity, currencies,
// hero, inventory + loadout, pets, mine, forge, titles. Never mutates.
router.post(
  '/gm/inspect',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const blob = await loadBlob(target.id);
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const inv = Array.isArray(blob.inventory) ? blob.inventory : [];
    const loadout = blob.loadout && typeof blob.loadout === 'object' ? blob.loadout : {};
    const equipped = {};
    for (const [slot, it] of Object.entries(loadout)) {
      equipped[slot] = it && it.name ? it.name : String(it);
    }
    const pets = blob.pets && typeof blob.pets === 'object' ? blob.pets : {};
    const mine = blob.mine && typeof blob.mine === 'object' ? blob.mine : {};
    const forge = blob.forge && typeof blob.forge === 'object' ? blob.forge : {};
    const titles = Array.isArray(blob.titles) ? blob.titles : (blob.titles && Array.isArray(blob.titles.unlocked) ? blob.titles.unlocked : []);
    res.json({
      ok: true,
      dossier: {
        username: target.username,
        role: target.role,
        level: num(blob.level), xp: num(blob.xp), xpNext: num(blob.xpNext),
        gold: num(blob.gold), stars: num(blob.stars),
        playerClass: blob.playerClass || '—', spec: blob.spec || '—',
        stage: num(blob.stage), kills: num(blob.kills), bossesKilled: num(blob.bossesKilled),
        rebirthCount: num(blob.rebirthCount),
        hero: {
          hp: num(blob.hero && blob.hero.hp), maxHp: num(blob.hero && blob.hero.maxHp),
          attack: num(blob.hero && blob.hero.attack), defense: num(blob.hero && blob.hero.defense),
        },
        nameStyle: { color: blob.nameColor || null, fx: blob.nameFx || 'none' },
        activeTitle: blob.activeTitle || '—',
        titlesUnlocked: titles.length,
        badge: (blob.badge && (blob.badge.emoji || blob.badge.name)) || '—',
        inventoryCount: inv.length,
        inventorySample: inv.slice(-10).map((i) => (i && i.name ? `${i.name} [${i.slot || '?'}]` : '?')),
        equipped,
        pets: { eggs: num(pets.eggs), active: Array.isArray(pets.active) ? pets.active.length : num(pets.activeCount) },
        mine: { depth: num(mine.depth), pickaxe: mine.pickaxeTier || mine.pickaxe || 0, totalMined: num(mine.totalMined) },
        forge: { crafts: num(forge.crafts) },
        muted: !!(blob.chatMutedUntil && blob.chatMutedUntil > Date.now()),
        mutedUntil: blob.chatMutedUntil || 0,
        banned: !!target.banned,
        buffs: Array.isArray(blob.activeBuffs) ? blob.activeBuffs : [],
        // Presence (live status)
        presence: (() => {
          const now = Date.now();
          const lastActive = Number(target.last_active) || 0;
          const updatedAt = Number(blob.updatedAt) || 0;
          const lastSeen = Math.max(lastActive, updatedAt);
          const online = (now - lastActive < 5 * 60 * 1000) || (now - updatedAt < 2 * 60 * 1000);
          return {
            online,
            lastSeen: lastSeen || 0,
            lastSeenAgo: lastSeen ? Math.floor((now - lastSeen) / 1000) : -1,
          };
        })(),
        // Full stat breakdown
        fullStats: {
          dps: num(blob.hero && blob.hero.attack),
          hp: num(blob.hero && blob.hero.hp),
          maxHp: num(blob.hero && blob.hero.maxHp),
          gold: num(blob.gold),
          stage: num(blob.stage),
          level: num(blob.level),
          xp: num(blob.xp),
          xpNext: num(blob.xpNext),
        },
        // Equipped gear inspector (full item details)
        equippedGear: (() => {
          const eq = blob.equipped && typeof blob.equipped === 'object' ? blob.equipped : {};
          const inv = Array.isArray(blob.inventory) ? blob.inventory : [];
          const result = {};
          for (const [slot, itemId] of Object.entries(eq)) {
            if (!itemId) { result[slot] = null; continue; }
            const item = inv.find(i => i && i.id === itemId);
            result[slot] = item ? {
              id: item.id, name: item.name, rarity: item.rarity,
              stats: item.stats || {}, set: item.set || null, enchant: item.enchant || 0,
            } : { id: itemId, name: '(missing)', stats: {} };
          }
          return result;
        })(),
        // Pet inspector (full collection)
        petInspector: (() => {
          const pets = blob.pets && typeof blob.pets === 'object' ? blob.pets : {};
          const collection = Array.isArray(pets.collection) ? pets.collection : [];
          return {
            activeUid: pets.activeUid || null,
            eggs: num(pets.eggs),
            pets: collection.map(p => ({
              uid: p.uid, species: p.species || '?', level: num(p.level),
              xp: num(p.xp), hunger: num(p.hunger),
            })),
          };
        })(),
      },
    });
  })
);

// ---------- heal ----------
// Note: the death streak is client-side only (public/js/app.js `App.deathStreak`),
// not persisted in the state blob, so there is nothing server-side to reset.
router.post(
  '/gm/heal',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const blob = await loadBlob(target.id);
    if (blob.hero && typeof blob.hero === 'object') {
      const maxHp = Math.max(1, Number(blob.hero.maxHp) || 100);
      blob.hero.maxHp = maxHp;
      blob.hero.hp = maxHp;
    }
    if (Array.isArray(blob.party)) {
      for (const c of blob.party) {
        if (c && typeof c === 'object') {
          const m = Math.max(1, Number(c.maxHp) || 1);
          c.maxHp = m;
          c.hp = m;
        }
      }
    }
    await persistMergedState(target.id, blob);
    pushStateUpdate(target.id, { hero: blob.hero, party: blob.party });
    await logAudit(req, 'heal', target.username, '');
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// ---------- reset progress ----------
// Writes a fresh default blob (same shape as a new registration via
// defaultStateBlob()). Identity (username, role) lives in the users table
// and is untouched; no role changes happen here.
router.post(
  '/gm/reset',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const fresh = defaultStateBlob();
    await persistMergedState(target.id, fresh);
    await logAudit(req, 'reset-progress', target.username, 'save wiped to fresh');
    res.json({ ok: true, state: selfState(req, target, fresh) });
  })
);

// ---------- player management (admin+) ----------
// Unlock a title id for a player (mirrors /gm/grant-title; separate route
// with the admin tier so moderators never touch it).
router.post(
  '/gm/title',
  adminPlus,
  asyncHandler(async (req, res) => {
    const { username, title } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (typeof title !== 'string' || !title.trim() || title.length > 64) {
      return res
        .status(400)
        .json({ error: 'title must be a non-empty string of at most 64 characters.' });
    }
    const blob = await loadBlob(target.id);
    if (!Array.isArray(blob.titlesUnlocked)) blob.titlesUnlocked = [];
    const id = title.trim();
    if (!blob.titlesUnlocked.includes(id)) blob.titlesUnlocked.push(id);
    await persistMergedState(target.id, blob);
    await logAudit(req, 'grant-title', target.username, id);
    res.json({ ok: true, state: selfState(req, target, blob) });
  })
);

// Set a player's stage (mirrors /gm/set-stage on the admin tier).
router.post(
  '/gm/stage',
  adminPlus,
  asyncHandler(async (req, res) => {
    const { username, stage } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!Number.isInteger(stage) || stage < 1 || stage > 10000) {
      return res.status(400).json({ error: 'stage must be an integer between 1 and 10000.' });
    }
    const blob = await loadBlob(target.id);
    blob.stage = stage;
    await persistMergedState(target.id, blob);
    const live = pushStateUpdate(target.id, { stage });
    await logAudit(req, 'set-stage', target.username, `stage → ${stage}${live ? ' [LIVE]' : ''}`);
    res.json({ ok: true, live, state: selfState(req, target, blob) });
  })
);

// ---------- ban / unban (gm+) ----------
// Sets users.banned; requireAuth in auth.js destroys the session and
// rejects further requests, so the ban takes effect immediately even on
// pre-existing sessions. The owner can never be banned.
router.post(
  '/gm/ban',
  ownerAdminGm,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (target.role === 'owner') return res.status(403).json({ error: 'The owner cannot be banned.' });
    await pool.query('UPDATE users SET banned = TRUE WHERE id = $1', [target.id]);
    await logAudit(req, 'ban', target.username, 'account banned');
    res.json({ ok: true, username: target.username, banned: true });
  })
);

router.post(
  '/gm/unban',
  ownerAdminGm,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    await pool.query('UPDATE users SET banned = FALSE WHERE id = $1', [target.id]);
    await logAudit(req, 'unban', target.username, 'account unbanned');
    res.json({ ok: true, username: target.username, banned: false });
  })
);

// ---------- kick (admin+) ----------
// Force-logout a player right now by bumping their session_version; their
// next authenticated request fails the version check in requireAuth and the
// session is destroyed. Unlike a ban, they can sign straight back in.
router.post(
  '/gm/kick',
  ownerAdminGm,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'The owner cannot be kicked.' });
    }
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot kick yourself.' });
    }
    await bumpSessionVersion(target.id);
    await logAudit(req, 'kick', target.username, 'force-logged out');
    res.json({ ok: true, username: target.username, kicked: true });
  })
);

// ---------- reset player save (admin+) ----------
router.post(
  '/gm/reset-player',
  adminPlus,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const fresh = defaultStateBlob();
    await persistMergedState(target.id, fresh);
    await logAudit(req, 'reset-player', target.username, 'save wiped to fresh');
    res.json({ ok: true, state: selfState(req, target, fresh) });
  })
);

// ---------- delete account (owner only) ----------
// Permanently deletes a player account and its data: the users row
// (player_state, party rows/memberships cascade), guild membership, guild
// invites, friendships, and code redemptions. Gift codes the target created
// are kept but detached (created_by → NULL). Blocked when the target owns a
// guild — transfer or disband it first — and never on self or the owner role.
router.post(
  '/gm/delete-account',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'The owner account cannot be deleted.' });
    }
    const owned = await pool.query(
      'SELECT name FROM guilds WHERE LOWER(owner_username) = LOWER($1) LIMIT 1',
      [target.username]
    );
    if (owned.rows.length) {
      return res.status(400).json({
        error: `Target owns guild "${owned.rows[0].name}" — transfer or disband it first.`,
      });
    }
    const uname = target.username;
    await pool.query('DELETE FROM guild_members WHERE LOWER(username) = LOWER($1)', [uname]);
    await pool.query(
      'DELETE FROM guild_invites WHERE LOWER(username) = LOWER($1) OR LOWER(invited_by) = LOWER($1)',
      [uname]
    );
    await pool.query(
      'DELETE FROM friendships WHERE LOWER(requester) = LOWER($1) OR LOWER(addressee) = LOWER($1)',
      [uname]
    );
    await pool.query('DELETE FROM code_redemptions WHERE user_id = $1', [target.id]);
    await pool.query('UPDATE gift_codes SET created_by = NULL WHERE created_by = $1', [target.id]);
    // parties led by the target disband via ON DELETE CASCADE; their
    // party_members rows cascade as well. Their sessions die with the row.
    await pool.query('DELETE FROM users WHERE id = $1', [target.id]);
    await logAudit(req, 'delete-account', uname, 'account permanently deleted');
    res.json({ ok: true, username: uname });
  })
);

// ---------- broadcast (moderators+) ----------
// Server-wide announcement persisted in the broadcasts table (see
// src/broadcast.js). Clients poll GET /api/broadcasts/latest.
router.post(
  '/gm/broadcast',
  requireMod,
  broadcastLimiter,
  asyncHandler(async (req, res) => {
    const { message } = req.body || {};
    if (typeof message !== 'string' || !message.trim() || message.trim().length > 500) {
      return res.status(400).json({ error: 'message must be 1–500 characters.' });
    }
    const row = await addBroadcast(message.trim(), req.user.username);
    await logAudit(req, 'broadcast', '—', message.trim().slice(0, 120));
    res.status(201).json({ ok: true, broadcast: row });
  })
);

// ---------- latest broadcast (public, no auth) ----------
router.get(
  '/broadcasts/latest',
  asyncHandler(async (req, res) => {
    res.json({ broadcast: await latestBroadcast() });
  })
);

// ---------- live broadcast stream (SSE, public) ----------
router.get(
  '/broadcasts/stream',
  optionalAuth,
  (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    // Track by user id if authenticated, else 'anon'
    const userId = (req.user && req.user.id) || 'anon';
    addSseClient(userId, res);
  }
);

// ---------- grant buff (GM, live) ----------
const BUFF_TYPES = {
  damage: 'Damage Boost', shield: 'Protection Shield', immunity: 'Immunity',
  heal: 'Instant Heal', regen: 'Regeneration', speed: 'Attack Speed',
  xp: 'XP Boost', gold: 'Gold Boost',
  priest_shield: 'Power Word: Shield', pally_bubble: 'Divine Shield',
};
router.post(
  '/gm/grant-buff',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, buffType, value, duration } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!BUFF_TYPES[buffType]) {
      return res.status(400).json({ error: 'buffType must be one of: ' + Object.keys(BUFF_TYPES).join(', ') });
    }
    const val = Math.max(0, Number(value) || 0);
    const dur = Math.min(3600, Math.max(5, Math.floor(Number(duration) || 30)));
    const buff = {
      id: 'buff-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: buffType,
      name: BUFF_TYPES[buffType],
      value: val,
      expiresAt: Date.now() + dur * 1000,
      from: req.user.username,
    };
    const blob = await loadBlob(target.id);
    if (!Array.isArray(blob.activeBuffs)) blob.activeBuffs = [];
    // Instant heal applies immediately, no need to store
    if (buffType === 'heal') {
      const hero = ensureHero(blob);
      const amount = val > 0 ? Math.min(val, hero.maxHp - hero.hp) : hero.maxHp - hero.hp;
      hero.hp = Math.min(hero.maxHp, hero.hp + Math.max(0, amount));
    } else {
      // Replace existing buff of same type
      blob.activeBuffs = blob.activeBuffs.filter(b => b.type !== buffType);
      blob.activeBuffs.push(buff);
    }
    await persistMergedState(target.id, blob);
    // Push live to the player if they're online
    const live = pushBuff(target.id, buff);
    await logAudit(req, 'grant-buff', target.username, `${buffType} (${val}, ${dur}s)${live ? ' [LIVE]' : ''}`);
    res.json({ ok: true, buff, live });
  })
);

// ---------- player list (moderators+) ----------
router.get(
  '/gm/players',
  requireMod,
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 20) : '';
    const limit = Math.max(1, Math.min(200, Math.floor(Number(req.query.limit)) || 50));
    const { rows } = await pool.query(
      `SELECT u.username, u.role,
              COALESCE(ps.level, 1) AS level, COALESCE(ps.stage, 1) AS stage,
              ps.state_json AS state_json,
              (ps.updated_at > $3) AS online
       FROM users u LEFT JOIN player_state ps ON ps.user_id = u.id
       WHERE ($1 = '' OR LOWER(u.username) LIKE '%' || LOWER($1) || '%')
       ORDER BY u.created_at ASC
       LIMIT $2`,
      [search, limit, Date.now() - 2 * 60 * 1000]
    );
    // Extract the player's class and spec from their save blob
    // (canonical id sets live in validation.js).
    const players = rows.map((r) => {
      let playerClass = null;
      let spec = null;
      try {
        const raw = r.state_json;
        const blob = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (blob && typeof blob.playerClass === 'string' && VALID_CLASSES.has(blob.playerClass)) {
          playerClass = blob.playerClass;
        }
        if (blob && typeof blob.spec === 'string' && VALID_SPECS.has(blob.spec)) {
          spec = blob.spec;
        }
      } catch { /* leave null */ }
      const { state_json, ...rest } = r;
      return { ...rest, playerClass, spec };
    });
    res.json({ players });
  })
);

// ---------- gift codes ----------
router.get(
  '/gm/codes',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const codes = await listGiftCodes();
    // pg returns BIGINT as string; the contract shape uses epoch-ms numbers.
    res.json({ codes: codes.map((c) => ({ ...c, created_at: Number(c.created_at) })) });
  })
);
router.post(
  '/gm/codes',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { rewardKind = 'gear', set, amount, maxUses } = req.body || {};
    if (!['gear', 'gold', 'stars'].includes(rewardKind)) {
      return res.status(400).json({ error: 'rewardKind must be one of "gear", "gold", "stars".' });
    }
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000000) {
      return res.status(400).json({ error: 'maxUses must be an integer between 1 and 1000000.' });
    }
    let gearSet = 'none';
    let rewardAmount = 0;
    if (rewardKind === 'gear') {
      if (typeof set !== 'string' || !isValidSetId(set)) {
        return res.status(400).json({ error: 'Set must be one of sovereign, fateweaver, warden, voidwalker, dragonscale, gamemaster.' });
      }
      gearSet = set;
    } else if (rewardKind === 'gold') {
      if (!Number.isInteger(amount) || amount < 1 || amount > 1e12) {
        return res.status(400).json({ error: 'Gold amount must be an integer between 1 and 1000000000000.' });
      }
      rewardAmount = amount;
    } else {
      if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
        return res.status(400).json({ error: 'Star amount must be an integer between 1 and 100000.' });
      }
      rewardAmount = amount;
    }
    const code = await generateCode();
    await createGiftCode(code, gearSet, maxUses, req.user.id, rewardKind, rewardAmount);
    await logAudit(req, 'gift-code', '—', `${code}: ${rewardKind}${rewardKind === 'gear' ? ' ' + gearSet : ' x' + rewardAmount} (${maxUses} uses)`);
    res.status(201).json({ code, rewardKind, rewardAmount, set: gearSet });
  })
);

// ---------- admin roster ----------
router.get(
  '/gm/roster',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    res.json({
      admins: await getUsernamesByRole('admin'),
      gms: await getUsernamesByRole('gm'),
    });
  })
);

router.post(
  '/gm/roster',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, action } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });

    if (action === 'add-admin') {
      if (target.role !== 'player') {
        return res.status(400).json({ error: 'Only players can be added to the admin roster.' });
      }
      await setUserRole(target.id, 'admin');
      return res.json({ ok: true });
    }
    if (action === 'remove-admin') {
      if (target.role !== 'admin') {
        return res.status(400).json({ error: 'Target user is not an admin.' });
      }
      await setUserRole(target.id, 'player');
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'Action must be "add-admin" or "remove-admin".' });
  })
);

// ---------- role management (owner only) ----------
router.post(
  '/roles',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { username, role } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!VALID_ROLES_FOR_ROLES_ROUTE.includes(role)) {
      return res.status(400).json({ error: 'Role must be one of gm, admin, moderator, tester, player.' });
    }
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'Owner accounts cannot be changed.' });
    }
    if (target.id === req.user.id) {
      return res.status(403).json({ error: 'You cannot change your own role.' });
    }
    await setUserRole(target.id, role);
    res.json({ ok: true });
  })
);

// ---------- GM audit log ----------
// Server-side record of staff actions (who did what, to whom, when).
// Stored in server_settings as JSON so it survives restarts; capped at 300.
const AUDIT_MAX = 300;
async function readAudit() {
  try {
    const raw = await getSetting('gm_audit');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
async function logAudit(req, action, targetUsername, detail) {
  try {
    const entries = await readAudit();
    const entry = {
      ts: Date.now(),
      actor: (req.user && req.user.username) || '?',
      actorRole: (req.user && req.user.role) || '?',
      action,
      target: targetUsername || '—',
      detail: detail === undefined || detail === null ? '' : String(detail).slice(0, 300),
    };
    entries.unshift(entry);
    await setSetting('gm_audit', JSON.stringify(entries.slice(0, AUDIT_MAX)));
    // Mirror to Discord #mod-logs (fire-and-forget; never blocks the action).
    postModlog(entry);
  } catch (e) { /* audit must never break the action itself */ }
}

// ---------- inventory browser + item removal ----------
// Full inventory listing for a player (the dossier only shows a sample).
router.post(
  '/gm/inventory',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const blob = await loadBlob(target.id);
    const inv = Array.isArray(blob.inventory) ? blob.inventory : [];
    const items = inv.map((it, i) => ({
      index: i,
      id: it && it.id ? String(it.id) : null,
      name: it && it.name ? String(it.name) : '?',
      slot: it && it.slot ? String(it.slot) : '?',
      enchant: Math.max(0, Math.min(10, Math.floor(Number(it && it.enchant) || 0))),
    }));
    res.json({ ok: true, username: target.username, count: items.length, items });
  })
);

// Remove one inventory item by index (e.g. duped/exploited gear).
router.post(
  '/gm/remove-item',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, index } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const blob = await loadBlob(target.id);
    const inv = Array.isArray(blob.inventory) ? blob.inventory : [];
    const idx = Math.floor(Number(index));
    if (!Number.isInteger(idx) || idx < 0 || idx >= inv.length) {
      return res.status(400).json({ error: 'index out of range for this player\'s inventory.' });
    }
    const [removed] = inv.splice(idx, 1);
    const removedName = removed && removed.name ? removed.name : '?';
    await persistMergedState(target.id, blob);
    await logAudit(req, 'remove-item', target.username, `${removedName} (index ${idx})`);
    // Clear equipped slot if this item was equipped
    if (blob.equipped && typeof blob.equipped === 'object') {
      for (const [slot, equippedId] of Object.entries(blob.equipped)) {
        if (equippedId === removed.id) {
          blob.equipped[slot] = null;
        }
      }
    }
    await persistMergedState(target.id, blob);
    res.json({ ok: true, removed: removedName, state: selfState(req, target, blob) });
  })
);

// ---------- mod-item (owner only) ----------
// Override base stats on a weapon/armor/item with custom numbers (no caps).
// Body: { username, itemId OR index, stats: { attack, defense, ... }, name? }
// Valid stat keys: attack, defense, maxHp, critChance, critDamage, parry, dodge,
//                  lifesteal, attackSpeed, regen, goldBonus, xpBonus
const MODDABLE_STATS = ['attack', 'defense', 'maxHp', 'critChance', 'critDamage', 'parry', 'dodge', 'lifesteal', 'attackSpeed', 'regen', 'goldBonus', 'xpBonus'];
router.post(
  '/gm/mod-item',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { username, itemId, index, stats, name } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!stats || typeof stats !== 'object') {
      return res.status(400).json({ error: 'stats object required.' });
    }
    const blob = await loadBlob(target.id);
    const inv = Array.isArray(blob.inventory) ? blob.inventory : [];
    let item = null;
    let idx = -1;
    if (itemId) {
      idx = inv.findIndex(i => i && i.id === itemId);
    } else if (index !== undefined) {
      idx = Math.floor(Number(index));
    }
    if (idx < 0 || idx >= inv.length) {
      return res.status(400).json({ error: 'Item not found (bad itemId or index).' });
    }
    item = inv[idx];
    if (!item.stats || typeof item.stats !== 'object') item.stats = {};
    const applied = {};
    for (const [key, val] of Object.entries(stats)) {
      if (!MODDABLE_STATS.includes(key)) continue;
      const num = Number(val);
      if (!Number.isFinite(num)) continue;
      item.stats[key] = num;
      applied[key] = num;
    }
    if (typeof name === 'string' && name.trim()) {
      item.name = name.trim().slice(0, 60);
    }
    await persistMergedState(target.id, blob);
    await logAudit(req, 'mod-item', target.username, `${item.name} stats: ${JSON.stringify(applied)}`);
    res.json({ ok: true, item: { id: item.id, name: item.name, slot: item.slot, stats: item.stats }, state: selfState(req, target, blob) });
  })
);

// ---------- mod-pet (owner only) ----------
// Modify a pet's level, species, hunger, or xp.
// Body: { username, petUid, level?, species?, hunger?, xp? }
router.post(
  '/gm/mod-pet',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { username, petUid, level, species, hunger, xp } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!petUid) return res.status(400).json({ error: 'petUid required.' });
    const blob = await loadBlob(target.id);
    const pets = blob.pets && typeof blob.pets === 'object' ? blob.pets : {};
    const collection = Array.isArray(pets.collection) ? pets.collection : [];
    const pet = collection.find(p => p && p.uid === petUid);
    if (!pet) return res.status(404).json({ error: 'Pet not found.' });
    const changes = [];
    if (level !== undefined) {
      const lv = Math.floor(Number(level));
      if (Number.isInteger(lv) && lv >= 1 && lv <= 9999) {
        pet.level = lv;
        changes.push(`level=${lv}`);
      }
    }
    if (species && typeof species === 'string') {
      pet.species = species.trim().slice(0, 40);
      changes.push(`species=${pet.species}`);
    }
    if (hunger !== undefined) {
      const h = Math.floor(Number(hunger));
      if (Number.isInteger(h) && h >= 0 && h <= 100) {
        pet.hunger = h;
        changes.push(`hunger=${h}`);
      }
    }
    if (xp !== undefined) {
      const x = Math.floor(Number(xp));
      if (Number.isInteger(x) && x >= 0) {
        pet.xp = x;
        changes.push(`xp=${x}`);
      }
    }
    await persistMergedState(target.id, blob);
    await logAudit(req, 'mod-pet', target.username, `${petUid}: ${changes.join(', ')}`);
    res.json({ ok: true, pet, state: selfState(req, target, blob) });
  })
);

// ---------- remove-pet (owner only) ----------
// Remove a pet from the player's collection by UID.
// Body: { username, petUid }
router.post(
  '/gm/remove-pet',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { username, petUid } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!petUid) return res.status(400).json({ error: 'petUid required.' });
    const blob = await loadBlob(target.id);
    const pets = blob.pets && typeof blob.pets === 'object' ? blob.pets : {};
    const collection = Array.isArray(pets.collection) ? pets.collection : [];
    const idx = collection.findIndex(p => p && p.uid === petUid);
    if (idx < 0) return res.status(404).json({ error: 'Pet not found.' });
    const [removed] = collection.splice(idx, 1);
    // Clear activeUid if this was the active pet
    if (pets.activeUid === petUid) {
      pets.activeUid = null;
    }
    await persistMergedState(target.id, blob);
    await logAudit(req, 'remove-pet', target.username, `${removed.species || '?'} (${petUid})`);
    res.json({ ok: true, removed: removed.species || petUid, state: selfState(req, target, blob) });
  })
);

// ---------- set enchant level ----------
// Sets enchant (0-10) on an inventory item (by index) or an equipped item
// (by slot: weapon/armor/helmet/boots/trinket).
const ENCHANT_SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'trinket'];
router.post(
  '/gm/set-enchant',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, index, slot, level } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const lv = Math.floor(Number(level));
    if (!Number.isInteger(lv) || lv < 0 || lv > 10) {
      return res.status(400).json({ error: 'level must be an integer between 0 and 10.' });
    }
    const blob = await loadBlob(target.id);
    let item = null;
    let where = '';
    if (typeof slot === 'string' && ENCHANT_SLOTS.includes(slot)) {
      if (!blob.loadout || typeof blob.loadout !== 'object' || !blob.loadout[slot]) {
        return res.status(400).json({ error: `No item equipped in the ${slot} slot.` });
      }
      item = blob.loadout[slot];
      where = `equipped ${slot}`;
    } else {
      const inv = Array.isArray(blob.inventory) ? blob.inventory : [];
      const idx = Math.floor(Number(index));
      if (!Number.isInteger(idx) || idx < 0 || idx >= inv.length) {
        return res.status(400).json({ error: 'index out of range for this player\'s inventory.' });
      }
      item = inv[idx];
      where = `inventory index ${idx}`;
    }
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ error: 'No item found at that location.' });
    }
    item.enchant = lv;
    await persistMergedState(target.id, blob);
    await logAudit(req, 'set-enchant', target.username, `${item.name || '?'} (${where}) → +${lv}`);
    res.json({ ok: true, item: item.name || '?', enchant: lv, state: selfState(req, target, blob) });
  })
);

// ---------- reset quests ----------
// Forces a player's daily/weekly quests to re-roll (unsticks broken sets).
router.post(
  '/gm/reset-quests',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { username, period } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const p = period === undefined || period === null ? 'both' : String(period);
    if (!['daily', 'weekly', 'both'].includes(p)) {
      return res.status(400).json({ error: 'period must be one of daily, weekly, both.' });
    }
    const blob = await loadBlob(target.id);
    if (!blob.quests || typeof blob.quests !== 'object') blob.quests = {};
    // Clearing the roll keys makes the client's ensureQuests() re-roll fresh
    // sets on next tick; claimed flags live on the rolled entries, so they
    // reset too.
    if (p === 'daily' || p === 'both') { blob.quests.dailyKey = ''; blob.quests.daily = []; }
    if (p === 'weekly' || p === 'both') { blob.quests.weeklyKey = ''; blob.quests.weekly = []; }
    await persistMergedState(target.id, blob);
    await logAudit(req, 'reset-quests', target.username, p);
    res.json({ ok: true, period: p, state: selfState(req, target, blob) });
  })
);

// ---------- server event buffs ----------
// Server-wide XP/gold multiplier with an expiry (e.g. double-XP weekend).
// The client picks it up from GET /api/settings at boot and applies it to
// kill rewards + offline earnings. Owner + GM tier; every change is audited.
router.post(
  '/gm/event-buff',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const { xpMult, goldMult, dropMult, hours, label } = req.body || {};
    const xm = Number(xpMult);
    const gm = Number(goldMult);
    const dm = dropMult != null ? Number(dropMult) : 1;
    const hrs = Number(hours);
    if (!(xm >= 1 && xm <= 10) || !(gm >= 1 && gm <= 10) || !(dm >= 1 && dm <= 10)) {
      return res.status(400).json({ error: 'xpMult, goldMult and dropMult must each be between 1 and 10.' });
    }
    if (!(hrs >= 0 && hrs <= 168)) {
      return res.status(400).json({ error: 'hours must be between 0 (clear) and 168 (7 days).' });
    }
    if (hrs === 0) {
      await setSetting('event_buff', '');
      await logAudit(req, 'event-buff', '—', 'cleared');
      return res.json({ ok: true, cleared: true });
    }
    const buff = {
      xpMult: xm,
      goldMult: gm,
      dropMult: dm,
      endsAt: Date.now() + Math.floor(hrs * 3600 * 1000),
      label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : 'Event',
      setBy: (req.user && req.user.username) || '?',
    };
    await setSetting('event_buff', JSON.stringify(buff));
    await logAudit(req, 'event-buff', '—', `${buff.label}: ${xm}x XP / ${gm}x gold / ${dm}x drops for ${hrs}h`);
    res.json({ ok: true, buff });
  })
);

router.get(
  '/gm/audit',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const entries = await readAudit();
    res.json({ ok: true, entries: entries.slice(0, 100) });
  })
);

// ---------- Discord #mod-logs webhook ----------
// Staff paste a channel webhook URL; every audit entry is then mirrored to
// Discord as an embed — no bot needed. Reading the (masked) config is open
// to the audit-log tier; changing it is owner/admin only.
router.get(
  '/gm/discord-webhook',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const url = await getWebhookUrl();
    res.json({ ok: true, configured: !!url, masked: maskWebhookUrl(url) });
  })
);

router.post(
  '/gm/discord-webhook',
  adminPlus,
  asyncHandler(async (req, res) => {
    const { url } = req.body || {};
    try {
      const saved = await setWebhookUrl(url);
      if (saved) {
        // Immediate proof it works: a test embed lands in the channel.
        postModlog({
          ts: Date.now(),
          actor: req.user.username,
          actorRole: req.user.role,
          action: 'webhook-test',
          target: '—',
          detail: 'Mod-log webhook connected. Staff actions will appear here.',
        });
      }
      res.json({ ok: true, configured: !!saved, masked: maskWebhookUrl(saved) });
    } catch (err) {
      if (err.code === 'bad-url') return res.status(400).json({ error: err.message });
      throw err;
    }
  })
);

router.delete(
  '/gm/discord-webhook',
  adminPlus,
  asyncHandler(async (req, res) => {
    await setWebhookUrl('');
    res.json({ ok: true, configured: false });
  })
);

// ---------- Discord #bug-reports + #feedback + #patch-notes webhooks ----------
// Same pattern as the mod-log webhook: player bug reports and feedback are
// mirrored to their own channels, and staff can push the latest patch notes
// to #patch-notes. sendTest(username) posts the "webhook connected" proof
// embed for that channel.
function registerPlayerWebhook(path, getUrl, setUrl, sendTest) {
  router.get(
    path,
    gmOrOwner,
    asyncHandler(async (req, res) => {
      const url = await getUrl();
      res.json({ ok: true, configured: !!url, masked: maskWebhookUrl(url) });
    })
  );
  router.post(
    path,
    adminPlus,
    asyncHandler(async (req, res) => {
      const { url } = req.body || {};
      try {
        const saved = await setUrl(url);
        if (saved) sendTest(req.user.username);
        res.json({ ok: true, configured: !!saved, masked: maskWebhookUrl(saved) });
      } catch (err) {
        if (err.code === 'bad-url') return res.status(400).json({ error: err.message });
        throw err;
      }
    })
  );
  router.delete(
    path,
    adminPlus,
    asyncHandler(async (req, res) => {
      await setUrl('');
      res.json({ ok: true, configured: false });
    })
  );
}
registerPlayerWebhook('/gm/discord-bug-webhook', getBugWebhookUrl, setBugWebhookUrl,
  (u) => postReport({ kind: 'bug', id: 0, username: u, title: 'Webhook connected', body: 'New player bug reports will appear here.' }));
registerPlayerWebhook('/gm/discord-feedback-webhook', getFeedbackWebhookUrl, setFeedbackWebhookUrl,
  (u) => postReport({ kind: 'feedback', id: 0, username: u, title: 'Webhook connected', body: 'New player feedback will appear here.' }));
registerPlayerWebhook('/gm/discord-patchnotes-webhook', getPatchnotesWebhookUrl, setPatchnotesWebhookUrl,
  () => postPatchNotes({ date: new Date().toISOString().slice(0, 10), title: 'Webhook connected', changes: ['Patch notes pushed from the staff page will appear here.'] }));
registerPlayerWebhook('/gm/discord-balance-webhook', getBalanceWebhookUrl, setBalanceWebhookUrl,
  () => postBalanceLog({ version: 'test', date: new Date().toISOString().slice(0, 10), title: 'Webhook connected', changes: [{ system: 'Balance log', before: '—', after: 'Balance changes pushed from the staff page will appear here.' }] }));

// Push the latest changelog entry to #patch-notes. Manual on purpose:
// patch notes are written by staff, so there is nothing automatic to hook.
// The entry is player-filtered first — #patch-notes is a public channel,
// so staff-flagged items must never leak there.
const CHANGELOG_PATH = path.join(__dirname, '..', 'public', 'changelog.json');
router.post(
  '/gm/push-patch-notes',
  adminPlus,
  asyncHandler(async (req, res) => {
    const url = await getPatchnotesWebhookUrl();
    if (!url) return res.status(400).json({ error: 'Patch-notes webhook is not connected yet.' });
    let log = [];
    try {
      const raw = JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
      if (Array.isArray(raw)) log = raw;
    } catch { /* serve empty on read/parse failure */ }
    const latest = filterChangelog(log, false)[0];
    if (!latest || !latest.changes || !latest.changes.length) {
      return res.status(400).json({ error: 'No patch notes to push.' });
    }
    postPatchNotes(latest);
    res.json({ ok: true, title: latest.title, date: latest.date });
  })
);

// Push the latest balance-log entry to #balance-log. Manual on purpose:
// the balance log is a static JSON file edited by staff, so there is no
// runtime event to hook.
const BALANCE_LOG_PATH = path.join(__dirname, '..', 'public', 'data', 'balance-log.json');
router.post(
  '/gm/push-balance-log',
  adminPlus,
  asyncHandler(async (req, res) => {
    const url = await getBalanceWebhookUrl();
    if (!url) return res.status(400).json({ error: 'Balance-log webhook is not connected yet.' });
    let log = [];
    try {
      const raw = JSON.parse(fs.readFileSync(BALANCE_LOG_PATH, 'utf8'));
      if (Array.isArray(raw)) log = raw;
    } catch { /* serve empty on read/parse failure */ }
    const latest = log[0];
    if (!latest || !Array.isArray(latest.changes) || !latest.changes.length) {
      return res.status(400).json({ error: 'No balance changes to push.' });
    }
    postBalanceLog(latest);
    res.json({ ok: true, title: latest.title, version: latest.version });
  })
);

// ---------- player bug reports + feedback ----------
// POST /api/report (any signed-in player) — file a bug report or feedback.
// Reviewed by owner/admin on /staff.html.
const REPORT_KINDS = ['bug', 'feedback'];
const REPORT_STATUSES = ['new', 'reviewing', 'fixed', 'closed'];
const IDEA_STATUSES = ['open', 'planned', 'done', 'dropped'];

function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

router.post(
  '/report',
  requireAuth,
  reportLimiter,
  asyncHandler(async (req, res) => {
    const { kind, title, body } = req.body || {};
    if (!REPORT_KINDS.includes(kind)) {
      return res.status(400).json({ error: "kind must be 'bug' or 'feedback'." });
    }
    const t = cleanText(title, 120);
    const b = cleanText(body, 2000);
    if (!t) return res.status(400).json({ error: 'Give your report a title.' });
    if (!b) return res.status(400).json({ error: 'Describe the issue or feedback.' });
    const now = Date.now();
    const r = await pool.query(
      `INSERT INTO reports (user_id, username, kind, title, body, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'new', $6, $6) RETURNING id, created_at`,
      [req.user.id, req.user.username, kind, t, b, now]
    );
    // Mirror to Discord (#bug-reports or #feedback) — fire-and-forget; a dead
    // webhook never breaks the player's submission.
    postReport({ kind, id: r.rows[0].id, username: req.user.username, title: t, body: b });
    res.status(201).json({ ok: true, id: r.rows[0].id, created_at: r.rows[0].created_at });
  })
);

// A player's own reports, so /report.html can show status + timestamps.
router.get(
  '/report/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT id, kind, title, body, status, created_at, updated_at
       FROM reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ ok: true, reports: r.rows });
  })
);

// ---------- staff: report inbox (owner|admin) ----------
router.get(
  '/gm/reports',
  adminPlus,
  asyncHandler(async (req, res) => {
    const { kind, status } = req.query || {};
    const conds = [];
    const params = [];
    if (REPORT_KINDS.includes(kind)) {
      params.push(kind);
      conds.push(`kind = $${params.length}`);
    }
    if (REPORT_STATUSES.includes(status)) {
      params.push(status);
      conds.push(`status = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT id, username, kind, title, body, status, created_at, updated_at
       FROM reports ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json({ ok: true, reports: r.rows });
  })
);

router.patch(
  '/gm/reports/:id',
  adminPlus,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Bad report id.' });
    }
    const { status } = req.body || {};
    if (!REPORT_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Bad status.' });
    }
    const now = Date.now();
    const r = await pool.query(
      `UPDATE reports SET status = $1, updated_at = $2 WHERE id = $3
       RETURNING id, username, kind, title, body, status, created_at, updated_at`,
      [status, now, id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Report not found.' });
    await logAudit(req, 'report-status', r.rows[0].username, `#${id} → ${status}`);
    res.json({ ok: true, report: r.rows[0] });
  })
);

// ---------- staff: idea board (owner|admin) ----------
router.get(
  '/gm/ideas',
  adminPlus,
  asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT id, username, title, body, status, created_at, updated_at
       FROM ideas ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ ok: true, ideas: r.rows });
  })
);

router.post(
  '/gm/ideas',
  adminPlus,
  asyncHandler(async (req, res) => {
    const t = cleanText((req.body || {}).title, 120);
    const b = cleanText((req.body || {}).body, 2000);
    if (!t) return res.status(400).json({ error: 'Give the idea a title.' });
    const now = Date.now();
    const r = await pool.query(
      `INSERT INTO ideas (user_id, username, title, body, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'open', $5, $5)
       RETURNING id, username, title, body, status, created_at, updated_at`,
      [req.user.id, req.user.username, t, b, now]
    );
    res.status(201).json({ ok: true, idea: r.rows[0] });
  })
);

router.patch(
  '/gm/ideas/:id',
  adminPlus,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Bad idea id.' });
    }
    const { status, title, body } = req.body || {};
    const sets = [];
    const params = [];
    if (status !== undefined) {
      if (!IDEA_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Bad status.' });
      }
      params.push(status);
      sets.push(`status = $${params.length}`);
    }
    if (title !== undefined) {
      const t = cleanText(title, 120);
      if (!t) return res.status(400).json({ error: 'Title cannot be empty.' });
      params.push(t);
      sets.push(`title = $${params.length}`);
    }
    if (body !== undefined) {
      params.push(cleanText(body, 2000));
      sets.push(`body = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    params.push(Date.now());
    sets.push(`updated_at = $${params.length}`);
    params.push(id);
    const r = await pool.query(
      `UPDATE ideas SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, username, title, body, status, created_at, updated_at`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Idea not found.' });
    res.json({ ok: true, idea: r.rows[0] });
  })
);

router.delete(
  '/gm/ideas/:id',
  adminPlus,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Bad idea id.' });
    }
    const r = await pool.query('DELETE FROM ideas WHERE id = $1 RETURNING id', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Idea not found.' });
    res.json({ ok: true, id });
  })
);


// ---------- staff: admin chat (owner|admin) ----------
// Private staff channel on /staff.html. Normal players have no route to it:
// every endpoint below requires the owner|admin role.
const adminChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => (req.user && req.user.id ? `u:${req.user.id}` : req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Chatting too fast. Slow down a moment.' },
});

router.get(
  '/gm/admin-chat',
  adminPlus,
  asyncHandler(async (req, res) => {
    const after = Math.max(0, Math.floor(Number((req.query && req.query.after) || 0)));
    res.json({ ok: true, messages: await getAdminChat(after) });
  })
);

router.post(
  '/gm/admin-chat',
  adminPlus,
  adminChatLimiter,
  asyncHandler(async (req, res) => {
    const raw = cleanText(req.body && req.body.message, 500);
    if (!raw) return res.status(400).json({ error: 'Message is empty.' });
    const msg = await addAdminChat(req.user.username, raw);
    res.json({ ok: true, message: { id: msg.id, username: req.user.username, message: raw, created_at: msg.created_at } });
  })
);

router.delete(
  '/gm/admin-chat/:id',
  adminPlus,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Bad message id.' });
    }
    const ok = await deleteAdminChat(id);
    if (!ok) return res.status(404).json({ error: 'Message not found.' });
    res.json({ ok: true, id });
  })
);

// ---------- live player roster (owner/GM) ----------
// Lists all players with online/offline status, last seen, and basic stats.
// Used by the GM panel's live roster view.
const ROSTER_ONLINE_MS = 5 * 60 * 1000;
router.get(
  '/gm/roster-live',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT u.username, u.role, u.last_active as "lastSeen", ps.level, ps.stage, ps.state_json
       FROM users u LEFT JOIN player_state ps ON ps.user_id = u.id
       ORDER BY u.last_active DESC NULLS LAST LIMIT 100`
    );
    const rows = result.rows;
    const now = Date.now();
    const players = rows.map((r) => {
      let gold = 0, playTime = 0, towerFloor = 0, bosses = 0;
      try {
        const blob = typeof r.state_json === 'string' ? JSON.parse(r.state_json) : r.state_json;
        if (blob) {
          gold = Math.floor(Number(blob.gold) || 0);
          playTime = Math.floor(Number(blob.stats && blob.stats.playTimeSec) || 0);
          towerFloor = Math.floor(Number(blob.tower && blob.tower.floor) || 0);
          bosses = Math.floor(Number(blob.bossesKilled) || 0);
        }
      } catch {}
      return {
        username: r.username,
        role: r.role || 'player',
        level: r.level || 1,
        stage: r.stage || 1,
        gold, playTime, towerFloor, bosses,
        online: now - Number(r.lastSeen || 0) < ROSTER_ONLINE_MS,
        lastSeen: Number(r.lastSeen || 0),
      };
    });
    res.json({ ok: true, players });
  })
);

// ---------- gameplay snapshots (owner/GM live view) ----------
// In-memory store of recent gameplay activity per player.
// Client POSTs snapshots; GM panel GETs them for the live view.
const gameplaySnapshots = new Map(); // username -> {action, detail, ts}
router.post(
  '/gm/snapshot',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Auth required.' });
    const { action, detail } = req.body || {};
    gameplaySnapshots.set(req.user.username, {
      action: String(action || 'idle').slice(0, 50),
      detail: String(detail || '').slice(0, 200),
      ts: Date.now(),
    });
    // Keep it bounded
    if (gameplaySnapshots.size > 200) {
      const oldest = [...gameplaySnapshots.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      gameplaySnapshots.delete(oldest[0]);
    }
    res.json({ ok: true });
  })
);

router.get(
  '/gm/snapshots',
  gmOrOwner,
  asyncHandler(async (req, res) => {
    const out = {};
    for (const [user, snap] of gameplaySnapshots.entries()) {
      // Only include recent snapshots (last 2 min)
      if (Date.now() - snap.ts < 120000) out[user] = snap;
    }
    res.json({ ok: true, snapshots: out });
  })
);

// ---------- Player admin commands ----------
// Owner queues a command for a target player; the client polls and executes.
// Commands: close-gui, freeze-input (toggle), admin-notice
const playerCommands = new Map(); // username -> [{cmd, data, ts}]
router.post(
  '/gm/player-command',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { username, cmd, data } = req.body || {};
    if (!username || !cmd) return res.status(400).json({ error: 'username and cmd required.' });
    if (!['close-gui', 'freeze-input', 'admin-notice'].includes(cmd)) {
      return res.status(400).json({ error: 'Unknown command.' });
    }
    const queue = playerCommands.get(username) || [];
    queue.push({ cmd, data: data || {}, ts: Date.now() });
    playerCommands.set(username, queue.slice(-10)); // keep last 10
    await logAudit(req, 'player-command', username, `${cmd}${data && data.msg ? ': ' + String(data.msg).slice(0, 80) : ''}`);
    res.json({ ok: true });
  })
);

// Player polls for pending admin commands (authenticated players only).
router.get(
  '/player-commands',
  requireAuth,
  asyncHandler(async (req, res) => {
    const queue = playerCommands.get(req.user.username) || [];
    playerCommands.delete(req.user.username);
    res.json({ ok: true, commands: queue });
  })
);

// ---------- Chat spy ----------
// Recent guild chat messages across all guilds (owner only).
router.get(
  '/gm/chat-spy',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT gc.username, gc.message, gc.created_at, g.name as guild_name
       FROM guild_chat gc LEFT JOIN guilds g ON g.id = gc.guild_id
       ORDER BY gc.created_at DESC LIMIT 50`
    );
    res.json({ ok: true, messages: rows.reverse() });
  })
);

// ---------- OP gear creator (owner only) ----------
// Creates a custom overpowered item with arbitrary stats and grants it
// directly to the target player's inventory.
router.post(
  '/gm/create-op-gear',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { username, name, slot, rarity, stats } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    if (!name || typeof name !== 'string' || name.length > 60) {
      return res.status(400).json({ error: 'Name required (max 60 chars).' });
    }
    const validSlots = ['weapon', 'armor', 'helmet', 'boots', 'trinket'];
    if (!validSlots.includes(slot)) {
      return res.status(400).json({ error: 'Slot must be one of: ' + validSlots.join(', ') });
    }
    const blob = await loadBlob(target.id);
    const inv = blob.inventory || [];
    const item = {
      id: 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      name: String(name).slice(0, 60),
      slot,
      rarity: rarity || 'mythic',
      stats: {},
      opCreated: true,
      createdBy: req.user.username,
      createdAt: Date.now(),
    };
    // Copy numeric stats (no upper bound — this is OP gear)
    if (stats && typeof stats === 'object') {
      for (const [k, v] of Object.entries(stats)) {
        const num = Number(v);
        if (Number.isFinite(num) && num !== 0) item.stats[k] = num;
      }
    }
    if (!Object.keys(item.stats).length) {
      return res.status(400).json({ error: 'Provide at least one stat.' });
    }
    inv.push(item);
    blob.inventory = inv;
    await persistMergedState(target.id, blob);
    const live = pushStateUpdate(target.id, { inventory: blob.inventory });
    await logAudit(req, 'create-op-gear', target.username, `${name} (${slot})${live ? ' [LIVE]' : ''}`);
    res.json({ ok: true, live, item });
  })
);

// ---------- stage reset (stat-fix) ----------
// Backs up ALL player blobs, then resets every player's stage to 1.
// Owner only. One-time use for the Oct 2026 pet-stat fix.
router.post(
  '/gm/reset-all-stages',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { confirm } = req.body || {};
    if (confirm !== 'RESET-TO-STAGE-1') {
      return res.status(400).json({ error: 'Confirmation required.' });
    }
    // Backup all player blobs first
    const { rows } = await pool.query(
      `SELECT u.id, u.username, ps.state_json
       FROM player_state ps JOIN users u ON u.id = ps.user_id`
    );
    let backedUp = 0;
    for (const r of rows) {
      await pool.query(
        `INSERT INTO stage_reset_backup (user_id, username, state_json)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET username = $2, state_json = $3, backed_up_at = now()`,
        [r.id, r.username, r.state_json]
      );
      backedUp++;
    }
    // Reset all stages to 1
    let reset = 0;
    for (const r of rows) {
      const blob = typeof r.state_json === 'string' ? JSON.parse(r.state_json) : r.state_json;
      blob.stage = 1;
      await persistMergedState(r.id, blob);
      // Live-push to online players
      pushStateUpdate(r.id, { stage: 1 });
      reset++;
    }
    await logAudit(req, 'reset-all-stages', 'ALL', `backed up ${backedUp}, reset ${reset} to stage 1`);
    res.json({ ok: true, backedUp, reset });
  })
);

// ---------- restore player from pre-reset backup ----------
// Owner only. Restores a single player's pre-reset blob.
router.post(
  '/gm/restore-player',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    const target = await resolveTarget(username);
    if (!target) return res.status(404).json({ error: 'Target user not found.' });
    const { rows } = await pool.query(
      'SELECT state_json FROM stage_reset_backup WHERE user_id = $1',
      [target.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No backup found for this player.' });
    const blob = typeof rows[0].state_json === 'string' ? JSON.parse(rows[0].state_json) : rows[0].state_json;
    await persistMergedState(target.id, blob);
    // Live-push full state to the player if online
    const live = pushStateUpdate(target.id, blob);
    await logAudit(req, 'restore-player', target.username, `restored pre-reset backup${live ? ' [LIVE]' : ''}`);
    res.json({ ok: true, live });
  })
);

// ---------- list reset backups ----------
router.get(
  '/gm/reset-backups',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT username, backed_up_at FROM stage_reset_backup ORDER BY username'
    );
    res.json({ ok: true, backups: rows });
  })
);

module.exports = { gmRouter: router };
