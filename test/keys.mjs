// F5 and F12 reach the game (no reload); the cursor hides after 2 s without
// mouse movement and comes back on movement. Keys sent through the DevTools
// protocol skip Electron's before-input-event, so the app shortcuts
// (Ctrl+F5, ...) and the keyguard are checked with real key presses in
// test/visible.mjs.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const profile = fs.mkdtempSync(os.tmpdir() + '/gameshell-test-');
const page = `<title>keys</title><body style="height:100vh;margin:0"><script>
window.nonce = Math.random();
window.keys = [];
addEventListener('keydown', (e) => keys.push(e.key));
</script></body>`;
const srv = http.createServer((q, r) => r.writeHead(200, { 'Content-Type': 'text/html' }).end(page)).listen(8768);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(appDir + '/node_modules/electron/dist/electron.exe', [appDir, '--url=http://localhost:8768/', `--user-data-dir=${profile}`, '--remote-debugging-port=9338'], { env: { ...process.env, GAMESHELL_TEST: '1' }, stdio: 'ignore' });
let t;
for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = (await (await fetch('http://127.0.0.1:9338/json')).json()).find((x) => x.type === 'page' && x.url.includes('8768')); } catch {} }
await sleep(800);
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d); };
const send = (method, params) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const press = async (key, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
};

const out = {};
const nonce = await ev('nonce');
await press('F5', 'F5', 116);
await press('F12', 'F12', 123);
await sleep(500);
out.fKeysReachGame = (await ev('keys.join()')) === 'F5,F12';
out.noReload = (await ev('nonce')) === nonce;
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 100, y: 100 });
await sleep(300);
out.cursorShownAfterMove = (await ev("getComputedStyle(document.body).cursor")) !== 'none';
await sleep(2500);
out.cursorHiddenWhenIdle = (await ev("getComputedStyle(document.body).cursor")) === 'none';
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 140, y: 120 });
await sleep(200);
out.cursorBackOnMove = (await ev("getComputedStyle(document.body).cursor")) !== 'none';

console.log(JSON.stringify(out));
child.kill();
srv.close();
const ok = Object.values(out).every(Boolean);
console.log(`keys: ${ok ? 'pass' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
