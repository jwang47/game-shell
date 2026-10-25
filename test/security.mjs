// Exercise the real main-process IPC handlers with Chromium sender identities.
// This isolates authorization from UI timing; popup.mjs checks real renderers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const handlers = new Map();
const files = new Map();
const app = Object.assign(new EventEmitter(), {
  commandLine: { appendSwitch() {} }, getPath: () => '/profile',
  requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}),
});
const electron = {
  app, ipcMain: {
    on: (name, fn) => handlers.set(name, fn),
    handle: (name, fn) => handlers.set(name, fn),
  },
  safeStorage: { decryptString: (b) => b.toString() },
};
const context = vm.createContext({
  require: (name) => name === 'electron' ? electron : name === './keyguard' ? {} : name === 'fs' ? {
    readFileSync: (file) => files.get(path.basename(file)) ?? '{}',
    writeFileSync: (file, value) => files.set(path.basename(file), value),
    realpathSync: (file) => path.resolve(file).replace(/([\\/])APP~1(?=[\\/])/i, '$1app'),
  } : require(name),
  process: { argv: [], env: {} }, __dirname: '/app', Buffer, URL,
  console, setTimeout, clearTimeout,
});
vm.runInContext(fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8') + `
  globalThis.setWindow = (value) => { win = value; };
  globalThis.setupUrl = require('url').pathToFileURL(SETUP_PAGE).href;
`, context);
const frame = { url: 'https://game.test/login', origin: 'https://game.test' };
const wc = { mainFrame: frame, id: 1 };
const loads = [];
context.setWindow({ webContents: wc, loadURL: async (url) => loads.push(url) });
const event = { sender: wc, senderFrame: frame };
const invoke = (name, e = event, ...args) => handlers.get(name)(e, ...args);
files.set('passwords.json', JSON.stringify({
  'https://game.test': { username: 'alice', password: Buffer.from('secret').toString('base64') },
  'https://never.test': { never: true },
}));
assert.equal(invoke('login:get').password, 'secret');
// The origin argument is ignored: only Chromium's senderFrame origin counts.
for (const origin of ['https://evil.test', 'http://game.test', 'https://game.test:8443', 'null']) {
  frame.origin = origin;
  assert.equal(invoke('login:get', event, 'https://game.test'), null);
}
frame.origin = 'https://game.test';
const unauthorized = [
  { sender: { mainFrame: frame }, senderFrame: frame }, // another window
  { sender: wc, senderFrame: { ...frame } }, // subframe, even at same origin
  { sender: wc, senderFrame: null }, // destroyed frame
];
for (const e of unauthorized) {
  assert.equal(invoke('login:get', e), null);
  assert.equal(invoke('login:pending', e), false);
  assert.equal(invoke('setup:get', e), null);
  assert.equal(invoke('setup:save', e, 'https://evil.test'), false);
  assert.equal(invoke('setup:forget', e, 'https://game.test'), false);
  invoke('login:submitted', e, { username: 'attacker', password: 'bad' });
  invoke('login:result', e, true);
}
// A web page and a similarly named local file cannot use setup privileges.
for (const url of ['https://game.test/setup.html', context.setupUrl + '.evil', 'file:///other/setup.html']) {
  frame.url = url;
  assert.equal(invoke('setup:get'), null);
  assert.equal(invoke('setup:save', event, 'https://evil.test'), false);
  assert.equal(invoke('setup:forget', event, 'https://game.test'), false);
}
assert.equal(loads.length, 0);
frame.url = context.setupUrl;
for (const e of [
  { sender: { mainFrame: frame }, senderFrame: frame },
  { sender: wc, senderFrame: { ...frame } },
  { sender: wc, senderFrame: null },
]) {
  assert.equal(invoke('setup:get', e), null);
  assert.equal(invoke('setup:save', e, 'https://evil.test'), false);
  assert.equal(invoke('setup:forget', e, 'https://game.test'), false);
}
assert.equal(invoke('login:get'), null, 'setup cannot retrieve plaintext passwords');
const settings = invoke('setup:get');
frame.url = context.setupUrl.replace('/app/', '/APP~1/');
assert.ok(invoke('setup:get'), 'a short-path alias for the bundled setup page is authorized');
frame.url = context.setupUrl + '?test=1#settings';
assert.ok(invoke('setup:get'), 'setup query and fragment do not change its file identity');
frame.url = context.setupUrl;
assert.equal(settings.sites.includes('https://game.test'), true);
assert.equal(JSON.stringify(settings).includes('secret'), false);
for (const url of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,hello', 'custom:foo', 'not a URL']) {
  assert.equal(invoke('setup:save', event, url), false);
}
assert.equal(loads.length, 0);
assert.equal(invoke('setup:save', event, 'https://game.test/play'), true);
assert.equal(loads[0], 'https://game.test/play');
assert.equal(invoke('setup:forget', event, 'https://game.test'), true);
assert.equal(JSON.parse(files.get('passwords.json'))['https://game.test'], undefined);
console.log('security: pass (IPC senders, origin isolation, setup authorization, URL schemes)');
