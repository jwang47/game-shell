# GameShell

An Electron (Chromium) window for one web game, such as a three.js game. You
choose the game's URL. The app gets the game as close to native performance as
a browser allows on Windows, and it remembers your login.

Windows only for now. Needs Node 22 or later to build.

## Run

In PowerShell:

```
npm install; npm start
```

Build a standalone exe at `dist\GameShell-win32-x64\GameShell.exe`
(`node pack.mjs OUT` builds into another folder, for example while the exe in
`dist` is running):

```
npm run pack
```

`npm run release` also writes `distGameShell-<version>-win32-x64.zip` to
attach to a GitHub Release. There is no auto-update yet: it needs a public
repository (or a download token) and, to avoid SmartScreen warnings, a
code-signing certificate.

On the first run, a setup page asks for the game's URL and lists three
one-time Windows settings (Game Mode, Do Not Disturb, G-SYNC/FreeSync). Press
**Ctrl+,** to change it later; the window title reminds you. `--url=URL` also sets it and remembers it.

Settings are kept in `%APPDATA%\GameShell`: `settings.json` (URL),
`window.json` (size, position, fullscreen) and `passwords.json` (saved logins).
The login session is the Chromium partition `persist:game` in the same folder.

## Logins

Electron has no Chrome password manager, so the app has its own:

- When you sign in with a password form, the app offers to save the login
  (**Save**, **Not now**, **Never for this site**). It offers only when the
  sign-in looks successful:
  - The page changes in place and no password field shows for 1 s.
  - Or the form submit navigates (within 10 s) to a page on the same origin
    that shows no password field for 2 s. The prompt then says that the
    result is not confirmed.
- The app offers nothing when the form comes back, even re-rendered, and can
  be typed in for 5 s (1 s on a page reached by navigation). Disabled fields
  count as "still waiting". The app also offers nothing after a later
  navigation, a move to another origin, or 25 s with no result. Leaving a
  rejected form within 5 s of the submit can still look like a successful
  sign-in that navigated away.
- The password is encrypted with Electron `safeStorage` (Windows DPAPI). Only
  the same Windows user can decrypt it.
- On the next visit, the app fills the username and password fields. The app
  gives a saved login only to a page of the same origin (scheme, host and
  port). Chromium supplies the origin, not the page.
- Session cookies (cookies that end when the browser closes) get a 30-day
  expiry, so you stay signed in after a restart.
- The setup page (Ctrl+,) lists the saved sites, with a **Forget** button for
  each.

## What it changes

| Area | What the app does | Limit |
| --- | --- | --- |
| CPU | Sets every app process (main, GPU, renderer, utility) to `HIGH` priority. Every 5 s it checks again and sets new or reset processes. | `REALTIME` needs admin and can freeze input, so it is not offered. |
| Background | Turns off Chromium background, timer and occluded-window throttling, and Windows 11 Efficiency mode (EcoQoS). The game runs at full rate when it does not have focus. | — |
| Fullscreen and Do Not Disturb | Starts in borderless fullscreen, like a normal game (F11 switches to windowed, and the app remembers it). While the game is fullscreen and in front, Windows turns on Do Not Disturb by its rule "When using an app in full-screen mode". Alt+Tab works as usual; the game keeps running at full speed behind other windows. **Ctrl+Alt+B** brings the window back from anywhere. | The rule must be on: Settings > System > Notifications > Turn on do not disturb automatically (on by default in Windows 11). Windows has no public API that lets an app turn on Do Not Disturb itself. |
| Interruptions | A UAC prompt, Alt+Tab or a notification does not pause the game: the page always reports focused and visible (`document.hasFocus()`, `document.hidden`, `visibilitychange`, window `blur`). Keys held when the window loses focus get a key-up, so none stick. When the window gets focus back, the page gets keyboard focus without a click. `--pause-on-blur` turns this off. | The game also keeps running while you are in another window. Windows' UAC prompt still takes over the screen; no app can stop that. |
| GPU | Uses the high-performance GPU, forces GPU rasterization and zero-copy, and turns on WebGPU. `--ignore-gpu-blocklist` also skips Chromium's bad-driver list. | The app cannot change GPU clocks or GPU scheduling priority. |
| Frame rate | Normally limited to the display refresh rate (vsync). `--uncapped-fps` removes the limit. | Measured: alone, it fills the frame queue and makes input much slower (median 220 ms). See [docs/latency.md](docs/latency.md). |
| Memory | V8 heap up to 4096 MB (`--heap-mb=N`). | — |
| Audio | Audio can play before the first click. | — |
| Network | If the page fails to load, the app tries again after 3 s. A newer navigation cancels the retry. | — |
| Popups | http(s) popups (OAuth sign-in) open as windows owned by the window that opened them, so they stay above the game. The same rules apply in popups and their popups. `mailto:` links go to the OS. All other schemes (`file:`, app protocols) are refused, for links, navigations and redirects. | — |
| Power | Stops the display from going to sleep while the app runs. | — |
| Windows key and accessibility prompts | While the game is fullscreen and in front, a lone press of the Windows key does not open the Start menu, and the Sticky Keys, Toggle Keys and Filter Keys shortcut prompts (Shift five times, ...) are off, as Microsoft recommends for games. Win+key combinations (Win+G, Win+Shift+S, ...) still work. The shortcuts come back when the game leaves the front or the app quits. `--allow-win-key` turns this off. See `keyguard.js`. | A shortcut is left alone when its feature is already on. The change is never saved, so a crash cannot leave it behind after sign-out. |
| Accidental keys | App shortcuts need Ctrl (F11 aside), so F5 and F12 reach the game instead of reloading it. | — |
| Cursor | The mouse cursor hides after 2 s without movement and comes back when you move it. | — |

