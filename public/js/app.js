// ============================================================
// app.js — boot, session flow, game loops, combat wiring.
// ============================================================
import { api } from './api.js?v=20260930ar';
import * as Engine from './engine.js?v20261004i';
import { UI, esc, formatNum } from './ui.js?v20261004i';
import { Auth } from './auth.js?v=20260930ar';

import { Raid } from './raid.js?v=20260930ar';
import { renderGuildSection, syncGuildPerks } from './guild.js?v=20261001e';
import { loadGuest, saveGuest, clearGuest, GUEST_ROLE } from './guest.js?v=20260930ar';
import { Realm } from './realm.js?v20261004i';
import { Audio } from './audio.js?v20261004i';

const TICK_MS = 250;
const AUTOSAVE_MS = 15000;
const ENEMY_ATTACK_S = 2.0;
const RESPAWN_MS = 3000;

// Null-safe input value read: returns '' when the field is absent instead
// of throwing inside a click/submit handler.
function inputVal(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || '') : '';
}
// Throttle stamp for contained tick errors (module scope: one loop only).
let _lastTickErrAt = 0;

const App = {
  user: null,
  state: null,
  enemy: null,
  dead: false,
  respawnAt: 0,
  heroTimer: 0,
  enemyTimer: 0,
  companionTimers: {}, // companion id -> seconds accumulated
  healerTimers: {}, // healer companion id -> seconds since last mend
  skillCDs: {}, // per-skill cooldowns, keyed by skill id
  tapCombo: 0,
  lastTapAt: 0,
  frenzyUntil: 0,
  lastZone: null,
  lastBossModalStage: 0,
  lastDeathStage: 0,
  deathStreak: 0,
  saveTimer: null,
  tickTimer: null,
  statusTimer: null,
  maintenanceMode: false,
  started: false,
  inInn: false, // AFK safe zone: session-only, resets to battle on load
  _paused: false, // pause-while-browsing: world tick frozen, pill visible
  _pauseStartedAt: 0, // wall-clock ms when the current pause began (0 = not paused)
  meter: null, // live damage meter: { startAt, fighters: {key: {label, total, samples:[{t,total}]}} }
};

// ---------------- server gate (maintenance / deploy windows) ----------------
// Returns 'maintenance' (show the maintenance screen), 'ok', or
// 'unreachable' (server still down after retries — fall through to the
// normal flow, which will surface its own "could not reach" notice).
async function serverGate() {
  for (let i = 0; i < 6; i++) {
    try {
      const st = await api.status();
      return st && st.maintenance ? 'maintenance' : 'ok';
    } catch {
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  return 'unreachable';
}

function enterMaintenanceLoop() {
  const show = async () => {
    try {
      const st = await api.status();
      if (st && !st.maintenance) { location.reload(); return; } // back up — reboot cleanly
      UI.showMaintenance(st && st.message ? st.message : null);
    } catch {
      UI.showMaintenance(null); // still down — keep the screen up
    }
  };
  show();
  setInterval(show, 30000);
}

// While playing, poll for maintenance so a mid-session window shows a
// banner and pauses autosaves instead of failing silently. The same poll
// carries the pre-update warning banner and the deploy version check: when
// the server's commit changes, the game refreshes itself so nobody plays
// on stale code.
async function pollMaintenance() {
  if (!App.state) return;
  try {
    const st = await api.status();
    // Scheduled maintenance: tick a countdown banner; at zero the server
    // reports maintenance live and the maintenance page takes over.
    if (!st.maintenance && st.maintenanceIn != null && st.maintenanceIn > 0) {
      startMaintenanceCountdown(st.maintenanceIn);
    } else {
      stopMaintenanceCountdown();
    }
    if (st.maintenance && !App.maintenanceMode) {
      App.maintenanceMode = true;
      stopMaintenanceCountdown();
      UI.setMaintenanceBanner(null);
      try { saveNow(true); } catch { /* reload carries the last autosave */ }
      UI.showMaintenance(st.message || 'The server is down for maintenance. Your progress is safe.');
    } else if (!st.maintenance && App.maintenanceMode) {
      App.maintenanceMode = false;
      // Back up — reboot cleanly, same as the boot-time maintenance loop.
      location.reload();
    }
    // Pre-update warning (set from /staff.html before a deploy goes out).
    UI.setUpdateBanner(st.updateNotice && st.updateNotice.message ? st.updateNotice.message : null);
    // New deploy live → refresh to the new version after a short countdown.
    if (st.commit) {
      if (!App.bootCommit) App.bootCommit = st.commit;
      else if (st.commit !== App.bootCommit && !App.updateReloading) {
        App.updateReloading = true;
        try { saveNow(); } catch { /* reload carries the last autosave */ }
        UI.showUpdateRefresh(10);
      }
    }
  } catch { /* unreachable — the save-failure toast already covers outages */ }
}

// Per-second maintenance countdown banner. The server timestamp is the
// source of truth; this just renders the ticking display between polls.
function startMaintenanceCountdown(seconds) {
  const deadline = Date.now() + seconds * 1000;
  if (!App.maintenanceCountdown) {
    App.maintenanceCountdown = { deadline, timer: setInterval(tickMaintenanceCountdown, 1000) };
  } else if (Math.abs(App.maintenanceCountdown.deadline - deadline) > 90000) {
    App.maintenanceCountdown.deadline = deadline; // staff rescheduled
  }
  tickMaintenanceCountdown();
}
function tickMaintenanceCountdown() {
  const cd = App.maintenanceCountdown;
  if (!cd) return;
  const left = Math.max(0, Math.ceil((cd.deadline - Date.now()) / 1000));
  if (left <= 0) {
    stopMaintenanceCountdown();
    pollMaintenance(); // re-check immediately so the page takes over
    return;
  }
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  UI.setMaintenanceBanner(`Maintenance in ${mm}:${ss} — finish up, your progress is safe.`);
}
function stopMaintenanceCountdown() {
  if (App.maintenanceCountdown) {
    clearInterval(App.maintenanceCountdown.timer);
    App.maintenanceCountdown = null;
  }
}

// ---------------- boot ----------------
// Global error fallback: if anything crashes during boot, ensure the
// "Play as Guest" button still works so players are never soft-locked.
window.addEventListener('error', (e) => {
  try {
    console.error('[boot] Global error caught:', e.message);
    // If boot failed, show the auth view so guest login is clickable.
    const authView = document.getElementById('view-auth');
    if (authView && !window.App?.user) {
      document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
      authView.classList.remove('hidden');
    }
  } catch {}
});

async function boot() {
  // PWA: register the service worker if supported; a failure must never break the game.
  // update() forces the version check on every load so a stale SW can never
  // linger; the SW itself reloads tabs once when a new version activates.
  try {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => { try { reg.update(); } catch (e) {} })
          .catch(() => {});
      });
    }
  } catch (e) {}
  UI.handlers = {
    onTap: doTap,
    onSkill: (id) => useSkill(id),
    onSpell: (id) => useSpell(id),
    onDrinkPotion: doDrinkPotion,
    onOpenSpellbook: () => UI.openSpellbook(App.state),
    onSetSpellSlots: (slots) => {
      if (!Engine.setSpellSlots(App.state, slots)) { UI.toast('Invalid spell loadout.', 'warn'); return; }
      saveNow();
      UI.renderSkillRow(App.state);
      UI.toast('📖 Spell loadout updated!', 'success');
    },
    onClaimQuest: doClaimQuest,
    onEnchant: doEnchant,
    onMode: setMode,
    onRebirth: doRebirth,
    onEnterInn: enterInn,
    onLeaveInn: () => leaveInn(true),
    onEquip: doEquip,
    onSell: doSell,
    onClearBags: doClearBags,
    onToggleAutoSell: doToggleAutoSell,
    onMine: doMine,
    onBuyRod: doBuyRod,
    onPickaxeUpgrade: doPickaxeUpgrade,
    onForgeTier: doForgeTier,
    onForgeCraft: doForgeCraft,
    onGalaxyEquip: doGalaxyEquip,
    onGalaxyUnequip: doGalaxyUnequip,
    onUpgrade: doUpgrade,
    onRecruit: doRecruit,
    onDismiss: doDismiss,
    onLevelUpCompanion: doLevelUpCompanion,
    onRecruitHealer: doRecruitHealer,
    onDismissHealer: doDismissHealer,
    onRecruitTank: doRecruitTank,
    onDismissTank: doDismissTank,
    onMpCreate: doMpCreate,
    onMpJoin: doMpJoin,
    onMpLeave: doMpLeave,
    onMpKick: doMpKick,
    onMpPromote: doMpPromote,
    onMpDisband: doMpDisband,
    onMpCopy: doMpCopy,
    onMpRefresh: () => { loadMpParty(); },
    onHatchPet: doHatchPet,
    onFeedPet: doFeedPet,
    onSellPet: doSellPet,
    onSetActivePet: doSetActivePet,
    onSetSecondPet: doSetSecondPet,
    onRemoveSecondPet: doRemoveSecondPet,
    onBuyEgg: doBuyEgg,
    onBuyTokenItem: doBuyTokenItem,
    onChangeClassOpen: openChangeClass,
    onChangeClass: doChangeClass,
    onChangeHeroNameOpen: openChangeHeroName,
    onChangeHeroName: doChangeHeroName,
    onChangePassword: doChangePassword,
    onChangeUsername: doChangeUsername,
    onBuyArmory: doBuyArmory,
    onBuyHalloweenScythe: doBuyHalloweenScythe,
    onBuyHalloweenGear: doBuyHalloweenGear,
    onTowerSweep: doTowerSweep,
    onBossRushStart: doBossRushStart,
    onWorldBossSpawn: doWorldBossSpawn,
    onWorldBossFight: doWorldBossFight,
    onRedeem: doRedeem,
    onLogout: doLogout,
    onOpenGM: () => GM.open(App.user),
    onTalent: doTalent,
    onProfession: doProfession,
    onSaveState: () => saveNow(),
    onExternalState: applyExternalState,
    onTab: onTabSwitch,
    onRanksCategory: () => { void loadRanks(); },
    // Social: inspect + friends
    onInspect: (username) => UI.openInspect(username, App.state),
    onInspectCompare: (username) => UI.openInspect(username, App.state, true),
    onFetchInspect: (username) => api.inspectPlayer(username),
    onRanksSubtab: (which) => {
      App.ranksSubtab = which;
      UI.switchRanksSubtab(which);
      if (which === 'friends') loadFriends();
    },
    onFriendSend: async (name) => {
      try {
        const r = await api.friendRequest(name);
        UI.toast(`Friend request sent to ${r.username}.`, 'success');
        document.querySelectorAll('.friend-input').forEach((i) => { i.value = ''; });
        loadFriends();
      } catch (e) { UI.toast(e.message || 'Request failed.', 'error'); }
    },
    // HUD 👥 button: open the friends modal and fill it with live data.
    onOpenFriends: async () => {
      if (isGuest()) { UI.showFriendsModal(null, true); return; }
      try {
        const data = await api.getFriends();
        App.friends = data;
        UI.showFriendsModal(data, false);
        UI.setFriendBadge((data.incoming || []).length);
      } catch (e) {
        UI.showFriendsModal({ friends: [], incoming: [], outgoing: [] }, false);
      }
    },
    onFriendAdd: async (username) => {
      const r = await api.friendRequest(username);
      UI.toast(`Friend request sent to ${r.username}.`, 'success');
      loadFriends();
    },
    onFriendAccept: async (username) => {
      try {
        await api.friendRespond(username, true);
        UI.toast(`You are now friends with ${username}.`, 'success');
        loadFriends();
      } catch (e) { UI.toast(e.message || 'Accept failed.', 'error'); }
    },
    onFriendDecline: async (username) => {
      try {
        await api.friendRespond(username, false);
        UI.toast('Request declined.', 'info');
        loadFriends();
      } catch (e) { UI.toast(e.message || 'Decline failed.', 'error'); }
    },
    onFriendRemove: async (username, opts) => {
      const skipConfirm = opts && opts.confirm === false;
      if (!skipConfirm) {
        const ok = await UI.confirm('Remove friend?', `Remove <b>${esc(username)}</b> from your friends?`);
        if (!ok) return;
      }
      await api.removeFriend(username);
      UI.toast('Removed from friends.', 'info');
      loadFriends();
    },
    onUpgradeAccount: () => promptUpgrade('Friends'),
    onUiStyle: setUiStyle,
    onBtnStyle: setBtnStyle,
    onBgStyle: setBgStyle,
    onBattleBg: setBattleBg,
    onNameColor: setNameColor,
    onNameFx: setNameFx,
    onEyeColor: setEyeColor,
    onOrbColors: setOrbColors,
    onOrbPalette: setOrbPalette,
    onSfx: setSfx,
    onMusic: setMusic,
    onMusicTrack: setMusicTrack,
    onFollowWorld: setFollowWorld,
    onCombatMusic: setCombatMusic,
    onMusicVolume: setMusicVolume,
    onSfxVolume: setSfxVolume,
    onRealmOpen: () => { try { Realm.open(); } catch {} },
    onCharacterOpen: () => openCharacterSheet(),
    onNotifPref: (cat, val) => {
      const s = App.state;
      if (!s) return;
      if (!s.settings || typeof s.settings !== 'object') s.settings = {};
      if (!s.settings.notif || typeof s.settings.notif !== 'object') s.settings.notif = {};
      s.settings.notif[cat] = !!val;
      saveNow();
    },
    onShare: () => UI.shareGame(App.state, App.user),
    onChangelog: () => UI.openChangelog(),
    onTitle: (id) => {
      const s = App.state;
      if (!s || !(s.titlesUnlocked || []).includes(id)) return;
      s.activeTitle = id;
      if (UI.activeTab === 'titles') UI.renderTitles(s);
      else UI.renderMore(s, App.user);
      UI.toast(`👑 Title set: ${Engine.titleName(id)}`, 'success');
      saveNow();
    },
    onTitlesList: () => {
      if (App.state) UI.showTitlesModal(App.state);
    },
    onLbCategory: () => { loadRanks(); },
    onCountry: (code) => {
      const s = App.state;
      if (!s) return;
      const c = String(code || '').toUpperCase();
      s.country = c && Engine.isValidCountry(c) ? c : null;
      if (UI.activeTab === 'stats') UI.renderStats(s, App.user);
      else UI.renderMore(s, App.user);
      UI.toast(c && s.country ? `🌍 Flag set: ${Engine.countryFlag(c)}` : '🌍 Flag removed.', 'success');
      saveNow();
    },
  };
  UI.init();
  Audio.init(); // registers first-gesture unlock + button click ticks
  // Notification prefs live on the save; UI.notify() reads them through this.
  UI.setNotifPrefsProvider(() => (App.state && App.state.settings && App.state.settings.notif) || {});
  // Quest live-sync reads state through this (avoids a bare global).
  UI.setStateProvider(() => App.state);

  // Bind the auth form NOW, not after the server gate: the auth screen is
  // already visible from the static HTML, and a tap before the gate finishes
  // would natively submit the form (full page reload) instead of logging in.
  Auth.init({ onAuthed: (u) => enterApp(u), onGuest: (n) => enterGuest(n) });

  // Maintenance / reachability gate: check the server before anything else.
  // Retries briefly so a deploy/restart window shows as "updating", not dead.
  const gate = await serverGate();
  if (gate === 'maintenance') { enterMaintenanceLoop(); return; }

  let user = null;
  try {
    const res = await api.me();
    user = res.user;
  } catch (e) {
    if (e.status === 401) {
      // Stale session — clear it and fall through to auth view (no loop).
      try { localStorage.removeItem('tos_session_token'); } catch {}
      try { localStorage.removeItem('tos_guest'); } catch {}
    } else {
      UI.toast('Could not reach the server.', 'error');
    }
  }

  // Someone may already have logged in (or entered as guest) while the gate
  // was running — don't yank them back to the auth screen or boot twice.
  if (App.user) return;

  if (!user) {
    showAuthView();
  } else {
    enterApp(user);
  }
}

