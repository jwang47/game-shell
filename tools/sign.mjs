import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Argument arrays keep filenames out of PowerShell source text.
export function signFile(file) {
  const env = { ...process.env };
  // PowerShell 7's module path cannot be used by Windows PowerShell 5.1.
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'psmodulepath') delete env[key];
  }
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
    fileURLToPath(new URL('./sign.ps1', import.meta.url)), '-FilePath', file],
  { stdio: 'inherit', windowsHide: true, env });
}
