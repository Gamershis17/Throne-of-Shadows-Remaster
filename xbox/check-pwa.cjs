// Throne of Shadows — PWA health check (general hygiene, not the packaging route).
// Xbox packaging uses the UWP WebView2 wrapper in xbox/uwp/ (see xbox/README.md);
// this script validates manifest, icons, service worker, and gamepad wiring.
// Run:  node xbox/check-pwa.cjs   (from the repo root)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
const ok = (name, cond, hint = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !hint ? '' : '  — ' + hint}`);
};
const read = (p) => {
  try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return null; }
};
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// 1. Web manifest
const manRaw = read('public/manifest.webmanifest');
ok('manifest exists', !!manRaw);
let man = null;
try { man = JSON.parse(manRaw); ok('manifest is valid JSON', true); }
catch { ok('manifest is valid JSON', false); }
if (man) {
  ok('manifest.name', !!man.name, JSON.stringify(man.name));
  ok('manifest.start_url', typeof man.start_url === 'string', 'needs a start_url');
  ok('manifest.display is standalone/fullscreen',
    ['standalone', 'fullscreen'].includes(man.display), `display=${man.display}`);
  ok('manifest.theme_color', !!man.theme_color);
  const icons = Array.isArray(man.icons) ? man.icons : [];
  const has512 = icons.some((i) => /512/.test(i.sizes || ''));
  const hasMaskable = icons.some((i) => (i.purpose || '').includes('maskable'));
  ok('manifest has a 512x512 icon', has512);
  ok('manifest has a maskable icon', hasMaskable);
  for (const i of icons) ok(`icon file exists: ${i.src}`, exists('public/' + String(i.src).replace(/^\//, '')));
}

// 2. Service worker
const sw = read('public/sw.js');
ok('service worker exists', !!sw);
ok('service worker handles fetch', !!sw && sw.includes("addEventListener('fetch'"));
ok('service worker never caches /api/*', !!sw && /api/.test(sw) && sw.includes('isApi'));

// 3. index.html wiring
const html = read('public/index.html');
ok('index.html links the manifest', !!html && html.includes('rel="manifest"'));
ok('index.html sets theme-color', !!html && html.includes('name="theme-color"'));
ok('index.html loads gamepad.js', !!html && html.includes('js/gamepad.js'));

// 4. Gamepad module + styles
const gp = read('public/js/gamepad.js');
ok('gamepad.js exists', !!gp);
ok('gamepad.js uses the Gamepad API', !!gp && gp.includes('getGamepads'));
const css = read('public/css/style.css');
ok('gamepad focus-ring styles exist', !!css && css.includes('.gpad-focus'));

// 5. HTTPS note (packaging target must be served over HTTPS)
console.log('\nLive URL must be HTTPS: https://throne-of-shadows.onrender.com/ (Render serves HTTPS by default)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
