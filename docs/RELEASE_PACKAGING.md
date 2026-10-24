# Desktop Packaging and Release Evidence

macOS is the primary desktop platform. Windows and Linux builds are experimental;
build-matrix coverage is not evidence of feature or packaged-runtime parity.

The packaging helper accepts these variant arguments:

- **full** -> `Crystal Ball`
- **tech** -> `Tech Monitor`
- **finance** -> `Finance Monitor`

**Draft #1811 integration dependency:** at source baseline `78e34040`, the helper
sets `VITE_VARIANT` but invokes Tauri without a variant-specific config. Only
`src-tauri/tauri.conf.json` is present, with product name `Crystal Ball` and
identifier `com.bradleybond.crystalball`. The native identity repair is delivered
separately in [Draft #1811](https://github.com/bradleybond512/crystal-ball/pull/1811)
at source commit `7392ef1696e8110701b80a9a64440cac582aaa43`.

Until that source is integrated, selecting a tech/finance frontend does not establish
a distributable native identity. Do not treat the non-full examples as verified
release procedures. The variant identity, updater and profile safeguards below
describe that separate repair and apply only after integration. This documentation
change does not implement it, and source checks do not establish packaged runtime
acceptance.

The helper also accepts `--os linux` and targets AppImage. Windows targets NSIS/MSI.
These supported arguments do not change their experimental product status.

## Prerequisites

- Node.js + npm
- Rust toolchain
- OS-native Tauri build prerequisites:
  - macOS: Xcode command-line tools
  - Windows: Visual Studio Build Tools + NSIS + WiX

Install dependencies (this also installs the pinned Tauri CLI used by desktop scripts):

```bash
npm ci
```

All desktop scripts call the local `tauri` binary from `node_modules/.bin`; no runtime `npx` package download is required after `npm ci`.
If the local CLI is missing, `scripts/desktop-package.mjs` now fails fast with an explicit `npm ci` remediation message.

## Network preflight and remediation

Before running desktop packaging in CI or managed networks, verify connectivity and proxy config:

```bash
npm ping
curl -I https://index.crates.io/
env | grep -E '^(HTTP_PROXY|HTTPS_PROXY|NO_PROXY)='
```

If these fail, use one of the supported remediations:

- Internal npm mirror/proxy.
- Internal Cargo sparse index/registry mirror.
- Pre-vendored Rust crates (`src-tauri/vendor/`) + Cargo offline mode.
- CI artifact/caching strategy that restores required package inputs before build.

See `docs/TAURI_VALIDATION_REPORT.md` for failure classification labels and troubleshooting flow.

## Packaging commands

`npm run desktop:build:full` runs texture-input download, full macOS packaging and
`local-install.mjs`. Outside CI that last step installs and relaunches
`~/Applications/Crystal Ball.app`; CI skips the install. This is an operational
install command, not a build-only check.

Use the separate app-only packaging path when an install is not intended:

```bash
npm run desktop:build:app:full
```

It still builds/signs an app and may download build inputs; it does not install,
relaunch or produce a DMG. Passing `--app-only` through `desktop:build:full` does
not remove that wrapper's later install step.

To view script usage/help:

```bash
npm run desktop:package -- --help
```

### macOS (`.app` + `.dmg`)

```bash
npm run desktop:package:macos:full
npm run desktop:package:macos:tech
# or generic runner
npm run desktop:package -- --os macos --variant full
```

### Windows (`.exe` + `.msi`)

```bash
npm run desktop:package:windows:full
npm run desktop:package:windows:tech
# or generic runner
npm run desktop:package -- --os windows --variant tech
```

The helper's targets are:

- macOS local default: build `app`, sign locally, then create a DMG; `--app-only` stops before DMG creation
- macOS `--sign`: Tauri builds `app,dmg`, followed by signature checks
- Windows: `nsis,msi`
- Linux: `appimage`

## Rust dependency modes (online vs restricted network)

From `src-tauri/`, the project supports two packaging paths:

### 1) Standard online build (default)

Use normal Cargo behavior (crates.io):

```bash
cd src-tauri
cargo generate-lockfile
cargo tauri build --config tauri.conf.json
```

### 2) Restricted-network build (pre-vendored or internal mirror)

An optional vendored source is defined in `src-tauri/.cargo/config.toml`. To use it, first prepare vendored crates on a machine that has registry access:

```bash
# from repository root
cargo vendor --manifest-path src-tauri/Cargo.toml src-tauri/vendor
```

Then enable offline mode using either method:

- One-off CLI override (no file changes):

```bash
cd src-tauri
cargo generate-lockfile --offline --config 'source.crates-io.replace-with="vendored-sources"'
cargo tauri build --offline --config 'source.crates-io.replace-with="vendored-sources"' --config tauri.conf.json
```

- Local override file (recommended for CI/repeatable offline jobs):

```bash
cp src-tauri/.cargo/config.local.toml.example src-tauri/.cargo/config.local.toml
cd src-tauri
cargo generate-lockfile --offline
cargo tauri build --offline --config tauri.conf.json
```

For CI or internal mirrors, publish `src-tauri/vendor/` as an artifact and restore it before the restricted-network build. If your organization uses an internal crates mirror instead of vendoring, point `source.crates-io.replace-with` to that mirror in CI-specific Cargo config and run the same build commands.

## Optional signing/notarization hooks

Signing, notarization and artifact integrity are separate evidence:

- Default local macOS packaging attempts the stable self-signed `Crystal Ball Dev`
  identity (or `CRYSTALBALL_SIGN_IDENTITY`). Interactive builds can fall back to
  ad-hoc signing. `--require-stable-identity` or the corresponding main-sync setting
  refuses that fallback. Neither self-signed nor ad-hoc means Developer ID or Apple
  notarization. See [local signing identity](guides/crystal-ball-dev-signing-identity.md).
- Explicit `--sign` requires configured signing variables and uses the developer
  signing path. Notarization needs its own credentials and successful service
  result; signing success alone does not establish it.
- The tag-driven `.github/workflows/build-desktop.yml` permits ad-hoc macOS builds
  when Apple certificate secrets are absent and skips notarization credentials
  when they are unavailable. A green release workflow is therefore not a blanket
  claim that every artifact is Developer-ID signed or notarized.

### macOS Apple Developer signing + notarization

Set before packaging (Developer ID signature):

```bash
export TAURI_BUNDLE_MACOS_SIGNING_IDENTITY="Developer ID Application: Your Company (TEAMID)"
export TAURI_BUNDLE_MACOS_PROVIDER_SHORT_NAME="TEAMID"
# optional alternate key accepted by Tauri tooling:
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Company (TEAMID)"
```

For notarization, choose one auth method:

```bash
# Apple ID + app-specific password
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"

# OR App Store Connect API key
export APPLE_API_KEY="ABC123DEFG"
export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
export APPLE_API_KEY_PATH="$HOME/.keys/AuthKey_ABC123DEFG.p8"
```

Use the explicit developer-signing alias when that is the intended path:

```bash
npm run desktop:package:macos:full:sign
```

### Windows Authenticode signing

Set before packaging (PowerShell):

```powershell
$env:TAURI_BUNDLE_WINDOWS_CERTIFICATE_THUMBPRINT="<CERT_THUMBPRINT>"
$env:TAURI_BUNDLE_WINDOWS_TIMESTAMP_URL="https://timestamp.digicert.com"
# optional: if using cert file + password instead of cert store
$env:TAURI_BUNDLE_WINDOWS_CERTIFICATE="C:\path\to\codesign.pfx"
$env:TAURI_BUNDLE_WINDOWS_CERTIFICATE_PASSWORD="<PFX_PASSWORD>"
```

Use the explicit signing alias when credentials and this experimental target are intended:

```powershell
npm run desktop:package:windows:full:sign
```

## Variant-aware outputs after Draft #1811 integration

The following describes source commit `7392ef16`, conditional on integrating
Draft #1811. `VITE_VARIANT` selects the frontend; the shared allowlist in
`scripts/release-metadata.mjs` selects the native config, passed explicitly with
`--config` by local packaging and release CI.

| Variant | Native config | macOS app | Bundle identifier |
| --- | --- | --- | --- |
| full | `src-tauri/tauri.conf.json` | `Crystal Ball.app` | `com.bradleybond.crystalball` |
| tech | `src-tauri/tauri.tech.conf.json` | `Tech Monitor.app` | `com.bradleybond.crystalball.tech` |
| finance | `src-tauri/tauri.finance.conf.json` | `Finance Monitor.app` | `com.bradleybond.crystalball.finance` |

Tech and finance override only product name and identifier, inheriting the base
version, permissions and signing policy. All variants retain the `crystalball`
executable name. Windows/Linux installer coexistence requires separate packaged
validation; distinct display names alone do not establish it. Variant-specific
icons require dedicated `bundle.icon` overrides and assets.

### Identity verification and update channels

After integration, `scripts/check-desktop-identity.mjs` checks the effective config
before the build. Its app checks measure `CFBundleName`, `CFBundleIdentifier` and
`CFBundleShortVersionString`, reject mixed or stale output, and verify selected DMG
payloads through read-only mounts. Local app identity verification precedes manual
signing; CI checks the exact architecture output before signature verification,
collection and upload. Tauri's internal signing still occurs during its build.
These checks do not change signing identities, credentials or signature requirements.

Use a fresh output directory when changing variants. A leftover full app or another
variant is an error, even when the requested app also exists. Renaming a full app or
DMG is insufficient. The release manifest binds tag suffix, variant, filename,
measured native identity and artifact checksum; tech/finance releases must not
contain the full app under `Crystal Ball.app` or `CrystalBall.app`.

The repaired native updater serves the full app only. Tech/finance staging, manual
apply and boot-time apply stop before network or staged-data access. A manual check
explains that automatic updates are unavailable for that variant. No variant update
channel is introduced. Full updates and the full-only installer/main-sync target
remain unchanged.

### Profiles, shared storage and packaged acceptance

Tech and finance introduce new native identifiers. Treat WebView preferences,
saved places, alerts and IndexedDB as fresh profiles until packaged verification
establishes platform behavior. No existing profile is copied, migrated, merged or
deleted by this repair. Full retains its existing identifier and profile.

Credentials continue to use the shared `crystal-ball` Keychain service; a new native
identity may request OS permission. Distinct identifiers do not establish complete
data isolation: fixed watchdog/export/monitor paths and the full-default MCP lookup
also remain shared. This repair performs no credential or user-data migration.

After integration, `npm run test:desktop-identity` provides focused source/fixture
validation, including a dependency-free native policy fixture. It does not launch
the app or inspect installed profiles. Actual packaged app/DMG, permission-prompt,
profile behavior and Windows/Linux coexistence checks remain separate acceptance
evidence. These source checks do not establish installed or offline behavior.

## Output locations

Artifacts are produced under:

```text
src-tauri/target/release/bundle/
```

Common subfolders:

- `macos/` → macOS `.app`
- `dmg/` → macOS `.dmg`
- `nsis/` → Windows `.exe` installer
- `msi/` → Windows `.msi` installer

Explicit cross targets add their triple before `release`, for example
`src-tauri/target/aarch64-apple-darwin/release/bundle/`. After Draft #1811 integration,
CI verifies that exact architecture output rather than selecting the first app
found under `target`.

## Release checklist (clean machine)

1. Build required OS + variant package(s).
2. Move artifacts to a clean machine (or fresh VM).
3. Install/launch:

   - macOS: mount `.dmg`, drag app to Applications, launch.
   - Windows: run `.exe` or `.msi`, launch from Start menu.

4. Validate startup:

   - App window opens without crash.
   - Map view renders.
   - Initial data loading path does not fatal-error.

5. Validate variant identity:

   - Window title and product name match expected variant.

6. Record signature and notarization evidence separately:

   - Verify code-signing metadata in OS dialogs/properties.
   - For a notarized distribution, record the notarization result and independent
     Gatekeeper/staple verification for that artifact. Do not infer these from
     local signing, an app identifier or the installer succeeding.

## Checksums, provenance and local installation

The release workflow generates `release-manifest.json` with the source commit and
SHA-256 checksums of uploaded artifact files, then creates build-provenance
attestations for those assets and the manifest before publishing. Verify the actual
download's checksum against its manifest entry and its repository provenance, for
example with `gh attestation verify <artifact> --repo bradleybond512/crystal-ball`.
A checksum establishes equality to the listed file; it is not Apple notarization
or a substitute for validating the manifest's origin.

`scripts/install-built-app.mjs` verifies the app code signature and expected bundle
identifier and can compare its own directory-tree hash before installation. That
directory hash includes relative paths and file contents. It is not the SHA-256
of a DMG, ZIP or other release artifact file; do not pass a DMG checksum as an app
directory checksum. The installer does not perform a notarization/Gatekeeper check.
Treat install/relaunch and signing-identity changes as separate intended operations,
not documentation-validation steps.