// The auth screen: login/register tabs plus the guest entry point.
function showAuthView() {
  UI.showView('auth');
  // REMASTER: mockup-style path selection
  const pathSelect = document.getElementById('path-select');
  const authForms = document.getElementById('auth-forms');
  const guestBtn = document.getElementById('path-guest-btn');
  const accountBtn = document.getElementById('path-account-btn');
  const backBtn = document.getElementById('auth-back-btn');
  if (pathSelect && authForms) {
    pathSelect.classList.remove('hidden');
    authForms.classList.add('hidden');
  }
  if (guestBtn && !guestBtn._bound) {
    guestBtn._bound = true;
    guestBtn.addEventListener('click', () => {
      // Go straight to guest flow
      if (pathSelect) pathSelect.classList.add('hidden');
      if (authForms) authForms.classList.remove('hidden');
      // Trigger guest section
      const guestStart = document.getElementById('guest-start');
      if (guestStart) guestStart.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  if (accountBtn && !accountBtn._bound) {
    accountBtn._bound = true;
    accountBtn.addEventListener('click', () => {
      if (pathSelect) pathSelect.classList.add('hidden');
      if (authForms) authForms.classList.remove('hidden');
    });
  }
  if (backBtn && !backBtn._bound) {
    backBtn._bound = true;
    backBtn.addEventListener('click', () => {
      if (pathSelect) pathSelect.classList.remove('hidden');
      if (authForms) authForms.classList.add('hidden');
    });
  }
  // REMASTER: start the login overture (calm -> epic build)
  try {
    if (typeof Audio !== 'undefined' && Audio.startLoginMusic) {
      // Delay slightly so the first user gesture (click) can unlock audio
      setTimeout(() => Audio.startLoginMusic(), 500);
    }
  } catch {}
  Auth.init({ onAuthed: (u) => enterApp(u), onGuest: (n) => enterGuest(n) });
}

const isGuest = () => App.user && App.user.role === GUEST_ROLE;

// One-off persist used outside the autosave loop (character creation,
// settings that save immediately, migration points). Guests write to
// localStorage; authed players hit /api/state.
async function persistNow() {
  if (!App.state) return;
  if (isGuest()) { saveGuest(App.user.username, App.state); return; }
  await api.saveState(App.state);
}

// "This needs an account" prompt for server-gated features in guest mode.
function promptUpgrade(feature) {
  UI.modal({
    title: '🔐 ' + feature,
    html: `<p>Guests can't use ${esc(feature)} — it's tied to an account.</p>
           <p class="muted">Create a free account and your current guest progress comes with you.</p>`,
    buttons: [
      { label: 'Not now' },
      { label: '✨ Create account', cls: 'gold', onClick: (close) => { close(); openUpgradeModal(); } },
    ],
  });
}

// Character sheet: WoW-style paper-doll. Opened by tapping the hero panel.
function openCharacterSheet() {
  if (!App.state) return;
  UI.openCharacter(App.state, (App.user && App.user.username) || 'You');
}

// Guest → account migration: register, upload the local guest save to the
// new account, clear the guest blob, and reboot into the authed session.
async function openUpgradeModal() {
  if (!isGuest()) return;
  const errId = 'upgrade-err';
  UI.modal({
    title: '✨ Create account',
    html: `
      <p class="muted small">Your guest hero (<b>${esc(App.user.username)}</b>, Lv ${App.state ? App.state.level : 1}) moves to the new account.</p>
      <div class="auth-form">
        <input id="upgrade-username" placeholder="Username (3–20, letters/numbers/_)" maxlength="20" autocomplete="username">
        <input id="upgrade-password" type="password" placeholder="Password (min 8 chars)" autocomplete="new-password">
        <input id="upgrade-password2" type="password" placeholder="Confirm password" autocomplete="new-password">
      </div>
      <div id="${errId}" class="auth-error hidden"></div>`,
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Create & keep progress', cls: 'gold',
        onClick: async (close) => {
          const errBox = document.getElementById(errId);
          const showErr = (m) => { if (errBox) { errBox.textContent = m; errBox.classList.remove('hidden'); } };
          const username = inputVal('upgrade-username').trim();
          const password = inputVal('upgrade-password');
          const confirm = inputVal('upgrade-password2');
          if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return showErr('Username: 3–20 chars, letters/numbers/underscore.');
          if (password.length < 8) return showErr('Password must be at least 8 characters.');
          if (password !== confirm) return showErr('Passwords do not match.');
          try {
            await api.register(username, password); // sets the session cookie
            await api.saveState(App.state);         // upload guest progress
            clearGuest();
            close();
            UI.toast('✨ Account created — progress kept!', 'success');
            setTimeout(() => location.reload(), 800); // reboot into the authed session
          } catch (e) {
            showErr(e.message || 'Registration failed.');
          }
        },
      },
    ],
  });
}

// Re-entry guard: the auth form is bound before the server gate finishes, so
// a login submitted during the gate can overlap boot's own post-gate entry.
let _enterAppActive = false;
async function enterApp(user) {
  if (_enterAppActive) return;
  if (App.user && App.state && App.user.username === user.username) return;
  _enterAppActive = true;
  try {
    let raw, lastSeenAt;
    try {
      const res = await api.getState();
      raw = res.state; lastSeenAt = res.lastSeenAt;
    } catch (e) {
      showAuthView();
      UI.toast('Session expired — please log in again.', 'error');
      return;
    }
    await enterAppWithState(user, raw, lastSeenAt);
  } finally {
    _enterAppActive = false;
  }
}

// Guest entry: no server calls at all. State comes from localStorage
// (or starts fresh); the character-creation flow is shared with authed
// players via enterAppWithState.
async function enterGuest(name) {
  const g = loadGuest();
  const user = { username: name, role: GUEST_ROLE };
  await enterAppWithState(user, g ? g.state : null, g ? g.lastSeen : null);
}

async function enterAppWithState(user, raw, lastSeenAt) {
  App.user = user;

  // REMASTER: crossfade from login overture to in-game music
  try {
    if (typeof Audio !== 'undefined' && Audio.transitionToGameMusic) {
      Audio.transitionToGameMusic();
    }
  } catch {}

  // Server gold cap (owner-adjustable); failure keeps the built-in default.
  // Also picks up the active server event buff (double XP/gold weekends).
  try {
    const sj = await api.getSettings();
    if (sj && Number.isFinite(sj.goldCap)) Engine.setGoldCap(sj.goldCap);
    if (sj && sj.eventBuff) Engine.setEventBuff(sj.eventBuff);
    const __ev = Engine.eventBuff();
    if (__ev) {
      const ends = new Date(__ev.endsAt).toLocaleString();
      setTimeout(() => UI.toast(`🎉 ${__ev.label}: ${__ev.xpMult}x XP + ${__ev.goldMult}x gold until ${ends}`, 'success'), 2500);
    }
  } catch { /* offline-tolerant */ }

  let state = Engine.ensureState(raw);

  // First run: no race chosen yet → race picker, then class, then (Hunter) pet, then spec.
  if (!state.race) {
    UI.showView('race');
    UI.renderRaceSelect((race) => {
      UI.showView('class');
      UI.renderClassSelect((cls) => {
        const afterClass = async (petSpecies) => {
          UI.showView('spec');
          UI.renderSpecSelect(async (spec) => {
            const ns = Engine.defaultState(race);
            ns.playerClass = cls;
            ns.spec = spec;
            if (cls === 'hunter' && petSpecies) Engine.addStarterPet(ns, petSpecies);
            App.state = ns;
            try { await persistNow(); } catch { /* offline-tolerant */ }
            startGame();
          });
        };
        if (cls === 'hunter') {
          UI.showView('pet');
          UI.renderPetSelect((speciesId) => afterClass(speciesId));
        } else {
          afterClass(null);
        }
      });
    });
    return;
  }

  // Existing player missing class or spec: one-time mandatory choice.
  // Hunters with no pets yet also pick their starter companion here.
  if (!state.playerClass || !state.spec) {
    const needsPet = (state.pets && Array.isArray(state.pets.collection) && state.pets.collection.length === 0);
    UI.classSpecChoiceModal(async (cls, spec, petSpecies) => {
      if (!state.playerClass) state.playerClass = cls;
      if (!state.spec) state.spec = spec;
      if (cls === 'hunter' && petSpecies && state.pets.collection.length === 0) {
        Engine.addStarterPet(state, petSpecies);
      }
      App.state = state;
      try { await persistNow(); } catch { /* offline-tolerant */ }
      await continueBoot(state, lastSeenAt);
    }, { lockedClass: state.playerClass, needsPet });
    return;
  }

  App.state = state;
  await continueBoot(state, lastSeenAt);
}

// Everything after race/class selection: init raid, show the app,
// apply offline earnings, start the game loop.
async function continueBoot(state, lastSeenAt) {
  Raid.init(state);
  grantStaffTitles();
  UI.showView('app');
  // Guild perks: fetch once at boot for account players (no-op for guests
  // and guildless players). Fire-and-forget; the engine defaults to zero.
  if (!isGuest()) {
    try { syncGuildPerks(api); } catch { /* offline-tolerant */ }
  }

  // Offline earnings (lastSeenAt null on brand-new accounts).
  if (lastSeenAt) {
    const off = Engine.offlineEarnings(state, lastSeenAt, Date.now());
    if (off && (off.gold > 0 || off.xp > 0)) {
      const addedGold = Engine.addGold(state, off.gold);
      const xpRes = Engine.gainXp(state, off.xp);
      await saveNow();
      UI.offlineModal({ ...off, gold: addedGold, gains_xp: xpRes.gained }, xpRes.levels);
      // Well-rested: +25% XP for 30 minutes after returning.
      state.restedUntil = Date.now() + 30 * 60 * 1000;
      announceSkillUnlocks(xpRes.skills);
      await saveNow();
    }
    // REMASTER: Enhanced offline progress (materials + reputation)
    if (typeof processOfflineProgressOnLogin === 'function') {
      setTimeout(() => processOfflineProgressOnLogin(), 500);
    }
  }

  startGame();
}

// Staff titles + name effects: unlock the tiers matching the account's staff
// role at boot (owner → owner+admin+gm, admin → admin+gm, gm → gm).
// Idempotent; the titles/effects themselves can never auto-unlock via
// checkTitles() or the token shop.
function grantStaffTitles() {
  const s = App.state;
  const role = App.user && App.user.role;
  if (!s || !role) return;
  const tiers = role === 'owner' ? ['owner', 'admin', 'gm']
    : role === 'admin' ? ['admin', 'gm']
    : role === 'gm' ? ['gm'] : [];
  if (!tiers.length) return;
  if (!Array.isArray(s.titlesUnlocked)) s.titlesUnlocked = ['wanderer'];
  let added = 0;
  for (const t of (Engine.STAFF_TITLES || [])) {
    if (tiers.includes(t.staffRole) && !s.titlesUnlocked.includes(t.id)) {
      s.titlesUnlocked.push(t.id);
      added++;
    }
  }
  const fx = Engine.ensureFxUnlocked(s);
  for (const f of (Engine.STAFF_NAME_FX || [])) {
    if (tiers.includes(f.staffRole) && !fx.includes(f.id)) {
      fx.push(f.id);
      added++;
    }
  }
  if (added && !isGuest()) { try { saveNow(); } catch { /* offline-tolerant */ } }
}

// ---------------- UI style theme ----------------
// engine.js is owned by another agent: never read/write uiStyle there.
// Normalize here: anything that isn't 'classic' is 'modern'.
function uiStyleOf(s) {
  return (s && s.uiStyle === 'classic') ? 'classic' : 'modern';
}
function applyUiStyle() {
  const style = uiStyleOf(App.state);
  document.body.dataset.uistyle = style;
  UI.setUiStyleSeg(style);
}
function setUiStyle(style) {
  const s = App.state;
  if (!s) return;
  s.uiStyle = style === 'classic' ? 'classic' : 'modern';
  applyUiStyle();
  saveNow();
}

// ---------------- custom button/background styles ----------------
// Cosmetic player preferences stored on the save (like uiStyle).
// Unknown values normalize to 'default', which renders pixel-identical
// to the uncustomized game.
const BTN_STYLE_IDS = ['default', 'ocean', 'crimson', 'emerald', 'gold', 'mono'];
const BG_STYLE_IDS = ['default', 'deepspace', 'crimson', 'emerald', 'midnight', 'shadow-eyes', 'orbs', 'ember-drift', 'void-tide', 'throne-storm', 'inferno-flare', 'cinder-storm', 'phoenix-ash', 'frostfall', 'starfall', 'bloodmoon', 'nightsky', 'sunset', 'woods', 'water', 'autumn-dusk', 'winter-night', 'hallows-eve', 'new-year', 'summer-tide', 'spring-bloom', 'class-hunter', 'class-warrior', 'class-mage', 'class-assassin', 'class-necromancer', 'class-berserker'];
function btnStyleOf(s) {
  return (s && BTN_STYLE_IDS.includes(s.btnStyle)) ? s.btnStyle : 'default';
}
function bgStyleOf(s) {
  return (s && BG_STYLE_IDS.includes(s.bgStyle)) ? s.bgStyle : 'default';
}
function bgSceneOpts(s) {
  const st = (s && s.settings) || {};
  return {
    eyeColor: st.eyeColor || 'violet',
    orbColors: (st.orbColors && st.orbColors.length === 3) ? st.orbColors : UI.DEFAULT_ORB_COLORS,
  };
}
function applyCustomStyles() {
  document.body.dataset.btnstyle = btnStyleOf(App.state);
  const bg = bgStyleOf(App.state);
  document.body.dataset.bgstyle = bg;
  // Photo-backed scenes (painted seasonal art, starfall, …) show through the
  // login screen: the canvas carries the painting, so the auth view's own
  // opaque gradient would just hide it. The auth card keeps its dark panel.
  const st = (UI.BG_STYLES || []).find((s) => s.id === bg);
  if (st && st.photo) document.body.dataset.bgphoto = '1';
  else delete document.body.dataset.bgphoto;
  UI.syncCustomStyles(btnStyleOf(App.state), bg);
  UI.syncBattleBg(battleBgOf(App.state));
  UI.syncNameStyle(nameColorOf(App.state), nameFxOf(App.state));
  UI.setBgScene(bg, bgSceneOpts(App.state));
  UI.renderBgAnimOpts(bg, App.state && App.state.settings);
}
function setEyeColor(id) {
  const s = App.state;
  if (!s) return;
  if (!s.settings || typeof s.settings !== 'object') s.settings = {};
  if (!UI.EYE_COLORS.some((c) => c.id === id)) return;
  s.settings.eyeColor = id;
  UI.setBgScene(bgStyleOf(s), bgSceneOpts(s));
  UI.renderBgAnimOpts(bgStyleOf(s), s.settings);
  saveNow();
}
function setOrbColors(colors) {
  const s = App.state;
  if (!s) return;
  if (!s.settings || typeof s.settings !== 'object') s.settings = {};
  const clean = (colors || []).slice(0, 3).map((c) => /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#a855f7');
  while (clean.length < 3) clean.push('#a855f7');
  s.settings.orbColors = clean;
  UI.setBgScene(bgStyleOf(s), bgSceneOpts(s));
  UI.renderBgAnimOpts(bgStyleOf(s), s.settings);
  saveNow();
}
function setOrbPalette(id) {
  const p = UI.ORB_PALETTES.find((x) => x.id === id);
  if (p) setOrbColors(p.colors);
}
function setBtnStyle(id) {
  const s = App.state;
  if (!s) return;
  s.btnStyle = BTN_STYLE_IDS.includes(id) ? id : 'default';
  applyCustomStyles();
  saveNow();
}
function setBgStyle(id) {
  const s = App.state;
  if (!s) return;
  s.bgStyle = BG_STYLE_IDS.includes(id) ? id : 'default';
  applyCustomStyles();
  saveNow();
}
// Battle background choice (state.battleBg): 'world' (realm's ambient scene,
// default), 'mystyle' (the background picked in Settings), or 'off' (plain
// dark, no animated scene). Sanitized like bgStyle; tampered values fall back.
const BATTLE_BG_IDS = ['world', 'mystyle', 'off'];
function battleBgOf(s) {
  return (s && BATTLE_BG_IDS.includes(s.battleBg)) ? s.battleBg : 'world';
}
function setBattleBg(id) {
  const s = App.state;
  if (!s) return;
  s.battleBg = BATTLE_BG_IDS.includes(id) ? id : 'world';
  UI.syncBattleBg(s.battleBg);
  saveNow();
}
// ---- player name styles (cosmetic; top-level on state like bgStyle) ----
const NAME_FX_IDS = Engine.ALL_NAME_FX_IDS;
const NAME_COLOR_DEFAULT = '#ffd76a';
function nameColorOf(s) {
  const c = s && s.nameColor;
  return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : NAME_COLOR_DEFAULT;
}
function nameFxOf(s) {
  const f = s && s.nameFx;
  return NAME_FX_IDS.includes(f) ? f : 'none';
}
function setNameColor(c) {
  const s = App.state;
  if (!s) return;
  s.nameColor = /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : NAME_COLOR_DEFAULT;
  UI.syncNameStyle(nameColorOf(s), nameFxOf(s));
  saveNow();
}
function setNameFx(fx) {
  const s = App.state;
  if (!s) return;
  if (!NAME_FX_IDS.includes(fx)) fx = 'none';
  // Token-exclusive effects must be bought in the Token Shop first.
  if (fx !== 'none' && Engine.TOKEN_NAME_FX.some(f => f.id === fx) && !Engine.fxIsUnlocked(s, fx)) {
    UI.toast('🔒 Buy this effect in the 🌀 Token Shop first!', 'warn');
    return;
  }
  // Staff-exclusive effects are granted automatically by staff role at boot.
  if (fx !== 'none' && Engine.STAFF_NAME_FX.some(f => f.id === fx) && !Engine.fxIsUnlocked(s, fx)) {
    UI.toast('🔒 Staff-only effect.', 'warn');
    return;
  }
  s.nameFx = fx;
  UI.syncNameStyle(nameColorOf(s), nameFxOf(s));
  saveNow();
}

// ---------------- audio prefs ----------------
// Cosmetic player preferences stored on the save (like btnStyle), so they
// persist to the server for authed players and to localStorage for guests.
// SFX defaults ON; music defaults OFF (opt-in).
function audioOf(s) {
  const a = s && s.audio;
  const track = (a && typeof a.track === 'string' && Audio.MUSIC_TRACKS.includes(a.track)) ? a.track : 'shadow-requiem';
  const vol = (v) => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
  return {
    sfx: !a || a.sfx !== false,
    music: !!(a && a.music),
    track,
    followWorld: !a || a.followWorld !== false, // default ON: worlds pick the music
    combatMusic: !a || a.combatMusic !== false, // default ON: bosses get their theme
    musicVol: vol(a && a.musicVol),
    sfxVol: vol(a && a.sfxVol),
  };
}
function applyAudioPrefs() {
  const p = audioOf(App.state);
  Audio.sync(p);
  const sfxEl = UI.el('set-sfx');
  const musEl = UI.el('set-music');
  if (sfxEl) sfxEl.checked = p.sfx;
  if (musEl) musEl.checked = p.music;
  const mvEl = UI.el('set-music-vol');
  if (mvEl) mvEl.value = Math.round(p.musicVol * 100);
  const svEl = UI.el('set-sfx-vol');
  if (svEl) svEl.value = Math.round(p.sfxVol * 100);
  const cmEl = UI.el('set-combat-music');
  if (cmEl) cmEl.checked = p.combatMusic;
  UI.syncMusicPrefs(p);
}
function setSfx(on) {
  const s = App.state;
  if (!s) return;
  s.audio = { ...audioOf(s), sfx: !!on };
  applyAudioPrefs();
  saveNow();
}
function setMusic(on) {
  const s = App.state;
  if (!s) return;
  s.audio = { ...audioOf(s), music: !!on };
  applyAudioPrefs();
  saveNow();
}
// Music track selection. Manual picks turn off world-follow so the player's
// choice sticks; the follow-world toggle can re-enable it.
function setMusicTrack(id) {
  const s = App.state;
  if (!s || !Audio.MUSIC_TRACKS.includes(id)) return;
  s.audio = { ...audioOf(s), track: id, followWorld: false };
  applyAudioPrefs();
  saveNow();
}
function setFollowWorld(on) {
  const s = App.state;
  if (!s) return;
  s.audio = { ...audioOf(s), followWorld: !!on };
  if (on) applyWorldMusic();
  applyAudioPrefs();
  saveNow();
}
// Boss-fight music: temporarily switches to the Dread Sovereign theme while
// a boss is up (Audio restores the previous track after). Toggleable.
function setCombatMusic(on) {
  const s = App.state;
  if (!s) return;
  s.audio = { ...audioOf(s), combatMusic: !!on };
  applyAudioPrefs();
  if (!on) Audio.setCombat(false);
  else if (App.enemy) Audio.setCombat(!!App.enemy.boss, App.enemy.towerFloor);
  saveNow();
}
function setMusicVolume(v) {
  const s = App.state;
  if (!s) return;
  const vol = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
  s.audio = { ...audioOf(s), musicVol: vol };
  Audio.setMusicVolume(vol);
  saveNow();
}
function setSfxVolume(v) {
  const s = App.state;
  if (!s) return;
  const vol = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
  s.audio = { ...audioOf(s), sfxVol: vol };
  Audio.setSfxVolume(vol);
  saveNow();
}
// Worlds pick the music: Void Abyss and Throne of Shadows get the Void Hymn,
// earlier worlds keep the Shadow Requiem. Only when followWorld is on.
function applyWorldMusic() {
  const s = App.state;
  if (!s || audioOf(s).followWorld === false) return;
  // A boss fight owns the music: never let a world change stomp the boss theme.
  if (App.enemy && App.enemy.boss && audioOf(s).combatMusic !== false) return;
  const world = Engine.worldForStage(s.stage);
  const track = (world.id === 'void-abyss' || world.id === 'throne-of-shadows') ? 'void-hymn' : 'shadow-requiem';
  if (audioOf(s).track !== track) {
    s.audio = { ...audioOf(s), track };
    applyAudioPrefs();
  }
}

// Dynamic event icon: Halloween pumpkin during Oct, default otherwise.
function applyEventIcon() {
  try {
    const halloween = Engine.isEventActive && Engine.isEventActive('HALLOWEEN');
    const iconPath = halloween ? 'icons/icon-halloween-192.png' : 'icons/icon-192.v2.png';
    const applePath = halloween ? 'icons/icon-halloween-apple.png' : 'icons/apple-touch-icon.v2.png';
    // Update favicon
    let favicon = document.querySelector('link[rel="icon"]');
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.appendChild(favicon);
    }
    favicon.href = iconPath;
    // Update apple-touch-icon
    let apple = document.querySelector('link[rel="apple-touch-icon"]');
    if (apple) apple.href = applePath;
    // Halloween auth theme
    document.body.classList.toggle('halloween-auth', !!halloween);
  } catch (e) { /* fail gracefully */ }
}

function startGame() {
  if (App.started) return;
  App.started = true;
  applyUiStyle();
  applyCustomStyles();
  applyAudioPrefs();
  applyEventIcon();
  // Guest chrome: upgrade card + exit label instead of logout.
  const upgradeCard = UI.el('guest-upgrade-card');
  if (upgradeCard) upgradeCard.classList.toggle('hidden', !isGuest());
  const logoutBtn = UI.el('logout-btn');
  if (logoutBtn) logoutBtn.textContent = isGuest() ? '🚪 Exit guest session' : 'Logout';
  UI.refreshAccountCard(App.user, isGuest());
  const upBtn = UI.el('guest-upgrade-btn');
  if (upBtn) upBtn.addEventListener('click', openUpgradeModal);
  // Character sheet: tap the top hero panel (.hud-id) or the battle hero
  // panel (.hero-panel). Delegated so it survives HUD re-renders.
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.hud-id, .hero-panel')) openCharacterSheet();
  });
  UI.showView('app');
  spawnEnemy();
  UI.renderBattle(App.state);
  UI.renderGear(App.state);
  renderPartyTab();
  UI.renderMore(App.state, App.user);
  UI.updateHUD(App.state, App.user);
  UI.showTab('battle');

  // Periodic quest reset check: daily/weekly quest sets roll on UTC
  // day/week keys inside Engine.ensureQuests, but nothing invoked it outside
  // the Quests tab — a player grinding Battle across midnight kept stale
  // quests until they opened the tab. Check at session start and every
  // minute; on rollover, toast, refresh the tab if visible, and persist.
  checkQuestReset();
  App.questResetTimer = setInterval(() => {
    try { checkQuestReset(); } catch { /* reset check must never stall the game */ }
  }, 60000);

  // A single bad tick must never stall the game: contain the error, log it
  // (throttled so a persistent failure can't spam the console), and let the
  // next tick proceed as normal.
  App.tickTimer = setInterval(() => {
    try { tick(); }
    catch (err) {
      const now = Date.now();
      if (now - _lastTickErrAt > 10000) {
        _lastTickErrAt = now;
        try { console.error('[app] tick error (contained, loop continues):', err); } catch { /* logging must never throw */ }
      }
    }
  }, TICK_MS);
  App.saveTimer = setInterval(() => saveNow(), AUTOSAVE_MS);
  // REMASTER: Raid lockout countdown (1s updates)
  App.lockoutTimer = setInterval(() => {
    try {
      if (typeof updateRaidLockoutUI === 'function' && App.state) {
        updateRaidLockoutUI(App.state);
      }
      // REMASTER: Global server event polling (War Effort gate opening)
      if (typeof pollGlobalServerEvents === 'function') {
        pollGlobalServerEvents();
      }
    } catch (err) { /* ignore */ }
  }, 1000);
  App.statusTimer = setInterval(() => pollMaintenance(), 60000);
  pollBroadcast();
  startBroadcastStream();
  // Online presence: ping every 60s, refresh count every 60s
  const updateOnlineCount = async () => {
    try {
      await api.ping();
      const { onlineCount } = await api.onlineCount();
      const el = document.getElementById('online-count');
      if (el) el.textContent = onlineCount ?? '–';
    } catch (e) { /* ignore */ }
  };
  updateOnlineCount();
  App.presenceTimer = setInterval(updateOnlineCount, 60000);
  // Gameplay snapshots for GM live view: send current activity every 30s
  const sendSnapshot = async () => {
    try {
      const s = App.state;
      if (!s) return;
      let action = 'idle', detail = '';
      if (App.enemy) {
        action = App.enemy.boss ? 'boss' : 'battle';
        detail = App.enemy.towerFloor ? `Tower Floor ${App.enemy.towerFloor}` :
                 App.enemy.name ? `${App.enemy.name} (Stage ${s.stage || '?'})` : `Stage ${s.stage || '?'}`;
      } else if (s.mode === 'tower') {
        action = 'tower'; detail = `Floor ${s.tower?.floor || '?'}`;
      } else {
        action = 'idle'; detail = `Stage ${s.stage || '?'} · Lv ${s.level || '?'}`;
      }
      await api.snapshot(action, detail);
    } catch (e) { /* ignore */ }
  };
  sendSnapshot();
  App.snapshotTimer = setInterval(sendSnapshot, 30000);
  // Poll for admin commands from owner panel
  const pollCommands = async () => {
    try {
      const r = await fetch('/api/player-commands', { credentials: 'include' });
      if (!r.ok) return;
      const j = await r.json();
      if (!j.ok || !Array.isArray(j.commands)) return;
      for (const c of j.commands) {
        if (c.cmd === 'close-gui') {
          // Close any open modals/popups
          document.querySelectorAll('.modal, .popup, .overlay').forEach(el => el.classList.add('hidden'));
          if (window.UI && UI.closeModal) { try { UI.closeModal(); } catch {} }
        } else if (c.cmd === 'freeze-input') {
          // Freeze input for 10s
          document.body.style.pointerEvents = 'none';
          setTimeout(() => { document.body.style.pointerEvents = ''; }, 10000);
          if (window.UI && UI.toast) UI.toast('❄️ Input frozen by admin (10s)', 'warn');
        } else if (c.cmd === 'admin-notice') {
          const msg = (c.data && c.data.msg) || 'Admin notice';
          if (window.UI && UI.toast) UI.toast('📢 ' + msg, 'info', 8000);
          else alert('📢 Admin: ' + msg);
        }
      }
    } catch {}
  };
  setInterval(pollCommands, 15000);
  pollCommands();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow(true);
    // FPS/battery: pause ambient CSS animations while the tab is hidden.
    // Purely a resource saver — nothing is visible while hidden.
    document.body.classList.toggle('tab-hidden', document.visibilityState === 'hidden');
  });
  window.addEventListener('beforeunload', () => {
    if (App.state) saveNow(true); // guest-aware: local save for guests
  });
  window.addEventListener('pagehide', () => {
    if (App.state) saveNow(true); // guest-aware: local save for guests
  });
}

