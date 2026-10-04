'use strict';

/**
 * PostgreSQL database layer (node-postgres `pg`).
 *
 * Connection comes from DATABASE_URL. SSL is enabled with
 * { rejectUnauthorized: false } for any non-localhost URL (required by
 * Neon / Supabase on Render); plain TCP is used for localhost.
 * Local fallback when DATABASE_URL is unset:
 *   postgres://localhost:5432/king_of_project
 * (create that database and make sure the OS user can connect, e.g. via
 * peer/trust auth — see README).
 *
 * Schema is applied at boot by migrate() (CREATE TABLE IF NOT EXISTS).
 * All queries are parameterized ($1, $2, ...). Every function is async.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { sanitizeStateBlob } = require('./validation');

function buildPoolConfig() {
  let connectionString =
    process.env.DATABASE_URL || 'postgres://localhost:5432/king_of_project';
  // Strip libpq-only params (e.g. Neon's channel_binding=require) that
  // node-postgres does not understand.
  try {
    const u = new URL(connectionString);
    if (u.searchParams.has('channel_binding')) {
      u.searchParams.delete('channel_binding');
      connectionString = u.toString();
    }
  } catch { /* leave the string untouched if it doesn't parse */ }
  const isLocal = /(^|[@:/])(localhost|127\.0\.0\.1)([:/]|$)/.test(connectionString);
  return {
    connectionString,
    // Hosted Postgres (Neon, Supabase, ...) requires TLS; their certs are
    // not in the default trust chain, so we don't reject unauthorized certs.
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

const pool = new Pool(buildPoolConfig());

pool.on('error', (err) => {
  console.error('[db] unexpected pool error:', err.message);
});

// Valid name-effect ids (mirrors UI.NAME_FX and validation.js).
const NAME_FX_IDS = new Set([
  'none', 'fire', 'neon', 'rainbow', 'shine', 'galaxy',
  'ice', 'lightning', 'shadow', 'glitch', 'falling-leaves', 'harvest-ember', 'autumn-mist', 'snowfall', 'aurora', 'frostbite', 'tidal', 'sunscorched', 'wildfire', 'fireworks', 'champagne', 'midnight',
  'gavelstrike', 'allseeing', 'worldforge', 'archlight', 'shadowcrown', 'everflame',
]);

/**
 * Extract a player's public name style from a parsed state blob.
 * Returns { nameColor, nameFx } with validated values; safe defaults
 * (null / 'none') when the blob has none. Used everywhere another
 * player's name is served so the client can render their style.
 */
function nameStyleOf(blob) {
  const out = { nameColor: null, nameFx: 'none' };
  if (!blob || typeof blob !== 'object') return out;
  if (typeof blob.nameColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(blob.nameColor)) {
    out.nameColor = blob.nameColor;
  }
  if (typeof blob.nameFx === 'string' && NAME_FX_IDS.has(blob.nameFx)) {
    out.nameFx = blob.nameFx;
  }
  return out;
}

/** Create tables/indexes if missing. Safe to run on every boot. */
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  // Prestige -> Rebirth rename: old installs carry prestige_count.
  try {
    await pool.query('ALTER TABLE player_state RENAME COLUMN prestige_count TO rebirth_count');
  } catch (e) { /* already renamed or fresh install */ }
  // Kick support: users.session_version (see schema.sql IF NOT EXISTS guard).
  try {
    await pool.query('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
  } catch (e) { /* already exists */ }
  // Gift-code reward kinds (see schema.sql IF NOT EXISTS guards).
  try {
    await pool.query("ALTER TABLE gift_codes ADD COLUMN reward_kind TEXT NOT NULL DEFAULT 'gear'");
  } catch (e) { /* already exists */ }
  try {
    await pool.query('ALTER TABLE gift_codes ADD COLUMN reward_amount INTEGER NOT NULL DEFAULT 0');
  } catch (e) { /* already exists */ }
  // Guild Hall: treasury + building levels (see schema.sql IF NOT EXISTS guards).
  // BIGINT for treasury (gold can exceed INTEGER max). Levels capped at 10 in app logic.
  try {
    await pool.query('ALTER TABLE guilds ADD COLUMN treasury_gold BIGINT NOT NULL DEFAULT 0');
  } catch (e) { /* already exists */ }
  try {
    await pool.query('ALTER TABLE guilds ADD COLUMN hall_valor_level INTEGER NOT NULL DEFAULT 0');
  } catch (e) { /* already exists */ }
  try {
    await pool.query('ALTER TABLE guilds ADD COLUMN hall_treasury_level INTEGER NOT NULL DEFAULT 0');
  } catch (e) { /* already exists */ }
  try {
    await pool.query('ALTER TABLE guilds ADD COLUMN hall_forge_level INTEGER NOT NULL DEFAULT 0');
  } catch (e) { /* already exists */ }
}

async function closePool() {
  await pool.end();
}

// ---------- users ----------
async function getUserByUsername(username) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  return rows[0] || null;
}

async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createUser(username, passwordHash) {
  return createUserWithRole(username, passwordHash, 'player');
}

async function createUserWithRole(username, passwordHash, role) {
  const { rows } = await pool.query(
    'INSERT INTO users (username, password_hash, role, created_at) VALUES ($1, $2, $3, $4) RETURNING *',
    [username, passwordHash, role, Date.now()]
  );
  return rows[0];
}

async function setUserRole(userId, role) {
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
}


/**
 * Replace a user's password hash and bump session_version, signing out every
 * other device. Returns the new session_version so the caller can keep the
 * current session alive by syncing it.
 */
async function updatePasswordHash(userId, passwordHash) {
  const { rows } = await pool.query(
    'UPDATE users SET password_hash = $2, session_version = session_version + 1 WHERE id = $1 RETURNING session_version',
    [userId, passwordHash]
  );
  return rows[0] ? Number(rows[0].session_version) : null;
}

/**
 * Rename a user's account. The users row is the identity; every table that
 * keys membership or relationships off the raw username text is updated in
 * one transaction:
 *   - guilds.owner_username, guild_members.username, guild_invites.username
 *   - staff_profiles.username
 *   - friendships.requester / .addressee, plus pair_key (derived from the
 *     two lowercased usernames, so it must be recomputed or the friendship
 *     becomes unfindable)
 * Deliberately untouched: player_state (keyed by user_id), party_members
 * (user_id), and historical records (guild_chat, reports, ideas) which keep
 * the name as it was when written.
 * Throws an Error with code 'taken' when the new name is already in use.
 */
async function renameUserAccount(userId, newUsername) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT username FROM users WHERE id = $1', [userId]);
    if (!cur.rows.length) throw new Error('no-user');
    const oldUsername = cur.rows[0].username;
    if (oldUsername.toLowerCase() === String(newUsername).toLowerCase()) {
      await client.query('ROLLBACK');
      return { oldUsername, newUsername: oldUsername, unchanged: true };
    }
    const taken = await client.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2',
      [newUsername, userId]
    );
    if (taken.rows.length) {
      const err = new Error('Username is already taken.');
      err.code = 'taken';
      throw err;
    }
    await client.query('UPDATE users SET username = $2 WHERE id = $1', [userId, newUsername]);
    await client.query('UPDATE guilds SET owner_username = $2 WHERE LOWER(owner_username) = LOWER($1)', [oldUsername, newUsername]);
    await client.query('UPDATE guild_members SET username = $2 WHERE LOWER(username) = LOWER($1)', [oldUsername, newUsername]);
    await client.query('UPDATE guild_invites SET username = $2 WHERE LOWER(username) = LOWER($1)', [oldUsername, newUsername]);
    await client.query('UPDATE staff_profiles SET username = $2 WHERE user_id = $1', [userId, newUsername]);
    await client.query('UPDATE friendships SET requester = $2 WHERE LOWER(requester) = LOWER($1)', [oldUsername, newUsername]);
    await client.query('UPDATE friendships SET addressee = $2 WHERE LOWER(addressee) = LOWER($1)', [oldUsername, newUsername]);
    await client.query(
      `UPDATE friendships SET pair_key = CASE
         WHEN LOWER(requester) < LOWER(addressee) THEN LOWER(requester) || '|' || LOWER(addressee)
         ELSE LOWER(addressee) || '|' || LOWER(requester)
       END
       WHERE LOWER(requester) = LOWER($1) OR LOWER(addressee) = LOWER($1)`,
      [newUsername]
    );
    await client.query('COMMIT');
    return { oldUsername, newUsername };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Bump a user's session_version, invalidating all of their existing
 * sessions. The next authenticated request carrying an older version is
 * destroyed by requireAuth (see src/auth.js). Used by GM kick.
 */
async function bumpSessionVersion(userId) {
  await pool.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [userId]);
}

