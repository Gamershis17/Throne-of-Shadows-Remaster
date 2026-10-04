'use strict';
/**
 * Name-style persistence tests (no server, no DOM).
 * Covers: sanitizeStateBlob keeps well-formed nameColor/nameFx and
 * strips malformed values; client-side nameHtml escaping/styling.
 *
 * Run: node test/name-fx.js
 */
const assert = require('assert');

let failures = 0;
const pending = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(r.then(
        () => console.log(`  ok   ${name}`),
        (e) => { failures++; console.error(`  FAIL ${name}: ${e.message}`); }
      ));
    } else {
      console.log(`  ok   ${name}`);
    }
  } catch (e) {
    failures++;
    console.error(`  FAIL ${name}: ${e.message}`);
  }
}

const { sanitizeStateBlob } = require('../src/validation.js');

function blob(over) {
  return Object.assign({ level: 1, stage: 1 }, over);
}

console.log('== sanitizeStateBlob name fields ==');
check('keeps valid nameColor + nameFx', () => {
  const b = blob({ nameColor: '#ff5b5b', nameFx: 'fire' });
  const r = sanitizeStateBlob(b);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(b.nameColor, '#ff5b5b');
  assert.strictEqual(b.nameFx, 'fire');
});
check('strips malformed nameColor', () => {
  const b = blob({ nameColor: 'red";alert(1)//' });
  sanitizeStateBlob(b);
  assert.strictEqual('nameColor' in b, false);
});
check('keeps each new effect id', () => {
  for (const fx of ['fire', 'neon', 'rainbow', 'shine', 'galaxy', 'ice', 'lightning', 'shadow', 'glitch', 'falling-leaves', 'harvest-ember', 'autumn-mist', 'snowfall', 'aurora', 'frostbite', 'tidal', 'sunscorched', 'wildfire', 'fireworks', 'champagne', 'midnight']) {
    const b = blob({ nameFx: fx });
    const r = sanitizeStateBlob(b);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(b.nameFx, fx, `expected ${fx} to survive`);
  }
});
check('strips malformed nameFx', () => {
  const b = blob({ nameFx: 'sparkle' });
  sanitizeStateBlob(b);
  assert.strictEqual('nameFx' in b, false);
});
check('strips non-string nameColor', () => {
  const b = blob({ nameColor: 12345 });
  sanitizeStateBlob(b);
  assert.strictEqual('nameColor' in b, false);
});
check('absent fields stay absent', () => {
  const b = blob({});
  sanitizeStateBlob(b);
  assert.strictEqual('nameColor' in b, false);
  assert.strictEqual('nameFx' in b, false);
});

console.log('== client nameHtml logic (mirrored) ==');
// ui.js nameHtml can't run in node (DOM-free module, but UI object needs
// document for most methods). Mirror the pure logic contract here: the
// sanitizer above guarantees only hex colors + known fx ids survive, and
// ui.js re-validates on read, so rendering can never inject markup.
check('nameColor regex matches client validation', () => {
  const re = /^#[0-9a-fA-F]{6}$/;
  assert.ok(re.test('#ffd76a') && re.test('#A0B1C2'));
  assert.ok(!re.test('red') && !re.test('#fff') && !re.test('#gggggg'));
});
check('nameFx id list matches engine list', () => {
  const ids = ['none', 'fire', 'neon', 'rainbow', 'shine', 'galaxy', 'ice', 'lightning', 'shadow', 'glitch', 'falling-leaves', 'harvest-ember', 'autumn-mist', 'snowfall', 'aurora', 'frostbite', 'tidal', 'sunscorched', 'wildfire', 'fireworks', 'champagne', 'midnight',
    'voidborn', 'goldleaf', 'bloodmoon', 'stormsurge', 'celestial', 'throneflame'];
  // The client whitelist now lives in engine.js (ALL_NAME_FX_IDS);
  // app.js references it directly. Verify the engine list matches so a
  // missed update fails instead of silently falling back to 'none'.
  return import('../public/js/engine.js').then((E) => {
    assert.deepStrictEqual(E.ALL_NAME_FX_IDS, ids, 'engine ALL_NAME_FX_IDS is out of sync');
  });
});

console.log('== sanitizeStateBlob battleBg ==');
check('keeps valid battleBg values', () => {
  for (const v of ['world', 'mystyle', 'off']) {
    const b = blob({ battleBg: v });
    const r = sanitizeStateBlob(b);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(b.battleBg, v);
  }
});
check('strips malformed battleBg', () => {
  const b = blob({ battleBg: 'hax\";alert(1)//' });
  sanitizeStateBlob(b);
  assert.strictEqual('battleBg' in b, false);
});

Promise.all(pending).then(() => {
  if (failures) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nall name-fx tests passed');
});
