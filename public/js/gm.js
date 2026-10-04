// ============================================================
// gm.js — GM console UI. Only opened for staff roles.
// ============================================================
import { api } from './api.js?v=20260930ar';
import { UI, esc, formatNum } from './ui.js?v=20261001e';
import { PRIVILEGED_SETS, TITLES, BADGES, CLASSES, SPECS } from './engine.js?v20261003bi';

const SET_IDS = Object.keys(PRIVILEGED_SETS);

// Staff tiers for the console. Server re-checks every route; this only
// decides which cards to render.
const canGm = (role) => role === 'owner' || role === 'gm';          // grant endpoints
const canAdmin = (role) => role === 'owner' || role === 'admin';     // player-mgmt endpoints
const canMod = (role) => canAdmin(role) || role === 'moderator';     // moderation endpoints

// Human-readable description of a gift code's reward.
function describeReward(kind, amount, set) {
  if (kind === 'gold') return `💰 ${formatNum(Number(amount) || 0)} gold`;
  if (kind === 'stars') return `⭐ ${formatNum(Number(amount) || 0)} stars`;
  return (PRIVILEGED_SETS[set] || {}).name || set || 'gear';
}

// ID reference panel (lazy-loaded to avoid circular imports).
let IdRef = null;
async function loadIdRef() {
  if (!IdRef) {
    try {
      IdRef = await import('./id-reference.js?v20261003x');
    } catch (e) { console.error('Failed to load id-reference:', e); }
  }
  return IdRef;
}

