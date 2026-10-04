# Throne of Shadows: Remaster

A classic RPG idle game rebuilt from the ground up. No prestige resets — progression comes from hard-earned gear, community bottlenecks, and tactical preparation.

## Core Design Philosophy

- **No rebirth system.** Power comes from gear, not resets.
- **Data-driven balance.** All tuning lives in `public/balance.json`. No code changes needed.
- **Classic MMO progression.** Three raid tiers with attunement chains, resistance gates, and weekly lockouts.

## Progression Overview

```
[Level 60]
    │
    ▼
🏰 Tier 0: Dungeon Loops → Farm 150 Fire Resistance
    │   (Scholomance, Stratholme, Blackrock Spire)
    ▼
🌋 Tier 1: Molten Depths (K=100) → Epic gear + Onyxia Scales
    │   1.5M HP boss, 1000 fire/tick, 7-day lockout
    ▼ (lockout downtime)
📜 Attunement: Forge Drakefire Amulet (+15 FR)
    │   3-step quest chain across dungeons
    │   Craft Onyxia Scale Cloak (8 scales from Tier 1)
    ▼
🐉 Tier 2: Dragon's Lair (K=180) → Tier 2 gear
    │   2.5M HP boss, 1200 fire/tick, 270 FR target
    │   Shadow-Flame cloak check (binary gate)
    │   7-day lockout
    ▼ (lockout downtime)
🏜️ War Effort: Server-wide material drive → Unlocks Tier 3
    │   Dynamic population scaling
    │   10,000 point target (Thorium, Plaguebloom, Bandages)
    ▼
🏛️ Tier 3: Desert Hive (K=250) → Tier 2.5 Tokens
    │   3.5M HP boss, 1500 nature/tick, 375 NR target
    │   600s enrage timer, 7-day lockout
    ▼
⚖️ Cenarion Hold Vendor → Trade tokens + rep + gold for Tier 2.5 gear
```

## Key Systems

### Resistance Math
```
damage_taken = base_damage × (1 - resistance / (resistance + K))
```
Smooth diminishing returns. Higher K = harder tier.

| Tier | K | Base Dmg | Target | Mitigation |
|------|---|----------|--------|------------|
| 1 | 100 | 1000 fire | 150 FR | 60% |
| 2 | 180 | 1200 fire | 270 FR | 60% |
| 3 | 250 | 1500 nature | 375 NR | 60% |

### AI Director (`selectOptimalFarmingZone`)
Automatically routes players to the most efficient farm based on:
- Missing gear slots
- Drop rates and run times
- Attunement quest progress (during lockouts)
- Crafting material needs

### Raid Simulation (`simulateRaid`)
Deterministic 2-second round combat:
- 40 raiders × 150 DPS
- Boss aura damage → `resistedDamage()` per player FR/NR
- Healer mana pool drains at 0.2 mana/HP healed
- OOM → death cascade → potential wipe
- Tracks exact OOM timestamp for wipe reports

### 7-Day Lockouts
Unix timestamps in `state.lockouts`. Survive refreshes. Live countdown UI.

### Offline Progress
- 12-hour cap
- 500 gold/hr, 50 rep/hr, material drip
- Welcome-back popup on login

## File Structure

```
public/
  balance.json          # ALL tuning - edit this, not code
  index.html            # Main page
  css/style.css         # Styles
  js/
    engine.js           # Game logic, combat, resistance, raids
    ui.js               # All UI panels and popups
    app.js              # Boot, save, tick loops
assets/
  spells/               # 56 spell icons (7 classes × 8)
  directive-panel.html  # AI Director panel template
```

## Balance Config

Everything tunable lives in `public/balance.json`:
- `systems.resistance_scaling` — the damage formula
- `systems.offline_progress` — offline rates and caps
- `content_tiers` — all 4 tiers with gate mechanics and raid sim params
- `tier_0_loot_tables` — dungeon drops with rates
- `tier_1_loot_tables` / `tier_2_loot_table` — raid drops
- `attunement_chains` — quest steps and drops
- `crafting_recipes` — material costs and stats
- `server_events` — War Effort config
- `tier_2_5_token_exchange` — vendor items and requirements

## UI Panels

| Panel | Purpose |
|-------|---------|
| AI Director | Current farming directive, FR progress, efficiency scores |
| Raid Ready | Celebration + launch button at 150 FR |
| Loot Popup | Epic/legendary reveal with staggered animations |
| Wipe Report | Diagnostic timeline (OOM moment, death cascade) |
| Tier 2 Lobby | Cloak check, FR gauge, launch button |
| War Effort | Server progress, material contributions |
| Token Vendor | Tier 2.5 exchange (token + rep + gold) |
| Gate Cinematic | Server-wide unlock notification |
| Forging Popup | Drakefire Amulet celebration |
| Offline Report | Welcome-back earnings summary |

## Level Caps
- Account players: 60
- Guests: 20
- 1 talent point per level

## Development Notes
- This is a remaster fork. Do not push to the live repository.
- Original game: https://throne-of-shadows.onrender.com/
- All spell icons generated 2026-10-04
- Balance config version: see `balance.json` `_version` field
