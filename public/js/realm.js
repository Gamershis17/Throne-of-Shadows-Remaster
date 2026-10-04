// ============================================================
//  Global Player Origins / Realm Network — isolated UI component.
//  Shows active regional nodes (aggregate counts only, no usernames).
//
//  Modes:
//    - HD (default): capped-DPR canvas constellation with a gentle rAF
//      drift. Respects prefers-reduced-motion (static frame, no loop).
//    - Performance (body.perf) or SD graphics (.gfx-sd): static DOM
//      list with proportional bars — no canvas, no rAF.
//
//  Lifecycle: Realm.open() builds + shows the modal (idempotent),
//  Realm.close() stops animation and fully detaches the modal + backdrop
//  from the DOM (so nothing invisible can block taps), Realm.destroy()
//  tears everything down including the visibility listener. Animations
//  also pause when the tab is hidden. The HD canvas now spins a slow,
//  continuous 360° (~24s per turn); labels stay upright.
//  A failed fetch keeps the last good data instead of erroring out.
// ============================================================

import { api } from './api.js?v=20260930ar';
import { COUNTRIES, countryFlag } from './engine.js?v20261003bi';

const NAMES = Object.fromEntries(COUNTRIES);
const MAX_DPR = 2;
const FETCH_TIMEOUT_MS = 10000;

function regionLabel(code) {
  if (code === '??') return 'Uncharted';
  return NAMES[code] || code;
}

function lowFxMode() {
  try {
    return document.body.classList.contains('perf') ||
      document.documentElement.classList.contains('gfx-sd');
  } catch { return true; }
}

function reducedMotion() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}

