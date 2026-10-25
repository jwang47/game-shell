// keyguard.js flag logic: shortcut bits (0x4 hotkey active, 0x8 confirm) are
// cleared while playing, unless the feature itself (0x1) is on.
import { createRequire } from 'node:module';

const { withoutShortcut } = createRequire(import.meta.url)('../keyguard.js');
const cases = [
  [0x1fe, 0x1f2], // Windows default Sticky Keys: shortcut on, feature off
  [0x1f2, 0x1f2], // shortcut already off
  [0x1ff, 0x1ff], // feature on: leave it alone
  [0x7e, 0x72], // Filter Keys default
  [0x3a, 0x32], // Toggle Keys default
];
const bad = cases.filter(([input, want]) => withoutShortcut(input) !== want);
console.log(`keyguard: ${bad.length ? `FAIL ${JSON.stringify(bad)}` : 'pass'}`);
process.exit(bad.length ? 1 : 0);
