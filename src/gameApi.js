'use strict';

/**
 * Player-facing game API:
 *   GET  /api/state        (auth)
 *   POST /api/state        (auth)
 *   GET  /api/leaderboard  (public)
 *   GET  /api/status       (public — maintenance flag + message)
 *   GET  /api/changelog    (public — staff-only items stripped for players)
 *   GET  /api/settings     (public — tunables: goldCap)
 *   GET  /api/realm-network (public — aggregate active-player counts per region)
 *   POST /api/redeem       (auth)
 *
 * Gift-code redemption runs inside a single Postgres transaction with
 * SELECT ... FOR UPDATE on the gift_codes row, so concurrent redemptions
 * serialize and cannot double-spend a code's uses.
 */

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, asyncHandler } = require('./auth');
const { sanitizeStateBlob, validateUsername, VALID_CLASSES, VALID_SPECS } = require('./validation');
const { makeGearItems, isValidSetId } = require('./gearSets');
const {
  getStateRow,
  getUserById,
  getUserByUsername,
  saveState,
  getLeaderboardRows,
  getGuildRankings,
  getRealmNetworkCounts,
  redeemGiftCode,
  createGuild,
  getGuildByName,
  getMyGuild,
  addGuildNews,
  getGuildRoster,
  nameStyleOf,
  joinGuild,
  leaveGuild,
  getGoldCap,
  getSetting,
  pool,
  // guild rework
  GUILD_RANKS,
  guildPerks,
  xpForGuildLevel,
  setMemberRank,
  kickGuildMember,
  setGuildMotd,
  setGuildDescription,
  unlockGuildBanner,
  setGuildBanner,
  getUnlockedBanners,
  addGuildChat,
  getGuildChat,
  deleteGuildChat,
  getGuildNews,
  getGuildChallenges,
  recordMemberActivity,
  buyVendorItem,
  GUILD_VENDOR,
  getGuildPerksFor,
  inviteToGuild,
  getMyInvites,
  acceptGuildInvite,
  declineGuildInvite,
  // multiplayer parties
  createParty,
  joinPartyByCode,
  leaveParty,
  kickPartyMember,
  disbandParty,
  promotePartyLeader,
  getPartyView,
  syncPartyNpcs,
  // friends / presence
  sendFriendRequest,
  respondFriendRequest,
  getFriendshipData,
  getFriendProfiles,
  removeFriend,
  friendshipStatus,
} = require('./db');

const router = express.Router();

// Singular aliases: the guild rework spec requests /api/guild/* routes.
// The codebase convention is /api/guilds/*; rewrite the singular form to
// the plural form before route matching so both work identically.
router.use((req, res, next) => {
  if (req.url === '/guild' || req.url.startsWith('/guild/') || req.url.startsWith('/guild?')) {
    req.url = req.url.replace(/^\/guild(?=\/|\?|$)/, '/guilds');
  }
  next();
});

// Per-user flood protection (keyed on user id so one bad actor can't
// exhaust a shared IP budget, e.g. behind NAT). Applied after requireAuth
// so req.user is populated for the key generator.
const userKey = (req) => (req.user && req.user.id ? `u:${req.user.id}` : req.ip);
// Autosave runs every 15s; 30/min is generous for real play and stops
// tight-loop DB write floods.
const saveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Saving too fast. Slow down a moment.' },
});
// Gift-code guessing protection.
const redeemLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many code attempts. Try again in a minute.' },
});
// Friend-action spam protection.
const friendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many friend actions. Slow down a moment.' },
});

// Chat flood protection: 20 messages/min per user.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Chatting too fast. Slow down a moment.' },
});

/**
 * Server-side copy of the client game engine (public/js/engine.js is pure
 * logic with no DOM access). Loaded once as an .mjs module so inspect and
 * compare power ratings use the exact same computeStats formula as the client.
 */
let _enginePromise = null;
function serverEngine() {
  if (!_enginePromise) {
    _enginePromise = (async () => {
      const src = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'engine.js'),
        'utf8'
      );
      const tmp = path.join(os.tmpdir(), 'tos-engine-srv.mjs');
      fs.writeFileSync(tmp, src);
      return import(tmp);
    })();
  }
  return _enginePromise;
}

/** Considered "online" for friends/inspect if active within the last 5 minutes. */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

const INSPECT_SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'trinket'];

