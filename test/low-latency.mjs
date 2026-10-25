// --low-latency adds desynchronized to WebGL and 2D contexts, and keeps the page's other attributes.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
// Verify the preload's context options even on CI hosts without WebGL.
const preload = fs.readFileSync(new URL('../preload.js', import.meta.url), 'utf8');
for (const enabled of [false, true]) {
  const world = vm.createContext({});
  vm.runInContext(`
    class HTMLCanvasElement { getContext(type, attrs) { return { type, ...attrs }; } }
    class OffscreenCanvas { getContext(type, attrs) { return { type, ...attrs }; } }
  `, world);
  vm.runInNewContext(preload, {
    require: () => ({ contextBridge: { executeInMainWorld: ({ func }) => vm.runInContext('(' + func.toString() + ')()', world) } }),
    process: { argv: ['--gameshell-pause-on-blur', ...(enabled ? ['--gameshell-low-latency'] : [])] },
    location: { protocol: 'http:' }, window: { addEventListener() {} },
  });
  for (const ctor of ['HTMLCanvasElement', 'OffscreenCanvas']) {
    for (const type of ['webgl', 'webgl2', 'experimental-webgl', '2d']) {
      const value = vm.runInContext(`new ${ctor}().getContext('${type}', { antialias: true, desynchronized: false })`, world);
      assert.equal(value.desynchronized, enabled);
      assert.equal(value.antialias, true);
    }
    assert.equal(vm.runInContext(`new ${ctor}().getContext('webgpu', { desynchronized: false }).desynchronized`, world), false);
  }
}
const appDir = fileURLToPath(new URL('..', import.meta.url));
const profile = fs.mkdtempSync(os.tmpdir() + '/gameshell-test-');
const page = `<canvas id=a></canvas><canvas id=b></canvas><script>
window.gl = a.getContext('webgl2', { antialias: true })?.getContextAttributes() ?? null;
window.c2 = b.getContext('2d').getContextAttributes();</script>`;
const srv = http.createServer((q, r) => r.writeHead(200, { 'Content-Type': 'text/html' }).end(page)).listen(8766);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
for (const [name, extra] of [['off', []], ['on', ['--low-latency']]]) {
  fs.rmSync(profile, { recursive: true, force: true });
  const child = spawn(appDir + '/node_modules/electron/dist/electron.exe', [appDir, '--url=http://localhost:8766/', `--user-data-dir=${profile}`, '--remote-debugging-port=9336', ...extra], { env: { ...process.env, GAMESHELL_TEST: '1' }, stdio: 'ignore' });
  let t; for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = (await (await fetch('http://127.0.0.1:9336/json')).json()).find((x) => x.type === 'page' && x.url.includes('8766')); } catch {} }
  await sleep(1000);
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  const v = await new Promise((r) => { ws.onmessage = (m) => r(JSON.parse(m.data).result?.result?.value); ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '({gl: gl?.desynchronized ?? null, glAA: gl?.antialias ?? null, c2: c2.desynchronized})', returnByValue: true } })); });
  out[name] = v; child.kill(); await sleep(1500);
}
console.log(JSON.stringify(out)); srv.close();
const noWebGL = out.off?.gl === null && out.on?.gl === null;
if (noWebGL) console.log('WebGL presentation check skipped: host has no WebGL context; canvas option checks passed.');
const ok = out.off?.c2 === false && out.on?.c2 === true &&
  (noWebGL || (out.off?.gl === false && out.on?.gl === true && out.on?.glAA === true));
console.log(`low-latency: ${ok ? 'pass' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
