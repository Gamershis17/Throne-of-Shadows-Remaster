// ============================================================
// api.js — thin fetch wrapper over the contract HTTP API.
// All calls use credentials:'same-origin' and JSON.
// ============================================================

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Session token fallback: cookies are primary, localStorage is the mobile fallback.
const TOKEN_KEY = 'tos_session_token';

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function clearStaleAuth() {
  setToken(null);
  try {
    // Clear any stale guest data that might cause a loop.
    localStorage.removeItem('tos_guest');
  } catch {}
}

async function request(path, options = {}) {
  const headers = { ...JSON_HEADERS, ...(options.headers || {}) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { credentials: 'same-origin', ...options, headers });
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  // Capture session token from login/register responses.
  if (data && data.token) setToken(data.token);
  if (!res.ok) {
    // On 401, clear stale credentials to prevent auth loops.
    if (res.status === 401) clearStaleAuth();
    const message = (data && (data.error || data.message)) ||
      `Request failed (HTTP ${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const post = (path, body) =>
  request(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body || {}) });

export const api = {
  // Auth
  register: (username, password) => post('/api/auth/register', { username, password }),
  login: (username, password) => post('/api/auth/login', { username, password }),
  logout: () => post('/api/auth/logout', {}),
  me: () => request('/api/auth/me'),

  // Self-service account management
  changePassword: (currentPassword, newPassword) =>
    post('/api/account/change-password', { currentPassword, newPassword }),
  changeUsername: (newUsername, password) =>
    post('/api/account/change-username', { newUsername, password }),

  // Server status (public — maintenance flag + message)
  status: () => request('/api/status'),

  // Public server settings (tunables like goldCap)
  getSettings: () => request('/api/settings'),

  // Player state
  getState: () => request('/api/state'),
  // Online presence
  ping: () => post('/api/ping', {}),
  snapshot: (action, detail) => post('/api/gm/snapshot', { action, detail }),
  onlineCount: () => request('/api/online-count'),
  getGuildMine: () => request('/api/guilds/mine'),
  saveState: (state) => post('/api/state', { state }),
  // Best-effort save during page unload (sendBeacon includes same-origin cookies).
  saveStateBeacon: (state) => {
    try {
      const blob = new Blob([JSON.stringify({ state })], { type: 'application/json' });
      return navigator.sendBeacon('/api/state', blob);
    } catch {
      return false;
    }
  },

  // Leaderboard (no auth required)
  leaderboard: (by) => request('/api/leaderboard' + (by && by !== 'level' ? '?by=' + encodeURIComponent(by) : '')),
  // Guild rankings (no auth required)
  guildRankings: () => request('/api/guilds/rankings'),

  // Realm Network: aggregate active-player counts per region (no auth required)
  realmNetwork: () => request('/api/realm-network'),

  // Multiplayer parties (invite codes)
  partyGet: () => request('/api/party'),
  partyCreate: () => post('/api/party/create', {}),
  partyJoin: (code) => post('/api/party/join', { code }),
  partyLeave: () => post('/api/party/leave', {}),
  partyKick: (userId) => post('/api/party/kick', { userId }),
  partyPromote: (userId) => post('/api/party/promote', { userId }),
  partyDisband: () => post('/api/party/disband', {}),

  // Player inspect (public gameplay profile)
  inspectPlayer: (username) => request('/api/player/' + encodeURIComponent(username) + '/inspect'),

 

  // Friends (auth required)
  getFriends: () => request('/api/friends'),
  friendRequest: (username) => post('/api/friends/request', { username }),
  friendRespond: (username, accept) => post('/api/friends/respond', { username, accept }),
  removeFriend: (username) => request('/api/friends/' + encodeURIComponent(username), { method: 'DELETE' }),

  // Gift codes
  redeem: (code) => post('/api/redeem', { code }),

  // GM console (role owner|gm; role mgmt owner-only)
  gmOverview: () => request('/api/gm/overview'),
  gmGrant: (username, kind, extra) => post('/api/gm/grant', { username, kind, ...(extra || {}) }),
  gmGrantTitle: (username, titleId) => post('/api/gm/grant-title', { username, titleId }),
  gmSetBadge: (username, badge) => post('/api/gm/badge', { username, badge }),
  gmGrantPet: (username, amount) => post('/api/gm/grant-pet', { username, amount }),
  gmSetRebirth: (username, count) => post('/api/gm/set-rebirth', { username, count }),
  gmKick: (username) => post('/api/gm/kick', { username }),
  gmMaintenance: (enabled, message) => post('/api/gm/maintenance', { enabled, message }),
  gmInfGold: (username, enabled) => post('/api/gm/inf-gold', { username, enabled }),
  gmSetSettings: (goldCap) => post('/api/gm/settings', { goldCap }),
  gmSetStage: (username, stage) => post('/api/gm/set-stage', { username, stage }),
  gmSetLevel: (username, level) => post('/api/gm/set-level', { username, level }),
  gmSetGold: (username, amount) => post('/api/gm/set-gold', { username, amount }),
  gmSetXp: (username, amount) => post('/api/gm/set-xp', { username, amount }),
  gmGrantItem: (username, set, slot) => post('/api/gm/grant-item', { username, set, slot }),
  gmGrantForgeBox: (username) => post('/api/gm/grant-forge-box', { username }),
  gmGrantClassGear: (username, slot) => post('/api/gm/grant-class-gear', { username, slot }),
  gmMute: (username, minutes) => post('/api/gm/mute', { username, minutes }),
  gmClearGuildChat: (username) => post('/api/gm/clear-guild-chat', { username }),
  gmNameStyle: (username, color, fx) => post('/api/gm/name-style', { username, color, fx }),
  gmInspect: (username) => post('/api/gm/inspect', { username }),
  gmAudit: () => request('/api/gm/audit'),
  gmInventory: (username) => post('/api/gm/inventory', { username }),
  gmRemoveItem: (username, index) => post('/api/gm/remove-item', { username, index }),
  gmModItem: (username, itemId, stats, name) => post('/api/gm/mod-item', { username, itemId, stats, name }),
  gmModPet: (username, petUid, mods) => post('/api/gm/mod-pet', { username, petUid, ...mods }),
  gmRemovePet: (username, petUid) => post('/api/gm/remove-pet', { username, petUid }),
  gmSetEnchant: (username, target, level) => post('/api/gm/set-enchant', { username, ...target, level }),
  gmResetQuests: (username, period) => post('/api/gm/reset-quests', { username, period }),
  gmEventBuff: (opts) => post('/api/gm/event-buff', opts),
  gmHeal: (username) => post('/api/gm/heal', { username }),
  gmReset: (username) => post('/api/gm/reset', { username }),
  gmCodes: () => request('/api/gm/codes'),
  gmCreateCode: (rewardKind, opts) => post('/api/gm/codes', { rewardKind, ...(opts || {}) }),
  gmRoster: () => request('/api/gm/roster'),
  gmRosterUpdate: (username, action) => post('/api/gm/roster', { username, action }),
  // Player management (owner|admin)
  gmTitle: (username, title) => post('/api/gm/title', { username, title }),
  gmStage: (username, stage) => post('/api/gm/stage', { username, stage }),
  gmBan: (username) => post('/api/gm/ban', { username }),
  gmUnban: (username) => post('/api/gm/unban', { username }),
  gmResetPlayer: (username) => post('/api/gm/reset-player', { username }),
  gmDeleteAccount: (username) => post('/api/gm/delete-account', { username }),
  // Moderation (owner|admin|moderator)
  gmBroadcast: (message) => post('/api/gm/broadcast', { message }),
  gmPlayers: (search, limit) =>
    request('/api/gm/players?search=' + encodeURIComponent(search || '') + '&limit=' + (limit || 50)),
  // Public broadcast feed
  latestBroadcast: () => request('/api/broadcasts/latest'),
  setRole: (username, role) => post('/api/roles', { username, role }),
};
