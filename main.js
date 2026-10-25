// GameShell: one Chromium window on a web game, tuned so Windows and Chromium
// give it as much CPU, GPU and attention as they allow.
const { app, BrowserWindow, dialog, globalShortcut, ipcMain, powerSaveBlocker, safeStorage, session, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

function arg(name) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

// GAMESHELL_TEST=1 hides the window and answers the save-password prompt with
// "Save", so the password flow can be checked without a person at the screen.
const TEST = process.env.GAMESHELL_TEST === '1';
const PARTITION = 'persist:game';
const SETUP_PAGE = path.join(__dirname, 'setup.html');
const PRIORITIES = {
  high: os.constants.priority.PRIORITY_HIGH,
  abovenormal: os.constants.priority.PRIORITY_ABOVE_NORMAL,
  normal: os.constants.priority.PRIORITY_NORMAL,
};
const PRIORITY_NAME = String(arg('priority') || 'high').toLowerCase();
const PRIORITY = PRIORITIES[PRIORITY_NAME] ?? PRIORITIES.high;
// --low-latency: canvases ask for desynchronized presentation, which skips
// Chromium's compositor (23 ms vs 38 ms key-to-screen, docs/latency.md) but
// made a real game stutter, so it is opt-in. The preload applies it in the page.
const LOW_LATENCY = !!arg('low-latency');

// GPU: prefer the discrete GPU on hybrid laptops, rasterize on the GPU. The
// driver blocklist is skipped only on request: it guards against bad drivers.
// Keep rendering at full rate when unfocused or covered.
app.commandLine.appendSwitch('force_high_performance_gpu');
if (arg('ignore-gpu-blocklist')) app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// EcoQoS is Windows 11 "Efficiency mode"; Chromium applies it to processes it
// thinks are in the background.
app.commandLine.appendSwitch('disable-features', [
  'CalculateNativeWinOcclusion',
  'IntensiveWakeUpThrottling',
  'UseEcoQoSForBackgroundProcess',
].join(','));
// three.js: WebGL goes through ANGLE (d3d11 default; try vulkan or gl), and
// WebGPURenderer needs WebGPU. Bigger V8 heap for large scenes; audio may start
// without a click.
app.commandLine.appendSwitch('use-angle', String(arg('angle') || 'd3d11'));
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${Number(arg('heap-mb')) || 4096}`);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (arg('fps')) app.commandLine.appendSwitch('show-fps-counter');
if (arg('uncapped-fps')) {
  // Ignores the monitor refresh rate; can tear and runs the GPU flat out.
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}

// Small JSON files in %APPDATA%\GameShell.
function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), name), 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(name, value) {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), name), JSON.stringify(value, null, 2));
  } catch (err) {
    console.warn(`could not write ${name}: ${err.message}`);
  }
}

function normalizeUrl(raw) {
  try {
    const url = new URL(String(raw).trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

// Each scan checks the live priority, so a failed or reset process is retried;
// a failure is logged once per pid while that pid is alive.
const warned = new Set();
function applyPriority() {
  const live = new Set();
  for (const { pid } of app.getAppMetrics()) {
    live.add(pid);
    try {
      if (os.getPriority(pid) !== PRIORITY) os.setPriority(pid, PRIORITY);
      warned.delete(pid);
    } catch (err) {
      if (!warned.has(pid)) console.warn(`priority ${PRIORITY_NAME} failed for pid ${pid}: ${err.message}`);
      warned.add(pid);
    }
  }
  for (const pid of warned) if (!live.has(pid)) warned.delete(pid);
}

// Logins survive restarts: Chromium drops session cookies (no expiry) on exit,
// so give them one. Sites that sign you in "until the browser closes" then
// keep you signed in for COOKIE_DAYS.
const COOKIE_DAYS = 30;
function keepSessionCookies(ses) {
  ses.cookies.on('changed', (_e, cookie, _cause, removed) => {
    if (removed || !cookie.session) return;
    const host = cookie.domain.replace(/^\./, '');
    ses.cookies.set({
      url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.hostOnly ? undefined : cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: Date.now() / 1000 + COOKIE_DAYS * 86400,
    }).catch((err) => console.warn(`could not keep cookie ${cookie.name}: ${err.message}`));
  });
}

// Saved passwords, one login per site origin. The password is encrypted with
// safeStorage (DPAPI on Windows, tied to this Windows user).
const PASSWORDS = 'passwords.json';
// webContents id -> { origin, username, password, submittedAt, navigated, timer }
const pendingLogins = new Map();
const PENDING_MS = 30000; // give up on a sign-in with no result by then
const RESULT_NAV_MS = 10000; // a navigation this soon after submit is its result

function savedLogin(origin) {
  const entry = readJson(PASSWORDS, {})[origin];
  if (!entry || entry.never || !entry.password) return null;
  try {
    return { username: entry.username, password: safeStorage.decryptString(Buffer.from(entry.password, 'base64')) };
  } catch {
    return null;
  }
}

// verified: the page changed in place (no navigation) and the login form went
// away. After a navigation the app cannot be sure, so it asks differently.
async function offerToSave(login, verified) {
  const all = readJson(PASSWORDS, {});
  const entry = all[login.origin];
  if (entry?.never) return;
  const current = savedLogin(login.origin);
  if (current && current.username === login.username && current.password === login.password) return;
  if (!safeStorage.isEncryptionAvailable()) return;
  let choice = 0;
  if (!TEST) {
    const host = new URL(login.origin).host;
    ({ response: choice } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Save password',
      message: `${current ? 'Update' : 'Save'} the password for ${login.username} on ${host}?`,
      detail: verified ? undefined : 'The page changed after you signed in. Save only if the sign-in worked.',
      buttons: [current ? 'Update' : 'Save', 'Not now', 'Never for this site'],
      defaultId: 0,
      cancelId: 1,
    }));
  }
  if (choice === 1) return;
  all[login.origin] = choice === 2
    ? { never: true }
    : { username: login.username, password: safeStorage.encryptString(login.password).toString('base64') };
  writeJson(PASSWORDS, all);
}

let win;

// Link policy for every page window, popups and their popups included:
// http(s) popups open in the app, owned by the window that opened them, so
// Windows keeps them above the always-on-top game. Only mailto: goes to the
// OS; every other scheme (file:, app protocols) is refused, for links,
// navigations and redirects alike. The setup page is opened by the app
// (Ctrl+,), never by a page.
const isWeb = (url) => /^https?:/i.test(url);
app.on('web-contents-created', (_e, wc) => {
  if (wc.getType() !== 'window') return;
  wc.setWindowOpenHandler(({ url }) => {
    if (isWeb(url)) {
      const owner = BrowserWindow.fromWebContents(wc) || win;
      return { action: 'allow', overrideBrowserWindowOptions: { parent: owner, autoHideMenuBar: true } };
    }
    if (/^mailto:/i.test(url)) {
      shell.openExternal(url).catch((err) => console.warn(`openExternal failed: ${err.message}`));
    }
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => !isWeb(url) && e.preventDefault());
  wc.on('will-redirect', (e, url) => !isWeb(url) && e.preventDefault());
});

// IPC is honored only from the main window's top frame: a web page for the
// login calls, the exact bundled setup page for the setup calls.
const SETUP_URL = pathToFileURL(SETUP_PAGE).href;
function topFrameOfMain(e) {
  return win && e.sender === win.webContents && e.senderFrame && e.senderFrame === e.sender.mainFrame;
}
function fromGame(e) {
  return topFrameOfMain(e) && /^https?:/.test(e.senderFrame.url);
}
function fromSetup(e) {
  return topFrameOfMain(e) && e.senderFrame.url.split(/[?#]/)[0] === SETUP_URL;
}

function dropPending(id) {
  clearTimeout(pendingLogins.get(id)?.timer);
  pendingLogins.delete(id);
}

// Sign-in result, decided by the preload once the page settles:
// - in place: the password form is gone for a moment -> success; the form is
//   still there and usable -> failure.
// - with a navigation: main keeps the login pending across it, and the new
//   page reports whether it shows a login form again.
// Anything else (later navigations, another origin, timeout) drops it.
ipcMain.on('login:submitted', (e, { username, password }) => {
  if (!fromGame(e) || typeof password !== 'string' || !password) return;
  dropPending(e.sender.id);
  const id = e.sender.id;
  pendingLogins.set(id, {
    origin: e.senderFrame.origin,
    username: String(username || ''),
    password,
    submittedAt: Date.now(),
    navigated: false,
    timer: setTimeout(() => pendingLogins.delete(id), PENDING_MS),
  });
});
ipcMain.on('login:result', (e, ok) => {
  if (!fromGame(e)) return;
  const login = pendingLogins.get(e.sender.id);
  dropPending(e.sender.id);
  if (ok === true && login && login.origin === e.senderFrame.origin) offerToSave(login, !login.navigated);
});
// A page asks after load whether it is the result of a sign-in.
ipcMain.handle('login:pending', (e) => {
  if (!fromGame(e)) return false;
  const login = pendingLogins.get(e.sender.id);
  return !!login && login.navigated && login.origin === e.senderFrame.origin;
});
function trackLoginNavigation(wc) {
  wc.on('did-start-navigation', (details) => {
    const login = pendingLogins.get(wc.id);
    if (!login || !details.isMainFrame || details.isSameDocument) return;
    if (login.navigated || Date.now() - login.submittedAt > RESULT_NAV_MS) dropPending(wc.id);
    else login.navigated = true;
  });
  wc.on('did-navigate', (_e, url) => {
    const login = pendingLogins.get(wc.id);
    let origin = null;
    try {
      origin = new URL(url).origin;
    } catch {}
    if (login && origin !== login.origin) dropPending(wc.id);
  });
}
// Credentials go only to a page of the origin they were saved for; the origin
// comes from Chromium, not from the page.
ipcMain.handle('login:get', (e) => (fromGame(e) ? savedLogin(e.senderFrame.origin) : null));

ipcMain.handle('setup:get', (e) => {
  if (!fromSetup(e)) return null;
  const settings = readJson('settings.json', {});
  return { url: settings.url || '', sites: Object.keys(readJson(PASSWORDS, {})) };
});
ipcMain.handle('setup:save', (e, raw) => {
  if (!fromSetup(e)) return false;
  const url = normalizeUrl(raw);
  if (!url) return false;
  writeJson('settings.json', { ...readJson('settings.json', {}), url });
  win.loadURL(url).catch(() => {});
  return true;
});
ipcMain.handle('setup:forget', (e, origin) => {
  if (!fromSetup(e)) return false;
  const all = readJson(PASSWORDS, {});
  delete all[origin];
  writeJson(PASSWORDS, all);
  return true;
});

// Window size, position and fullscreen survive restarts.
function saveBounds() {
  writeJson('window.json', { ...win.getNormalBounds(), fullScreen: win.isFullScreen(), maximized: win.isMaximized() });
}

function createWindow(startUrl) {
  // Borderless fullscreen like a normal game, unless the last run ended
  // windowed (F11) or --windowed is given. While a fullscreen app is in
  // front, Windows' "full-screen mode" rule turns on Do Not Disturb; Alt+Tab
  // works as usual and the game keeps running in the background.
  const saved = readJson('window.json', { width: 1600, height: 900, fullScreen: true });
  if (arg('windowed') || TEST) saved.fullScreen = false;
  win = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    fullscreen: !!saved.fullScreen,
    show: !TEST,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'GameShell',
    webPreferences: {
      partition: PARTITION, // keep logins between runs
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: LOW_LATENCY ? ['--gameshell-low-latency'] : [],
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setMenu(null);
  if (saved.maximized) win.maximize();
  win.on('close', saveBounds);

  // Some sign-in providers refuse user agents that name Electron.
  const ua = win.webContents.getUserAgent()
    .replace(/\sElectron\/\S+/, '')
    .replace(new RegExp(`\\s${app.getName()}\\/\\S+`), '');
  win.webContents.setUserAgent(ua);
  win.webContents.setBackgroundThrottling(false);

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key;
    if (key === 'F11') win.setFullScreen(!win.isFullScreen());
    else if (key === 'F5' && input.control) win.webContents.reloadIgnoringCache();
    else if (key === 'F5') win.webContents.reload();
    else if (key === 'F12') win.webContents.toggleDevTools();
    else if (key === ',' && input.control) win.loadFile(SETUP_PAGE);
    else return;
    e.preventDefault();
  });

  trackLoginNavigation(win.webContents);
  win.webContents.on('render-process-gone', (_e, details) => {
    console.warn(`renderer gone (${details.reason}); reloading`);
    if (details.reason !== 'clean-exit') win.reload();
  });

  // Network drop or server restart: retry after a few seconds instead of
  // leaving a dead error page. -3 is ERR_ABORTED (a navigation replaced it).
  // One pending retry at most; any newer main-frame navigation cancels it.
  let retryTimer = null;
  const cancelRetry = () => {
    clearTimeout(retryTimer);
    retryTimer = null;
  };
  const load = (url) => win.loadURL(url).catch(() => {}); // did-fail-load reports it
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) cancelRetry();
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !/^https?:/.test(url)) return;
    console.warn(`load failed (${desc}); retrying in 3 s`);
    cancelRetry();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!win.isDestroyed()) load(url);
    }, 3000);
  });

  if (startUrl) load(startUrl);
  else win.loadFile(SETUP_PAGE);
}

// Headless check for agents: load the URL in a hidden window, print the GPU
// status, page title and each process priority as JSON, then quit.
async function smokeTest(url) {
  const probe = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const report = { url };
  try {
    await probe.loadURL(url);
    report.title = probe.webContents.getTitle();
    // The renderer string names the GPU that WebGL (and so three.js) uses.
    report.webgl = await probe.webContents.executeJavaScript(`(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    })()`);
    report.webgpu = await probe.webContents.executeJavaScript(
      `navigator.gpu ? navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
        .then((a) => a ? (a.info?.vendor + ' ' + a.info?.architecture) : 'no adapter') : 'unavailable'`);
  } catch (err) {
    report.loadError = err.message;
  }
  applyPriority();
  report.processes = app.getAppMetrics().map(({ pid, type }) => ({ pid, type, priority: os.getPriority(pid) }));
  const gpu = await app.getGPUInfo('basic');
  report.gpu = (gpu.gpuDevice || []).map((d) => ({ active: d.active, vendorId: d.vendorId, deviceId: d.deviceId }));
  report.gpuFeatures = app.getGPUFeatureStatus();
  // The runtime that ships: check these against security advisories.
  report.versions = { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome };
  console.log(JSON.stringify(report, null, 2));
  app.exit(report.loadError ? 1 : 0);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    // --url=URL wins and is remembered; otherwise the saved URL; otherwise
    // the setup page asks for one.
    let startUrl = readJson('settings.json', {}).url;
    if (arg('url')) {
      startUrl = normalizeUrl(arg('url'));
      if (!startUrl) console.warn(`ignoring --url: not an http(s) URL`);
      else if (!arg('smoke-test')) writeJson('settings.json', { ...readJson('settings.json', {}), url: startUrl });
    }
    if (arg('smoke-test')) {
      if (!startUrl) {
        console.error('--smoke-test needs --url=URL or a saved URL');
        return app.exit(2);
      }
      return smokeTest(startUrl);
    }
    keepSessionCookies(session.fromPartition(PARTITION));
    if (!TEST) powerSaveBlocker.start('prevent-display-sleep');
    createWindow(startUrl);
    // Bring the window back from anywhere, even when another app holds focus.
    globalShortcut.register('Control+Alt+B', () => {
      if (win.isMinimized()) win.restore();
      win.show();
      win.moveTop();
      win.focus();
    });
    applyPriority();
    app.on('child-process-gone', applyPriority);
    app.on('web-contents-created', () => setTimeout(applyPriority, 500));
    setInterval(applyPriority, 5000);
  });

  // Write cookies to disk before exit so a fresh login is not lost.
  app.on('before-quit', () => session.fromPartition(PARTITION).cookies.flushStore());
  app.on('window-all-closed', () => app.quit());
}
