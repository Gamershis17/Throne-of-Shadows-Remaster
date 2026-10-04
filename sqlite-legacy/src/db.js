'use strict';

/**
 * SQLite database layer (better-sqlite3).
 * DB file: ./data/game.db (relative to project root), WAL journal mode.
 * All access goes through prepared statements.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'game.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS player_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1,
  stage INTEGER NOT NULL DEFAULT 1,
  bosses_killed INTEGER NOT NULL DEFAULT 0,
  prestige_count INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gift_codes (
  code TEXT PRIMARY KEY,
  gear_set TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS code_redemptions (
  code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  redeemed_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);
`);

// ---------- users ----------
const stmtGetUserByUsername = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
const stmtGetUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const stmtCreateUser = db.prepare(
  "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'player', ?)"
);
const stmtSetUserRole = db.prepare('UPDATE users SET role = ? WHERE id = ?');
const stmtOwnerExists = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'");
const stmtPlayerCount = db.prepare('SELECT COUNT(*) AS n FROM users');
const stmtUsersByRole = db.prepare('SELECT username FROM users WHERE role = ? ORDER BY username ASC');

function getUserByUsername(username) {
  return stmtGetUserByUsername.get(username) || null;
}
function getUserById(id) {
  return stmtGetUserById.get(id) || null;
}
function createUser(username, passwordHash) {
  const info = stmtCreateUser.run(username, passwordHash, Date.now());
  return getUserById(info.lastInsertRowid);
}
function setUserRole(userId, role) {
  stmtSetUserRole.run(role, userId);
}
function ownerExists() {
  return stmtOwnerExists.get().n > 0;
}
function getPlayerCount() {
  return stmtPlayerCount.get().n;
}
function getUsernamesByRole(role) {
  return stmtUsersByRole.all(role).map((r) => r.username);
}

// ---------- player state ----------
const stmtGetState = db.prepare('SELECT * FROM player_state WHERE user_id = ?');
const stmtUpsertState = db.prepare(`
  INSERT INTO player_state (user_id, level, stage, bosses_killed, prestige_count, state_json, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    level = excluded.level,
    stage = excluded.stage,
    bosses_killed = excluded.bosses_killed,
    prestige_count = excluded.prestige_count,
    state_json = excluded.state_json,
    updated_at = excluded.updated_at
`);
const stmtLeaderboard = db.prepare(`
  SELECT u.username, ps.level, ps.stage, ps.bosses_killed, ps.prestige_count, ps.state_json
  FROM player_state ps
  JOIN users u ON u.id = ps.user_id
  ORDER BY ps.level DESC, ps.stage DESC, ps.bosses_killed DESC
  LIMIT ?
`);

function getStateRow(userId) {
  return stmtGetState.get(userId) || null;
}

/**
 * Save a full player state. `blob` is the sanitized state object.
 * Indexed columns are derived from the blob.
 */
function saveState(userId, blob) {
  const level = Math.max(1, Math.floor(Number(blob.level) || 1));
  const stage = Math.max(1, Math.floor(Number(blob.stage) || 1));
  const bossesKilled = Math.max(0, Math.floor(Number(blob.bossesKilled) || 0));
  const prestigeCount = Math.max(0, Math.floor(Number(blob.prestigeCount) || 0));
  stmtUpsertState.run(
    userId,
    level,
    stage,
    bossesKilled,
    prestigeCount,
    JSON.stringify(blob),
    Date.now()
  );
}

function getLeaderboardRows(limit = 100) {
  return stmtLeaderboard.all(limit);
}

// ---------- gift codes ----------
const stmtGetCode = db.prepare('SELECT * FROM gift_codes WHERE code = ?');
const stmtCreateCode = db.prepare(
  'INSERT INTO gift_codes (code, gear_set, max_uses, uses, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?)'
);
const stmtIncrementUses = db.prepare('UPDATE gift_codes SET uses = uses + 1 WHERE code = ?');
const stmtListCodes = db.prepare(
  'SELECT code, gear_set, max_uses, uses, created_at FROM gift_codes ORDER BY created_at DESC'
);
const stmtCodeCount = db.prepare('SELECT COUNT(*) AS n FROM gift_codes');
const stmtHasRedeemed = db.prepare('SELECT 1 FROM code_redemptions WHERE code = ? AND user_id = ?');
const stmtAddRedemption = db.prepare(
  'INSERT INTO code_redemptions (code, user_id, redeemed_at) VALUES (?, ?, ?)'
);

function getGiftCode(code) {
  return stmtGetCode.get(code) || null;
}
function createGiftCode(code, gearSet, maxUses, createdBy) {
  stmtCreateCode.run(code, gearSet, maxUses, createdBy, Date.now());
}
function incrementCodeUses(code) {
  stmtIncrementUses.run(code);
}
function listGiftCodes() {
  return stmtListCodes.all();
}
function getCodeCount() {
  return stmtCodeCount.get().n;
}
function hasRedeemed(code, userId) {
  return !!stmtHasRedeemed.get(code, userId);
}
function addRedemption(code, userId) {
  stmtAddRedemption.run(code, userId, Date.now());
}

module.exports = {
  db,
  getUserByUsername,
  getUserById,
  createUser,
  setUserRole,
  ownerExists,
  getPlayerCount,
  getUsernamesByRole,
  getStateRow,
  saveState,
  getLeaderboardRows,
  getGiftCode,
  createGiftCode,
  incrementCodeUses,
  listGiftCodes,
  getCodeCount,
  hasRedeemed,
  addRedemption,
};
