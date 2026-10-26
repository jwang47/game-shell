# Windows code signing

GameShell uses Microsoft Artifact Signing, account `gameshelljwang47`, profile
`public`, in West US 2. The certificate publisher is **Jiahua Wang**. The metadata
in `tools/signing.json` is public configuration, not a credential. Street address
and postal code are excluded from the certificate profile.

## Local signed build

Install Microsoft's tools once:

```powershell
winget install --exact --id Microsoft.Azure.ArtifactSigningClientTools
```

Install Azure CLI and sign in to the tenant that owns the signing account. Your
identity must have **Artifact Signing Certificate Profile Signer** on the profile.
The build uses the existing Azure CLI session; it does not store a private key or
client secret in the repository.

```powershell
az login --tenant 5d766074-c2a5-4cd4-bdb0-42f5d6eb2f90
$env:GAMESHELL_SIGNTOOL = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe'
$env:GAMESHELL_SIGNING_DLIB = "$env:LOCALAPPDATA\Microsoft\MicrosoftArtifactSigningClientTools\Azure.CodeSigning.Dlib.dll"
npm ci
npm run pack
npm run installer -- --signed
npm run test:packaged
```

Adjust the SDK version in `GAMESHELL_SIGNTOOL` if necessary. Use x64 SignTool and
x64 signing client tools. Azure CLI (`az`) must be on PATH in the build shell.
See [Microsoft's prerequisites and setup instructions](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations).

Signed mode signs `GameShell.exe` before packaging, then signs the NSIS uninstaller
and final setup executable. Every signing operation uses SHA-256 and Microsoft's
RFC 3161 timestamp server, and verifies trust, timestamp presence, and publisher.
A signing or verification failure stops the build. The portable ZIP must be made
from this signed distribution; running `npm run pack` again replaces it with an
unsigned build.

`npm run installer` without `--signed` remains available for CI and local testing.
Ordinary pull-request CI has no signing access. Signing does not publish a GitHub
release and does not guarantee that SmartScreen will immediately trust a new app.
The identity validation must be renewed before October 25, 2027.
