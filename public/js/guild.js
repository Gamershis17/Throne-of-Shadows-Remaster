// ============================================================
// guild.js — Throne of Shadows guild hall.
//
// Full rework: hall header (banner, level/XP, Message of the Day) plus
// sub-tabs: Chat | News | Roster | Perks | Rewards | Info.
//
// Wiring (done by the parent, e.g. app.js):
//   import { renderGuildSection, syncGuildPerks } from './guild.js';
//   renderGuildSection(document.getElementById('guild-section'), api);
//   syncGuildPerks(api); // after login, so perks apply even if the
//                        // player never opens the guild tab
//
// `api` may expose get(path)/post(path, body) helpers (like api.js), or
// be omitted entirely — this module falls back to same-origin fetch.
// ============================================================
import { Audio } from './audio.js?v=20260930ar';
import { setGuildPerks } from './engine.js?v20261003bi';
import { UI } from './ui.js?v20261003x';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

async function gget(api, path) {
  if (api && typeof api.get === 'function') return api.get(path);
  const res = await fetchWithTimeout(path, { credentials: 'same-origin' });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

async function gpost(api, path, body) {
  if (api && typeof api.post === 'function') return api.post(path, body);
  const res = await fetchWithTimeout(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

async function gdel(api, path) {
  if (api && typeof api.del === 'function') return api.del(path);
  const res = await fetchWithTimeout(path, { method: 'DELETE', credentials: 'same-origin' });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

/**
 * fetch() with a timeout. The game is hosted on a free tier that cold-starts,
 * so without this a sleeping backend leaves the guild panel stuck on
 * "Loading guild…" indefinitely.
 */
async function fetchWithTimeout(path, options = {}, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(path, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the player's guild perks and hand them to the engine so they apply
 * to stat calculations. Safe to call for guests / guildless players
 * (server returns inGuild:false; perks stay at zero). Fire-and-forget.
 */
export async function syncGuildPerks(api) {
  try {
    const r = await gget(api, '/api/guilds/perks');
    if (r && r.inGuild && r.perks) setGuildPerks(r.perks);
    else setGuildPerks({ xpPct: 0, goldPct: 0, dmgPct: 0 });
  } catch {
    // offline-tolerant: perks simply stay at whatever they were
  }
}

/** Reserved for future guild wiring. Currently a no-op. */
export async function initGuild(api) {
  void api;
}

const BANNER_EMOJI = {
  shadow: '🏰', goldflare: '🌟', bloodmoon: '🌑', frostbound: '❄️', voidveil: '🌀',
};

const RANK_META = {
  master:   { label: 'Guild Master', short: 'Master',   cls: 'master' },
  officer:  { label: 'Officer',      short: 'Officer',  cls: 'officer' },
  member:   { label: 'Member',       short: 'Member',   cls: 'member' },
  initiate: { label: 'Initiate',     short: 'Initiate', cls: 'initiate' },
};

const STYLE = `
.guild-wrap { font-family: inherit; color: #e8e2f5; }
.guild-title { color: #e8b33c; font-weight: 700; font-size: 17px; margin: 0 0 8px; }
.guild-sub { color: #9d8cc7; font-size: 13px; margin: 0 0 10px; }
.guild-row { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.guild-input {
  flex: 1; min-width: 0;
  background: #0e0a1a; color: #e8e2f5;
  border: 1px solid #4a3573; border-radius: 8px;
  padding: 9px 10px; font-size: 14px;
}
.guild-input:focus { outline: none; border-color: #e8b33c; }
.guild-input.short { flex: 0 0 84px; }
.guild-error {
  background: rgba(160, 40, 40, .18); border: 1px solid #a03a3a;
  color: #ffb3b3; border-radius: 8px; padding: 8px 10px;
  font-size: 13px; margin-bottom: 8px;
}
.guild-ok {
  background: rgba(60, 140, 60, .15); border: 1px solid #3f7d3f;
  color: #b5e6b5; border-radius: 8px; padding: 8px 10px;
  font-size: 13px; margin-bottom: 8px;
}
.guild-loading { color: #9d8cc7; font-size: 14px; padding: 12px 0; }
/* ---- hall header ---- */
.guild-hall {
  background: linear-gradient(180deg, #171126 0%, #100c1c 100%);
  border: 1px solid #6b5320; border-radius: 12px;
  box-shadow: 0 0 0 1px #2a2118, 0 6px 18px rgba(0,0,0,.55), inset 0 1px 0 rgba(232,179,60,.12);
  padding: 14px; margin-bottom: 10px;
}
.guild-hall-top { display: flex; gap: 12px; align-items: center; }
.guild-banner {
  font-size: 40px; line-height: 1; flex: 0 0 auto;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,.7));
}
.guild-hall-name { min-width: 0; }
.guild-name { color: #e8b33c; font-weight: 800; font-size: 20px; margin: 0; overflow-wrap: anywhere; }
.guild-tag {
  color: #0e0a1a; background: #e8b33c; font-weight: 800; font-size: 12px;
  border-radius: 6px; padding: 2px 8px; white-space: nowrap;
}
.guild-lvl { color: #c9bdf0; font-size: 13px; margin-top: 2px; }
.guild-xpbar {
  margin-top: 8px; height: 14px; border-radius: 8px;
  background: #0a0714; border: 1px solid #4a3573; overflow: hidden; position: relative;
}
.guild-xpbar > i {
  display: block; height: 100%; border-radius: 7px;
  background: linear-gradient(90deg, #8b5cf6, #c084fc);
  box-shadow: 0 0 8px rgba(168,85,247,.6);
}
.guild-xpbar > span {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: #fff; text-shadow: 0 1px 2px #000; font-weight: 700;
}
.guild-motd {
  margin-top: 10px; padding: 10px 12px; border-radius: 8px;
  background: rgba(232,179,60,.06); border: 1px dashed #6b5320;
  font-size: 13px; color: #e8dcc0;
}
.guild-motd .motd-label { color: #e8b33c; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; display: block; margin-bottom: 4px; }
.guild-motd .motd-edit { margin-top: 6px; }
/* ---- sub-tabs ---- */
.guild-tabs {
  display: flex; gap: 6px; margin-bottom: 10px;
  overflow-x: auto; padding-bottom: 2px; -webkit-overflow-scrolling: touch;
}
.guild-tabbtn {
  flex: 0 0 auto; background: #171126; color: #9d8cc7;
  border: 1px solid #4a3573; border-radius: 8px;
  padding: 8px 12px; font-size: 13px; font-weight: 700; cursor: pointer;
  white-space: nowrap;
}
.guild-tabbtn.active {
  color: #0e0a1a; background: linear-gradient(180deg, #f4d47c, #d9a83c);
  border-color: #8a6a1f; box-shadow: 0 2px 8px rgba(232,179,60,.35);
}
.guild-panel { min-height: 200px; }
/* ---- chat ---- */
.guild-chatlog {
  display: flex; flex-direction: column; gap: 6px;
  max-height: 320px; overflow-y: auto; margin-bottom: 8px; padding-right: 2px;
}
.guild-msg {
  background: rgba(122,90,200,.08); border: 1px solid #2e2350;
  border-radius: 8px; padding: 6px 10px; font-size: 13px;
}
.guild-msg .who { color: #e8b33c; font-weight: 700; margin-right: 6px; }
.guild-msg .when { color: #6f5fa3; font-size: 11px; margin-left: 6px; }
.guild-msg .txt { color: #e8e2f5; overflow-wrap: anywhere; }
.guild-msgdel {
  float: right; margin-left: 8px; padding: 0 6px; font-size: 12px; line-height: 1.6;
  color: #ff8a8a; background: rgba(255,80,80,.08); border: 1px solid #5a2b2b;
  border-radius: 6px; cursor: pointer;
}
.guild-msgdel:hover { background: rgba(255,80,80,.2); }
.guild-chatrow { display: flex; gap: 8px; }
.guild-chatrow .guild-input { font-size: 14px; }
/* ---- news ---- */
.guild-newsitem {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 8px 10px; border-radius: 8px; font-size: 13px; margin-bottom: 6px;
  background: rgba(122,90,200,.06); border: 1px solid #241c44;
}
.guild-newsitem .nic { font-size: 16px; flex: 0 0 auto; }
.guild-newsitem .ntx { color: #cfc6ea; overflow-wrap: anywhere; }
.guild-newsitem .nwhen { color: #6f5fa3; font-size: 11px; display: block; }
/* ---- roster ---- */
.guild-member {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 8px; margin-bottom: 6px;
  background: rgba(122,90,200,.06); border: 1px solid #241c44;
}
.guild-member .avatar {
  width: 34px; height: 34px; border-radius: 50%; flex: 0 0 auto;
  background: #241c44; border: 1px solid #6b5320;
  display: flex; align-items: center; justify-content: center; font-size: 18px;
}
.guild-member .minfo { flex: 1; min-width: 0; }
.guild-member .mname { font-weight: 700; color: #e8e2f5; font-size: 14px; overflow-wrap: anywhere; }
.guild-member .mname .mtitle { color: #c084fc; font-weight: 400; font-size: 12px; }
.guild-member .msub { color: #9d8cc7; font-size: 12px; }
.guild-member .online-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.online-dot.on { background: #4ade80; box-shadow: 0 0 6px #4ade80; }
.online-dot.off { background: #4a4468; }
.rank-pill {
  font-size: 11px; font-weight: 800; text-transform: uppercase;
  border-radius: 6px; padding: 2px 8px; letter-spacing: .5px; white-space: nowrap;
}
.rank-pill.master { background: linear-gradient(180deg,#f4d47c,#d9a83c); color: #0e0a1a; box-shadow: 0 0 8px rgba(232,179,60,.5); }
.rank-pill.officer { background: #7c3aed; color: #fff; }
.rank-pill.member { background: #3a2d5c; color: #c9bdf0; }
.rank-pill.initiate { background: #241c44; color: #8a7fb5; border: 1px solid #4a3573; }
.guild-macts { display: flex; gap: 4px; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; }
.guild-macts .btn { padding: 4px 8px; font-size: 11px; }
/* ---- perks ---- */
.guild-perk {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 8px; margin-bottom: 6px;
  background: rgba(232,179,60,.05); border: 1px solid #3a2f16;
}
.guild-perk .pname { color: #e8e2f5; font-weight: 700; font-size: 14px; }
.guild-perk .pdesc { color: #9d8cc7; font-size: 12px; }
.guild-perk .pval { color: #4ade80; font-weight: 800; font-size: 15px; white-space: nowrap; }
/* ---- vendor ---- */
.guild-credits {
  display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
  color: #e8b33c; font-weight: 700; font-size: 15px;
}
.guild-vitem {
  display: flex; gap: 10px; align-items: center;
  padding: 10px 12px; border-radius: 8px; margin-bottom: 6px;
  background: rgba(122,90,200,.06); border: 1px solid #241c44;
}
.guild-vitem .vemoji { font-size: 24px; flex: 0 0 auto; }
.guild-vitem .vinfo { flex: 1; min-width: 0; }
.guild-vitem .vname { color: #e8e2f5; font-weight: 700; font-size: 14px; }
.guild-vitem .vdesc { color: #9d8cc7; font-size: 12px; }
.guild-vitem .vbuy { flex: 0 0 auto; text-align: right; }
.guild-vitem .vcost { color: #e8b33c; font-weight: 700; font-size: 13px; display: block; margin-bottom: 4px; }
.guild-vitem.owned { opacity: .75; border-color: #3f7d3f; }
/* ---- challenges / info ---- */
.guild-chal { margin-bottom: 10px; }
.guild-chal .chead { display: flex; justify-content: space-between; font-size: 13px; color: #cfc6ea; margin-bottom: 4px; }
.guild-chal .cbar { height: 10px; border-radius: 6px; background: #0a0714; border: 1px solid #4a3573; overflow: hidden; }
.guild-chal .cbar > i { display: block; height: 100%; background: linear-gradient(90deg,#d9a83c,#f4d47c); }
.guild-chal.done .cbar > i { background: linear-gradient(90deg,#22c55e,#4ade80); }
.guild-meta { color: #9d8cc7; font-size: 12px; margin-bottom: 10px; }
.guild-desc { color: #cfc6ea; font-size: 13px; margin-bottom: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (prefers-reduced-motion: reduce) {
  .guild-tabbtn.active { box-shadow: none; }
  .guild-xpbar > i { box-shadow: none; }
}
/* ---- narrow screens: let roster rows wrap so info text never squeezes ---- */
@media (max-width: 560px) {
  .guild-member { flex-wrap: wrap; }
  .guild-member .minfo { flex: 1 1 calc(100% - 120px); }
  .guild-macts { flex: 1 1 100%; justify-content: flex-start; margin-top: 2px; }
}
/* ---- Guild Hall tab ---- */
.guild-hall-tab { display: flex; flex-direction: column; gap: 12px; }
.hall-treasury { background: rgba(232,179,60,0.07); border: 1px solid var(--gold-line); border-radius: 10px; padding: 12px; }
.hall-treasury-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.hall-treasury-label { font-weight: 700; color: #e8b33c; }
.hall-treasury-amount { font-weight: 700; font-size: 1.1rem; color: #ffd97a; }
.hall-donate-row { display: flex; gap: 8px; margin-top: 8px; }
.hall-donate-input { flex: 1; background: #1a1430; border: 1px solid var(--gold-line); border-radius: 6px; color: #fff; padding: 6px 10px; font-size: 0.95rem; }
.hall-donate-hint { font-size: 0.8rem; color: #8f83b8; margin-top: 4px; }
.hall-buildings { display: flex; flex-direction: column; gap: 10px; }
.guild-hall-building { background: rgba(255,255,255,0.03); border: 1px solid rgba(232,179,60,0.25); border-radius: 10px; padding: 10px 12px; }
.hall-b-head { display: flex; align-items: center; gap: 10px; }
.hall-b-emoji { font-size: 1.6rem; }
.hall-b-name { font-weight: 700; color: #e8b33c; }
.hall-b-desc { font-size: 0.8rem; color: #8f83b8; }
.hall-b-level { margin-left: auto; font-weight: 700; color: #fff; white-space: nowrap; }
.hall-b-max { color: #8f83b8; font-weight: 400; }
.hall-b-bar { height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; margin: 8px 0; overflow: hidden; }
.hall-b-bar i { display: block; height: 100%; background: linear-gradient(90deg, #e8b33c, #ffd97a); border-radius: 3px; }
.hall-b-maxed { color: #7dff9a; font-weight: 700; font-size: 0.85rem; }
.hall-b-locked { color: #8f83b8; font-size: 0.85rem; }
.hall-b-need { color: #ff9a9a; font-size: 0.8rem; margin-top: 4px; }
.hall-upgrade { margin-top: 6px; }
`;

function ensureStyle(container) {
  if (container.querySelector('style[data-guild]')) return;
  const st = document.createElement('style');
  st.setAttribute('data-guild', '');
  st.textContent = STYLE;
  container.appendChild(st);
}

function rankPill(rank) {
  const m = RANK_META[rank] || RANK_META.member;
  return `<span class="rank-pill ${m.cls}">${esc(m.short)}</span>`;
}

function classLabel(playerClass, spec) {
  if (!playerClass) return '—';
  const c = String(playerClass).charAt(0).toUpperCase() + String(playerClass).slice(1);
  if (!spec || spec === 'classic') return c;
  const s = String(spec).charAt(0).toUpperCase() + String(spec).slice(1);
  return `${c} · ${s}`;
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const NEWS_EMOJI = {
  join: '👋', leave: '🚪', kick: '🥾', promote: '⬆️', demote: '⬇️',
  levelup: '🎉', challenge: '🏅', motd: '📌', banner: '🚩', boss: '🗡️',
};

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function renderGuildSection(container, api, myState) {
  if (!container) return;
  // Clear the static "Loading…" placeholder from index.html so it can't
  // linger above the panel.
  container.innerHTML = '';
  ensureStyle(container);
  const wrap = document.createElement('div');
  wrap.className = 'guild-wrap';
  container.appendChild(wrap);

  // Poll handle for the chat tab; cleared whenever we leave the chat view.
  let chatTimer = null;
  const stopChatPoll = () => {
    if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  };

  function note(html, cls) {
    const el = wrap.querySelector('.guild-note');
    if (el) el.remove();
    if (!html) return;
    const div = document.createElement('div');
    div.className = `guild-note ${cls}`;
    div.innerHTML = html;
    wrap.prepend(div);
  }

  function listen(sel, evt, fn) {
    const el = wrap.querySelector(sel);
    if (el) el.addEventListener(evt, fn);
    return el;
  }

  async function refresh() {
    stopChatPoll();
    wrap.innerHTML = '<div class="guild-loading">Loading guild…</div>';
    let data;
    try {
      data = await gget(api, '/api/guilds/mine');
    } catch (err) {
      const msg = err && err.name === 'AbortError'
        ? 'The server is taking too long to respond (it may be waking up). Please try again.'
        : esc(err.message);
      wrap.innerHTML =
        `<div class="guild-error">${msg}</div>` +
        '<button class="btn small" data-act="retry">Retry</button>';
      listen('[data-act="retry"]', 'click', refresh);
      return;
    }
    if (data.guild) {
      if (data.guild.perks) {
        try { setGuildPerks(data.guild.perks); } catch { /* ignore */ }
      }
      renderHall(data.guild, data.members || [], data.challenges || []);
    } else {
      renderGuest();
    }
  }

  async function renderGuest() {
    let invites = [];
    try {
      const inv = await gget(api, '/api/guilds/invites');
      invites = (inv && inv.invites) || [];
    } catch { /* guild invites are best-effort for guests */ }
    const inviteHtml = invites.length ? `
      <div class="card">
        <h3 class="guild-title">\u2709\uFE0F Guild invitations</h3>
        ${invites.map((iv) => `
          <div class="guild-vitem">
            <span class="vemoji">\uD83C\uDFF0</span>
            <div class="vinfo">
              <div class="vname">${esc(iv.guildName)}</div>
              <div class="vdesc">Invited by ${esc(iv.invitedBy)}</div>
            </div>
            <div class="vbuy">
              <button class="btn small gold" data-accept-invite="${iv.id}">Accept</button>
              <button class="btn small" data-decline-invite="${iv.id}">Decline</button>
            </div>
          </div>`).join('')}
      </div>` : '';
    wrap.innerHTML = inviteHtml + `
      <div class="card">
        <h3 class="guild-title">⚔️ Create a guild</h3>
        <p class="guild-sub">Found your own guild. You become its Guild Master.</p>
        <div class="guild-row">
          <input class="guild-input" id="g-create-name" maxlength="20" placeholder="Guild name (3-20 chars)" autocomplete="off">
          <input class="guild-input short" id="g-create-tag" maxlength="4" placeholder="TAG" autocomplete="off">
          <button class="btn small gold" data-act="create">Create</button>
        </div>
      </div>
      <div class="card">
        <h3 class="guild-title">🛡️ Join a guild</h3>
        <p class="guild-sub">Enter the exact guild name to join. New members start as Initiates.</p>
        <div class="guild-row">
          <input class="guild-input" id="g-join-name" maxlength="20" placeholder="Guild name" autocomplete="off">
          <button class="btn small" data-act="join">Join</button>
        </div>
      </div>`;

    listen('[data-act="create"]', 'click', async () => {
      note('', '');
      const nameEl = wrap.querySelector('#g-create-name');
      const tagEl = wrap.querySelector('#g-create-tag');
      try {
        const res = await gpost(api, '/api/guilds', { name: nameEl && nameEl.value, tag: tagEl && tagEl.value });
        // Safety: guard against malformed API response (missing guild object).
        const guildName = res && res.guild && res.guild.name ? esc(res.guild.name) : 'Unknown';
        note(`Guild <b>${guildName}</b> created!`, 'guild-ok');
        try { Audio.play('guild'); } catch { /* ignore */ }
        await refresh();
        await syncGuildPerks(api); // Safety: refresh engine perk modifiers immediately.
      } catch (err) {
        note(esc(err.message), 'guild-error');
      }
    });

    const doJoin = async () => {
      note('', '');
      const nameEl = wrap.querySelector('#g-join-name');
      try {
        const res = await gpost(api, '/api/guilds/join', { name: nameEl && nameEl.value });
        // Safety: guard against malformed API response (missing guild object).
        const joinedName = res && res.guild && res.guild.name ? esc(res.guild.name) : 'Unknown';
        note(`Joined <b>${joinedName}</b>!`, 'guild-ok');
        try { Audio.play('guild'); } catch { /* ignore */ }
        await refresh();
        await syncGuildPerks(api); // Safety: refresh engine perk modifiers immediately.
      } catch (err) {
        note(esc(err.message), 'guild-error');
      }
    };
    listen('[data-act="join"]', 'click', doJoin);
    listen('#g-join-name', 'keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });

    wrap.querySelectorAll('[data-accept-invite]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          await gpost(api, '/api/guilds/invites/accept', { inviteId: Number(b.getAttribute('data-accept-invite')) });
          note('Welcome to the guild!', 'guild-ok');
          try { Audio.play('guild'); } catch { /* ignore */ }
          await refresh();
        } catch (err) {
          note(esc(err.message), 'guild-error');
        }
      });
    });
    wrap.querySelectorAll('[data-decline-invite]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          await gpost(api, '/api/guilds/invites/decline', { inviteId: Number(b.getAttribute('data-decline-invite')) });
          await refresh();
        } catch (err) {
          note(esc(err.message), 'guild-error');
        }
      });
    });
  }

  // ---------------- hall ----------------
  function renderHall(guild, members, challenges) {
    const myRank = guild.myRank || 'member';
    const canManage = myRank === 'master' || myRank === 'officer';
    const bannerEmoji = BANNER_EMOJI[guild.banner_style] || BANNER_EMOJI.shadow;
    const lvl = Number(guild.level) || 1;
    const xp = Number(guild.xp) || 0;
    const xpNext = Number(guild.xpForNext) || 1;
    const xpPrev = xpForLevelFloor(lvl);
    const pct = Math.max(0, Math.min(100, ((xp - xpPrev) / Math.max(1, xpNext - xpPrev)) * 100));

    wrap.innerHTML = `
      <div class="guild-hall">
        <div class="guild-hall-top">
          <div class="guild-banner" aria-hidden="true">${bannerEmoji}</div>
          <div class="guild-hall-name">
            <h3 class="guild-name">${esc(guild.name)} <span class="guild-tag">[${esc(guild.tag)}]</span></h3>
            <div class="guild-lvl">⚜️ Level ${lvl} Guild · ${members.length} member${members.length === 1 ? '' : 's'} · you are ${esc((RANK_META[myRank] || RANK_META.member).label)}</div>
          </div>
        </div>
        <div class="guild-xpbar" role="progressbar" aria-label="Guild XP">
          <i style="width:${pct.toFixed(1)}%"></i>
          <span>${fmtNum(xp)} / ${fmtNum(xpNext)} XP</span>
        </div>
        <div class="guild-motd">
          <span class="motd-label">📌 Message of the Day</span>
          <span class="motd-text">${guild.motd ? esc(guild.motd) : '<i style="color:#6f5fa3">No message set.</i>'}</span>
          ${canManage ? '<div class="motd-edit"><button class="btn small" data-act="edit-motd">Edit</button></div>' : ''}
        </div>
      </div>
      <div class="guild-tabs" role="tablist">
        ${['chat', 'roster', 'info'].map((t, i) =>
          `<button class="guild-tabbtn${i === 0 ? ' active' : ''}" data-subtab="${t}" role="tab">${subTabLabel(t)}</button>`
        ).join('')}
      </div>
      <div class="guild-panel"></div>`;

    listen('[data-act="edit-motd"]', 'click', async () => {
      const next = window.prompt('Message of the Day (max 200 characters):', guild.motd || '');
      if (next === null) return;
      try {
        const res = await gpost(api, '/api/guilds/motd', { motd: next });
        guild.motd = res.motd;
        const mt = wrap.querySelector('.motd-text');
        if (mt) mt.innerHTML = res.motd ? esc(res.motd) : '<i style="color:#6f5fa3">No message set.</i>';
        note('Message of the Day updated.', 'guild-ok');
      } catch (err) {
        note(esc(err.message), 'guild-error');
      }
    });

    const panel = () => wrap.querySelector('.guild-panel');
    const setActiveTab = (name) => {
      stopChatPoll();
      const btns = wrap.querySelectorAll('.guild-tabbtn');
      btns.forEach((b) => b.classList.toggle('active', b.dataset.subtab === name));
      const p = panel();
      if (!p) return;
      if (name === 'chat') renderChatTab(p, guild);
      else if (name === 'roster') renderRosterTab(p, guild, members, myState);
      else if (name === 'info') renderInfoTab(p, guild, members, challenges);
    };
    wrap.querySelectorAll('.guild-tabbtn').forEach((b) => {
      b.addEventListener('click', () => setActiveTab(b.dataset.subtab));
    });
    setActiveTab('chat');
  }

  function subTabLabel(t) {
    return { chat: '💬 Chat', roster: '👥 Roster', info: 'ℹ️ Info' }[t] || t;
  }

  // Cumulative XP floor for a guild level (mirrors server xpForGuildLevel).
  function xpForLevelFloor(level) {
    const L = Math.max(1, Math.floor(level));
    if (L <= 1) return 0;
    return 250 * (L - 1) * L;
  }

  function fmtNum(n) {
    const v = Number(n) || 0;
    if (v >= 1e18) return (v / 1e18).toFixed(1) + 'Q';
    if (v >= 1e15) return (v / 1e15).toFixed(1) + 'q';
    if (v >= 1e12) return (v / 1e12).toFixed(1) + 'T';
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.floor(v));
  }

  // ---------------- guild hall tab ----------------
  // Shared buildings funded by member donations. Treasury holds donated gold;
  // officers/master spend it on building upgrades (max level 10 each).
  const HALL_BUILDINGS = {
    valor: { name: 'Hall of Valor', emoji: '⚔️', desc: '+1% XP and +2% damage per level' },
    treasury: { name: 'Treasury', emoji: '💰', desc: '+2% gold per level' },
    forge: { name: 'Forge Shrine', emoji: '⛏️', desc: '+3% mining yield per level' },
  };
  const HALL_MAX = 10;
  function hallCost(level) {
    return 100000 * Math.pow(2, Math.max(0, Math.floor(level || 0)));
  }

  function renderHallTab(panel, guild) {
    const myRank = guild.myRank || 'member';
    const canUpgrade = myRank === 'master' || myRank === 'officer';
    const treasuryGold = Math.floor(Number(guild.treasury_gold) || 0);
    const playerGold = Math.floor(Number(myState && myState.gold) || 0);

    const buildingCards = Object.entries(HALL_BUILDINGS).map(([id, b]) => {
      const level = Math.max(0, Math.min(HALL_MAX, Math.floor(Number(guild['hall_' + id + '_level']) || 0)));
      const maxed = level >= HALL_MAX;
      const cost = maxed ? null : hallCost(level);
      const afford = cost !== null && treasuryGold >= cost;
      const pct = (level / HALL_MAX) * 100;
      return `
        <div class="guild-hall-building">
          <div class="hall-b-head"><span class="hall-b-emoji">${b.emoji}</span>
            <div><div class="hall-b-name">${b.name}</div><div class="hall-b-desc">${b.desc}</div></div>
            <div class="hall-b-level">Lv ${level}<span class="hall-b-max">/${HALL_MAX}</span></div>
          </div>
          <div class="hall-b-bar" role="progressbar" aria-label="${b.name} level"><i style="width:${pct.toFixed(0)}%"></i></div>
          ${maxed
            ? '<div class="hall-b-maxed">✨ MAX LEVEL</div>'
            : canUpgrade
              ? `<button class="btn small hall-upgrade" data-building="${id}" ${afford ? '' : 'disabled'}>Upgrade — ${fmtNum(cost)} 🪙</button>${afford ? '' : '<div class="hall-b-need">Need ' + fmtNum(cost - treasuryGold) + ' more in treasury</div>'}`
              : '<div class="hall-b-locked">🔒 Officers only</div>'}
        </div>`;
    }).join('');

    panel.innerHTML = `
      <div class="guild-hall-tab">
        <div class="hall-treasury">
          <div class="hall-treasury-top">
            <span class="hall-treasury-label">🏦 Guild Treasury</span>
            <span class="hall-treasury-amount">${fmtNum(treasuryGold)} 🪙</span>
          </div>
          <p class="guild-sub">Donate your personal gold to fund shared hall upgrades. Donations are permanent.</p>
          <div class="hall-donate-row">
            <input type="number" class="hall-donate-input" min="1" max="${playerGold}" placeholder="Amount" aria-label="Donation amount" />
            <button class="btn small hall-donate-btn">Donate</button>
          </div>
          <div class="hall-donate-hint">Your gold: ${fmtNum(playerGold)} 🪙</div>
        </div>
        <div class="hall-buildings">${buildingCards}</div>
      </div>`;

    // Donate handler
    const donateBtn = panel.querySelector('.hall-donate-btn');
    const donateInput = panel.querySelector('.hall-donate-input');
    if (donateBtn && donateInput) {
      donateBtn.addEventListener('click', async () => {
        const amount = Math.floor(Number(donateInput.value));
        if (!Number.isFinite(amount) || amount <= 0) {
          note('Enter a valid donation amount.', 'guild-error');
          return;
        }
        donateBtn.disabled = true;
        try {
          const res = await gpost(api, '/api/guilds/donate', { amount });
          // Update local state gold immediately so the next autosave persists the deduction.
          if (myState && typeof myState.gold === 'number') myState.gold = res.newGold;
          guild.treasury_gold = res.treasuryGold;
          note(`Donated ${fmtNum(res.donated)} gold to the treasury!`, 'guild-ok');
          renderHallTab(panel, guild); // refresh
          try { await syncGuildPerks(api); } catch { /* ignore */ }
        } catch (err) {
          note(esc(err.message), 'guild-error');
        } finally {
          donateBtn.disabled = false;
        }
      });
    }

    // Upgrade handlers
    panel.querySelectorAll('.hall-upgrade').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const building = btn.dataset.building;
        if (!building || !HALL_BUILDINGS[building]) return;
        btn.disabled = true;
        try {
          const res = await gpost(api, '/api/guilds/upgrade-hall', { building });
          guild.treasury_gold = res.treasuryGold;
          guild['hall_' + res.building + '_level'] = res.newLevel;
          if (res.perks) {
            guild.perks = res.perks;
            try { setGuildPerks(res.perks); } catch { /* ignore */ }
          }
          note(`${res.buildingName} upgraded to level ${res.newLevel}!`, 'guild-ok');
          renderHallTab(panel, guild); // refresh
        } catch (err) {
          note(esc(err.message), 'guild-error');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  // ---------------- chat tab ----------------
  function renderChatTab(panel, guild) {
    panel.innerHTML = `
      <div class="guild-chatlog" aria-live="polite"></div>
      <div class="guild-chatrow">
        <input class="guild-input" data-chat-input maxlength="500" placeholder="Message the guild…" autocomplete="off">
        <button class="btn small gold" data-chat-send>Send</button>
      </div>`;
    const log = panel.querySelector('.guild-chatlog');
    const input = panel.querySelector('[data-chat-input]');
    let lastId = 0;
    let firstLoad = true;
    const canModChat = (GUILD_LEVEL[guild.myRank] || 0) >= (GUILD_LEVEL.officer || 3);

    const nearBottom = () => {
      if (!log) return true;
      return log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    };
    const scrollBottom = () => {
      if (log) log.scrollTop = log.scrollHeight;
    };
    const msgHtml = (m) => `
      <div class="guild-msg">
        <span class="who">${UI.nameHtml(m.username, m)}</span><span class="txt">${esc(m.message)}</span><span class="when">${esc(timeAgo(m.created_at))}</span>${canModChat ? `<button class="guild-msgdel" data-del="${Number(m.id) || 0}" title="Delete message" aria-label="Delete message">✕</button>` : ''}
      </div>`;

    async function poll() {
      if (!document.body.contains(panel)) { stopChatPoll(); return; }
      try {
        const data = await gget(api, `/api/guilds/chat?after=${lastId}`);
        const msgs = (data && data.messages) || [];
        if (msgs.length && log) {
          const stick = firstLoad || nearBottom();
          for (const m of msgs) {
            lastId = Math.max(lastId, Number(m.id) || 0);
            log.insertAdjacentHTML('beforeend', msgHtml(m));
          }
          if (stick) scrollBottom();
        }
        firstLoad = false;
      } catch {
        // offline-tolerant; keep polling
      }
    }

    const send = async () => {
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        await gpost(api, '/api/guilds/chat', { message: text });
        await poll();
      } catch (err) {
        note(esc(err.message), 'guild-error');
        input.value = text;
      }
    };
    const sendBtn = panel.querySelector('[data-chat-send]');
    if (sendBtn) sendBtn.addEventListener('click', send);
    if (input) input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });
    if (log) log.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-del]');
      if (!btn || !canModChat) return;
      const id = Number(btn.getAttribute('data-del'));
      if (!id) return;
      try {
        await gdel(api, `/api/guilds/chat/${id}`);
        const row = btn.closest('.guild-msg');
        if (row) row.remove();
      } catch (err) {
        note(esc(err.message), 'guild-error');
      }
    });
    poll();
    stopChatPoll();
    chatTimer = setInterval(poll, 5000);
  }

  // ---------------- news tab ----------------
  async function renderNewsTab(panel) {
    panel.innerHTML = '<div class="guild-loading">Loading news…</div>';
    try {
      const data = await gget(api, '/api/guilds/news');
      const items = (data && data.news) || [];
      panel.innerHTML = items.length
        ? items.map((n) => `
          <div class="guild-newsitem">
            <span class="nic">${NEWS_EMOJI[n.kind] || '📰'}</span>
            <span class="ntx">${esc(n.text)}<span class="nwhen">${esc(timeAgo(n.created_at))}</span></span>
          </div>`).join('')
        : '<p class="guild-sub">No guild news yet. Found the guild, slay together, make history.</p>';
    } catch (err) {
      panel.innerHTML = `<div class="guild-error">${esc(err.message)}</div>`;
    }
  }

  // ---------------- roster tab ----------------
  function renderRosterTab(panel, guild, members, myState) {
    const myRank = guild.myRank || 'member';
    const me = String(guild.myName || '').toLowerCase();
    const myLvl = GUILD_LEVEL[myRank] || 0;
    const rows = members.map((m) => {
      const online = m.lastActive && (Date.now() - m.lastActive) < ONLINE_WINDOW_MS;
      const mRank = m.rank || 'member';
      const mLvl = GUILD_LEVEL[mRank] || 0;
      const isMe = String(m.username).toLowerCase() === me;
      const canAct = !isMe && myLvl >= GUILD_LEVEL.officer && myLvl > mLvl;
      const acts = [];
      if (canAct) {
        // Offer only rank changes the server would accept: target and new
        // rank both strictly below the actor's rank.
        const offer = (rank, label) => {
          if ((GUILD_LEVEL[rank] || 0) < myLvl) {
            acts.push(`<button class="btn small" data-promote="${esc(m.username)}" data-rank="${rank}">${label}</button>`);
          }
        };
        if (mRank === 'initiate') {
          offer('member', '↑ Member');
          offer('officer', '↑ Officer');
        } else if (mRank === 'member') {
          offer('officer', '↑ Officer');
          offer('initiate', '↓ Initiate');
        } else if (mRank === 'officer') {
          offer('member', '↓ Member');
          offer('initiate', '↓ Initiate');
        }
        acts.push(`<button class="btn small danger" data-kick="${esc(m.username)}">Kick</button>`);
      }
      return `
        <div class="guild-member">
          <div class="avatar">🛡️</div>
          <div class="minfo">
            <div class="mname"><span class="online-dot ${online ? 'on' : 'off'}" title="${online ? 'Online' : 'Offline'}"></span>${UI.nameHtml(m.username, isMe ? myState : m)}${m.title ? ` <span class="mtitle">${esc(m.title)}</span>` : ''}</div>
            <div class="msub">Lv ${m.level == null ? '—' : m.level} · ${esc(classLabel(m.playerClass, m.spec))} · Stage ${m.stage == null ? '—' : m.stage}${m.lastActive ? ` · ${online ? 'online now' : 'last seen ' + esc(timeAgo(m.lastActive))}` : ''}</div>
          </div>
          ${rankPill(mRank)}
          ${acts.length ? `<div class="guild-macts">${acts.join('')}</div>` : ''}
        </div>`;
    }).join('');
    const canInvite = myLvl >= (GUILD_LEVEL.officer || 0);
    panel.innerHTML = (canInvite ? `
      <div class="guild-row" style="margin-bottom:10px">
        <input class="guild-input" id="g-invite-name" maxlength="20" placeholder="Player name to invite" autocomplete="off">
        <button class="btn small gold" id="g-invite-btn">Invite</button>
      </div>` : '')
      + (rows || '<p class="guild-sub">No members yet.</p>');

    if (canInvite) {
      const doInvite = async () => {
        const nameEl = panel.querySelector('#g-invite-name');
        const username = nameEl && nameEl.value;
        if (!username || !username.trim()) return;
        try {
          await gpost(api, '/api/guilds/invite', { username: username.trim() });
          note(`Invitation sent to <b>${esc(username.trim())}</b>.`, 'guild-ok');
          if (nameEl) nameEl.value = '';
        } catch (err) {
          note(esc(err.message), 'guild-error');
        }
      };
      const ib = panel.querySelector('#g-invite-btn');
      if (ib) ib.addEventListener('click', doInvite);
      const inp = panel.querySelector('#g-invite-name');
      if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doInvite(); });
    }

    panel.querySelectorAll('[data-promote]').forEach((b) => {
      b.addEventListener('click', async () => {
        const username = b.getAttribute('data-promote');
        const rank = b.getAttribute('data-rank');
        try {
          await gpost(api, '/api/guilds/rank', { username, rank });
          note(`${esc(username)} is now ${esc(rank)}.`, 'guild-ok');
          await refresh();
        } catch (err) {
          note(esc(err.message), 'guild-error');
        }
      });
    });
    panel.querySelectorAll('[data-kick]').forEach((b) => {
      b.addEventListener('click', async () => {
        const username = b.getAttribute('data-kick');
        if (!window.confirm(`Remove ${username} from the guild?`)) return;
        try {
          await gpost(api, '/api/guilds/kick', { username });
          note(`${esc(username)} was removed.`, 'guild-ok');
          await refresh();
        } catch (err) {
          note(esc(err.message), 'guild-error');
        }
      });
    });
  }

  // Client mirror of the server rank ladder (for showing/hiding controls;
  // the server re-checks everything).
  const GUILD_LEVEL = { initiate: 1, member: 2, officer: 3, master: 4 };

  // ---------------- perks tab ----------------
  function renderPerksTab(panel, guild) {
    const lvl = Number(guild.level) || 1;
    const perks = guild.perks || { xpPct: 2 * lvl, goldPct: lvl, dmgPct: Math.floor(lvl / 2) };
    const rows = [
      { name: '📚 Guild Wisdom', desc: `+${2}/guild level XP gain`, val: `+${perks.xpPct}% XP` },
      { name: '💰 Guild Prosperity', desc: `+${1}/guild level gold gain`, val: `+${perks.goldPct}% Gold` },
      { name: '⚔️ Guild Might', desc: '+1%/2 guild levels damage', val: `+${perks.dmgPct}% Damage` },
    ];
    panel.innerHTML = `
      <p class="guild-sub">Your guild is <b style="color:#e8b33c">level ${lvl}</b>. Perks apply to every member automatically.</p>
      ${rows.map((r) => `
        <div class="guild-perk">
          <div><div class="pname">${r.name}</div><div class="pdesc">${r.desc}</div></div>
          <div class="pval">${r.val}</div>
        </div>`).join('')}
      <p class="guild-sub">Earn guild XP from member activity — kills, boss kills, and quest completions. Next level at ${fmtNum(guild.xpForNext)} total XP.</p>`;
  }

  // ---------------- rewards tab ----------------
  async function renderRewardsTab(panel, guild) {
    panel.innerHTML = '<div class="guild-loading">Loading vendor…</div>';
    let data;
    try {
      data = await gget(api, '/api/guilds/vendor');
    } catch (err) {
      panel.innerHTML = `<div class="guild-error">${esc(err.message)}</div>`;
      return;
    }
    const items = data.items || [];
    const credits = Number(data.credits) || 0;
    const unlocked = data.unlockedBanners || ['shadow'];
    const canSetBanner = !!data.canSetBanner;
    const myTitle = data.myTitle || null;

    panel.innerHTML = `
      <div class="guild-credits">🪙 ${credits} guild credits
        <span class="guild-sub" style="margin:0">— earn more by contributing guild XP</span>
      </div>
      ${myTitle ? `<p class="guild-sub">Your title: <b style="color:#c084fc">${esc(myTitle)}</b></p>` : ''}
      ${items.map((it) => {
        const owned = it.kind === 'banner' && unlocked.includes(it.id.replace('banner-', ''));
        const isTitle = it.kind === 'title' && myTitle === it.name;
        const active = it.kind === 'banner' && data.bannerStyle === it.id.replace('banner-', '');
        return `
        <div class="guild-vitem${owned || isTitle ? ' owned' : ''}">
          <span class="vemoji">${esc(it.emoji || '🎁')}</span>
          <div class="vinfo">
            <div class="vname">${esc(it.name)}${active ? ' <span class="rank-pill member">active</span>' : ''}${owned && !active ? ' <span class="rank-pill initiate">owned</span>' : ''}</div>
            <div class="vdesc">${esc(it.desc)}</div>
          </div>
          <div class="vbuy">
            <span class="vcost">🪙 ${it.cost}</span>
            ${owned
              ? (canSetBanner && !active ? `<button class="btn small gold" data-setbanner="${esc(it.id.replace('banner-', ''))}">Raise</button>` : '')
              : (isTitle ? '' : `<button class="btn small gold" data-buy="${esc(it.id)}"${credits < it.cost ? ' disabled' : ''}>Buy</button>`)}
          </div>
        </div>`;
      }).join('')}
      <p class="guild-sub">Banners and titles are purely cosmetic — no combat advantage.</p>`;

    panel.querySelectorAll('[data-buy]').forEach((b) => {
      b.addEventListener('click', async () => {
        const itemId = b.getAttribute('data-buy');
        try {
          await gpost(api, '/api/guilds/vendor/buy', { itemId });
          note('Purchase complete!', 'guild-ok');
          try { Audio.play('claim'); } catch { /* ignore */ }
          await refresh();
        } catch (err) {
          note(esc(err.message), 'guild-error');
        }
      });
    });
    panel.querySelectorAll('[data-setbanner]').forEach((b) => {
      b.addEventListener('click', async () => {
        const style = b.getAttribute('data-setbanner');
        try {
          await gpost(api, '/api/guilds/banner', { style });
          note('Banner raised!', 'guild-ok');
          await refresh();
        } catch (err) {
          note(esc(err.message), 'guild-error');
        }
      });
    });
  }

  // ---------------- info tab ----------------
  function renderInfoTab(panel, guild, members, challenges) {
    const canManage = guild.myRank === 'master' || guild.myRank === 'officer';
    const created = guild.created_at ? new Date(guild.created_at).toLocaleDateString() : '—';
    const chals = (challenges || []).map((c) => {
      const pct = Math.max(0, Math.min(100, (Number(c.progress) / Math.max(1, Number(c.target))) * 100));
      return `
        <div class="guild-chal${c.completed ? ' done' : ''}">
          <div class="chead"><span>${esc(c.emoji || '🏰')} ${esc(c.name)} — ${esc(c.desc)}</span><span>${c.completed ? '✅ Complete' : `${fmtNum(c.progress)} / ${fmtNum(c.target)}`}</span></div>
          <div class="cbar"><i style="width:${pct.toFixed(1)}%"></i></div>
        </div>`;
    }).join('');

    panel.innerHTML = `
      <div class="card">
        <h3 class="guild-title">📜 About this guild</h3>
        <div class="guild-desc">${guild.description ? esc(guild.description) : '<i style="color:#6f5fa3">No description yet.</i>'}</div>
        ${canManage ? '<button class="btn small" data-act="edit-desc">Edit description</button>' : ''}
      </div>
      <div class="card">
        <h3 class="guild-title">🎯 Weekly challenges</h3>
        <p class="guild-sub">Progress as a guild. Completing a challenge grants bonus guild XP.</p>
        ${chals || '<p class="guild-sub">No challenges this week.</p>'}
      </div>
      <div class="card">
        <h3 class="guild-title">🏰 Guild details</h3>
        <div class="guild-meta">Founded ${esc(created)} · ${members.length} member${members.length === 1 ? '' : 's'} · Level ${Number(guild.level) || 1}</div>
        <button class="btn small danger" data-act="leave">Leave guild</button>
      </div>`;

    const editBtn = panel.querySelector('[data-act="edit-desc"]');
    if (editBtn) editBtn.addEventListener('click', async () => {
      const next = window.prompt('Guild description (max 500 characters):', guild.description || '');
      if (next === null) return;
      try {
        const res = await gpost(api, '/api/guilds/description', { description: next });
        guild.description = res.description;
        note('Description updated.', 'guild-ok');
        const p = wrap.querySelector('.guild-panel');
        if (p) renderInfoTab(p, guild, members, challenges);
      } catch (err) {
        note(esc(err.message), 'guild-error');
      }
    });

    const leaveBtn = panel.querySelector('[data-act="leave"]');
    if (leaveBtn) leaveBtn.addEventListener('click', async () => {
      const lastOne = members.length === 1;
      const msg = lastOne
        ? `Leave and disband "${guild.name}"?`
        : `Leave "${guild.name}"?${guild.myRank === 'master' ? ' Guild Master passes to the longest-standing member.' : ''}`;
      if (!window.confirm(msg)) return;
      try {
        const res = await gpost(api, '/api/guilds/leave', {});
        // Safety: guard against malformed API response (missing fields).
        const leftName = esc((res && res.guildName) || 'Unknown');
        note(
          res && res.guildDeleted
            ? `Guild <b>${leftName}</b> disbanded.`
            : `You left <b>${leftName}</b>.`,
          'guild-ok'
        );
        try { Audio.play('guild'); } catch { /* ignore */ }
        await refresh();
        await syncGuildPerks(api); // Safety: refresh engine perk modifiers immediately.
      } catch (err) {
        note(esc(err.message), 'guild-error');
      }
    });
  }

  refresh();
}
