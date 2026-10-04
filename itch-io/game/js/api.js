// ============================================================
// api.js — LOCAL (itch.io standalone) build.
// Same exported `api` interface as the online version, but every
// call is served from the browser's localStorage. No server,
// no network. Profiles, saves, gift codes, and the GM console
// all work locally on this device.
//
// NOTE: local "passwords" are only a casual lock (simple hash).
// Anyone with access to this browser can read localStorage.
// Do not treat this as real account security.
// ============================================================
import * as Engine from './engine.js';

const P = 'rpgitch_';
const K = {
  profiles: P + 'profiles',
  session: P + 'session',
  codes: P + 'codes',
  state: (u) => P + 'state_' + u.toLowerCase(),
};

// ---- storage with in-memory fallback (private mode etc.) ----
const mem = {};
const store = {
  get(k) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? (k in mem ? mem[k] : null) : v;
    } catch { return k in mem ? mem[k] : null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* ignore */ }
    mem[k] = v;
  },
  del(k) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
    delete mem[k];
  },
};
const readJSON = (k, fb) => {
  const v = store.get(k);
  if (v === null || v === undefined) return fb;
  try { return JSON.parse(v); } catch { return fb; }
};
const writeJSON = (k, v) => store.set(k, JSON.stringify(v));

// ---- tiny non-crypto hash (casual local lock only!) ----
function hashStr(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function err(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const profiles = () => readJSON(K.profiles, {});
const saveProfiles = (p) => writeJSON(K.profiles, p);
const getProfile = (username) => profiles()[String(username || '').toLowerCase()] || null;
const sessionUser = () => {
  const u = store.get(K.session);
  return u ? getProfile(u) : null;
};
const publicUser = (p) => ({ username: p.username, role: p.role });

// Seed one demo gift code for itch players (redeemable once per profile).
function seedCodes() {
  const codes = readJSON(K.codes, null);
  if (codes) return codes;
  const fresh = {
    'WARDEN-WELCOME': { gear_set: 'warden', max_uses: 1000000, uses: 0, createdBy: 'itch', createdAt: Date.now() },
  };
  writeJSON(K.codes, fresh);
  return fresh;
}

function loadStateOf(username) {
  const raw = readJSON(K.state(username), null);
  return raw; // {state, lastSeenAt} | null
}
function persistStateOf(username, state) {
  writeJSON(K.state(username), { state, lastSeenAt: Date.now() });
}

const CODE_RE = /^[A-Z0-9-]{4,24}$/;
function newCode() {
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => alpha[Math.floor(Math.random() * alpha.length)]).join('');
  return `${seg()}-${seg()}-${seg()}`;
}

export const api = {
  // ---- Auth (local profiles) ----
  register: async (username, password) => {
    username = String(username || '').trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw err('Username: 3–20 chars, letters/numbers/underscore.');
    if (!password || password.length < 6) throw err('Password must be at least 6 characters.');
    const ps = profiles();
    const key = username.toLowerCase();
    if (ps[key]) throw err('That username is taken on this device.', 409);
    const first = Object.keys(ps).length === 0;
    ps[key] = { username, passHash: hashStr('rpgitch:' + password), role: first ? 'owner' : 'player', createdAt: Date.now() };
    saveProfiles(ps);
    store.set(K.session, key);
    return { user: publicUser(ps[key]) };
  },

  login: async (username, password) => {
    const p = getProfile(username);
    if (!p || p.passHash !== hashStr('rpgitch:' + String(password || ''))) {
      throw err('Wrong username or password.', 401);
    }
    store.set(K.session, p.username.toLowerCase());
    return { user: publicUser(p) };
  },

  logout: async () => { store.del(K.session); return { ok: true }; },

  me: async () => {
    const p = sessionUser();
    if (!p) throw err('Not logged in.', 401);
    return { user: publicUser(p) };
  },

  // ---- Player state ----
  getState: async () => {
    const p = sessionUser();
    if (!p) throw err('Not logged in.', 401);
    const saved = loadStateOf(p.username);
    return { state: saved ? saved.state : null, lastSeenAt: saved ? saved.lastSeenAt : null };
  },

  saveState: async (state) => {
    const p = sessionUser();
    if (!p) throw err('Not logged in.', 401);
    if (!state || typeof state !== 'object') throw err('Bad state.');
    persistStateOf(p.username, state);
    return { ok: true };
  },

  saveStateBeacon: (state) => {
    try {
      const p = sessionUser();
      if (p && state && typeof state === 'object') persistStateOf(p.username, state);
      return true;
    } catch { return false; }
  },

  // ---- Leaderboard (this device only) ----
  leaderboard: async () => {
    const ps = profiles();
    const entries = [];
    for (const key of Object.keys(ps)) {
      const p = ps[key];
      const saved = loadStateOf(p.username);
      const s = Engine.ensureState(saved && saved.state ? saved.state : null);
      if (!s.race) s.race = 'human';
      const st = Engine.computeStats(s);
      entries.push({
        username: p.username,
        role: p.role,
        race: s.race || 'human',
        level: s.level || 1,
        stage: s.stage || 1,
        power: Math.round(st.attack),
        gold: Math.floor(s.gold || 0),
        bossesKilled: s.bossesKilled || 0,
        prestige: s.prestigeCount || 0,
      });
    }
    entries.sort((a, b) => b.level - a.level || b.power - a.power || b.stage - a.stage || b.bossesKilled - a.bossesKilled);
    return { entries: entries.slice(0, 100) };
  },

  // ---- Gift codes ----
  redeem: async (code) => {
    const p = sessionUser();
    if (!p) throw err('Not logged in.', 401);
    code = String(code || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) throw err('That code does not exist.', 404);
    const codes = seedCodes();
    const c = codes[code];
    if (!c) throw err('That code does not exist.', 404);
    if (c.uses >= c.max_uses) throw err('That code is used up.', 409);
    const saved = loadStateOf(p.username);
    const state = Engine.ensureState(saved ? saved.state : null);
    if ((state.codesRedeemed || []).includes(code)) throw err('You already redeemed that code.', 409);
    if (!Engine.PRIVILEGED_SETS[c.gear_set]) throw err('That code is invalid.', 400);
    Engine.grantFullSet(state, c.gear_set);
    state.codesRedeemed.push(code);
    c.uses += 1;
    writeJSON(K.codes, codes);
    persistStateOf(p.username, state);
    return { ok: true, set: c.gear_set };
  },

  // ---- GM console (you are the owner of your own copy) ----
  gmOverview: async () => {
    const p = sessionUser();
    if (!p) throw err('Not logged in.', 401);
    const ps = profiles();
    const codes = seedCodes();
    return { role: p.role, playerCount: Object.keys(ps).length, codeCount: Object.keys(codes).length };
  },

  gmGrant: async (username, kind, extra) => {
    const me = sessionUser();
    if (!me) throw err('Not logged in.', 401);
    if (!['owner', 'gm'].includes(me.role)) throw err('GM only.', 403);
    const target = getProfile(username);
    if (!target) throw err('Player not found on this device.', 404);
    const saved = loadStateOf(target.username);
    const state = Engine.ensureState(saved ? saved.state : null);
    if (kind === 'stars') {
      const amount = Math.max(1, Math.min(100000, Math.floor((extra && extra.amount) || 0)));
      if (!amount) throw err('Amount must be 1–100000.');
      state.stars = (state.stars || 0) + amount;
    } else if (kind === 'gold') {
      const amount = Math.max(1, Math.min(1000000, Math.floor((extra && extra.amount) || 0)));
      if (!amount) throw err('Amount must be 1–1000000.');
      state.gold = (state.gold || 0) + amount;
    } else if (kind === 'levels') {
      const amount = Math.max(1, Math.min(100, Math.floor((extra && extra.amount) || 0)));
      if (!amount) throw err('Amount must be 1–100.');
      Engine.grantLevels(state, amount);
    } else if (kind === 'gear') {
      const set = extra && extra.set;
      if (!Engine.PRIVILEGED_SETS[set]) throw err('Unknown gear set.');
      if (set === 'sovereign' && me.role !== 'owner') throw err('Sovereign set is owner-only.', 403);
      Engine.grantFullSet(state, set);
    } else {
      throw err('Unknown grant kind.');
    }
    persistStateOf(target.username, state);
    return { ok: true, state };
  },

  gmCodes: async () => {
    const p = sessionUser();
    if (!p) throw err('Not logged in.', 401);
    const codes = seedCodes();
    return Object.entries(codes).map(([code, c]) => ({
      code, gear_set: c.gear_set, uses: c.uses, max_uses: c.max_uses, created_at: c.createdAt,
    }));
  },

  gmCreateCode: async (set, maxUses) => {
    const p = sessionUser();
    if (!p) throw err('Not logged in.', 401);
    if (!Engine.PRIVILEGED_SETS[set]) throw err('Unknown gear set.');
    const n = Math.max(1, Math.min(1000000, Math.floor(maxUses) || 1));
    const codes = seedCodes();
    let code = newCode();
    while (codes[code]) code = newCode();
    codes[code] = { gear_set: set, max_uses: n, uses: 0, createdBy: p.username, createdAt: Date.now() };
    writeJSON(K.codes, codes);
    return { code };
  },

  gmRoster: async () => {
    const p = sessionUser();
    if (!p) throw err('Not logged in.', 401);
    const ps = Object.values(profiles());
    return {
      admins: ps.filter(x => x.role === 'admin').map(x => x.username),
      gms: ps.filter(x => x.role === 'gm').map(x => x.username),
    };
  },

  gmRosterUpdate: async (username, action) => {
    const me = sessionUser();
    if (!me) throw err('Not logged in.', 401);
    if (!['owner', 'gm'].includes(me.role)) throw err('GM only.', 403);
    const ps = profiles();
    const t = ps[String(username || '').toLowerCase()];
    if (!t) throw err('Player not found on this device.', 404);
    if (t.username.toLowerCase() === me.username.toLowerCase()) throw err('You cannot change your own role here.');
    if (action === 'add-admin') t.role = 'admin';
    else if (action === 'remove-admin') t.role = 'player';
    else throw err('Unknown action.');
    saveProfiles(ps);
    return { ok: true };
  },

  setRole: async (username, role) => {
    const me = sessionUser();
    if (!me) throw err('Not logged in.', 401);
    if (me.role !== 'owner') throw err('Owner only.', 403);
    if (!['gm', 'admin', 'player'].includes(role)) throw err('Unknown role.');
    const ps = profiles();
    const t = ps[String(username || '').toLowerCase()];
    if (!t) throw err('Player not found on this device.', 404);
    if (t.username.toLowerCase() === me.username.toLowerCase()) throw err('You cannot change your own role here.');
    t.role = role;
    saveProfiles(ps);
    return { ok: true };
  },
};
