# sqlite-legacy — SQLite (better-sqlite3) fallback copy

This is a point-in-time backup of the last working SQLite implementation
(`src/*.js`, `server.js`, `package.json`) from 2026-09-25, before the
PostgreSQL conversion.

It is NOT wired into the build. To restore it as the live server:

1. `cp sqlite-legacy/src/* src/`
2. `cp sqlite-legacy/server.js server.js`
3. Ensure `better-sqlite3` is in dependencies (it still is) and run `npm install`
4. Unset `DATABASE_URL` (or ignore it — the legacy code never reads it)
5. `npm start` — data goes to `./data/game.db` again (ephemeral on Render free tier)