// ---------------- saving ----------------
let _saving = false;
async function saveNow(beaconOnly = false) {
  if (!App.state || _saving) return;
  // REMASTER: Stamp last-seen for offline progress calculation
  App.state.lastSeenAt = Date.now();
  // Stamp leaderboard "power" (hero attack) so /api/leaderboard can show it.
  try { App.state.power = Math.round(Engine.computeStats(App.state).attack); } catch { /* leave unset */ }
  if (isGuest()) {
    // Guests never touch the server: persist locally only.
    const ok = saveGuest(App.user.username, App.state);
    if (!beaconOnly) UI.setSaveIndicator(ok ? '● saved locally' : '● local save failed', ok);
    return;
  }
  if (beaconOnly) { api.saveStateBeacon(App.state); return; }
  if (App.maintenanceMode) { UI.setSaveIndicator('● paused'); return; } // maintenance: hold saves
  _saving = true;
  UI.setSaveIndicator('… saving');
  try {
    await api.saveState(App.state);
    UI.setSaveIndicator('● saved');
  } catch (e) {
    UI.setSaveIndicator('● save failed', false);
  } finally {
    _saving = false;
  }
}

// ---------------- combat ----------------
function spawnEnemy() {
  const s = App.state;
  // Raid mode spawns scaled waves instead of stage enemies.
  // Tower mode spawns the next tower floor boss.
  if (s.mode === 'raid') {
    App.enemy = Raid.isActive() ? Raid.spawnEnemy(s) : Raid.enter(s);
  } else if (s.mode === 'tower') {
    Engine.ensureTowerState(s);
    const floor = Math.max(1, s.tower.floor + 1);
    App.enemy = Engine.towerEnemyFor(floor, s.stage);
  } else {
    App.enemy = Engine.enemyFor(s.stage, Engine.computeStats(s));
  }
  App.enemyTimer = 0;
  App.heroTimer = 0;
  App.enemySlow = null; // a fresh enemy never inherits the last one's frost slow
  App.companionTimers = {};
  App.healerTimers = {};
  // revive downed companions on a fresh enemy
  for (const c of s.party) if (c.hp <= 0) c.hp = c.maxHp;
  UI.setEnemy(App.enemy);
  // Boss-fight music: Tower floors get escalating battle tracks, other bosses get Dread Sovereign.
  try { if (audioOf(s).combatMusic !== false) Audio.setCombat(!!(App.enemy && App.enemy.boss), App.enemy && App.enemy.towerFloor); } catch {}
  // reset the live damage meter for this fight — but keep the last fight's
  // numbers around so one-tap kills show a real DPS instead of 0.
  if (App.meter) App.lastMeter = meterSnapshot();
  App.meter = { startAt: Date.now(), fighters: {} };
  // zone change toast
  const zone = Engine.zoneFor(s.stage);
  if (App.lastZone && App.lastZone !== zone.name) {
    UI.toast(`${zone.emoji} Entered ${zone.name}`, 'info');
  }
  App.lastZone = zone.name;
  // world change: announce the new world, its tagline, and follow its music
  const world = Engine.worldForStage(s.stage);
  if (App.lastWorld && App.lastWorld !== world.id) {
    UI.toast(`${world.emoji} Entered ${world.name} — ${world.tagline}`, 'info', 6000);
    UI.combatLog(`${world.emoji} Entered ${world.name} — ${world.tagline}`, 'zone');
  }
  App.lastWorld = world.id;
  applyWorldMusic();
  UI.updateHeroPanel(s, Engine.computeStats(s), App);
  if (App.enemy.boss && App.lastBossModalStage !== s.stage) {
    App.lastBossModalStage = s.stage;
    Audio.play('raidboss');
    UI.bossModal(App.enemy);
  }
}

// ---------------- damage meter ----------------
// Session-only per-fighter damage tracking. DPS is computed from a rolling
// 10-second window of cumulative-damage samples.
const METER_WINDOW_MS = 10000;

function meterHit(key, label, dmg) {
  if (!App.meter || !(dmg > 0)) return;
  const now = Date.now();
  let f = App.meter.fighters[key];
  if (!f) f = App.meter.fighters[key] = { label, total: 0, samples: [] };
  f.total += dmg;
  f.samples.push({ t: now, total: f.total });
  const cutoff = now - METER_WINDOW_MS;
  while (f.samples.length > 2 && f.samples[0].t < cutoff) f.samples.shift();
}

// Returns {rows: [{key,label,dps,total,pct}], totalDps} for the meter UI.
function meterSnapshot() {
  const m = App.meter;
  if (!m || !Object.keys(m.fighters).length) {
    // No samples yet (fresh fight, or a one-tap kill that ended before the
    // meter ticked) — show the last fight's DPS instead of an empty 0.
    if (App.lastMeter && App.lastMeter.rows && App.lastMeter.rows.length) {
      return { rows: App.lastMeter.rows, totalDps: App.lastMeter.totalDps, stale: true };
    }
    return { rows: [], totalDps: 0 };
  }
  const now = Date.now();
  const cutoff = now - METER_WINDOW_MS;
  const rows = [];
  let totalDps = 0;
  for (const [key, f] of Object.entries(m.fighters)) {
    const s = f.samples.filter(p => p.t >= cutoff);
    const oldest = s.length ? s[0] : { t: now, total: f.total };
    const newest = s.length ? s[s.length - 1] : { t: now, total: f.total };
    const secs = Math.max(0.5, (newest.t - oldest.t) / 1000);
    const dps = (newest.total - oldest.total) / secs;
    rows.push({ key, label: f.label, dps, total: f.total });
    totalDps += dps;
  }
  rows.sort((a, b) => b.dps - a.dps);
  const top = rows.length ? rows[0].dps : 0;
  for (const r of rows) r.pct = top > 0 ? (r.dps / top) * 100 : 0;
  return { rows, totalDps };
}

