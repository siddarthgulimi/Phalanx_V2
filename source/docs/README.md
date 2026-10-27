# Phalanx 2.0 — DOM Integrity & Threat Monitor ({{EDITION}} edition)

Phalanx protects your browser in three layers and keeps you in control of every decision.

| Layer | What it does |
|---|---|
| **Browser extension** | Scores every website *before* it loads, inspects downloads, watches pages for injected login forms, scripts, hidden frames and clickjacking overlays. Shows one compact alert that disappears after 3 seconds. |
| **Phalanx.exe (desktop app)** | Dashboard, Live threats, Threat analysis, History & reports, Site scanner, Settings, About — all in one window. Keeps long-term history and owns settings and the cache folder. |
| **You** | Every alert offers three choices: **Resolved** (it's safe), **Quarantine** (remove / cancel / block) or **Threat analysis** (full explanation). |

## What's in this folder

| Item | Purpose |
|---|---|
| `Phalanx-Setup.exe` | Windows installer (per-user, no admin). Adds Start-menu + desktop shortcuts and an uninstaller. |
| `Phalanx.exe` | Portable version — run it directly from this folder. |
| `extension/` | The browser extension. Load it in Chrome/Edge with **Load unpacked**. |
| `source/` | Complete source code (Go engine, HTML/JS app, extension, build tools). |
| `INSTALL.txt` | Step-by-step installation guide. |

## Quick start

1. Run `Phalanx-Setup.exe` (or `Phalanx.exe`). SmartScreen may warn because the app is not code-signed: **More info → Run anyway**.
2. Create your local profile (name + optional passcode).
3. In Chrome: `chrome://extensions` → **Developer mode** → **Load unpacked** → choose the `extension` folder.
4. The app sidebar shows **Extension connected**. Open **Test lab** in the left menu to demo detections.

## How detection works

Everything is scored on one **0–100** scale. Each warning sign adds points (raw IP address +30, brand look-alike +40,
disguised `.pdf.exe` +50, piracy site +55 …). Well-known services — Google/Gmail/Meet, Discord, Netflix, Microsoft,
GitHub, major Indian banks, `.gov.in` — are trusted and not flagged.

| Sensitivity | Alerts when score is | Typical use |
|---|---|---|
| Low | ≥ 70 (high & critical only) | Fewest alerts |
| **Medium** (default) | ≥ 45 | Balanced |
| High | ≥ 20 | Demo / maximum visibility |

**Auto-quarantine** (Settings → Protection) instantly handles high & critical threats; everything else waits for your choice.

## Data, cache and privacy

* History, settings and cache live in `PhalanxData` next to `Phalanx.exe` by default. Change it in **Settings → Storage & cache** (Browse… / Move data here).
* **Clear cache** removes the app-window cache, temp files, logs and (optionally) the extension's local buffer.
* The extension and engine talk only over `127.0.0.1:47821`. Nothing is sent to the internet.

## Performance notes

* Page checks run in browser idle time and only on risky elements; trusted sites get a light mode.
* Extension state is kept in memory and saved in batches (v1 wrote to storage on every network request — the main cause of tab lag).
* Network telemetry can be turned off completely (Settings → Performance).
* The engine is a single native program (~15 MB RAM) and exits ~30 s after you close its window unless "Keep engine running" is on.

## Building from source

Requirements: Go 1.22+, Python 3 + Pillow, NSIS (`makensis`), mingw `windres`.

```
python3 source/tools/make_icons.py
python3 source/tools/build.py
```
Both editions are produced from the same source; only `themes/<edition>/palette.css` and the icons differ.

## Credits

Builds on the DOM Interceptor concept by **Siddharth Gulumi** (see About → Credits in the app).
