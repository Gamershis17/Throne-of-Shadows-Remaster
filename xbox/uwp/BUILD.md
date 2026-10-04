# Throne of Shadows — Xbox UWP build guide

Build a thin **UWP (WinUI 2)** app that hosts the live game in a full-screen
**WebView2** view, then sideload it onto an Xbox in Developer Mode.

Do all of this on a **Windows 10/11 PC** with Visual Studio — none of it
happens on the Xbox itself until the install step.

> Why UWP and not PWABuilder? PWABuilder's Windows packages target
> `Windows.Desktop`, and an Xbox will not install them. The supported
> console route is a native UWP shell around the live URL. Do **not** use
> WinUI 3 / Windows App SDK either — that stack is desktop-only.

## 0. What you're building

- A native Xbox-installable package (`Windows.Universal`, x64) whose only
  job is to show `https://throne-of-shadows.onrender.com/` full-screen.
- The console needs internet access (same as the phone app).
- Balance patches, events, and UI updates keep deploying through Render —
  the Xbox app picks them up on next launch. No repackaging for game
  updates.
- The in-game controller support (`public/js/gamepad.js`) talks to the
  Xbox controller through the browser Gamepad API — no native input code.

## 1. Prerequisites (one-time)

1. **Visual Studio 2022** (Community is fine) with the
   **Universal Windows Platform development** workload.
2. An Xbox with **Developer Mode** activated (~$20 one-time via the
   *Xbox Dev Mode Activation* app in the Store; needs a real Microsoft
   account). In Dev Mode: **Manage Dev Storage** ≥ 5 GB, console on your
   network (wired is best), note the IP on the Dev Home screen.
3. **WebView2 Runtime** must exist on the console. If the app shows the
   "Could not start the WebView2 engine" error on launch, install the
   runtime on the Xbox first (via Device Portal, same as the game below).

## 2. Create the UWP project

1. Visual Studio → **Create a new project** → **Blank App (Universal
   Windows)** (C#). Name it `ThroneOfShadows`.
2. Target version: **10.0.19041 or later**; Min version: **10.0.18362.0**.
3. NuGet (`Tools → NuGet Package Manager → Manage NuGet Packages`):
   - `Microsoft.UI.Xaml` (2.8.x — this is **WinUI 2**, the UWP flavor)
   - `Microsoft.Web.WebView2`
4. Replace the generated files with the templates in `xbox/uwp/`:
   - `Package.appxmanifest` ← `AppXManifest.xml`
   - `MainPage.xaml` ← `MainPage.xaml`
   - `MainPage.xaml.cs` ← `MainPage.xaml.cs`
5. Fill in every `YOUR_*` placeholder in the manifest:
   - `YOUR_PACKAGE_NAME` — e.g. `YourName.ThroneOfShadows`
   - `YOUR_PUBLISHER_ID` — must match the **Subject** of the certificate
     you sign with (step 3), e.g. `CN=YourName`
   - `YOUR_PUBLISHER_DISPLAY_NAME` — shown under the app name
   - `YOUR_GUID` — any new GUID (two spots)
6. Add the `Assets\` images the manifest references
   (`StoreLogo.png`, `Square150x150Logo.png`, `Square44x44Logo.png`,
   `Wide310x150Logo.png`, `SplashScreen.png`) — solid dark tiles with the
   game name are fine for a Dev Mode build.

## 3. Build the package

1. Set the solution platform to **x64** and configuration to **Release**.
2. `Project → Publish → Create App Packages…` → **Sideloading**.
3. Sign with a test certificate (Visual Studio can generate one). Copy its
   certificate **Subject** into the manifest's `YOUR_PUBLISHER_ID`.
4. Output: a `.msixbundle` (plus the `.cer`). Keep the `.cer` — if the
   Device Portal ever rejects the install, install the certificate on the
   console first.

## 4. Install on the Xbox

1. On the Xbox: **Settings → Remote Access Settings** → enable
   **Xbox Device Portal** (set a username/password if you like).
2. On your PC browser open `http://<console-ip>:11443` (accept the
   certificate warning — it's your own console) and sign in.
3. **Apps → Add** → upload the `.msixbundle` from step 3.
4. Launch **Throne of Shadows** from the Dev Home dashboard.

## 5. Test checklist

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
| "Could not start the WebView2 engine" | Install the WebView2 Runtime on the console, then relaunch. |
| Device Portal won't open | Console and PC must be on the same network; check the IP on Dev Home. |
| Install fails with cert error | Install the `.cer` from step 3 on the console first, then retry the `.msixbundle`. |
| No focus ring with controller | The ring only appears after the first controller input; press D-pad once. |
| Game loads but API calls fail | The console needs internet — check Dev Mode network settings. |
| Build errors about WebView2 types | Make sure both `Microsoft.UI.Xaml` (2.x) and `Microsoft.Web.WebView2` NuGet packages are installed, and that the XAML uses the `muxc:` prefix from the template. |

## Going further (optional)

- **Store publishing (retail consoles):** reserve the app name in Partner
  Center, rebuild with your real Package/Publisher IDs, and submit.
  Dev Mode sideloading needs none of that.
- **10-foot TV layout:** the game is phone-first; a TV layout pass (larger
  type, landscape battle view) is a separate UI project — say the word.
- `node xbox/check-pwa.cjs` remains as a general PWA health check
  (manifest, icons, service worker, gamepad wiring) — useful hygiene, but
  it is **not** the packaging route anymore.
