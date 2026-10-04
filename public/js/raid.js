// ============================================================
// raid.js — Raid mode: endless-wave PvE.
// ESM module. Pure except for module-level run state (decoupled from
// engine state; best-wave persistence lives on state.raid via engine.js).
//
// WIRING (for app.js — the parent agent owns this part):
//   import { Raid } from './raid.js';
//
//   1. Mode switch: the #mode-switch button with data-mode="raid" already
//      routes through your mode handler. When the new mode is 'raid',
//      call `Raid.enter(state)` and use the returned enemy as the current
//      enemy (it spawns wave 1). When leaving raid mode, call `Raid.exit()`.
//   2. Enemy killed: if `Raid.isActive()`, call
//        const loot = Raid.onKill(state);
//      `loot` = { wave, boss, goldMult, lootTier }. Apply goldMult to the
//      kill's gold reward and pass lootTier as the minIdx to
//      Engine.rollLoot() (raid bosses guarantee epic+). Then spawn the
//      next wave with `Raid.spawnEnemy(state)`.
//   3. Hero died: if `Raid.isActive()`, call `Raid.onDeath()`.
//      Returns { wavesCleared, best }. The run ends (loot already kept);
//      respawn the hero / return to the normal stage as you do for deaths.
//   4. State load: call `Raid.init(state)` (normalizes state.raid).
//      (Rebirth mutates the state in place, so the best-wave record
//      survives it automatically — no carry-over call needed.)
//
// UX notes: wave + best-wave are available via Raid.wave() and
// Raid.best(state) — show them in the enemy-stage label, e.g.
// "Raid — Wave 7 (best 12)".
// ============================================================

import {
  raidEnemyFor,
  isRaidBoss,
  raidWaveScaling,
  ensureRaidState,
} from './engine.js?v20261003bi';

// Module-level run state (not saved; the run always restarts at wave 1).
let _active = false;
let _wave = 0;

export const Raid = {
  // Normalize state.raid = { best: 0 }. Safe on old saves.
  init(state) {
    ensureRaidState(state);
    // Safety: if page reloaded mid-raid, module state is lost — reset mode to
    // avoid inconsistent state (mode='raid' but no active run).
    if (!_active && state && state.mode === 'raid') state.mode = 'normal';
    return state && state.raid ? state.raid : null;
  },

  // Start a raid run. Sets mode='raid', wave 1. Returns the wave-1 enemy.
  enter(state) {
    // Safety: guard against null/undefined state.
    if (!state || typeof state !== 'object') return null;
    ensureRaidState(state);
    _active = true;
    _wave = 0;
    state.mode = 'raid';
    return this.spawnEnemy(state);
  },

  // Leave raid mode (no penalty; loot already kept).
  exit() {
    _active = false;
    _wave = 0;
  },

  isActive() {
    return _active;
  },

  // Current wave number (0 when no run is active).
  wave() {
    return _wave;
  },

  // Best wave ever reached (persisted on state.raid).
  best(state) {
    ensureRaidState(state);
    // Safety: guard against corrupted state.raid.
    return (state && state.raid && typeof state.raid.best === 'number') ? state.raid.best : 0;
  },

  // Spawn the next wave's enemy. Returns the enemy object
  // (Engine.raidEnemyFor shape: { name, stage, boss, raidWave, hp, maxHp,
  // attack, emoji, lootTier, goldMult }).
  spawnEnemy(state) {
    // Safety: guard against null/undefined state.
    if (!state || typeof state !== 'object') return null;
    ensureRaidState(state);
    _active = true;
    _wave = Math.max(1, _wave + 1);
    state.mode = 'raid';
    return raidEnemyFor(_wave, state.stage);
  },

  // Call when the current raid enemy is killed.
  // Updates the best-wave record. Returns loot info for the kill:
  //   { wave, boss, goldMult, lootTier }
  // The caller then spawns the next wave via Raid.spawnEnemy(state).
  onKill(state) {
    // Safety: return safe defaults on null/undefined state.
    if (!state || typeof state !== 'object') return { wave: 0, boss: false, goldMult: 1, lootTier: 0 };
    ensureRaidState(state);
    const wave = _wave;
    const boss = isRaidBoss(wave);
    if (wave > state.raid.best) state.raid.best = wave;
    const { goldMult } = raidWaveScaling(wave);
    return { wave, boss, goldMult, lootTier: boss ? 3 : 0 };
  },

  // Call when the hero dies mid-raid. Ends the run; all loot earned
  // during the run is kept. Returns { wavesCleared, best }.
  // Note: caller must reset state.mode — the raid run is over.
  onDeath(state) {
    const wavesCleared = _wave;
    _active = false;
    _wave = 0;
    const best = state && state.raid ? this.best(state) : null;
    return { wavesCleared, best }; // best lives on state.raid
  },
};
