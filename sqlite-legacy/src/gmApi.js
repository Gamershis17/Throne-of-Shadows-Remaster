'use strict';

/**
 * GM + role-management API:
 *   GET  /api/gm/overview   (gm|owner)
 *   POST /api/gm/grant      (gm|owner)
 *   GET  /api/gm/codes      (gm|owner)
 *   POST /api/gm/codes      (gm|owner)
 *   GET  /api/gm/roster     (gm|owner)
 *   POST /api/gm/roster     (gm|owner)
 *   POST /api/roles         (owner only)
 */

const crypto = require('crypto');
const express = require('express');
const { requireRole } = require('./auth');
const { sanitizeStateBlob } = require('./validation');
const { makeGearItems, isValidSetId } = require('./gearSets');
const { loadBlob } = require('./gameApi');
const {
  getUserByUsername,
  setUserRole,
  getPlayerCount,
  getUsernamesByRole,
  saveState,
  createGiftCode,
  listGiftCodes,
  getCodeCount,
  getGiftCode,
} = require('./db');

const router = express.Router();
const gmOrOwner = requireRole('gm', 'owner');
const ownerOnly = requireRole('owner');

const VALID_ROLES_FOR_ROLES_ROUTE = ['gm', 'admin', 'player'];
const STAR_GRANT_MIN = 1;
const STAR_GRANT_MAX = 100000;

// Unambiguous alphabet: no 0/O, 1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    let chars = '';
    const bytes = crypto.randomBytes(12);
    for (const b of bytes) chars += CODE_ALPHABET[b % CODE_ALPHABET.length];
    const code = `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
    if (!getGiftCode(code)) return code;
  }
  throw new Error('Failed to generate a unique gift code.');
}

function persistMergedState(userId, blob) {
  const sanitized = sanitizeStateBlob(blob);
  saveState(userId, sanitized.ok ? sanitized.state : blob);
}

function resolveTarget(username) {
  if (typeof username !== 'string' || !username.trim()) return null;
  return getUserByUsername(username.trim());
}

// ---------- overview ----------
router.get('/gm/overview', gmOrOwner, (req, res) => {
  res.json({
    role: req.user.role,
    playerCount: getPlayerCount(),
    codeCount: getCodeCount(),
  });
});

// ---------- grants ----------
router.post('/gm/grant', gmOrOwner, (req, res) => {
  const { username, kind, amount, set } = req.body || {};
  const target = resolveTarget(username);
  if (!target) return res.status(404).json({ error: 'Target user not found.' });

  if (kind === 'stars') {
    if (!Number.isInteger(amount) || amount < STAR_GRANT_MIN || amount > STAR_GRANT_MAX) {
      return res
        .status(400)
        .json({ error: `Amount must be an integer between ${STAR_GRANT_MIN} and ${STAR_GRANT_MAX}.` });
    }
    const blob = loadBlob(target.id);
    blob.stars = Math.min(1e15, Math.max(0, Number(blob.stars) || 0) + amount);
    persistMergedState(target.id, blob);
    return res.json({ ok: true });
  }

  if (kind === 'gear') {
    if (typeof set !== 'string' || !isValidSetId(set)) {
      return res.status(400).json({ error: 'Set must be one of sovereign, fateweaver, warden.' });
    }
    if (set === 'sovereign' && req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner may grant the sovereign set.' });
    }
    const items = makeGearItems(set);
    const blob = loadBlob(target.id);
    if (!Array.isArray(blob.inventory)) blob.inventory = [];
    blob.inventory.push(...items);
    persistMergedState(target.id, blob);
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'Kind must be "stars" or "gear".' });
});

// ---------- gift codes ----------
router.get('/gm/codes', gmOrOwner, (req, res) => {
  res.json({ codes: listGiftCodes() });
});

router.post('/gm/codes', gmOrOwner, (req, res) => {
  const { set, maxUses } = req.body || {};
  if (typeof set !== 'string' || !isValidSetId(set)) {
    return res.status(400).json({ error: 'Set must be one of sovereign, fateweaver, warden.' });
  }
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000000) {
    return res.status(400).json({ error: 'maxUses must be an integer between 1 and 1000000.' });
  }
  const code = generateCode();
  createGiftCode(code, set, maxUses, req.user.id);
  res.status(201).json({ code });
});

// ---------- admin roster ----------
router.get('/gm/roster', gmOrOwner, (req, res) => {
  res.json({
    admins: getUsernamesByRole('admin'),
    gms: getUsernamesByRole('gm'),
  });
});

router.post('/gm/roster', gmOrOwner, (req, res) => {
  const { username, action } = req.body || {};
  const target = resolveTarget(username);
  if (!target) return res.status(404).json({ error: 'Target user not found.' });

  if (action === 'add-admin') {
    if (target.role !== 'player') {
      return res.status(400).json({ error: 'Only players can be added to the admin roster.' });
    }
    setUserRole(target.id, 'admin');
    return res.json({ ok: true });
  }
  if (action === 'remove-admin') {
    if (target.role !== 'admin') {
      return res.status(400).json({ error: 'Target user is not an admin.' });
    }
    setUserRole(target.id, 'player');
    return res.json({ ok: true });
  }
  return res.status(400).json({ error: 'Action must be "add-admin" or "remove-admin".' });
});

// ---------- role management (owner only) ----------
router.post('/roles', ownerOnly, (req, res) => {
  const { username, role } = req.body || {};
  const target = resolveTarget(username);
  if (!target) return res.status(404).json({ error: 'Target user not found.' });
  if (!VALID_ROLES_FOR_ROLES_ROUTE.includes(role)) {
    return res.status(400).json({ error: 'Role must be one of gm, admin, player.' });
  }
  if (target.role === 'owner') {
    return res.status(403).json({ error: 'Owner accounts cannot be changed.' });
  }
  if (target.id === req.user.id) {
    return res.status(403).json({ error: 'You cannot change your own role.' });
  }
  setUserRole(target.id, role);
  res.json({ ok: true });
});

module.exports = { gmRouter: router };
