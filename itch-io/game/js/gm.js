// ============================================================
// gm.js — GM console UI. Only opened when me.role is owner/gm.
// ============================================================
import { api } from './api.js';
import { UI, esc, formatNum } from './ui.js';
import { PRIVILEGED_SETS } from './engine.js';

const SET_IDS = Object.keys(PRIVILEGED_SETS);

export const GM = {
  me: null,

  open(me) {
    this.me = me;
    const role = (me && me.role) || 'player';
    if (role !== 'owner' && role !== 'gm') {
      UI.toast('GM console is for staff only.', 'error');
      return;
    }
    UI.showView('gm');
    this.render();
  },

  async render() {
    const root = document.getElementById('gm-content');
    root.innerHTML = '<p class="muted">Loading console…</p>';
    try {
      const ov = await api.gmOverview();
      root.innerHTML = this.template(ov);
      this.bind(root);
      await Promise.all([this.refreshCodes(root), this.refreshRoster(root)]);
    } catch (e) {
      root.innerHTML = `<p class="error">Couldn't load GM console: ${esc(e.message)}</p>`;
    }
  },

  template(ov) {
    const isOwner = this.me.role === 'owner';
    const setOptions = SET_IDS.map(id => {
      const locked = id === 'sovereign' && !isOwner;
      return `<option value="${id}" ${locked ? 'disabled' : ''}>${esc(PRIVILEGED_SETS[id].name)}${locked ? ' (owner only)' : ''}</option>`;
    }).join('');
    return `
      <div class="gm-cards">
        <div class="gm-card"><div class="gm-num">${formatNum(ov.playerCount)}</div><div class="muted small">players</div></div>
        <div class="gm-card"><div class="gm-num">${formatNum(ov.codeCount)}</div><div class="muted small">gift codes</div></div>
        <div class="gm-card"><div class="gm-num">${esc(ov.role)}</div><div class="muted small">your role</div></div>
      </div>

      <div class="card"><h3>🎁 Grant to player</h3>
        <label class="fld"><span>Username</span><input id="gm-grant-user" placeholder="player name" autocomplete="off"></label>
        <div class="row">
          <label class="fld"><span>Kind</span>
            <select id="gm-grant-kind">
              <option value="stars">⭐ Stars</option>
              <option value="gold">💰 Gold</option>
              <option value="levels">⬆️ Levels</option>
              <option value="gear">👑 Gear set</option>
            </select></label>
          <label class="fld" id="gm-grant-amount-wrap"><span id="gm-grant-amount-label">Amount (1–100000)</span>
            <input id="gm-grant-amount" type="number" min="1" max="1000000" value="100"></label>
          <label class="fld hidden" id="gm-grant-set-wrap"><span>Gear set</span>
            <select id="gm-grant-set">${setOptions}</select></label>
        </div>
        <button id="gm-grant-btn" class="btn gold wide">Grant</button>
        <p class="muted small">Gear grants add the full 5-piece set to the player's inventory. Sovereign set is owner-only.</p>
      </div>

      <div class="card"><h3>🎟️ Gift codes</h3>
        <div class="row">
          <label class="fld"><span>Set</span><select id="gm-code-set">${setOptions}</select></label>
          <label class="fld"><span>Max uses</span><input id="gm-code-uses" type="number" min="1" max="10000" value="10"></label>
        </div>
        <button id="gm-code-create" class="btn wide">Create code</button>
        <div id="gm-new-code" class="new-code hidden"></div>
        <div id="gm-code-list" class="code-list"></div>
      </div>

      <div class="card"><h3>🛡️ Admin roster</h3>
        <p class="muted small">Admins are entitled to the Warden Arsenal (in-game status, no console).</p>
        <div class="row">
          <input id="gm-admin-user" placeholder="username" autocomplete="off">
          <button id="gm-admin-add" class="btn small">Add admin</button>
        </div>
        <div id="gm-admin-list" class="name-list"></div>
        <h4 class="gm-sub">Game masters</h4>
        <div id="gm-gm-list" class="name-list"></div>
      </div>

      ${isOwner ? `
      <div class="card"><h3>👑 Role management <span class="muted small">(owner only)</span></h3>
        <div class="row">
          <input id="gm-role-user" placeholder="username" autocomplete="off">
          <select id="gm-role-select">
            <option value="gm">gm</option>
            <option value="admin">admin</option>
            <option value="player">player</option>
          </select>
          <button id="gm-role-set" class="btn small gold">Set role</button>
        </div>
        <p class="muted small">gm: console access. admin: Warden gear entitlement. player: default.</p>
      </div>` : ''}`;
  },

  bind(root) {
    const $ = (id) => root.querySelector('#' + id);
    const kindSel = $('gm-grant-kind');
    const amountLabel = $('gm-grant-amount-label');
    const amountInput = $('gm-grant-amount');
    const syncKindUI = () => {
      const kind = kindSel.value;
      const isGear = kind === 'gear';
      $('gm-grant-amount-wrap').classList.toggle('hidden', isGear);
      $('gm-grant-set-wrap').classList.toggle('hidden', !isGear);
      if (kind === 'gold') { amountLabel.textContent = 'Amount (1–1000000)'; amountInput.max = '1000000'; }
      else if (kind === 'levels') { amountLabel.textContent = 'Levels (1–100)'; amountInput.max = '100'; }
      else { amountLabel.textContent = 'Amount (1–100000)'; amountInput.max = '100000'; }
    };
    kindSel.addEventListener('change', syncKindUI);
    syncKindUI();

    $('gm-grant-btn').addEventListener('click', async () => {
      const username = $('gm-grant-user').value.trim();
      if (!username) return UI.toast('Enter a username.', 'error');
      const kind = kindSel.value;
      try {
        // Save the operator's live progress first so the grant applies on top of it,
        // otherwise the next autosave would overwrite the grant with stale state.
        try { if (UI.handlers.onSaveState) await UI.handlers.onSaveState(); } catch { /* ignore */ }
        let res = null;
        if (kind === 'stars') {
          const amount = Math.floor(Number($('gm-grant-amount').value));
          if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
            return UI.toast('Amount must be 1–100000.', 'error');
          }
          res = await api.gmGrant(username, 'stars', { amount });
          UI.toast(`Granted ⭐${formatNum(amount)} to ${username}.`, 'success');
        } else if (kind === 'gold') {
          const amount = Math.floor(Number($('gm-grant-amount').value));
          if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) {
            return UI.toast('Amount must be 1–1000000.', 'error');
          }
          res = await api.gmGrant(username, 'gold', { amount });
          UI.toast(`Granted 💰${formatNum(amount)} to ${username}.`, 'success');
        } else if (kind === 'levels') {
          const amount = Math.floor(Number($('gm-grant-amount').value));
          if (!Number.isFinite(amount) || amount < 1 || amount > 100) {
            return UI.toast('Levels must be 1–100.', 'error');
          }
          res = await api.gmGrant(username, 'levels', { amount });
          UI.toast(`Granted ⬆️${amount} levels to ${username}.`, 'success');
        } else {
          const set = $('gm-grant-set').value;
          res = await api.gmGrant(username, 'gear', { set });
          UI.toast(`Granted ${PRIVILEGED_SETS[set].name} to ${username}.`, 'success');
        }
        $('gm-grant-user').value = '';
        // Grant targeted the logged-in operator: hot-reload their live game
        // state so the grant shows up immediately instead of on next login.
        if (res && res.state && this.me &&
            username.toLowerCase() === String(this.me.username).toLowerCase() &&
            UI.handlers.onExternalState) {
          UI.handlers.onExternalState(res.state);
        }
      } catch (e) {
        UI.toast(e.message || 'Grant failed.', 'error');
      }
    });

    $('gm-code-create').addEventListener('click', async () => {
      const set = $('gm-code-set').value;
      const maxUses = Math.floor(Number($('gm-code-uses').value)) || 1;
      try {
        const { code } = await api.gmCreateCode(set, maxUses);
        const box = $('gm-new-code');
        box.classList.remove('hidden');
        box.innerHTML = `<span class="muted small">New code (${esc(PRIVILEGED_SETS[set].name)}, ${maxUses} uses):</span>
                         <div class="code-big">${esc(code)}</div>`;
        this.refreshCodes(root);
        UI.toast('Gift code created.', 'success');
      } catch (e) {
        UI.toast(e.message || 'Could not create code.', 'error');
      }
    });

    $('gm-admin-add').addEventListener('click', async () => {
      const username = $('gm-admin-user').value.trim();
      if (!username) return UI.toast('Enter a username.', 'error');
      try {
        await api.gmRosterUpdate(username, 'add-admin');
        $('gm-admin-user').value = '';
        this.refreshRoster(root);
        UI.toast(`${username} added as admin.`, 'success');
      } catch (e) {
        UI.toast(e.message || 'Roster update failed.', 'error');
      }
    });

    const roleBtn = $('gm-role-set');
    if (roleBtn) {
      roleBtn.addEventListener('click', async () => {
        const username = $('gm-role-user').value.trim();
        const role = $('gm-role-select').value;
        if (!username) return UI.toast('Enter a username.', 'error');
        const ok = await UI.confirm('Set role', `Set <b>${esc(username)}</b> to <b>${esc(role)}</b>?`);
        if (!ok) return;
        try {
          await api.setRole(username, role);
          $('gm-role-user').value = '';
          this.refreshRoster(root);
          UI.toast(`${username} is now ${role}.`, 'success');
        } catch (e) {
          UI.toast(e.message || 'Role change failed.', 'error');
        }
      });
    }
  },

  async refreshCodes(root) {
    const list = root.querySelector('#gm-code-list');
    try {
      const codes = await api.gmCodes();
      const arr = Array.isArray(codes) ? codes : (codes.codes || []);
      if (!arr.length) { list.innerHTML = '<p class="muted small">No codes yet.</p>'; return; }
      list.innerHTML = arr.map(c => `
        <div class="code-row">
          <code>${esc(c.code)}</code>
          <span class="muted small">${esc(PRIVILEGED_SETS[c.gear_set]?.name || c.gear_set)}</span>
          <span class="muted small">${c.uses}/${c.max_uses} used</span>
        </div>`).join('');
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
