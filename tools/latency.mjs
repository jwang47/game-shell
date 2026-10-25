// Key-to-photon latency: GameShell modes against Chrome on the same page.
//
// Each arm opens the page fullscreen, then tools/latency_probe.py presses a
// real key (SendInput) and times how long the scene's corner square takes to
// change on screen (DXGI desktop duplication). That covers the OS input path,
// the browser, rendering and composition; the display's own scan-out and
// pixel response are the same for every arm and are not included.
//
//   node tools/latency.mjs [--arms=a,b] [--presses=200] [--runs=1] [--out=FILE]
//
// Needs Windows, Chrome, and the probe's Python environment:
//   py -3.11 -m venv tools/.venv; tools/.venv/Scripts/python -m pip install dxcam==0.0.5
// It takes over the screen and sends Right-arrow key presses: run it only
// when nobody is using the machine.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const opt = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const PRESSES = Number(opt.presses) || 200;
const RUNS = Number(opt.runs) || 1;
const CHROME = opt.chrome || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ELECTRON = path.join(appDir, 'node_modules/electron/dist/electron.exe');
const PYTHON = path.join(here, '.venv/Scripts/python.exe');
const PORT = 9400;

const ARMS = {
  chrome: { exe: CHROME, args: [] },
  'chrome-novsync': { exe: CHROME, args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] },
  shell: { exe: ELECTRON, shell: true, args: [] },
  'shell-lowlat': { exe: ELECTRON, shell: true, args: ['--low-latency'] },
  'shell-novsync': { exe: ELECTRON, shell: true, args: ['--uncapped-fps'] },
  'shell-novsync-lowlat': { exe: ELECTRON, shell: true, args: ['--uncapped-fps', '--low-latency'] },
};
const armNames = opt.arms ? String(opt.arms).split(',') : Object.keys(ARMS);

const scene = fs.readFileSync(path.join(here, 'latency-scene.html'));
const server = http.createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(scene)).listen(8790);
const url = 'http://localhost:8790/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString().slice(11, 23), ...a);

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id) waiting.get(d.id)?.(d);
  };
  return {
    send: (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); }),
    close: () => ws.close(),
  };
}

async function runArm(name) {
  const arm = ARMS[name];
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `latency-${name}-`));
  // GameShell starts fullscreen on a fresh profile; Chrome as a fullscreen app window.
  const args = arm.shell
    ? [appDir, `--url=${url}`, ...arm.args]
    : ['--no-first-run', '--no-default-browser-check', '--start-fullscreen', `--app=${url}`, ...arm.args];
  const child = spawn(arm.exe, [...args, `--user-data-dir=${dataDir}`, `--remote-debugging-port=${PORT}`], { stdio: 'ignore' });
  try {
    let page;
    for (let i = 0; i < 80 && !page; i++) {
      await sleep(250);
      try {
        page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page' && t.url.startsWith(url));
      } catch {}
    }
    if (!page) throw new Error('page did not open');
    const tab = await cdp(page.webSocketDebuggerUrl);
    const evaluate = async (e) => (await tab.send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
    for (let i = 0; i < 80 && !(await evaluate('window.__ready === true')); i++) await sleep(250);
    await sleep(2000); // warm up shaders and caches
    log(name, 'probing');

    const probe = JSON.parse(execFileSync(PYTHON, [path.join(here, 'latency_probe.py'), '--presses', String(PRESSES)], { encoding: 'utf8', timeout: PRESSES * 1000 + 30000 }));
    if (probe.error) throw new Error(probe.error);
    log(name, 'probe', probe.samples.length, 'samples', probe.misses, 'misses', probe.lost_focus, 'lost focus');
    // Frame rate while the window is in front.
    const f0 = await evaluate('window.__frames');
    await sleep(2000);
    const fps = ((await evaluate('window.__frames')) - f0) / 2;
    const context = await evaluate('JSON.stringify(window.__context)');
    const browser = await cdp((await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl);
    browser.send('Browser.close'); // Electron exits before it answers
    await sleep(500);
    tab.close();
    browser.close();
    return { name, fps, desync: JSON.parse(context)?.desynchronized ?? null, ...probe };
  } finally {
    await sleep(500);
    try { child.kill(); } catch {}
    await sleep(1500);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

const q = (s, p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
const rows = [];
const all = {};
for (let run = 0; run < RUNS; run++) {
  for (const name of armNames) {
    // A run can start before the window has the foreground; retry it once.
    let r = await runArm(name);
    if (!r.samples.length) r = await runArm(name);
    if (!r.samples.length) throw new Error(`${name}: no samples`);
    const s = [...r.samples].sort((a, b) => a - b);
    (all[name] ??= []).push(...r.samples);
    rows.push({
      arm: name,
      run: run + 1,
      n: s.length,
      misses: r.misses,
      lost_focus: r.lost_focus,
      p10_ms: +q(s, 0.1).toFixed(1),
      median_ms: +q(s, 0.5).toFixed(1),
      p90_ms: +q(s, 0.9).toFixed(1),
      mean_ms: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1),
      fps: Math.round(r.fps),
      desync: r.desync,
    });
    log(JSON.stringify(rows.at(-1)));
  }
}
console.table(rows);
if (opt.out) fs.writeFileSync(String(opt.out), JSON.stringify({ rows, samples: all }, null, 1));
server.close();
process.exit(0);