function heroStrike(stats, mult = 1) {
  const { dmg, crit } = Engine.playerAttack(stats, App.enemy);
  const buffMult = App.state && Engine.getBuffMult ? Engine.getBuffMult(App.state, 'damage') : 1;
  const final = Math.max(1, Math.round(dmg * mult * buffMult));
  meterHit('hero', (App.user && App.user.username) || 'You', final);
  damageEnemy(final, crit ? 'CRIT ' : '', 'hero');
  // Warriors build rage on every landed strike.
  if (Engine.resourceIdFor(App.state) === 'rage') Engine.gainRage(App.state, Engine.RAGE_PER_STRIKE);
  // lifesteal
  if (stats.lifesteal > 0 && !App.dead) {
    const heal = final * (stats.lifesteal / 100);
    const s = App.state;
    s.hero.hp = Math.min(stats.maxHp, s.hero.hp + heal);
  }
}

function companionStrike(c) {
  const cs = Engine.companionStats(c);
  const { dmg, crit } = Engine.playerAttack(cs, App.enemy);
  const final = Math.max(1, Math.round(dmg * (cs.damageMult || 1)));
  meterHit(c.id, c.name, final);
  if (UI.attackerPulse) UI.attackerPulse(c.id);
  // Track DPS per companion
  c._dmgTotal = (c._dmgTotal || 0) + final;
  c._dmgStart = c._dmgStart || Date.now();
  const secs = Math.max(1, (Date.now() - c._dmgStart) / 1000);
  c._dps = Math.round(c._dmgTotal / secs);
  damageEnemy(final, crit ? 'CRIT ' : '', c.emoji + ' ');
}

// Active pet strikes (every 4s from the combat tick). Hunger-gated: a
// starving pet sits out. Damage never outshines the hero.
function petStrike(stats) {
  if (App.dead || !App.enemy || App.spawnPending) return;
  const dmg = Engine.petStrikeDamage(App.state, stats);
  if (dmg <= 0) return;
  const pets = Engine.activePets(App.state);
  const label = pets.length
    ? pets.map(pt => { const s2 = Engine.petSpeciesOf(pt); return (s2 ? s2.emoji : '🐾') + ' ' + (s2 ? s2.name : 'Pet'); }).join(' + ')
    : '🐾 Pet';
  meterHit('pet', label, dmg);
  damageEnemy(dmg, '', pets.map(pt => { const s2 = Engine.petSpeciesOf(pt); return s2 ? s2.emoji : '🐾'; }).join('') + ' ');
}

function damageEnemy(dmg, prefix, sourceLabel) {
  const enemy = App.enemy;
  if (!enemy || App.dead || App.spawnPending) return;
  // NaN guard: if damage is invalid, fall back to a sane default.
  if (!Number.isFinite(dmg) || dmg < 0) {
    const s = App.state;
    dmg = (s && Engine.computeStats(s).dps) || 1;
  }
  dmg = Math.max(1, Math.round(dmg));
  // Tower hazard: Damage Reflect — 20% of damage bounces back to the hero.
  if (enemy.hazard === 'reflect' && dmg > 0) {
    const s = App.state;
    const reflectDmg = Math.max(1, Math.round(dmg * 0.2));
    s.hero.hp -= reflectDmg;
    UI.floatText(`-${formatNum(reflectDmg)}`, 'hurt');
    if (s.hero.hp <= 0) { s.hero.hp = 0; onDefeat(); return; }
  }
  enemy.hp = Math.max(0, enemy.hp - dmg);
  // Persist world boss HP
  if (enemy.isWorldBoss && App.state && App.state.worldBoss) {
    App.state.worldBoss.bossHp = enemy.hp;
  }
  const isCrit = String(prefix).includes('CRIT');
  UI.enemyHitFlash(isCrit); // red flash on crits
  // Instant HP bar update (no 250ms tick lag)
  if (UI.updateEnemy) UI.updateEnemy(enemy);
  // Screen shake on crits
  if (isCrit && UI.screenShake) UI.screenShake();
  UI.floatText(`${prefix}${formatNum(dmg)}`, isCrit ? 'crit' : 'dmg', dmg);
  if (enemy.hp <= 0) onKillEnemy();
}

// Spawns the next enemy, delaying briefly when the modern death animation
// is playing so the fade-out stays visible. App.spawnPending guards the
// damage pipeline against double-kills during the window.
function spawnNextEnemy() {
  if (UI.enemyDeathFade()) {
    App.spawnPending = true;
    setTimeout(() => {
      App.spawnPending = false;
      if (!App.dead) spawnEnemy();
    }, 300);
  } else {
    spawnEnemy();
  }
}

function onKillEnemy() {
  if (App.spawnPending) return; // already processing a kill
  const s = App.state;
  const enemy = App.enemy;

  // World Boss kill — special rewards
  if (enemy.isWorldBoss) {
    const rewards = Engine.worldBossRewards(s.level || 1);
    Engine.gainXp(s, rewards.xp);
    Engine.addGold(s, rewards.gold);
    s.materials = s.materials || {};
    s.materials.pumpkin_shard = (s.materials.pumpkin_shard || 0) + rewards.pumpkin_shards;
    s.stats = s.stats || {};
    s.stats.demonKingKills = (s.stats.demonKingKills || 0) + 1;
    s.worldBoss.active = false;
    s.worldBoss.nextSpawnAt = Date.now() + Engine.WORLD_BOSS.respawnMs;
    s.worldBoss.bossHp = null;
    UI.toast(`😈 DEMON KING SLAIN! +${rewards.xp.toLocaleString()} XP, +${rewards.gold.toLocaleString()}g, +${rewards.pumpkin_shards} shards!`, 'success');
    // Spawn next normal enemy
    App.enemy = Engine.enemyFor(s.stage, Engine.computeStats(s));
    UI.renderBattle(s);
    UI.updateHUD(s, App.user);
    saveNow();
    return;
  }

  const stage = enemy.stage;
  const stats = Engine.computeStats(s);

  // Raid: each kill advances the wave instead of the stage, with a gold bonus.
  const inRaid = Raid.isActive();
  const raidLoot = inRaid ? Raid.onKill(s) : null;

  const pb = partyBonus();
  let gold = Engine.goldForKill(stage, stats.goldBonus + (stats.talentGoldPct || 0) + pb.goldPct);
  gold = Math.floor(gold * Engine.eventGoldMult());
  // Manual 2x event multiplier (staff toggle). Auto 2x during Halloween.
  const halloween2x = Engine.isEventActive && Engine.isEventActive('HALLOWEEN') ? 2 : 1;
  gold = Math.floor(gold * Math.max(s.goldMultiplier || 1.0, halloween2x));
  if (raidLoot) gold = Math.floor(gold * raidLoot.goldMult);
  const addedGold = Engine.addGold(s, gold);
  Audio.play('coin');
  const cappedNote = addedGold < gold ? ' · gold cap' : '';
  s.stats.kills += 1;
  // Kill streak: +1 per kill, boosts loot drop chance; resets on defeat.
  s.streak = (s.streak || 0) + 1;
  // Potion drops: 8% chance, independent of all other loot.
  if (Math.random() < Engine.POTION_DROP_CHANCE) {
    const kind = Engine.grantPotionDrop(s);
    if (kind) UI.combatLog(`🧪 A ${kind === 'health' ? 'health' : 'resource'} potion dropped!`, 'loot');
  }
  const streakBonus = Engine.streakDropBonus(s.streak);
  // Radiant enemies: guaranteed loot + triple gold.
  const radiant = !!enemy.radiant;
  if (radiant) {
    const rGold = Math.floor(gold * 2);
    Engine.addGold(s, rGold);
    UI.combatLog(`🌟 Radiant ${enemy.name} slain! Bonus +${formatNum(rGold)} gold!`, 'loot');
  }
  const isDungeonBoss = enemy.boss && s.mode === 'dungeon';
  const isRaidBoss = inRaid && raidLoot && raidLoot.boss;
  const isTowerBoss = s.mode === 'tower' && enemy.towerFloor;
  if (enemy.boss) {
    s.bossesKilled += 1;
    s.stars += 1; // bosses grant a star
    // Halloween event: Tower bosses drop 1-3 pumpkin shards (Oct 3-31).
    if (Engine.isEventActive('HALLOWEEN') && isTowerBoss && enemy.towerFloor % 10 === 0) {
      const shards = 1 + Math.floor(Math.random() * 3);
      s.materials = s.materials || {};
      s.materials.pumpkin_shard = (s.materials.pumpkin_shard || 0) + shards;
      UI.combatLog(`🎃 +${shards} Jack-o'-Lantern Shard${shards > 1 ? 's' : ''}!`, 'loot');
    }
    UI.combatLog(`👹 Boss slain! +${formatNum(addedGold)} gold${cappedNote}, +1 ⭐`, 'boss');
    UI.toast(`Boss slain! +${formatNum(addedGold)} gold${cappedNote}, +1 ⭐`, 'success');
  }
  // Tower progression: clearing a floor advances the tower, milestones grant rewards.
  if (isTowerBoss) {
    Engine.ensureTowerState(s);
    const cleared = enemy.towerFloor;
    if (cleared > s.tower.floor) {
      s.tower.floor = cleared;
      UI.combatLog(`🗼 Tower Floor ${cleared} cleared!`, 'boss');
      const milestone = Engine.towerMilestoneFor(cleared);
      if (milestone) {
        // Title: unlock directly by ID
        if (!s.titlesUnlocked) s.titlesUnlocked = [];
        if (!s.titlesUnlocked.includes(milestone.titleId)) {
          s.titlesUnlocked.push(milestone.titleId);
        }
        // Mythic pet egg
        Engine.ensurePets(s).eggs += 1;
        // Divine gear piece (the "Divine Blueprint" reward as real loot)
        const divineItem = Engine.makeLootItem(Math.max(1, s.stage || 1), 'divine',
          Engine.SLOTS[Math.floor(Math.random() * Engine.SLOTS.length)], s.playerClass);
        if (divineItem) s.inventory.push(divineItem);
        UI.toast(`🏆 Milestone! Floor ${cleared}: ${milestone.titleName} + Divine Gear + Mythic Egg!`, 'success');
        UI.combatLog(`🏆 Milestone rewards: ${milestone.titleName} title, Divine ${divineItem ? divineItem.name : 'gear'}, Mythic Pet Egg!`, 'loot');
      }
    }
  }
  const killXp = Math.floor(Engine.xpForKill(stage) * Engine.eventXpMult());
  const xpRes = Engine.gainXp(s, killXp, Date.now(), pb.xpPct);
  // The active pet earns 15% of the kill's XP.
  const petXpRes = Engine.gainPetXp(s, Math.floor(killXp * 0.15));
  for (const g of petXpRes.gains) {
    for (const lv of g.levels) {
      UI.notify('level', `🐾 ${g.name} reached level ${lv}!`, 'success');
      UI.combatLog(`🐾 ${g.name} leveled up to ${lv}!`, 'level');
    }
  }
  const loot = Engine.rollLoot(stage, enemy.boss, raidLoot ? raidLoot.lootTier : null,
    { bonusChance: streakBonus, guaranteed: radiant, classId: s.playerClass });
  if (loot) {
    // Auto-sell: convert loot straight to gold when the toggle is on.
    // Set pieces and unsellables are always kept.
    if (s.settings && s.settings.autoSell && !loot.set && !loot.unsellable) {
      const gold = Math.max(1, Math.round(loot.value || 1));
      Engine.addGold(s, gold);
      UI.notify('loot', `💰 Auto-sold ${loot.name} (+${formatNum(gold)} gold)`, 'loot');
      UI.combatLog(`💰 Auto-sold ${loot.name} (${loot.rarity})`, 'loot');
    } else {
      s.inventory.push(loot);
      const tag = radiant ? '🌟 Radiant loot' : '🎒 Loot';
      UI.notify('loot', `${tag}: ${loot.name}`, 'loot');
      UI.combatLog(`${tag} ${loot.name} (${loot.rarity})`, 'loot');
    }
    if (UI.activeTab === 'gear') UI.renderGear(s);
  }
  // Earnable set pieces (drop sources documented on Engine.PLAYER_SETS).
  const setDrop = Engine.rollSetDrop(stage, { boss: enemy.boss, dungeonBoss: isDungeonBoss, raidBoss: isRaidBoss });
  if (setDrop) {
    s.inventory.push(setDrop);
    UI.notify('loot', `🔥 Set piece: ${setDrop.name}!`, 'loot');
    UI.combatLog(`🔥 Looted ${setDrop.name} (${setDrop.setName})`, 'loot');
    if (UI.activeTab === 'gear') UI.renderGear(s);
  }
  // Pet eggs from bosses (drop sources documented on Engine.rollPetEgg).
  if (Engine.rollPetEgg({ boss: enemy.boss, dungeonBoss: isDungeonBoss, raidBoss: isRaidBoss })) {
    Engine.ensurePets(s).eggs += 1;
    UI.notify('loot', '🥚 A pet egg dropped! Hatch it in 🐾 Pets.', 'loot');
    UI.combatLog('🥚 A pet egg dropped!', 'loot');
    if (UI.activeTab === 'pets') UI.renderPetsTab(s);
  }
  if (xpRes.levels.length) {
    UI.levelUpModal(xpRes.levels);
    UI.combatLog(`⬆️ Level ${xpRes.levels[xpRes.levels.length - 1]}!`, 'level');
    const mp = xpRes.levels.filter(l => l % 10 === 0).length;
    if (mp > 0) {
      UI.notify('level', `🧠 +${mp} Mastery point${mp > 1 ? 's' : ''}! Spend in Settings → Mastery.`, 'success');
      if (UI.activeTab === 'settings') UI.renderMore(s, App.user);
    }
  }
  announceSkillUnlocks(xpRes.skills);
  checkAch();

  if (inRaid) {
    // Raid: stay on the same stage, spawn the next wave.
    UI.combatLog(`🌀 Wave ${raidLoot.wave} cleared!${raidLoot.boss ? ' Boss down!' : ''}`, raidLoot.boss ? 'boss' : 'info');
    spawnNextEnemy();
    UI.updateHUD(s, App.user);
    return;
  }
  s.stage += 1;
  spawnNextEnemy();
  UI.updateHUD(s, App.user);
  // rebirth unlock may have appeared
  if (s.level >= Engine.MAX_LEVEL) UI.renderBattle(s);
}

function enemyStrikeTick(stats) {
  const s = App.state;
  const enemy = App.enemy;
  if (!enemy || App.dead || App.spawnPending) return;
  // pick target: hero, or random alive fighter in dungeon mode
  let target = { kind: 'hero' };
  if (s.mode === 'dungeon') {
    const alive = s.party.filter(c => c.hp > 0);
    const pool = ['hero', ...alive.map(c => c.id)];
    const pickId = pool[Math.floor(Math.random() * pool.length)];
    target = pickId === 'hero' ? { kind: 'hero' } : { kind: 'comp', c: s.party.find(c => c.id === pickId) };
  }
  const tStats = target.kind === 'hero' ? stats : Engine.companionStats(target.c);
  const res = Engine.enemyStrike(tStats, enemy.attack);
  const tName = target.kind === 'hero' ? 'You' : target.c.name;

  if (res.dodged) {
    UI.floatText('DODGE', 'dodge');
    return;
  }
  if (res.parried) {
    UI.floatText('PARRY', 'parry');
    UI.combatLog(`🛡️ ${tName} parried and countered!`);
    meterHit('hero', (App.user && App.user.username) || 'You', res.counter);
    damageEnemy(res.counter, '', 'counter');
    return;
  }
  if (res.dmg <= 0) return;
  // Tower hazard: Vampiric Heal — boss heals 15% of damage dealt.
  if (enemy.hazard === 'vampiric') {
    const heal = Math.round(res.dmg * 0.15);
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + heal);
  }
  // Role-based toughness: companions take scaled damage (tanks shrug off
  // far more than DPS). Applied after dodge/parry, before HP subtraction.
  let finalDmg = res.dmg;
  if (target.kind !== 'hero' && tStats.damageTakenMult) {
    finalDmg = Math.max(1, Math.round(res.dmg * tStats.damageTakenMult));
  }
  if (target.kind === 'hero') {
    // GM buffs: immunity blocks all, shield absorbs next
    let heroDmg = finalDmg;
    if (App.state && Engine.hasImmunity(App.state)) {
      UI.floatText('IMMUNE', 'dodge');
      return;
    }
    if (App.state) heroDmg = Engine.absorbWithShield(App.state, heroDmg);
    // Shield Block absorbs first, then damage-taken buffs (challenging shout).
    heroDmg = Engine.absorbShield(s, heroDmg);
    heroDmg = Math.max(0, Math.round(heroDmg * Engine.damageTakenMult(s)));
    if (Engine.resourceIdFor(s) === 'rage') Engine.gainRage(s, Engine.RAGE_PER_HIT_TAKEN);
    s.hero.hp -= heroDmg;
    UI.floatText(`-${formatNum(heroDmg)}`, 'hurt');
    if (s.hero.hp <= 0) { s.hero.hp = 0; onDefeat(); }
  } else {
    target.c.hp -= finalDmg;
    UI.combatLog(`💔 ${target.c.name} took ${formatNum(finalDmg)}.`);
    if (target.c.hp <= 0) {
      target.c.hp = 0;
      UI.notify('death', `${target.c.emoji} ${target.c.name} is down!`, 'error');
    }
  }
}

