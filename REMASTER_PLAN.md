# Throne of Shadows: Remaster Plan

## Vision
A clean rebuild of Throne of Shadows without the rebirth system, using data-driven balance and original assets only.

## Core Changes from Original

### Removed
- ❌ Rebirth system (no resets, no rebirth-scaled XP)
- ❌ Titles system (none in remaster)
- ❌ Custom backgrounds (only what we build)
- ❌ External/custom assets

### New
- ✅ Data-driven balance (`balance.json` config)
- ✅ 1 talent point per level (into class trees)
- ✅ Level cap: 60 (accounts), 20 (guests)
- ✅ New login page (guest vs account)
- ✅ Original logo and spell icons (built by us)

## Implementation Order
1. ✅ Balance config file (v1.2.0 with resistance + loot tables)
2. ✅ Remove rebirth logic (XP no longer scales, rebirth() disabled)
3. ✅ Per-level talent points (1 per level from level 1)
4. ✅ Level caps (60 account / 20 guest enforced in gainXp)
5. ⏳ New login page (mockup done, WoW-style layout approved)
6. ⏳ Dynamic music system (login theme → in-game theme)
7. ✅ Original logo and spell icons (logo, app icon, all 56 spell icons done)
8. ✅ Remove titles system (TITLE_DEFS emptied)
9. ✅ Remove custom backgrounds (battle bg picker disabled)
10. ✅ Resistance system (resistedDamage, getResistance in engine)
11. ✅ Farming AI director (selectOptimalFarmingZone in engine)
12. ✅ Directive panel UI (wired into main page)
13. ⏳ Testing and tuning

## Directory
`~/workspace/tos-remaster/` (fork of tos-repo at 2026-10-04)
