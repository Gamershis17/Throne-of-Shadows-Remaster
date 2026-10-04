// ============================================================
// guest.js — "Play as Guest" local session management.
//
// Guests play with NO account and NO server writes. Their profile
// (display name + full game state) lives in localStorage under a
// single key. This module is DOM-free on purpose: it never touches
// document/window at import time, so it can be unit-tested in Node
// with a stubbed localStorage.
//
// Guest blob shape: { v: 1, name, state, lastSeen }
//   state    — the same shape Engine.defaultState()/ensureState()
//              produce for authed players, so a guest save can be
//              uploaded verbatim to /api/state when the guest
//              registers an account (migration).
//   lastSeen — ms epoch, used for offline-earnings math like the
//              server's lastSeenAt.
// ============================================================

export const GUEST_KEY = 'kop-guest-save-v1';
export const GUEST_ROLE = 'guest';

function storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* ignore */ }
  return null;
}

// Guest display names are cosmetic only (never touch the server), so the
// rules are light: trim, cap length, strip control characters. Falls back
// to "Guest" for empty input.
export function sanitizeGuestName(raw) {
  let name = String(raw == null ? '' : raw).trim();
  // Strip control characters and collapse whitespace.
  name = name.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length > 16) name = name.slice(0, 16).trim();
  return name || 'Guest';
}

// Returns the stored guest profile { name, state, lastSeen } or null
// when there is no guest save (or it is unreadable — never throws).
export function loadGuest() {
  const ls = storage();
  if (!ls) return null;
  let raw = null;
  try { raw = ls.getItem(GUEST_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const blob = JSON.parse(raw);
    if (!blob || typeof blob !== 'object' || !blob.state || typeof blob.state !== 'object') return null;
    return {
      name: sanitizeGuestName(blob.name),
      state: blob.state,
      lastSeen: Number(blob.lastSeen) > 0 ? Number(blob.lastSeen) : null,
    };
  } catch {
    return null;
  }
}

// Persists the guest profile. Returns true on success, false when
// storage is unavailable or full (the game keeps running in memory).
export function saveGuest(name, state) {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(GUEST_KEY, JSON.stringify({
      v: 1,
      name: sanitizeGuestName(name),
      state,
      lastSeen: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearGuest() {
  const ls = storage();
  if (!ls) return;
  try { ls.removeItem(GUEST_KEY); } catch { /* ignore */ }
}

export function hasGuestSave() {
  return loadGuest() !== null;
}