function num0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function num1(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

/**
 * Build the public inspect payload for a username. Gameplay data only:
 * never emails, password hashes, roles, currencies, or staff flags.
 * Returns null when the player does not exist.
 */
async function buildInspect(targetUsername, viewerUsername) {
  const user = await getUserByUsername(targetUsername);
  if (!user) return null;
  const row = await getStateRow(user.id);
  const blob = row ? parseBlob(row.state_json) : defaultStateBlob();
  // Defensive merge so computeStats never sees a half-shaped blob.
  const def = defaultStateBlob();
  const safe = {
    ...def,
    ...blob,
    hero: { ...def.hero, ...(blob.hero || {}) },
    stats: { ...(blob.stats || {}) },
    raid: { ...(blob.raid || {}) },
    pets: { ...(blob.pets || {}) },
  };

  const eng = await serverEngine();
  let power = 0;
  let stats = null;
  try {
    const cs = eng.computeStats(safe);
    power = num0(cs.attack);
    stats = {
      attack: num0(cs.attack),
      defense: num0(cs.defense),
      maxHp: num0(cs.maxHp),
      critChance: num1(cs.critChance),
      critDamage: num1(cs.critDamage),
      parry: num1(cs.parry),
      dodge: num1(cs.dodge),
      lifesteal: num1(cs.lifesteal),
      attackSpeed: num1(cs.attackSpeed),
      regen: num1(cs.regen),
      goldBonus: num1(cs.goldBonus),
      xpBonus: num1(cs.xpBonus),
    };
  } catch {
    stats = {
      attack: 0, defense: 0, maxHp: 1, critChance: 0, critDamage: 100,
      parry: 0, dodge: 0, lifesteal: 0, attackSpeed: 1, regen: 0,
      goldBonus: 0, xpBonus: 0,
    };
  }

  const raceDef = eng.RACES[blob.race] || {};
  const clsDef = eng.CLASSES[blob.playerClass] || {};
  const specDef = eng.SPECS[blob.spec] || {};
  const titleId = typeof blob.activeTitle === 'string' ? blob.activeTitle : null;
  const nameStyle = nameStyleOf(blob);

  // Equipped gear: item cards only (name, rarity, enchant, stats).
  const inv = Array.isArray(blob.inventory) ? blob.inventory : [];
  const gear = INSPECT_SLOTS.map((slot) => {
    const id = blob.equipped && blob.equipped[slot];
    const item = id ? inv.find((i) => i && i.id === id) : null;
    if (!item) return { slot, item: null };
    const itemStats = {};
    if (item.stats && typeof item.stats === 'object') {
      for (const [k, v] of Object.entries(item.stats)) {
        if (Number.isFinite(v)) itemStats[k] = Math.round(v * 100) / 100;
      }
    }
    return {
      slot,
      item: {
        name: String(item.name || 'Unknown item'),
        rarity: String(item.rarity || 'common'),
        enchant: Math.max(0, Math.floor(Number(item.enchant) || 0)),
        stats: itemStats,
      },
    };
  });

  // Active pets only.
  const pets = [];
  const coll = Array.isArray(safe.pets.collection) ? safe.pets.collection : [];
  const activeUids = new Set(
    [safe.pets.activeUid, safe.pets.secondActiveUid].filter((u) => typeof u === 'string' && u)
  );
  for (const p of coll) {
    if (!p || !activeUids.has(p.uid)) continue;
    const sp = (eng.PET_SPECIES && eng.PET_SPECIES[p.species]) || {};
    pets.push({
      name: sp.name || 'Pet',
      emoji: sp.emoji || '🐾',
      level: Math.max(1, Math.floor(Number(p.level) || 1)),
      rarity: sp.rarity || 'common',
    });
  }

  const guildRow = await getMyGuild(user.username);
  const lastActive = Number(user.last_active) || 0;

  let relation = 'none';
  if (viewerUsername) {
    try {
      relation = await friendshipStatus(viewerUsername, user.username);
    } catch { /* leave 'none' */ }
  }

  return {
    username: user.username,
    nameColor: nameStyle.nameColor,
    nameFx: nameStyle.nameFx,
    level: row ? row.level : 1,
    stage: row ? row.stage : 1,
    race: { id: blob.race || null, name: raceDef.name || null, emoji: raceDef.emoji || null },
    playerClass: { id: blob.playerClass || null, name: clsDef.name || null, emoji: clsDef.emoji || null },
    spec: { id: blob.spec || null, name: specDef.name || null, emoji: specDef.emoji || null },
    title: titleId ? eng.titleName(titleId) : null,
    titleId,
    badge: typeof blob.badge === 'string' ? blob.badge : null,
    country: typeof blob.country === 'string' ? blob.country : null,
    power,
    bestRaidWave: Math.max(0, Math.floor(Number((blob.raid && blob.raid.best) || 0))),
    kills: Math.max(0, Math.floor(Number((blob.stats && blob.stats.kills) || 0))),
    bossesKilled: row ? row.bosses_killed : 0,
    rebirthCount: row ? row.rebirth_count : 0,
    guild: guildRow ? { name: guildRow.name, tag: guildRow.tag } : null,
    gear,
    stats,
    pets,
    online: Date.now() - lastActive < ONLINE_WINDOW_MS,
    lastActive,
    relation,
  };
}

// ---------- server status ----------
// Public. Lets the client show a proper maintenance screen instead of
// cryptic errors. Toggle with env vars (Render → Environment):
//   MAINTENANCE_MODE=1            → maintenance screen on
//   MAINTENANCE_MESSAGE="..."     → optional custom message
// The owner can override both at runtime from the GM console (server
// settings maintenance_mode / maintenance_message); a present override
// ('1' or '0') wins over the env vars.
router.get('/status', asyncHandler(async (req, res) => {
  const override = await getSetting('maintenance_mode');
  let maintenance;
  let message;
  // Scheduled maintenance: set from /maintenance.html ("in N minutes").
  // While the start time is in the future the server reports maintenanceIn
  // (seconds); once it passes, maintenance flips live on its own.
  const startsAt = Number(await getSetting('maintenance_starts_at') || 0) || 0;
  const nowMs = Date.now();
  let maintenanceIn = null;
  if (override === '1' || override === '0') {
    maintenance = override === '1';
    const msg = await getSetting('maintenance_message');
    message = (typeof msg === 'string' && msg.trim())
      ? msg
      : (process.env.MAINTENANCE_MESSAGE || null);
    if (!maintenance && startsAt > nowMs) {
      maintenanceIn = Math.ceil((startsAt - nowMs) / 1000);
    } else if (!maintenance && startsAt && startsAt <= nowMs) {
      maintenance = true; // scheduled window arrived
    }
  } else {
    maintenance = /^(1|true|yes)$/i.test(String(process.env.MAINTENANCE_MODE || ''));
    message = process.env.MAINTENANCE_MESSAGE || null;
  }
  // Pre-update warning set from /staff.html. Tied to the commit that was
  // live when it was set, so it drops out of the response on its own once
  // the warned-about deploy lands.
  let updateNotice = null;
  try {
    const raw = await getSetting('update_notice');
    if (raw) {
      const n = JSON.parse(raw);
      if (n && n.message && (n.commit || null) === (process.env.RENDER_GIT_COMMIT || null)) {
        updateNotice = { message: String(n.message).slice(0, 200), at: n.at || 0 };
      }
    }
  } catch { /* a malformed notice must never break /api/status */ }
  res.json({
    ok: true,
    maintenance,
    message,
    // Seconds until a scheduled maintenance window goes live (null when none).
    maintenanceIn,
    updateNotice,
    // Deploy marker: Render injects RENDER_GIT_COMMIT for git-backed deploys.
    commit: process.env.RENDER_GIT_COMMIT || null,
  });
}));

// ---------- realm network ----------
// Public aggregate powering the Global Player Origins view: counts of
// players active within the last ~15 minutes, grouped by region.
// Aggregate only — no usernames, no individual data. Server-side cache
// of 60s keeps this cheap no matter how often clients open the modal.
let _realmCache = null;
let _realmCacheAt = 0;
router.get('/realm-network', asyncHandler(async (req, res) => {
  const now = Date.now();
  if (!_realmCache || now - _realmCacheAt > 60 * 1000) {
    _realmCache = await getRealmNetworkCounts();
    _realmCacheAt = now;
  }
  res.json({ ok: true, regions: _realmCache, cachedAt: _realmCacheAt });
}));

// ---------- changelog ----------
// Public, but role-aware: entries/items flagged "staff" in changelog.json are
// stripped for regular players so the What's New panel never leaks GM/staff
// additions. Staff (owner/admin/gm/moderator) see the full log.
const CHANGELOG_PATH = path.join(__dirname, '..', 'public', 'changelog.json');
const STAFF_CHANGELOG_ROLES = new Set(['owner', 'admin', 'gm', 'moderator']);
function filterChangelog(log, isStaff) {
  if (!Array.isArray(log)) return [];
  const out = [];
  for (const e of log) {
    if (!e || typeof e !== 'object') continue;
    if (e.staff && !isStaff) continue;
    const changes = (e.changes || [])
      .filter(c => (typeof c === 'string') || (c && typeof c === 'object' && (isStaff || !c.staff)))
      .map(c => (typeof c === 'string' ? c : c.text));
    if (!changes.length) continue;
    out.push({ ...e, changes });
  }
  return out;
}
router.get('/changelog', asyncHandler(async (req, res) => {
  let role = null;
  try {
    const userId = req.session && req.session.userId;
    if (userId) {
      const user = await getUserById(userId);
      role = user && user.role;
    }
  } catch { /* treat as anonymous player */ }
  let log = [];
  try {
    log = JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
  } catch { /* serve empty on read/parse failure */ }
  res.json({ ok: true, log: filterChangelog(log, STAFF_CHANGELOG_ROLES.has(role)) });
}));

/** Fresh default blob per the API contract's state schema. */
function defaultStateBlob() {
  return {
    race: 'human',
    mode: 'clicker',
    level: 1,
    xp: 0,
    xpNext: 100,
    gold: 0,
    stars: 0,
    stage: 1,
    bossesKilled: 0,
    rebirthCount: 0,
    hero: {
      hp: 100, maxHp: 100, attack: 10, defense: 2,
      critChance: 5, critDamage: 150, parry: 0, dodge: 5,
      lifesteal: 0, attackSpeed: 1.0, regen: 0,
    },
    party: [],
    inventory: [],
    equipped: { weapon: null, armor: null, helmet: null, boots: null, trinket: null },
    upgrades: { weapon: 1, armor: 1, skill: 1 },
    skills: ['power-strike'],
    companions: [],
    pets: { collection: [], activeUid: null, eggs: 0 },
    codesRedeemed: [],
    stats: { taps: 0, kills: 0, playTimeSec: 0 },
  };
}

function parseBlob(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch {
    // fall through to default
  }
  return defaultStateBlob();
}

/** Load the player's blob from their saved row, or a fresh default. */
async function loadBlob(userId) {
  const row = await getStateRow(userId);
  return row ? parseBlob(row.state_json) : defaultStateBlob();
}

// ---------- state ----------
router.get(
  '/state',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await getStateRow(req.user.id);
    if (!row) {
      return res.json({ state: defaultStateBlob(), lastSeenAt: null });
    }
    res.json({ state: parseBlob(row.state_json), lastSeenAt: Number(row.updated_at) });
  })
);

