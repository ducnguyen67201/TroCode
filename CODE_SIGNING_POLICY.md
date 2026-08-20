# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/).

This policy applies to Windows release artifacts built from the public
[Tro repository](https://github.com/ducnguyen67201/TroCode). The certificate
publisher is SignPath Foundation; the product represented by the signed files
is Tro.

## Team roles

- **Authors, committers, and reviewers:** [Duc Nguyen](https://github.com/ducnguyen67201)
  and any repository collaborator explicitly granted write access. Changes from
  contributors without write access must be reviewed before merge.
- **Approver:** [Duc Nguyen](https://github.com/ducnguyen67201). A release
  signing request requires manual approval after its source revision, version,
  and generated artifacts have been reviewed.

All people with repository or SignPath access must enable multi-factor
authentication. Signing tokens are stored only as encrypted GitHub Actions
secrets and are never committed to this repository or included in application
artifacts.

## Build and signing controls

Windows release artifacts are produced by the checked-in GitHub Actions
workflow on GitHub-hosted Windows runners. Production signing is allowed only
from the `main` branch. The workflow:

1. installs the locked npm dependency graph and runs lint, type checking, tests,
   and the production dependency audit;
2. packages the application and submits the GitHub-hosted workflow artifact to
   SignPath so the Tro executable is signed;
3. creates the Squirrel.Windows installer from that signed package;
4. constrains the product name, version, company, and original-filename metadata
   before submitting the installer for signing;
5. verifies both Authenticode signatures and the signed executable carried by
   the update package;
6. produces SHA-256 checksums and publishes an immutable versioned GitHub
   Release only after all checks succeed.

SignPath artifact configurations restrict signing to the expected Tro
executable and installer names and metadata. Third-party executables and native
libraries bundled with Electron or CUA are not signed as Tro binaries.

## Release and incident policy

Release tags and assets are never overwritten. A compromised credential,
unexpected signed artifact, unverifiable build origin, or violation report
pauses signing and publishing while maintainers investigate. If required, the
maintainer will ask SignPath Foundation to revoke affected signatures and will
publish a security notice describing affected versions.

Reports can be sent to
[danielbaker06072001@gmail.com](mailto:danielbaker06072001@gmail.com). See the
[privacy policy](PRIVACY.md) and [security model](docs/security.md) for the
application's data handling and trust boundaries.
