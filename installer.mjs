// Wrap the already tested Windows distribution; never publish from this script.
import { build, Platform, Arch } from 'electron-builder';
import fs from 'node:fs';
import path from 'node:path';
import { signFile } from './tools/sign.mjs';

const prepackaged = path.resolve('dist/GameShell-win32-x64');
if (!fs.existsSync(path.join(prepackaged, 'GameShell.exe'))) throw new Error('Run npm run pack first');
const signed = process.argv.includes('--signed');
// electron-builder skips app signing for prepackaged distributions.
if (signed) signFile(path.join(prepackaged, 'GameShell.exe'));
await build({
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  prepackaged,
  publish: 'never',
  config: {
    appId: 'io.github.jwang47.gameshell',
    productName: 'GameShell',
    directories: { output: 'dist-installer' },
    artifactName: 'GameShell-${version}-Setup-${arch}.${ext}',
    win: {
      icon: 'assets/icon.ico', executableName: 'GameShell',
      ...(signed ? { signtoolOptions: {
        signingHashAlgorithms: ['sha256'],
        sign: async ({ path: file }) => signFile(file),
      } } : {}),
    },
    nsis: {
      oneClick: true,
      perMachine: false,
      deleteAppDataOnUninstall: false,
      createStartMenuShortcut: true,
      createDesktopShortcut: false,
      runAfterFinish: false,
      packElevateHelper: false,
      differentialPackage: false,
    },
  },
});