function onDefeat() {
  const s = App.state;
  App.dead = true;
  App.respawnAt = Date.now() + RESPAWN_MS;
  // Death breaks the kill streak.
  if (s.streak >= 25) UI.toast(`💔 Kill streak of ${s.streak} ended!`, 'info');
  s.streak = 0;
  const lost = Math.floor(s.gold * 0.02);
  if (!s.infGold) s.gold -= lost; // infinite-gold perk: death takes nothing
  // Raid: death ends the run (loot kept); drop back to clicker mode.
  if (Raid.isActive()) {
    const res = Raid.onDeath(s);
    Raid.exit();
    s.mode = 'clicker';
    UI.setMode('clicker');
    UI.setDead(true);
    UI.combatLog(`🌀 Raid run ended at wave ${res.wavesCleared} — best ${res.best}. Lost ${formatNum(lost)} gold. Reviving…`, 'death');
    UI.toast(`🌀 Raid ended at wave ${res.wavesCleared} (best ${res.best})!`, 'info');
    saveNow();
    return;
  }
  // Mercy rule: dying 3x in a row to the same boss retreats you 5 stages,
  // so a wall becomes a farming trip instead of an endless death loop.
  if (App.enemy && App.enemy.boss) {
    if (App.lastDeathStage === s.stage) App.deathStreak += 1;
    else { App.lastDeathStage = s.stage; App.deathStreak = 1; }
    if (App.deathStreak >= 3) {
      App.deathStreak = 0;
      s.stage = Math.max(1, s.stage - 5);
      UI.toast(`💨 Overwhelmed! You retreat to stage ${s.stage} to grow stronger.`, 'info');
      UI.combatLog(`💨 Overwhelmed by the boss — retreated to stage ${s.stage}.`, 'death');
      saveNow();
    }
  } else {
    App.deathStreak = 0;
  }
  UI.setDead(true);
  UI.combatLog(`💀 You fell! Lost ${formatNum(lost)} gold. Reviving…`, 'death');
  UI.notify('death', `You fell! −${formatNum(lost)} gold. Reviving…`, 'error');
}

function respawn() {
  const s = App.state;
  const stats = Engine.computeStats(s);
  App.dead = false;
  s.hero.hp = stats.maxHp;
  for (const c of s.party) c.hp = c.maxHp;
  UI.setDead(false);
  spawnEnemy();
  UI.updateHUD(s, App.user);
}

// ---------------- pause-while-browsing ----------------
// Real-time combat must never punish the player for reading a menu.
// The world freezes whenever the player is NOT actively watching the
// battle tab: browsing the gear shop / settings / party / etc., any
// full-screen modal (boss intro, changelog, confirms), the GM console,
// or resting at the Shadowed Hearth (inn tab — its own branch in tick()
// keeps the 2%/s rest-heal running while everything else stays frozen).
function computePaused() {
  if (!App.started) return false;
  const appView = UI.el('view-app');
  if (!appView || appView.classList.contains('hidden')) return true;
  if (UI.anyModalOpen()) return true;
  return UI.activeTab !== 'battle';
}

// Runs at the top of every tick; acts only on transitions so the pill and
// wall-clock timers stay in sync. While paused, tick() returns before ANY
// world system advances: no play-time, no regen, no mine trickle, no
// hero/companion/pet strikes, no hunger decay, no enemy attacks, and the
// death-respawn timer holds still.
function updatePauseState() {
  let paused = false;
  try {
    paused = computePaused();
  } catch { paused = App._paused; }
  if (paused === App._paused) return;
  const now = Date.now();
  if (paused) {
    App._pauseStartedAt = now;
  } else if (App._pauseStartedAt) {
    // Resume: shift wall-clock timers forward by the frozen duration so a
    // pause neither grants nor steals time — frenzy, skill cooldowns, the
    // respawn timer, and the tap-combo window all freeze equally.
    const d = now - App._pauseStartedAt;
    if (d > 0) {
      if (App.frenzyUntil > App._pauseStartedAt) App.frenzyUntil += d;
      for (const k of Object.keys(App.skillCDs || {})) {
        if (App.skillCDs[k] > App._pauseStartedAt) App.skillCDs[k] += d;
      }
      if (App.respawnAt > App._pauseStartedAt) App.respawnAt += d;
      if (App.lastTapAt) App.lastTapAt += d;
    }
    App._pauseStartedAt = 0;
  }
  App._paused = paused;
  try { UI.setPaused(paused); } catch { /* pill is cosmetic */ }
}

// ---------------- main tick ----------------
function tick() {
  const s = App.state;
  if (!s || !App.enemy) return;
  updatePauseState();

  // World boss timeout check
  checkWorldBossTimeout();

  // Browsing a menu (or a modal on top of battle): the world is frozen —
  // nothing below advances. The inn branch above is the one exception:
  // the Hearth pauses combat but keeps its rest-heal.
  if (App._paused && !App.inInn) return;

  const dt = TICK_MS / 1000;
  s.stats.playTimeSec += dt;

  if (App.dead) {
    if (Date.now() >= App.respawnAt) respawn();
    return;
  }

  // Inn (AFK safe zone): combat is fully suspended — no damage in or out,
  // no enemy progression — and the hero regenerates 2% max HP per second.
  if (App.inInn) {
    const stats = Engine.computeStats(s);
    s.hero.hp = Engine.innRegen(s.hero.hp, stats.maxHp, dt);
    UI.renderInn(s, stats);
    UI.updateHUD(s, App.user);
    return;
  }

  const stats = Engine.computeStats(s);

  // Mining trickle: a slow passive ore drip while the game runs (~1/30s).
  App.mineTrickle = (App.mineTrickle || 0) + dt;
  if (App.mineTrickle >= 30) {
    App.mineTrickle = 0;
    Engine.trickleOre(s);
    if (UI.activeTab === 'mine') UI.renderMine(s);
  }

  // regen
  if (stats.regen > 0 && s.hero.hp < stats.maxHp) {
    s.hero.hp = Math.min(stats.maxHp, s.hero.hp + stats.regen * dt);
  }
  // Class resources: focus/mana/energy regen via the generic ticker
  // (rage has no passive regen — it builds on strikes and hits taken).
  Engine.tickResources(s, dt);
  if (App.dead || App.inInn || !App.enemy) Engine.decayRage(s, dt);
  for (const c of s.party) {
    if (c.hp > 0 && c.hp < c.maxHp && c.regen > 0) c.hp = Math.min(c.maxHp, c.hp + c.regen * dt);
  }
  // Pet HP regen: active pets recover HP over time.
  try {
    const pets = Engine.activePets(s);
    const pStats = Engine.computeStats(s);
    for (const pet of pets) {
      const maxHp = Engine.petMaxHp(pet, pStats.maxHp);
      if (pet.hp > 0 && pet.hp < maxHp) {
        const regen = (pet.hpRegen || maxHp * 0.01) * dt; // 1% max HP/sec default
        pet.hp = Math.min(maxHp, pet.hp + regen);
      }
    }
    if (UI.updatePetStats) UI.updatePetStats(s);
  } catch (e) { /* pet regen must never break the tick */ }

  // hero attacks: full rate in auto/dungeon, 35% idle rate in clicker mode
  // (taps remain the main damage there, boosted by combo + frenzy).
  {
    App.heroTimer += dt * (s.mode === 'clicker' ? 0.35 : 1);
    const iv = 1 / Math.max(0.2, stats.attackSpeed);
    let guard = 0;
    while (App.heroTimer >= iv && guard++ < 10) {
      App.heroTimer -= iv;
      heroStrike(stats);
      if (App.dead || !App.enemy) break;
    }
  }

  // companions attack in dungeon mode; healer-role allies also mend the PLAYER
  if (s.mode === 'dungeon') {
    for (const c of s.party) {
      if (c.hp <= 0 || App.dead) continue;
      App.companionTimers[c.id] = (App.companionTimers[c.id] || 0) + dt;
      const iv = 1 / 1.2;
      let guard = 0;
      while (App.companionTimers[c.id] >= iv && guard++ < 10) {
        App.companionTimers[c.id] -= iv;
        companionStrike(c);
        if (App.dead || !App.enemy) break;
      }
      // Healer mend: every HEALER_MEND_SEC, restore player HP (tick owns the
      // cooldown; Engine.applyHealerMend does the math).
      const roleKind = c.roleKind || Engine.companionRole(c);
      if (roleKind === 'healer' && s.hero.hp < stats.maxHp) {
        App.healerTimers[c.id] = (App.healerTimers[c.id] || 0) + dt;
        if (App.healerTimers[c.id] >= Engine.HEALER_MEND_SEC) {
          App.healerTimers[c.id] = 0;
          const healed = Engine.applyHealerMend(s, c, stats.maxHp);
          if (healed > 0) {
            UI.floatText(`+${formatNum(healed)}`, 'heal');
            UI.combatLog(`💚 ${c.name} mended you for ${formatNum(healed)} HP.`);
            // Track HPS per companion
            c._healTotal = (c._healTotal || 0) + healed;
            c._healStart = c._healStart || Date.now();
            const hsecs = Math.max(1, (Date.now() - c._healStart) / 1000);
            c._healing = Math.round(c._healTotal / hsecs);
          }
        }
      }
    }
  }

  // The active pet strikes every 4s in every combat mode (hunger-gated).
  App.petTimer = (App.petTimer || 0) + dt;
  if (App.petTimer >= Engine.PET_STRIKE_SEC) {
    App.petTimer = 0;
    petStrike(stats);
  }

  // Pet hunger decays with play time (-1 per 5 min).
  App.petHungerAcc = (App.petHungerAcc || 0) + dt;
  if (App.petHungerAcc >= Engine.PET_HUNGER_DECAY_SEC) {
    App.petHungerAcc = 0;
    const result = Engine.decayPetHunger(s, 1);
    // Notify on bond tier changes (so HP jumps aren't a mystery)
    if (result && result.changes) {
      for (const ch of result.changes) {
        const petName = (Engine.petSpeciesOf(ch.pet) || {}).name || 'Pet';
        if (ch.newTier < ch.oldTier) {
          UI.toast(`🍖 ${petName} is getting hungry! Bond bonus weakened.`, 'warning');
        } else if (ch.newTier > ch.oldTier) {
          UI.toast(`🍖 ${petName} is well-fed! Bond bonus restored.`, 'success');
        }
      }
    }
  }

  // Enemy damage-over-time (traps, blizzard).
  tickEnemyFx(stats);

  // enemy counter-attacks (slowed by frost effects)
  App.enemyTimer += dt;
  const slowPct = App.enemySlow && Date.now() < App.enemySlow.until ? App.enemySlow.pct : 0;
  let atkInterval = ENEMY_ATTACK_S / (1 - Math.min(90, slowPct) / 100);
  // Tower hazard: Enrage Speed — boss attacks 40% faster.
  if (App.enemy && App.enemy.hazard === 'enrage') atkInterval *= 0.6;
  if (App.enemyTimer >= atkInterval) {
    App.enemyTimer = 0;
    if (!App.dead) enemyStrikeTick(stats);
  }

  UI.updateBattle(s, stats, { enemy: App.enemy, user: App.user, skillCDs: App.skillCDs, potionCD: s.potionReadyAt || 0 });
  // keep chips / hero panel fresh at low frequency
  if (!tick._n) tick._n = 0;
  if (++tick._n % 8 === 0) {
    UI.updateHeroPanel(s, stats, App);
    UI.refreshPartyBars(s);
  }
  // live damage meter, every 1s
  if (tick._n % 4 === 0) UI.renderMeter(meterSnapshot());
}

// ---------------- player actions ----------------
function doTap() {
  const s = App.state;
  if (!s || App.dead || App._paused || s.mode !== 'clicker') return;
  const now = Date.now();
  // Combo: taps within the combo window keep it alive.
  if (now - App.lastTapAt < Engine.COMBO_WINDOW_MS) App.tapCombo += 1;
  else App.tapCombo = 1;
  App.lastTapAt = now;
  if (App.tapCombo > (s.stats.maxCombo || 0)) s.stats.maxCombo = App.tapCombo;
  if (App.tapCombo === Engine.FRENZY_COMBO) {
    App.frenzyUntil = now + Engine.FRENZY_MS;
    UI.toast('⚡ FRENZY! Double tap damage for 10s!', 'success');
  }
  const frenzy = now < App.frenzyUntil;
  s.stats.taps += 1;
  heroStrike(Engine.computeStats(s), Engine.tapDamageMult(s, App.tapCombo, frenzy));
  UI.updateCombo(App.tapCombo, frenzy, App.frenzyUntil - now);
  UI.tapFeedback();
  checkAch();
}

// Unlock check helper: toasts + logs newly earned achievements and titles.
function checkAch() {
  const s = App.state;
  if (!s) return;
  const fresh = Engine.checkAchievements(s);
  for (const a of fresh) {
    UI.toast(`🏆 ${a.name}! +${a.stars} ⭐`, 'success');
    UI.combatLog(`🏆 Achievement: ${a.name} (+${a.stars} ⭐)`, 'level');
  }
  const freshTitles = Engine.checkTitles(s, App.user);
  for (const t of freshTitles) {
    UI.titleToast(t.name);
    UI.combatLog(`👑 Title unlocked: ${t.name}`, 'level');
  }
  if (fresh.length || freshTitles.length) {
    Audio.play('claim');
    if (UI.activeTab === 'settings') UI.renderMore(s, App.user);
    UI.updateHUD(s, App.user);
    saveNow();
  }
}

// Toast newly unlocked active skills and refresh the battle skill row.
function announceSkillUnlocks(skillIds) {
  if (!skillIds || !skillIds.length) return;
  for (const id of skillIds) {
    const def = Engine.SKILLS[id] || Engine.spellById(id);
    if (!def) continue;
    UI.notify('level', `${def.emoji} New skill unlocked: ${def.name}! (${def.desc})`, 'success');
    UI.combatLog(`${def.emoji} Skill unlocked: ${def.name} — ${def.desc}`, 'level');
  }
  if (UI.activeTab === 'battle') UI.renderSkillRow(App.state);
}

function doClaimQuest(period, id) {
  const s = App.state;
  if (!s) return;
  const res = Engine.claimQuest(s, period, id);
  if (!res || !res.ok) return;
  UI.notify('quest', `📜 Quest complete! +💰${formatNum(res.rewards.gold)} +⭐${res.rewards.stars} +✨${formatNum(res.rewards.xp)} XP`, 'success');
  UI.renderQuests(s);
  UI.updateHUD(s, App.user);
  if (res.levels && res.levels.length) UI.levelUpModal(res.levels);
  announceSkillUnlocks(res.skills);
  saveNow();
}

// Timestamp-based quest reset check (UTC day / ISO week, matching the keys
// Engine.ensureQuests rolls on). Compares keys before/after so the first-ever
// init stays silent and only a real rollover notifies. No save-format change:
// it reuses the existing quests.dailyKey / quests.weeklyKey fields.
function checkQuestReset() {
  const s = App.state;
  if (!s || typeof s !== 'object') return;
  const q0 = (s.quests && typeof s.quests === 'object') ? s.quests : {};
  const d0 = q0.dailyKey, w0 = q0.weeklyKey;
  Engine.ensureQuests(s); // safe to call often; re-rolls only on key change
  const q1 = s.quests || {};
  const dailyRolled = d0 && d0 !== q1.dailyKey;
  const weeklyRolled = w0 && w0 !== q1.weeklyKey;
  if (!dailyRolled && !weeklyRolled) return;
  if (dailyRolled) UI.notify('quest', '☀️ A new day dawns — fresh daily quests await!', 'success');
  if (weeklyRolled) UI.notify('quest', '📅 A new week begins — fresh weekly quests await!', 'success');
  if (UI.activeTab === 'quests') { try { UI.renderQuests(s); } catch { /* ignore */ } }
  UI.updateHUD(s, App.user);
  saveNow();
}

function doEnchant(id) {
  const s = App.state;
  if (!s) return;
  const item = (s.inventory || []).find((i) => i.id === id);
  if (!item) return;
  const lvl = Engine.enchantLevel(item);
  if (lvl >= Engine.ENCHANT_MAX) return;
  const cost = Engine.enchantCost(item);
  if ((s.gold || 0) < cost) {
    UI.toast('Not enough gold to enchant.', 'error');
    return;
  }
  s.gold -= cost;
  item.enchant = lvl + 1;
  UI.toast(`⬆️ ${item.name} is now +${item.enchant}! Stats ×${(1 + Engine.ENCHANT_PCT * item.enchant).toFixed(2)}`, 'success');
  UI.renderGear(s);
  UI.updateHUD(s, App.user);
  saveNow();
}

