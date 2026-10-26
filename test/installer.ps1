# Install/reinstall/uninstall only on a disposable GitHub-hosted Windows runner.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Installer lifecycle tests require a disposable GitHub-hosted runner.'
}
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$installer = (Resolve-Path "dist-installer/GameShell-$version-Setup-x64.exe").Path
$testRoot = Join-Path $env:RUNNER_TEMP ("gameshell-install-" + [guid]::NewGuid())
$installDir = Join-Path $testRoot 'app'
$profile = Join-Path $env:APPDATA 'GameShell'
$marker = Join-Path $profile 'installer-test-marker.txt'
$uninstaller = Join-Path $installDir 'Uninstall GameShell.exe'
New-Item -ItemType Directory -Force $testRoot, $profile | Out-Null
Set-Content -LiteralPath $marker -Value 'preserve-user-data'
function Run-Installer {
    $process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Install failed: $($process.ExitCode)" }
    if (!(Test-Path -LiteralPath (Join-Path $installDir 'GameShell.exe'))) { throw 'Installed executable missing' }
    if (!(Test-Path -LiteralPath $uninstaller)) { throw 'Uninstaller missing' }
    if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne 'preserve-user-data') { throw 'Installer changed user data' }
}
try {
    Run-Installer
    $shortcut = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs/GameShell.lnk'
    if (!(Test-Path -LiteralPath $shortcut)) { throw 'Start Menu shortcut missing' }
    node test/packaged.mjs $installDir
    if ($LASTEXITCODE -ne 0) { throw 'Installed app smoke test failed' }
    # Reinstall exercises replacement of existing files and retention of data.
    Run-Installer
    $process = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$installDir") -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Uninstall failed: $($process.ExitCode)" }
    if (Test-Path -LiteralPath (Join-Path $installDir 'GameShell.exe')) { throw 'Uninstall left the application behind' }
    if (Test-Path -LiteralPath $shortcut) { throw 'Uninstall left the Start Menu shortcut behind' }
    if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne 'preserve-user-data') { throw 'Uninstall deleted user data' }
    Write-Output 'installer: pass (install, shortcut, app startup, reinstall, uninstall, retained user data)'
} finally {
    # Never recursively remove a path outside this run's temporary directory.
    $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
    $runnerRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
    if (!$resolvedRoot.StartsWith($runnerRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe cleanup path' }
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
}
