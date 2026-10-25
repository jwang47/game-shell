// Runs in an isolated world in the main window's top frame. On the setup page
// it exposes the settings API; on a web page it saves and fills logins.
const { contextBridge, ipcRenderer } = require('electron');

// --low-latency: before page scripts run, make every canvas context ask for
// desynchronized (low-latency) presentation. Runs in the page's own world so
// three.js sees the patched getContext.
if (process.argv.includes('--gameshell-low-latency') && location.protocol !== 'file:') {
  contextBridge.executeInMainWorld({
    func: () => {
      const patch = (proto) => {
        const getContext = proto.getContext;
        proto.getContext = function (type, attrs) {
          if (/^(webgl2?|experimental-webgl|2d)$/.test(type)) attrs = { ...attrs, desynchronized: true };
          return getContext.call(this, type, attrs);
        };
      };
      patch(HTMLCanvasElement.prototype);
      if (typeof OffscreenCanvas !== 'undefined') patch(OffscreenCanvas.prototype);
    },
  });
}

// Keep focus (default; off with --pause-on-blur): a UAC prompt, Alt+Tab or a
// notification must not pause the game. The page always looks focused and
// visible, and keys still held when the window loses focus get a key-up, so
// nothing sticks while the real key-up goes elsewhere.
if (!process.argv.includes('--gameshell-pause-on-blur') && location.protocol !== 'file:') {
  contextBridge.executeInMainWorld({
    func: () => {
      const held = new Map();
      addEventListener('keydown', (e) => {
        if (e.isTrusted) held.set(e.code, { key: e.key, code: e.code, keyCode: e.keyCode, which: e.which, location: e.location });
      }, true);
      addEventListener('keyup', (e) => {
        if (e.isTrusted) held.delete(e.code);
      }, true);
      addEventListener('blur', (e) => {
        if (e.target !== window) return;
        e.stopImmediatePropagation();
        const target = document.activeElement || document.body || document;
        for (const init of held.values()) target.dispatchEvent(new KeyboardEvent('keyup', { ...init, bubbles: true, cancelable: true }));
        held.clear();
      }, true);
      document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
      Object.defineProperty(Document.prototype, 'hidden', { get: () => false, configurable: true });
      Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible', configurable: true });
      Document.prototype.hasFocus = () => true;
    },
  });
}

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('gameShell', {
    get: () => ipcRenderer.invoke('setup:get'),
    save: (url) => ipcRenderer.invoke('setup:save', url),
    forget: (origin) => ipcRenderer.invoke('setup:forget', origin),
  });
} else {
  const visible = (el) => el.isConnected && !el.disabled && el.getClientRects().length > 0;
  const passwordFields = () => [...document.querySelectorAll('input[type="password"]')].filter(visible);

  // The username is the field marked autocomplete="username", else the last
  // visible text or email field before the password in the same form.
  function usernameFor(password) {
    const scope = password.form || document;
    const marked = scope.querySelector('input[autocomplete~="username"]');
    if (marked && visible(marked)) return marked;
    const fields = [...scope.querySelectorAll('input')].filter(visible);
    const before = fields.slice(0, fields.indexOf(password)).reverse();
    return before.find((el) => ['text', 'email', 'tel', ''].includes(el.type)) || null;
  }

  // Set the value the way typing would, so page scripts and frameworks see it.
  function fill(el, value) {
    if (!el || el.value) return;
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  let saved;
  let observer;
  let filled = false;
  async function autofill() {
    if (filled) return;
    const password = passwordFields().find((el) => el.autocomplete !== 'new-password');
    if (!password) return;
    filled = true; // one attempt per page; do not fight the user's edits
    observer?.disconnect();
    saved = saved ?? (await ipcRenderer.invoke('login:get'));
    if (!saved) return;
    // Never pair a stored password with another account already in the form.
    // Recheck after IPC too: the user or page may have edited it while waiting.
    const username = usernameFor(password);
    if (!visible(password) || (username?.value && username.value !== saved.username)) return;
    fill(username, saved.username);
    fill(password, saved.password);
  }

  // Sign-in result. Any shown password field counts, disabled or not, and
  // whichever node it is (a re-rendered form is still a form):
  // - no password field for goneMs -> success;
  // - a field that can be typed in for usableMs -> failure (the page gave the
  //   form back); a disabled field means "still waiting" and resets that;
  // - nothing settled by maxMs -> failure.
  const shownPasswordFields = () =>
    [...document.querySelectorAll('input[type="password"]')].filter((el) => el.isConnected && el.getClientRects().length > 0);
  let watching = null;
  function watchResult({ goneMs, usableMs, maxMs }) {
    clearInterval(watching);
    const started = Date.now();
    let goneSince = null;
    let usableSince = null;
    const report = (ok) => {
      clearInterval(watching);
      watching = null;
      ipcRenderer.send('login:result', ok);
    };
    watching = setInterval(() => {
      const now = Date.now();
      const fields = shownPasswordFields();
      if (!fields.length) {
        usableSince = null;
        goneSince ??= now;
        if (now - goneSince >= goneMs) report(true);
        return;
      }
      goneSince = null;
      if (fields.every((el) => !el.disabled && !el.readOnly)) {
        usableSince ??= now;
        if (now - usableSince >= usableMs) return report(false);
      } else {
        usableSince = null;
      }
      if (now - started > maxMs) report(false);
    }, 250);
  }

  function onSubmit(password) {
    if (!password || !password.value) return;
    const username = usernameFor(password);
    ipcRenderer.send('login:submitted', { username: username ? username.value : '', password: password.value });
    // If the page navigates instead, this watcher dies with it and the next
    // page decides (below).
    watchResult({ goneMs: 1000, usableMs: 5000, maxMs: 25000 });
  }

  window.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('submit', (e) => {
      onSubmit(e.target.querySelector?.('input[type="password"]'));
    }, true);
    // Some pages sign in from a button click or Enter without a form submit.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.type === 'password' && !e.target.form) onSubmit(e.target);
    }, true);
    autofill();
    // Single-page apps add the login form later.
    observer = new MutationObserver(() => autofill());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // This page may be where a form POST landed: a login form again means
    // the sign-in failed.
    ipcRenderer.invoke('login:pending').then((pending) => {
      if (pending) watchResult({ goneMs: 2000, usableMs: 1000, maxMs: 10000 });
    });
    // Hide the cursor after 2 s without mouse movement (main inserts the CSS);
    // any movement or click shows it again.
    let idleTimer;
    const wake = () => {
      document.documentElement.removeAttribute('data-gameshell-idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => document.documentElement.setAttribute('data-gameshell-idle', ''), 2000);
    };
    for (const type of ['mousemove', 'mousedown', 'wheel']) addEventListener(type, wake, { capture: true, passive: true });
    wake();
  });
}