router.post(
  '/state',
  requireAuth,
  saveLimiter,
  asyncHandler(async (req, res) => {
    const { state } = req.body || {};
    const result = sanitizeStateBlob(state);
    if (!result.ok) return res.status(400).json({ error: result.error });
    // infGold is an owner-granted perk: never trust the client's assertion.
    // Carry the server-side value forward so players can't grant it to
    // themselves by editing their save blob.
    const row = await getStateRow(req.user.id);
    let serverInfGold = false;
    if (row) {
      try {
        const prev = JSON.parse(row.state_json);
        serverInfGold = prev && prev.infGold === true;
      } catch { /* keep false */ }
    }
    result.state.infGold = serverInfGold;
    // Guild XP: award the player's guild for activity since the last save.
    // Deltas are clamped >= 0 and the per-save contribution is capped in
    // recordMemberActivity, so a single save can't spike the guild. Guild
    // failures must never break saving.
    try {
      if (row && row.state_json) {
        const prev = JSON.parse(row.state_json);
        const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        const deltas = {
          kills: Math.max(0, Math.floor(num(result.state.stats && result.state.stats.kills) - num(prev.stats && prev.stats.kills))),
          bosses: Math.max(0, Math.floor(num(result.state.bossesKilled) - num(prev.bossesKilled))),
          quests: Math.max(0, Math.floor(num(result.state.stats && result.state.stats.questsCompleted) - num(prev.stats && prev.stats.questsCompleted))),
        };
        if (deltas.kills || deltas.bosses || deltas.quests) {
          await recordMemberActivity(req.user.username, deltas);
          // Announce boss kills in guild news (aggregated per save so a
          // boss-grinding session doesn't flood the feed).
          if (deltas.bosses > 0) {
            try {
              const mg = await getMyGuild(req.user.username);
              if (mg) {
                await addGuildNews(
                  mg.id,
                  'boss',
                  `${req.user.username} slew ${deltas.bosses} boss${deltas.bosses === 1 ? '' : 'es'}!`
                );
              }
            } catch { /* news must never break the save */ }
          }
        }
      }
    } catch {
      // ignore guild bookkeeping errors; the save itself succeeded
    }
    await saveState(req.user.id, result.state);
    // Keep the multiplayer NPC roster in sync with owned allies. A party-sync
    // hiccup must never break the save itself.
    try { await syncPartyNpcs(req.user.id); } catch (e) { console.error('party npc sync failed', e && e.message); }
    res.json({ ok: true });
  })
);

// ---------- public settings ----------
// Tunables the client needs at boot: gold cap + the active server event buff
// (set via POST /api/gm/event-buff; expired buffs are cleared lazily here).
router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    let eventBuff = null;
    try {
      const raw = await getSetting('event_buff');
      if (raw) {
        const b = JSON.parse(raw);
        if (b && b.endsAt > Date.now()) {
          eventBuff = { xpMult: b.xpMult, goldMult: b.goldMult, endsAt: b.endsAt, label: b.label, setBy: b.setBy };
        } else if (b) {
          await setSetting('event_buff', '');
        }
      }
    } catch (e) { /* no buff */ }
    res.json({ ok: true, goldCap: await getGoldCap(), eventBuff });
  })
);

