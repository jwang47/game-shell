// Frame pacing with PresentMon, without screen capture (capture can turn off
// G-SYNC and independent flip). PresentMon 2.6 does not time keys sent with
// SendInput, so latency still comes from tools/latency.mjs.
//
// One elevated PresentMon session (one UAC prompt) records every present.
// Each arm opens tools/latency-scene.html fullscreen and the probe presses
// Right-arrow at random intervals for --seconds. The report counts only the
// arm's own processes (matched by its temporary profile folder).
//
//   node tools/pacing.mjs [--arms=a,b] [--seconds=20] [--label=TEXT] [--out=FILE]
//
// Needs tools/bin/PresentMon.exe (PresentMon 2.6.0 from
// github.com/GameTechDev/PresentMon) and the probe's Python environment (see
// tools/latency.mjs). It takes over the screen and keyboard.
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
const SECONDS = Number(opt.seconds) || 20;
const CHROME = opt.chrome || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ELECTRON = path.join(appDir, 'node_modules/electron/dist/electron.exe');
const PYTHON = path.join(here, '.venv/Scripts/python.exe');
const PRESENTMON = path.join(here, 'bin/PresentMon.exe');
const PORT = 9400;

const ARMS = {
  chrome: { exe: CHROME, args: [] },
  shell: { exe: ELECTRON, shell: true, args: [] },
  'shell-lowlat': { exe: ELECTRON, shell: true, args: ['--low-latency'] },
};
const armNames = opt.arms ? String(opt.arms).split(',') : Object.keys(ARMS);

const scene = fs.readFileSync(path.join(here, 'latency-scene.html'));
const server = http.createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(scene)).listen(8790);
const url = 'http://localhost:8790/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString().slice(11, 23), ...a);

function pidsFor(dataDir) {
  const needle = path.basename(dataDir);
  const out = execFileSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8' });
  return out.split(/\s+/).filter(Boolean).map(Number);
}

async function runArm(name) {
  const arm = ARMS[name];
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `pacing-${name}-`));
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
    await sleep(4000); // load, warm up
    const pids = pidsFor(dataDir);
    log(name, 'keys', pids.length, 'pids');
    const start = Date.now();
    const probe = JSON.parse(execFileSync(PYTHON, [path.join(here, 'latency_probe.py'), '--keys-only', String(SECONDS)], { encoding: 'utf8', timeout: SECONDS * 1000 + 30000 }));
    const end = Date.now();
    const browser = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const ws = new WebSocket(browser.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); // Electron exits before it answers
    await sleep(500);
    ws.close();
    return { name, pids, start, end, ...probe };
  } finally {
    await sleep(500);
    try { child.kill(); } catch {}
    await sleep(1500);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

// --- run ---
fs.mkdirSync(path.join(appDir, 'logs'), { recursive: true });
const csvPath = path.join(appDir, 'logs', `presentmon-${Date.now()}.csv`);
const total = armNames.length * (SECONDS + 15) + 20;
log('starting PresentMon (approve the UAC prompt)');
// Elevate with a hidden window: a visible elevated console would sit in front,
// and Windows does not let the (non-elevated) probe bring a window in front of
// it. Start-Process returns once the UAC prompt is answered and throws if it
// is declined.
const pmArgs = ['--stop_existing_session', '--session_name', 'GameShellPacing', '--process_name', 'electron.exe',
  '--process_name', 'chrome.exe', '--output_file', `"${csvPath}"`, '--date_time', '--v2_metrics',
  '--no_console_stats', '--timed', String(total), '--terminate_after_timed'].join(' ');
execFileSync('powershell', ['-NoProfile', '-Command',
  `Start-Process -FilePath '${PRESENTMON}' -Verb RunAs -WindowStyle Hidden -ArgumentList '${pmArgs}'`], { stdio: 'inherit' });
const pmStarted = Date.now();
await sleep(2000);

const runs = [];
for (const name of armNames) runs.push(await runArm(name));
log('waiting for PresentMon to finish');
await sleep(Math.max(0, pmStarted + total * 1000 + 3000 - Date.now()));
server.close();

// --- analyze ---
// PresentMon 2.6 --v2_metrics columns: FrameTime (present to present),
// DisplayedTime (how long the frame stayed on screen; NA = dropped),
// DisplayLatency (CPU start to on screen). Its date-time column is not in
// real UTC, so rows are matched by process ID: every arm starts new processes.
const lines = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
const head = lines[0].split(',');
const col = (n) => head.indexOf(n);
const rows = lines.slice(1).map((l) => l.split(','));
const num = (v) => (v === undefined || v === 'NA' || v === '' ? null : Number(v));
const q = (s, p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
const stat = (xs) => {
  const s = xs.filter((x) => x !== null).sort((a, b) => a - b);
  if (!s.length) return null;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  return { n: s.length, median: +q(s, 0.5).toFixed(2), p90: +q(s, 0.9).toFixed(2), p99: +q(s, 0.99).toFixed(2), sd: +sd.toFixed(2) };
};
const report = [];
for (const r of runs) {
  const mine = rows.filter((x) => r.pids.includes(Number(x[col('ProcessID')])));
  // Several swap chains may present (compositor, desynchronized canvas): report the busiest.
  const bySwap = {};
  for (const x of mine) (bySwap[x[col('SwapChainAddress')]] ??= []).push(x);
  const main = Object.values(bySwap).sort((a, b) => b.length - a.length)[0] || [];
  const dropped = main.filter((x) => num(x[col('DisplayedTime')]) === null).length;
  const modes = {};
  for (const x of main) modes[x[col('PresentMode')]] = (modes[x[col('PresentMode')]] || 0) + 1;
  const frameTimes = main.map((x) => num(x[col('FrameTime')])).filter((x) => x !== null);
  const seconds = frameTimes.reduce((a, b) => a + b, 0) / 1000;
  report.push({
    arm: r.name,
    label: opt.label || '',
    swapChains: Object.keys(bySwap).length,
    presents: main.length,
    fps: seconds ? +(main.length / seconds).toFixed(1) : null,
    droppedPct: main.length ? +((100 * dropped) / main.length).toFixed(2) : null,
    frameTimeMs: stat(frameTimes),
    displayedTimeMs: stat(main.map((x) => num(x[col('DisplayedTime')]))),
    displayLatencyMs: stat(main.map((x) => num(x[col('DisplayLatency')]))),
    presentMode: modes,
    keyPresses: r.presses,
    lostFocus: r.lost_focus,
  });
}
console.log(JSON.stringify(report, null, 2));
if (opt.out) fs.writeFileSync(String(opt.out), JSON.stringify(report, null, 2));
console.error(`raw CSV: ${csvPath}`);
process.exit(0);
