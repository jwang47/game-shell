// Low latency (the default) adds desynchronized to WebGL and 2D contexts, and keeps the page's other attributes.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const appDir = fileURLToPath(new URL('..', import.meta.url));
const profile = fs.mkdtempSync(os.tmpdir() + '/gameshell-test-');
const page = `<canvas id=a></canvas><canvas id=b></canvas><script>
window.gl = a.getContext('webgl2', { antialias: true }).getContextAttributes();
window.c2 = b.getContext('2d').getContextAttributes();</script>`;
const srv = http.createServer((q, r) => r.writeHead(200, { 'Content-Type': 'text/html' }).end(page)).listen(8766);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
for (const [name, extra] of [['off', ['--no-low-latency']], ['default', []]]) {
  fs.rmSync(profile, { recursive: true, force: true });
  const child = spawn(appDir + '/node_modules/electron/dist/electron.exe', [appDir, '--url=http://localhost:8766/', `--user-data-dir=${profile}`, '--remote-debugging-port=9336', ...extra], { env: { ...process.env, GAMESHELL_TEST: '1' }, stdio: 'ignore' });
  let t; for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = (await (await fetch('http://127.0.0.1:9336/json')).json()).find((x) => x.type === 'page' && x.url.includes('8766')); } catch {} }
  await sleep(1000);
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  const v = await new Promise((r) => { ws.onmessage = (m) => r(JSON.parse(m.data).result?.result?.value); ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '({gl: gl.desynchronized, glAA: gl.antialias, c2: c2.desynchronized})', returnByValue: true } })); });
  out[name] = v; child.kill(); await sleep(1500);
}
console.log(JSON.stringify(out)); srv.close();
const ok = out.off.gl === false && out.off.c2 === false && out.default.gl === true && out.default.c2 === true && out.default.glAA === true;
console.log(`low-latency: ${ok ? 'pass' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