// ---------- leaderboard (public) ----------
// Ranking categories. Indexed columns sort in SQL; blob-derived stats
// (kills, depth, titles) are extracted from server-stored state_json and
// sorted in JS. Unknown keys are rejected with 400. Class/spec ids come
// from validation.js (canonical sets mirroring Engine.CLASSES / SPECS).
const LB_CATEGORIES = ['level', 'stage', 'bosses', 'kills', 'depth', 'titles', 'rebirths', 'bossrush', 'tower', 'fish', 'biggestcatch'];
const LB_INDEXED = new Set(['level', 'stage', 'bosses', 'rebirths']);
const LB_BLOB_SORT_KEY = { kills: 'kills', depth: 'depth', titles: 'titles', bossrush: 'bossRushMs', tower: 'towerFloor', fish: 'totalFish', biggestcatch: 'biggestCatch' };
router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const by = typeof req.query.by === 'string' ? req.query.by : 'level';
    if (!LB_CATEGORIES.includes(by)) {
      return res.status(400).json({ error: 'Unknown leaderboard category.' });
    }
    // Blob-derived categories need a wider pool since SQL can't sort them.
    const rows = LB_INDEXED.has(by)
      ? await getLeaderboardRows(100, by)
      : await getLeaderboardRows(300, 'level');
    const entries = rows.map((r) => {
      let race = null;
      let title = null;
      let badge = null;
      let country = null;
      let playerClass = null;
      let spec = null;
      let nameColor = null;
      let nameFx = 'none';
      let power = 0;
      let kills = 0;
      let depth = 0;
      let titles = 0;
      let bossRushMs = 0;
      let towerFloor = 0;
      let totalFish = 0;
      let biggestCatch = 0;
      try {
        const blob = JSON.parse(r.state_json);
        if (blob && typeof blob.race === 'string') race = blob.race;
        if (blob && typeof blob.activeTitle === 'string') title = blob.activeTitle;
        if (blob && typeof blob.badge === 'string') badge = blob.badge;
        if (blob && typeof blob.country === 'string') country = blob.country;
        const style = nameStyleOf(blob);
        nameColor = style.nameColor;
        nameFx = style.nameFx;
        if (blob && typeof blob.playerClass === 'string' && VALID_CLASSES.has(blob.playerClass)) {
          playerClass = blob.playerClass;
        }
        if (blob && typeof blob.spec === 'string' && VALID_SPECS.has(blob.spec)) {
          spec = blob.spec;
        }
        if (blob && Number.isFinite(blob.power) && blob.power >= 0) power = Math.floor(blob.power);
        if (blob && blob.stats && Number.isFinite(blob.stats.kills) && blob.stats.kills >= 0) {
          kills = Math.floor(blob.stats.kills);
        }
        if (blob && blob.mine && Number.isFinite(blob.mine.maxDepth) && blob.mine.maxDepth >= 0) {
          depth = Math.floor(blob.mine.maxDepth);
        }
        if (blob && Array.isArray(blob.titlesUnlocked)) titles = blob.titlesUnlocked.length;
        if (blob && blob.bossRush && Number.isFinite(blob.bossRush.bestTimeMs) && blob.bossRush.bestTimeMs > 0) {
          bossRushMs = Math.floor(blob.bossRush.bestTimeMs);
        }
        if (blob && blob.tower && Number.isFinite(blob.tower.floor) && blob.tower.floor >= 0) {
          towerFloor = Math.floor(blob.tower.floor);
        }
        if (blob && Number.isFinite(blob.totalFishCaught) && blob.totalFishCaught >= 0) {
          totalFish = Math.floor(blob.totalFishCaught);
        }
        if (blob && Number.isFinite(blob.biggestCatchScore) && blob.biggestCatchScore >= 0) {
          biggestCatch = Math.floor(blob.biggestCatchScore);
        }
      } catch {
        // leave race/title/badge/country/playerClass/spec null
      }
      return {
        username: r.username,
        race,
        title,
        badge,
        country,
        playerClass,
        spec,
        nameColor,
        nameFx,
        level: r.level,
        stage: r.stage,
        power,
        bossesKilled: r.bosses_killed,
        rebirth: r.rebirth_count,
        guildTag: r.guild_tag || null,
        kills,
        depth,
        titles,
        bossRushMs,
        towerFloor,
        totalFish,
        biggestCatch,
      };
    });
    if (!LB_INDEXED.has(by)) {
      const key = LB_BLOB_SORT_KEY[by];
      if (by === 'bossrush') {
        // Lower time = better. Filter out players with no time (0).
        entries.sort((a, b) => {
          if (!a[key] && !b[key]) return b.level - a.level;
          if (!a[key]) return 1;
          if (!b[key]) return -1;
          return (a[key] || 0) - (b[key] || 0) || b.level - a.level;
        });
      } else {
        entries.sort((a, b) => (b[key] || 0) - (a[key] || 0) || b.level - a.level);
      }
      entries.length = Math.min(entries.length, 100);
    }
    res.json({ entries, by });
  })
);

// ---------- guild rankings (public) ----------
// Ranks guilds by: level DESC, then total member power DESC, then member
// count DESC. Served for the leaderboard "Guilds" category tab.
router.get(
  '/guilds/rankings',
  asyncHandler(async (req, res) => {
    const guilds = await getGuildRankings(50);
    res.json({ guilds });
  })
);

// ---------- player inspect (public) ----------
// Full gameplay character sheet for any existing player. Privacy: gameplay
// data only — no currencies, roles, or account details.
router.get(
  '/player/:username/inspect',
  asyncHandler(async (req, res) => {
    const raw = req.params.username;
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(raw)) {
      return res.status(400).json({ error: 'Invalid username.' });
    }
    let viewer = null;
    try {
      const viewerId = req.session && req.session.userId;
      if (viewerId) {
        const vu = await getUserById(viewerId);
        viewer = vu ? vu.username : null;
      }
    } catch { /* anonymous inspect */ }
    const data = await buildInspect(raw, viewer);
    if (!data) return res.status(404).json({ error: 'Player not found.' });
    res.json(data);
  })
);

// ---------- friends ----------
router.post(
  '/friends/request',
  requireAuth,
  friendLimiter,
  asyncHandler(async (req, res) => {
    const target = req.body && req.body.username;
    const usernameError = validateUsername(target);
    if (usernameError) return res.status(400).json({ error: usernameError });
    try {
      const r = await sendFriendRequest(req.user.username, target.trim());
      res.json({ ok: true, username: r.username });
    } catch (err) {
      if (err.code === 'FRIEND_SELF') {
        return res.status(400).json({ error: "You can't add yourself as a friend." });
      }
      if (err.code === 'FRIEND_NOT_FOUND') {
        return res.status(404).json({ error: 'Player not found. Check the exact username.' });
      }
      if (err.code === 'FRIEND_EXISTS') {
        return res.status(409).json({ error: 'Already friends, or a request is already pending.' });
      }
      throw err;
    }
  })
);

router.post(
  '/friends/respond',
  requireAuth,
  friendLimiter,
  asyncHandler(async (req, res) => {
    const { username, accept } = req.body || {};
    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ error: usernameError });
    try {
      const r = await respondFriendRequest(req.user.username, username.trim(), accept === true);
      res.json({ ok: true, accepted: accept === true, username: r.username });
    } catch (err) {
      if (err.code === 'FRIEND_NO_REQUEST') {
        return res.status(404).json({ error: 'No pending friend request from that player.' });
      }
      throw err;
    }
  })
);