function useSkill(id) {
  const s = App.state;
  const def = Engine.SKILLS[id];
  if (!s || App.dead || App._paused || !def || !(s.skills || []).includes(id)) return;
  const now = Date.now();
  if (now < (App.skillCDs[id] || 0)) return;
  App.skillCDs[id] = now + def.cdMs;
  s.stats.taps += 1;
  // Skill mastery: track the cast, apply +2% effectiveness per mastery level.
  const mast = Engine.recordSkillUse(s, id) || { level: 0, leveledUp: false };
  const mMult = 1 + mast.level * Engine.MASTERY_PCT_PER_LEVEL;
  if (mast.leveledUp) {
    UI.toast(`🎯 ${def.name} Mastery ${mast.level}! +${Math.round(mast.level * Engine.MASTERY_PCT_PER_LEVEL * 100)}% effectiveness`, 'success');
  }
  const stats = Engine.computeStats(s);
  if (id === 'heal') {
    const amount = Math.round(stats.maxHp * (def.healPct / 100) * mMult);
    s.hero.hp = Math.min(stats.maxHp, s.hero.hp + amount);
    UI.floatText(`+${formatNum(amount)}`, 'heal');
    UI.combatLog(`💚 Heal restored ${formatNum(amount)} HP.`, 'heal');
  } else {
    let mult = (def.mult || 1) * mMult;
    if (id === 'execute' && App.enemy && App.enemy.maxHp > 0) {
      const frac = App.enemy.hp / App.enemy.maxHp;
      mult = frac < def.threshold ? def.mult : def.executeMult;
      UI.combatLog(frac < def.threshold
        ? `⚔️ Execute! ${def.mult}× damage on the weakened foe.`
        : `⚔️ Execute glanced (${def.executeMult}×) — target above ${Math.round(def.threshold * 100)}% HP.`, 'skill');
    }
    UI.floatText(def.name.toUpperCase(), 'skill');
    heroStrike(stats, mult);
  }
}

// Class spellbook casting. Rogues/necromancers/berserkers still use
// useSkill() until their spellbooks are designed.
function useSpell(id) {
  const s = App.state;
  const def = Engine.spellById(id);
  if (!s || App.dead || App._paused || !def || def.classId !== s.playerClass) return;
  // Tower hazard: Void Silence — spells cannot be cast.
  if (App.enemy && App.enemy.hazard === 'silence') {
    UI.toast('🔇 Void Silence! Your spells are sealed.', 'warn');
    return;
  }
  if (!Engine.unlockedSpells(s).includes(id)) return;
  const now = Date.now();
  if (now < (App.skillCDs[id] || 0)) { UI.toast('Still on cooldown.', 'warn'); return; }
  const resId = Engine.resourceIdFor(s);
  const cost = def.cost || 0;
  if (cost > 0 && (s[resId] || 0) < cost) {
    UI.toast(`Not enough ${Engine.resDef(resId).name} — ${Math.floor(s[resId] || 0)}/${cost}.`, 'warn');
    return;
  }
  if (cost > 0) Engine.spendRes(s, resId, cost);
  if (def.gain) Engine.gainRes(s, resId, def.gain);
  App.skillCDs[id] = now + def.cdMs;
  s.stats.taps += 1;
  // Mastery (kept): same track as skills, keyed by spell id.
  const mast = Engine.recordSkillUse(s, id) || { level: 0, leveledUp: false };
  const mMult = 1 + mast.level * Engine.MASTERY_PCT_PER_LEVEL;
  if (mast.leveledUp) {
    UI.toast(`🎯 ${def.name} Mastery ${mast.level}! +${Math.round(mast.level * Engine.MASTERY_PCT_PER_LEVEL * 100)}% effectiveness`, 'success');
  }
  const stats = Engine.applyBuffs(Engine.computeStats(s), s);
  const fx = def.effect;
  UI.floatText(def.name.toUpperCase(), 'skill');
  switch (fx.kind) {
    case 'strike':
      heroStrike(stats, fx.mult * mMult);
      break;
    case 'strikeInt':
      heroStrike(stats, fx.mult * mMult);
      App.enemyTimer = Math.max(0, App.enemyTimer - (fx.interruptSec || 0));
      UI.combatLog(`👊 Pummel interrupts the enemy's next attack!`, 'skill');
      break;
    case 'execute': {
      const healthy = App.enemy && App.enemy.maxHp > 0 && App.enemy.hp / App.enemy.maxHp >= fx.threshold;
      heroStrike(stats, (healthy ? fx.weakMult : fx.mult) * mMult);
      if (!healthy) UI.combatLog(`⚔️ Execute! ${fx.mult}× damage on the weakened foe.`, 'skill');
      break;
    }
    case 'heal': {
      const amount = Math.round(stats.maxHp * (fx.healPct / 100) * mMult);
      s.hero.hp = Math.min(stats.maxHp, s.hero.hp + amount);
      UI.floatText(`+${formatNum(amount)}`, 'heal');
      break;
    }
    case 'mendPet': {
      // Pets have no HP — mending restores hunger and inspires them.
      const p = Engine.ensurePets(s);
      for (const uid of [p.activeUid, p.secondUid]) {
        const pet = (p.collection || []).find(x => x.uid === uid);
        if (pet) pet.hunger = 100;
      }
      if (fx.petDmgPct) Engine.addBuff(s, 'petDmgPct', fx.petDmgPct, fx.sec);
      UI.floatText('MENDED', 'heal');
      UI.combatLog(`💚 Mend Pet! Pets restored and inspired (+${fx.petDmgPct || 0}% damage).`, 'heal');
      break;
    }
    case 'petStrike': {
      const dmg = Math.max(1, Math.round(Engine.petStrikeDamage(s, stats) * fx.mult * mMult));
      meterHit('pet', 'Pet', dmg);
      damageEnemy(dmg, '', '🐾 ');
      UI.combatLog(`🐺 Kill Command! Your pet strikes for ${formatNum(dmg)}.`, 'skill');
      // Apply bleed debuff if specified
      if (App.enemy && fx.debuffKind) {
        const dotValue = Math.round(stats.attack * (fx.debuffMult || 0.25));
        Engine.addDebuff(App.enemy, fx.debuffKind, dotValue, fx.debuffSec || 10);
        const def = Engine.DEBUFF_DEFS[fx.debuffKind];
        UI.combatLog(`${def.icon} ${def.name} applied to enemy!`, 'skill');
        if (window.UI && UI.updateEnemy) UI.updateEnemy(App.enemy);
      }
      break;
    }
    case 'trap':
    case 'dot':
    case 'slow': {
      if (fx.mult) heroStrike(stats, fx.mult * mMult);
      if (App.enemy) {
        App.enemy.fx = App.enemy.fx || [];
        if (fx.dotMult) App.enemy.fx.push({ kind: 'dot', mult: fx.dotMult * mMult,
          ticksLeft: fx.dotTicks, everyMs: fx.dotEveryMs, nextAt: Date.now() + fx.dotEveryMs });
        if (fx.slowPct) App.enemySlow = { pct: fx.slowPct, until: Date.now() + (fx.slowSec || 0) * 1000 };
      }
      break;
    }
    case 'shield': {
      Engine.addShield(s, Math.round(stats.maxHp * (fx.pct / 100)), fx.sec);
      UI.combatLog(`🛡️ Shield Block! Absorbing damage for ${fx.sec}s.`, 'skill');
      break;
    }
    case 'shout': {
      if (fx.atkPct) Engine.addBuff(s, 'atkPct', fx.atkPct, fx.sec);
      if (fx.dmgTakenPct) Engine.addBuff(s, 'dmgTakenPct', fx.dmgTakenPct, fx.sec);
      UI.combatLog(`📯 ${def.name}!`, 'skill');
      break;
    }
    case 'debuff': {
      if (fx.mult) heroStrike(stats, fx.mult * mMult);
      if (App.enemy && fx.debuffKind) {
        const dotValue = Math.round(stats.attack * (fx.debuffMult || 0.5));
        Engine.addDebuff(App.enemy, fx.debuffKind, dotValue, fx.debuffSec || 10);
        const def = Engine.DEBUFF_DEFS[fx.debuffKind];
        UI.combatLog(`${def.icon} ${def.name} applied to enemy!`, 'skill');
        if (window.UI && UI.updateEnemy) UI.updateEnemy(App.enemy);
      }
      break;
    }
    case 'dodge': {
      Engine.addBuff(s, 'dodgePct', fx.pct, fx.sec);
      UI.combatLog(`💫 Blink! +${fx.pct}% dodge for ${fx.sec}s.`, 'skill');
      break;
    }
  }
  UI.updateHUD(s, App.user);
  saveNow();
}

// Enemy damage-over-time from traps and blizzard.
function tickEnemyFx(stats) {
  const enemy = App.enemy;
  if (!enemy || !enemy.fx || !enemy.fx.length || App.dead) return;
  const now = Date.now();
  for (const f of enemy.fx) {
    if (f.kind === 'dot' && f.ticksLeft > 0 && now >= f.nextAt) {
      f.ticksLeft -= 1;
      f.nextAt = now + f.everyMs;
      const dmg = Math.max(1, Math.round(stats.attack * f.mult));
      damageEnemy(dmg, '', '🔥 ');
    }
  }
  enemy.fx = enemy.fx.filter(f => f.kind !== 'dot' || f.ticksLeft > 0);
}

function setMode(mode) {
  const s = App.state;
  if (!s || s.mode === mode) { UI.setMode(mode); return; }
  const wasRaid = s.mode === 'raid';
  const wasTower = s.mode === 'tower';
  if (wasRaid) Raid.exit();
  s.mode = mode;
  App.heroTimer = 0;
  App.companionTimers = {};
  App.healerTimers = {};
  UI.setMode(mode);
  UI.renderBattle(s);
  UI.updateHeroPanel(s, Engine.computeStats(s), App);
  UI.toast({ clicker: '👆 Clicker mode — tap to attack!', auto: '🤖 Auto mode — your hero fights alone.', dungeon: '🏰 Dungeon mode — party fights with you!', raid: '🌀 Raid mode — endless waves! Death ends the run.', tower: '🗼 Tower of Shadows — climb endless floors! Bosses scale hard.' }[mode] || mode);
  // Entering or leaving raid/tower needs a fresh enemy (waves vs stage enemies).
  if (mode === 'raid' || wasRaid || mode === 'tower' || wasTower) spawnEnemy();
  saveNow();
}

// ---------------- Inn (AFK safe zone) ----------------
// Session-only: entering suspends all combat (no damage in or out, no
// enemy progression) and regenerates HP; leaving resumes the fight.
// On game load the player always starts back at battle (safe default).
function enterInn() {
  const s = App.state;
  if (!s || App.inInn) return;
  App.inInn = true;
  UI.showTab('inn');
  UI.startInnGlow();
  try { Audio.startInnAmbience(); } catch { /* audio is optional */ }
  UI.renderInn(s, Engine.computeStats(s));
  UI.toast('🏠 You rest at the inn — safe from harm.', 'success');
}

function leaveInn(toBattle) {
  if (!App.inInn) return;
  App.inInn = false;
  try { Audio.stopInnAmbience(); } catch { /* ignore */ }
  UI.stopInnGlow();
  if (toBattle) {
    UI.showTab('battle');
    UI.toast('⚔️ Back to the fight!', 'info');
  }
}

function doEquip(id) {
  const s = App.state;
  if (Engine.equipItem(s, id)) {
    UI.renderGear(s);
    UI.toast('Equipped.', 'success');
    saveNow();
  }
}

function doSell(id) {
  const s = App.state;
  const item = s.inventory.find(i => i.id === id);
  if (!item) return;
  const gold = Engine.sellItem(s, id);
  if (gold > 0) {
    UI.toast(`Sold ${item.name} for 💰${formatNum(gold)}.`, 'success');
    UI.renderArmory(s);
    if (UI.activeTab === 'gear') UI.renderGear(s);
    UI.updateHUD(s, App.user);
    saveNow();
  }
}

// Clear Bags: sell all sellable, unequipped gear at once (Armory).
function doClearBags() {
  const s = App.state;
  const res = Engine.sellAllGear(s);
  if (res.count === 0) {
    UI.toast('Nothing to sell — bags are already clear!', 'warn');
    return;
  }
  UI.toast(`🗑️ Sold ${res.count} item${res.count === 1 ? '' : 's'} for 💰${formatNum(res.gold)}!`, 'success');
  UI.renderArmory(s);
  UI.updateHUD(s, App.user);
  saveNow();
}

// Auto-sell toggle: when ON, looted gear auto-sells for gold.
function doToggleAutoSell(on) {
  const s = App.state;
  if (!s.settings) s.settings = {};
  s.settings.autoSell = !!on;
  saveNow();
  UI.toast(on ? '💰 Auto-sell ON — loot converts to gold!' : '💰 Auto-sell OFF.', 'success');
}

// ---------------- Mining & Forging ----------------
function doMine() {
  const s = App.state;
  if (!s) return;
  if (App.dead) {
    // The "You fell!" overlay only lives on the battle tab — tapping the rock
    // while dead on the mine tab otherwise gives zero feedback and feels like
    // mining is broken. Throttled so rapid taps don't spam toasts.
    const now = Date.now();
    if (!App._deadMineToastAt || now - App._deadMineToastAt > 3000) {
      App._deadMineToastAt = now;
      UI.toast('💀 You fell! Reviving…', 'error');
    }
    return;
  }
  const res = Engine.mineTap(s);
  const oreDef = Engine.ORE_BY_ID[res.ore] || {};
  let msg = `+1 ${oreDef.emoji || ''} ${oreDef.name || res.ore}`;
  if (res.broke) {
    const bonusTxt = res.bonus.length ? ` (+${res.bonus.length} bonus)` : '';
    msg += ` — rock shattered!${bonusTxt} Now depth ${s.mine.depth}.`;
    UI.toast(`⛏️ Rock shattered! Depth ${s.mine.depth}.`, 'success');
  }
  UI.renderMine(s, msg);
  if (App.mineTaps === undefined) App.mineTaps = 0;
  if (++App.mineTaps % 25 === 0) saveNow(); // don't hammer the save endpoint
}

// ---------------- pets ----------------
function doHatchPet(tier) {
  const s = App.state;
  if (!s) return;
  const t = (typeof tier === 'string' && (tier === 'wild' || Engine.SHOP_EGG_TIERS.includes(tier))) ? tier : 'wild';
  const pet = Engine.hatchPet(s, t);
  if (!pet) {
    UI.toast('No pet eggs to hatch — bosses drop them, or buy one in the Pet Shop.', 'info');
    return;
  }
  const sp = Engine.petSpeciesOf(pet);
  UI.toast(`🥚 Hatched a ${sp.name}! ${sp.emoji}`, 'success');
  UI.combatLog(`🥚 Hatched ${sp.emoji} ${sp.name}!`, 'loot');
  if (UI.activeTab === 'pets') UI.renderPetsTab(s);
  checkAch(); // first-hatch / pack titles
  saveNow();
}

function doBuyTokenItem(itemId) {
  const s = App.state;
  if (!s) return;
  const res = Engine.buyTokenItem(s, itemId, Date.now());
  if (!res.ok) {
    const msg = {
      'bad-item': 'That item is gone.',
      'not-in-stock': 'That item rotated out of stock.',
      'tokens': `Not enough 🌀 tokens — need ${res.cost}. Rebirth to earn more!`,
      'owned': 'You already own that one.',
    }[res.reason] || 'Could not buy that.';
    UI.toast(msg, 'warn');
    return;
  }
  const item = res.item;
  UI.toast(`🌀 Bought ${item.name || item.id}! Yours forever.`, 'success');
  UI.combatLog(`🌀 Token shop: bought ${item.name || item.id}.`, 'loot');
  UI.renderTokenShop(s);
  saveNow();
}

function openChangeClass() {
  const s = App.state;
  if (!s) return;
  if ((s.classTokens || 0) < 1) {
    UI.toast('No 🔄 Class Change Tokens — grab one in the 🌀 Token Shop.', 'warn');
    return;
  }
  UI.openChangeClassModal(s, (newClass) => doChangeClass(newClass));
}

function doChangeClass(newClass) {
  const s = App.state;
  if (!s) return;
  const res = Engine.changeClass(s, newClass);
  if (!res.ok) {
    UI.toast(res.reason === 'tokens' ? 'No 🔄 Class Change Tokens left.' : 'Could not change class.', 'warn');
    return;
  }
  const cls = Engine.CLASSES[newClass] || {};
  UI.toast(`${cls.emoji || ''} You are now a ${cls.name || newClass}!`, 'success');
  UI.combatLog(`🔄 Changed class to ${cls.emoji || ''} ${cls.name || newClass}.`, 'loot');
  const stats = Engine.computeStats(s);
  UI.updateHUD(s, App.user);
  UI.updateBattle(s, stats, { enemy: App.enemy, user: App.user, skillCDs: App.skillCDs, potionCD: s.potionReadyAt || 0 });
  if (UI.activeTab === 'battle') UI.renderBattle(s);
  saveNow();
}

