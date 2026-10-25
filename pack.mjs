// Build dist/GameShell-win32-x64/GameShell.exe. `node pack.mjs OUT` writes to
// OUT instead (for example while the exe in dist is running and locked).
import { packager } from '@electron/packager';

const out = process.argv[2] || 'dist';
const paths = await packager({
  dir: '.',
  name: 'GameShell',
  platform: 'win32',
  arch: 'x64',
  out,
  overwrite: true,
  prune: false, // the app has no runtime dependencies
  // Paths are relative to the app folder and start with "/" on every platform.
  ignore: [/^\/node_modules(\/|$)/, /^\/dist[^/]*(\/|$)/, /^\/(tools|test|docs|logs)(\/|$)/, /^\/\.np?mrc$/, /^\/\.nvmrc$/, /^\/pack\.mjs$/, /^\/README\.md$/, /^\/\.gitignore$/],
});
console.log(`built ${paths.join(', ')}`);
