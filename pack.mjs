// Build dist/GameShell-win32-x64/GameShell.exe. `node pack.mjs OUT` writes to
// OUT instead (for example while the exe in dist is running and locked).
// `node pack.mjs --zip` also writes dist/GameShell-<version>-win32-x64.zip for
// a GitHub Release.
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const zip = process.argv.includes('--zip');
const out = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'dist';
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const paths = await packager({
  dir: '.',
  name: 'GameShell',
  platform: 'win32',
  arch: 'x64',
  out,
  overwrite: true,
  icon: 'assets/icon.ico',
  appVersion: version,
  prune: false, // node_modules is filtered below instead
  // koffi's native module cannot load from inside the asar archive.
  asar: { unpack: '**/*.node' },
  // Paths are relative to the app folder and start with "/" on every platform.
  // The only runtime dependency is koffi (keyguard.js) with its Windows x64 binary.
  ignore: [
    /^\/node_modules\/(?!koffi(\/|$)|@koromix(\/|$))/,
    /^\/node_modules\/@koromix\/(?!koffi-win32-x64(\/|$))/,
    /^\/node_modules\/koffi\/(doc|vendor|lib)(\/|$)/,
    /^\/dist[^/]*(\/|$)/, /^\/(tools|test|docs|logs)(\/|$)/, /^\/assets\/icon\.ico$/,
    /^\/\.np?mrc$/, /^\/\.nvmrc$/, /^\/(pack|installer)\.mjs$/, /^\/README\.md$/, /^\/\.gitignore$/, /^\/\.github(\/|$)/,
  ],
});
console.log(`built ${paths.join(', ')}`);

if (zip) {
  const file = path.resolve(out, `GameShell-${version}-win32-x64.zip`);
  fs.rmSync(file, { force: true });
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${path.resolve(paths[0])}' -DestinationPath '${file}'`], { stdio: 'inherit' });
  console.log(`zipped ${file} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
}