export const GM = {
  me: null,

  open(me) {
    this.me = me;
    const role = (me && me.role) || 'player';
    if (!canGm(role) && !canMod(role)) {
      UI.toast('GM console is for staff only.', 'error');
      return;
    }
    UI.showView('gm');
    this.render();
  },

  initCommandCenter(root, $, on) {
    const cc = root.querySelector('#gm-command-center');
    if (!cc) return;
    // Live clock
    const timeEl = cc.querySelector('#gm-cc-time');
    const tickClock = () => { if (timeEl) timeEl.textContent = new Date().toLocaleString(); };
    tickClock(); setInterval(tickClock, 1000);
    // Tabs
    cc.querySelectorAll('.gm-cc-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        cc.querySelectorAll('.gm-cc-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        cc.querySelectorAll('.gm-cc-pane').forEach(p => p.classList.add('hidden'));
        const pane = cc.querySelector('#gm-cc-' + tab.dataset.cc);
        if (pane) pane.classList.remove('hidden');
      });
    });
    // Roster
    const loadRoster = async () => {
      const list = cc.querySelector('#gm-roster-list');
      try {
        const r = await fetch('/api/gm/roster-live', { credentials: 'include' });
        const j = await r.json();
        if (!j.ok) throw new Error('failed');
        const fmtTime = (ts) => ts ? new Date(ts).toLocaleString() : 'never';
        list.innerHTML = j.players.map(p =>
          `<div class="gm-roster-row"><span class="${p.online ? 'gm-online' : 'gm-offline'}">${p.online ? '🟢' : '🔴'}</span>` +
          `<span class="nm">${esc(p.username)}</span><span class="meta">Lv ${p.level} · ${esc(p.role)}</span>` +
          `<span class="meta" title="${fmtTime(p.lastSeen)}">${p.online ? 'online now' : 'last: ' + fmtTime(p.lastSeen)}</span></div>`
        ).join('') || '<p class="muted">No players.</p>';
      } catch (e) { list.innerHTML = '<p class="error">Could not load roster.</p>'; }
    };
    // Live view
    const loadLive = async () => {
      const list = cc.querySelector('#gm-live-list');
      try {
        const r = await fetch('/api/gm/snapshots', { credentials: 'include' });
        const j = await r.json();
        if (!j.ok) throw new Error('failed');
        const snaps = Object.entries(j.snapshots || {});
        if (!snaps.length) { list.innerHTML = '<p class="muted">No active players right now.</p>'; return; }
        list.innerHTML = snaps.map(([user, s]) =>
          `<div class="gm-live-row"><span class="nm">${esc(user)}</span> ` +
          `<span class="act">${esc(s.action)}</span><br>` +
          `<span class="det">${esc(s.detail)}</span> ` +
          `<span class="ts">${new Date(s.ts).toLocaleTimeString()}</span></div>`
        ).join('');
      } catch (e) { list.innerHTML = '<p class="error">Could not load live view.</p>'; }
    };
    loadRoster(); loadLive();
    setInterval(loadRoster, 30000); setInterval(loadLive, 15000);
    // OP gear forge
    on('opgear-forge', 'click', async () => {
      const result = cc.querySelector('#opgear-result');
      const username = cc.querySelector('#opgear-user').value.trim();
      const name = cc.querySelector('#opgear-name').value.trim();
      const slot = cc.querySelector('#opgear-slot').value;
      const rarity = cc.querySelector('#opgear-rarity').value;
      const stats = {};
      const getNum = (id) => { const v = Number(cc.querySelector('#' + id).value); return Number.isFinite(v) && v !== 0 ? v : null; };
      const atk = getNum('opgear-atk'), hp = getNum('opgear-hp'), def = getNum('opgear-def');
      const crit = getNum('opgear-crit'), ls = getNum('opgear-ls'), spd = getNum('opgear-spd');
      if (atk) stats.attack = atk; if (hp) stats.maxHp = hp; if (def) stats.defense = def;
      if (crit) stats.critChance = crit; if (ls) stats.lifesteal = ls; if (spd) stats.attackSpeed = spd;
      if (!username || !name) { result.textContent = 'Enter target username and item name.'; return; }
      if (!Object.keys(stats).length) { result.textContent = 'Enter at least one stat.'; return; }
      result.textContent = 'Forging…';
      try {
        const r = await fetch('/api/gm/create-op-gear', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, name, slot, rarity, stats }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || 'Forge failed');
        result.textContent = `✅ Forged "${j.item.name}" for ${username}!`;
        if (window.UI) window.UI.toast(`⚔️ OP gear granted to ${username}!`, 'success');
      } catch (e) { result.textContent = '❌ ' + e.message; }
    });
  },

  bind(root) {
    const $ = (id) => root.querySelector('#' + id);
    // Cards render per role tier; elements for other tiers are absent.
    const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
    // ---- Command Center (owner only) ----
    this.initCommandCenter(root, $, on);
    // 2x event toggle
    on('gm-toggle-2x', 'click', () => {
      const s = window.App && window.App.state;
      if (!s) return;
      const is2x = (s.xpMultiplier || 1.0) >= 2.0;
      s.xpMultiplier = is2x ? 1.0 : 2.0;
      s.goldMultiplier = is2x ? 1.0 : 2.0;
      if (window.UI) {
        window.UI.toast(is2x ? '2x event OFF' : '🔥 2x XP & Gold ON!', is2x ? 'info' : 'success');
        if (window.UI.updateHUD) window.UI.updateHUD(s, window.App.user);
      }
      if (window.saveNow) window.saveNow();
    });
    // ID reference toggle
    let idrefLoaded = false;
    on('gm-idref-toggle', 'click', async () => {
      const panel = $('gm-idref-panel');
      if (!panel) return;
      const show = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !show);
      if (show && !idrefLoaded) {
        idrefLoaded = true;
        const mod = await loadIdRef();
        if (mod && mod.renderIdReference) {
          // Auto-fill: clicking a Pet ID fills the Species input; clicking an
          // Item ID (set:slot) sets the Give-item dropdowns; else focused input.
          mod.renderIdReference(panel, {
            onCopy: (id) => {
              let filled = false;
              // Item ID format: "setid:slot" -> set Give-item dropdowns
              const colonIdx = id.indexOf(':');
              if (colonIdx > 0) {
                const setId = id.slice(0, colonIdx);
                const slot = id.slice(colonIdx + 1);
                const setSel = document.getElementById('gm-grant-item-set');
                const slotSel = document.getElementById('gm-grant-item-slot');
                if (setSel && slotSel) {
                  const hasSet = [...setSel.options].some(o => o.value === setId);
                  const hasSlot = [...slotSel.options].some(o => o.value === slot);
                  if (hasSet && hasSlot) {
                    setSel.value = setId;
                    slotSel.value = slot;
                    setSel.dispatchEvent(new Event('change', { bubbles: true }));
                    filled = true;
                    UI.toast(`Set Give item: ${id}`, 'success');
                  }
                }
              }
              // Pet species ID -> fill the Species ID input
              if (!filled) {
                const speciesInput = document.getElementById('mod-pet-species');
                if (speciesInput && speciesInput.offsetParent !== null) {
                  speciesInput.value = id;
                  speciesInput.focus();
                  filled = true;
                  UI.toast(`Species ID set: ${id}`, 'success');
                }
              }
              // Fallback: focused input or clipboard
              if (!filled) {
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                  const start = active.selectionStart || 0;
                  const end = active.selectionEnd || 0;
                  const val = active.value || '';
                  active.value = val.slice(0, start) + id + val.slice(end);
                  active.focus();
                  try { active.setSelectionRange(start + id.length, start + id.length); } catch {}
                } else {
                  try { if (navigator.clipboard) navigator.clipboard.writeText(id); } catch {}
                }
                UI.toast(`Copied: ${id}`, 'success');
              }
            },
          });
        }
      }
    });
    const isGm = canGm(this.me.role);

    // Quick-jump chips in the sticky target bar: smooth-scroll to each section.
    // The sticky GM header + sticky target bar would otherwise cover the
    // jumped-to section, so measure both and offset via scroll-margin; the
    // target bar also parks just under the header instead of sliding beneath it.
    const gmHeader = document.querySelector('#view-gm .gm-header');
    const gmTarget = root.querySelector('.gm-target');
    const hdrH = gmHeader ? gmHeader.offsetHeight : 0;
    // Dynamic offsets travel as CSS custom properties; style.css owns how
    // they're applied (same pattern as the toast/tooltip vars in ui.js).
    if (gmTarget && hdrH) gmTarget.style.setProperty('--gm-target-top', hdrH + 'px');
    const jumpOffset = hdrH + (gmTarget ? gmTarget.offsetHeight : 0) + 12;
    root.querySelectorAll('[id^="gm-sec-"]').forEach((sec) => {
      sec.style.setProperty('--gm-jump-offset', jumpOffset + 'px');
    });
    root.querySelectorAll('[data-goto]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const el = document.getElementById(chip.dataset.goto);
        if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });

    // ---- single target player for every action ----
    const needTarget = () => {
      const el = $('gm-target-user');
      const u = el ? el.value.trim() : '';
      if (!u) { UI.toast('Pick a target player above first.', 'error'); return null; }
      return u;
    };
    on('gm-target-clear', 'click', () => {
      $('gm-target-user').value = '';
      const info = $('gm-target-info');
      if (info) info.textContent = 'Every action below applies to this player. It stays filled until you clear it.';
      const dz = $('gm-dossier');
      if (dz) { dz.innerHTML = ''; dz.classList.add('hidden'); }
    });

    // ---- action log: every console action lands here with its exact result,
    // so a failure is never a mystery (shows the real server error text). ----
    const logAction = (ok, text) => {
      const list = $('gm-log');
      if (!list) return;
      const empty = $('gm-log-empty');
      if (empty) empty.remove();
      const time = new Date().toLocaleTimeString();
      const div = document.createElement('div');
      div.className = 'gm-log-row ' + (ok ? 'ok' : 'err');
      const msg = document.createElement('span');
      msg.textContent = (ok ? '✅ ' : '❌ ') + text;
      const t = document.createElement('span');
      t.className = 'gm-log-time';
      t.textContent = time;
      div.appendChild(t);
      div.appendChild(msg);
      list.prepend(div);
      while (list.children.length > 30) list.lastChild.remove();
    };

    // ---- staff audit log (server-side, survives restarts) ----
    const loadAudit = async () => {
      const list = $('gm-audit-list');
      if (!list) return;
      list.innerHTML = '<p class="muted small">Loading…</p>';
      try {
        const { entries = [] } = await api.gmAudit();
        if (!entries.length) { list.innerHTML = '<p class="muted small">No staff actions recorded yet.</p>'; return; }
        list.innerHTML = entries.map(e => {
          const t = new Date(e.ts).toLocaleString();
          return `<div class="gm-log-row"><span class="gm-log-time">${esc(t)}</span><span><b>${esc(e.actor)}</b> <span class="muted">(${esc(e.actorRole)})</span> · ${esc(e.action)} → <b>${esc(e.target)}</b>${e.detail ? ' · ' + esc(e.detail) : ''}</span></div>`;
        }).join('');
      } catch (err) {
        list.innerHTML = `<p class="error small">Couldn't load audit log.</p>`;
      }
    };
    on('gm-audit-refresh', 'click', loadAudit);
    if ($('gm-audit-list')) loadAudit();

    // Runs a console action: disables the button with a spinner while the
    // request is in flight, then logs + toasts the exact outcome.
    // fn returns a success message, null to bail silently (already toasted).
    const runAction = async (btnId, label, fn) => {
      const el = $(btnId);
      const orig = el ? el.innerHTML : '';
      if (el) { el.disabled = true; el.innerHTML = '⏳ …'; }
      const t0 = Date.now();
      try {
        const msg = await fn();
        if (msg == null) return false;
        logAction(true, `${label}: ${msg} (${Date.now() - t0}ms)`);
        UI.toast(msg, 'success');
        // The staff audit log refreshes itself so you see the action recorded.
        if ($('gm-audit-list')) loadAudit();
        return true;
      } catch (e) {
        const errMsg = (e && e.message) || 'Failed.';
        logAction(false, `${label}: ${errMsg}`);
        UI.toast(`${label} failed: ${errMsg}`, 'error');
        return false;
      } finally {
        if (el) { el.disabled = false; el.innerHTML = orig; }
      }
    };

    // ---- target lookup: verify the name resolves before acting on it ----
    on('gm-target-lookup', 'click', () => runAction('gm-target-lookup', 'Lookup', async () => {
      const username = needTarget();
      if (!username) return null;
      const { players = [] } = await api.gmPlayers(username, 5);
      const p = players.find(x => x.username.toLowerCase() === username.toLowerCase()) || players[0];
      if (!p) throw new Error(`No player found matching "${username}".`);
      const cls = (CLASSES[p.playerClass] || {}).name || p.playerClass || '';
      const info = `${p.username} — Lv ${p.level} ${cls} · stage ${p.stage} · ${p.role}`;
      const infoEl = $('gm-target-info');
      if (infoEl) infoEl.textContent = '✅ ' + info;
      return info;
    }));

    // ---- dossier: full view of the target player's account + inspector ----
    const renderDossier = (d) => {
      const el = $('gm-dossier');
      if (!el) return;
      const row = (k, v) => `<div class="gm-dossier-row"><span class="muted">${esc(k)}</span><b>${v}</b></div>`;
      const inv = (d.inventorySample || []).map(esc).join('<br>') || '—';
      const muteNote = d.muted ? ` 🔇 muted` : '';
      // Presence indicator
      const pres = d.presence || {};
      const presIcon = pres.online ? '🟢' : '🔴';
      const presText = pres.online ? 'Online' : 'Offline';
      const lastSeen = pres.lastSeen ? new Date(pres.lastSeen).toLocaleString() : 'never';
      const isOwner = GM.me && GM.me.role === 'owner';
      // Equipped gear inspector (owner-only mod buttons)
      const gearRows = Object.entries(d.equippedGear || {}).map(([slot, item]) => {
        if (!item) return `<div class="gm-dossier-row"><span class="muted">${esc(slot)}</span><b>— empty —</b></div>`;
        const stats = Object.entries(item.stats || {}).map(([k, v]) => `${k}:${formatNum(v)}`).join(' ');
        const modBtn = isOwner ? ` <button class="btn small ghost" data-mod-item="${esc(item.id)}" data-item-name="${esc(item.name)}">⚙️ Mod</button>` : '';
        return `<div class="gm-dossier-row"><span class="muted">${esc(slot)}</span><b>${esc(item.name)} <span class="muted small">[${esc(item.rarity || '?')}]</span><br><span class="muted small">${esc(stats)}</span>${modBtn}</b></div>`;
      }).join('') || '<div class="muted">No gear data</div>';
      // Pet inspector (owner-only mod/remove buttons)
      const petRows = (d.petInspector && d.petInspector.pets || []).map(p => {
        const active = d.petInspector.activeUid === p.uid ? ' ⭐' : '';
        const modBtn = isOwner ? ` <button class="btn small ghost" data-mod-pet="${esc(p.uid)}">⚙️ Mod</button> <button class="btn small ghost" data-remove-pet="${esc(p.uid)}" style="color:#f66">🗑️</button>` : '';
        return `<div class="gm-dossier-row"><span class="muted">${esc(p.species)}${active}</span><b>Lv ${p.level} · Hunger ${p.hunger}%${modBtn}</b></div>`;
      }).join('') || '<div class="muted">No pets</div>';
      el.innerHTML = `
        <h4 class="gm-sub" style="margin-top:0.8rem">📋 Dossier — ${esc(d.username)}${muteNote}</h4>
        <div class="gm-dossier-row"><span class="muted">Presence</span><b>${presIcon} ${presText} <span class="muted small">(last seen: ${esc(lastSeen)})</span></b></div>
        <div class="gm-dossier-grid">
          <div>${row('Role', esc(d.role))}${row('Class', esc(d.playerClass + ' / ' + d.spec))}${row('Level', d.level + ' · ' + formatNum(d.xp) + '/' + formatNum(d.xpNext) + ' XP')}${row('Stage', d.stage)}${row('Rebirths', d.rebirthCount)}${row('Banned', d.banned ? 'yes' : 'no')}</div>
          <div>${row('💰 Gold', formatNum(d.gold))}${row('⭐ Stars', formatNum(d.stars))}${row('❤️ HP', formatNum(d.hero.hp) + '/' + formatNum(d.hero.maxHp))}${row('⚔️ Attack', formatNum(d.hero.attack))}${row('🛡️ Defense', formatNum(d.hero.defense))}${row('👑 Title', esc(d.activeTitle) + ' (' + d.titlesUnlocked + ' unlocked)')}${row('🏅 Badge', esc(d.badge))}</div>
          <div>${row('🎒 Inventory', d.inventoryCount + ' items')}${row('🐾 Pets', d.pets.eggs + ' eggs · ' + d.pets.active + ' active')}${row('⛏️ Mine', 'depth ' + d.mine.depth + ' · pickaxe ' + d.mine.pickaxe)}${row('🔥 Forge', d.forge.crafts + ' crafts')}${row('💀 Kills', formatNum(d.kills) + ' · ' + formatNum(d.bossesKilled) + ' bosses')}${row('🎨 Name style', esc(String(d.nameStyle.color || 'default')) + ' / ' + esc(d.nameStyle.fx))}</div>
        </div>
        <h4 class="gm-sub">⚔️ Equipped Gear Inspector</h4>
        ${gearRows}
        <h4 class="gm-sub">🐾 Pet Inspector</h4>
        ${petRows}
        <div class="gm-dossier-row"><span class="muted">Recent items</span><b>${inv}</b></div>`;
      el.classList.remove('hidden');
      // Wire mod/remove buttons
      el.querySelectorAll('[data-mod-item]').forEach(btn => {
        btn.addEventListener('click', () => openItemModder(btn.dataset.modItem, btn.dataset.itemName));
      });
      el.querySelectorAll('[data-mod-pet]').forEach(btn => {
        btn.addEventListener('click', () => openPetModder(btn.dataset.modPet));
      });
      el.querySelectorAll('[data-remove-pet]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Remove pet ${btn.dataset.removePet}?`)) return;
          const username = needTarget();
          await api.gmRemovePet(username, btn.dataset.removePet);
          UI.toast('Pet removed', 'success');
          // Refresh dossier
          const res = await api.gmInspect(username);
          renderDossier(res.dossier);
        });
      });
    };

    // ---- Item modder modal ----
    const openItemModder = (itemId, itemName) => {
      const stats = ['attack', 'defense', 'maxHp', 'critChance', 'critDamage', 'parry', 'dodge', 'lifesteal', 'attackSpeed', 'regen', 'goldBonus', 'xpBonus'];
      const fields = stats.map(s => `<label class="fld"><span>${s}</span><input type="number" data-stat="${s}" placeholder="—" style="width:100%"></label>`).join('');
      const html = `
        <div class="modal-overlay" id="item-modder-modal">
          <div class="modal" style="max-width:500px">
            <h3>⚙️ Mod Item: ${esc(itemName)}</h3>
            <p class="muted small">Enter custom values (no caps). Leave blank to keep current.</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${fields}</div>
            <label class="fld" style="margin-top:8px"><span>Rename (optional)</span><input type="text" id="mod-item-name" placeholder="—" style="width:100%"></label>
            <div class="row" style="margin-top:12px">
              <button class="btn gold" id="mod-item-save">💾 Apply</button>
              <button class="btn ghost" id="mod-item-cancel">Cancel</button>
            </div>
          </div>
        </div>`;
      document.body.insertAdjacentHTML('beforeend', html);
      const modal = document.getElementById('item-modder-modal');
      modal.querySelector('#mod-item-cancel').addEventListener('click', () => modal.remove());
      modal.querySelector('#mod-item-save').addEventListener('click', async () => {
        const statVals = {};
        modal.querySelectorAll('[data-stat]').forEach(inp => {
          if (inp.value !== '') statVals[inp.dataset.stat] = Number(inp.value);
        });
        const newName = modal.querySelector('#mod-item-name').value.trim() || undefined;
        if (Object.keys(statVals).length === 0 && !newName) {
          UI.toast('No changes entered', 'error');
          return;
        }
        const username = needTarget();
        await api.gmModItem(username, itemId, statVals, newName);
        UI.toast('Item modded', 'success');
        modal.remove();
        const res = await api.gmInspect(username);
        renderDossier(res.dossier);
      });
    };

    // ---- Pet modder modal ----
    const openPetModder = (petUid) => {
      const html = `
        <div class="modal-overlay" id="pet-modder-modal">
          <div class="modal" style="max-width:400px">
            <h3>⚙️ Mod Pet</h3>
            <p class="muted small">UID: ${esc(petUid)}</p>
            <label class="fld"><span>Level (1-9999)</span><input type="number" id="mod-pet-level" placeholder="—" style="width:100%"></label>
            <label class="fld"><span>Species ID</span><input type="text" id="mod-pet-species" placeholder="—" style="width:100%"></label>
            <label class="fld"><span>Hunger (0-100)</span><input type="number" id="mod-pet-hunger" placeholder="—" style="width:100%"></label>
            <label class="fld"><span>XP</span><input type="number" id="mod-pet-xp" placeholder="—" style="width:100%"></label>
            <div class="row" style="margin-top:12px">
              <button class="btn gold" id="mod-pet-save">💾 Apply</button>
              <button class="btn ghost" id="mod-pet-cancel">Cancel</button>
            </div>
          </div>
        </div>`;
      document.body.insertAdjacentHTML('beforeend', html);
      const modal = document.getElementById('pet-modder-modal');
      modal.querySelector('#mod-pet-cancel').addEventListener('click', () => modal.remove());
      modal.querySelector('#mod-pet-save').addEventListener('click', async () => {
        const mods = {};
        const lv = modal.querySelector('#mod-pet-level').value;
        const sp = modal.querySelector('#mod-pet-species').value.trim();
        const hu = modal.querySelector('#mod-pet-hunger').value;
        const xp = modal.querySelector('#mod-pet-xp').value;
        if (lv !== '') mods.level = Number(lv);
        if (sp) mods.species = sp;
        if (hu !== '') mods.hunger = Number(hu);
        if (xp !== '') mods.xp = Number(xp);
        if (Object.keys(mods).length === 0) {
          UI.toast('No changes entered', 'error');
          return;
        }
        const username = needTarget();
        await api.gmModPet(username, petUid, mods);
        UI.toast('Pet modded', 'success');
        modal.remove();
        const res = await api.gmInspect(username);
        renderDossier(res.dossier);
      });
    };

    on('gm-target-dossier', 'click', () => runAction('gm-target-dossier', 'Dossier', async () => {
      const username = needTarget();
      if (!username) return null;
      const res = await api.gmInspect(username);
      renderDossier(res.dossier);
      return `📋 Dossier loaded for ${res.dossier.username}.`;
    }));

    // The client hot-reloads its live game state after a self-targeted
    // command so the change shows up immediately instead of on next login.
    const hotReloadIfSelf = async (username, res) => {
      if (res && res.state && this.me &&
          username.toLowerCase() === String(this.me.username).toLowerCase() &&
          UI.handlers.onExternalState) {
        UI.handlers.onExternalState(res.state);
      }
    };

    // ---- grant kind UI sync ----
    const kindSel = $('gm-grant-kind');
    if (kindSel) {
      const amountLabel = $('gm-grant-amount-label');
      const amountInput = $('gm-grant-amount');
      const syncKindUI = () => {
        const kind = kindSel.value;
        const isGear = kind === 'gear';
        const isOre = kind === 'ore';
        const isPickaxe = kind === 'pickaxe';
        $('gm-grant-amount-wrap').classList.toggle('hidden', isGear || isPickaxe);
        $('gm-grant-set-wrap').classList.toggle('hidden', !isGear);
        $('gm-grant-ore-wrap').classList.toggle('hidden', !isOre);
        $('gm-grant-pickaxe-wrap').classList.toggle('hidden', !isPickaxe);
        if (kind === 'gold') { amountLabel.textContent = 'Amount (1–1000000)'; amountInput.max = '1000000'; }
        else if (kind === 'levels') { amountLabel.textContent = 'Levels (1–100)'; amountInput.max = '100'; }
        else if (kind === 'xp') { amountLabel.textContent = 'XP (1–1000000)'; amountInput.max = '1000000'; }
        else if (kind === 'ore') { amountLabel.textContent = 'Ore (1–1000000000)'; amountInput.max = '1000000000'; }
        else { amountLabel.textContent = 'Amount (1–100000)'; amountInput.max = '100000'; }
      };
      kindSel.addEventListener('change', syncKindUI);
      syncKindUI();
    }

    // ---- currency / gear grant ----
    // No pre-save of the operator's state here: grants merge server-side into
    // the TARGET's row, so saving our own state first only stalls the button
    // on slow connections.
    on('gm-grant-btn', 'click', () => runAction('gm-grant-btn', 'Grant', async () => {
      const username = needTarget();
      if (!username) return null;
      const kind = kindSel.value;
      let res = null;
      let summary = '';
      const num = (id) => Math.floor(Number($(id).value));
      if (kind === 'stars') {
        const amount = num('gm-grant-amount');
        if (!Number.isFinite(amount) || amount < 1 || amount > 100000) throw new Error('Amount must be 1–100000.');
        res = await api.gmGrant(username, 'stars', { amount });
        summary = `Granted ⭐${formatNum(amount)} to ${username}.`;
      } else if (kind === 'gold') {
        const amount = num('gm-grant-amount');
        if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) throw new Error('Amount must be 1–1000000.');
        res = await api.gmGrant(username, 'gold', { amount });
        summary = `Granted 💰${formatNum(amount)} to ${username}.`;
      } else if (kind === 'levels') {
        const amount = num('gm-grant-amount');
        if (!Number.isFinite(amount) || amount < 1 || amount > 100) throw new Error('Levels must be 1–100.');
        res = await api.gmGrant(username, 'levels', { amount });
        summary = `Granted ⬆️${amount} levels to ${username}.`;
      } else if (kind === 'xp') {
        const amount = num('gm-grant-amount');
        if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) throw new Error('XP must be 1–1000000.');
        res = await api.gmGrant(username, 'xp', { amount });
        summary = `Granted ✨${formatNum(amount)} XP to ${username}.`;
      } else if (kind === 'ore') {
        const amount = num('gm-grant-amount');
        if (!Number.isFinite(amount) || amount < 1 || amount > 1000000000) throw new Error('Ore amount must be 1–1000000000.');
        const ore = $('gm-grant-ore').value;
        res = await api.gmGrant(username, 'ore', { ore, amount });
        summary = `Granted ⛏️${formatNum(amount)} ${ore} to ${username}.`;
      } else if (kind === 'pickaxe') {
        const tier = num('gm-grant-pickaxe');
        if (!Number.isFinite(tier) || tier < 0 || tier > 7) throw new Error('Pickaxe tier must be 0–7.');
        res = await api.gmGrant(username, 'pickaxe', { tier });
        summary = `Set ${username}'s pickaxe to tier ${tier}.`;
      } else {
        const set = $('gm-grant-set').value;
        res = await api.gmGrant(username, 'gear', { set });
        summary = `Granted ${PRIVILEGED_SETS[set].name} to ${username}.`;
      }
      await hotReloadIfSelf(username, res);
      return summary;
    }));

    // ---- title / badge (gm) ----
    on('gm-grant-title-btn', 'click', () => runAction('gm-grant-title-btn', 'Grant title', async () => {
      const username = needTarget();
      if (!username) return null;
      const titleId = $('gm-grant-title').value;
      const res = await api.gmGrantTitle(username, titleId);
      const t = TITLES.find(x => x.id === titleId);
      await hotReloadIfSelf(username, res);
      return `👑 Granted title "${t ? t.name : titleId}" to ${username}.`;
    }));

    // ---- grant every title at once (gm) ----
    on('gm-grant-all-titles-btn', 'click', async () => {
      const username = needTarget();
      if (!username) return;
      // Staff titles stay staff-only: the bulk grant skips them (single
      // grant-title can still target one deliberately).
      const grantable = TITLES.filter(t => !t.staffOnly);
      const ok = await UI.confirm('Grant all titles?',
        `<p>Unlock all <b>${grantable.length}</b> titles for <b>${esc(username)}</b>?</p>`);
      if (!ok) return;
      runAction('gm-grant-all-titles-btn', 'Grant all titles', async () => {
        let res = null;
        for (const t of grantable) {
          res = await api.gmGrantTitle(username, t.id);
        }
        await hotReloadIfSelf(username, res);
        return `👑 Granted all ${grantable.length} titles to ${username}.`;
      });
    });

    on('gm-grant-badge-btn', 'click', () => runAction('gm-grant-badge-btn', 'Set badge', async () => {
      const username = needTarget();
      if (!username) return null;
      const badge = $('gm-grant-badge').value;
      const res = await api.gmSetBadge(username, badge);
      const b = BADGES.find(x => x.id === badge);
      await hotReloadIfSelf(username, res);
      return badge ? `${b.emoji} Set badge "${b.name}" on ${username}.` : `Badge cleared for ${username}.`;
    }));

    // ---- pet eggs (gm) ----
    on('gm-grant-pet-btn', 'click', () => runAction('gm-grant-pet-btn', 'Grant pet eggs', async () => {
      const username = needTarget();
      if (!username) return null;
      const amount = Math.floor(Number($('gm-grant-pet-amount').value));
      if (!Number.isFinite(amount) || amount < 1 || amount > 99) throw new Error('Egg amount must be 1–99.');
      const res = await api.gmGrantPet(username, amount);
      await hotReloadIfSelf(username, res);
      return `🐾 Granted ${amount} pet egg${amount === 1 ? '' : 's'} to ${username} (now ${res.eggs}).`;
    }));

    // ---- rebirth count (gm) ----
    on('gm-set-rebirth-btn', 'click', () => runAction('gm-set-rebirth-btn', 'Set rebirths', async () => {
      const username = needTarget();
      if (!username) return null;
      const count = Math.floor(Number($('gm-set-rebirth-count').value));
      if (!Number.isFinite(count) || count < 0 || count > 999) throw new Error('Rebirth count must be 0–999.');
      const res = await api.gmSetRebirth(username, count);
      await hotReloadIfSelf(username, res);
      return `🔄 ${username}'s rebirth count set to ${count}.`;
    }));

    // ---- set level / set gold (gm) ----
    on('gm-set-level-btn', 'click', () => runAction('gm-set-level-btn', 'Set level', async () => {
      const username = needTarget();
      if (!username) return null;
      const level = Math.floor(Number($('gm-set-level').value));
      if (!Number.isFinite(level) || level < 1 || level > 120) throw new Error('Level must be 1–120.');
      const res = await api.gmSetLevel(username, level);
      await hotReloadIfSelf(username, res);
      return `⬆️ ${username} is now level ${level}.`;
    }));

    on('gm-set-gold-btn', 'click', () => runAction('gm-set-gold-btn', 'Set gold', async () => {
      const username = needTarget();
      if (!username) return null;
      const amount = Math.floor(Number($('gm-set-gold').value));
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Gold must be 0 or more.');
      const res = await api.gmSetGold(username, amount);
      await hotReloadIfSelf(username, res);
      return `💰 ${username}'s gold set to ${formatNum(amount)}.`;
    }));

    on('gm-set-xp-btn', 'click', () => runAction('gm-set-xp-btn', 'Set XP', async () => {
      const username = needTarget();
      if (!username) return null;
      const amount = Math.floor(Number($('gm-set-xp').value));
      if (!Number.isFinite(amount) || amount < 0) throw new Error('XP must be 0 or more.');
      const res = await api.gmSetXp(username, amount);
      await hotReloadIfSelf(username, res);
      return `✨ ${username}'s XP set to ${formatNum(amount)}.`;
    }));

    // ---- grant single item / name style ----
    on('gm-grant-item-btn', 'click', () => runAction('gm-grant-item-btn', 'Grant item', async () => {
      const username = needTarget();
      if (!username) return null;
      const set = $('gm-grant-item-set').value;
      const slot = $('gm-grant-item-slot').value;
      const res = await api.gmGrantItem(username, set, slot);
      await hotReloadIfSelf(username, res);
      return `🎁 Granted ${res.item || (set + ' ' + slot)} to ${username}.`;
    }));

    on('gm-grant-class-btn', 'click', () => runAction('gm-grant-class-btn', 'Grant class gear', async () => {
      const username = needTarget();
      if (!username) return null;
      const slot = $('gm-grant-class-slot').value;
      const res = await api.gmGrantClassGear(username, slot);
      await hotReloadIfSelf(username, res);
      return `⚔️ Granted ${res.item || ('class ' + slot)} to ${username}.`;
    }));

    on('gm-grant-forgebox-btn', 'click', () => runAction('gm-grant-forgebox-btn', 'Grant forge box', async () => {
      const username = needTarget();
      if (!username) return null;
      const res = await api.gmGrantForgeBox(username);
      await hotReloadIfSelf(username, res);
      return `🌌 Granted galaxy forge box (25 galaxy + 40 adamant) to ${username}.`;
    }));

    on('gm-name-style-btn', 'click', () => runAction('gm-name-style-btn', 'Set name style', async () => {
      const username = needTarget();
      if (!username) return null;
      const color = $('gm-name-color').value.trim();
      const fx = $('gm-name-fx').value;
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Color must be a hex like #ff8800, or empty to clear.');
      const res = await api.gmNameStyle(username, color, fx);
      await hotReloadIfSelf(username, res);
      return `🎨 ${username}'s name style updated.`;
    }));

    // ---- player section (role-appropriate endpoints) ----
    // GMs use the gm-tier routes; admins use the admin-tier mirrors.
    const stageApi = isGm ? api.gmSetStage : api.gmStage;
    const resetApi = isGm ? api.gmReset : api.gmResetPlayer;

    on('gm-player-stage-btn', 'click', () => runAction('gm-player-stage-btn', 'Set stage', async () => {
      const username = needTarget();
      if (!username) return null;
      const stage = Math.floor(Number($('gm-player-stage').value));
      if (!Number.isFinite(stage) || stage < 1 || stage > 10000) throw new Error('Stage must be 1–10000.');
      const res = await stageApi(username, stage);
      await hotReloadIfSelf(username, res);
      return `🗺️ ${username} moved to stage ${stage}.`;
    }));

    on('gm-player-title-btn', 'click', () => runAction('gm-player-title-btn', 'Grant title', async () => {
      const username = needTarget();
      if (!username) return null;
      const title = $('gm-player-title').value;
      const res = await api.gmTitle(username, title);
      const t = TITLES.find(x => x.id === title);
      await hotReloadIfSelf(username, res);
      return `👑 Granted title "${t ? t.name : title}" to ${username}.`;
    }));

    on('gm-player-heal-btn', 'click', () => runAction('gm-player-heal-btn', 'Heal', async () => {
      const username = needTarget();
      if (!username) return null;
      const res = await api.gmHeal(username);
      await hotReloadIfSelf(username, res);
      return `💚 ${username} healed.`;
    }));

    const confirmDestructive = (title, html, confirmLabel) =>
      UI.confirm(title, html, confirmLabel);

    on('gm-player-ban-btn', 'click', async () => {
      const username = needTarget();
      if (!username) return;
      const ok = await confirmDestructive('🔨 Ban player?',
        `<p>Ban <b>${esc(username)}</b> from logging in?</p><p class="muted">They stay banned until unbanned.</p>`, 'Ban');
      if (!ok) return;
      runAction('gm-player-ban-btn', 'Ban', async () => {
        await api.gmBan(username);
        return `🔨 ${username} banned.`;
      });
    });

    on('gm-player-unban-btn', 'click', () => runAction('gm-player-unban-btn', 'Unban', async () => {
      const username = needTarget();
      if (!username) return null;
      await api.gmUnban(username);
      return `🔓 ${username} unbanned.`;
    }));

    on('gm-player-kick-btn', 'click', async () => {
      const username = needTarget();
      if (!username) return;
      const ok = await confirmDestructive('👢 Kick player?',
        `<p>Force <b>${esc(username)}</b> to sign in again right now?</p><p class="muted">Unlike a ban, they can log straight back in.</p>`, 'Kick');
      if (!ok) return;
      runAction('gm-player-kick-btn', 'Kick', async () => {
        await api.gmKick(username);
        return `👢 ${username} kicked.`;
      });
    });

    on('gm-player-mute-btn', 'click', () => runAction('gm-player-mute-btn', 'Mute', async () => {
      const username = needTarget();
      if (!username) return null;
      const minutes = Math.floor(Number($('gm-player-mute-mins').value));
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080) throw new Error('Minutes must be 1–10080.');
      const res = await api.gmMute(username, minutes);
      return `🔇 ${username} muted from guild chat for ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }));

    on('gm-player-unmute-btn', 'click', () => runAction('gm-player-unmute-btn', 'Unmute', async () => {
      const username = needTarget();
      if (!username) return null;
      await api.gmMute(username, 0);
      return `🔈 ${username} unmuted.`;
    }));

    // ---- clear the target's guild chat history (owner/admin/gm) ----
    on('gm-clear-chat-btn', 'click', async () => {
      const username = needTarget();
      if (!username) return;
      const ok = await confirmDestructive('🧹 Clear guild chat?',
        `<p>Wipe the <b>entire message history</b> of <b>${esc(username)}</b>'s guild?</p><p class="muted">The guild itself is untouched. This cannot be undone.</p>`, 'Wipe it');
      if (!ok) return;
      runAction('gm-clear-chat-btn', 'Clear guild chat', async () => {
        const res = await api.gmClearGuildChat(username);
        return `🧹 Cleared ${res.removed} chat message${res.removed === 1 ? '' : 's'} from ${username}'s guild.`;
      });
    });

    on('gm-player-reset-btn', 'click', async () => {
      const username = needTarget();
      if (!username) return;
      const ok = await confirmDestructive('♻️ Reset player?',
        `<p>Wipe <b>${esc(username)}</b>'s progress back to a fresh hero?</p><p class="muted">Keeps their account and role. This cannot be undone.</p>`, 'Reset player');
      if (!ok) return;
      runAction('gm-player-reset-btn', 'Reset player', async () => {
        const res = await resetApi(username);
        await hotReloadIfSelf(username, res);
        return `♻️ ${username}'s progress was reset.`;
      });
    });

    on('gm-player-delete-btn', 'click', async () => {
      const username = needTarget();
      if (!username) return;
      const ok = await confirmDestructive('🗑️ Delete account?',
        `<p>Permanently delete <b>${esc(username)}</b>'s account and all of their data?</p><p class="muted">They vanish from the leaderboard, guilds, and parties. This cannot be undone.</p>`, 'Delete account');
      if (!ok) return;
      runAction('gm-player-delete-btn', 'Delete account', async () => {
        await api.gmDeleteAccount(username);
        return `🗑️ ${username}'s account was deleted.`;
      });
    });

    // ---- gift codes ----
    const codeKindSel = $('gm-code-kind');
    if (codeKindSel) {
      const syncCodeUI = () => {
        const kind = codeKindSel.value;
        const isGear = kind === 'gear';
        $('gm-code-set-wrap').classList.toggle('hidden', !isGear);
        $('gm-code-amount-wrap').classList.toggle('hidden', isGear);
        if (!isGear) {
          $('gm-code-amount-label').textContent = kind === 'gold' ? 'Gold amount (1–1T)' : 'Star amount (1–100000)';
        }
      };
      codeKindSel.addEventListener('change', syncCodeUI);
      syncCodeUI();
    }

    on('gm-code-create', 'click', () => runAction('gm-code-create', 'Create code', async () => {
      const maxUses = Math.floor(Number($('gm-code-uses').value)) || 1;
      const rewardKind = codeKindSel.value;
      const opts = { maxUses };
      if (rewardKind === 'gear') {
        opts.set = $('gm-code-set').value;
      } else {
        const amount = Math.floor(Number($('gm-code-amount').value));
        if (!Number.isFinite(amount) || amount < 1) throw new Error('Enter a reward amount of at least 1.');
        opts.amount = amount;
      }
      const { code, rewardKind: kind, rewardAmount, set } = await api.gmCreateCode(rewardKind, opts);
      const box = $('gm-new-code');
      box.classList.remove('hidden');
      box.innerHTML = `<span class="muted small">New code (${esc(describeReward(kind, rewardAmount, set))}, ${maxUses} uses):</span>
                       <div class="code-big">${esc(code)}</div>`;
      this.refreshCodes(root);
      return `Gift code ${code} created.`;
    }));

    // ---- moderation (owner/admin/gm/moderator) ----
    on('gm-bc-send', 'click', async () => {
      const message = $('gm-bc-msg').value.trim();
      if (!message) { UI.toast('Enter a broadcast message.', 'error'); return; }
      const ok = await confirmDestructive('📣 Send broadcast?',
        `<p>Send to <b>all players</b>:</p><p>"${esc(message)}"</p>`, 'Send');
      if (!ok) return;
      runAction('gm-bc-send', 'Broadcast', async () => {
        await api.gmBroadcast(message);
        $('gm-bc-msg').value = '';
        return '📣 Broadcast sent.';
      });
    });

    const loadPlayers = async () => {
      const search = $('gm-pl-search').value.trim();
      const list = $('gm-player-list');
      list.innerHTML = '<p class="muted small">Loading…</p>';
      try {
        const { players = [] } = await api.gmPlayers(search, 50);
        if (!players.length) { list.innerHTML = '<p class="muted small">No players found.</p>'; return; }
        list.innerHTML = players.map(p => `
          <div class="name-row" data-username="${esc(p.username)}" title="Set as target"><span>${(CLASSES[p.playerClass] || {}).emoji || ''}${(SPECS[p.spec] || {}).emoji || ''} ${esc(p.username)}</span>
            <span class="muted small">${esc(p.role)} · Lv ${p.level} · stage ${p.stage}</span></div>`).join('');
      } catch (e) {
        list.innerHTML = `<p class="error small">Couldn't load players.</p>`;
      }
    };
    on('gm-pl-search-btn', 'click', loadPlayers);
    if ($('gm-player-list')) loadPlayers();
    // Clicking a player row picks them as the target for every action below.
    // Guarded so re-renders never stack duplicate listeners.
    const plList = $('gm-player-list');
    if (plList && !plList.dataset.pickBound) {
      plList.dataset.pickBound = '1';
      plList.addEventListener('click', (e) => {
        const row = e.target && e.target.closest ? e.target.closest('.name-row[data-username]') : null;
        if (!row) return;
        const t = $('gm-target-user');
        if (t) t.value = row.dataset.username;
        UI.toast(`Target: ${row.dataset.username}`, 'info');
      });
    }

    // ---- staff ----
    on('gm-admin-add', 'click', () => runAction('gm-admin-add', 'Add admin', async () => {
      const username = needTarget();
      if (!username) return null;
      await api.gmRosterUpdate(username, 'add-admin');
      this.refreshRoster(root);
      return `${username} added as admin.`;
    }));

    on('gm-role-set', 'click', async () => {
      const username = needTarget();
      if (!username) return;
      const role = $('gm-role-select').value;
      const ok = await confirmDestructive('Set role',
        `Set <b>${esc(username)}</b> to <b>${esc(role)}</b>?`, 'Set role');
      if (!ok) return;
      runAction('gm-role-set', 'Set role', async () => {
        await api.setRole(username, role);
        this.refreshRoster(root);
        return `${username} is now ${role}.`;
      });
    });

    // ---- server (owner only) ----
    const refreshMaintStatus = async () => {
      const el = $('gm-maint-status');
      if (!el) return;
      try {
        const s = await api.status();
        el.textContent = s.maintenance ? `ON${s.message ? ' — ' + s.message : ''}` : 'OFF';
      } catch {
        el.textContent = 'unknown';
      }
    };
    refreshMaintStatus();

    const setMaintenance = async (enabled) => {
      const message = $('gm-maint-msg').value.trim();
      const ok = await confirmDestructive(enabled ? '🛠️ Enable maintenance?' : 'Turn off maintenance?',
        enabled
          ? `<p>Put the game into maintenance mode? Players will see a maintenance screen${message ? `: "${esc(message)}"` : '.'}</p>`
          : '<p>Take the game out of maintenance mode?</p>',
        enabled ? 'Turn ON' : 'Turn OFF');
      if (!ok) return;
      runAction(enabled ? 'gm-maint-on' : 'gm-maint-off', 'Maintenance', async () => {
        await api.gmMaintenance(enabled, message);
        if (enabled) $('gm-maint-msg').value = '';
        refreshMaintStatus();
        return enabled ? '🛠️ Maintenance mode ON.' : 'Maintenance mode OFF.';
      });
    };
    on('gm-maint-on', 'click', () => setMaintenance(true));
    on('gm-maint-off', 'click', () => setMaintenance(false));

    // ♾️ Infinite gold toggle (owner only). Hot-reloads the operator's own
    // game state so the ∞ HUD appears immediately on a self-grant.
    const infGoldToggle = async (enabled) => {
      const username = needTarget();
      if (!username) return;
      const ok = await confirmDestructive(enabled ? 'Enable infinite gold' : 'Disable infinite gold',
        enabled
          ? `Give <b>${esc(username)}</b> infinite gold? Purchases will never deduct gold.`
          : `Take infinite gold away from <b>${esc(username)}</b>?`,
        enabled ? 'Enable ∞' : 'Disable');
      if (!ok) return;
      runAction(enabled ? 'gm-infgold-on' : 'gm-infgold-off', 'Infinite gold', async () => {
        const res = await api.gmInfGold(username, enabled);
        await hotReloadIfSelf(username, res);
        return enabled ? `♾️ ${username} now has infinite gold.` : `Infinite gold removed from ${username}.`;
      });
    };
    on('gm-infgold-on', 'click', () => infGoldToggle(true));
    on('gm-infgold-off', 'click', () => infGoldToggle(false));

    // ⚙️ Server settings: gold cap (owner only). Card only renders for owner.
    if ($('gm-goldcap')) {
      const capText = (cap) => `${formatNum(cap)} (${Math.round(cap / 1e12)}T)`;
      api.getSettings().then(sj => {
        if (sj && Number.isFinite(sj.goldCap)) {
          $('gm-goldcap-current').textContent = capText(sj.goldCap);
          $('gm-goldcap').placeholder = String(Math.round(sj.goldCap / 1e12));
        }
      }).catch(() => { /* leave the "…" placeholder */ });
      on('gm-goldcap-save', 'click', () => runAction('gm-goldcap-save', 'Gold cap', async () => {
        const t = Number($('gm-goldcap').value);
        if (!Number.isFinite(t) || t < 1000) throw new Error('Enter a cap in trillions (min 1000T).');
        const res = await api.gmSetSettings(t * 1e12);
        $('gm-goldcap').value = '';
        if (res && Number.isFinite(res.goldCap)) {
          $('gm-goldcap-current').textContent = capText(res.goldCap);
          $('gm-goldcap').placeholder = String(Math.round(res.goldCap / 1e12));
        }
        return `⚙️ Gold cap set to ${t}T.`;
      }));
    }



    // ---- target inventory: browse, set enchant, remove items ----
    const renderInventory = (items) => {
      const list = $('gm-inv-list');
      const count = $('gm-inv-count');
      if (count) count.textContent = items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : '';
      if (!items.length) { list.innerHTML = '<p class="muted small">Inventory is empty.</p>'; return; }
      list.innerHTML = items.map(it => `
        <div class="name-row" data-index="${it.index}">
          <span>${esc(it.name)} <span class="muted small">[${esc(it.slot)}]${it.enchant ? ' +' + it.enchant : ''}</span></span>
          <span class="row" style="gap:0.3rem">
            <input type="number" min="0" max="10" value="${it.enchant}" data-ench-input style="width:3.2rem" title="Enchant 0–10">
            <button class="btn small ghost" data-ench-set>✨</button>
            <button class="btn small ghost danger" data-item-remove title="Remove item">✖</button>
          </span>
        </div>`).join('');
    };
    const loadInventory = async () => {
      const username = needTarget();
      if (!username) return;
      const list = $('gm-inv-list');
      list.innerHTML = '<p class="muted small">Loading…</p>';
      try {
        const { items = [] } = await api.gmInventory(username);
        renderInventory(items);
      } catch (e) {
        list.innerHTML = `<p class="error small">${esc(e.message || 'Load failed.')}</p>`;
      }
    };
    on('gm-inv-load', 'click', loadInventory);
    const invList = $('gm-inv-list');
    if (invList && !invList.dataset.invBound) {
      invList.dataset.invBound = '1';
      invList.addEventListener('click', async (e) => {
        const row = e.target && e.target.closest ? e.target.closest('.name-row[data-index]') : null;
        if (!row) return;
        const index = Number(row.dataset.index);
        const username = needTarget();
        if (!username) return;
        if (e.target.closest('[data-ench-set]')) {
          const lv = Math.floor(Number(row.querySelector('[data-ench-input]').value));
          if (!Number.isInteger(lv) || lv < 0 || lv > 10) { UI.toast('Enchant must be 0–10.', 'error'); return; }
          runAction(null, 'Set enchant', async () => {
            const res = await api.gmSetEnchant(username, { index }, lv);
            await loadInventory();
            return `✨ ${res.item} → +${lv}.`;
          });
        } else if (e.target.closest('[data-item-remove]')) {
          const name = row.querySelector('span').textContent.trim();
          const ok = await confirmDestructive('Remove item?',
            `<p>Remove <b>${esc(name)}</b> from <b>${esc(username)}</b>'s inventory?</p><p class="muted">This cannot be undone.</p>`, 'Remove');
          if (!ok) return;
          runAction(null, 'Remove item', async () => {
            const res = await api.gmRemoveItem(username, index);
            await loadInventory();
            return `🗑️ Removed ${res.removed} from ${username}.`;
          });
        }
      });
    }
    on('gm-enchant-btn', 'click', () => runAction('gm-enchant-btn', 'Set enchant', async () => {
      const username = needTarget();
      if (!username) return null;
      const slot = $('gm-enchant-slot').value;
      const lv = Math.floor(Number($('gm-enchant-level').value));
      if (!Number.isInteger(lv) || lv < 0 || lv > 10) throw new Error('Enchant must be 0–10.');
      const res = await api.gmSetEnchant(username, { slot }, lv);
      return `✨ ${username}'s equipped ${slot} (${res.item}) → +${lv}.`;
    }));

    // ---- enchant every equipped piece to +10 (skips empty slots) ----
    on('gm-enchant-all-btn', 'click', () => runAction('gm-enchant-all-btn', 'Enchant all', async () => {
      const username = needTarget();
      if (!username) return null;
      const slots = ['weapon', 'armor', 'helmet', 'boots', 'trinket'];
      const done = [];
      let res = null;
      for (const slot of slots) {
        try {
          res = await api.gmSetEnchant(username, { slot }, 10);
          done.push(slot);
        } catch (e) {
          // Empty slot — leave it alone and keep going.
        }
      }
      await hotReloadIfSelf(username, res);
      if (!done.length) throw new Error(`${username} has nothing equipped.`);
      return `✨ ${username}'s equipped gear → +10 (${done.join(', ')}).`;
    }));

    // ---- quest re-roll ----
    on('gm-quest-reset-btn', 'click', () => runAction('gm-quest-reset-btn', 'Re-roll quests', async () => {
      const username = needTarget();
      if (!username) return null;
      const period = $('gm-quest-period').value;
      await api.gmResetQuests(username, period);
      return `🔁 ${username}'s ${period} quests re-rolled.`;
    }));

    // ---- server event buff ----
    const refreshEventBuff = async () => {
      const el = $('gm-ev-current');
      if (!el) return;
      try {
        const sj = await api.getSettings();
        const b = sj && sj.eventBuff;
        el.textContent = b
          ? `Active: ${b.label} — ${b.xpMult}x XP / ${b.goldMult}x gold until ${new Date(b.endsAt).toLocaleString()}`
          : 'No event running.';
      } catch { el.textContent = 'unknown'; }
    };
    refreshEventBuff();
    on('gm-ev-start', 'click', () => runAction('gm-ev-start', 'Event buff', async () => {
      const xpMult = Number($('gm-ev-xp').value);
      const goldMult = Number($('gm-ev-gold').value);
      const hours = Number($('gm-ev-hours').value);
      const label = $('gm-ev-label').value.trim() || 'Event';
      if (!(xpMult >= 1 && xpMult <= 10) || !(goldMult >= 1 && goldMult <= 10)) throw new Error('Multipliers must be 1–10.');
      if (!(hours >= 1 && hours <= 168)) throw new Error('Hours must be 1–168 (use End event to clear).');
      await api.gmEventBuff({ xpMult, goldMult, hours, label });
      refreshEventBuff();
      return `🎉 ${label}: ${xpMult}x XP / ${goldMult}x gold for ${hours}h.`;
    }));
    on('gm-ev-clear', 'click', () => runAction('gm-ev-clear', 'End event', async () => {
      await api.gmEventBuff({ xpMult: 1, goldMult: 1, hours: 0 });
      refreshEventBuff();
      return '🛑 Event buff cleared.';
    }));
  },

  async render() {
    const root = document.getElementById('gm-content');
    if (!root) return; // console view absent (e.g. partial HTML): fail gracefully
    root.innerHTML = '<p class="muted">Loading console…</p>';
    // /gm/overview is gm|owner only; admins/moderators get a slim header.
    let ov;
    try {
      ov = await api.gmOverview();
    } catch (e) {
      ov = { role: this.me.role, playerCount: null, codeCount: null };
    }
    try {
      root.innerHTML = this.template(ov);
      this.bind(root);
      if (canGm(this.me.role)) {
        await Promise.all([this.refreshCodes(root), this.refreshRoster(root)]);
      }
    } catch (e) {
      root.innerHTML = `<p class="error">Couldn't load GM console: ${esc(e.message)}</p>`;
    }
  },

  template(ov) {
    const role = this.me.role;
    const isOwner = role === 'owner';
    const gm = canGm(role);
    const admin = canAdmin(role);
    const mod = canMod(role);
    const canTarget = gm || admin; // roles that act on a specific player
    const num = (v) => (v == null ? '—' : formatNum(v));
    const setOptions = SET_IDS.map(id => {
      const locked = id === 'sovereign' && !isOwner;
      return `<option value="${id}" ${locked ? 'disabled' : ''}>${esc(PRIVILEGED_SETS[id].name)}${locked ? ' (owner only)' : ''}</option>`;
    }).join('');
    const titleOptions = TITLES.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    const badgeOptions = `<option value="">— none —</option>` + BADGES.map(b => `<option value="${b.id}">${b.emoji} ${esc(b.name)}</option>`).join('');
    return `
      <div class="gm-cards">
        <div class="gm-card"><div class="gm-num">${num(ov.playerCount)}</div><div class="muted small">players</div></div>
        <div class="gm-card"><div class="gm-num">${num(ov.codeCount)}</div><div class="muted small">gift codes</div></div>
        <div class="gm-card"><div class="gm-num">${esc(ov.role)}</div><div class="muted small">your role</div></div>
      </div>

      ${isOwner ? `
      <div class="card gm-command-center" id="gm-command-center">
        <div class="gm-cc-head">
          <h3>👑 Command Center</h3>
          <span class="gm-cc-time" id="gm-cc-time">—</span>
        </div>

        <div class="gm-cc-tabs">
          <button class="gm-cc-tab active" data-cc="roster">👥 Roster</button>
          <button class="gm-cc-tab" data-cc="live">👁️ Live View</button>
          <button class="gm-cc-tab" data-cc="opgear">⚔️ OP Gear</button>
        </div>

        <div class="gm-cc-pane" id="gm-cc-roster">
          <div class="muted small" style="margin-bottom:8px">Players online now and recent activity.</div>
          <div id="gm-roster-list"><p class="muted">Loading…</p></div>
        </div>

        <div class="gm-cc-pane hidden" id="gm-cc-live">
          <div class="muted small" style="margin-bottom:8px">What players are doing right now (updates every 15s).</div>
          <div id="gm-live-list"><p class="muted">Loading…</p></div>
        </div>

        <div class="gm-cc-pane hidden" id="gm-cc-opgear">
          <div class="muted small" style="margin-bottom:8px">Forge overpowered gear for admins. No stat limits.</div>
          <div class="gm-opgear-form">
            <div class="row">
              <label class="fld" style="flex:2"><span>Target admin</span><input id="opgear-user" placeholder="username" autocomplete="off"></label>
              <label class="fld" style="flex:2"><span>Item name</span><input id="opgear-name" placeholder="Godslayer Blade" maxlength="60"></label>
            </div>
            <div class="row">
              <label class="fld"><span>Slot</span><select id="opgear-slot">
                <option value="weapon">⚔️ Weapon</option><option value="armor">🛡️ Armor</option>
                <option value="helmet">🪖 Helmet</option><option value="boots">🥾 Boots</option>
                <option value="trinket">📿 Trinket</option></select></label>
              <label class="fld"><span>Rarity</span><select id="opgear-rarity">
                <option value="mythic">Mythic</option><option value="legendary">Legendary</option>
                <option value="epic">Epic</option><option value="celestial">Celestial</option>
                <option value="shadow">Shadow</option></select></label>
            </div>
            <div class="row">
              <label class="fld"><span>⚔️ Attack</span><input id="opgear-atk" type="number" placeholder="0"></label>
              <label class="fld"><span>❤️ Max HP</span><input id="opgear-hp" type="number" placeholder="0"></label>
              <label class="fld"><span>🛡️ Defense</span><input id="opgear-def" type="number" placeholder="0"></label>
            </div>
            <div class="row">
              <label class="fld"><span>💥 Crit %</span><input id="opgear-crit" type="number" placeholder="0"></label>
              <label class="fld"><span>🩸 Lifesteal %</span><input id="opgear-ls" type="number" placeholder="0"></label>
              <label class="fld"><span>⚡ Atk Speed</span><input id="opgear-spd" type="number" step="any" placeholder="0"></label>
            </div>
            <button id="opgear-forge" class="btn small gold" style="width:100%;margin-top:8px">🔨 Forge & Grant OP Gear</button>
            <div id="opgear-result" class="muted small" style="margin-top:6px"></div>
          </div>
        </div>
      </div>
      ` : ``}

      <div class="card" style="margin-bottom:12px">
        <button id="gm-idref-toggle" class="btn small" style="width:100%">📋 ID Reference (pets, items, titles, quests)</button>
        <div id="gm-idref-panel" class="hidden" style="margin-top:8px"></div>
      </div>

      <div class="card" style="margin-bottom:12px">
        <h4 style="margin:0 0 8px">⚡ Event Multipliers</h4>
        <button id="gm-toggle-2x" class="btn small" style="width:100%">⚡ TOGGLE 2X EVENT</button>
        <div class="muted small" style="margin-top:4px">Toggles 2x XP and 2x Gold for your session.</div>
      </div>

      ${canTarget ? `
      <div class="card gm-target" style="position:sticky;top:0;z-index:5">
        <div class="row" style="align-items:flex-end">
          <label class="fld" style="flex:1"><span>🎯 Target player</span>
            <input id="gm-target-user" placeholder="player name" autocomplete="off"></label>
          <button id="gm-target-lookup" class="btn small" title="Look up this player">🔍</button>
          <button id="gm-target-dossier" class="btn small" title="View this player's full dossier">📋</button>
          <button id="gm-target-clear" class="btn small ghost">Clear</button>
        </div>
        <p class="muted small" id="gm-target-info" style="margin:0.25rem 0 0">Every action below applies to this player. It stays filled until you clear it.</p>
        <div id="gm-dossier" class="gm-dossier hidden"></div>
        <div class="gm-jump">
        ${gm ? '<button class="btn small ghost" data-goto="gm-sec-audit">📜 Audit</button>' : ''}
        ${gm ? '<button class="btn small ghost" data-goto="gm-sec-event">🎉 Event</button>' : ''}
        ${gm ? '<button class="btn small ghost" data-goto="gm-sec-grants">🎁 Grants</button>' : ''}
        ${gm ? '<button class="btn small ghost" data-goto="gm-sec-inventory">🎒 Inventory</button>' : ''}
        ${gm ? '<button class="btn small ghost" data-goto="gm-sec-values">🎚️ Values</button>' : ''}
        ${'<button class="btn small ghost" data-goto="gm-sec-player">🛠️ Player</button>'}
        ${gm ? '<button class="btn small ghost" data-goto="gm-sec-codes">🎟️ Codes</button>' : ''}
        ${(mod || gm) ? '<button class="btn small ghost" data-goto="gm-sec-mod">📣 Mod</button>' : ''}
        ${gm ? '<button class="btn small ghost" data-goto="gm-sec-staff">👥 Staff</button>' : ''}
        ${isOwner ? '<button class="btn small ghost" data-goto="gm-sec-server">⚙️ Server</button>' : ''}
        </div>
      </div>

      <div class="card"><h3>🧾 Action log</h3>
        <div id="gm-log" class="gm-log"><p class="muted small" id="gm-log-empty">Nothing yet — every console action lands here with its exact result.</p></div>
      </div>
      ` : ''}

      ${gm ? `
      <div class="card" id="gm-sec-audit"><h3>📜 Staff audit log</h3>
        <p class="muted small">Server-side record of every staff action — survives restarts, so you can see what other GMs did.</p>
        <div class="row">
          <button id="gm-audit-refresh" class="btn small">🔄 Refresh</button>
        </div>
        <div id="gm-audit-list" class="gm-log"><p class="muted small">Tap Refresh to load.</p></div>
      </div>
      ` : ''}

      ${gm ? `
      <div class="card" id="gm-sec-event"><h3>🎉 Server event buff</h3>
        <p class="muted small">Server-wide XP/gold multiplier — e.g. a double-XP weekend. Players see it when they log in.</p>
        <div class="row">
          <label class="fld"><span>Label</span>
            <input id="gm-ev-label" placeholder="Double XP Weekend" maxlength="60" autocomplete="off"></label>
          <label class="fld"><span>XP × (1–10)</span>
            <input id="gm-ev-xp" type="number" min="1" max="10" step="0.5" value="2"></label>
          <label class="fld"><span>Gold × (1–10)</span>
            <input id="gm-ev-gold" type="number" min="1" max="10" step="0.5" value="2"></label>
          <label class="fld"><span>Hours (0 = clear)</span>
            <input id="gm-ev-hours" type="number" min="0" max="168" value="48"></label>
        </div>
        <div class="row" style="margin-top:0.6rem">
          <button id="gm-ev-start" class="btn small gold">🚀 Start event</button>
          <button id="gm-ev-clear" class="btn small">🛑 End event</button>
          <span class="muted small" id="gm-ev-current"></span>
        </div>
      </div>

      ${gm ? `
      <div class="card" id="gm-sec-grants"><h3>🎁 Grants</h3>
        <h4 class="gm-sub">Currency &amp; gear</h4>
        <div class="row">
          <label class="fld"><span>Kind</span>
            <select id="gm-grant-kind">
              <option value="stars">⭐ Stars</option>
              <option value="gold">💰 Gold</option>
              <option value="levels">⬆️ Levels</option>
              <option value="xp">✨ XP</option>
              <option value="gear">👑 Gear set</option>
              <option value="ore">⛏️ Ore</option>
              <option value="pickaxe">🪓 Pickaxe tier</option>
            </select></label>
          <label class="fld" id="gm-grant-amount-wrap"><span id="gm-grant-amount-label">Amount (1–100000)</span>
            <input id="gm-grant-amount" type="number" min="1" max="1000000" value="100"></label>
          <label class="fld hidden" id="gm-grant-set-wrap"><span>Gear set</span>
            <select id="gm-grant-set">${setOptions}</select></label>
          <label class="fld hidden" id="gm-grant-ore-wrap"><span>Ore type</span>
            <select id="gm-grant-ore">
              <option value="copper">🟤 Copper</option>
              <option value="iron">⚙️ Iron</option>
              <option value="silver">⚪ Silver</option>
              <option value="gold">🟡 Gold Ore</option>
              <option value="mithril">🔷 Mithril</option>
              <option value="adamant">🟣 Adamant</option>
              <option value="galaxy">🌌 Galaxy Shard</option>
              <option value="supergalaxy">💜 Super Galaxy Core</option>
            </select></label>
          <label class="fld hidden" id="gm-grant-pickaxe-wrap"><span>Pickaxe tier</span>
            <select id="gm-grant-pickaxe">
              <option value="0">🪵 0 — Cracked Stick</option>
              <option value="1">⛏️ 1 — Copper Pick</option>
              <option value="2">⛏️ 2 — Iron Pick</option>
              <option value="3">⛏️ 3 — Steel Pick</option>
              <option value="4">⛏️ 4 — Mithril Pick</option>
              <option value="5">⛏️ 5 — Adamant Pick</option>
              <option value="6">🌌 6 — Galaxy Pick</option>
              <option value="7">💜 7 — Super Galaxy Pick</option>
            </select></label>
        </div>
        <button id="gm-grant-btn" class="btn gold wide">Grant</button>
        <p class="muted small">Gear grants add the full 5-piece set to the player's inventory. Sovereign set is owner-only.</p>
        <h4 class="gm-sub">Titles, badges &amp; pets</h4>
        <div class="row">
          <label class="fld"><span>Title</span><select id="gm-grant-title">${titleOptions}</select></label>
          <button id="gm-grant-title-btn" class="btn small" style="align-self:flex-end">👑 Grant title</button>
        </div>
        <div class="row">
          <span class="muted small" style="align-self:center">…or unlock the whole collection at once:</span>
          <button id="gm-grant-all-titles-btn" class="btn small" style="align-self:flex-end">👑 Grant all titles</button>
        </div>
        <div class="row">
          <label class="fld"><span>Creator badge</span><select id="gm-grant-badge">${badgeOptions}</select></label>
          <button id="gm-grant-badge-btn" class="btn small" style="align-self:flex-end">▶️ Set badge</button>
        </div>
        <div class="row">
          <label class="fld"><span>Pet eggs (1–99)</span>
            <input id="gm-grant-pet-amount" type="number" min="1" max="99" value="1"></label>
          <button id="gm-grant-pet-btn" class="btn small" style="align-self:flex-end">🐾 Grant eggs</button>
        </div>
        <div class="row">
          <label class="fld"><span>Single item — set</span><select id="gm-grant-item-set">${setOptions}</select></label>
          <label class="fld"><span>Piece</span>
            <select id="gm-grant-item-slot">
              <option value="weapon">🗡️ Weapon</option>
              <option value="armor">🛡️ Armor</option>
              <option value="helmet">🪖 Helmet</option>
              <option value="boots">🥾 Boots</option>
              <option value="trinket">📿 Trinket</option>
            </select></label>
          <button id="gm-grant-item-btn" class="btn small" style="align-self:flex-end">🎁 Grant item</button>
        </div>
        <div class="row">
          <label class="fld"><span>Class gear — piece</span>
            <select id="gm-grant-class-slot">
              <option value="weapon">🗡️ Weapon</option>
              <option value="armor">🛡️ Armor</option>
            </select></label>
          <button id="gm-grant-class-btn" class="btn small" style="align-self:flex-end">⚔️ Grant class gear</button>
        </div>
        <div class="row">
          <span class="muted small" style="align-self:center">🌌 Forge box: 25 galaxy shards + 40 adamant</span>
          <button id="gm-grant-forgebox-btn" class="btn small" style="align-self:flex-end">🌌 Grant forge box</button>
        </div>
        <h4 class="gm-sub">Name style</h4>
        <div class="row">
          <label class="fld"><span>Color (hex, empty = clear)</span>
            <input id="gm-name-color" placeholder="#ff8800" maxlength="7" autocomplete="off"></label>
          <label class="fld"><span>Effect</span>
            <select id="gm-name-fx">
              <option value="none">None</option>
              <option value="fire">🔥 Fire</option>
              <option value="neon">💡 Neon</option>
              <option value="rainbow">🌈 Rainbow</option>
              <option value="shine">✨ Shine</option>
              <option value="galaxy">🌌 Galaxy</option>
              <option value="ice">🧊 Ice</option>
              <option value="lightning">⚡ Lightning</option>
              <option value="shadow">🌑 Shadow</option>
              <option value="glitch">👾 Glitch</option>
            </select></label>
          <button id="gm-name-style-btn" class="btn small" style="align-self:flex-end">🎨 Set style</button>
        </div>
      </div>
      ` : ''}

      ${gm ? `
      <div class="card" id="gm-sec-inventory"><h3>🎒 Target inventory</h3>
        <p class="muted small">Browse the target's full inventory, set enchant levels, or remove items.</p>
        <div class="row">
          <button id="gm-inv-load" class="btn small">🔄 Load inventory</button>
          <span class="muted small" id="gm-inv-count"></span>
        </div>
        <div id="gm-inv-list" class="name-list"></div>
        <h4 class="gm-sub">Set enchant (equipped item)</h4>
        <div class="row">
          <label class="fld"><span>Equipped slot</span>
            <select id="gm-enchant-slot">
              <option value="weapon">⚔️ Weapon</option>
              <option value="armor">🛡️ Armor</option>
              <option value="helmet">🪖 Helmet</option>
              <option value="boots">🥾 Boots</option>
              <option value="trinket">📿 Trinket</option>
            </select></label>
          <label class="fld"><span>Enchant level (0–10)</span>
            <input id="gm-enchant-level" type="number" min="0" max="10" value="10"></label>
          <button id="gm-enchant-btn" class="btn small" style="align-self:flex-end">✨ Set enchant</button>
          <button id="gm-enchant-all-btn" class="btn small" style="align-self:flex-end">✨ Enchant all +10</button>
        </div>
      </div>
      ` : ''}

      ${gm ? `
      <div class="card" id="gm-sec-values"><h3>🎚️ Set values</h3>
        <p class="muted small">Set a value directly on the target player (not added — replaced).</p>
        <div class="row">
          <label class="fld"><span>Level (1–120)</span>
            <input id="gm-set-level" type="number" min="1" max="120" value="1"></label>
          <button id="gm-set-level-btn" class="btn small" style="align-self:flex-end">⬆️ Set level</button>
          <label class="fld"><span>Gold (exact)</span>
            <input id="gm-set-gold" type="number" min="0" step="1" value="0"></label>
          <button id="gm-set-gold-btn" class="btn small" style="align-self:flex-end">💰 Set gold</button>
        </div>
        <div class="row" style="margin-top:0.6rem">
          <label class="fld"><span>Rebirth count (0–999)</span>
            <input id="gm-set-rebirth-count" type="number" min="0" max="999" value="0"></label>
          <button id="gm-set-rebirth-btn" class="btn small" style="align-self:flex-end">🔄 Set rebirths</button>
          <label class="fld"><span>XP (exact)</span>
            <input id="gm-set-xp" type="number" min="0" step="1" value="0"></label>
          <button id="gm-set-xp-btn" class="btn small" style="align-self:flex-end">✨ Set XP</button>
        </div>
        <p class="muted small">Set level rebuilds the hero's base stats for that level and heals to full. Set gold to 0 to clear it.</p>
      </div>
      ` : ''}

      ${(gm || admin) ? `
      <div class="card" id="gm-sec-player"><h3>🛠️ Player</h3>
        <div class="row">
          <label class="fld"><span>Set stage (1–10000)</span>
            <input id="gm-player-stage" type="number" min="1" max="10000" value="1"></label>
          <button id="gm-player-stage-btn" class="btn small" style="align-self:flex-end">🗺️ Set stage</button>
          ${(!gm && admin) ? `
          <label class="fld"><span>Title</span><select id="gm-player-title">${titleOptions}</select></label>
          <button id="gm-player-title-btn" class="btn small" style="align-self:flex-end">👑 Grant title</button>` : ''}
        </div>
        <div class="row" style="margin-top:0.6rem">
          ${gm ? `<button id="gm-player-heal-btn" class="btn small">💚 Heal</button>` : ''}
          <button id="gm-player-ban-btn" class="btn small danger">🔨 Ban</button>
          <button id="gm-player-unban-btn" class="btn small">🔓 Unban</button>
          <button id="gm-player-kick-btn" class="btn small danger">👢 Kick</button>
          <button id="gm-player-reset-btn" class="btn small danger">♻️ Reset player</button>
          ${isOwner ? `<button id="gm-player-delete-btn" class="btn small danger">🗑️ Delete account</button>` : ''}
        </div>
        <div class="row" style="margin-top:0.6rem">
          <label class="fld"><span>Mute guild chat (minutes, 0 = unmute)</span>
            <input id="gm-player-mute-mins" type="number" min="0" max="10080" value="60"></label>
          <button id="gm-player-mute-btn" class="btn small" style="align-self:flex-end">🔇 Mute</button>
          <button id="gm-player-unmute-btn" class="btn small" style="align-self:flex-end">🔈 Unmute</button>
        </div>
        <div class="row" style="margin-top:0.6rem">
          <span class="muted small" style="align-self:center;flex:1;min-width:220px">🧹 Wipe the message history of the target's guild. The guild itself is untouched — for spam raids.</span>
          <button id="gm-clear-chat-btn" class="btn small danger" style="align-self:flex-end">🧹 Clear guild chat</button>
        </div>
        <div class="row" style="margin-top:0.6rem">
          <label class="fld"><span>Reset quests</span>
            <select id="gm-quest-period">
              <option value="both">📜 Daily + Weekly</option>
              <option value="daily">📜 Daily only</option>
              <option value="weekly">📜 Weekly only</option>
            </select></label>
          <button id="gm-quest-reset-btn" class="btn small" style="align-self:flex-end">🔁 Re-roll quests</button>
        </div>
        <p class="muted small">Banned players cannot log in. Kick force-logs them out immediately (they may sign back in). Mute blocks guild chat until it expires. Reset wipes progress back to a fresh hero (keeps account &amp; role). Quest re-roll unsticks broken daily/weekly sets.</p>
      </div>
      ` : ''}

      ${gm ? `
      <div class="card" id="gm-sec-codes"><h3>🎟️ Gift codes</h3>
        <div class="row">
          <label class="fld"><span>Reward</span>
            <select id="gm-code-kind">
              <option value="gear">👑 Gear set</option>
              <option value="gold">💰 Gold</option>
              <option value="stars">⭐ Stars</option>
            </select></label>
          <label class="fld" id="gm-code-set-wrap"><span>Set</span><select id="gm-code-set">${setOptions}</select></label>
          <label class="fld hidden" id="gm-code-amount-wrap"><span id="gm-code-amount-label">Gold amount</span>
            <input id="gm-code-amount" type="number" min="1" value="10000"></label>
          <label class="fld"><span>Max uses</span><input id="gm-code-uses" type="number" min="1" max="10000" value="10"></label>
        </div>
        <button id="gm-code-create" class="btn wide">Create code</button>
        <div id="gm-new-code" class="new-code hidden"></div>
        <div id="gm-code-list" class="code-list"></div>
      </div>
      ` : ''}

      ${(mod || gm) ? `
      <div class="card" id="gm-sec-mod"><h3>📣 Moderation</h3>
        <label class="fld"><span>Broadcast message (1–500 chars, seen by all players)</span>
          <input id="gm-bc-msg" placeholder="Announcement…" maxlength="500" autocomplete="off"></label>
        <button id="gm-bc-send" class="btn gold wide">Send broadcast</button>
        <h4 class="gm-sub">Players</h4>
        <div class="row">
          <input id="gm-pl-search" placeholder="search username" autocomplete="off">
          <button id="gm-pl-search-btn" class="btn small">Search</button>
        </div>
        <div id="gm-player-list" class="name-list"></div>
      </div>
      ` : ''}

      ` : ''}

      ${gm ? `
      <div class="card" id="gm-sec-staff"><h3>👥 Staff</h3>
        <h4 class="gm-sub">Admin roster</h4>
        <p class="muted small">Admins are entitled to the Warden Arsenal (in-game status, no console).</p>
        <div class="row">
          <button id="gm-admin-add" class="btn small">Add target as admin</button>
        </div>
        <div id="gm-admin-list" class="name-list"></div>
        <h4 class="gm-sub">Game masters</h4>
        <div id="gm-gm-list" class="name-list"></div>
        ${isOwner ? `
        <h4 class="gm-sub">Role management <span class="muted small">(owner only)</span></h4>
        <div class="row">
          <select id="gm-role-select">
            <option value="gm">gm</option>
            <option value="admin">admin</option>
            <option value="moderator">moderator</option>
            <option value="player">player</option>
          </select>
          <button id="gm-role-set" class="btn small gold">Set target's role</button>
        </div>
        <p class="muted small">gm: full console. admin: Warden gear entitlement + player management. moderator: broadcast + player lookup. player: default.</p>` : ''}
      </div>
      ` : ''}

      ${isOwner ? `
      <div class="card" id="gm-sec-server"><h3>⚙️ Server <span class="muted small">(owner only)</span></h3>
        <h4 class="gm-sub">Maintenance mode</h4>
        <div class="row">
          <label class="fld"><span>Message shown to players</span>
            <input id="gm-maint-msg" placeholder="Back soon…" maxlength="500" autocomplete="off"></label>
        </div>
        <div class="row">
          <button id="gm-maint-on" class="btn small danger">🛠️ Turn ON</button>
          <button id="gm-maint-off" class="btn small">Turn OFF</button>
          <span class="muted small" style="align-self:center">Status: <b id="gm-maint-status">…</b></span>
        </div>
        <h4 class="gm-sub">Infinite gold</h4>
        <div class="row">
          <button id="gm-infgold-on" class="btn small gold">Enable ∞ for target</button>
          <button id="gm-infgold-off" class="btn small">Disable for target</button>
        </div>
        <p class="muted small">Purchases never deduct gold and the HUD shows ∞. Survives rebirth. Only the owner can grant it.</p>
        <h4 class="gm-sub">Gold cap</h4>
        <div class="row">
          <input id="gm-goldcap" type="number" min="1000" step="100" placeholder="9000" autocomplete="off" inputmode="numeric">
          <button id="gm-goldcap-save" class="btn small gold">Save</button>
        </div>
        <p class="muted small">Player gold cap, in trillions (T). Current: <span id="gm-goldcap-current">…</span>. The infinite-gold perk bypasses it.</p>
      </div>` : ''}`;
  },

  async refreshCodes(root) {
    const list = root.querySelector('#gm-code-list');
    try {
      const codes = await api.gmCodes();
      const arr = Array.isArray(codes) ? codes : (codes.codes || []);
      if (!arr.length) { list.innerHTML = '<p class="muted small">No codes yet.</p>'; return; }
      list.innerHTML = arr.map(c => {
        const reward = describeReward(c.reward_kind, c.reward_amount, c.gear_set);
        return `
        <div class="code-row">
          <code>${esc(c.code)}</code>
          <span class="muted small">${esc(reward)}</span>
          <span class="muted small">${c.uses}/${c.max_uses} used</span>
        </div>`;
      }).join('');
    } catch (e) {
      list.innerHTML = `<p class="error small">Couldn't load codes.</p>`;
    }
  },

  async refreshRoster(root) {
    const adminList = root.querySelector('#gm-admin-list');
    const gmList = root.querySelector('#gm-gm-list');
    try {
      const { admins = [], gms = [] } = await api.gmRoster();
      adminList.innerHTML = admins.length ? admins.map(u => `
        <div class="name-row"><span>${esc(u)}</span>
          <button class="btn small ghost" data-remove-admin="${esc(u)}">Remove</button></div>`).join('')
        : '<p class="muted small">No admins.</p>';
      gmList.innerHTML = gms.length ? gms.map(u => `<div class="name-row"><span>${esc(u)}</span></div>`).join('')
        : '<p class="muted small">No GMs.</p>';
      adminList.querySelectorAll('[data-remove-admin]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const username = btn.dataset.removeAdmin;
          const ok = await UI.confirm('Remove admin', `Remove <b>${esc(username)}</b> from the admin roster?`);
          if (!ok) return;
          try {
            await api.gmRosterUpdate(username, 'remove-admin');
            this.refreshRoster(root);
            UI.toast(`${username} removed from admins.`, 'success');
          } catch (e) {
            UI.toast(e.message || 'Roster update failed.', 'error');
          }
        });
      });
    } catch (e) {
      adminList.innerHTML = '<p class="error small">Couldn\'t load roster.</p>';
    }
  },
};