async function ownerExists() {
  const { rows } = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'");
  return Number(rows[0].n) > 0;
}

async function getPlayerCount() {
  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM users');
  return Number(rows[0].n);
}

async function getUsernamesByRole(role) {
  const { rows } = await pool.query(
    'SELECT username FROM users WHERE role = $1 ORDER BY username ASC',
    [role]
  );
  return rows.map((r) => r.username);
}

// ---------- player state ----------
async function getStateRow(userId) {
  const { rows } = await pool.query('SELECT * FROM player_state WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

/** Works with a Pool or a transaction Client (both expose .query). */
async function upsertState(q, userId, blob) {
  const level = Math.max(1, Math.floor(Number(blob.level) || 1));
  const stage = Math.max(1, Math.floor(Number(blob.stage) || 1));
  const bossesKilled = Math.max(0, Math.floor(Number(blob.bossesKilled) || 0));
  const rebirthCount = Math.max(0, Math.floor(Number(blob.rebirthCount ?? blob.prestigeCount) || 0));
  await q.query(
    `INSERT INTO player_state (user_id, level, stage, bosses_killed, rebirth_count, state_json, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET
       level = EXCLUDED.level,
       stage = EXCLUDED.stage,
       bosses_killed = EXCLUDED.bosses_killed,
       rebirth_count = EXCLUDED.rebirth_count,
       state_json = EXCLUDED.state_json,
       updated_at = EXCLUDED.updated_at`,
    [userId, level, stage, bossesKilled, rebirthCount, JSON.stringify(blob), Date.now()]
  );
}

/**
 * Save a full player state. `blob` is the sanitized state object.
 * Indexed columns are derived from the blob.
 */
async function saveState(userId, blob) {
  await upsertState(pool, userId, blob);
}

// Fixed ORDER BY fragments for leaderboard categories. Keys are validated
// against LB_CATEGORIES in gameApi.js before reaching here — never
// interpolate raw user input into SQL.
const LB_ORDERS = {
  level: 'ps.level DESC, ps.stage DESC, ps.bosses_killed DESC',
  stage: 'ps.stage DESC, ps.level DESC, ps.bosses_killed DESC',
  bosses: 'ps.bosses_killed DESC, ps.level DESC, ps.stage DESC',
  rebirths: 'ps.rebirth_count DESC, ps.level DESC, ps.stage DESC',
};

async function getLeaderboardRows(limit = 100, orderKey = 'level') {
  const order = LB_ORDERS[orderKey] || LB_ORDERS.level;
  const { rows } = await pool.query(
    `SELECT u.username, ps.level, ps.stage, ps.bosses_killed, ps.rebirth_count, ps.state_json,
            g.tag AS guild_tag
     FROM player_state ps
     JOIN users u ON u.id = ps.user_id
     LEFT JOIN guild_members gm ON LOWER(gm.username) = LOWER(u.username)
     LEFT JOIN guilds g ON g.id = gm.guild_id
     ORDER BY ${order}
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/**
 * Guild rankings for the leaderboard "Guilds" category.
 * Ordering (documented for players in the UI caption):
 *   1. Guild level (desc) — guilds level up through member activity XP.
 *   2. Total member power (desc) — sum of each member's stamped hero power
 *      from their latest save; inactive/unsaved members count as 0.
 *   3. Member count (desc).
 *   4. Oldest guild first (tiebreak for fully identical guilds).
 * Power is summed in JS (parsing each member's state_json) rather than in
 * SQL so the query stays portable and unit-testable.
 */
async function getGuildRankings(limit = 50) {
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.tag, g.level, g.xp,
            gm.username AS member_username, ps.state_json
     FROM guilds g
     LEFT JOIN guild_members gm ON gm.guild_id = g.id
     LEFT JOIN users u ON LOWER(u.username) = LOWER(gm.username)
     LEFT JOIN player_state ps ON ps.user_id = u.id
     ORDER BY g.id ASC`,
    []
  );
  const byId = new Map();
  for (const r of rows) {
    let g = byId.get(r.id);
    if (!g) {
      g = {
        id: r.id, name: r.name, tag: r.tag,
        level: Number(r.level) || 1, xp: Number(r.xp) || 0,
        memberCount: 0, totalPower: 0,
      };
      byId.set(r.id, g);
    }
    if (r.member_username != null) {
      g.memberCount += 1;
      let pw = 0;
      if (r.state_json) {
        try {
          const b = JSON.parse(r.state_json);
          if (b && Number.isFinite(b.power) && b.power >= 0) pw = Math.floor(b.power);
        } catch { /* corrupt blob counts as 0 */ }
      }
      g.totalPower += pw;
    }
  }
  return [...byId.values()]
    .sort((a, b) =>
      b.level - a.level ||
      b.totalPower - a.totalPower ||
      b.memberCount - a.memberCount ||
      a.id - b.id)
    .slice(0, Math.max(1, limit | 0));
}

// ---------- gift codes ----------
async function getGiftCode(code) {
  const { rows } = await pool.query('SELECT * FROM gift_codes WHERE code = $1', [code]);
  return rows[0] || null;
}

async function createGiftCode(code, gearSet, maxUses, createdBy, rewardKind = 'gear', rewardAmount = 0) {
  await pool.query(
    'INSERT INTO gift_codes (code, gear_set, reward_kind, reward_amount, max_uses, uses, created_by, created_at) VALUES ($1, $2, $3, $4, $5, 0, $6, $7)',
    [code, gearSet, rewardKind, rewardAmount, maxUses, createdBy, Date.now()]
  );
}

async function incrementCodeUses(code) {
  await pool.query('UPDATE gift_codes SET uses = uses + 1 WHERE code = $1', [code]);
}

async function listGiftCodes() {
  const { rows } = await pool.query(
    'SELECT code, gear_set, reward_kind, reward_amount, max_uses, uses, created_at FROM gift_codes ORDER BY created_at DESC'
  );
  return rows;
}

async function getCodeCount() {
  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM gift_codes');
  return Number(rows[0].n);
}

async function hasRedeemed(code, userId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM code_redemptions WHERE code = $1 AND user_id = $2',
    [code, userId]
  );
  return rows.length > 0;
}

async function addRedemption(code, userId) {
  await pool.query(
    'INSERT INTO code_redemptions (code, user_id, redeemed_at) VALUES ($1, $2, $3)',
    [code, userId, Date.now()]
  );
}

function redeemError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

/**
 * Redeem a gift code atomically.
 *
 * Runs in a single transaction with SELECT ... FOR UPDATE on the gift_codes
 * row, so concurrent redemptions serialize on the row lock and cannot
 * double-spend uses. `grantFn(giftCodeRow, blob)` merges the reward into the
 * player's blob (may throw to abort, e.g. invalid gear set config).
 * `defaultBlobFn()` supplies a fresh blob when the player has no saved row.
 *
 * Returns the gift_codes row. Throws errors with .code:
 *   REDEEM_NOT_FOUND | REDEEM_EXHAUSTED | REDEEM_ALREADY
 */
async function redeemGiftCode(code, userId, grantFn, defaultBlobFn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM gift_codes WHERE code = $1 FOR UPDATE',
      [code]
    );
    const giftCode = rows[0] || null;
    if (!giftCode) throw redeemError('REDEEM_NOT_FOUND');
    if (giftCode.uses >= giftCode.max_uses) throw redeemError('REDEEM_EXHAUSTED');
    const dup = await client.query(
      'SELECT 1 FROM code_redemptions WHERE code = $1 AND user_id = $2',
      [code, userId]
    );
    if (dup.rows.length > 0) throw redeemError('REDEEM_ALREADY');

    const srow = await client.query(
      'SELECT state_json FROM player_state WHERE user_id = $1',
      [userId]
    );
    let blob = null;
    if (srow.rows.length > 0) {
      try {
        const parsed = JSON.parse(srow.rows[0].state_json);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) blob = parsed;
      } catch {
        // fall through to default blob
      }
    }
    if (!blob) blob = defaultBlobFn();
    blob = grantFn(giftCode, blob) || blob;
    const sanitized = sanitizeStateBlob(blob);
    await upsertState(client, userId, sanitized.ok ? sanitized.state : blob);

    await client.query('UPDATE gift_codes SET uses = uses + 1 WHERE code = $1', [code]);
    await client.query(
      'INSERT INTO code_redemptions (code, user_id, redeemed_at) VALUES ($1, $2, $3)',
      [code, userId, Date.now()]
    );
    await client.query('COMMIT');
    return giftCode;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors; the original error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------- server settings ----------
// Owner-tunable key/value settings (e.g. gold_cap). The gold cap is cached
// in-process and invalidated on write; refreshGoldCap() pushes it into the
// validation module so state saves clamp gold to the live value.
const DEFAULT_GOLD_CAP = 9.99e44; // 999Td (was 999Dc)
let goldCapCache = null;

