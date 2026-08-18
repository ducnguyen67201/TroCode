# Microsoft Store release

TroCode's Microsoft Store product is `9PHZWW2MCPG1`.

## Package identity

The MSIX maker is configured with the identity reserved in Partner Center:

- Package name: `FeatherlaneAI.TroCode`
- Publisher: `CN=55ECF4A8-A613-42A0-9B49-9E83D77D32BE`
- Publisher display name: `Featherlane AI`
- Executable: `app\TroCode.exe`

The generated MSIX is intentionally unsigned. Microsoft signs it during Store
certification. Do not publish that unsigned MSIX as a direct website download.

## Workflow

Run the `Microsoft Store MSIX` workflow from GitHub Actions.

- Both inputs off: build, validate, and retain an MSIX artifact only.
- `upload_to_partner_center` on: upload the package into the existing Partner
  Center draft without submitting it.
- Both inputs on: upload and submit the draft for certification.

The publish job uses the protected `microsoft-store` GitHub environment. Store
submission should require an environment reviewer until the release process is
proven reliable.

## One-time Partner Center setup

Microsoft Store automation requires a Microsoft Entra application assigned the
Manager role in Partner Center. Configure these environment secrets:

- `AZURE_AD_APPLICATION_CLIENT_ID`
- `AZURE_AD_APPLICATION_SECRET`
- `AZURE_AD_TENANT_ID`
- `SELLER_ID`

The first Store submission must be completed in Partner Center, including the
age rating, properties, listing, and certification questions. Microsoft only
supports unattended GitHub Actions updates after the product has a live Store
submission.

## Updates

Store-installed builds use Windows package updates and do not contact TroCode's
GitHub/Squirrel update feed. The direct-download Squirrel installer continues to
use the GitHub update feed independently.
