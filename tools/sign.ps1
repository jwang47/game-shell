param([Parameter(Mandatory)][string]$FilePath)
$ErrorActionPreference = 'Stop'
$file = (Resolve-Path -LiteralPath $FilePath).Path
foreach ($name in @('GAMESHELL_SIGNTOOL', 'GAMESHELL_SIGNING_DLIB')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (!$value -or !(Test-Path -LiteralPath $value -PathType Leaf)) {
        throw "Set $name to the corresponding Microsoft Artifact Signing client tool path. See docs/signing.md."
    }
}
& $env:GAMESHELL_SIGNTOOL sign /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $env:GAMESHELL_SIGNING_DLIB /dmdf (Join-Path $PSScriptRoot 'signing.json') $file
if ($LASTEXITCODE -ne 0) { throw "Artifact Signing failed: $LASTEXITCODE" }
& $env:GAMESHELL_SIGNTOOL verify /pa /all /v /tw $file
if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $LASTEXITCODE" }
$signature = Get-AuthenticodeSignature -LiteralPath $file
if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate -or
    $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ne 'Jiahua Wang') {
    throw 'Expected a valid timestamped signature from Jiahua Wang.'
}