async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM server_settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : null;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO server_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
  if (key === 'gold_cap') goldCapCache = null;
}

async function getGoldCap() {
  if (goldCapCache == null) {
    const raw = Number(await getSetting('gold_cap'));
    // Migrate old 999Dc cap to new 999Td default
    if (raw === 9.99e35) {
      await setSetting('gold_cap', String(Math.floor(DEFAULT_GOLD_CAP)));
      goldCapCache = DEFAULT_GOLD_CAP;
    } else {
      goldCapCache = Number.isFinite(raw) && raw >= 1e12 ? raw : DEFAULT_GOLD_CAP;
    }
  }
  return goldCapCache;
}

/** Push the live gold cap into src/validation.js (called at boot and on change). */
async function refreshGoldCap() {
  const { setGoldCap } = require('./validation');
  setGoldCap(await getGoldCap());
}

/** Rank ladder: master > officer > member > initiate. */
const GUILD_RANKS = { initiate: 1, member: 2, officer: 3, master: 4 };
const GUILD_RANK_NAMES = ['initiate', 'member', 'officer', 'master'];
const GUILD_MAX_LEVEL = 20;

/** Cumulative guild XP required to reach `level` (level 1 = 0). */
function xpForGuildLevel(level) {
  const L = Math.max(1, Math.floor(level));
  if (L <= 1) return 0;
  return 250 * (L - 1) * L;
}

function guildLevelForXp(xp) {
  let level = 1;
  const total = Math.max(0, Math.floor(xp || 0));
  while (level < GUILD_MAX_LEVEL && total >= xpForGuildLevel(level + 1)) level++;
  return level;
}

/**
 * Perks granted by guild level + Guild Hall buildings:
 * +2% XP per level, +1% gold per level, +1% damage per 2 levels.
 * Hall of Valor: +1% XP and +2% damage per building level.
 * Treasury: +2% gold per building level.
 * Forge Shrine: +3% mining yield per building level (new minePct perk).
 * Building levels are capped at 10.
 */
function guildPerks(level, hall) {
  const L = Math.max(1, Math.min(GUILD_MAX_LEVEL, Math.floor(level || 1)));
  // Safety: clamp hall levels to 0..10 (defensive against bad data).
  const h = hall || {};
  const valor = Math.max(0, Math.min(10, Math.floor(h.valor || 0)));
  const treasury = Math.max(0, Math.min(10, Math.floor(h.treasury || 0)));
  const forge = Math.max(0, Math.min(10, Math.floor(h.forge || 0)));
  return {
    xpPct: 2 * L + valor,
    goldPct: L + treasury * 2,
    dmgPct: Math.floor(L / 2) + valor * 2,
    minePct: forge * 3,
  };
}

