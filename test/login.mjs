// End-to-end check of saved logins: fake sign-in server + the app driven over CDP.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import os from 'node:os';
import { fileURLToPath } from 'node:url';
const appDir = fileURLToPath(new URL('..', import.meta.url));
const profile = fs.mkdtempSync(os.tmpdir() + '/gameshell-test-');
const PORT = 8765, CDP = 9333;
const sessions = new Set();
const GOOD = (u, p) => u.startsWith('tester') && p === 'correct-horse-1';

const ajaxForm = (mode) => `<!doctype html><title>Sign in</title><div id=box><form id=f>
<input name="username" autocomplete="username"><input name="password" type="password" autocomplete="current-password">
<button>Sign in</button></form></div><div id=msg></div>
<script>const MODE=${JSON.stringify(mode)};
document.addEventListener('submit',async(e)=>{e.preventDefault();const f=e.target;
 const inputs=[...f.querySelectorAll('input')]; if(MODE==='slow')inputs.forEach(i=>i.disabled=true);
 const body=new URLSearchParams({username:f.username.value,password:f.password.value});
 const r=await fetch('/login'+(MODE==='slow'?'?slow':''),{method:'POST',body});
 inputs.forEach(i=>i.disabled=false);
 if(r.ok){box.remove();document.body.insertAdjacentHTML('beforeend','<h1 id=game>game</h1>')}
 else if(MODE==='rerender'){box.innerHTML=box.innerHTML;msg.textContent='bad'}
 else msg.textContent='bad'});</script>`;
const postForm = (err) => `<!doctype html><title>Sign in</title><form method=post action=/post-login>
<input name="username" autocomplete="username"><input name="password" type="password" autocomplete="current-password">
<button>Sign in</button></form><p>${err ? 'Wrong password' : ''}</p>`;

function newSession(res, headers = {}) {
  const id = String(Date.now());
  sessions.add(id);
  res.writeHead(headers.Location ? 302 : 200, { 'Set-Cookie': `sid=${id}; Path=/; HttpOnly`, ...headers }); // session cookie
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const sid = /sid=(\w+)/.exec(req.headers.cookie || '')?.[1];
  let body = '';
  req.on('data', (d) => (body += d)).on('end', () => {
    const p = new URLSearchParams(body);
    if (url.pathname === '/login') {
      const answer = () => (GOOD(p.get('username'), p.get('password')) ? newSession(res) : res.writeHead(401), res.end());
      return url.searchParams.has('slow') ? setTimeout(answer, 2500) : answer();
    }
    if (url.pathname === '/post-login') {
      if (GOOD(p.get('username'), p.get('password'))) return newSession(res, { Location: '/' }), res.end();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(postForm(true));
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (url.pathname === '/about') return res.end('<title>About</title><p>about</p>');
    if (url.pathname === '/other-account') return res.end(ajaxForm('ajax').replace('name="username"', 'name="username" value="another-user"'));
    if (sid && sessions.has(sid)) return res.end('<title>In game</title><h1 id=game>game</h1>');
    const mode = url.searchParams.get('mode') || 'ajax';
    res.end(mode === 'post' ? postForm(false) : ajaxForm(mode));
  });
}).listen(PORT);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://localhost:${PORT}/`;
async function launch() {
  const child = spawn(path.join(appDir, 'node_modules/electron/dist/electron.exe'),
    [appDir, `--url=${base}`, `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`],
    { env: { ...process.env, GAMESHELL_TEST: '1' }, stdio: 'ignore' });
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      target = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find((t) => t.type === 'page' && t.url.includes(String(PORT)));
    } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
  const send = (method, params) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.result?.value;
  const exited = new Promise((r) => child.on('exit', r));
  return {
    send, evaluate,
    go: async (url) => { await send('Page.navigate', { url }); await sleep(1200); },
    close: async () => { evaluate('window.close()'); await Promise.race([exited, sleep(5000)]); child.kill(); },
  };
}
const store = () => { try { return JSON.parse(fs.readFileSync(path.join(profile, 'passwords.json'), 'utf8')); } catch { return null; } };

const results = {};
const a = await launch();
const type = (u, p) => a.evaluate(`(()=>{const u=document.querySelector('[name=username]'),p=document.querySelector('[name=password]');
  u.value=${JSON.stringify(u)};p.value=${JSON.stringify(p)};document.querySelector('button').click();})()`);
const noSave = async (name, mode, waitMs, after) => {
  await a.go(`${base}?mode=${mode}`);
  await type('tester', 'wrong-password-1');
  await sleep(waitMs);
  if (after) await after();
  results[name] = store() === null ? 'pass' : `FAIL ${JSON.stringify(store())}`;
};
await noSave('rejectedAjax', 'ajax', 7000);
await noSave('rejectedSlowDisabledFields', 'slow', 9500);
await noSave('rejectedRerenderedForm', 'rerender', 7000);
await noSave('rejectedFormPost', 'post', 5000);
await noSave('leftRejectedAjaxForm', 'ajax', 6500, async () => { await a.go(`${base}about`); await sleep(3000); });

await a.go(`${base}?mode=post`);
await type('tester', 'correct-horse-1');
await sleep(4000);
results.goodFormPostSaved = store()?.[`http://localhost:${PORT}`]?.username === 'tester' ? 'pass' : `FAIL ${JSON.stringify(store())}`;

await a.send('Network.clearBrowserCookies');
await a.go(`${base}?mode=ajax`);
await a.evaluate(`document.querySelector('[name=username]').value='';document.querySelector('[name=password]').value=''`);
await type('tester2', 'correct-horse-1');
await sleep(2500);
results.goodAjaxUpdated = store()?.[`http://localhost:${PORT}`]?.username === 'tester2' ? 'pass' : `FAIL ${JSON.stringify(store())}`;
results.passwordIsEncrypted = !JSON.stringify(store()).includes('correct-horse-1') ? 'pass' : 'FAIL';
await a.close();

// Restart: still signed in (session cookie kept); after sign-out, the form fills.
const b = await launch();
await sleep(1500);
results.signedInAfterRestart = (await b.evaluate('!!document.getElementById("game")')) ? 'pass' : 'FAIL';
await b.send('Network.clearBrowserCookies');
await b.go(`${base}?mode=ajax`);
await sleep(800);
results.autofill = (await b.evaluate(`[document.querySelector('[name=username]')?.value, document.querySelector('[name=password]')?.value === 'correct-horse-1'].join()`)) === 'tester2,true' ? 'pass' : 'FAIL';
await b.go(`${base}other-account`);
results.otherAccountNotFilled = (await b.evaluate(`[document.querySelector('[name=username]').value, document.querySelector('[name=password]').value].join()`)) === 'another-user,' ? 'pass' : 'FAIL';
await b.close();
console.log(JSON.stringify(results, null, 2));
const failed = Object.entries(results).filter(([, v]) => v !== 'pass');
console.log(failed.length ? `login: FAIL ${failed.map(([k]) => k).join(', ')}` : 'login: pass');
process.exit(failed.length ? 1 : 0);
