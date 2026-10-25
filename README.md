# GameShell

GameShell opens one web game, such as a three.js game, in its own window and
makes it feel like a native Windows game. It runs the game fullscreen at high
priority on the fast GPU, keeps it running through Alt+Tab and pop-ups,
blocks the keys that throw you out of a game, and remembers your login.

Windows 10/11, x64 only.

## Install

1. Download `GameShell-<version>-Setup-x64.exe` from
   [Releases](https://github.com/jwang47/game-shell/releases).
2. Run the installer. It installs for your Windows account without needing
   administrator access and adds **GameShell** to the Start Menu.
3. Open **GameShell** from the Start Menu. The build is not code-signed, so Windows SmartScreen
   may warn the first time: click **More info → Run anyway**.

To update, run the newer installer. To uninstall, use Windows Settings → Apps →
Installed apps → GameShell. Settings and saved logins stay in
`%APPDATA%\GameShell` through updates and uninstall; delete that folder manually
if you also want to remove your data.

For a portable installation, download `GameShell-<version>-win32-x64.zip`,
unzip anywhere, and run `GameShell.exe`. Update by replacing that folder;
uninstall by deleting it. Both versions use the same settings location.

## First run

GameShell asks for the address of the game. Enter it and click **Open**. The
game opens fullscreen. Press **Ctrl+,** to come back to this page; the window
title reminds you.

Do these once, for the best experience (the setup page lists them too):

1. **Game Mode:** in the game, press Win+G → Settings → "Remember this is a
   game".
2. **No notifications:** Windows Settings → System → Notifications → turn on
   do not disturb automatically "When using an app in full-screen mode" (on by
   default in Windows 11).
3. **G-SYNC / FreeSync:** turn on the monitor's Adaptive-Sync, then in NVIDIA
   Control Panel → Set up G-SYNC choose **Enable for windowed and full screen
   mode** (AMD: FreeSync in AMD Software).

## Keys

| Key | Action |
| --- | --- |
| Ctrl+, | Setup page: game address, saved passwords, tips |
| F11 | Fullscreen on or off (remembered) |
| Ctrl+F5 | Reload without cache |
| Ctrl+Shift+I | DevTools |
| Ctrl+Alt+B | Bring GameShell to the front, from any app |

All other keys, F5 and F12 included, go to the game.

## Features

### Performance

- **CPU priority:** every GameShell process (main, GPU, renderer, utility)
  runs at `HIGH` priority, checked again every 5 s. `REALTIME` is not offered:
  it needs admin and can freeze input.
- **No background throttling:** Chromium's background, timer and
  occluded-window throttling and Windows 11 Efficiency mode (EcoQoS) are off,
  so the game runs at full rate even when it is not in front.
- **GPU:** uses the high-performance GPU, GPU rasterization, zero-copy and
  WebGPU. WebGL goes through ANGLE on Direct3D 11 (`--angle` changes it).
- **Frame rate:** limited to the display refresh rate (vsync), which gave the
  smoothest frame pacing in our measurements.
- **Memory:** JavaScript heap up to 4 GB (`--heap-mb`).
- Latency and frame pacing were measured against Chrome:
  [docs/latency.md](docs/latency.md).

### Fullscreen without interruptions

- **Fullscreen like a game:** borderless fullscreen by default. Alt+Tab works
  as usual. While the game is fullscreen and in front, Windows' Do Not
  Disturb rule holds back notifications.
- **The game never pauses on focus loss:** a UAC prompt, Alt+Tab or a
  notification does not pause it. The page always reports focused and
  visible. Keys held when the window loses focus are released, so none stick,
  and keyboard input works again without a click.
- **Windows key:** while the game is fullscreen and in front, a lone press of
  the Windows key does not open the Start menu. Win+key combinations (Win+G,
  Win+Shift+S, ...) still work.
- **Accessibility pop-ups:** while the game is fullscreen and in front, the
  Sticky Keys, Toggle Keys and Filter Keys shortcut prompts (Shift five times,
  ...) are off, as Microsoft recommends for games. They come back when you
  leave the game. A shortcut is left alone if you use its feature, and the
  change is never saved to your Windows settings.
- **No accidental reloads:** app shortcuts need Ctrl, so F5 and F12 reach the
  game.
- **Cursor:** hides after 2 s without mouse movement.
- **Screen:** the display does not go to sleep while GameShell runs.
- **Recovery:** if the page fails to load, GameShell tries again after 3 s; if
  the page crashes, it reloads.

### Logins

Electron has no Chrome password manager, so GameShell has its own.

- **Save:** after you sign in with a password form, GameShell offers to save
  the login (**Save**, **Not now**, **Never for this site**). It offers only
  when the sign-in looks successful: the form goes away and does not come
  back. After a form that loads a new page, the prompt says the result is not
  confirmed.
- **Fill:** on the next visit, GameShell fills the username and password. A
  saved login goes only to pages of the same origin (scheme, host and port),
  as Chromium reports it. It leaves the password blank if a different username
  is already entered.
- **Storage:** passwords are encrypted with Windows DPAPI (Electron
  `safeStorage`); only your Windows account can read them. Manage or forget
  them on the setup page.
- **Stay signed in:** cookies that would end when the window closes get a
  30-day expiry, so you stay signed in after a restart.

### Safety

- Pages run in sandboxed renderers with context isolation and no Node.js.
- Pop-ups (for example OAuth sign-in) open in GameShell, above the game. Only
  `http(s)` pages can open; `mailto:` links go to your mail app; every other
  scheme (`file:`, app protocols) is refused, in pop-ups too.
- See also [Security](#security).

## Flags

Pass flags to `GameShell.exe` (for example in a shortcut's Target) or to
`npm start -- <flags>`.

| Flag | Effect |
| --- | --- |
| `--url=URL` | Open this URL and remember it |
| `--windowed` | Start windowed instead of fullscreen |
| `--priority=high\|abovenormal\|normal` | CPU priority (default `high`) |
| `--allow-win-key` | Let the Windows key and accessibility shortcut prompts work while playing |
| `--pause-on-blur` | Let the game see focus loss, as in a browser (it may pause) |
| `--low-latency` | Canvases skip Chromium's compositor: about 15 ms less input latency, but frame pacing gets uneven (stutter in some games). See [docs/latency.md](docs/latency.md) |
| `--angle=d3d11\|vulkan\|gl` | WebGL backend (default `d3d11`; with `vulkan`, WebGPU finds no adapter) |
| `--uncapped-fps` | Remove the vsync frame limit. Not recommended: it made input latency much worse |
| `--ignore-gpu-blocklist` | Use GPU features that Chromium turns off for known bad drivers |
| `--fps` | Show Chromium's FPS counter |
| `--heap-mb=N` | JavaScript heap limit in MB (default 4096) |
| `--smoke-test` | Load the URL in a hidden window, print JSON (title, WebGL renderer, WebGPU adapter, process priorities, GPU features, versions) and quit |

## Files

Everything GameShell stores is in `%APPDATA%\GameShell`:

| File | Content |
| --- | --- |
| `settings.json` | Game address |
| `window.json` | Window size, position and fullscreen |
| `passwords.json` | Saved logins (passwords encrypted with DPAPI) |
| `Partitions\game` | Cookies, cache and site data of the game |

## Build from source

Needs Windows 10/11 x64, Git and Node.js 24.22.1 or later (`.nvmrc`; older
Node versions with known security bugs are refused). In PowerShell:

```
git clone https://github.com/jwang47/game-shell.git; cd game-shell
npm ci
npm start
```

`npm ci` also downloads Electron and koffi's native module (their install
scripts are allowed in `package.json`).

| Command | Does |
| --- | --- |
| `npm start` | Run from source (`npm start -- --url=URL --windowed`) |
| `npm test` | Hidden checks (see [Development](#development)) |
| `npm run pack` | Build `dist\GameShell-win32-x64\GameShell.exe` |
| `npm run installer` | Wrap the built app in `dist-installer\GameShell-<version>-Setup-x64.exe` (no publishing) |
| `npm run test:packaged` | Smoke-test the built Windows app in a hidden window (run `npm run pack` first) |
| `npm run release` | Build and zip it as `dist\GameShell-<version>-win32-x64.zip` |

`node pack.mjs OUT` builds into another folder, for example while the exe in
`dist` is running.

### Publish a release

1. Set `version` in `package.json` and commit.
2. `npm test`, then `npm run release`.
3. `gh release create v<version> dist\GameShell-<version>-win32-x64.zip --title "GameShell <version>" --notes "..."`.

There is no auto-update yet. It needs a public repository (or a download
token) and, to avoid SmartScreen warnings, a code-signing certificate.

## Development

| File | Role |
| --- | --- |
| `main.js` | Window, Chromium switches, priority, logins (main side), link policy |
| `preload.js` | Runs in the page: login save and fill, focus handling, idle cursor, `--low-latency` |
| `keyguard.js` | Windows key and accessibility shortcuts (koffi calls to `user32`) |
| `setup.html` | Setup page (Ctrl+,) |
| `pack.mjs` | Packaging (`@electron/packager`) |
| `test/` | Checks; `test/visible.mjs` needs the screen |
| `tools/` | Benchmarks and helpers (`make_icon.py` draws `assets/`) |

Checks:

- GitHub Actions runs `npm ci`, `npm audit --audit-level=high`, and `npm test` on Windows for pushes and pull
  requests, using the Node version in `.nvmrc`. Canvas option forwarding is
  checked without a GPU; the WebGL presentation check is skipped explicitly
  on hosts that cannot create a WebGL context.
- CI also builds the Windows distribution and runs `npm run test:packaged`.
  This copies the build outside the checkout to prevent missing dependencies
  from resolving through the source tree. It checks native keyguard loading,
  the bundled setup page and preload, navigation to a local game, renderer
  isolation, settings persistence, and clean shutdown with a temporary profile.
- CI builds the per-user installer and checks install, Start Menu shortcuts,
  app startup, reinstall, uninstall, and preservation of user data. The installer
  lifecycle test refuses to run outside a disposable GitHub-hosted runner.

- `npm test` runs the security, persistence, keyguard, login, popup, low-latency, focus and keys
  checks in hidden windows against local test pages. It needs no account and
  opens no visible window.
- Security checks cover IPC sender authorization, credential origin isolation,
  setup-page access, allowed URL schemes, and renderer isolation even when a
  popup requests Node.js access. These are regression checks, not a full security audit.
- `node test/visible.mjs` presses real keys on a visible fullscreen window:
  the title hint, F5 and Ctrl+F5, a lone Windows key, and the accessibility
  shortcuts while playing and after exit. It takes over the screen and
  keyboard for about 15 s.
- `npx electron . --smoke-test --url=URL` must exit 0, with every process
  priority at `-14` (`HIGH`) and `webgl` naming the discrete GPU.
- `GAMESHELL_TEST=1` hides the window, starts windowed and answers the
  save-password prompt with **Save**. With `--user-data-dir=DIR` and
  `--remote-debugging-port=N`, tests drive the app over the DevTools protocol.
  Keys sent that way skip Electron's `before-input-event`, so app shortcuts
  need `test/visible.mjs`.

Benchmarks (they take over the screen and keyboard; need Chrome and the
Python environment described at the top of `tools/latency.mjs`):

- `node tools/latency.mjs`: key press to on-screen change, GameShell modes
  against Chrome (DXGI desktop duplication).
- `node tools/pacing.mjs`: frame pacing with PresentMon 2.6.0 in `tools/bin`
  (one UAC prompt).
- Results and method: [docs/latency.md](docs/latency.md).

## Notes for game developers

These help more than any setting in GameShell:

- Cap the pixel ratio: `renderer.setPixelRatio(Math.min(devicePixelRatio, N))`.
  A 4K display at DPR 2 or more costs a lot of fill rate.
- Read input at the start of each frame and render it in the same frame.
- `requestPointerLock({ unadjustedMovement: true })` gives raw mouse input.
- Use `WebGPURenderer` if the game supports it.
- A WebGL context created with `desynchronized: true` gets the
  `--low-latency` gain in every browser; check frame pacing if you do.

## Security

- **Build Node:** `package.json` `engines` and `.npmrc` (`engine-strict`)
  refuse a Node.js older than 22.23.4, 24.22.1 or 26.12.1, the October 2026
  security releases (Brotli decoder RCE, CVE-2026-111497, and nine others).
- **Runtime:** the exe runs on the Node.js inside Electron, not the build
  Node. Electron is pinned exactly (`45.0.0`), and Electron 45.0.0 bundles
  Node.js 24.22.0, which does not have that fix. No stable Electron has it
  yet. GameShell does not expose the bug: the main process loads no `zlib`
  and calls no `fetch`, and web pages run in sandboxed renderers without
  Node. Chromium's network stack decodes web content, not Node's Brotli. Move
  to the first stable Electron that bundles Node.js 24.22.1 or later.
- `--smoke-test` prints the bundled `electron`, `node` and `chrome` versions.

## License

MIT. See [LICENSE](LICENSE).
