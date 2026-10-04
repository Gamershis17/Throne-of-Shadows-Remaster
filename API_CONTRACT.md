# King of Project — API & Architecture Contract

All subagents building this project MUST follow this document. It is the single source of truth.

## Architecture

- Backend: Node.js + Express, serves `public/` statically and exposes `/api/*`.
- Database: PostgreSQL via `pg` (node-postgres), connection from `DATABASE_URL`
  (SSL on for non-localhost hosts). Schema is applied at boot by `migrate()`
  from `src/schema.sql` (CREATE TABLE IF NOT EXISTS). Timestamps are BIGINT
  epoch milliseconds. Usernames are case-insensitive via `LOWER()` comparisons
  plus a unique index on `LOWER(username)`.
- The old SQLite implementation is preserved untouched as a fallback in
  `sqlite-legacy/` (see its README); the live server does not use it.
- Game simulation runs **client-side** (vanilla JS). The server is authoritative for: accounts, roles, persisted state, leaderboard, gift codes, GM grants.
- Auth: `express-session` with `connect-pg-simple` (PostgreSQL-backed sessions,
  table `sessions`), `bcryptjs` password hashing.
- Frontend: vanilla JS + CSS, mobile-first, dark fantasy style. No frameworks.

## File layout (must match)

```
~/workspace/rpg-server/
  package.json
  server.js                 # Express app entry: middleware, static, routes, listen
  src/db.js                 # pg pool + schema migrate + all DB helpers (async)
  src/schema.sql            # PostgreSQL schema (applied at boot)
  src/sessionStore.js       # express-session Store via connect-pg-simple (Postgres)
  src/auth.js               # register/login/logout/me middleware + helpers
  src/gameApi.js            # /api/state, /api/leaderboard, /api/redeem
  src/gmApi.js              # /api/gm/*, /api/roles, /api/admins
  src/validation.js         # input validation + state sanity-clamp helpers
  sqlite-legacy/            # untouched backup of the last SQLite implementation
  test/                     # e2e + redeem-race + restart-persistence test scripts
  public/index.html
  public/css/style.css
  public/js/api.js          # fetch wrapper (JSON, credentials: 'same-origin')
  public/js/auth.js         # login/register/logout UI + flow
  public/js/engine.js       # game simulation: combat, xp, loot rolls, prestige, offline calc
  public/js/ui.js           # tabs, rendering, toasts
  public/js/gm.js           # GM console UI (only rendered if role is owner/gm)
  public/js/app.js          # bootstrap, autosave loop
  Dockerfile
  render.yaml
  README.md
  .gitignore
```

## Dependencies (package.json)

express, pg, connect-pg-simple, bcryptjs, express-session, helmet, express-rate-limit.
(`better-sqlite3` is still listed so the `sqlite-legacy/` fallback copy can run,
but the live server never requires it.)
Scripts: `"start": "node server.js"`. Engines: node >= 18.