router.get(
  '/friends',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await getFriendshipData(req.user.username);
    const friends = await getFriendProfiles(data.friends);
    const now = Date.now();
    res.json({
      ok: true,
      friends: friends.map((f) => ({
        ...f,
        online: now - (Number(f.lastActive) || 0) < ONLINE_WINDOW_MS,
      })),
      incoming: await getFriendProfiles(data.incoming || []),
      outgoing: await getFriendProfiles(data.outgoing || []),
    });
  })
);

router.delete(
  '/friends/:username',
  requireAuth,
  friendLimiter,
  asyncHandler(async (req, res) => {
    const raw = req.params.username;
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(raw)) {
      return res.status(400).json({ error: 'Invalid username.' });
    }
    try {
      await removeFriend(req.user.username, raw);
      res.json({ ok: true });
    } catch (err) {
      if (err.code === 'FRIEND_NOT_FOUND') {
        return res.status(404).json({ error: 'No friendship with that player.' });
      }
      throw err;
    }
  })
);

// ---------- gift codes ----------
router.post(
  '/redeem',
  requireAuth,
  redeemLimiter,
  asyncHandler(async (req, res) => {
    let { code } = req.body || {};
    if (typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'Code is required.' });
    }
    code = code.trim().toUpperCase();

    const cap = await getGoldCap();
    let giftRow;
    try {
      giftRow = await redeemGiftCode(
        code,
        req.user.id,
        (giftCode, blob) => {
          const kind = giftCode.reward_kind || 'gear';
          const amount = Math.max(0, Math.floor(Number(giftCode.reward_amount)) || 0);
          if (!Array.isArray(blob.codesRedeemed)) blob.codesRedeemed = [];
          if (!blob.codesRedeemed.includes(code)) blob.codesRedeemed.push(code);
          if (kind === 'gold') {
            const cur = Math.max(0, Number(blob.gold) || 0);
            // Infinite-gold perk holders bypass the cap; everyone else clamps.
            blob.gold = blob.infGold === true ? cur + amount : Math.min(cap, cur + amount);
          } else if (kind === 'stars') {
            blob.stars = Math.min(1e15, Math.max(0, Number(blob.stars) || 0) + amount);
          } else {
            if (!isValidSetId(giftCode.gear_set)) {
              const err = new Error('Code has an invalid gear set.');
              err.status = 500;
              throw err;
            }
            const items = makeGearItems(giftCode.gear_set);
            if (!Array.isArray(blob.inventory)) blob.inventory = [];
            blob.inventory.push(...items);
          }
          return blob;
        },
        () => defaultStateBlob()
      );
    } catch (err) {
      // Preserve the exact status codes from the original implementation:
      // unknown code -> 404, exhausted -> 409, already redeemed -> 409.
      if (err.code === 'REDEEM_NOT_FOUND') {
        return res.status(404).json({ error: 'Code not found.' });
      }
      if (err.code === 'REDEEM_EXHAUSTED') {
        return res.status(409).json({ error: 'Code has been fully redeemed.' });
      }
      if (err.code === 'REDEEM_ALREADY') {
        return res.status(409).json({ error: 'You have already redeemed this code.' });
      }
      throw err;
    }

    const rewardKind = giftRow.reward_kind || 'gear';
    const rewardAmount = Math.max(0, Math.floor(Number(giftRow.reward_amount)) || 0);
    res.json({
      ok: true,
      set: rewardKind === 'gear' ? giftRow.gear_set : null,
      reward: { kind: rewardKind, amount: rewardAmount },
    });
  })
);

// ---------- guilds ----------
function cleanGuildName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length < 3 || n.length > 20) return null;
  if (!/^[A-Za-z0-9 ]+$/.test(n)) return null;
  return n;
}

function cleanGuildTag(tag) {
  if (typeof tag !== 'string') return null;
  const t = tag.trim().toUpperCase();
  if (t.length < 2 || t.length > 4) return null;
  if (!/^[A-Za-z0-9]+$/.test(t)) return null;
  return t;
}

router.post(
  '/guilds',
  requireAuth,
  asyncHandler(async (req, res) => {
    const name = cleanGuildName(req.body && req.body.name);
    const tag = cleanGuildTag(req.body && req.body.tag);
    if (!name) {
      return res.status(400).json({ error: 'Guild name must be 3-20 characters (letters, numbers, spaces).' });
    }
    if (!tag) {
      return res.status(400).json({ error: 'Guild tag must be 2-4 characters (letters, numbers).' });
    }
    try {
      const guild = await createGuild(name, tag, req.user.username);
      res.json({ ok: true, guild });
    } catch (err) {
      if (err.code === 'GUILD_NAME_TAKEN') {
        return res.status(409).json({ error: 'That guild name is taken.' });
      }
      if (err.code === 'GUILD_ALREADY_IN') {
        return res.status(409).json({ error: 'You are already in a guild.' });
      }
      throw err;
    }
  })
);

router.post(
  '/guilds/join',
  requireAuth,
  asyncHandler(async (req, res) => {
    const raw = req.body && typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!raw) return res.status(400).json({ error: 'Guild name is required.' });
    const guild = await getGuildByName(raw);
    if (!guild) return res.status(404).json({ error: 'Guild not found.' });
    try {
      await joinGuild(guild.id, req.user.username);
      res.json({ ok: true, guild });
    } catch (err) {
      if (err.code === 'GUILD_ALREADY_IN') {
        return res.status(409).json({ error: 'You are already in a guild. Leave it first.' });
      }
      throw err;
    }
  })
);

router.post(
  '/guilds/leave',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const result = await leaveGuild(req.user.username);
      res.json({ ok: true, guildDeleted: result.guildDeleted, guildName: result.guildName });
    } catch (err) {
      if (err.code === 'GUILD_NOT_IN') {
        return res.status(404).json({ error: 'You are not in a guild.' });
      }
      throw err;
    }
  })
);

// ---------- guild invites ----------
// Officers and the Guild Master can invite a player by username.
router.post(
  '/guilds/invite',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const invite = await inviteToGuild(req.user.username, req.body && req.body.username);
      res.json({ ok: true, invite });
    } catch (err) {
      if (err.code === 'GUILD_NOT_IN') return res.status(404).json({ error: 'You are not in a guild.' });
      if (err.code === 'GUILD_NO_PERMISSION') {
        return res.status(403).json({ error: 'Only the Guild Master and Officers can invite players.' });
      }
      if (err.code === 'GUILD_USER_NOT_FOUND') return res.status(404).json({ error: 'Player not found.' });
      if (err.code === 'GUILD_ALREADY_IN') return res.status(409).json({ error: 'That player is already in a guild.' });
      if (err.code === 'GUILD_ALREADY_INVITED') {
        return res.status(409).json({ error: 'That player is already invited.' });
      }
      throw err;
    }
  })
);

