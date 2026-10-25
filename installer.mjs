// Wrap the already tested Windows distribution; never publish from this script.
import { build, Platform, Arch } from 'electron-builder';
import fs from 'node:fs';
import path from 'node:path';

const prepackaged = path.resolve('dist/GameShell-win32-x64');
if (!fs.existsSync(path.join(prepackaged, 'GameShell.exe'))) throw new Error('Run npm run pack first');
await build({
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  prepackaged,
  publish: 'never',
  config: {
    appId: 'io.github.jwang47.gameshell',
    productName: 'GameShell',
    directories: { output: 'dist-installer' },
    artifactName: 'GameShell-${version}-Setup-${arch}.${ext}',
    win: { icon: 'assets/icon.ico', executableName: 'GameShell' },
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