function openChangeHeroName() {
  const s = App.state;
  if (!s) return;
  if ((s.nameTokens || 0) < 1) {
    UI.toast('No 📝 Name Change Tokens — grab one in the 🌀 Token Shop.', 'warn');
    return;
  }
  UI.openHeroNameModal(s, (name) => doChangeHeroName(name));
}

function doChangeHeroName(name) {
  const s = App.state;
  if (!s) return;
  const res = Engine.changeHeroName(s, name);
  if (!res.ok) {
    UI.toast(res.reason === 'tokens' ? 'No 📝 Name Change Tokens left.'
      : res.reason === 'length' ? 'Hero name must be 2–16 characters.'
      : 'Letters, numbers, spaces and _ - \' only.', 'warn');
    // Reopen so they can fix the name without spending another tap.
    openChangeHeroName();
    return;
  }
  UI.toast(`📝 Your hero is now known as ${res.name}!`, 'success');
  UI.combatLog(`📝 Hero renamed to ${res.name}.`, 'loot');
  saveNow();
}

async function doChangePassword(cur, nw, nw2) {
  if (isGuest()) return UI.toast('Guests have no password — create an account first.', 'warn');
  if (!cur) return UI.toast('Enter your current password.', 'warn');
  if (!nw || nw.length < 8) return UI.toast('New password must be at least 8 characters.', 'warn');
  if (nw !== nw2) return UI.toast('New passwords do not match.', 'warn');
  try {
    await api.changePassword(cur, nw);
    for (const id of ['acct-cur-pass', 'acct-new-pass', 'acct-new-pass2']) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    }
    UI.toast('🔑 Password changed. Other devices were signed out.', 'success');
  } catch (e) {
    UI.toast((e && e.message) || 'Could not change password.', 'error');
  }
}

async function doChangeUsername(nu, pw) {
  if (isGuest()) return UI.toast('Guests have no username — create an account first.', 'warn');
  const clean = String(nu || '').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(clean)) {
    return UI.toast('Username must be 3–20 characters: letters, numbers, _ only.', 'warn');
  }
  if (App.user && clean.toLowerCase() === String(App.user.username).toLowerCase()) {
    return UI.toast('That is already your username.', 'warn');
  }
  if (!pw) return UI.toast('Enter your current password to confirm.', 'warn');
  const ok = await UI.confirm(
    'Change username?',
    `Your new username will be <b>${esc(clean)}</b> everywhere — guild, friends, leaderboard. Your progress and items stay exactly the same.`,
    'Change it'
  );
  if (!ok) return;
  try {
    const r = await api.changeUsername(clean, pw);
    App.user = r.user;
    const unEl = document.getElementById('acct-new-username');
    if (unEl) unEl.value = '';
    const pwEl = document.getElementById('acct-username-pass');
    if (pwEl) pwEl.value = '';
    UI.refreshAccountCard(App.user, isGuest());
    UI.updateHUD(App.state, App.user);
    UI.renderStats(App.state, App.user);
    UI.toast(`✏️ You are now <b>${esc(r.user.username)}</b>!`, 'success');
  } catch (e) {
    UI.toast((e && e.message) || 'Could not change username.', 'error');
  }
}

// Potions run on their own 60s cooldown — never shared with spell cooldowns.
function doDrinkPotion(kind) {
  const s = App.state;
  if (!s || App.dead || App._paused) return;
  const now = Date.now();
  const readyAt = s.potionReadyAt || 0;
  if (now < readyAt) {
    UI.toast(`Potion ready in ${Math.ceil((readyAt - now) / 1000)}s.`, 'warn');
    return;
  }
  const res = Engine.drinkPotion(s, kind, Engine.computeStats(s));
  if (!res.ok) { UI.toast('No potions left — they drop from enemies.', 'warn'); return; }
  s.potionReadyAt = now + Engine.POTION_CD_MS;
  if (kind === 'health') {
    UI.floatText(`+${formatNum(res.amount)}`, 'heal');
    UI.combatLog(`🧪 Potion restored ${formatNum(res.amount)} HP.`, 'heal');
  } else {
    UI.toast(`🧪 +${res.amount} ${Engine.resDef(res.res).name}!`, 'success');
  }
  UI.updateHUD(s, App.user);
  saveNow();
}

function doBuyEgg(tier) {
  const s = App.state;
  if (!s) return;
  const res = Engine.buyEgg(s, tier);
  if (!res.ok) {
    UI.toast(res.reason === 'gold' ? 'Not enough gold for that egg.' : 'That egg is not for sale.', 'error');
    return;
  }
  const t = Engine.EGG_TIERS[tier];
  const priceNote = s.infGold ? ' (∞ gold)' : ` for 💰${formatNum(t.price)} gold`;
  UI.toast(`${t.emoji} Bought a ${t.name}${priceNote}!`, 'success');
  UI.combatLog(`🛒 Bought ${t.emoji} ${t.name} from the Pet Shop.`, 'loot');
  UI.renderPetsTab(App.state);
  saveNow();
}

function doSellPet(petUid) {
  const s = App.state;
  if (!s) return;
  const p = Engine.ensurePets(s);
  const pet = p.collection.find(x => x.uid === petUid);
  const sp = pet && Engine.petSpeciesOf(pet);
  if (!pet || !sp) return;
  if (!Engine.canSellPet(pet)) {
    UI.toast('That pet is special — it cannot be sold.', 'error');
    return;
  }
  const res = Engine.sellPet(s, petUid);
  if (!res.ok) {
    UI.toast(res.reason === 'unsellable' ? 'That pet is special — it cannot be sold.' : 'Could not sell that pet.', 'error');
    return;
  }
  UI.toast(`💰 Sold ${sp.emoji} ${res.name} for 💰${formatNum(res.gold)} gold${res.capped ? ' (gold cap reached)' : ''}.`, 'success');
  UI.combatLog(`💰 Sold ${sp.emoji} ${res.name} for 💰${formatNum(res.gold)}.`, 'loot');
  UI.renderPetsTab(App.state);
  saveNow();
}

function doSetSecondPet(petUid) {
  const s = App.state;
  if (!s || s.playerClass !== 'hunter') return;
  const p = Engine.ensurePets(s);
  const pet = p.collection.find(x => x.uid === petUid);
  if (!pet || petUid === p.activeUid) return;
  p.secondUid = petUid;
  const sp = Engine.petSpeciesOf(pet);
  UI.toast(`${sp.emoji} ${sp.name} joins the hunt as your second pet!`, 'success');
  UI.renderPetsTab(App.state);
  saveNow();
}

function doRemoveSecondPet() {
  const s = App.state;
  if (!s) return;
  const p = Engine.ensurePets(s);
  if (!p.secondUid) return;
  p.secondUid = null;
  UI.toast('Second pet dismissed.', 'info');
  UI.renderPetsTab(App.state);
  saveNow();
}

// ---------------- multiplayer party ----------------
// App.mpParty caches the GET /api/party view (null = not in a party).
// Bonuses are computed from this cache; the server recomputes them from
// DB truth on every /api/party response, so the client can never inflate
// its own bonus — gainXp clamps the passed percentage anyway.
function partyCtx() {
  const s = App.state;
  return {
    mpParty: App.mpParty,
    username: App.user && App.user.username,
    isGuest: isGuest(),
    ownNpcCount: s && Array.isArray(s.party) ? s.party.length : 0,
  };
}

function renderPartyTab() {
  if (App.state) UI.renderParty(App.state, partyCtx());
}

function partyBonus() {
  const mp = App.mpParty;
  // Server-computed bonuses from DB truth (GET /api/party) — preferred.
  if (mp && mp.bonuses && Number.isFinite(mp.bonuses.xpPct) && Number.isFinite(mp.bonuses.goldPct)) {
    return { xpPct: mp.bonuses.xpPct, goldPct: mp.bonuses.goldPct };
  }
  // Fallback: local estimate (own NPC allies only; no server data yet).
  const npcs = App.state && Array.isArray(App.state.party) ? App.state.party.length : 0;
  return { xpPct: npcs * 4, goldPct: 0 };
}

// Refetch the party view. Offline-tolerant: keeps the stale cache on error.
async function loadMpParty() {
  if (isGuest() || !App.user) { App.mpParty = null; }
  else {
    try {
      const res = await api.partyGet();
      App.mpParty = res.party || null;
    } catch { /* keep stale cache */ }
  }
  if (UI.activeTab === 'party' && App.state) UI.renderParty(App.state, partyCtx());
}

// Poll GET /api/party every 30s only while the Party tab is active.
function setMpPoll(on) {
  if (App.mpPoll) { clearInterval(App.mpPoll); App.mpPoll = null; }
  if (on && !isGuest()) App.mpPoll = setInterval(() => { loadMpParty(); }, 30000);
}

async function doMpCreate() {
  if (isGuest()) { promptUpgrade('multiplayer parties'); return; }
  try {
    const res = await api.partyCreate();
    App.mpParty = res.party;
    UI.toast(`🎉 Party created! Code: ${res.code}`, 'success');
  } catch (e) { UI.toast(e.message || 'Could not create party.', 'error'); }
  renderPartyTab();
}

async function doMpJoin(code) {
  if (isGuest()) { promptUpgrade('multiplayer parties'); return; }
  code = String(code || '').trim().toUpperCase();
  if (!code) { UI.toast('Enter the 6-letter party code.', 'error'); return; }
  try {
    const res = await api.partyJoin(code);
    App.mpParty = res.party;
    UI.toast('🎉 Joined the party!', 'success');
  } catch (e) { UI.toast(e.message || 'Could not join party.', 'error'); }
  renderPartyTab();
}

async function doMpLeave() {
  try {
    await api.partyLeave();
    App.mpParty = null;
    UI.toast('You left the party.', 'info');
  } catch (e) { UI.toast(e.message || 'Could not leave party.', 'error'); }
  renderPartyTab();
}

async function doMpKick(userId) {
  try {
    await api.partyKick(Number(userId));
    const res = await api.partyGet();
    App.mpParty = res.party;
    UI.toast('Member kicked.', 'info');
  } catch (e) { UI.toast(e.message || 'Could not kick member.', 'error'); }
  renderPartyTab();
}

async function doMpPromote(userId) {
  try {
    const res = await api.partyPromote(Number(userId));
    App.mpParty = res.party || (await api.partyGet()).party;
    UI.toast('👑 Leadership transferred.', 'success');
  } catch (e) { UI.toast(e.message || 'Could not promote member.', 'error'); }
  renderPartyTab();
}

async function doMpDisband() {
  if (!window.confirm('Disband the party for everyone?')) return;
  try {
    await api.partyDisband();
    App.mpParty = null;
    UI.toast('Party disbanded.', 'info');
  } catch (e) { UI.toast(e.message || 'Could not disband party.', 'error'); }
  renderPartyTab();
}

function doMpCopy() {
  const code = App.mpParty && App.mpParty.code;
  if (!code) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(
      () => UI.toast('📋 Party code copied!', 'success'),
      () => UI.toast(`Party code: ${code}`, 'info')
    );
  } else {
    UI.toast(`Party code: ${code}`, 'info');
  }
}

function doBuyArmory(stockId) {
  const s = App.state;
  if (!s) return;
  const res = Engine.buyArmoryItem(s, stockId);
  if (!res.ok) {
    UI.toast(res.reason === 'gold' ? 'Not enough gold for that steel.' : 'That item is not for sale.', 'error');
    return;
  }
  const entry = Engine.ARMORY_STOCK.find(e => e.id === stockId);
  const priceNote = s.infGold ? ' (∞ gold)' : ` for 💰${formatNum(entry.price)} gold`;
  UI.toast(`${entry.emoji} Bought ${res.item.name}${priceNote}!`, 'success');
  UI.combatLog(`⚒️ Bought ${entry.emoji} ${res.item.name} (${res.item.rarity}) from the Armory.`, 'loot');
  UI.renderArmory(s);
  UI.updateHUD(s, App.user);
  saveNow();
}

// Halloween 2026: Reaper's Scythe (20 pumpkin shards + 50k gold).
function doBuyHalloweenScythe() {
  const s = App.state;
  if (!s) return;
  const shards = (s.materials && s.materials.pumpkin_shard) || 0;
  const goldCost = 50000;
  if (shards < 20) { UI.toast('Need 20 🎃 Jack-o\'-Lantern Shards.', 'error'); return; }
  if ((s.gold || 0) < goldCost) { UI.toast('Not enough gold (need 💰50K).', 'error'); return; }
  if ((s.inventory || []).some(i => i.id === 'reapers-scythe')) { UI.toast('Already owned.', 'info'); return; }
  s.materials.pumpkin_shard -= 20;
  s.gold -= goldCost;
  const scythe = {
    id: 'reapers-scythe-' + Date.now(),
    name: "🎃 Reaper's Scythe",
    slot: 'weapon',
    rarity: 'mythic',
    value: 25000,
    unsellable: true,
    stats: { attack: 500, critChance: 10, lifesteal: 5 },
  };
  s.inventory.push(scythe);
  UI.toast(`🎃 Bought Reaper's Scythe!`, 'success');
  UI.combatLog(`🎃 Bought 🎃 Reaper's Scythe (mythic) from the Halloween shop!`, 'loot');
  UI.renderArmory(s);
  UI.updateHUD(s, App.user);
  saveNow();
}

// Halloween gear purchases (mega-spec weapons/armor).
const HALLOWEEN_GEAR_DEFS = {
  'lantern-damned': { name: '🔮 Lantern of the Damned', slot: 'trinket', stats: { spellPower: 95 }, cost: 15, gold: 30000 },
  'bloodmoon-dagger': { name: '🗡️ Bloodmoon Dagger', slot: 'weapon', stats: { attack: 110, attackSpeed: 15 }, cost: 12, gold: 25000 },
  'lich-staff': { name: "🦯 Lich King's Staff", slot: 'weapon', stats: { spellPower: 210 }, cost: 18, gold: 40000 },
  'pumpkin-helm': { name: '🎃 Pumpkin Head Guard', slot: 'helmet', stats: { defense: 120, maxHp: 250 }, cost: 10, gold: 20000 },
  'whisper-cloak': { name: '👻 Cloak of Whispers', slot: 'armor', stats: { speed: 8, dodge: 4 }, cost: 10, gold: 20000 },
  'void-cuirass': { name: '🛡️ Void Knight Cuirass', slot: 'armor', stats: { defense: 300 }, cost: 14, gold: 35000 },
};

function doBuyHalloweenGear(itemId) {
  const s = App.state;
  if (!s) return;
  const def = HALLOWEEN_GEAR_DEFS[itemId];
  if (!def) return;
  const shards = (s.materials && s.materials.pumpkin_shard) || 0;
  if (shards < def.cost) { UI.toast(`Need ${def.cost} 🎃 shards.`, 'error'); return; }
  if ((s.gold || 0) < def.gold) { UI.toast(`Not enough gold (need 💰${formatNum(def.gold)}).`, 'error'); return; }
  if ((s.inventory || []).some(i => i.id === itemId)) { UI.toast('Already owned.', 'info'); return; }
  s.materials.pumpkin_shard -= def.cost;
  s.gold -= def.gold;
  s.inventory.push({
    id: itemId + '-' + Date.now(),
    templateId: itemId,
    name: def.name,
    slot: def.slot,
    rarity: 'mythic',
    value: Math.round(def.gold / 2),
    unsellable: true,
    stats: def.stats,
  });
  UI.toast(`🎃 Bought ${def.name}!`, 'success');
  UI.combatLog(`🎃 Bought ${def.name} (mythic) from the Halloween shop!`, 'loot');
  UI.renderArmory(s);
  UI.updateHUD(s, App.user);
  saveNow();
}

function doTowerSweep() {
  const s = App.state;
  if (!s) return;
  const res = Engine.towerSweep(s);
  if (!res.ok) {
    UI.toast(res.reason === 'swept' ? '🧹 Already swept today — come back tomorrow!' : '🗼 Clear at least one tower floor first!', 'warn');
    return;
  }
  Engine.addGold(s, res.gold);
  if (res.eggs > 0) {
    Engine.ensurePets(s).eggs += res.eggs;
  }
  UI.toast(`🧹 Swept ${res.floors} floors! +${formatNum(res.gold)} gold${res.eggs ? `, +${res.eggs} pet egg${res.eggs === 1 ? '' : 's'}` : ''}!`, 'success');
  UI.combatLog(`🧹 Tower sweep: ${res.floors} floors → +${formatNum(res.gold)} gold.`, 'loot');
}

// Boss Rush: start a timed gauntlet through tower bosses.
function doBossRushStart() {
  const s = App.state;
  if (!s) return;
  Engine.startBossRush(s);
  UI.toast('⚔️ Boss Rush started! Defeat all 5 bosses as fast as you can!', 'success');
  UI.renderTowerPanel(s);
  // Switch to tower mode and spawn the first boss.
  if (s.mode !== 'tower') {
    // Use existing mode switch logic
    if (typeof switchMode === 'function') switchMode('tower');
  }
  saveNow();
}