## Database schema (PostgreSQL — see src/schema.sql)

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',   -- 'owner' | 'gm' | 'admin' | 'player'
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_nocase_uidx ON users (LOWER(username));
CREATE TABLE IF NOT EXISTS player_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1,
  stage INTEGER NOT NULL DEFAULT 1,
  bosses_killed INTEGER NOT NULL DEFAULT 0,
  prestige_count INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS gift_codes (
  code TEXT PRIMARY KEY,
  gear_set TEXT NOT NULL,                 -- 'sovereign' | 'fateweaver' | 'warden'
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS code_redemptions (
  code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  redeemed_at BIGINT NOT NULL,
  PRIMARY KEY (code, user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);
```

Notes vs the old SQLite schema: `id` is `SERIAL` instead of
`INTEGER PRIMARY KEY AUTOINCREMENT`; case-insensitive username uniqueness comes
from the `LOWER(username)` unique index (all lookups use `LOWER()`); timestamps
stay BIGINT epoch-ms except `sessions.expire`, which is a real timestamp because
`connect-pg-simple` manages it. Gift-code redemption runs in a transaction with
`SELECT ... FOR UPDATE` on the gift_codes row so concurrent redemptions cannot
double-spend.

## Roles

- `owner`: seeded on first run from env `OWNER_USERNAME` / `OWNER_PASSWORD` (if set and no owner exists). Full power: GM console + role management.
- `gm`: GM console (grant stars/gear, create gift codes, manage admin roster). Cannot change roles.
- `admin`: in-game status only (entitled to Admin Warden Arsenal). No console.
- `player`: default.

## HTTP API

All JSON. Session cookie auth. `GET /api/auth/me` returns `{ user: { username, role } }` or 401.

### Auth
- `POST /api/auth/register` `{username, password}` → 201 `{user:{username, role}}` | 400/409 on invalid/taken.
  - username: 3–20 chars, `[A-Za-z0-9_]`. password: min 6 chars.
- `POST /api/auth/login` `{username, password}` → 200 `{user}` | 401.
- `POST /api/auth/logout` → 200 `{ok:true}`.
- Rate limit auth routes: 20 req/min per IP.

### Player state
- `GET /api/state` → 200 `{ state: <state blob>, lastSeenAt: <ms epoch> }`. If no state yet, returns a fresh default blob (see below) and `lastSeenAt: null`.
- `POST /api/state` `{state: <blob>}` → 200 `{ok:true}`. Server sanity-checks: must be object, < 1MB JSON, numeric fields finite; clamps `level, stage` to >= 1, clamps absurd values (level ≤ 100000, stage ≤ 100000, gold/stars ≤ 1e15). Updates indexed columns from blob (`level`, `stage`, `bossesKilled`, `prestigeCount`) for the leaderboard.

### Leaderboard
- `GET /api/leaderboard` → 200 `{ entries: [...], by }`, top 100. `?by=<category>` selects the ranking: `level` (default), `stage`, `bosses`, `kills`, `depth`, `titles`, `rebirths`; unknown values → 400. Indexed categories sort in SQL; `kills`/`depth`/`titles` are extracted server-side from stored `state_json` and sorted in JS. Each entry: `{username, race, title, badge, country, playerClass, spec, level, stage, power, bossesKilled, rebirth, guildTag, kills, depth, titles}` (`guildTag` is the player's guild tag, or null when guildless). No auth required.
- `GET /api/guilds/rankings` → 200 `{ guilds: [{id, name, tag, level, xp, memberCount, totalPower}] }`, top 50 guilds ordered by guild level DESC, then total member power DESC, then member count DESC. No auth required. Powers the leaderboard "Guilds" category.

### Gift codes
- `POST /api/redeem` `{code}` → 200 `{ok:true, set: <gear set id>}` | 400/404/409 (invalid, exhausted, already redeemed). Grants the full gear set into the player's inventory (server merges into `state_json.inventory` and saves).

### GM (requires role owner or gm; role mgmt requires owner)
- `GET /api/gm/overview` → `{role, playerCount, codeCount}`.
- `POST /api/gm/grant` `{username, kind, amount?, set?}` — kind `stars` (amount int 1..100000) or `gear` (set one of sovereign|fateweaver|warden; only owner may grant `sovereign`). Merges into target's saved state. → `{ok:true}`.
- `GET /api/gm/codes` → list codes `{code, gear_set, max_uses, uses, created_at}`.
- `POST /api/gm/codes` `{set, maxUses}` → `{code}`. Code format: `XXXX-XXXX-XXXX` from unambiguous alphabet.
- `GET /api/gm/roster` → `{admins:[usernames], gms:[usernames]}`.
- `POST /api/gm/roster` `{username, action: 'add-admin'|'remove-admin'}` → `{ok:true}`.
- `POST /api/roles` `{username, role: 'gm'|'admin'|'player'}` — owner only.
- `POST /api/gm/clear-guild-chat` `{username}` — owner/admin/gm only. Wipes the message history of the target player's guild (guild itself untouched). → `{ok:true, removed}`.

## Player state blob schema (client ↔ server)

```jsonc
{
  "race": "human|orc|celestial|dragonkin|fae|revenant",
  "mode": "clicker|auto|dungeon",
  "level": 1, "xp": 0, "xpNext": 100,
  "gold": 0, "stars": 0,
  "stage": 1, "bossesKilled": 0,
  "prestigeCount": 0, "prestigeBonus": 0,   // prestigeBonus = % damage/gold bonus
  "hero": { "hp": 100, "maxHp": 100, "attack": 10, "defense": 2, "critChance": 5,
            "critDamage": 150, "parry": 0, "dodge": 5, "lifesteal": 0,
            "attackSpeed": 1.0, "regen": 0 },
  "party": [ {"name": "...", "race": "orc", "level": 1, "hp": 80, "maxHp": 80,
              "attack": 8, "defense": 1, "dodge": 5, "critChance": 5} ],  // up to 3
  "inventory": [ {"id": "uuid", "name": "Iron Sword", "slot": "weapon",
                 "rarity": "common|magic|rare|epic|legendary|mythic",
                 "stats": {"attack": 5}, "set": null | "sovereign"|"fateweaver"|"warden"} ],
  "equipped": { "weapon": "<id>", "armor": "<id>", "helmet": "<id>", "boots": "<id>", "trinket": "<id>" },
  "upgrades": { "weapon": 1, "armor": 1, "skill": 1 },
  "skills": ["power-strike"],
  "companions": [],
  "codesRedeemed": ["XXXX-XXXX-XXXX"],
  "stats": { "taps": 0, "kills": 0, "playTimeSec": 0 }
}
```

Indexed leaderboard columns mirror `level`, `stage`, `bossesKilled`, `prestigeCount` from the blob.

## Game design reference (frontend implements)

### Races (visual emoji + trait)
- Human Vanguard 🛡️ — balanced: +10% XP gain.
- Orc Warborn 🪓 — +20% attack, −5% dodge.
- Celestial ✨ — +15% max HP, +2 HP/s regen.
- Dragonkin 🐉 — +25% crit damage.
- Fae Vanguard 🧚 — +10% dodge, +10% attack speed.
- Revenant 💀 — +5% lifesteal, +5% parry.

### Modes
- **Clicker** (main): big TAP button; each tap = one attack (attack × crit/parry/dodge enemy). Enemy HP bar; kill → gold + XP + loot roll; every 10th stage is a boss (3× HP, guaranteed rare+ drop).
- **Auto**: same enemies, hero attacks automatically every `1/attackSpeed` sec.
- **Dungeon**: 3-hero party (recruit from roster; default: hero + 2 companions), each attacks on its own timer; shared stage progression.

### Combat math (client-side)
- Enemy at stage s: `hp = round(18 * 1.16^s)`, `attack = round(4 * 1.12^s)`, boss ×3 HP / ×1.5 attack.
- Player damage: `attack × (crit? critDamage/100 : 1)`; enemy strikes back on a timer: dodge% → miss; parry% → blocked (0 dmg) + small counter; else `max(1, enemyAttack − defense)`; lifesteal heals % of damage dealt; regen ticks per second.
- Death: respawn at same stage with full HP after 3s, lose 5% gold (no level loss).
- XP: kill = `round(8 * 1.10^s)`; level up: xpNext = `round(100 * 1.35^(level-1))`; +2 attack, +15 maxHp, +1 defense per level (× race/gear multipliers).

### Loot
- Drop chance per kill 25% (boss 100%). Rarity weights: common 50, magic 25, rare 13, epic 7, legendary 3.5, mythic 1.5.
- Rarity colors: common #9aa0a6, magic #4da3ff, rare #ffd23f, epic #b366ff, legendary #ff8c1a, mythic #ff3b3b (prismatic glow).
- Slots: weapon, armor, helmet, boots, trinket. Stat pools: attack, defense, maxHp, critChance, critDamage, parry, dodge, lifesteal, attackSpeed, regen, goldBonus, xpBonus (pick 1–4 scaled by rarity × stage).
- Sell/disenchant unwanted gear for gold.

### Privileged gear sets (fixed stats, displayed in UI)
- **Sovereign Founder's Regalia** (owner): each piece huge — e.g. weapon +500 attack/+50% critDmg, armor +500 def/+2000 maxHp, etc. Full-set bonus: +100% all stats.
- **Fateweaver Regalia** (GM): ~60% of sovereign values.
- **Admin Warden Arsenal** (admin): ~35% of sovereign values.
- Granted via gift codes or staff roster / GM console; shown with gold border + set name.

### Economy / progression
- Upgrades (gold): weapon/armor/skill levels increase damage multiplicatively.
- Offline earnings: on load, `(now − lastSeenAt)` capped at 8h × estimated kills/min × gold/xp per kill at current stage; show "While you were away…" modal; then save.
- Prestige: unlocked at stage 50: reset level/stage/gold/inventory (keep privileged sets, stars, stats) for `prestigeBonus += 25%` damage & gold each time.

### Frontend screens (mobile-first tabs)
Auth → (first run) race select → main tabs: Battle | Gear | Party | Ranks | More(GM Console if owner/gm, Profile, Settings). Big touch targets, dark fantasy CSS.

## Security notes (implement + document in README)
- bcryptjs hash (10 rounds), parameterized queries everywhere (`pg` `$1`-style
  parameters, never string interpolation), helmet headers, rate-limited auth, session cookie httpOnly + sameSite=lax (+ `secure` when behind Render's HTTPS via `app.set('trust proxy', 1)`), input validation on all endpoints, state blob sanity clamps, no secrets in repo (`.gitignore` covers `data/`, `.env`, `node_modules`).

## Deploy notes (for deploy-config subagent)
- `Dockerfile`: node:20-alpine, `npm ci --omit=dev`, `EXPOSE 3000`, `CMD ["node","server.js"]`.
- `render.yaml`: free-tier web service, `PORT` env, `SESSION_SECRET` (generate), `OWNER_USERNAME`, `OWNER_PASSWORD` (generate), `DATABASE_URL` (set manually from a free Neon/Supabase Postgres), health check `/api/leaderboard`. Persistence comes from the external Postgres — no disk block needed; README must explain the free-tier setup honestly.
- `README.md`: what it is, local run (`npm install`, `npm start`, open http://localhost:3000), how to set owner account, step-by-step Render deploy for a non-technical user, the free-tier SQLite caveat, security honesty note.