export const Realm = {
  _overlay: null,
  _canvas: null,
  _ctx: null,
  _list: null,
  _meta: null,
  _raf: 0,
  _nodes: [],
  _data: null,      // last good { regions, total, at }
  _bound: false,
  _onVis: null,

  open() {
    try {
      this._build();
      this._overlay.classList.add('show');
      this._refresh();
    } catch { /* never break the game loop */ }
  },

  close() {
    try {
      this._stopLoop();
      // Fully detach the modal + backdrop from the DOM: a hidden overlay
      // must never linger to intercept taps on the game underneath.
      if (this._overlay && this._overlay.parentNode) {
        this._overlay.parentNode.removeChild(this._overlay);
      }
      this._overlay = this._canvas = this._ctx = this._list = this._meta = null;
      this._nodes = [];
    } catch { /* ignore */ }
  },

  destroy() {
    try {
      this._stopLoop();
      if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
      if (this._overlay && this._overlay.parentNode) this._overlay.parentNode.removeChild(this._overlay);
      this._overlay = this._canvas = this._ctx = this._list = this._meta = null;
      this._nodes = [];
      this._bound = false;
    } catch { /* ignore */ }
  },

  // ---- build ---------------------------------------------------

  _build() {
    if (this._overlay) return;
    const doc = document;

    const overlay = doc.createElement('div');
    overlay.className = 'modal-overlay realm-overlay';
    overlay.id = 'realm-overlay';

    const modal = doc.createElement('div');
    modal.className = 'modal realm-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Global Player Origins');

    const title = doc.createElement('h2');
    title.className = 'modal-title';
    title.textContent = '🌐 Realm Network';

    const sub = doc.createElement('p');
    sub.className = 'muted small realm-sub';
    sub.textContent = 'Active regional nodes — heroes whose saves updated in the last ~15 minutes.';

    const meta = doc.createElement('p');
    meta.className = 'muted small realm-meta';
    meta.id = 'realm-meta';
    meta.textContent = 'Consulting the void…';

    const canvas = doc.createElement('canvas');
    canvas.className = 'realm-canvas';
    canvas.id = 'realm-canvas';

    const list = doc.createElement('div');
    list.className = 'realm-list';
    list.id = 'realm-list';

    const actions = doc.createElement('div');
    actions.className = 'modal-actions';
    const refreshBtn = doc.createElement('button');
    refreshBtn.className = 'btn small ghost';
    refreshBtn.textContent = '↻ Refresh';
    refreshBtn.addEventListener('click', () => this._refresh(true));
    const closeBtn = doc.createElement('button');
    closeBtn.className = 'btn small';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this.close());
    actions.appendChild(refreshBtn);
    actions.appendChild(closeBtn);

    modal.appendChild(title);
    modal.appendChild(sub);
    modal.appendChild(meta);
    modal.appendChild(canvas);
    modal.appendChild(list);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    doc.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });
    // The visibility listener is bound once for the lifetime of the page:
    // close() detaches the overlay, and open() rebuilds it, so binding here
    // on every build would stack duplicate listeners.
    if (!this._bound) {
      this._onVis = () => {
        if (document.hidden) this._stopLoop();
        else if (this._overlay && this._overlay.classList.contains('show') && this._data) this._render();
      };
      document.addEventListener('visibilitychange', this._onVis);
      this._bound = true;
    }

    this._overlay = overlay;
    this._canvas = canvas;
    this._list = list;
    this._meta = meta;
  },

  // ---- data ----------------------------------------------------

  _refresh(force) {
    const meta = this._meta;
    if (meta) meta.textContent = this._data ? 'Refreshing…' : 'Consulting the void…';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; }, FETCH_TIMEOUT_MS);
    api.realmNetwork()
      .then((res) => {
        clearTimeout(timer);
        if (timedOut) return;
        const regions = Array.isArray(res && res.regions) ? res.regions : [];
        const total = regions.reduce((n, r) => n + (Number(r.count) || 0), 0);
        this._data = { regions, total, at: Date.now(), stale: false };
        this._render();
      })
      .catch(() => {
        clearTimeout(timer);
        // Failed fetch: keep the last good data, mark it stale.
        if (this._data) {
          this._data.stale = true;
          this._render();
        } else if (meta) {
          meta.textContent = 'The void is silent. Try again soon.';
        }
      });
  },

  // ---- render --------------------------------------------------

  _render() {
    const d = this._data;
    if (!d || !this._overlay) return;
    const hd = !lowFxMode();
    try { this._canvas.style.display = hd ? '' : 'none'; } catch {}
    try { this._list.style.display = hd ? 'none' : ''; } catch {}

    const ago = Math.max(0, Math.round((Date.now() - d.at) / 1000));
    const agoTxt = ago < 5 ? 'just now' : ago < 60 ? ago + 's ago' : Math.round(ago / 60) + 'm ago';
    if (this._meta) {
      const n = d.regions.length;
      this._meta.textContent =
        (d.total === 0 ? 'No active nodes right now.' :
          d.total + ' hero' + (d.total === 1 ? '' : 'es') + ' across ' + n + ' region' + (n === 1 ? '' : 's')) +
        ' · updated ' + agoTxt + (d.stale ? ' (last known)' : '');
    }

    if (hd) {
      try { this._renderCanvas(d); }
      catch { this._renderListFallback(this._canvas); }
    } else this._renderList(d);
  },

  _renderList(d) {
    const list = this._list;
    if (!list) return;
    list.innerHTML = '';
    const max = Math.max(1, ...d.regions.map(r => Number(r.count) || 0));
    const doc = document;
    for (const r of d.regions) {
      const count = Number(r.count) || 0;
      const row = doc.createElement('div');
      row.className = 'realm-row';
      const flag = doc.createElement('span');
      flag.className = 'realm-flag';
      flag.textContent = countryFlag(r.region);
      const name = doc.createElement('span');
      name.className = 'realm-name';
      name.textContent = regionLabel(r.region);
      const bar = doc.createElement('div');
      bar.className = 'realm-bar';
      const fill = doc.createElement('div');
      fill.className = 'realm-fill';
      fill.style.width = Math.max(2, Math.round((count / max) * 100)) + '%';
      bar.appendChild(fill);
      const num = doc.createElement('span');
      num.className = 'realm-count';
      num.textContent = String(count);
      row.appendChild(flag);
      row.appendChild(name);
      row.appendChild(bar);
      row.appendChild(num);
      list.appendChild(row);
    }
    if (!d.regions.length) {
      const p = doc.createElement('p');
      p.className = 'muted small';
      p.textContent = 'No active nodes right now.';
      list.appendChild(p);
    }
  },

  _renderCanvas(d) {
    const canvas = this._canvas;
    if (!canvas) return;
    const size = Math.min(420, Math.max(260, canvas.parentNode ? canvas.parentNode.clientWidth - 32 : 320));
    const dpr = Math.min(MAX_DPR, (window.devicePixelRatio || 1));
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) { this._renderListFallback(canvas); return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._ctx = ctx;

    // Lay nodes on a ring; radius scales with sqrt(count).
    const cx = size / 2, cy = size / 2;
    const ring = size * 0.36;
    const max = Math.max(1, ...d.regions.map(r => Number(r.count) || 0));
    this._nodes = d.regions.slice(0, 24).map((r, i, arr) => {
      const a = (i / Math.max(1, arr.length)) * Math.PI * 2 - Math.PI / 2;
      const count = Number(r.count) || 0;
      return {
        region: r.region, count,
        x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring,
        baseX: cx + Math.cos(a) * ring, baseY: cy + Math.sin(a) * ring,
        r: 5 + 11 * Math.sqrt(count / max),
        phase: (i * 1.7) % (Math.PI * 2),
        label: (countryFlag(r.region) || '◆') + ' ' + count,
      };
    });

    this._drawFrame(0);
    if (!reducedMotion()) this._startLoop();
  },

  // Canvas 2d unavailable: fall back to the DOM list.
  _renderListFallback(canvas) {
    try { canvas.style.display = 'none'; this._list.style.display = ''; } catch {}
    if (this._data) this._renderList(this._data);
  },

  _startLoop() {
    this._stopLoop();
    let t = 0;
    const step = () => {
      t += 0.016;
      this._drawFrame(t);
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  },

  _stopLoop() {
    if (this._raf) {
      try { cancelAnimationFrame(this._raf); } catch {}
      this._raf = 0;
    }
  },

  _drawFrame(t) {
    const ctx = this._ctx, canvas = this._canvas;
    if (!ctx || !canvas) return;
    const size = canvas.width / Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const cx = size / 2, cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    const ns = this._nodes;
    // Nodes: gentle orbital drift, then the whole disc rotates slowly —
    // one full 360° turn every ~24s. Labels stay upright while the
    // constellation spins beneath them.
    for (const n of ns) {
      n.x = n.baseX + 3 * Math.sin(t * 0.8 + n.phase);
      n.y = n.baseY + 3 * Math.cos(t * 0.6 + n.phase);
    }
    const rot = t * (Math.PI * 2 / 24);
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const px = new Array(ns.length), py = new Array(ns.length);
    for (let i = 0; i < ns.length; i++) {
      const dx = ns[i].x - cx, dy = ns[i].y - cy;
      px[i] = cx + dx * cosR - dy * sinR;
      py[i] = cy + dx * sinR + dy * cosR;
    }

    // Constellation web: each node links to its two neighbors.
    ctx.strokeStyle = 'rgba(167,139,250,0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i < ns.length; i++) {
      for (const j of [(i + 1) % ns.length, (i + 2) % ns.length]) {
        if (j === i || !ns[j]) continue;
        ctx.beginPath();
        ctx.moveTo(px[i], py[i]);
        ctx.lineTo(px[j], py[j]);
        ctx.stroke();
      }
    }

    // Core glow.
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.16);
    core.addColorStop(0, 'rgba(255,210,63,0.35)');
    core.addColorStop(1, 'rgba(255,210,63,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.16, 0, Math.PI * 2);
    ctx.fill();

    // Nodes: twinkle at their rotated positions; labels stay upright.
    ctx.textAlign = 'center';
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i], x = px[i], y = py[i];
      const tw = 0.55 + 0.45 * Math.sin(t * 2 + n.phase);
      const g = ctx.createRadialGradient(x, y, 0, x, y, n.r * 2.4);
      g.addColorStop(0, 'rgba(255,210,63,' + (0.5 * tw + 0.25).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(167,139,250,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, n.r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,236,170,' + (0.65 + 0.35 * tw).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(x, y, n.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(232,220,255,0.9)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(n.label, x, y + n.r + 14);
    }

    // 🌎 globe at the heart of the realm network — static at the center
    // while the constellation spins around it.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.round(size * 0.22) + 'px serif';
    ctx.fillText('🌎', cx, cy);
  },
};
