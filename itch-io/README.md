# King of Project — itch.io package

This folder contains a **standalone, offline version** of King of Project,
ready to upload to itch.io. It is the same game as the online version, but:

- **Saves** live in the player's own browser (localStorage) — no accounts on a server.
- **Leaderboard** shows the best heroes on that player's device only.
- Everyone who opens it is the **owner of their own copy**: the GM console works
  locally, so they can grant themselves stars/gear and make gift codes for fun.
- A demo gift code is built in: **WARDEN-WELCOME** (redeem it in the More tab for
  the Admin Warden Arsenal set).

The server-backed online version (real accounts, global leaderboard, shared
progress) remains the "real website" — link it from the itch page (see
PROJECT_DESCRIPTION.md).

## What's in this folder

- `king-of-project-itch.zip` — **this is the file you upload to itch.io.**
- `game/` — the unzipped game files (used to rebuild the ZIP).
- `PROJECT_DESCRIPTION.md` — suggested text for your itch.io project page.
- `README.md` — this file.

## How to upload to itch.io (step by step)

1. Go to **itch.io** and log in (or create a free account).
2. Click your profile picture (top right) → **Dashboard** → **New project**.
3. Fill in:
   - **Title:** King of Project
   - **Project URL:** pick something like `yourname.itch.io/king-of-project`
   - **Kind of project:** choose **HTML** — "You have a HTML file that can be played in the browser."
   - Uploads: click **Upload files** and select **`king-of-project-itch.zip`** from this folder.
   - Tick the checkbox **"This file will be played in the browser"**.
4. Scroll to **Embed options**:
   - Set a viewport size, e.g. **480 × 800** (portrait, phone-friendly).
   - Tick **"Mobile friendly"** so it plays well on phones.
   - Orientation: **Portrait**.
5. Paste the text from `PROJECT_DESCRIPTION.md` into the **Description** box
   (replace `PASTE-ONLINE-URL-HERE` with your real website address once deployed).
6. Add a cover image if you like (optional), set **Visibility** to **Public**,
   and click **Save & view page**.
7. Done — share the page link. Anyone opening it gets their own copy of the game.

## Updating the game later

If the game gets new features: replace the files in `game/`, then re-zip so that
`index.html` is at the **top level of the ZIP** (not inside a folder):

```
cd ~/workspace/rpg-server/itch-io/game
zip -r ../king-of-project-itch.zip index.html css js
```

Then on itch.io: Dashboard → your project → **Edit** → upload the new ZIP
(you can delete the old file). Players keep their own browser saves.

## Important notes

- itch.io serves the game over **HTTPS** automatically.
- Saves are per-browser: clearing browser data wipes progress. The game also has
  manual save export/import in the More tab as a backup.
- Local "passwords" on the login screen are just a casual lock for shared
  devices — they are NOT real security. Anyone with the device can read the save.