// Pending invites for the signed-in player.
router.get(
  '/guilds/invites',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ invites: await getMyInvites(req.user.username) });
  })
);

router.post(
  '/guilds/invites/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const result = await acceptGuildInvite(req.user.username, req.body && req.body.inviteId);
      res.json({ ok: true, guildId: result.guildId });
    } catch (err) {
      if (err.code === 'GUILD_NOT_FOUND') return res.status(404).json({ error: 'Invite not found.' });
      if (err.code === 'GUILD_ALREADY_IN') return res.status(409).json({ error: 'You are already in a guild.' });
      throw err;
    }
  })
);

router.post(
  '/guilds/invites/decline',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await declineGuildInvite(req.user.username, req.body && req.body.inviteId);
      res.json({ ok: true });
    } catch (err) {
      if (err.code === 'GUILD_NOT_FOUND') return res.status(404).json({ error: 'Invite not found.' });
      throw err;
    }
  })
);

router.get(
  '/guilds/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const mine = await getMyGuild(req.user.username);
    if (!mine) return res.json({ guild: null, members: [] });
    const { my_rank: myRank, my_credits: myCredits, my_title: myTitle, ...guild } = mine;
    const members = await getGuildRoster(guild.id);
    const challenges = await getGuildChallenges(guild.id);
    const unlockedBanners = await getUnlockedBanners(guild.id);
    const level = Number(guild.level) || 1;
    res.json({
      guild: {
        ...guild,
        myRank,
        myName: req.user.username,
        myCredits: Number(myCredits) || 0,
        myTitle: myTitle || null,
        perks: guildPerks(level, hallFromGuildRow(guild)),
        xpForNext: xpForGuildLevel(level + 1),
        unlockedBanners,
      },
      members,
      challenges,
    });
  })
);

// Slim endpoint so the client can apply guild perks at boot without
// pulling the whole roster.
router.get(
  '/guilds/perks',
  requireAuth,
  asyncHandler(async (req, res) => {
    const mine = await getMyGuild(req.user.username);
    if (!mine) return res.json({ inGuild: false, perks: null });
    res.json({ inGuild: true, perks: guildPerks(Number(mine.level) || 1, hallFromGuildRow(mine)) });
  })
);

// Guild level / XP progress (explicit endpoint for the rework spec).
router.get(
  '/guilds/xp',
  requireAuth,
  asyncHandler(async (req, res) => {
    const mine = await getMyGuild(req.user.username);
    if (!mine) return res.json({ inGuild: false });
    const level = Number(mine.level) || 1;
    const xp = Number(mine.xp) || 0;
    res.json({
      inGuild: true,
      level,
      xp,
      xpForNext: xpForGuildLevel(level + 1),
      xpForCurrent: xpForGuildLevel(level),
      perks: guildPerks(level, hallFromGuildRow(mine)),
    });
  })
);

// Weekly guild challenges (explicit endpoint for the rework spec).
router.get(
  '/guilds/challenges',
  requireAuth,
  asyncHandler(async (req, res) => {
    const mine = await getMyGuild(req.user.username);
    if (!mine) return res.json({ inGuild: false, challenges: [] });
    res.json({ inGuild: true, challenges: await getGuildChallenges(mine.id) });
  })
);

router.get(
  '/guilds/roster',
  asyncHandler(async (req, res) => {
    const raw = req.query && typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!raw) return res.status(400).json({ error: 'Guild name is required.' });
    const guild = await getGuildByName(raw);
    if (!guild) return res.status(404).json({ error: 'Guild not found.' });
    const members = await getGuildRoster(guild.id);
    res.json({ guild, members });
  })
);

// ---------- guild rework endpoints ----------

/** Load the caller's guild + rank; 404 when not in a guild. */
/** Extract hall levels {valor, treasury, forge} from a guild row. */
function hallFromGuildRow(g) {
  return {
    valor: Number(g.hall_valor_level) || 0,
    treasury: Number(g.hall_treasury_level) || 0,
    forge: Number(g.hall_forge_level) || 0,
  };
}

// Guild Hall buildings: id -> { name, column, desc }.
const HALL_BUILDINGS = {
  valor: { name: 'Hall of Valor', column: 'hall_valor_level', desc: '+1% XP and +2% damage per level' },
  treasury: { name: 'Treasury', column: 'hall_treasury_level', desc: '+2% gold per level' },
  forge: { name: 'Forge Shrine', column: 'hall_forge_level', desc: '+3% mining yield per level' },
};
const HALL_MAX_LEVEL = 10;

/** Upgrade cost for going from currentLevel -> currentLevel+1. */
function hallUpgradeCost(currentLevel) {
  return 100000 * Math.pow(2, Math.max(0, Math.floor(currentLevel || 0)));
}

async function guildContext(req, res) {
  const mine = await getMyGuild(req.user.username);
  if (!mine) {
    res.status(404).json({ error: 'You are not in a guild.' });
    return null;
  }
  const { my_rank: myRank, ...guild } = mine;
  return { guild, myRank };
}

function rankAtLeast(rank, need) {
  return (GUILD_RANKS[rank] || 0) >= (GUILD_RANKS[need] || 0);
}

router.get(
  '/guilds/chat',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const after = Math.max(0, Math.floor(Number((req.query && req.query.after) || 0)));
    res.json({ messages: await getGuildChat(ctx.guild.id, after) });
  })
);

router.post(
  '/guilds/chat',
  requireAuth,
  chatLimiter,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const raw = req.body && typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!raw) return res.status(400).json({ error: 'Message is empty.' });
    if (raw.length > 500) return res.status(400).json({ error: 'Message is too long (max 500 characters).' });
    // GM mute check: muted players cannot post to guild chat until the mute expires.
    try {
      const srow = await getStateRow(req.user.id);
      const sblob = srow ? parseBlob(srow.state_json) : null;
      if (sblob && sblob.chatMutedUntil && sblob.chatMutedUntil > Date.now()) {
        const mins = Math.ceil((sblob.chatMutedUntil - Date.now()) / 60000);
        return res.status(403).json({ error: `You are muted from guild chat for another ${mins} minute(s).` });
      }
    } catch { /* mute check is best-effort; never block chat on a read error */ }
    const msg = await addGuildChat(ctx.guild.id, req.user.username, raw);
    let nameColor = null;
    let nameFx = 'none';
    try {
      const srow = await getStateRow(req.user.id);
      const style = nameStyleOf(srow ? parseBlob(srow.state_json) : null);
      nameColor = style.nameColor;
      nameFx = style.nameFx;
    } catch { /* style is best-effort; never block chat on a read error */ }
    res.json({ ok: true, message: { id: msg.id, username: req.user.username, message: raw, created_at: msg.created_at, nameColor, nameFx } });
  })
);

