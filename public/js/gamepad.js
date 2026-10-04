'use strict';
/* Throne of Shadows — gamepad navigation (Xbox / TV / desktop controllers).
 *
 * DOM-only module: no changes to app.js or ui.js are needed. Import it as a
 * module from index.html and it self-initializes.
 *
 * Controls (standard mapping):
 *   D-pad / left stick .... move the focus ring (hold to repeat; each has
 *                           independent repeat state)
 *   A ..................... activate the focused button / control
 *   B ..................... back: dismiss the open dialog through its safe
 *                           dismiss action — never a destructive one
 *   LB / RB ............... previous / next tab
 *   Start ................. jump to the Settings tab
 *   Right stick ........... scroll the active panel / dialog
 *
 * The focus ring only appears while a controller is in use (body.gamepad),
 * so mouse / touch players never see it. Everything fails gracefully when
 * no gamepad API exists.
 */

// ---- pure geometry (exported for unit tests) -------------------------------

// Pick the nearest element center in the given direction.
// cur: {x, y} center of the focused element.
// pts: [{x, y}, ...] centers of the candidates.
// Returns the candidate index, or -1 when nothing lies that way.
export function pickInDirection(cur, pts, dir) {
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - cur.x;
    const dy = pts[i].y - cur.y;
    let primary;
    let secondary;
    if (dir === 'up') {
      if (dy >= -4) continue;
      primary = -dy; secondary = Math.abs(dx);
    } else if (dir === 'down') {
      if (dy <= 4) continue;
      primary = dy; secondary = Math.abs(dx);
    } else if (dir === 'left') {
      if (dx >= -4) continue;
      primary = -dx; secondary = Math.abs(dy);
    } else if (dir === 'right') {
      if (dx <= 4) continue;
      primary = dx; secondary = Math.abs(dy);
    } else {
      continue;
    }
    // Prefer straight-line targets over diagonal ones.
    const score = primary + secondary * 2.2;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// ---- B-button dismiss picking (exported for unit tests) --------------------

// Labels that read as "back out of this dialog".
const DISMISS_RE = /cancel|close|dismiss|\bno\b|back|never mind/i;

// Choose which dialog button the B (back) button should activate.
// buttons: [{text, danger}] in DOM order. Returns the index to click, or -1
// when no safe choice exists (every action is destructive — leave the
// dialog open so the player can D-pad to Cancel and press A deliberately).
export function pickDismissButton(buttons) {
  if (!buttons || !buttons.length) return -1;
  const safe = [];
  for (let i = 0; i < buttons.length; i++) {
    if (!buttons[i].danger) safe.push(i);
  }
  if (!safe.length) return -1;
  for (const i of safe) {
    if (DISMISS_RE.test(buttons[i].text || '')) return i;
  }
  // Benign single-button / acknowledge dialogs (OK, Nice!, Got it).
  return safe[0];
}

// ---- held-input repeat (exported for unit tests) ----------------------------

const REPEAT_FIRST_MS = 380;
const REPEAT_NEXT_MS = 120;

// One repeat state per input source: st = {dir, nextAt}.
// Returns true when the caller should move once for this sample.
export function repeatStep(st, d, now) {
  if (!d) { st.dir = null; return false; }
  if (d !== st.dir) {
    st.dir = d;
    st.nextAt = now + REPEAT_FIRST_MS;
    return true;
  }
  if (now >= st.nextAt) {
    st.nextAt = now + REPEAT_NEXT_MS;
    return true;
  }
  return false;
}

// ---- controller ------------------------------------------------------------

const BTN = { A: 0, B: 1, LB: 4, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEADZONE = 0.35;
const SCROLL_PX = 26;

const FOCUSABLE_SEL =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function freshRepeatState() {
  return { dpad: { dir: null, nextAt: 0 }, stick: { dir: null, nextAt: 0 } };
}

const GamepadNav = {
  padIndex: -1,
  rafId: 0,
  prev: {},
  repeat: freshRepeatState(),
  focusEl: null,

  init() {
    if (!('getGamepads' in navigator)) return;
    window.addEventListener('gamepadconnected', (e) => this.onConnect(e));
    window.addEventListener('gamepaddisconnected', (e) => this.onDisconnect(e));
    // A pad may already be plugged in before this module loads.
    try {
      const pads = navigator.getGamepads();
      for (const p of pads) {
        if (p && p.connected) { this.onConnect({ gamepad: p }); break; }
      }
    } catch { /* ignore */ }
  },

  onConnect(e) {
    this.padIndex = e.gamepad.index;
    document.body.classList.add('gamepad');
    this.toast('🎮 Controller connected — D-pad moves, A selects, B goes back');
    this.prev = {};
    this.repeat = freshRepeatState();
    if (!this.rafId) this.rafId = requestAnimationFrame(() => this.poll());
  },

  onDisconnect(e) {
    if (e.gamepad.index !== this.padIndex) return;
    this.padIndex = -1;
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    document.body.classList.remove('gamepad');
    this.setFocus(null);
    this.toast('🎮 Controller disconnected');
  },

  poll() {
    this.rafId = requestAnimationFrame(() => this.poll());
    let gp = null;
    try {
      const pads = navigator.getGamepads();
      gp = pads[this.padIndex] || null;
      if (!gp) {
        for (const p of pads) { if (p && p.connected) { gp = p; this.padIndex = p.index; break; } }
      }
    } catch { /* ignore */ }
    if (!gp) return;
    this.handleButtons(gp);
    this.handleSticks(gp);
  },

  pressed(gp, i) {
    const b = gp.buttons[i];
    return !!(b && b.pressed);
  },

  handleButtons(gp) {
    const edge = (i) => {
      const now = this.pressed(gp, i);
      const was = !!this.prev[i];
      this.prev[i] = now;
      return now && !was;
    };
    if (edge(BTN.A)) this.activate();
    if (edge(BTN.B)) this.back();
    if (edge(BTN.LB)) this.cycleTab(-1);
    if (edge(BTN.RB)) this.cycleTab(1);
    if (edge(BTN.START)) this.gotoSettings();
    const d =
      this.pressed(gp, BTN.UP) ? 'up' :
      this.pressed(gp, BTN.DOWN) ? 'down' :
      this.pressed(gp, BTN.LEFT) ? 'left' :
      this.pressed(gp, BTN.RIGHT) ? 'right' : null;
    this.stickDirection('dpad', d);
  },

  handleSticks(gp) {
    const ax = (i) => {
      const v = gp.axes[i] || 0;
      return Math.abs(v) > DEADZONE ? v : 0;
    };
    const x = ax(0);
    const y = ax(1);
    let d = null;
    if (x || y) d = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
    this.stickDirection('stick', d);
    // Right stick scrolls whatever is under focus.
    const sx = ax(2);
    const sy = ax(3);
    if (sx || sy) this.scrollBy(sx * SCROLL_PX, sy * SCROLL_PX);
  },

  // D-pad and the left stick keep independent direction/repeat state so one
  // never resets or interferes with the other's held repeat.
  stickDirection(src, d) {
    let st = this.repeat[src];
    if (!st) st = this.repeat[src] = { dir: null, nextAt: 0 };
    if (repeatStep(st, d, performance.now())) this.move(d);
  },

  // ---- focus scope ---------------------------------------------------------

  // Topmost open dialog wins; otherwise the active tab panel.
  scope() {
    const overlays = document.querySelectorAll('.modal-overlay');
    if (overlays.length) return overlays[overlays.length - 1];
    const tab = document.querySelector('#tab-content .tab.active');
    if (tab) return tab;
    return document.body;
  },

  focusables() {
    const root = this.scope();
    return [...root.querySelectorAll(FOCUSABLE_SEL)].filter((el) => {
      if (el.disabled) return false;
      if (el.getClientRects().length === 0) return false;
      return true;
    });
  },

  center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },

  setFocus(el) {
    if (this.focusEl === el) return;
    if (this.focusEl) this.focusEl.classList.remove('gpad-focus');
    this.focusEl = el;
    if (el) {
      el.classList.add('gpad-focus');
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* ignore */ }
    }
  },

  move(dir) {
    const items = this.focusables();
    if (!items.length) { this.setFocus(null); return; }
    // Drop the ring if its element left the DOM or the scope.
    if (this.focusEl && !items.includes(this.focusEl)) this.setFocus(null);
    if (!this.focusEl) { this.setFocus(items[0]); return; }
    const cur = this.center(this.focusEl);
    const pts = items.map((el) => this.center(el));
    // Exclude the focused element itself from the candidates.
    const idx = items.indexOf(this.focusEl);
    const pts2 = pts.filter((_, i) => i !== idx);
    const items2 = items.filter((_, i) => i !== idx);
    const pick = pickInDirection(cur, pts2, dir);
    if (pick >= 0) this.setFocus(items2[pick]);
    else {
      // Nothing that way: wrap around the list in DOM order.
      const next = dir === 'up' || dir === 'left' ? idx - 1 : idx + 1;
      this.setFocus(items[(next + items.length) % items.length]);
    }
  },

  activate() {
    const items = this.focusables();
    if (this.focusEl && !items.includes(this.focusEl)) this.setFocus(null);
    const el = this.focusEl || items[0];
    if (!el) return;
    this.setFocus(el);
    el.classList.add('gpad-press');
    setTimeout(() => el.classList.remove('gpad-press'), 140);
    try { el.click(); } catch { /* ignore */ }
  },

  back() {
    const overlays = document.querySelectorAll('.modal-overlay');
    if (!overlays.length) return;
    const top = overlays[overlays.length - 1];
    const btns = [...top.querySelectorAll('.modal-actions button')].map((b) => ({
      el: b,
      text: b.textContent || '',
      danger: b.classList.contains('danger') || b.classList.contains('destructive'),
    }));
    // Never B-activate a destructive action: prefer Cancel/Close, fall back
    // to the first benign button, and leave all-danger dialogs open.
    const i = pickDismissButton(btns);
    if (i >= 0) { try { btns[i].el.click(); } catch { /* ignore */ } }
    this.setFocus(null);
  },

  tabButtons() {
    return [...document.querySelectorAll('#tabbar .tab-btn')].filter(
      (b) => b.dataset.tab && b.getClientRects().length > 0
    );
  },

  cycleTab(dir) {
    const tabs = this.tabButtons();
    if (tabs.length < 2) return;
    let i = tabs.findIndex((b) => b.classList.contains('active'));
    if (i < 0) i = 0;
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    try { next.click(); } catch { /* ignore */ }
    this.setFocus(null);
    // Land the ring on the new panel once it renders.
    setTimeout(() => {
      const items = this.focusables();
      if (items.length) this.setFocus(items[0]);
    }, 60);
  },

  gotoSettings() {
    const tabs = this.tabButtons();
    const s = tabs.find((b) => b.dataset.tab === 'settings');
    if (s) { try { s.click(); } catch { /* ignore */ } this.setFocus(null); }
  },

  scrollBy(dx, dy) {
    const t = this.focusEl || this.scope();
    let el = t;
    while (el && el !== document.body) {
      const st = getComputedStyle(el);
      if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 4) break;
      el = el.parentElement;
    }
    if (el && el !== document.body) {
      el.scrollTop += dy;
      el.scrollLeft += dx;
    } else {
      window.scrollBy(dx, dy);
    }
  },

  toast(msg) {
    try {
      const d = document.createElement('div');
      d.className = 'gpad-toast';
      d.textContent = msg;
      document.body.appendChild(d);
      setTimeout(() => d.classList.add('show'), 20);
      setTimeout(() => { d.classList.remove('show'); setTimeout(() => d.remove(), 400); }, 2600);
    } catch { /* ignore */ }
  },
};

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => GamepadNav.init());
  } else {
    GamepadNav.init();
  }
}

export default GamepadNav;
