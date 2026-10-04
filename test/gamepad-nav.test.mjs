// Throne of Shadows — gamepad navigation unit tests.
// Run:  node test/gamepad-nav.test.mjs   (from the repo root)
import assert from 'node:assert/strict';
import { pickInDirection, pickDismissButton, repeatStep } from '../public/js/gamepad.js';

let n = 0;
const t = (name, fn) => { n++; fn(); console.log(`ok ${n} - ${name}`); };

// ---- pickInDirection -------------------------------------------------------
t('picks the nearest target straight down', () => {
  const cur = { x: 0, y: 0 };
  const pts = [{ x: 0, y: 100 }, { x: 0, y: 300 }, { x: 200, y: 100 }];
  assert.equal(pickInDirection(cur, pts, 'down'), 0);
});
t('picks the nearest target straight up', () => {
  const cur = { x: 0, y: 200 };
  const pts = [{ x: 0, y: 100 }, { x: 0, y: 0 }];
  assert.equal(pickInDirection(cur, pts, 'up'), 0);
});
t('prefers straight-line targets over diagonal ones', () => {
  const cur = { x: 0, y: 0 };
  const pts = [{ x: 90, y: 100 }, { x: 0, y: 110 }];
  assert.equal(pickInDirection(cur, pts, 'down'), 1);
});
t('ignores targets behind the direction', () => {
  const cur = { x: 0, y: 0 };
  const pts = [{ x: 0, y: -50 }, { x: 100, y: 0 }];
  assert.equal(pickInDirection(cur, pts, 'down'), -1);
});
t('left/right resolve on the x axis', () => {
  const cur = { x: 100, y: 100 };
  const pts = [{ x: 0, y: 100 }, { x: 200, y: 100 }];
  assert.equal(pickInDirection(cur, pts, 'left'), 0);
  assert.equal(pickInDirection(cur, pts, 'right'), 1);
});
t('returns -1 when nothing lies that way', () => {
  assert.equal(pickInDirection({ x: 0, y: 0 }, [{ x: 50, y: 50 }], 'up'), -1);
});
t('unknown direction returns -1', () => {
  assert.equal(pickInDirection({ x: 0, y: 0 }, [{ x: 0, y: 50 }], 'sideways'), -1);
});

// ---- pickDismissButton (B-button safety) -----------------------------------
const B = (text, danger = false) => ({ text, danger });

t('UI.confirm picks Cancel, never the destructive Confirm', () => {
  const btns = [B('Cancel'), B('Delete save', true)];
  assert.equal(pickDismissButton(btns), 0);
});
t('finds Cancel even when it is not first', () => {
  const btns = [B('Delete save', true), B('Cancel')];
  assert.equal(pickDismissButton(btns), 1);
});
t('matches dismiss labels case-insensitively', () => {
  assert.equal(pickDismissButton([B('CANCEL'), B('OK', true)]), 0);
  assert.equal(pickDismissButton([B('Close')]), 0);
});
t('benign single-button dialogs dismiss via that button', () => {
  assert.equal(pickDismissButton([B('OK')]), 0);
  assert.equal(pickDismissButton([B('Nice!')]), 0);
  assert.equal(pickDismissButton([B('Got it')]), 0);
});
t('prefers an explicit dismiss label over other benign buttons', () => {
  assert.equal(pickDismissButton([B('Learn more'), B('Close')]), 1);
});
t('all-destructive dialogs return -1 (B does nothing)', () => {
  assert.equal(pickDismissButton([B('Delete', true)]), -1);
  assert.equal(pickDismissButton([B('Yes, nuke it', true), B('Confirm', true)]), -1);
});
t('empty button list returns -1', () => {
  assert.equal(pickDismissButton([]), -1);
  assert.equal(pickDismissButton(null), -1);
});

// ---- repeatStep (held-input repeat, per-source state) -----------------------
t('first press moves immediately and arms the 380ms delay', () => {
  const st = { dir: null, nextAt: 0 };
  assert.equal(repeatStep(st, 'right', 1000), true);
  assert.equal(st.dir, 'right');
  assert.equal(st.nextAt, 1380);
});
t('holding before the delay does not move', () => {
  const st = { dir: 'right', nextAt: 1380 };
  assert.equal(repeatStep(st, 'right', 1200), false);
  assert.equal(repeatStep(st, 'right', 1379), false);
});
t('holding past the delay moves and re-arms at 120ms', () => {
  const st = { dir: 'right', nextAt: 1380 };
  assert.equal(repeatStep(st, 'right', 1380), true);
  assert.equal(st.nextAt, 1500);
  assert.equal(repeatStep(st, 'right', 1499), false);
  assert.equal(repeatStep(st, 'right', 1500), true);
});
t('changing direction moves immediately and resets the timer', () => {
  const st = { dir: 'right', nextAt: 99999 };
  assert.equal(repeatStep(st, 'down', 2000), true);
  assert.equal(st.dir, 'down');
  assert.equal(st.nextAt, 2380);
});
t('release resets direction state', () => {
  const st = { dir: 'right', nextAt: 99999 };
  assert.equal(repeatStep(st, null, 2000), false);
  assert.equal(st.dir, null);
});
t('d-pad and stick keep independent repeat state', () => {
  const dpad = { dir: null, nextAt: 0 };
  const stick = { dir: null, nextAt: 0 };
  // D-pad held right at t=1000: moves, next repeat at 1380.
  assert.equal(repeatStep(dpad, 'right', 1000), true);
  // Stick pushed down at t=1100: moves immediately — not blocked by the
  // d-pad's pending repeat.
  assert.equal(repeatStep(stick, 'down', 1100), true);
  assert.equal(stick.nextAt, 1480);
  // D-pad still on its own schedule.
  assert.equal(repeatStep(dpad, 'right', 1100), false);
  assert.equal(repeatStep(dpad, 'right', 1380), true);
  // Releasing the d-pad does not touch the stick's state.
  assert.equal(repeatStep(dpad, null, 1400), false);
  assert.equal(stick.dir, 'down');
  assert.equal(repeatStep(stick, 'down', 1480), true);
});

console.log(`\n${n}/${n} gamepad navigation tests passed.`);
