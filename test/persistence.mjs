// Exercise asynchronous main-process persistence with controlled dialog/flush
// promises. No Electron window or real profile is needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');

function harness() {
  let store = {};
  const dialogs = [];
  let finishFlush;
  let flushCount = 0;
  let quitCount = 0;
  const app = Object.assign(new EventEmitter(), {
    commandLine: { appendSwitch() {} },
    getPath: () => '/profile',
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    quit: () => { quitCount++; },
  });
  const electron = {
    app,
    ipcMain: { on() {}, handle() {} },
    dialog: { showMessageBox: () => new Promise((resolve) => dialogs.push(resolve)) },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    session: { fromPartition: () => ({ cookies: { flushStore: () => {
      flushCount++;
      return new Promise((resolve, reject) => { finishFlush = { resolve, reject }; });
    } } }) },
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : name === './keyguard' ? {} : name === 'fs' ? {
      readFileSync: () => JSON.stringify(store),
      writeFileSync: (_file, data) => { store = JSON.parse(data); },
    } : require(name),
    process: { argv: [], env: {} }, __dirname: '/app', Buffer, URL,
    console: { warn() {} }, setTimeout, clearTimeout,
  });
  vm.runInContext(source + '\nglobalThis.offer = offerToSave;', context);
  return {
    app, offer: context.offer, dialogs,
    get store() { return store; },
    set store(value) { store = value; },
    get finishFlush() { return finishFlush; },
    get flushCount() { return flushCount; },
    get quitCount() { return quitCount; },
  };
}
const login = (origin, password = 'secret') => ({ origin, username: 'tester', password });
const h = harness();
h.store = { 'https://forgotten.test': { never: true } };
const first = h.offer(login('https://first.test'), true);
const second = h.offer(login('https://second.test'), true);
delete h.store['https://forgotten.test'];
h.dialogs[0]({ response: 0 });
await first;
h.dialogs[1]({ response: 0 });
await second;
assert.deepEqual(Object.keys(h.store).sort(), ['https://first.test', 'https://second.test']);

const stale = h.offer(login('https://first.test', 'replacement'), true);
delete h.store['https://first.test'];
h.dialogs[2]({ response: 0 });
await stale;
assert.equal(h.store['https://first.test'], undefined, 'an outstanding prompt must not restore a forgotten login');

for (const fail of [false, true]) {
  const q = harness();
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  q.app.emit('before-quit', event);
  q.app.emit('before-quit', event);
  assert.equal(prevented, 2);
  assert.equal(q.flushCount, 1);
  assert.equal(q.quitCount, 0, 'quit must wait for the cookie flush');
  if (fail) q.finishFlush.reject(new Error('disk failure'));
  else q.finishFlush.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(q.quitCount, 1);
  q.app.emit('before-quit', event);
  assert.equal(prevented, 2, 'the resumed quit must be allowed');
}
console.log('persistence: pass');
