'use strict';

/**
 * Player-facing game API:
 *   GET  /api/state        (auth)
 *   POST /api/state        (auth)
 *   GET  /api/leaderboard  (public)
 *   POST /api/redeem       (auth)
 */

const express = require('express');
const { requireAuth } = require('./auth');
const { sanitizeStateBlob } = require('./validation');
const { makeGearItems, isValidSetId } = require('./gearSets');
const {
  getStateRow,
  saveState,
  getLeaderboardRows,
  getGiftCode,
  incrementCodeUses,
  hasRedeemed,
  addRedemption,
} = require('./db');

const router = express.Router();

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
    prestigeCount: 0,
    prestigeBonus: 0,
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
function loadBlob(userId) {
  const row = getStateRow(userId);
  return row ? parseBlob(row.state_json) : defaultStateBlob();
}

// ---------- state ----------
router.get('/state', requireAuth, (req, res) => {
  const row = getStateRow(req.user.id);
  if (!row) {
    return res.json({ state: defaultStateBlob(), lastSeenAt: null });
  }
  res.json({ state: parseBlob(row.state_json), lastSeenAt: row.updated_at });
});

router.post('/state', requireAuth, (req, res) => {
  const { state } = req.body || {};
  const result = sanitizeStateBlob(state);
  if (!result.ok) return res.status(400).json({ error: result.error });
  saveState(req.user.id, result.state);
  res.json({ ok: true });
});

// ---------- leaderboard (public) ----------
router.get('/leaderboard', (req, res) => {
  const rows = getLeaderboardRows(100);
  const entries = rows.map((r) => {
    let race = null;
    try {
      const blob = JSON.parse(r.state_json);
      if (blob && typeof blob.race === 'string') race = blob.race;
    } catch {
      // leave race null
    }
    return {
      username: r.username,
      race,
      level: r.level,
      stage: r.stage,
      bossesKilled: r.bosses_killed,
      prestige: r.prestige_count,
    };
  });
  res.json({ entries });
});

// ---------- gift codes ----------
router.post('/redeem', requireAuth, (req, res) => {
  let { code } = req.body || {};
  if (typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'Code is required.' });
  }
  code = code.trim().toUpperCase();

  const giftCode = getGiftCode(code);
  if (!giftCode) return res.status(404).json({ error: 'Code not found.' });
  if (giftCode.uses >= giftCode.max_uses) {
    return res.status(409).json({ error: 'Code has been fully redeemed.' });
  }
  if (hasRedeemed(code, req.user.id)) {
    return res.status(409).json({ error: 'You have already redeemed this code.' });
  }
  if (!isValidSetId(giftCode.gear_set)) {
    return res.status(500).json({ error: 'Code has an invalid gear set.' });
  }

  const items = makeGearItems(giftCode.gear_set);
  const blob = loadBlob(req.user.id);
  if (!Array.isArray(blob.inventory)) blob.inventory = [];
  blob.inventory.push(...items);
  if (!Array.isArray(blob.codesRedeemed)) blob.codesRedeemed = [];
  if (!blob.codesRedeemed.includes(code)) blob.codesRedeemed.push(code);

  // Redeem grants should survive the player's next autosave overwriting the
  // blob, so persist the merged state immediately (sanity-clamped).
  const sanitized = sanitizeStateBlob(blob);
  saveState(req.user.id, sanitized.ok ? sanitized.state : blob);
  incrementCodeUses(code);
  addRedemption(code, req.user.id);

  res.json({ ok: true, set: giftCode.gear_set });
});

module.exports = { gameRouter: router, defaultStateBlob, loadBlob };