// Officers+ can delete a guild chat message.
router.delete(
  '/guilds/chat/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    if (!rankAtLeast(ctx.myRank, 'officer')) {
      return res.status(403).json({ error: 'Only officers and the Guild Master can delete messages.' });
    }
    const id = Math.floor(Number(req.params.id));
    if (!id || id < 1) return res.status(400).json({ error: 'Bad message id.' });
    const ok = await deleteGuildChat(ctx.guild.id, id);
    if (!ok) return res.status(404).json({ error: 'Message not found.' });
    res.json({ ok: true });
  })
);

router.get(
  '/guilds/news',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    res.json({ news: await getGuildNews(ctx.guild.id) });
  })
);

router.post(
  '/guilds/motd',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    if (!rankAtLeast(ctx.myRank, 'officer')) {
      return res.status(403).json({ error: 'Only the Guild Master and Officers can set the Message of the Day.' });
    }
    const raw = req.body && typeof req.body.motd === 'string' ? req.body.motd.trim() : '';
    if (raw.length > 200) return res.status(400).json({ error: 'Message of the Day is too long (max 200 characters).' });
    await setGuildMotd(ctx.guild.id, raw);
    res.json({ ok: true, motd: raw });
  })
);

router.post(
  '/guilds/description',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    if (!rankAtLeast(ctx.myRank, 'officer')) {
      return res.status(403).json({ error: 'Only the Guild Master and Officers can edit the description.' });
    }
    const raw = req.body && typeof req.body.description === 'string' ? req.body.description.trim() : '';
    if (raw.length > 500) return res.status(400).json({ error: 'Description is too long (max 500 characters).' });
    await setGuildDescription(ctx.guild.id, raw);
    res.json({ ok: true, description: raw });
  })
);

router.post(
  '/guilds/rank',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const target = req.body && typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const rank = req.body && typeof req.body.rank === 'string' ? req.body.rank.trim().toLowerCase() : '';
    if (!target) return res.status(400).json({ error: 'Username is required.' });
    try {
      const updated = await setMemberRank(ctx.guild.id, req.user.username, target, rank);
      res.json({ ok: true, member: { username: updated.username, rank: updated.rank } });
    } catch (err) {
      if (err.code === 'GUILD_BAD_RANK') return res.status(400).json({ error: 'Invalid rank.' });
      if (err.code === 'GUILD_SELF') return res.status(400).json({ error: 'You cannot change your own rank.' });
      if (err.code === 'GUILD_NOT_IN') return res.status(404).json({ error: 'That player is not in your guild.' });
      if (err.code === 'GUILD_FORBIDDEN') {
        return res.status(403).json({ error: 'You do not have permission to do that.' });
      }
      throw err;
    }
  })
);

router.post(
  '/guilds/kick',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const target = req.body && typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (!target) return res.status(400).json({ error: 'Username is required.' });
    try {
      await kickGuildMember(ctx.guild.id, req.user.username, target);
      res.json({ ok: true });

// ---------- multiplayer parties ----------
// Invite-code parties (max 4 humans). All member stats are read server-side
// from stored saves — never trusted from the client.
function partyErrorToResponse(err, res) {
  const map = {
    PARTY_ALREADY_IN: [409, 'You are already in a party. Leave it first.'],
    PARTY_NOT_IN: [404, 'You are not in a party.'],
    PARTY_NOT_FOUND: [404, 'No party with that code. Check the code and try again.'],
    PARTY_FULL: [409, 'That party is full (4 roster slots max).'],
    PARTY_NOT_LEADER: [403, 'Only the party leader can do that.'],
    PARTY_TARGET_NOT_IN: [404, 'That player is not in your party.'],
    PARTY_CANNOT_KICK_SELF: [400, 'You cannot kick yourself — leave or disband instead.'],
    PARTY_CANNOT_PROMOTE_SELF: [400, 'You are already the leader.'],
  };
  const hit = err && map[err.code];
  if (hit) return res.status(hit[0]).json({ error: hit[1] });
  throw err;
}

router.post(
  '/party/create',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const party = await createParty(req.user.id);
      const view = await getPartyView(req.user.id);
      res.json({ ok: true, party: view, code: party.code });
    } catch (err) {
      return partyErrorToResponse(err, res);
    }
  })
);

    } catch (err) {
      if (err.code === 'GUILD_SELF') return res.status(400).json({ error: 'You cannot kick yourself. Leave instead.' });
      if (err.code === 'GUILD_NOT_IN') return res.status(404).json({ error: 'That player is not in your guild.' });
      if (err.code === 'GUILD_FORBIDDEN') {
        return res.status(403).json({ error: 'You do not have permission to do that.' });
      }
      throw err;
    }
  })
);

router.post(
  '/party/join',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await joinPartyByCode(req.user.id, req.body && req.body.code);
      const view = await getPartyView(req.user.id);
      res.json({ ok: true, party: view });
    } catch (err) {
      return partyErrorToResponse(err, res);
    }
  })
);

router.post(
  '/party/leave',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const result = await leaveParty(req.user.id);
      res.json({ ok: true, disbanded: result.disbanded });
    } catch (err) {
      return partyErrorToResponse(err, res);
    }
  })
);

router.post(
  '/party/kick',
  requireAuth,
  asyncHandler(async (req, res) => {
    const targetId = req.body && Number(req.body.userId);
    if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'userId is required.' });
    try {
      const result = await kickPartyMember(req.user.id, targetId);
      res.json({ ok: true, disbanded: result.disbanded });
    } catch (err) {
      return partyErrorToResponse(err, res);
    }
  })
);

router.post(
  '/party/disband',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await disbandParty(req.user.id);
      res.json({ ok: true, disbanded: true });
    } catch (err) {
      return partyErrorToResponse(err, res);
    }
  })
);

router.post(
  '/party/promote',
  requireAuth,
  asyncHandler(async (req, res) => {
    const targetId = req.body && Number(req.body.userId);
    if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'userId is required.' });
    try {
      await promotePartyLeader(req.user.id, targetId);
      const view = await getPartyView(req.user.id);
      res.json({ ok: true, party: view });
    } catch (err) {
      return partyErrorToResponse(err, res);
    }
  })
);

