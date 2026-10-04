'use strict';
/**
 * Pause-while-browsing UI helper tests (no server, no DOM).
 * Covers UI.anyModalOpen() and UI.setPaused() with stub elements.
 * The full pause state machine (computePaused/updatePauseState/tick
 * freeze, cooldown shifting) is verified in the browser harness
 * (ui-verify/pause-verify.py) where the real game loop runs.
 *
 * Run: node test/pause.js
 */
const assert = require('assert');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${name}: ${e.message}`);
  }
}

function fakeEl() {
  const el = { _hidden: true, children: [] };
  el.classList = {
    toggle: (cls, force) => { if (cls === 'hidden') el._hidden = !!force; },
    contains: (cls) => (cls === 'hidden' ? el._hidden : false),
  };
  return el;
}

(async () => {
  // Minimal document stub: UI helpers must stay null-safe and never throw
  // when elements are missing (stale cached HTML after a deploy).
  const missing = { getElementById: () => null };
  globalThis.document = missing;

  const { UI } = await import('../public/js/ui.js');

  console.log('== pause pill ==');
  check('setPaused(true) shows the pill', () => {
    const el = fakeEl();
    UI.els['pause-pill'] = el;
    UI.setPaused(true);
    assert.strictEqual(el._hidden, false);
  });
  check('setPaused(false) hides the pill', () => {
    const el = fakeEl();
    el._hidden = false;
    UI.els['pause-pill'] = el;
    UI.setPaused(false);
    assert.strictEqual(el._hidden, true);
  });
  check('setPaused never throws when the pill element is missing', () => {
    delete UI.els['pause-pill'];
    UI.setPaused(true); // falls back to document stub -> null -> no-op
    UI.setPaused(false);
  });

  console.log('== modal detection ==');
  check('anyModalOpen() false with no overlays', () => {
    UI.els['modal-root'] = { children: [] };
    assert.strictEqual(UI.anyModalOpen(), false);
  });
  check('anyModalOpen() true while a modal is up', () => {
    UI.els['modal-root'] = { children: [{}] };
    assert.strictEqual(UI.anyModalOpen(), true);
  });
  check('anyModalOpen() false when modal-root is missing', () => {
    delete UI.els['modal-root'];
    assert.strictEqual(UI.anyModalOpen(), false);
  });

  console.log(failures === 0 ? '\nPASS: pause UI checks' : `\nFAIL: ${failures} checks failed`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
