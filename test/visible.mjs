// Real key presses against a visible, fullscreen GameShell (not part of
// npm test: it takes over the screen and keyboard for about 15 s).
// Checks: the accessibility shortcut prompts are off while the game is in
// front and restored after exit; F5 reaches the game without a reload;
// Ctrl+F5 reloads; a lone Windows key does not open the Start menu.
//
//   node test/visible.mjs   (needs the tools/.venv Python, see tools/latency.mjs)
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const PYTHON = path.join(appDir, 'tools/.venv/Scripts/python.exe');
const helper = (...a) => JSON.parse(execFileSync(PYTHON, [path.join(appDir, 'tools/keys_helper.py'), ...a], { encoding: 'utf8' }));
const profile = fs.mkdtempSync(os.tmpdir() + '/gameshell-test-');
const page = `<title>visible-keys</title><body style="background:#123"><script>
window.nonce = Math.random();
window.keys = [];
addEventListener('keydown', (e) => keys.push(e.key));
</script></body>`;
const srv = http.createServer((q, r) => r.writeHead(200, { 'Content-Type': 'text/html' }).end(page)).listen(8770);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VK = { F5: '0x74', CTRL: '0x11', LWIN: '0x5B', ESC: '0x1B' };

const before = helper('sticky');
const child = spawn(appDir + '/node_modules/electron/dist/electron.exe', [appDir, '--url=http://localhost:8770/', `--user-data-dir=${profile}`, '--remote-debugging-port=9340'], { stdio: 'ignore' });
let t;
for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = (await (await fetch('http://127.0.0.1:9340/json')).json()).find((x) => x.type === 'page' && x.url.includes('8770')); } catch {} }
await sleep(1500);
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d); };
const ev = (e) => new Promise((r) => { waiting.set(++id, (d) => r(d.result?.result?.value)); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true } })); });

const out = { front: helper('front', 'visible-keys') };
await sleep(800);
const during = helper('sticky');
// Shortcut bits (0x4 hotkey active, 0x8 confirm) are cleared unless the feature itself (0x1) is on.
out.shortcutsOffWhilePlaying = Object.entries(before).every(([k, v]) => (v & 1 ? during[k] === v : (during[k] & 0xc) === 0));

const nonce = await ev('nonce');
helper('press', VK.F5);
await sleep(800);
out.f5ReachesGameNoReload = (await ev('nonce')) === nonce && (await ev('keys.includes("F5")'));

helper('press', VK.LWIN);
await sleep(900);
const fg = helper('foreground');
out.loneWinKeyNoStartMenu = fg.startsWith('visible-keys');
out.titleHint = fg.endsWith('· Ctrl+, settings');
if (!out.loneWinKeyNoStartMenu) helper('press', VK.ESC); // close the Start menu again

helper('front', 'visible-keys');
helper('press', VK.CTRL, VK.F5);
await sleep(1500);
out.ctrlF5Reloads = (await ev('nonce')) !== nonce;

ws.send(JSON.stringify({ id: 999, method: 'Runtime.evaluate', params: { expression: 'window.close()' } }));
await Promise.race([new Promise((r) => child.on('exit', r)), sleep(5000)]);
child.kill();
await sleep(500);
const after = helper('sticky');
out.shortcutsRestoredAfterExit = JSON.stringify(after) === JSON.stringify(before);
out.flags = { before, during, after, foregroundAfterWinKey: fg };
console.log(JSON.stringify(out));
srv.close();
const ok = ['front', 'titleHint', 'shortcutsOffWhilePlaying', 'f5ReachesGameNoReload', 'loneWinKeyNoStartMenu', 'ctrlF5Reloads', 'shortcutsRestoredAfterExit'].every((k) => out[k] === true);
console.log(`visible: ${ok ? 'pass' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