router.get(
  '/guilds/vendor',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const mine = await getMyGuild(req.user.username);
    const unlockedBanners = await getUnlockedBanners(ctx.guild.id);
    res.json({
      items: GUILD_VENDOR,
      credits: Number(mine.my_credits) || 0,
      myTitle: mine.my_title || null,
      bannerStyle: ctx.guild.banner_style,
      unlockedBanners,
      canSetBanner: rankAtLeast(ctx.myRank, 'officer'),
    });
  })
);

router.post(
  '/guilds/vendor/buy',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const itemId = req.body && typeof req.body.itemId === 'string' ? req.body.itemId : '';
    try {
      const result = await buyVendorItem(ctx.guild.id, req.user.username, itemId);
      res.json({ ok: true, item: result.item });
    } catch (err) {
      if (err.code === 'GUILD_ITEM_UNKNOWN') return res.status(400).json({ error: 'Unknown item.' });
      if (err.code === 'GUILD_NOT_IN') return res.status(404).json({ error: 'You are not in a guild.' });
      if (err.code === 'GUILD_NO_CREDITS') {
        return res.status(402).json({ error: 'Not enough guild credits. Contribute guild XP to earn more.' });
      }
      throw err;
    }
  })
);

router.post(
  '/guilds/banner',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    if (!rankAtLeast(ctx.myRank, 'officer')) {
      return res.status(403).json({ error: 'Only the Guild Master and Officers can change the banner.' });
    }
    const style = req.body && typeof req.body.style === 'string' ? req.body.style.trim() : '';
    try {
      await setGuildBanner(ctx.guild.id, style, req.user.username);
      res.json({ ok: true, bannerStyle: style });
    } catch (err) {
      if (err.code === 'GUILD_LOCKED') {
        return res.status(400).json({ error: 'That banner is not unlocked yet. Buy it in Rewards.' });
      }
      throw err;
    }
  })
);

// Donate personal gold to the guild treasury.
// Atomic: locks the player_state row and guild row in one transaction so
// concurrent donations and autosaves cannot create or lose gold.
router.post(
  '/guilds/donate',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    const amount = Math.floor(Number(req.body && req.body.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid donation amount.' });
    }
    if (amount > 1e15) {
      return res.status(400).json({ error: 'Donation amount too large.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stateRes = await client.query(
        'SELECT state_json FROM player_state WHERE user_id = $1 FOR UPDATE',
        [req.user.id]
      );
      if (!stateRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No character found.' });
      }
      let blob;
      try {
        blob = JSON.parse(stateRes.rows[0].state_json);
      } catch {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: 'Character data is corrupted.' });
      }
      const gold = Math.floor(Number(blob.gold) || 0);
      if (gold < amount) {
        await client.query('ROLLBACK');
        return res.status(402).json({ error: 'Not enough gold.', gold });
      }
      blob.gold = gold - amount;
      const guildRes = await client.query(
        'SELECT treasury_gold FROM guilds WHERE id = $1 FOR UPDATE',
        [ctx.guild.id]
      );
      if (!guildRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Guild not found.' });
      }
      const newTreasury = (Number(guildRes.rows[0].treasury_gold) || 0) + amount;
      await client.query(
        'UPDATE player_state SET state_json = $1, updated_at = $2 WHERE user_id = $3',
        [JSON.stringify(blob), Date.now(), req.user.id]
      );
      await client.query('UPDATE guilds SET treasury_gold = $1 WHERE id = $2', [
        newTreasury,
        ctx.guild.id,
      ]);
      await client.query('COMMIT');
      res.json({ ok: true, donated: amount, newGold: blob.gold, treasuryGold: newTreasury });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  })
);

// Upgrade a Guild Hall building using treasury gold.
// Officer/Guild Master only. Atomic: treasury deduction and level increment
// happen in a single transaction.
router.post(
  '/guilds/upgrade-hall',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await guildContext(req, res);
    if (!ctx) return;
    if (!rankAtLeast(ctx.myRank, 'officer')) {
      return res.status(403).json({ error: 'Only the Guild Master and Officers can upgrade the hall.' });
    }
    const buildingId = req.body && typeof req.body.building === 'string' ? req.body.building : '';
    const building = HALL_BUILDINGS[buildingId];
    if (!building) {
      return res.status(400).json({ error: 'Invalid building.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Column name comes from the HALL_BUILDINGS constant (not user input).
      const guildRes = await client.query(
        `SELECT treasury_gold, ${building.column} FROM guilds WHERE id = $1 FOR UPDATE`,
        [ctx.guild.id]
      );
      if (!guildRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Guild not found.' });
      }
      const row = guildRes.rows[0];
      const currentLevel = Math.max(0, Math.min(HALL_MAX_LEVEL, Math.floor(Number(row[building.column]) || 0)));
      if (currentLevel >= HALL_MAX_LEVEL) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Building is already at max level.' });
      }
      const cost = hallUpgradeCost(currentLevel);
      const treasury = Number(row.treasury_gold) || 0;
      if (treasury < cost) {
        await client.query('ROLLBACK');
        return res.status(402).json({ error: 'Not enough gold in the guild treasury.', cost, treasuryGold: treasury });
      }
      const newLevel = currentLevel + 1;
      const newTreasury = treasury - cost;
      await client.query(
        `UPDATE guilds SET ${building.column} = $1, treasury_gold = $2 WHERE id = $3`,
        [newLevel, newTreasury, ctx.guild.id]
      );
      await client.query('COMMIT');
      const hall = hallFromGuildRow(ctx.guild);
      hall[buildingId] = newLevel;
      const perks = guildPerks(Number(ctx.guild.level) || 1, hall);
      res.json({
        ok: true,
        building: buildingId,
        buildingName: building.name,
        newLevel,
        treasuryGold: newTreasury,
        perks,
        nextCost: newLevel < HALL_MAX_LEVEL ? hallUpgradeCost(newLevel) : null,
      });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  })
);

// Presence heartbeat: marks the player as online (updates updated_at).
// Called by the client every 60s while the game is open.
router.post(
  '/ping',
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.query(
      'UPDATE player_state SET updated_at = $1 WHERE user_id = $2',
      [Date.now(), req.user.id]
    );
    res.json({ ok: true });
  })
);

// Online player count: players active in the last 2 minutes.
// Public (no auth) so the login screen can show it too.
router.get('/online-count', asyncHandler(async (req, res) => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  const { rows } = await pool.query(
    'SELECT COUNT(*) AS c FROM player_state WHERE updated_at > $1',
    [cutoff]
  );
  res.json({ onlineCount: Number(rows[0].c) || 0 });
}));

router.get(
  '/party',
  requireAuth,
  asyncHandler(async (req, res) => {
    const view = await getPartyView(req.user.id);
    res.json({ party: view });
  })
);

module.exports = { gameRouter: router, defaultStateBlob, loadBlob, filterChangelog };
