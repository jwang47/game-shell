// Link policy in popups and the setup page API, using only a local server.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const appDir = fileURLToPath(new URL('..', import.meta.url));
const profile = fs.mkdtempSync(os.tmpdir() + '/gameshell-test-');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Popup test</title>'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const child = spawn(appDir + '/node_modules/electron/dist/electron.exe', [appDir, `--user-data-dir=${profile}`, '--remote-debugging-port=9335'], { env: { ...process.env, GAMESHELL_TEST: '1' }, stdio: 'ignore' });
const targets = async () => (await (await fetch('http://127.0.0.1:9335/json')).json()).filter((x) => x.type === 'page');
async function conn(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const p = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); p.get(d.id)?.(d); };
  return (e) => new Promise((r) => { p.set(++id, (d) => r(d.result?.result?.value ?? d.error?.message)); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: e, awaitPromise: true, returnByValue: true } })); });
}
let t; for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = (await targets())[0]; } catch {} }
const main = await conn(t);
await sleep(800);
const out = { setupApi: await main("typeof gameShell.get"), setupGet: await main("gameShell.get().then(s => s !== null)") };
await main(`gameShell.save(${JSON.stringify(base)})`);
await sleep(2500);
await main(`window.open(${JSON.stringify(base + '?popup')})`);
await sleep(2500);
const popupT = (await targets()).find((x) => x.url.includes('popup'));
const popup = await conn(popupT);
out.popupFileOpen = await popup("String(window.open('file:///C:/Windows/win.ini'))");
await popup("location.href='file:///C:/Windows/win.ini'");
await sleep(1500);
out.popupStillOnWeb = (await popup('location.href')) === base + '?popup';
out.nestedPopupOpened = await popup(`!!window.open(${JSON.stringify(base + '?nested')})`);
await sleep(2000);
out.pageCount = (await targets()).length;
console.log(JSON.stringify(out)); child.kill();
server.close();
const ok = out.setupApi === 'function' && out.setupGet === true && out.popupFileOpen === 'null' && out.popupStillOnWeb === true && out.nestedPopupOpened === true;
console.log(`popup: ${ok ? 'pass' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
