// ============================================================
// ui.js — all DOM rendering for King of Project.
// engine.js stays DOM-free; this file owns the DOM.
// app.js wires behavior via UI.handlers.
// ============================================================
import * as Engine from './engine.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatNum(n) {
  n = Math.floor(Number(n) || 0);
  if (n < 1000) return String(n);
  const units = ['K', 'M', 'B', 'T', 'Q'];
  let u = -1, v = n;
  while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
  return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + units[u];
}

export function formatStatVal(key, v) {
  if (key === 'attackSpeed') return Engine.round2(v).toFixed(2);
  if (['critChance', 'parry', 'dodge', 'lifesteal', 'regen'].includes(key)) {
    return String(Engine.round1(v));
  }
  return formatNum(v);
}

function formatPlayTime(sec) {
  sec = Math.floor(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

const SETTINGS_KEY = 'rpg-idle-settings';

export const UI = {
  handlers: {},
  els: {},
  settings: { damageNumbers: true, reduceMotion: false },
  activeTab: 'battle',

  // ---------------- init ----------------
  init() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) this.settings = { ...this.settings, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    document.body.classList.toggle('reduce-motion', !!this.settings.reduceMotion);

    const ids = [
      'hud-emoji', 'hud-username', 'hud-role', 'hud-race', 'hud-gold', 'hud-stars',
      'hud-stage', 'hud-level', 'hud-xpfill', 'hud-xptext', 'save-indicator',
      'mode-switch', 'enemy-card', 'enemy-sprite', 'enemy-name', 'enemy-stage',
      'boss-badge', 'enemy-hpfill', 'enemy-hptext', 'enemy-atk', 'float-layer',
      'dead-overlay', 'hero-hpfill', 'hero-hptext', 'hero-stats', 'dungeon-chips',
      'tap-btn', 'skill-btn', 'skill-cd', 'combo-meter', 'prestige-box', 'prestige-btn',
      'prestige-note', 'combat-log', 'upgrade-list', 'inventory-grid', 'inv-count',
      'party-slots', 'recruit-list', 'lb-body', 'lb-refresh', 'profile-card',
      'redeem-input', 'redeem-btn', 'gm-entry-card', 'gm-open-btn',
      'set-dmgnums', 'set-motion', 'logout-btn', 'modal-root', 'toast-root',
      'race-grid', 'gm-back',
    ];
    for (const id of ids) this.els[id] = document.getElementById(id);

    // Bottom tab bar
    $$('#tabbar .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.showTab(btn.dataset.tab));
    });

    // Battle controls
    $$('#mode-switch .mode-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handlers.onMode && this.handlers.onMode(btn.dataset.mode));
    });
    this.els['tap-btn'].addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.handlers.onTap && this.handlers.onTap();
    });
    this.els['skill-btn'].addEventListener('click', () => {
      this.handlers.onSkill && this.handlers.onSkill();
    });
    this.els['prestige-btn'].addEventListener('click', () => {
      this.handlers.onPrestige && this.handlers.onPrestige();
    });

    // Gear: delegated equip/sell/upgrade
    this.els['inventory-grid'].addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.closest('.item-card').dataset.id;
      const h = this.handlers;
      if (btn.dataset.action === 'equip' && h.onEquip) h.onEquip(id);
      if (btn.dataset.action === 'sell' && h.onSell) h.onSell(id);
    });
    this.els['upgrade-list'].addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-upgrade]');
      if (!btn) return;
      this.handlers.onUpgrade && this.handlers.onUpgrade(btn.dataset.upgrade);
    });

    // Party: delegated recruit/dismiss
    document.getElementById('tab-party').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const h = this.handlers;
      if (btn.dataset.action === 'recruit' && h.onRecruit) h.onRecruit(btn.dataset.id);
      if (btn.dataset.action === 'dismiss' && h.onDismiss) h.onDismiss(btn.dataset.id);
    });

    // Ranks refresh
    this.els['lb-refresh'].addEventListener('click', () => {
      this.handlers.onTab && this.handlers.onTab('ranks', true);
    });

    // More tab: delegated talent / profession buttons
    document.getElementById('tab-more').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || btn.disabled) return;
      const h = this.handlers;
      if (btn.dataset.action === 'talent' && h.onTalent) h.onTalent(btn.dataset.id);
      if (btn.dataset.action === 'prof' && h.onProfession) h.onProfession(btn.dataset.id);
    });

    // More tab
    this.els['redeem-btn'].addEventListener('click', () => {
      this.handlers.onRedeem && this.handlers.onRedeem();
    });
    this.els['redeem-input'].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handlers.onRedeem && this.handlers.onRedeem();
    });
    this.els['gm-open-btn'].addEventListener('click', () => {
      this.handlers.onOpenGM && this.handlers.onOpenGM();
    });
    this.els['logout-btn'].addEventListener('click', () => {
      this.handlers.onLogout && this.handlers.onLogout();
    });
    this.els['set-dmgnums'].checked = !!this.settings.damageNumbers;
    this.els['set-motion'].checked = !!this.settings.reduceMotion;
    this.els['set-dmgnums'].addEventListener('change', (e) => this.saveSetting('damageNumbers', e.target.checked));
    this.els['set-motion'].addEventListener('change', (e) => {
      this.saveSetting('reduceMotion', e.target.checked);
      document.body.classList.toggle('reduce-motion', e.target.checked);
    });

    // GM back button
    const gmBack = this.els['gm-back'];
    if (gmBack) gmBack.addEventListener('click', () => this.showView('app'));
  },

  saveSetting(key, val) {
    this.settings[key] = val;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  },

  // ---------------- views & tabs ----------------
  showView(name) {
    for (const v of ['auth', 'race', 'app', 'gm']) {
      document.getElementById('view-' + v).classList.toggle('hidden', v !== name);
    }
    window.scrollTo(0, 0);
  },

  showTab(name) {
    this.activeTab = name;
    $$('#tabbar .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('#tab-content .tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    this.handlers.onTab && this.handlers.onTab(name);
  },

  // ---------------- toasts ----------------
  toast(msg, kind = 'info', ms = 2600) {
    const root = this.els['toast-root'];
    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.textContent = msg;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, ms);
    while (root.children.length > 4) root.firstChild.remove();
  },

  // ---------------- modals ----------------
  // buttons: [{label, cls, onClick(close)}]; returns close fn.
  modal({ title, html, buttons, dismissable = true }) {
    const root = this.els['modal-root'];
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2 class="modal-title">${esc(title)}</h2>
        <div class="modal-body">${html}</div>
        <div class="modal-actions"></div>
      </div>`;
    const actions = overlay.querySelector('.modal-actions');
    const close = () => overlay.remove();
    for (const b of (buttons || [{ label: 'OK' }])) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => { b.onClick ? b.onClick(close) : close(); });
      actions.appendChild(btn);
    }
    if (dismissable) {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    }
    root.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    return close;
  },

  confirm(title, html, okLabel = 'Confirm') {
    return new Promise((resolve) => {
      this.modal({
        title,
        html,
        buttons: [
          { label: 'Cancel', onClick: (close) => { close(); resolve(false); } },
          { label: okLabel, cls: 'danger', onClick: (close) => { close(); resolve(true); } },
        ],
      });
    });
  },

  levelUpModal(levels) {
    const last = levels[levels.length - 1];
    this.modal({
      title: '⬆️ Level up!',
      html: `<p class="big">You reached <b>level ${last}</b>${levels.length > 1 ? ` <span class="muted">(+${levels.length - 1} more)</span>` : ''}!</p>
             <p class="muted">+3 Attack · +25 Max HP · +2 Defense per level<br>Hero healed for 25% max HP.</p>`,
      buttons: [{ label: 'Nice!', cls: 'gold' }],
    });
  },

  bossModal(enemy) {
    this.modal({
      title: '👹 Boss approaches!',
      html: `<p class="big"><b>${esc(enemy.name)}</b></p>
             <p class="muted">Stage ${enemy.stage} boss — 2.5× HP, hits 1.4× harder.<br>Bosses always drop rare+ loot and grant ⭐.</p>`,
      buttons: [{ label: '⚔️ Fight!', cls: 'danger' }],
    });
  },

  offlineModal(off, levels) {
    const hrs = Math.floor(off.minutes / 60), mins = off.minutes % 60;
    const away = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    this.modal({
      title: '🌙 While you were away…',
      html: `<p class="muted">Gone for ${away}${off.capped ? ' (capped at 8h)' : ''}.</p>
             <div class="offline-gains">
               <div>⚔️ <b>${formatNum(off.kills)}</b> battles</div>
               <div>💰 <b>+${formatNum(off.gold)}</b> gold</div>
               <div>✨ <b>+${formatNum(off.gains_xp ?? off.xp)}</b> XP</div>
               ${levels.length ? `<div>⬆️ <b>Level ${levels[levels.length - 1]}</b> reached!</div>` : ''}
             </div>`,
      buttons: [{ label: 'Claim', cls: 'gold' }],
    });
  },

  // ---------------- HUD ----------------
  updateHUD(state, user) {
    const e = this.els;
    const race = Engine.RACES[state.race] || {};
    e['hud-emoji'].textContent = race.emoji || '❓';
    e['hud-username'].textContent = (user && user.username) || '—';
    const role = (user && user.role) || 'player';
    e['hud-role'].textContent = role;
    e['hud-role'].className = 'role-badge role-' + role;
    e['hud-race'].textContent = race.name || '';
    e['hud-gold'].textContent = formatNum(state.gold);
    e['hud-stars'].textContent = formatNum(state.stars);
    e['hud-stage'].textContent = state.stage;
    e['hud-level'].textContent = state.level;
    const pct = state.xpNext > 0 ? Math.min(100, (state.xp / state.xpNext) * 100) : 0;
    e['hud-xpfill'].style.width = pct + '%';
    e['hud-xptext'].textContent = `${formatNum(state.xp)} / ${formatNum(state.xpNext)} XP`;
  },

  setSaveIndicator(text, ok = true) {
    const el = this.els['save-indicator'];
    el.textContent = text;
    el.classList.toggle('bad', !ok);
  },

  // ---------------- race select ----------------
  renderRaceSelect(onPick) {
    const grid = this.els['race-grid'];
    grid.innerHTML = '';
    for (const [id, r] of Object.entries(Engine.RACES)) {
      const card = document.createElement('button');
      card.className = 'race-card';
      card.innerHTML = `
        <div class="race-emoji">${r.emoji}</div>
        <div class="race-name">${esc(r.name)}</div>
        <div class="race-trait">${esc(r.trait)}</div>`;
      card.addEventListener('click', () => onPick(id));
      grid.appendChild(card);
    }
  },

  // ---------------- battle ----------------
  renderBattle(state) {
    this.setMode(state.mode);
    const showPrestige = state.stage >= 50;
    this.els['prestige-box'].classList.toggle('hidden', !showPrestige);
    if (showPrestige) {
      this.els['prestige-note'].innerHTML =
        `Reset to level 1 / stage 1 for <b class="gold-text">+25% damage & gold</b> (now +${state.prestigeBonus || 0}%).<br>` +
        `<span class="muted">Keeps: privileged gear sets, ⭐ stars, lifetime stats.</span>`;
    }
    this.updateHeroPanel(state, Engine.computeStats(state), null);
  },

  setMode(mode) {
    $$('#mode-switch .mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const tapBtn = this.els['tap-btn'];
    tapBtn.classList.toggle('hidden', mode !== 'clicker');
    this.els['skill-btn'].classList.toggle('hidden', false);
  },

  setEnemy(enemy) {
    const e = this.els;
    const zone = Engine.zoneFor(enemy.stage);
    e['enemy-sprite'].textContent = enemy.emoji;
    e['enemy-name'].textContent = enemy.name;
    e['enemy-stage'].textContent = `Stage ${enemy.stage} · ${zone.emoji} ${zone.name}`;
    e['boss-badge'].classList.toggle('hidden', !enemy.boss);
    e['enemy-card'].classList.toggle('boss', !!enemy.boss);
    e['enemy-atk'].textContent = `⚔️ ${formatNum(enemy.attack)} attack`;
    this.updateEnemy(enemy);
  },

  updateEnemy(enemy) {
    const e = this.els;
    const pct = enemy.maxHp > 0 ? Math.max(0, (enemy.hp / enemy.maxHp) * 100) : 0;
    e['enemy-hpfill'].style.width = pct + '%';
    e['enemy-hptext'].textContent = `${formatNum(Math.max(0, enemy.hp))} / ${formatNum(enemy.maxHp)}`;
  },

  // Light per-tick refresh: hero bars, chips, skill cooldown.
  updateBattle(state, stats, battle) {
    const e = this.els;
    const pct = stats.maxHp > 0 ? Math.max(0, (state.hero.hp / stats.maxHp) * 100) : 0;
    e['hero-hpfill'].style.width = pct + '%';
    e['hero-hptext'].textContent = `❤️ ${formatNum(Math.max(0, Math.ceil(state.hero.hp)))} / ${formatNum(stats.maxHp)}`;
    if (battle && battle.enemy) this.updateEnemy(battle.enemy);
    // skill cooldown
    if (battle && battle.skillReadyAt) {
      const remain = Math.max(0, battle.skillReadyAt - Date.now());
      const btn = e['skill-btn'];
      btn.disabled = remain > 0;
      e['skill-cd'].textContent = remain > 0 ? `(${(remain / 1000).toFixed(0)}s)` : '';
    }
    this.updateHUD(state, battle ? battle.user : null);
  },

  updateHeroPanel(state, stats, battle) {
    const setLine = stats.setInfo
      ? `<div class="set-active">👑 ${esc(stats.setInfo.name)} <b>+${stats.setInfo.pct}% all stats</b></div>` : '';
    const rested = state.restedUntil && Date.now() < state.restedUntil
      ? `<span class="buff-chip" title="Well-rested: +25% XP">😴 rested</span>` : '';
    this.els['hero-stats'].innerHTML = `
      <span>⚔️ ${formatNum(stats.attack)}</span>
      <span>🛡️ ${formatNum(stats.defense)}</span>
      <span>💥 ${Engine.round1(stats.critChance)}%</span>
      <span>🥾 ${Engine.round1(stats.dodge)}%</span>
      ${rested}
      ${setLine}`;
    // dungeon party chips
    const chips = this.els['dungeon-chips'];
    if (state.mode === 'dungeon' && state.party.length) {
      chips.innerHTML = state.party.map(c => {
        const pct = c.maxHp > 0 ? Math.max(0, (c.hp / c.maxHp) * 100) : 0;
        return `<div class="chip ${c.hp <= 0 ? 'down' : ''}" title="${esc(c.name)}">
          ${c.emoji} <div class="chip-bar"><div style="width:${pct}%"></div></div></div>`;
      }).join('');
      chips.classList.remove('hidden');
    } else {
      chips.classList.add('hidden');
      chips.innerHTML = '';
    }
  },

  floatText(text, kind = 'dmg') {
    if (!this.settings.damageNumbers && (kind === 'dmg' || kind === 'crit')) return;
    const layer = this.els['float-layer'];
    const el = document.createElement('div');
    el.className = 'float-txt float-' + kind;
    el.textContent = text;
    el.style.left = (20 + Math.random() * 60) + '%';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
    while (layer.children.length > 12) layer.firstChild.remove();
  },

  combatLog(msg, kind = '') {
    const log = this.els['combat-log'];
    const line = document.createElement('div');
    line.className = 'log-line ' + kind;
    line.textContent = msg;
    log.prepend(line);
    while (log.children.length > 6) log.lastChild.remove();
  },

  setDead(show) {
    this.els['dead-overlay'].classList.toggle('hidden', !show);
    this.els['tap-btn'].disabled = show;
  },

  // Tap combo meter (clicker mode). frenzyMsLeft > 0 while frenzy is active.
  updateCombo(combo, frenzy, frenzyMsLeft = 0) {
    const el = this.els['combo-meter'];
    if (!el) return;
    if (!combo || combo < 2) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    const pct = Math.min(100, (combo / 200) * 100);
    el.innerHTML = frenzy
      ? `<div class="combo-frenzy">⚡ FRENZY ${(frenzyMsLeft / 1000).toFixed(0)}s — 2× tap damage!</div>
         <div class="combo-bar"><div style="width:${pct}%"></div></div>`
      : `<div class="combo-count">🔥 ${combo} combo <span class="muted small">(+${Math.min(combo, 200) / 2}% tap dmg)</span></div>
         <div class="combo-bar"><div style="width:${pct}%"></div></div>`;
  },

  // ---------------- gear ----------------
  renderGear(state) {
    // upgrades
    const ul = this.els['upgrade-list'];
    ul.innerHTML = '';
    for (const [kind, info] of Object.entries(Engine.UPGRADE_INFO)) {
      const lvl = (state.upgrades && state.upgrades[kind]) || 1;
      const cost = Engine.upgradeCost(kind, lvl);
      const afford = state.gold >= cost;
      const row = document.createElement('div');
      row.className = 'upgrade-row';
      row.innerHTML = `
        <div class="upgrade-info"><span class="upgrade-emoji">${info.emoji}</span>
          <div><div class="upgrade-name">${info.name} <b>Lv ${lvl}</b></div>
          <div class="muted small">${info.desc}</div></div></div>
        <button class="btn small ${afford ? '' : 'disabled'}" data-upgrade="${kind}" ${afford ? '' : 'disabled'}>
          💰 ${formatNum(cost)}
        </button>`;
      ul.appendChild(row);
    }

    // inventory
    const grid = this.els['inventory-grid'];
    const inv = [...(state.inventory || [])].sort((a, b) =>
      (Engine.RARITY_IDX[b.rarity] ?? 0) - (Engine.RARITY_IDX[a.rarity] ?? 0));
    this.els['inv-count'].textContent = `(${inv.length})`;
    grid.innerHTML = '';
    if (!inv.length) {
      grid.innerHTML = '<p class="muted empty">No gear yet — defeat enemies to loot gear!</p>';
      return;
    }
    for (const item of inv) {
      const equippedId = state.equipped && state.equipped[item.slot];
      const isEquipped = equippedId === item.id;
      const card = document.createElement('div');
      card.className = `item-card r-${item.rarity}${item.set ? ' set-item' : ''}${isEquipped ? ' equipped' : ''}`;
      card.dataset.id = item.id;
      const statLines = Object.entries(item.stats || {})
        .map(([k, v]) => `<li>+${formatStatVal(k, v)} ${Engine.STAT_LABELS[k] || k}</li>`).join('');
      const setBadge = item.set
        ? `<div class="set-badge">👑 ${esc(item.setName || item.set)} · full set +${Engine.PRIVILEGED_SETS[item.set]?.setBonus ?? ''}%</div>` : '';
      card.innerHTML = `
        <div class="item-head">
          <span class="slot-emoji">${Engine.SLOT_INFO[item.slot]?.emoji || '🎒'}</span>
          <span class="item-name">${esc(item.name)}</span>
          ${isEquipped ? '<span class="equipped-tag">EQUIPPED</span>' : ''}
        </div>
        <div class="item-sub">${esc(item.rarity)} · ${esc(Engine.SLOT_INFO[item.slot]?.name || item.slot)}</div>
        ${setBadge}
        <ul class="item-stats">${statLines}</ul>
        <div class="item-actions">
          ${isEquipped ? '' : `<button class="btn small" data-action="equip">Equip</button>`}
          ${item.unsellable ? '' : `<button class="btn small ghost" data-action="sell">Sell +${formatNum(item.value || 1)}</button>`}
        </div>`;
      grid.appendChild(card);
    }
  },

  // ---------------- party ----------------
  renderParty(state) {
    const slots = this.els['party-slots'];
    slots.innerHTML = '';
    for (let i = 0; i < Engine.MAX_PARTY; i++) {
      const c = state.party[i];
      const div = document.createElement('div');
      div.className = 'party-slot' + (c ? '' : ' empty');
      if (c) {
        div.innerHTML = `
          <div class="comp-head"><span class="comp-emoji">${c.emoji}</span>
            <div><div class="comp-name">${esc(c.name)}</div>
            <div class="muted small">Lv ${c.level} ${esc(Engine.RACES[c.race]?.name || '')}</div></div></div>
          <div class="comp-stats">⚔️ ${formatNum(c.attack)} · 🛡️ ${formatNum(c.defense)} · ❤️ ${formatNum(c.maxHp)}</div>
          <button class="btn small ghost" data-action="dismiss" data-id="${c.id}">Dismiss</button>`;
      } else {
        div.innerHTML = '<div class="muted">Empty slot</div>';
      }
      slots.appendChild(div);
    }

    const list = this.els['recruit-list'];
    list.innerHTML = '';
    const ownedIds = new Set(state.party.map(c => c.id));
    for (const r of Engine.RECRUITS) {
      const owned = state.party.some(c => c.name === r.name);
      const full = state.party.length >= Engine.MAX_PARTY;
      const afford = state.gold >= r.cost;
      const disabled = owned || full || !afford;
      const reason = owned ? 'Recruited' : full ? 'Party full' : !afford ? 'Need 💰' : '';
      const row = document.createElement('div');
      row.className = 'recruit-row';
      row.innerHTML = `
        <div class="recruit-info"><span class="comp-emoji">${r.emoji}</span>
          <div><div class="comp-name">${esc(r.name)}</div>
          <div class="muted small">⚔️${r.atk} 🛡️${r.def} ❤️${r.hp} · scales with your level</div></div></div>
        <button class="btn small" data-action="recruit" data-id="${r.id}" ${disabled ? 'disabled' : ''}>
          ${owned ? '✔' : `💰 ${formatNum(r.cost)}`} ${reason && !owned ? `<span class="muted small">${reason}</span>` : ''}
        </button>`;
      list.appendChild(row);
    }
    void ownedIds;
  },

  // ---------------- ranks ----------------
  renderRanks(entries, meUsername) {
    const body = this.els['lb-body'];
    body.innerHTML = '';
    if (!entries.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted center">No heroes yet.</td></tr>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    entries.forEach((en, i) => {
      const tr = document.createElement('tr');
      if (en.username === meUsername) tr.className = 'me-row';
      const race = Engine.RACES[en.race] || {};
      tr.innerHTML = `
        <td>${medals[i] || (i + 1)}</td>
        <td>${race.emoji || ''} ${esc(en.username)}</td>
        <td>${en.level}</td>
        <td>${en.stage}</td>
        <td>${formatNum(en.power || 0)}</td>
        <td>${en.bossesKilled}</td>
        <td>${en.prestige > 0 ? '🔥' + en.prestige : '—'}</td>`;
      body.appendChild(tr);
    });
  },

  // ---------------- more ----------------
  renderMore(state, user) {
    const race = Engine.RACES[state.race] || {};
    const role = (user && user.role) || 'player';
    const canGM = role === 'owner' || role === 'gm';
    this.els['gm-entry-card'].classList.toggle('hidden', !canGM);
    const setCount = (state.inventory || []).filter(i => i.set).length;
    this.els['profile-card'].innerHTML = `
      <div class="profile-head">
        <div class="profile-emoji">${race.emoji || '❓'}</div>
        <div>
          <div class="profile-name">${esc(user ? user.username : '—')}</div>
          <div><span class="role-badge role-${role}">${esc(role)}</span>
          <span class="muted small">${esc(race.name || '')}</span></div>
        </div>
      </div>
      <div class="profile-grid">
        <div><span class="muted">Level</span><b>${state.level}</b></div>
        <div><span class="muted">Stage</span><b>${state.stage}</b></div>
        <div><span class="muted">Bosses</span><b>${state.bossesKilled}</b></div>
        <div><span class="muted">Prestige</span><b>🔥${state.prestigeCount || 0} (+${state.prestigeBonus || 0}%)</b></div>
        <div><span class="muted">Kills</span><b>${formatNum(state.stats.kills)}</b></div>
        <div><span class="muted">Taps</span><b>${formatNum(state.stats.taps)}</b></div>
        <div><span class="muted">Best combo</span><b>🔥${formatNum(state.stats.maxCombo || 0)}</b></div>
        <div><span class="muted">Play time</span><b>${formatPlayTime(state.stats.playTimeSec)}</b></div>
        <div><span class="muted">Relic gear</span><b>👑 ${setCount}</b></div>
      </div>
      ${this.masteryCard(state)}
      ${this.professionsCard(state)}
      ${this.achievementsCard(state)}`;
  },

  masteryCard(state) {
    const m = state.mastery || { points: 0, spent: {} };
    const rows = Object.entries(Engine.TALENTS).map(([id, t]) => {
      const rank = (m.spent && m.spent[id]) || 0;
      const maxed = rank >= t.max;
      const pips = '●'.repeat(rank) + '○'.repeat(t.max - rank);
      return `<div class="talent-row">
        <div class="talent-info"><span class="talent-emoji">${t.emoji}</span>
          <div><div class="talent-name">${esc(t.name)} <span class="pips">${pips}</span></div>
          <div class="muted small">${esc(t.desc)}</div></div></div>
        <button class="btn small ${maxed || m.points < 1 ? 'disabled' : 'gold'}" data-action="talent" data-id="${id}"
          ${maxed || m.points < 1 ? 'disabled' : ''}>${maxed ? 'MAX' : '⬆️ 1 pt'}</button>
      </div>`;
    }).join('');
    return `<div class="card sub-card"><h3>🧠 Mastery <span class="muted small">(${m.points || 0} point${(m.points || 0) === 1 ? '' : 's'} — earn 1 per 10 levels)</span></h3>${rows}</div>`;
  },

  professionsCard(state) {
    const rows = Object.entries(Engine.PROFESSIONS).map(([id, p]) => {
      const lvl = (state.professions && state.professions[id]) || 1;
      const maxed = lvl >= p.max;
      const cost = maxed ? null : Engine.professionCost(lvl);
      const afford = cost != null && (state.gold || 0) >= cost;
      return `<div class="talent-row">
        <div class="talent-info"><span class="talent-emoji">${p.emoji}</span>
          <div><div class="talent-name">${esc(p.name)} <b>Lv ${lvl}</b></div>
          <div class="muted small">${esc(p.desc)}</div></div></div>
        <button class="btn small ${!maxed && afford ? '' : 'disabled'}" data-action="prof" data-id="${id}"
          ${maxed || !afford ? 'disabled' : ''}>${maxed ? 'MAX' : `💰 ${formatNum(cost)}`}</button>
      </div>`;
    }).join('');
    return `<div class="card sub-card"><h3>⚒️ Professions <span class="muted small">(leveled with gold, always active)</span></h3>${rows}</div>`;
  },

  achievementsCard(state) {
    const unlocked = new Set(state.achievements || []);
    const cards = Engine.ACHIEVEMENTS.map(a => {
      const got = unlocked.has(a.id);
      return `<div class="ach-card ${got ? '' : 'locked'}">
        <div class="ach-emoji">${a.emoji}</div>
        <div class="ach-name">${esc(a.name)}</div>
        <div class="muted small">${esc(a.desc)}</div>
        <div class="ach-reward">+${a.stars} ⭐</div>
      </div>`;
    }).join('');
    return `<div class="card sub-card"><h3>🏆 Achievements <span class="muted small">(${unlocked.size}/${Engine.ACHIEVEMENTS.length})</span></h3><div class="ach-grid">${cards}</div></div>`;
  },
};
