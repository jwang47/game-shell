// Keep focus (the default): the game sees no window blur or visibility change,
// keys held at blur get a key-up, and the page reports focused and visible.
// --pause-on-blur restores the browser's own behavior.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const profile = fs.mkdtempSync(os.tmpdir() + '/gameshell-test-');
// A game-like page: pauses on blur/visibilitychange, tracks held keys.
const page = `<title>focus</title><script>
window.log = { blur: 0, onblur: 0, visibility: 0, keyup: [] };
window.paused = false;
addEventListener('blur', () => { log.blur++; paused = true; });
window.onblur = () => { log.onblur++; };
document.addEventListener('visibilitychange', () => { log.visibility++; });
addEventListener('keyup', (e) => log.keyup.push(e.code));
</script>`;
const srv = http.createServer((q, r) => r.writeHead(200, { 'Content-Type': 'text/html' }).end(page)).listen(8767);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
for (const [name, extra] of [['keep', []], ['pause', ['--pause-on-blur']]]) {
  fs.rmSync(profile, { recursive: true, force: true });
  const child = spawn(appDir + '/node_modules/electron/dist/electron.exe', [appDir, '--url=http://localhost:8767/', `--user-data-dir=${profile}`, '--remote-debugging-port=9337', ...extra], { env: { ...process.env, GAMESHELL_TEST: '1' }, stdio: 'ignore' });
  let t;
  for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = (await (await fetch('http://127.0.0.1:9337/json')).json()).find((x) => x.type === 'page' && x.url.includes('8767')); } catch {} }
  await sleep(800);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d); };
  const send = (method, params) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
  // Hold W (a trusted key-down), then the window loses focus.
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  await ev("window.dispatchEvent(new FocusEvent('blur'))");
  await sleep(200);
  out[name] = await ev('({ ...log, paused, hidden: document.hidden, state: document.visibilityState, focus: document.hasFocus() })');
  child.kill();
  await sleep(1500);
}
console.log(JSON.stringify(out));
srv.close();
const k = out.keep;
const p = out.pause;
const ok = k.blur === 0 && k.onblur === 0 && !k.paused && k.keyup.includes('KeyW') && k.hidden === false && k.state === 'visible' && k.focus === true
  && p.blur === 1 && p.paused === true && !p.keyup.includes('KeyW');
console.log(`focus: ${ok ? 'pass' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
