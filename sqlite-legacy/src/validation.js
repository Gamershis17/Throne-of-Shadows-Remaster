'use strict';

/**
 * Input validation and player-state sanity clamps.
 */

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MAX_BLOB_BYTES = 1024 * 1024; // 1 MB

function validateUsername(username) {
  if (typeof username !== 'string') return 'Username is required.';
  const trimmed = username.trim();
  if (!USERNAME_RE.test(trimmed)) {
    return 'Username must be 3-20 characters: letters, numbers, underscore.';
  }
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  return null;
}

// Named root fields and their clamp ranges [min, max]. Only applied when the
// field exists and holds a finite number; non-finite numbers become the min.
const CLAMPED_FIELDS = {
  level: [1, 100000],
  stage: [1, 100000],
  gold: [0, 1e15],
  stars: [0, 1e15],
  xp: [0, 1e15],
  xpNext: [0, 1e15],
  bossesKilled: [0, 100000000],
  prestigeCount: [0, 100000],
  prestigeBonus: [0, 100000],
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
      blob[field] = clamp(blob[field], min, max);
    }
  }
  // Indexed columns must exist as numbers for db.saveState.
  if (typeof blob.level !== 'number') blob.level = 1;
  if (typeof blob.stage !== 'number') blob.stage = 1;
  if (typeof blob.bossesKilled !== 'number') blob.bossesKilled = 0;
  if (typeof blob.prestigeCount !== 'number') blob.prestigeCount = 0;
  if (!Array.isArray(blob.inventory)) blob.inventory = [];
  if (!Array.isArray(blob.codesRedeemed)) blob.codesRedeemed = [];
  return { ok: true, state: blob };
}

module.exports = {
  validateUsername,
  validatePassword,
  sanitizeStateBlob,
  MAX_BLOB_BYTES,
};