/** Perks for a specific guild id (null when guild unknown). */
async function getGuildPerksFor(guildId) {
  const { rows } = await pool.query(
    'SELECT level, hall_valor_level, hall_treasury_level, hall_forge_level FROM guilds WHERE id = $1',
    [guildId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return guildPerks(r.level, {
    valor: r.hall_valor_level,
    treasury: r.hall_treasury_level,
    forge: r.hall_forge_level,
  });
}

/** Monday 00:00 UTC of the week containing `nowMs`. */
function weekStartMs(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const back = (d.getUTCDay() + 6) % 7; // Monday -> 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
}

const CHALLENGE_DEFS = [
  { kind: 'bosses', name: 'Boss Hunt', desc: 'Slay bosses as a guild', target: 40, emoji: '👹' },
  { kind: 'kills', name: 'Extermination', desc: 'Slay enemies as a guild', target: 10000, emoji: '⚔️' },
  { kind: 'quests', name: 'Dutiful', desc: 'Complete quests as a guild', target: 25, emoji: '📜' },
];

/** Ensure this week's challenge rows exist; returns the week's rows. */
async function getGuildChallenges(guildId) {
  const ws = weekStartMs();
  for (const def of CHALLENGE_DEFS) {
    await pool.query(
      `INSERT INTO guild_challenges (guild_id, week_start, kind, target)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id, week_start, kind) DO NOTHING`,
      [guildId, ws, def.kind, def.target]
    );
  }
  const { rows } = await pool.query(
    'SELECT kind, target, progress, completed FROM guild_challenges WHERE guild_id = $1 AND week_start = $2',
    [guildId, ws]
  );
  return rows.map((r) => {
    const def = CHALLENGE_DEFS.find((d) => d.kind === r.kind) || {};
    return {
      kind: r.kind,
      name: def.name || r.kind,
      desc: def.desc || '',
      emoji: def.emoji || '🏰',
      target: Number(r.target),
      progress: Number(r.progress),
      completed: !!r.completed,
    };
  });
}

async function addGuildXp(guildId, amount) {
  const amt = Math.max(0, Math.floor(amount || 0));
  if (amt <= 0) return { leveledUp: false, level: 1 };
  const { rows } = await pool.query(
    'UPDATE guilds SET xp = xp + $2 WHERE id = $1 RETURNING xp, level',
    [guildId, amt]
  );
  if (!rows.length) return { leveledUp: false, level: 1 };
  const newLevel = guildLevelForXp(Number(rows[0].xp));
  const leveledUp = newLevel > Number(rows[0].level);
  if (leveledUp) {
    await pool.query('UPDATE guilds SET level = $2 WHERE id = $1', [guildId, newLevel]);
    await addGuildNews(guildId, 'levelup', `The guild reached level ${newLevel}! New perks unlocked.`);
  }
  return { leveledUp, level: newLevel };
}

/**
 * Record member activity (from save deltas): awards guild XP, advances
 * weekly challenges, and grants personal guild credits.
 * Deltas must already be clamped >= 0 by the caller.
 */
async function recordMemberActivity(username, deltas) {
  const kills = Math.max(0, Math.floor((deltas && deltas.kills) || 0));
  const bosses = Math.max(0, Math.floor((deltas && deltas.bosses) || 0));
  const quests = Math.max(0, Math.floor((deltas && deltas.quests) || 0));
  if (!kills && !bosses && !quests) return;
  const mem = await pool.query(
    'SELECT guild_id FROM guild_members WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  if (!mem.rows.length) return;
  const guildId = mem.rows[0].guild_id;
  // Cap per-save contribution so a single inflated save can't spike the guild.
  const xpGain = Math.min(5000, kills * 1 + bosses * 25 + quests * 10);
  if (xpGain > 0) {
    await addGuildXp(guildId, xpGain);
    await pool.query(
      'UPDATE guild_members SET credits = credits + $2 WHERE guild_id = $1 AND LOWER(username) = LOWER($3)',
      [guildId, Math.floor(xpGain / 10), username]
    );
  }
  // Weekly challenges.
  const ws = weekStartMs();
  await getGuildChallenges(guildId); // ensure rows exist
  const inc = { bosses, kills, quests };
  for (const [kind, amount] of Object.entries(inc)) {
    if (amount <= 0) continue;
    const { rows } = await pool.query(
      `UPDATE guild_challenges SET progress = progress + $4
       WHERE guild_id = $1 AND week_start = $2 AND kind = $3 AND completed = FALSE
       RETURNING progress, target`,
      [guildId, ws, kind, amount]
    );
    if (rows.length && Number(rows[0].progress) >= Number(rows[0].target)) {
      await pool.query(
        'UPDATE guild_challenges SET completed = TRUE, progress = target WHERE guild_id = $1 AND week_start = $2 AND kind = $3',
        [guildId, ws, kind]
      );
      const def = CHALLENGE_DEFS.find((d) => d.kind === kind);
      await addGuildNews(guildId, 'challenge', `Weekly challenge complete: ${def ? def.name : kind}! The guild earned bonus XP.`);
      await addGuildXp(guildId, 500);
    }
  }
}

// ---------- multiplayer parties ----------
// Invite-code parties: 4 roster slots shared by humans + NPC allies.
// Humans are rows with is_npc=false — a partial unique index enforces one
// party per human. Each member's owned NPC allies (from their save blob's
// state.party) attach as rows with is_npc=true, npc_id=<companion uid>.
// NPC ownership always lives in the save blob; rows are only the active
// multiplayer roster and re-sync on every save, so recruit/dismiss/level-up
// can't desync. A joining human bumps the oldest NPC rows before the party
// reports "full"; bumped NPCs stay owned in the save.
const PARTY_MAX_HUMANS = 4;
const PARTY_MAX_SLOTS = 4;
const PARTY_ONLINE_MS = 5 * 60 * 1000;
const PARTY_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const PARTY_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/; // same unambiguous alphabet as generation


function partyError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function randomPartyCode() {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += PARTY_CODE_ALPHABET[Math.floor(Math.random() * PARTY_CODE_ALPHABET.length)];
  }
  return s;
}

/** Human membership only (is_npc=false). Returns party_id or null. */
async function getMyPartyId(userId) {
  const { rows } = await pool.query(
    'SELECT party_id FROM party_members WHERE user_id = $1 AND is_npc = false',
    [userId]
  );
  return rows.length ? rows[0].party_id : null;
}

/** Owned NPC ally uids, read live from the player's save blob (state.party). */
async function readOwnedNpcIds(userId) {
  const { rows } = await pool.query('SELECT state_json FROM player_state WHERE user_id = $1', [userId]);
  if (!rows.length) return [];
  try {
    const blob = JSON.parse(rows[0].state_json);
    const party = blob && Array.isArray(blob.party) ? blob.party : [];
    return party.map(n => String((n && n.id) || '')).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Re-sync one member's NPC rows with what they actually own: delete their
 * current NPC rows, then re-attach owned allies into free roster slots.
 * Called on every save, on create, and on join. Never touches other members'
 * rows, and never removes anything from the save blob.
 */
async function syncPartyNpcs(userId) {
  const partyId = await getMyPartyId(userId);
  if (!partyId) return;
  const owned = await readOwnedNpcIds(userId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT id FROM parties WHERE id = $1 FOR UPDATE', [partyId]);
    if (!lock.rows.length) { await client.query('ROLLBACK'); return; }
    await client.query(
      'DELETE FROM party_members WHERE party_id = $1 AND user_id = $2 AND is_npc = true',
      [partyId, userId]
    );
    const { rows } = await client.query(
      'SELECT COUNT(*) AS n FROM party_members WHERE party_id = $1', [partyId]
    );
    let free = PARTY_MAX_SLOTS - Number(rows[0].n);
    const now = Date.now();
    for (const npcId of owned) {
      if (free <= 0) break;
      await client.query(
        'INSERT INTO party_members (party_id, user_id, is_npc, npc_id, joined_at) VALUES ($1, $2, true, $3, $4)',
        [partyId, userId, npcId, now]
      );
      free--;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Bump the oldest NPC rows while the roster exceeds the slot cap. */
async function trimNpcRows(client, partyId) {
  const { rows } = await client.query(
    'SELECT COUNT(*) AS n FROM party_members WHERE party_id = $1', [partyId]
  );
  const over = Number(rows[0].n) - PARTY_MAX_SLOTS;
  if (over <= 0) return;
  const victims = await client.query(
    `SELECT user_id, npc_id FROM party_members
     WHERE party_id = $1 AND is_npc = true
     ORDER BY joined_at ASC LIMIT $2`,
    [partyId, over]
  );
  for (const v of victims.rows) {
    await client.query(
      'DELETE FROM party_members WHERE party_id = $1 AND user_id = $2 AND npc_id = $3 AND is_npc = true',
      [partyId, v.user_id, v.npc_id]
    );
  }
}

async function createParty(userId) {
  if (await getMyPartyId(userId)) throw partyError('PARTY_ALREADY_IN');
  // Retry on the (unlikely) code collision.
  let created = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomPartyCode();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        'INSERT INTO parties (code, leader_id, created_at) VALUES ($1, $2, $3) RETURNING id, code',
        [code, userId, Date.now()]
      );
      await client.query(
        "INSERT INTO party_members (party_id, user_id, is_npc, npc_id, joined_at) VALUES ($1, $2, false, '', $3)",
        [ins.rows[0].id, userId, Date.now()]
      );
      await client.query('COMMIT');
      created = { id: ins.rows[0].id, code: ins.rows[0].code };
      break;
    } catch (e) {
      await client.query('ROLLBACK');
      // Code collision -> try another code. Human-uniqueness violation means
      // the player joined a party between our check and the insert.
      if (e && e.code === '23505' && e.constraint === 'parties_code_key') continue;
      if (e && e.code === '23505') throw partyError('PARTY_ALREADY_IN');
      throw e;
    } finally {
      client.release();
    }
  }
  if (!created) throw partyError('PARTY_CODE_COLLISION');
  await syncPartyNpcs(userId); // attach the founder's NPC allies
  return created;
}

async function joinPartyByCode(userId, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!PARTY_CODE_RE.test(code)) throw partyError('PARTY_NOT_FOUND');
  if (await getMyPartyId(userId)) throw partyError('PARTY_ALREADY_IN');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the party row so two simultaneous joins can't exceed the cap.
    const p = await client.query('SELECT id FROM parties WHERE code = $1 FOR UPDATE', [code]);
    if (!p.rows.length) throw partyError('PARTY_NOT_FOUND');
    const partyId = p.rows[0].id;
    const cnt = await client.query(
      'SELECT COUNT(*) AS n FROM party_members WHERE party_id = $1 AND is_npc = false',
      [partyId]
    );
    if (Number(cnt.rows[0].n) >= PARTY_MAX_HUMANS) throw partyError('PARTY_FULL');
    await client.query(
      "INSERT INTO party_members (party_id, user_id, is_npc, npc_id, joined_at) VALUES ($1, $2, false, '', $3)",
      [partyId, userId, Date.now()]
    );
    // Humans take priority: bump the oldest NPC rows to make room.
    await trimNpcRows(client, partyId);
    await client.query('COMMIT');
    return { id: partyId, code };
  } catch (e) {
    await client.query('ROLLBACK');
    if (e && e.code === '23505') throw partyError('PARTY_ALREADY_IN');
    throw e;
  } finally {
    client.release();
  }
}

/** Removes the member's human row AND their NPC rows; promotes/deletes as needed. */
async function removePartyMember(client, partyId, userId) {
  await client.query(
    'DELETE FROM party_members WHERE party_id = $1 AND user_id = $2',
    [partyId, userId]
  );
  const p = await client.query('SELECT leader_id FROM parties WHERE id = $1', [partyId]);
  if (!p.rows.length) return { disbanded: true };
  const remaining = await client.query(
    'SELECT user_id FROM party_members WHERE party_id = $1 AND is_npc = false ORDER BY joined_at ASC',
    [partyId]
  );
  if (!remaining.rows.length) {
    await client.query('DELETE FROM parties WHERE id = $1', [partyId]);
    return { disbanded: true };
  }
  if (Number(p.rows[0].leader_id) === Number(userId)) {
    await client.query('UPDATE parties SET leader_id = $1 WHERE id = $2', [remaining.rows[0].user_id, partyId]);
  }
  return { disbanded: false };
}

async function leaveParty(userId) {
  const partyId = await getMyPartyId(userId);
  if (!partyId) throw partyError('PARTY_NOT_IN');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM parties WHERE id = $1 FOR UPDATE', [partyId]);
    const res = await removePartyMember(client, partyId, userId);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function kickPartyMember(leaderId, targetUserId) {
  const partyId = await getMyPartyId(leaderId);
  if (!partyId) throw partyError('PARTY_NOT_IN');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM parties WHERE id = $1 FOR UPDATE', [partyId]);
    const p = await client.query('SELECT leader_id FROM parties WHERE id = $1', [partyId]);
    if (!p.rows.length || Number(p.rows[0].leader_id) !== Number(leaderId)) {
      throw partyError('PARTY_NOT_LEADER');
    }
    if (Number(targetUserId) === Number(leaderId)) throw partyError('PARTY_CANNOT_KICK_SELF');
    const mem = await client.query(
      'SELECT 1 FROM party_members WHERE party_id = $1 AND user_id = $2 AND is_npc = false',
      [partyId, targetUserId]
    );
    if (!mem.rows.length) throw partyError('PARTY_TARGET_NOT_IN');
    const res = await removePartyMember(client, partyId, Number(targetUserId));
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function disbandParty(leaderId) {
  const partyId = await getMyPartyId(leaderId);
  if (!partyId) throw partyError('PARTY_NOT_IN');
  const { rowCount } = await pool.query(
    'DELETE FROM parties WHERE id = $1 AND leader_id = $2',
    [partyId, leaderId]
  );
  if (!rowCount) throw partyError('PARTY_NOT_LEADER');
  return { disbanded: true };
}

async function promotePartyLeader(leaderId, targetUserId) {
  const partyId = await getMyPartyId(leaderId);
  if (!partyId) throw partyError('PARTY_NOT_IN');
  if (Number(targetUserId) === Number(leaderId)) throw partyError('PARTY_CANNOT_PROMOTE_SELF');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM parties WHERE id = $1 FOR UPDATE', [partyId]);
    const p = await client.query('SELECT leader_id FROM parties WHERE id = $1', [partyId]);
    if (!p.rows.length || Number(p.rows[0].leader_id) !== Number(leaderId)) {
      throw partyError('PARTY_NOT_LEADER');
    }
    const mem = await client.query(
      'SELECT 1 FROM party_members WHERE party_id = $1 AND user_id = $2 AND is_npc = false',
      [partyId, targetUserId]
    );
    if (!mem.rows.length) throw partyError('PARTY_TARGET_NOT_IN');
    await client.query('UPDATE parties SET leader_id = $1 WHERE id = $2', [Number(targetUserId), partyId]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Full party view for a member. Humans and NPC allies are FLAT rows in
 * members[]: humans carry isNpc:false + server-read stats, NPC allies carry
 * isNpc:true + npcId + owner fields (name/level read live from the owner's
 * save blob). `online` = save updated within PARTY_ONLINE_MS. Bonuses are
 * computed server-side from DB truth — the client never supplies them:
 * +8% XP / +5% gold per other online human, +4% XP per own active NPC ally.
 */
async function getPartyView(userId) {
  const partyId = await getMyPartyId(userId);
  if (!partyId) return null;
  const p = await pool.query('SELECT id, code, leader_id FROM parties WHERE id = $1', [partyId]);
  if (!p.rows.length) return null;
  const party = p.rows[0];
  const { rows } = await pool.query(
    `SELECT m.user_id, m.is_npc, m.npc_id, m.joined_at, u.username,
            ps.level, ps.stage, ps.updated_at, ps.state_json
     FROM party_members m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN player_state ps ON ps.user_id = m.user_id
     WHERE m.party_id = $1
     ORDER BY m.joined_at ASC`,
    [partyId]
  );
  const now = Date.now();
  const members = rows.map(r => {
    let blob = {};
    try { blob = JSON.parse(r.state_json || '{}'); } catch { /* use defaults */ }
    const online = Number(r.updated_at) > now - PARTY_ONLINE_MS;
    if (!r.is_npc) {
      const style = nameStyleOf(blob);
      return {
        isNpc: false,
        userId: r.user_id,
        username: r.username,
        level: Number(r.level) || 1,
        stage: Number(r.stage) || 1,
        playerClass: blob.playerClass || null,
        race: blob.race || null,
        country: blob.country || null,
        activeTitle: blob.activeTitle || null,
        nameColor: style.nameColor,
        nameFx: style.nameFx,
        online,
        isLeader: Number(r.user_id) === Number(party.leader_id),
      };
    }
    const owned = Array.isArray(blob.party) ? blob.party : [];
    const n = owned.find(x => String(x.id) === String(r.npc_id));
    return {
      isNpc: true,
      npcId: r.npc_id,
      ownerUserId: r.user_id,
      ownerUsername: r.username,
      name: (n && n.name) || 'Ally',
      emoji: (n && n.emoji) || '\u{1F6E1}️',
      level: (n && Number(n.level)) || 1,
      online,
    };
  });
  const onlineOtherHumans = members.filter(
    m => !m.isNpc && m.online && Number(m.userId) !== Number(userId)
  ).length;
  const activeNpcs = members.filter(
    m => m.isNpc && Number(m.ownerUserId) === Number(userId)
  ).length;
  const bonuses = {
    onlineOtherHumans,
    activeNpcs,
    xpPct: onlineOtherHumans * 8 + activeNpcs * 4,
    goldPct: onlineOtherHumans * 5,
  };
  const leader = members.find(m => !m.isNpc && m.isLeader);
  return {
    id: party.id,
    code: party.code,
    leaderId: Number(party.leader_id),
    leaderUsername: leader ? leader.username : null,
    members,
    bonuses,
  };
}

function guildError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

/**
 * Create a guild and make the creator its leader.
 * Throws errors with .code: GUILD_NAME_TAKEN | GUILD_ALREADY_IN
 */
async function createGuild(name, tag, ownerUsername) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inGuild = await client.query(
      'SELECT 1 FROM guild_members WHERE LOWER(username) = LOWER($1)',
      [ownerUsername]
    );
    if (inGuild.rows.length > 0) throw guildError('GUILD_ALREADY_IN');
    const taken = await client.query(
      'SELECT 1 FROM guilds WHERE LOWER(name) = LOWER($1)',
      [name]
    );
    if (taken.rows.length > 0) throw guildError('GUILD_NAME_TAKEN');
    const { rows } = await client.query(
      'INSERT INTO guilds (name, tag, owner_username) VALUES ($1, $2, $3) RETURNING *',
      [name, tag, ownerUsername]
    );
    await client.query(
      "INSERT INTO guild_members (guild_id, username, rank) VALUES ($1, $2, 'master')",
      [rows[0].id, ownerUsername]
    );
    await client.query('COMMIT');
    await addGuildNews(rows[0].id, 'join', `${ownerUsername} founded the guild.`);
    return rows[0];
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors; the original error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}

async function getGuildByName(name) {
  const { rows } = await pool.query(
    'SELECT * FROM guilds WHERE LOWER(name) = LOWER($1)',
    [name]
  );
  return rows[0] || null;
}

/** The guild a player belongs to, with their rank as my_rank. Null if none. */
async function getMyGuild(username) {
  const { rows } = await pool.query(
    `SELECT g.*, m.rank AS my_rank, m.credits AS my_credits, m.title AS my_title
     FROM guild_members m
     JOIN guilds g ON g.id = m.guild_id
     WHERE LOWER(m.username) = LOWER($1)`,
    [username]
  );
  return rows[0] || null;
}

/**
 * Roster ordered by rank (highest first) then join date. Includes level,
 * stage, class/spec, and last-active timestamp for online status.
 */
async function getGuildRoster(guildId) {
  const { rows } = await pool.query(
    `SELECT m.username, m.rank, m.joined_at, m.credits, m.title,
            ps.level, ps.stage, ps.updated_at AS last_active, ps.state_json,
            u.role AS user_role, u.created_at AS user_created
     FROM guild_members m
     LEFT JOIN users u ON LOWER(u.username) = LOWER(m.username)
     LEFT JOIN player_state ps ON ps.user_id = u.id
     WHERE m.guild_id = $1
     ORDER BY
       CASE m.rank WHEN 'master' THEN 0 WHEN 'officer' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
       m.joined_at ASC`,
    [guildId]
  );
  return rows.map((r) => {
    let playerClass = null;
    let spec = null;
    let nameColor = null;
    let nameFx = 'none';
    if (r.state_json) {
      try {
        const s = JSON.parse(r.state_json);
        playerClass = s.playerClass || null;
        spec = s.spec || null;
        const style = nameStyleOf(s);
        nameColor = style.nameColor;
        nameFx = style.nameFx;
      } catch { /* ignore corrupt blob */ }
    }
    return {
      username: r.username,
      rank: r.rank,
      joined_at: r.joined_at,
      title: r.title || null,
      role: r.user_role || 'player',
      createdAt: r.user_created || null,
      level: r.level == null ? null : Number(r.level),
      stage: r.stage == null ? null : Number(r.stage),
      playerClass,
      spec,
      nameColor,
      nameFx,
      lastActive: r.last_active == null ? null : Number(r.last_active),
    };
  });
}

/** Throws errors with .code: GUILD_ALREADY_IN */
async function joinGuild(guildId, username) {
  const inGuild = await pool.query(
    'SELECT 1 FROM guild_members WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  if (inGuild.rows.length > 0) throw guildError('GUILD_ALREADY_IN');
  await pool.query(
    "INSERT INTO guild_members (guild_id, username, rank) VALUES ($1, $2, 'initiate')",
    [guildId, username]
  );
  await addGuildNews(guildId, 'join', `${username} joined the guild.`);
}

/**
 * Leave the current guild. If the master leaves and members remain, the
 * earliest-joined remaining member is promoted to master. If the last
 * member leaves, the guild is deleted.
 * Throws errors with .code: GUILD_NOT_IN
 * Returns { guildDeleted, guildName }.
 */
/**
 * Invite a player to the inviter's guild. The inviter must be an officer or
 * the guild master. The target must be a registered user who is not already
 * in a guild and has no pending invite to this guild.
 * Throws errors with .code: GUILD_NOT_IN | GUILD_NO_PERMISSION |
 * GUILD_USER_NOT_FOUND | GUILD_ALREADY_IN | GUILD_ALREADY_INVITED
 * Returns the invite row.
 */
async function inviteToGuild(inviterUsername, targetUsername) {
  const clean = String(targetUsername || '').trim();
  if (!clean) throw guildError('GUILD_USER_NOT_FOUND');
  const inviter = await getMyGuild(inviterUsername);
  if (!inviter) throw guildError('GUILD_NOT_IN');
  const inviterRank = (GUILD_RANKS[inviter.my_rank] || 0);
  if (inviterRank < GUILD_RANKS.officer) throw guildError('GUILD_NO_PERMISSION');
  const target = await getUserByUsername(clean);
  if (!target) throw guildError('GUILD_USER_NOT_FOUND');
  if (String(target.username).toLowerCase() === String(inviterUsername).toLowerCase()) {
    throw guildError('GUILD_USER_NOT_FOUND');
  }
  const already = await pool.query(
    'SELECT 1 FROM guild_members WHERE LOWER(username) = LOWER($1)',
    [target.username]
  );
  if (already.rows.length > 0) throw guildError('GUILD_ALREADY_IN');
  const dup = await pool.query(
    'SELECT 1 FROM guild_invites WHERE guild_id = $1 AND LOWER(username) = LOWER($2)',
    [inviter.id, target.username]
  );
  if (dup.rows.length > 0) throw guildError('GUILD_ALREADY_INVITED');
  const res = await pool.query(
    'INSERT INTO guild_invites (guild_id, username, invited_by, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
    [inviter.id, target.username, inviterUsername, Date.now()]
  );
  return { id: res.rows[0].id, guildId: inviter.id, guildName: inviter.name };
}

/** Pending invites for a username (guild name + inviter included). */
async function getMyInvites(username) {
  const res = await pool.query(
    `SELECT i.id, i.guild_id, i.invited_by, i.created_at, g.name AS guild_name
     FROM guild_invites i JOIN guilds g ON g.id = i.guild_id
     WHERE LOWER(i.username) = LOWER($1) ORDER BY i.id DESC`,
    [username]
  );
  return res.rows.map((r) => ({
    id: r.id,
    guildId: r.guild_id,
    guildName: r.guild_name,
    invitedBy: r.invited_by,
    createdAt: Number(r.created_at),
  }));
}

/**
 * Accept a pending invite: joins the guild as initiate (via joinGuild, so
 * the join news entry is written) and clears all of the user's invites.
 * Throws GUILD_NOT_FOUND when the invite doesn't belong to the user.
 */
async function acceptGuildInvite(username, inviteId) {
  const res = await pool.query(
    'SELECT guild_id FROM guild_invites WHERE id = $1 AND LOWER(username) = LOWER($2)',
    [inviteId, username]
  );
  if (res.rows.length === 0) throw guildError('GUILD_NOT_FOUND');
  await joinGuild(res.rows[0].guild_id, username);
  await pool.query('DELETE FROM guild_invites WHERE LOWER(username) = LOWER($1)', [username]);
  return { guildId: res.rows[0].guild_id };
}

/** Decline a pending invite. Throws GUILD_NOT_FOUND when not owned by user. */
async function declineGuildInvite(username, inviteId) {
  const res = await pool.query(
    'DELETE FROM guild_invites WHERE id = $1 AND LOWER(username) = LOWER($2)',
    [inviteId, username]
  );
  if (res.rowCount === 0) throw guildError('GUILD_NOT_FOUND');
  return { ok: true };
}

async function leaveGuild(username) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT m.guild_id, m.rank, g.name
       FROM guild_members m
       JOIN guilds g ON g.id = m.guild_id
       WHERE LOWER(m.username) = LOWER($1)`,
      [username]
    );
    const mem = rows[0] || null;
    if (!mem) throw guildError('GUILD_NOT_IN');
    const others = await client.query(
      'SELECT username FROM guild_members WHERE guild_id = $1 AND LOWER(username) <> LOWER($2) ORDER BY joined_at ASC',
      [mem.guild_id, username]
    );
    await client.query(
      'DELETE FROM guild_members WHERE guild_id = $1 AND LOWER(username) = LOWER($2)',
      [mem.guild_id, username]
    );
    let guildDeleted = false;
    if (others.rows.length === 0) {
      await client.query('DELETE FROM guilds WHERE id = $1', [mem.guild_id]);
      guildDeleted = true;
    } else if (mem.rank === 'master') {
      await client.query(
        "UPDATE guild_members SET rank = 'master' WHERE guild_id = $1 AND LOWER(username) = LOWER($2)",
        [mem.guild_id, others.rows[0].username]
      );
      await addGuildNews(mem.guild_id, 'promote', `${others.rows[0].username} has become the new Guild Master.`, client);
    } else {
      await addGuildNews(mem.guild_id, 'leave', `${username} left the guild.`, client);
    }
    await client.query('COMMIT');
    return { guildDeleted, guildName: mem.name };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors; the original error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}

async function isInGuild(username) {
  const { rows } = await pool.query(
    'SELECT 1 FROM guild_members WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  return rows.length > 0;
}

// ============================================================
// Guild rework (2026-09-28): ranks, chat, news, XP/levels,
// perks, challenges, vendor.
// ============================================================

// ---------- credits / vendor ----------
// Cosmetic-only vendor. Credits are earned by contributing guild XP.
const GUILD_VENDOR = [
  { id: 'banner-goldflare', kind: 'banner', name: 'Goldflare Banner', desc: 'Radiant golden guild banner', cost: 250, emoji: '🌟' },
  { id: 'banner-bloodmoon', kind: 'banner', name: 'Bloodmoon Banner', desc: 'Crimson moonlit banner', cost: 500, emoji: '🌑' },
  { id: 'banner-frostbound', kind: 'banner', name: 'Frostbound Banner', desc: 'Icy blue banner of the north', cost: 500, emoji: '❄️' },
  { id: 'banner-voidveil', kind: 'banner', name: 'Voidveil Banner', desc: 'Banner woven from the void itself', cost: 1000, emoji: '🌀' },
  { id: 'title-loyal', kind: 'title', name: 'the Loyal', desc: 'Title shown beside your name in the roster', cost: 300, emoji: '🎖️' },
  { id: 'title-champion', kind: 'title', name: 'Guild Champion', desc: 'Title shown beside your name in the roster', cost: 800, emoji: '🏆' },
  { id: 'title-bane', kind: 'title', name: 'Bane of Shadows', desc: 'Title shown beside your name in the roster', cost: 1500, emoji: '👑' },
];

module.exports = {
  pool,
  buildPoolConfig,
  migrate,
  closePool,
  getUserByUsername,
  getUserById,
  createUser,
  createUserWithRole,
  setUserRole,
  bumpSessionVersion,
  updatePasswordHash,
  renameUserAccount,
  ownerExists,
  getPlayerCount,
  getUsernamesByRole,
  getStateRow,
  saveState,
  getLeaderboardRows,
  getGuildRankings,
  getRealmNetworkCounts,
  getGiftCode,
  createGiftCode,
  incrementCodeUses,
  listGiftCodes,
  getCodeCount,
  hasRedeemed,
  addRedemption,
  getSetting,
  setSetting,
  getGoldCap,
  refreshGoldCap,
  DEFAULT_GOLD_CAP,
  redeemGiftCode,
  createGuild,
  getGuildByName,
  getMyGuild,
  getGuildRoster,
  nameStyleOf,
  joinGuild,
  leaveGuild,
  isInGuild,
  // guild rework
  GUILD_RANKS,
  guildPerks,
  xpForGuildLevel,
  guildLevelForXp,
  setMemberRank,
  kickGuildMember,
  setGuildMotd,
  setGuildDescription,
  unlockGuildBanner,
  setGuildBanner,
  addGuildChat,
  getGuildChat,
  deleteGuildChat,
  addAdminChat,
  getAdminChat,
  deleteAdminChat,
  addGuildNews,
  getGuildNews,
  getGuildChallenges,
  recordMemberActivity,
  addMemberCredits,
  setMemberTitle,
  buyVendorItem,
  GUILD_VENDOR,
  getGuildPerksFor,
  getUnlockedBanners,
  inviteToGuild,
  getMyInvites,
  acceptGuildInvite,
  declineGuildInvite,
  // multiplayer parties
  createParty,
  getMyPartyId,
  joinPartyByCode,
  leaveParty,
  kickPartyMember,
  disbandParty,
  promotePartyLeader,
  getPartyView,
  syncPartyNpcs,
  PARTY_MAX_HUMANS,
  PARTY_MAX_SLOTS,
  PARTY_ONLINE_MS,
  // friends / presence
  sendFriendRequest,
  respondFriendRequest,
  getFriendshipData,
  getFriendProfiles,
  removeFriend,
  friendshipStatus,
  touchLastActive,
};

// ---------- guilds ----------
// ---------- chat ----------
async function addGuildChat(guildId, username, message) {
  const { rows } = await pool.query(
    'INSERT INTO guild_chat (guild_id, username, message, created_at) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
    [guildId, username, message, Date.now()]
  );
  // Prune to the newest 100 messages per guild.
  await pool.query(
    `DELETE FROM guild_chat WHERE guild_id = $1 AND id NOT IN
     (SELECT id FROM guild_chat WHERE guild_id = $1 ORDER BY id DESC LIMIT 100)`,
    [guildId]
  );
  return rows[0];
}

/** Delete one chat message in a guild. Returns true when a row was removed. */
async function deleteGuildChat(guildId, messageId) {
  const { rowCount } = await pool.query(
    'DELETE FROM guild_chat WHERE guild_id = $1 AND id = $2',
    [guildId, messageId]
  );
  return rowCount > 0;
}

async function getGuildChat(guildId, afterId = 0, limit = 100) {
  const { rows } = await pool.query(
    `SELECT c.id, c.username, c.message, c.created_at, ps.state_json
     FROM guild_chat c
     LEFT JOIN users u ON LOWER(u.username) = LOWER(c.username)
     LEFT JOIN player_state ps ON ps.user_id = u.id
     WHERE c.guild_id = $1 AND c.id > $2 ORDER BY c.id ASC LIMIT $3`,
    [guildId, Math.max(0, Math.floor(afterId || 0)), Math.min(100, Math.max(1, limit || 100))]
  );
  return rows.map((r) => {
    let nameColor = null;
    let nameFx = 'none';
    if (r.state_json) {
      try {
        const style = nameStyleOf(JSON.parse(r.state_json));
        nameColor = style.nameColor;
        nameFx = style.nameFx;
      } catch { /* ignore corrupt blob */ }
    }
    return {
      id: r.id,
      username: r.username,
      message: r.message,
      created_at: r.created_at,
      nameColor,
      nameFx,
    };
  });
}


// ---------- staff admin chat (owner + admin only) ----------
async function addAdminChat(username, message) {
  const { rows } = await pool.query(
    'INSERT INTO admin_chat (username, message, created_at) VALUES ($1, $2, $3) RETURNING id, created_at',
    [username, message, Date.now()]
  );
  // Prune to the newest 200 messages.
  await pool.query(
    `DELETE FROM admin_chat WHERE id NOT IN
     (SELECT id FROM admin_chat ORDER BY id DESC LIMIT 200)`
  );
  return rows[0];
}

/** Delete one admin-chat message. Returns true when a row was removed. */
async function deleteAdminChat(messageId) {
  const { rowCount } = await pool.query(
    'DELETE FROM admin_chat WHERE id = $1',
    [messageId]
  );
  return rowCount > 0;
}

async function getAdminChat(afterId = 0, limit = 100) {
  const { rows } = await pool.query(
    `SELECT c.id, c.username, c.message, c.created_at, ps.state_json
     FROM admin_chat c
     LEFT JOIN users u ON LOWER(u.username) = LOWER(c.username)
     LEFT JOIN player_state ps ON ps.user_id = u.id
     WHERE c.id > $1 ORDER BY c.id ASC LIMIT $2`,
    [Math.max(0, Math.floor(afterId || 0)), Math.min(100, Math.max(1, limit || 100))]
  );
  return rows.map((r) => {
    let nameColor = null;
    let nameFx = 'none';
    if (r.state_json) {
      try {
        const style = nameStyleOf(JSON.parse(r.state_json));
        nameColor = style.nameColor;
        nameFx = style.nameFx;
      } catch { /* ignore corrupt blob */ }
    }
    return {
      id: r.id,
      username: r.username,
      message: r.message,
      created_at: r.created_at,
      nameColor,
      nameFx,
    };
  });
}

// ---------- news ----------
async function addGuildNews(guildId, kind, text, q) {
  const db = q || pool;
  await db.query(
    'INSERT INTO guild_news (guild_id, kind, text, created_at) VALUES ($1, $2, $3, $4)',
    [guildId, kind, text, Date.now()]
  );
  await db.query(
    `DELETE FROM guild_news WHERE guild_id = $1 AND id NOT IN
     (SELECT id FROM guild_news WHERE guild_id = $1 ORDER BY id DESC LIMIT 100)`,
    [guildId]
  );
}

async function getGuildNews(guildId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, kind, text, created_at FROM guild_news
     WHERE guild_id = $1 ORDER BY id DESC LIMIT $2`,
    [guildId, Math.min(100, Math.max(1, limit || 50))]
  );
  return rows;
}

// ---------- rank management (server-enforced hierarchy) ----------
async function getMembership(guildId, username, q) {
  const db = q || pool;
  const { rows } = await db.query(
    'SELECT username, rank FROM guild_members WHERE guild_id = $1 AND LOWER(username) = LOWER($2)',
    [guildId, username]
  );
  return rows[0] || null;
}

/**
 * Change a member's rank. Throws .code: GUILD_NOT_IN | GUILD_BAD_RANK |
 * GUILD_FORBIDDEN | GUILD_SELF.
 */
async function setMemberRank(guildId, actorUsername, targetUsername, newRank) {
  if (!GUILD_RANK_NAMES.includes(newRank) || newRank === 'master') {
    throw guildError('GUILD_BAD_RANK');
  }
  if (String(actorUsername).toLowerCase() === String(targetUsername).toLowerCase()) {
    throw guildError('GUILD_SELF');
  }
  const actor = await getMembership(guildId, actorUsername);
  if (!actor || GUILD_RANKS[actor.rank] < GUILD_RANKS.officer) throw guildError('GUILD_FORBIDDEN');
  const target = await getMembership(guildId, targetUsername);
  if (!target) throw guildError('GUILD_NOT_IN');
  const aLvl = GUILD_RANKS[actor.rank];
  const tLvl = GUILD_RANKS[target.rank];
  const nLvl = GUILD_RANKS[newRank];
  // You can only manage members strictly below you, and the new rank must
  // also be strictly below you (officers: only initiate <-> member).
  if (tLvl >= aLvl || nLvl >= aLvl) throw guildError('GUILD_FORBIDDEN');
  if (target.rank === newRank) return target;
  await pool.query(
    'UPDATE guild_members SET rank = $3 WHERE guild_id = $1 AND LOWER(username) = LOWER($2)',
    [guildId, targetUsername, newRank]
  );
  const verb = nLvl > tLvl ? 'promoted' : 'demoted';
  await addGuildNews(guildId, nLvl > tLvl ? 'promote' : 'demote',
    `${target.username} was ${verb} to ${rankLabel(newRank)} by ${actor.username}.`);
  return { ...target, rank: newRank };
}

function rankLabel(rank) {
  return { master: 'Guild Master', officer: 'Officer', member: 'Member', initiate: 'Initiate' }[rank] || rank;
}

/** Remove a member. Master/officer only; target must rank below the actor. */
async function kickGuildMember(guildId, actorUsername, targetUsername) {
  if (String(actorUsername).toLowerCase() === String(targetUsername).toLowerCase()) {
    throw guildError('GUILD_SELF');
  }
  const actor = await getMembership(guildId, actorUsername);
  if (!actor || GUILD_RANKS[actor.rank] < GUILD_RANKS.officer) throw guildError('GUILD_FORBIDDEN');
  const target = await getMembership(guildId, targetUsername);
  if (!target) throw guildError('GUILD_NOT_IN');
  if (GUILD_RANKS[target.rank] >= GUILD_RANKS[actor.rank]) throw guildError('GUILD_FORBIDDEN');
  await pool.query(
    'DELETE FROM guild_members WHERE guild_id = $1 AND LOWER(username) = LOWER($2)',
    [guildId, targetUsername]
  );
  await addGuildNews(guildId, 'kick', `${target.username} was removed from the guild by ${actor.username}.`);
  return { ok: true };
}

// ---------- motd / description / banner ----------
async function setGuildMotd(guildId, motd) {
  await pool.query('UPDATE guilds SET motd = $2 WHERE id = $1', [guildId, motd]);
  await addGuildNews(guildId, 'motd', 'The Message of the Day was updated.');
}

async function setGuildDescription(guildId, description) {
  await pool.query('UPDATE guilds SET description = $2 WHERE id = $1', [guildId, description]);
}

function parseBanners(json) {
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : ['shadow'];
  } catch {
    return ['shadow'];
  }
}

async function getUnlockedBanners(guildId) {
  const { rows } = await pool.query('SELECT unlocked_banners FROM guilds WHERE id = $1', [guildId]);
  if (!rows.length) return ['shadow'];
  return parseBanners(rows[0].unlocked_banners);
}

async function unlockGuildBanner(guildId, style) {
  const unlocked = await getUnlockedBanners(guildId);
  if (!unlocked.includes(style)) {
    unlocked.push(style);
    await pool.query('UPDATE guilds SET unlocked_banners = $2 WHERE id = $1', [guildId, JSON.stringify(unlocked)]);
  }
  return unlocked;
}

async function setGuildBanner(guildId, style, actorUsername) {
  const unlocked = await getUnlockedBanners(guildId);
  if (!unlocked.includes(style)) throw guildError('GUILD_LOCKED');
  await pool.query('UPDATE guilds SET banner_style = $2 WHERE id = $1', [guildId, style]);
  await addGuildNews(guildId, 'banner', `${actorUsername} raised the ${style} banner.`);
}



async function addMemberCredits(username, amount) {
  await pool.query(
    'UPDATE guild_members SET credits = credits + $2 WHERE LOWER(username) = LOWER($1)',
    [username, Math.max(0, Math.floor(amount || 0))]
  );
}

async function setMemberTitle(username, title) {
  await pool.query(
    'UPDATE guild_members SET title = $2 WHERE LOWER(username) = LOWER($1)',
    [username, title]
  );
}

/**
 * Buy a vendor item with guild credits. Throws .code: GUILD_NOT_IN |
 * GUILD_ITEM_UNKNOWN | GUILD_NO_CREDITS.
 */
async function buyVendorItem(guildId, username, itemId) {
  const item = GUILD_VENDOR.find((i) => i.id === itemId);
  if (!item) throw guildError('GUILD_ITEM_UNKNOWN');
  const mem = await getMembership(guildId, username);
  if (!mem) throw guildError('GUILD_NOT_IN');
  const { rows } = await pool.query(
    'SELECT credits FROM guild_members WHERE guild_id = $1 AND LOWER(username) = LOWER($2)',
    [guildId, username]
  );
  const credits = rows.length ? Number(rows[0].credits) : 0;
  if (credits < item.cost) throw guildError('GUILD_NO_CREDITS');
  await pool.query(
    'UPDATE guild_members SET credits = credits - $3 WHERE guild_id = $1 AND LOWER(username) = LOWER($2)',
    [guildId, username, item.cost]
  );
  if (item.kind === 'banner') {
    await unlockGuildBanner(guildId, item.id.replace('banner-', ''));
  } else if (item.kind === 'title') {
    await setMemberTitle(username, item.name);
  }
  return { ok: true, item };
}
// ---------- friends & presence ----------
function friendError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

/** Canonical pair key: lowercased "a|b" of the alphabetically sorted pair. */
function pairKey(a, b) {
  const x = String(a).toLowerCase();
  const y = String(b).toLowerCase();
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

/**
 * Create a pending friend request from `requester` to `addressee`.
 * Throws errors with .code: FRIEND_SELF | FRIEND_NOT_FOUND | FRIEND_EXISTS
 * (FRIEND_EXISTS also covers the reverse-direction pending request).
 */
async function sendFriendRequest(requester, addressee) {
  if (String(requester).toLowerCase() === String(addressee).toLowerCase()) {
    throw friendError('FRIEND_SELF');
  }
  const target = await getUserByUsername(addressee);
  if (!target) throw friendError('FRIEND_NOT_FOUND');
  const now = Date.now();
  try {
    await pool.query(
      `INSERT INTO friendships (requester, addressee, pair_key, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', $4, $4)`,
      [requester, target.username, pairKey(requester, target.username), now]
    );
  } catch (e) {
    if (e.code === '23505') throw friendError('FRIEND_EXISTS');
    throw e;
  }
  return { username: target.username };
}

/**
 * Respond to a pending request. `addressee` is the player answering; the
 * pending request must have been sent TO them BY `requester`.
 * Throws errors with .code: FRIEND_NO_REQUEST
 */
async function respondFriendRequest(addressee, requester, accept) {
  const { rows } = await pool.query(
    'SELECT * FROM friendships WHERE pair_key = $1 AND status = $2',
    [pairKey(requester, addressee), 'pending']
  );
  const row = rows[0] || null;
  // Only the request's addressee may accept/decline it.
  if (!row || row.addressee.toLowerCase() !== String(addressee).toLowerCase()) {
    throw friendError('FRIEND_NO_REQUEST');
  }
  if (accept) {
    await pool.query(
      'UPDATE friendships SET status = $1, updated_at = $2 WHERE id = $3',
      ['accepted', Date.now(), row.id]
    );
  } else {
    await pool.query('DELETE FROM friendships WHERE id = $1', [row.id]);
  }
  return { username: row.requester };
}

/**
 * All friendships touching `username`, split into accepted friends,
 * incoming pending requests, and outgoing pending requests.
 * Returns { friends: [username], incoming: [username], outgoing: [username] }.
 */
async function getFriendshipData(username) {
  const { rows } = await pool.query(
    `SELECT requester, addressee, status FROM friendships
     WHERE LOWER(requester) = LOWER($1) OR LOWER(addressee) = LOWER($1)`,
    [username]
  );
  const me = String(username).toLowerCase();
  const friends = [];
  const incoming = [];
  const outgoing = [];
  for (const r of rows) {
    const other = String(r.requester).toLowerCase() === me ? r.addressee : r.requester;
    if (r.status === 'accepted') friends.push(other);
    else if (String(r.addressee).toLowerCase() === me) incoming.push(r.requester);
    else outgoing.push(r.addressee);
  }
  return { friends, incoming, outgoing };
}

/** Lightweight profile cards for a friend list. */
async function getFriendProfiles(usernames) {
  if (!usernames.length) return [];
  const conds = usernames.map((_, i) => `LOWER(u.username) = LOWER($${i + 1})`);
  const { rows } = await pool.query(
    `SELECT u.username, u.last_active, ps.level, ps.stage, ps.state_json
     FROM users u LEFT JOIN player_state ps ON ps.user_id = u.id
     WHERE ${conds.join(' OR ')}`,
    usernames
  );
  return rows.map((r) => {
    let playerClass = null;
    let race = null;
    let nameColor = null;
    let nameFx = 'none';
    let title = null;
    try {
      const blob = JSON.parse(r.state_json || '{}');
      if (blob && typeof blob.playerClass === 'string') playerClass = blob.playerClass;
      if (blob && typeof blob.race === 'string') race = blob.race;
      if (blob && typeof blob.activeTitle === 'string') title = blob.activeTitle;
      const style = nameStyleOf(blob);
      nameColor = style.nameColor;
      nameFx = style.nameFx;
    } catch { /* leave null */ }
    return {
      username: r.username,
      level: r.level == null ? 1 : r.level,
      stage: r.stage == null ? 1 : r.stage,
      playerClass,
      race,
      nameColor,
      nameFx,
      title,
      lastActive: Number(r.last_active) || 0,
    };
  });
}

/**
 * Remove a friendship (or pending request) between two players, either direction.
 * Throws errors with .code: FRIEND_NOT_FOUND
 */
async function removeFriend(username, other) {
  const { rowCount } = await pool.query(
    'DELETE FROM friendships WHERE pair_key = $1',
    [pairKey(username, other)]
  );
  if (!rowCount) throw friendError('FRIEND_NOT_FOUND');
}

/** Relationship of `me` to `other`: 'self' | 'friends' | 'incoming' | 'outgoing' | 'none'. */
async function friendshipStatus(me, other) {
  if (String(me).toLowerCase() === String(other).toLowerCase()) return 'self';
  const { rows } = await pool.query(
    'SELECT requester, addressee, status FROM friendships WHERE pair_key = $1',
    [pairKey(me, other)]
  );
  const r = rows[0];
  if (!r) return 'none';
  if (r.status === 'accepted') return 'friends';
  return String(r.requester).toLowerCase() === String(me).toLowerCase() ? 'outgoing' : 'incoming';
}

/**
 * Refresh a user's last_active, throttled to once per minute (the WHERE
 * clause makes it a no-op read most of the time). Called from requireAuth.
 */
async function touchLastActive(userId) {
  const now = Date.now();
  await pool.query(
    'UPDATE users SET last_active = $1 WHERE id = $2 AND last_active < $3',
    [now, userId, now - 60000]
  );
}

// Active within this window counts as "online" for the Realm Network.
const REALM_ACTIVE_MS = 15 * 60 * 1000;

/**
 * Global Player Origins aggregate: players whose save was updated within
 * REALM_ACTIVE_MS, grouped by country code. Returns
 * [{ region, count }] sorted by count desc. Aggregate only — no usernames,
 * no individual data. Players without a valid country land in '??'.
 */
async function getRealmNetworkCounts() {
  const { rows } = await pool.query(
    'SELECT ps.state_json FROM player_state ps WHERE ps.updated_at > $1',
    [Date.now() - REALM_ACTIVE_MS]
  );
  const counts = new Map();
  for (const r of rows) {
    let blob = {};
    try { blob = JSON.parse(r.state_json || '{}'); } catch { /* treat as unknown */ }
    const code = typeof blob.country === 'string' ? blob.country.toUpperCase() : '';
    const region = /^[A-Z]{2}$/.test(code) ? code : '??';
    counts.set(region, (counts.get(region) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count || (a.region < b.region ? -1 : 1));
}