## Keys

| Key | Action |
| --- | --- |
| Ctrl+, | Setup page (URL, saved passwords) |
| F11 | Fullscreen |
| Ctrl+F5 | Reload without cache |
| Ctrl+Shift+I | DevTools |
| Ctrl+Alt+B | Bring the window to the front (works from any app) |

## Flags

Give flags to `npm start -- <flags>` or to `GameShell.exe`.

| Flag | Effect |
| --- | --- |
| `--url=URL` | Open this URL and remember it |
| `--priority=high\|abovenormal\|normal` | CPU priority (default `high`) |
| `--windowed` | Start windowed instead of fullscreen |
| `--allow-win-key` | Let the Windows key and accessibility shortcut prompts work while playing |
| `--pause-on-blur` | Let the game see focus loss (window `blur`, hidden page) as in a browser |
| `--angle=d3d11\|vulkan\|gl` | WebGL backend (default `d3d11`). With `vulkan`, WebGPU finds no adapter. |
| `--uncapped-fps` | Remove the vsync frame limit. Not recommended: alone it made key-to-screen latency much worse. |
| `--low-latency` | Ask every WebGL and 2D canvas for `desynchronized` presentation, which skips Chromium's compositor. Measured: 23 ms median key-to-screen, against 38 ms without it and 43 ms in Chrome ([docs/latency.md](docs/latency.md)). Off by default: in a real game it caused visible frame stutter and skipped frames. |
| `--ignore-gpu-blocklist` | Use GPU features that Chromium turns off for known bad drivers |
| `--fps` | Show Chromium's FPS counter, to compare settings |
| `--heap-mb=N` | V8 heap limit in MB |
| `--smoke-test` | Load the URL in a hidden window, print JSON (page title, WebGL renderer, WebGPU adapter, process priorities, GPU features) and quit |

## Check

- `npm test` runs the keyguard, login, popup, low-latency, focus and keys checks in hidden windows
  (`GAMESHELL_TEST=1`) against local test pages. It needs no account, and it
  opens no visible window.
- `node test/visible.mjs` checks real key presses on a visible fullscreen
  window: the title hint, F5 and Ctrl+F5, the lone Windows key, and the
  accessibility shortcuts while playing and after exit. It takes over the
  screen and keyboard for about 15 s.
- `npx electron . --smoke-test --url=URL` must exit 0. All process priorities
  must be `-14` (`HIGH`), and `webgl` must name the discrete GPU.
- `GAMESHELL_TEST=1` hides the window, starts windowed and answers the
  save-password prompt with **Save**. Use it with `--user-data-dir=DIR` and
  `--remote-debugging-port=N` to drive a login flow over the DevTools
  protocol without a visible window.

## Latency benchmark

`node tools/latency.mjs` compares GameShell modes with Chrome, from a real
key press to the change on screen. It needs Chrome and a Python environment
with `dxcam` (see the top of the file). It takes over the screen and keyboard
for a few minutes. `node tools/pacing.mjs` measures frame pacing with
PresentMon (one UAC prompt; put PresentMon 2.6.0 in `tools/bin`). Results and
method: [docs/latency.md](docs/latency.md).

## Changes that must be made in the game

These have a larger effect than any setting in the shell:

- `renderer.setPixelRatio(Math.min(devicePixelRatio, N))`. A 4K display at
  DPR 2 or more costs a lot of fill rate.
- `requestPointerLock({ unadjustedMovement: true })` for raw mouse input with
  no OS acceleration.
- Use `WebGPURenderer` if the game supports it.
- Create the WebGL context with `desynchronized: true`. Then every browser,
  Chrome included, gets the low-latency gain.

## Security

- **Build Node:** `package.json` `engines` and `.npmrc` (`engine-strict`)
  refuse a Node.js older than 22.23.4, 24.22.1 or 26.12.1, the October 2026
  security releases (Brotli decoder RCE, CVE-2026-111497, and nine others).
  `.nvmrc` names 24.22.1.
- **Runtime:** the exe runs on the Node.js inside Electron, not the build
  Node. Electron is pinned exactly (`45.0.0`). Electron 45.0.0 bundles
  Node.js 24.22.0, which does not have that fix. No stable Electron has the
  fix yet. GameShell does not expose the bug: the main process loads no
  `zlib` and calls no `fetch`, and web pages run in sandboxed renderers
  without Node. Chromium's network stack decodes web content, not Node's
  Brotli. Move to the first stable Electron that bundles Node.js 24.22.1 or
  later.
- `--smoke-test` prints the bundled `electron`, `node` and `chrome` versions.

## License

MIT. See [LICENSE](LICENSE).
