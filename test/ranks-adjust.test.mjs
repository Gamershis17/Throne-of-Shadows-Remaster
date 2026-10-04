// Ranks adjustment harness: tier-icon revert (no img/ranks), identity-block
// structure (lb-name-meta / lb-name-user), guild rows, empty state.
// Run: node test/ranks-adjust.test.mjs
import { readFileSync } from 'fs';

// ---------- minimal DOM stub ----------
function makeEl(tag = 'div') {
  const cls = new Set();
  const el = {
    tag, children: [], dataset: {}, title: '',
    _html: '', textContent: '',
    className: '',
    classList: {
      add: (...c) => c.forEach((x) => cls.add(x)),
      remove: (...c) => c.forEach((x) => cls.delete(x)),
      toggle: (c, f) => (f === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : (f ? cls.add(c) : cls.delete(c))),
      contains: (c) => cls.has(c),
    },
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
  };
  return el;
}
const lbBody = makeEl('div');
const lbNote = makeEl('div');
const lbMe = makeEl('div');
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
globalThis.requestAnimationFrame = () => 0;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = {
  createElement: (t) => makeEl(t),
  getElementById: (id) => (id === 'lb-me' ? lbMe : null),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  hidden: false,
};

const { UI } = await import('../public/js/ui.js?v=test');
UI.els = { 'lb-body': lbBody, 'lb-note': lbNote };

// ---------- fixtures ----------
const RACES = ['human', 'elf', 'orc', 'undead'];
function hero(i) {
  return {
    username: `Hero_${i}_WithAVeryLongNameForClipping`,
    race: RACES[i % 4], playerClass: 'warrior', spec: 'arms',
    title: i === 0 ? 'the Game Master' : null,
    country: i % 3 === 0 ? 'US' : null,
    badge: i % 5 === 0 ? 'founder' : null,
    guildTag: i % 2 === 0 ? 'SHDW' : null,
    level: 100 - i, stage: 50 - (i % 10), power: 100000 - i * 1000,
    bossesKilled: 500 - i, rebirth: i % 7, kills: 9000 - i * 10,
  };
}
const entries = Array.from({ length: 30 }, (_, i) => hero(i));

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', name); }
}

const uiSrc = readFileSync('public/js/ui.js', 'utf8');
const cssSrc = readFileSync('public/css/style.css', 'utf8');

// 1. Revert: no custom tier images anywhere in the renderer.
t('ui.js has no img/ranks references', !uiSrc.includes('img/ranks'));
t('ui.js has no rankMedal', !uiSrc.includes('rankMedal'));
t('ui.js has no RANK_TIER_ICONS', !uiSrc.includes('RANK_TIER_ICONS'));
t('css has no lb-medal-img/lb-medal-fb rules', !/lb-medal-(img|fb)/.test(cssSrc));
t('css has lb-name-user rule', cssSrc.includes('.lb-name-user'));
t('css has lb-medal-emoji rule', cssSrc.includes('.lb-medal-emoji'));

// 2. Render heroes.
let threw = null;
try { UI.renderRanks(entries, 'Hero_7_WithAVeryLongNameForClipping', 'level', {}); }
catch (e) { threw = e; }
t('renderRanks does not throw', threw === null);
t('30 rows rendered', lbBody.children.length === 30);

const html = (i) => lbBody.children[i].innerHTML;
t('row 0 has 🥇', html(0).includes('🥇'));
t('row 1 has 🥈', html(1).includes('🥈'));
t('row 2 has 🥉', html(2).includes('🥉'));
t('row 5 has #6 pill, no medals', html(5).includes('#6') && !/[🥇🥈🥉]/.test(html(5)));
t('no <img in any row', !lbBody.children.some((c) => c.innerHTML.includes('<img')));

// 3. Identity structure / clipping fix.
t('rows have lb-name-meta span', lbBody.children.every((c) => c.innerHTML.includes('lb-name-meta')));
t('rows have lb-name-user span', lbBody.children.every((c) => c.innerHTML.includes('lb-name-user')));
t('rows have framed avatar', lbBody.children.every((c) => c.innerHTML.includes('lb-avatar')));
t('tier badge Sovereign on row 0', html(0).includes('>Sovereign<'));
t('tier badge Elite on row 5', html(5).includes('>Elite<'));
t('tier badge Veteran on row 15', html(15).includes('>Veteran<'));
t('tier badge Adventurer on row 29', html(29).includes('>Adventurer<'));
t('dataset.username set', lbBody.children[0].dataset.username === 'Hero_0_WithAVeryLongNameForClipping');

// 4. Me row.
const meRow = lbBody.children[7];
t('me row gets me-row class', meRow.classList.contains('me-row'));
t('me row has YOU badge', meRow.innerHTML.includes('lb-you'));
t('me banner shows crown emoji only', lbMe.innerHTML.includes('👑') && !lbMe.innerHTML.includes('<img'));

// 5. Guild board.
const guildBody = makeEl('div');
UI.els['lb-body'] = guildBody;
UI.renderGuildRanks([
  { tag: 'AAA', name: 'Alpha Guild With A Long Name', level: 10, memberCount: 25 },
  { tag: 'B', name: 'Beta', level: 8, memberCount: 12 },
  { tag: 'C', name: 'Gamma', level: 5, memberCount: 3 },
  { tag: 'D', name: 'Delta', level: 2, memberCount: 1 },
]);
t('4 guild rows', guildBody.children.length === 4);
t('guild row 0 has 🥇', guildBody.children[0].innerHTML.includes('🥇'));
t('guild rows have no <img', !guildBody.children.some((c) => c.innerHTML.includes('<img')));
t('guild rows have meta/user split', guildBody.children.every((c) => c.innerHTML.includes('lb-name-meta') && c.innerHTML.includes('lb-name-user')));

// 6. Empty state.
UI.els['lb-body'] = lbBody;
UI.renderRanks([], 'nobody', 'level', {});
t('empty board message', lbBody.innerHTML.includes('No heroes yet'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