// ---------------- World Boss ----------------
function doWorldBossSpawn() {
  const s = App.state;
  if (!s) return;
  s.worldBoss = s.worldBoss || {};
  const now = Date.now();
  if (s.worldBoss.active) {
    UI.toast('The Demon King is already here!', 'error');
    return;
  }
  if (now < (s.worldBoss.nextSpawnAt || 0)) {
    UI.toast('The Demon King is not ready yet...', 'error');
    return;
  }
  // Spawn the boss
  const stats = Engine.computeStats(s);
  const boss = Engine.worldBossFor(stats);
  s.worldBoss.active = true;
  s.worldBoss.endsAt = now + Engine.WORLD_BOSS.durationMs;
  s.worldBoss.bossHp = boss.hp;
  s.worldBoss.bossMaxHp = boss.maxHp;
  App.enemy = boss;
  UI.toast('😈 Malakor the Blood Demon King has appeared!', 'error');
  UI.showTab('battle');
  UI.renderBattle(s);
  saveNow();
}

function doWorldBossFight() {
  const s = App.state;
  if (!s || !s.worldBoss || !s.worldBoss.active) return;
  // Switch to battle tab and set the world boss as current enemy
  const stats = Engine.computeStats(s);
  const boss = Engine.worldBossFor(stats);
  // Preserve current HP if already fighting
  if (s.worldBoss.bossHp != null) {
    boss.hp = s.worldBoss.bossHp;
  }
  App.enemy = boss;
  UI.showTab('battle');
  UI.renderBattle(s);
}

// Check world boss timeout in tick
function checkWorldBossTimeout() {
  const s = App.state;
  if (!s || !s.worldBoss || !s.worldBoss.active) return;
  if (Date.now() > s.worldBoss.endsAt) {
    s.worldBoss.active = false;
    s.worldBoss.nextSpawnAt = Date.now() + Engine.WORLD_BOSS.respawnMs;
    s.worldBoss.bossHp = null;
    UI.toast('😈 The Demon King has retreated...', 'error');
    saveNow();
  }
}

function doFeedPet(petUid) {
  const s = App.state;
  if (!s) return;
  const res = Engine.feedPet(s, petUid);
  if (!res.ok) {
    UI.toast(res.reason === 'gold' ? 'Not enough gold to feed.' : res.reason === 'full' ? 'That pet is full.' : 'Pet not found.', 'error');
    return;
  }
  UI.toast(`🍖 Fed for 💰${formatNum(res.cost)} gold.`, 'success');
  if (res.tierUp) UI.toast('✨ Bond bonus restored to full!', 'success');
  UI.renderPetsTab(App.state);
  saveNow();
}

function doSetActivePet(petUid) {
  const s = App.state;
  if (!s) return;
  const p = Engine.ensurePets(s);
  const pet = p.collection.find(x => x.uid === petUid);
  if (!pet) return;
  p.activeUid = petUid;
  const sp = Engine.petSpeciesOf(pet);
  UI.toast(`${sp.emoji} ${sp.name} is now your active pet!`, 'success');
  UI.renderPetsTab(App.state);
  saveNow();
}

// A GM grant targeted this session's player: swap in the updated saved state
// and refresh every view so the grant is visible immediately.
function applyExternalState(srv) {
  if (!srv) return;
  App.state = Engine.ensureState(srv);
  Raid.init(App.state);
  applyUiStyle();
  applyCustomStyles();
  applyAudioPrefs();
  const s = App.state;
  UI.updateHUD(s, App.user);
  UI.renderBattle(s);
  UI.renderGear(s);
  renderPartyTab();
  if (UI.activeTab === 'settings') UI.renderMore(s, App.user);
  if (App.enemy) UI.setEnemy(App.enemy);
  UI.updateHeroPanel(s, Engine.computeStats(s), App);
  saveNow();
}

async function doRebirth() {
  const s = App.state;
  if (s.level < Engine.MAX_LEVEL) return;
  const count = (s.rebirthCount || 0) + 1;
  const ok = await UI.confirm(
    '🌀 Rebirth?',
    `<p>Return to <b>level 1</b>. Everything else stays: stage, gold, gear, pets, titles.</p>
     <p class="muted">This will be your rebirth #${count}.</p>`,
    'Rebirth!'
  );
  if (!ok) return;
  const res = Engine.rebirth(s);
  if (!res) return;
  App.dead = false;
  UI.setDead(false);
  applyCustomStyles();
  applyAudioPrefs();
  spawnEnemy();
  UI.renderBattle(s);
  UI.renderGear(s);
  renderPartyTab();
  UI.renderMore(s, App.user);
  UI.updateHUD(s, App.user);
  UI.toast(`🌀 Reborn! Back to level 1 — rebirth #${s.rebirthCount}.`, 'success');
  checkAch();
  saveNow();
}

async function doRedeem() {
  if (isGuest()) { promptUpgrade('gift codes'); return; }
  const code = inputVal('redeem-input').trim().toUpperCase();
  if (!code) { UI.toast('Enter a gift code.', 'error'); return; }
  try {
    const res = await api.redeem(code);
    // Server merged the reward into saved state; save local progress first,
    // then pull the server-merged reward fields back in.
    await saveNow();
    const { state: srv } = await api.getState();
    const fresh = Engine.ensureState(srv);
    // keep local live progress, take the server-merged reward fields
    App.state.inventory = fresh.inventory;
    App.state.gold = fresh.gold;
    App.state.stars = fresh.stars;
    App.state.codesRedeemed = fresh.codesRedeemed;
    const _redeemEl = document.getElementById('redeem-input');
    if (_redeemEl) _redeemEl.value = '';
    UI.renderGear(App.state);
    UI.renderMore(App.state, App.user);
    UI.updateHUD(App.state, App.user);
    const reward = res.reward || { kind: 'gear', amount: 0 };
    let msg;
    if (reward.kind === 'gold') msg = `🎁 Redeemed: +💰${formatNum(reward.amount)} gold!`;
    else if (reward.kind === 'stars') msg = `🎁 Redeemed: +⭐${formatNum(reward.amount)} stars!`;
    else msg = `🎁 Redeemed! ${res.set ? '(' + res.set + ' set added)' : ''}`;
    UI.toast(msg, 'success');
    saveNow();
  } catch (e) {
    UI.toast(e.message || 'Redeem failed.', 'error');
  }
}

async function doLogout() {
  if (isGuest()) {
    const ok = await UI.confirm(
      'Exit guest session?',
      '<p>Your guest hero stays saved on <b>this device</b> — you can continue from the login screen later.</p>',
      'Exit'
    );
    if (!ok) return;
    location.reload();
    return;
  }
  const ok = await UI.confirm('Logout?', '<p>Your progress is saved. See you soon, hero.</p>', 'Logout');
  if (!ok) return;
  try { await saveNow(); } catch { /* ignore */ }
  try { await api.logout(); } catch { /* ignore */ }
  location.reload();
}

// ---------------- tab switching ----------------
// Mounts the guild panel into the Guild tab once per session.
// (Failures render an inline error + Retry inside the panel; the fetch
// itself has a timeout so a sleeping backend can't hang on "Loading…"
// forever — see guild.js.)
let guildMounted = false;
function mountGuild() {
  const el = document.getElementById('guild-section');
  if (!el || guildMounted) return;
  guildMounted = true;
  // Guide quest "Strength in Numbers": visiting the Guilds tab counts.
  const s = App.state;
  if (s) {
    if (!s.guideTabs || typeof s.guideTabs !== 'object') s.guideTabs = {};
    if (!s.guideTabs.guild) { s.guideTabs.guild = true; saveNow(); }
  }
  if (isGuest()) {
    // Guilds are server-side: guests get the upgrade prompt instead of a 401.
    el.innerHTML = `<p class="muted small">🏰 Guilds need an account — create one and your guest progress comes with you.</p>
      <button class="btn gold wide" id="guild-upgrade-btn" type="button">✨ Create account</button>`;
    el.querySelector('#guild-upgrade-btn').addEventListener('click', openUpgradeModal);
    return;
  }
  try { renderGuildSection(el, api, App.state); } catch (e) { console.warn('guild mount failed', e); }
}

// Live broadcasts via SSE (instant) with polling fallback.
function showBroadcast(b) {
  if (!b || !b.id) return;
  let seen = 0;
  try { seen = Number(localStorage.getItem('kop-broadcast-seen') || 0); } catch { /* ignore */ }
  if (b.id > seen) {
    try { localStorage.setItem('kop-broadcast-seen', String(b.id)); } catch { /* ignore */ }
    UI.toast(`📢 ${b.message}`, 'info', 8000);
  }
}
async function pollBroadcast() {
  try {
    const r = await api.latestBroadcast();
    showBroadcast(r && r.broadcast);
  } catch { /* offline-tolerant */ }
}
function startBroadcastStream() {
  try {
    const es = new EventSource('/api/broadcasts/stream');
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'buff') {
          applyLiveBuff(msg.buff);
        } else if (msg.type === 'state' && msg.changes) {
          applyLiveState(msg.changes);
        } else if (msg.type === 'broadcast' || msg.broadcast) {
          showBroadcast(msg.broadcast || msg);
        } else {
          showBroadcast(msg);
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => { /* auto-reconnects; polling covers gaps */ };
    // Keep polling as fallback (every 60s) in case SSE drops
    App.broadcastTimer = setInterval(pollBroadcast, 60000);
  } catch {
    App.broadcastTimer = setInterval(pollBroadcast, 10000);
  }
}

// Apply live state changes pushed by GM via SSE (no refresh needed)
function applyLiveState(changes) {
  if (!changes || typeof changes !== 'object') return;
  const s = App.state;
  if (!s) return;
  for (const [key, value] of Object.entries(changes)) {
    s[key] = value;
  }
  UI.toast('⚡ Owner updated your stats!', 'info', 4000);
  UI.updateHUD(s, App.user);
  if (typeof renderBuffBar === 'function') renderBuffBar();
  // Re-render inventory/gear UI if those changed
  if (changes.inventory && window.UI && typeof UI.renderGear === 'function') {
    try { UI.renderGear(s); } catch { /* ignore */ }
  }
  saveNow();
}

// Apply a live buff pushed by GM via SSE
function applyLiveBuff(buff) {
  if (!buff || !buff.type) return;
  const s = App.state;
  if (!s) return;
  if (!Array.isArray(s.activeBuffs)) s.activeBuffs = [];
  if (buff.type === 'heal') {
    const healAmt = buff.value > 0 ? buff.value : (s.hero.maxHp - s.hero.hp);
    s.hero.hp = Math.min(s.hero.maxHp, s.hero.hp + Math.max(0, healAmt));
    UI.toast(`💚 ${buff.name}! Healed ${formatNum(healAmt)} HP`, 'success', 5000);
  } else {
    s.activeBuffs = s.activeBuffs.filter(b => b.type !== buff.type);
    s.activeBuffs.push(buff);
    UI.toast(`✨ ${buff.name} active! (${Math.round((buff.expiresAt - Date.now()) / 1000)}s)`, 'success', 5000);
  }
  UI.updateHUD(s, App.user);
  renderBuffBar();
  saveNow();
}

// Render active buffs bar with countdown timers
function renderBuffBar() {
  let bar = document.getElementById('buff-bar');
  const s = App.state;
  if (!s || !Array.isArray(s.activeBuffs) || s.activeBuffs.length === 0) {
    if (bar) bar.remove();
    return;
  }
  const now = Date.now();
  s.activeBuffs = s.activeBuffs.filter(b => b.expiresAt > now);
  if (s.activeBuffs.length === 0) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'buff-bar';
    bar.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:9999;pointer-events:none';
    document.body.appendChild(bar);
  }
  const icons = { damage: '⚔️', shield: '🛡️', immunity: '✨', regen: '💚', speed: '⚡', xp: '📚', gold: '💰', priest_shield: '🛡️', pally_bubble: '🫧', heal: '💚' };
  bar.innerHTML = s.activeBuffs.map(b => {
    const secs = Math.ceil((b.expiresAt - now) / 1000);
    return `<div style="background:rgba(0,0,0,0.8);border:1px solid gold;border-radius:8px;padding:4px 10px;color:#fff;font-size:13px">${icons[b.type] || '✨'} ${b.name} ${secs}s</div>`;
  }).join('');
}
// Tick buff expiration every second + regen healing
setInterval(() => {
  if (!window.App || !App.state) return;
  if (typeof renderBuffBar === 'function') renderBuffBar();
  // Regen buff: heal over time
  const s = App.state;
  const regen = s.activeBuffs && s.activeBuffs.find(b => b.type === 'regen' && b.expiresAt > Date.now());
  if (regen && regen.value > 0 && s.hero && s.hero.hp < s.hero.maxHp) {
    s.hero.hp = Math.min(s.hero.maxHp, s.hero.hp + regen.value);
    if (window.UI && UI.updateHUD) UI.updateHUD(s, App.user);
  }
}, 1000);

async function onTabSwitch(tab, force = false) {
  const s = App.state;
  if (!s) return;
  // Navigating anywhere else ends the inn rest (leaveInn(true) would fight
  // the tab switch in progress, so exit silently here).
  if (tab !== 'inn' && App.inInn) leaveInn(false);
  // Party polling only lives while the Party tab is open.
  setMpPoll(tab === 'party');
  if (tab === 'gear') UI.renderGear(s);
  else if (tab === 'armory') UI.renderArmory(s);
  else if (tab === 'mine') UI.renderMine(s);
  else if (tab === 'party') { loadMpParty(); renderPartyTab(); }
  else if (tab === 'pets') UI.renderPetsTab(s);
  else if (tab === 'tokenshop') UI.renderTokenShop(s);
  else if (tab === 'settings') { UI.renderMore(s, App.user); UI.syncNotifSettings(s.settings && s.settings.notif); }
  else if (tab === 'stats') UI.renderStats(s, App.user);
  else if (tab === 'titles') UI.renderTitles(s);
  else if (tab === 'guild') { mountGuild(); }
  else if (tab === 'quests') UI.renderQuests(s);
  else if (tab === 'talents') UI.renderTalents(s);
  else if (tab === 'battle') {
    UI.renderBattle(s);
    if (App.enemy) UI.setEnemy(App.enemy);
    // Battle background (Settings → ⚔️ Battle background): the current
    // realm's animated scene (default), the player's picked background, or
    // off (plain dark, no animated scene). Leaving battle restores the
    // saved background style below.
    try {
      const bbg = battleBgOf(s);
      if (bbg === 'mystyle') UI.setBgScene(bgStyleOf(s), bgSceneOpts(s));
      else if (bbg === 'off') UI.setBgScene('off', bgSceneOpts(s));
      else {
        const world = Engine.worldForStage(s.stage);
        if (world && world.bgScene) UI.setBgScene(world.bgScene, bgSceneOpts(s));
      }
    } catch { /* keep saved background on error */ }
  } else if (tab === 'ranks') {
    await loadRanks();
  }
  // Non-battle tabs always honor the saved background style.
  if (tab !== 'battle') {
    try { UI.setBgScene(bgStyleOf(s), bgSceneOpts(s)); } catch { /* ignore */ }
  }
  void force;
}

async function loadRanks() {
  // Guilds category (server-ranked by guild level → member power → count).
  const cat = UI.ranksCategory || 'heroes';
  if (cat === 'guilds') {
    try {
      const { guilds } = await api.guildRankings();
      UI.renderGuildRanks(guilds || []);
    } catch (e) {
      UI.toast('Could not load guild rankings.', 'error');
    }
    return;
  }
  // Heroes: 7 ranking pills (?by=) + All/Friends filter.
  const by = UI.lbCategory || 'level';
  try {
    const { entries } = await api.leaderboard(by);
    UI.renderRanks(entries || [], App.user ? App.user.username : null, by, App.state);
  } catch (e) {
    UI.toast('Could not load leaderboard.', 'error');
  }
  // Keep the selected sub-tab and refresh friends in the background.
  UI.switchRanksSubtab(App.ranksSubtab === 'friends' ? 'friends' : 'board');
  loadFriends();
}

async function loadFriends() {
  if (isGuest()) {
    UI.renderFriends(null, true);
    UI.showFriendsModal(null, true);
    UI.setFriendBadge(0);
    return;
  }
  try {
    const data = await api.getFriends();
    App.friends = data;
    UI.renderFriends(data, false);
    UI.showFriendsModal(data, false);
    UI.setFriendBadge((data.incoming || []).length);
  } catch (e) {
    UI.renderFriends({ friends: [], incoming: [], outgoing: [] }, false);
    UI.showFriendsModal({ friends: [], incoming: [], outgoing: [] }, false);
    UI.setFriendBadge(0);
  }
}

// ---------------- go ----------------
document.addEventListener('DOMContentLoaded', boot);
