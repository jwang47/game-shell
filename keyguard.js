// While the game is fullscreen and in front (Windows only):
// - a lone press of the Windows key does not open the Start menu. Win+key
//   combinations (Win+G, Win+Shift+S, ...) still work: like AutoHotkey's
//   "mask key", a harmless unassigned key is sent before the Windows key goes
//   up, so Windows no longer sees a lone press.
// - the Sticky Keys, Toggle Keys and Filter Keys shortcut prompts (Shift five
//   times, holding Shift, ...) are off, as Microsoft recommends for games
//   ("Disabling Shortcut Keys in Games"). Only the shortcuts change, never the
//   features, the change is not saved, and the old values come back when the
//   game leaves the front or the app quits.
let koffi;
try {
  koffi = process.platform === 'win32' ? require('koffi') : null;
} catch (err) {
  console.warn(`keyguard off: ${err.message}`);
}

const VK_LWIN = 0x5b;
const VK_RWIN = 0x5c;
const VK_MASK = 0xe8; // unassigned
const WH_KEYBOARD_LL = 13;
const WM_KEYDOWN = 0x100;
const WM_KEYUP = 0x101;
const WM_SYSKEYDOWN = 0x104;
const WM_SYSKEYUP = 0x105;
const KEYEVENTF_KEYUP = 2;
// SPI_GET*/SPI_SET* pairs and the flags to clear when the feature itself is off.
const HOTKEY_FLAGS = 0x4 | 0x8; // *_HOTKEYACTIVE | *_CONFIRMHOTKEY
const FEATURES = [
  { name: 'STICKYKEYS', get: 0x3a, set: 0x3b, fields: 2 },
  { name: 'TOGGLEKEYS', get: 0x34, set: 0x35, fields: 2 },
  { name: 'FILTERKEYS', get: 0x32, set: 0x33, fields: 6 },
];

// The flags to set while playing: clear the shortcut bits unless the user has
// the feature itself on (bit 0x1), then the shortcut is how they turn it off.
function withoutShortcut(flags) {
  return flags & 0x1 ? flags : flags & ~HOTKEY_FLAGS;
}

function createKeyguard() {
  if (!koffi) return { setActive() {}, dispose() {} };
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
    vkCode: 'uint32', scanCode: 'uint32', flags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
  });
  const HookProc = koffi.proto('intptr_t __stdcall HookProc(int nCode, uintptr_t wParam, void *lParam)');
  const SetWindowsHookExW = user32.func('void * __stdcall SetWindowsHookExW(int idHook, HookProc *lpfn, void *hmod, uint32 threadId)');
  const CallNextHookEx = user32.func('intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)');
  const UnhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(void *hhk)');
  const keybd_event = user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)');
  const GetModuleHandleW = kernel32.func('void * __stdcall GetModuleHandleW(const char16_t *name)');
  // Each feature struct is cbSize followed by uint32 fields (dwFlags first).
  const access = FEATURES.map((f) => {
    const fields = { cbSize: 'uint32' };
    for (let i = 0; i < f.fields - 1; i++) fields[i === 0 ? 'dwFlags' : `f${i}`] = 'uint32';
    const type = koffi.struct(f.name, fields);
    const spi = user32.func(`bool __stdcall SystemParametersInfoW(uint32 action, uint32 size, _Inout_ ${f.name} *value, uint32 winIni)`);
    return { ...f, type, size: koffi.sizeof(type), spi, saved: null };
  });

  let active = false;
  let winDown = false;
  let comboUsed = false;

  const proc = koffi.register((nCode, wParam, lParam) => {
    if (nCode === 0 && active) {
      const key = koffi.decode(lParam, KBDLLHOOKSTRUCT);
      const down = wParam === WM_KEYDOWN || wParam === WM_SYSKEYDOWN;
      const up = wParam === WM_KEYUP || wParam === WM_SYSKEYUP;
      const isWin = key.vkCode === VK_LWIN || key.vkCode === VK_RWIN;
      if (isWin && down && !winDown) {
        winDown = true;
        comboUsed = false;
      } else if (!isWin && down && winDown && key.vkCode !== VK_MASK) {
        comboUsed = true;
      } else if (isWin && up && winDown) {
        winDown = false;
        if (!comboUsed) {
          keybd_event(VK_MASK, 0, 0, 0);
          keybd_event(VK_MASK, 0, KEYEVENTF_KEYUP, 0);
        }
      }
    }
    return CallNextHookEx(null, nCode, wParam, lParam);
  }, koffi.pointer(HookProc));
  const hook = SetWindowsHookExW(WH_KEYBOARD_LL, proc, GetModuleHandleW(null), 0);
  if (!hook) console.warn('keyguard: could not install the keyboard hook');

  function setShortcutsOff(off) {
    for (const f of access) {
      if (off) {
        const value = { cbSize: f.size };
        if (!f.spi(f.get, f.size, value, 0)) continue;
        f.saved = { ...value };
        const flags = withoutShortcut(value.dwFlags);
        if (flags === value.dwFlags) continue;
        f.spi(f.set, f.size, { ...value, dwFlags: flags }, 0);
      } else if (f.saved) {
        f.spi(f.set, f.size, { ...f.saved }, 0);
        f.saved = null;
      }
    }
  }

  return {
    setActive(on) {
      if (on === active) return;
      active = on;
      winDown = false;
      setShortcutsOff(on);
    },
    // Reads the current shortcut flags (for tests).
    shortcutFlags() {
      return Object.fromEntries(access.map((f) => {
        const value = { cbSize: f.size };
        f.spi(f.get, f.size, value, 0);
        return [f.name, value.dwFlags];
      }));
    },
    dispose() {
      this.setActive(false);
      if (hook) UnhookWindowsHookEx(hook);
      koffi.unregister(proc);
    },
  };
}

module.exports = { createKeyguard, withoutShortcut };
