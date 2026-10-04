# Throne of Shadows — Xbox sideloading guide

> Correction (2026-09-30): the old PWABuilder route in this file was wrong
> for Xbox — PWABuilder's Windows packages target `Windows.Desktop` and an
> Xbox will not install them. The correct route is a thin **UWP (WinUI 2)**
> app hosting the live game in a full-screen **WebView2** view. Everything
> below reflects that.

Package the game as a native Xbox app (MSIX/AppX) and sideload it onto an
Xbox in Developer Mode. The package is a thin native shell around the live
game at `https://throne-of-shadows.onrender.com/` — game updates keep
shipping through Render, no repackaging needed.

The build templates live in `xbox/uwp/` (`AppXManifest.xml`,
`MainPage.xaml`, `MainPage.xaml.cs`) with the full step-by-step in
`xbox/uwp/BUILD.md`.

## 0. What you're building

Throne of Shadows on Xbox is a **native UWP shell**: it doesn't contain
the game, it contains a WebView2 view that loads the live URL. That means:

- The console needs internet access (same as the phone app).
- Balance patches, events, and UI updates deploy normally — the Xbox app
  picks them up on next launch.
- The in-game controller support (`public/js/gamepad.js`) works with the
  Xbox controller through the Gamepad API — no native input code.

Do **not** use WinUI 3 / Windows App SDK for this project — that stack is
desktop-only and will not install on a console.

## 1. Build the package (on a PC, ~30 minutes the first time)

Follow **`xbox/uwp/BUILD.md`** — in short:

1. Visual Studio 2022 + the **Universal Windows Platform development**
   workload.
2. New **Blank App (Universal Windows)** (C#), target 19041+, min 18362.
3. NuGet: `Microsoft.UI.Xaml` (2.x = WinUI 2) + `Microsoft.Web.WebView2`.
4. Drop in the `xbox/uwp/` templates, fill in every `YOUR_*` placeholder
   (package name, publisher ID matching your signing certificate).
5. Build **x64 Release** → Create App Packages (sideloading) → you get a
   `.msixbundle`.

## 2. Put the Xbox in Developer Mode (one-time, ~$20)

1. On the Xbox, install **Xbox Dev Mode Activation** from the Store
   (one-time purchase, about $20, needs a real Microsoft account).
2. Open it, follow the activation at `https://aka.ms/activatexbox`, and let
   the console restart into Dev Mode.
3. In Dev Mode go to **Manage Dev Storage** and give Dev Mode at least 5 GB.
4. Connect the console to your network (wired is best for big uploads).
5. Note the **IP address** shown on the Dev Home screen — the Device Portal
   lives at `http://<console-ip>:11443`.
6. On the console: **Settings → Remote Access Settings** → enable
   **Xbox Device Portal** (set a username/password if you like).

## 3. Install the game on the Xbox

1. On your PC browser, open `http://<console-ip>:11443` (accept the
   certificate warning — it's your own console).
2. Sign in with the Device Portal credentials from step 2.6.
3. Go to the **Apps / Add** section and upload the `.msixbundle` from
   step 1 (some portals label it "Install app package").
4. Wait for the install to finish, then launch **Throne of Shadows** from
   the Dev Home dashboard.

## 4. Test checklist

- [ ] Game boots to the login screen, no certificate errors.
- [ ] Log in / continue as guest; hero loads with live server data.
- [ ] Press a button on the Xbox controller: a gold focus ring appears and
      the D-pad moves it between buttons (gamepad navigation active).
- [ ] A = tap/activate, B = back out of dialogs (never confirms anything
      destructive), LB/RB = switch tabs, Start = Settings,
      right stick = scroll.
- [ ] Open a confirm dialog (e.g. disband party): B must land on Cancel,
      not the destructive button.
- [ ] Battle tab: focus the big tap button and mash A — damage numbers fly.
- [ ] Hold D-pad: the ring repeats; push the left stick at the same time —
      both repeat independently.
- [ ] Realm Network (🌐) opens the star map.
- [ ] Background the app and resume — the session should still be alive.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not start the WebView2 engine" | Install the WebView2 Runtime on the console, then relaunch (see BUILD.md). |
| Device Portal won't open | Console and PC must be on the same network; check the IP on Dev Home. |
| Install fails with cert error | Install the `.cer` produced alongside the `.msixbundle` on the console first, then retry. |
| No focus ring with controller | The ring only appears after the first controller input; press D-pad once. |
| Game loads but API calls fail | The console needs internet — check Dev Mode network settings. |

## Going further (optional)

- **Store publishing (retail consoles):** reserve the app name in Partner
  Center, rebuild with your real Package/Publisher IDs, and submit. Dev
  Mode sideloading needs none of that.
- **10-foot TV layout:** the game is phone-first; a TV layout pass (larger
  type, landscape battle view) is a separate UI project — say the word.
- `node xbox/check-pwa.cjs` remains as a general PWA health check
  (manifest, icons, service worker, gamepad wiring: currently 20/20) —
  useful hygiene, not the packaging route.
