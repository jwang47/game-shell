// Launch an isolated copy of the distributable, so missing packaged dependencies
// cannot be satisfied by the source checkout's node_modules.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = path.resolve(process.argv[2] || path.join(root, 'dist/GameShell-win32-x64'));
assert.ok(fs.existsSync(path.join(source, 'GameShell.exe')), 'Run npm run pack first');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gameshell-packaged-'));
const profile = path.join(temp, 'profile');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<title>Packaged game fixture</title><h1 id="game">Ready</h1>');
});
let child, ws, exited;
let output = '';
let failure;
const pending = new Map();
try {
  const appDir = path.join(temp, 'app');
  fs.cpSync(source, appDir, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const env = { ...process.env, GAMESHELL_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_PATH;
  child = spawn(path.join(appDir, 'GameShell.exe'), [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  ], { cwd: temp, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  exited = new Promise((resolve) => {
    child.once('error', (error) => { failure = error; resolve(null); });
    child.once('exit', (code) => resolve(code));
  });
  async function until(check, label, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`App exited early (${child.exitCode}): ${output}`);
      const result = await check();
      if (result) return result;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }
  const port = await until(() => {
    try { return Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]); }
    catch { return null; }
  }, 'debugging endpoint');
  const target = await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) });
    return (await response.json()).find((item) => item.type === 'page' && item.url.endsWith('/setup.html'));
  }, 'bundled setup page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP connection failed')); };
  });
  let nextId = 0;
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message);
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 5000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      pending.delete(id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const settings = await evaluate('gameShell.get()');
  assert.equal(settings.url, '');
  assert.deepEqual(settings.sites, []);
  // Use the actual setup UI bridge to navigate into the local game fixture.
  assert.equal(await evaluate(`gameShell.save(${JSON.stringify(url)})`), true);
  await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) });
    return (await response.json()).some((item) => item.id === target.id && item.title === 'Packaged game fixture');
  }, 'game navigation');
  assert.equal(await evaluate("document.getElementById('game')?.textContent"), 'Ready');
  assert.equal(await evaluate("typeof require === 'undefined' && typeof process === 'undefined' && typeof gameShell === 'undefined'"), true);
  // Missing koffi is otherwise a nonfatal warning; treat it as a broken build.
  assert.doesNotMatch(output, /keyguard off:|keyguard: could not|Unable to load preload|Cannot find module/i);
  // Closing the app can tear down CDP before the command's reply arrives.
  // Its actual process exit is the shutdown assertion.
  ws.send(JSON.stringify({ id: ++nextId, method: 'Browser.close' }));
  const code = await Promise.race([exited, sleep(10000).then(() => 'timeout')]);
  assert.equal(code, 0, `Packaged app did not exit cleanly: ${output}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).url, url);
  console.log('packaged: pass (isolated distribution, native keyguard, setup/preload, game navigation, sandbox, clean shutdown)');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  ws?.close();
  if (child && child.exitCode === null) child.kill();
  if (exited) await Promise.race([exited, sleep(5000)]);
  server.closeAllConnections();
  server.close();
  // Only remove the exact temporary directory created above.
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith('gameshell-packaged-'));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
