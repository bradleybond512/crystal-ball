# UX-017 main-sync evidence

Captured 2026-08-30 from one isolated canonical-main reinstall with the
LaunchAgent stopped. The prior state/status files were moved to
`/tmp/ux017-sync-evidence.aXPIzF` before the run and remain recoverable.

## Installation result

Command:

```text
$ /opt/homebrew/Cellar/node@22/22.23.1/bin/node scripts/sync-main-to-mac.mjs
```

Concluding output:

```text
[desktop-package] Signing macOS app bundle with stable identity "Crystal Ball Dev" (hardened runtime) — keychain/location grants persist across rebuilds
src-tauri/target/release/bundle/macos/Crystal Ball.app: replacing existing signature
[install-built-app] Installed /Users/bradleybond/Applications/Crystal Ball.app
[sync-main-to-mac] Installed ace938183462b50ef9ce871ab931e297a3e49942 to /Users/bradleybond/Applications/Crystal Ball.app
```

The same run exposed the unresolved toolchain defect before installation:

```text
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'crystal-ball@2.25.147',
npm warn EBADENGINE   required: { node: '>=22.0.0 <23.0.0' },
npm warn EBADENGINE   current: { node: 'v26.3.0', npm: '11.16.0' }
npm warn EBADENGINE }
```

## Runtime selection

```text
$ /opt/homebrew/Cellar/node@22/22.23.1/bin/node --version
v22.23.1
$ env PATH=<LaunchAgent PATH> node --version
v26.3.0
$ env PATH=<LaunchAgent PATH> npm --version
11.16.0
```

The LaunchAgent plist recorded:

```text
ProgramArguments[0] = /opt/homebrew/Cellar/node@22/22.23.1/bin/node
ProgramArguments[1] = /Users/bradleybond/Developer/crystalball/.worktrees/codex-main-sync-cargo-path/scripts/sync-main-to-mac.mjs
PATH = /Users/bradleybond/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
StartInterval = 300
```

This proves the coordinator uses Node 22 while bare npm/package-script child
processes resolve Node 26 from the plist path.

## Installed phase and state

Immediately after the isolated run:

```json
{
  "phase": "installed",
  "installedAt": "2026-08-31T04:57:08.085Z",
  "targetSha": "ace938183462b50ef9ce871ab931e297a3e49942",
  "installPath": "/Users/bradleybond/Applications/Crystal Ball.app",
  "appSha256": "aa2597de521641e4d15813f018779013cb7062ecfa72676dc4fd83b25c0886a9",
  "verificationSource": "pull_request",
  "verifiedPrNumber": 1689
}
```

`state.json` recorded the same installed time, SHA, path, app hash, PR source,
and these required checks:

```text
typecheck
secret-scan
actionlint
integrity-checks
release-doctor
cross-agent-review
targeted-tests
```

## Script identity and signature

The persistent repair worktree, canonical `origin/main`, and dedicated sync
clone returned the same SHA-256 for `scripts/sync-main-to-mac.mjs`:

```text
896929baa18b5a1d669c17a13d2f64757fcaf7369549209c03d4f4ee40d00546
```

Strict verification returned:

```text
$ codesign --verify --deep --strict --verbose=4 ~/Applications/Crystal Ball.app
/Users/bradleybond/Applications/Crystal Ball.app: valid on disk
/Users/bradleybond/Applications/Crystal Ball.app: satisfies its Designated Requirement
```

## Conclusion

The first fail-closed build exposed the mixed-runtime defect. The remediation
below closes it with a fresh controlled run against the then-current canonical
`main`.

## Remediation verification

Captured 2026-08-31 after reinstalling the LaunchAgent from the persistent
`codex/ux017-main-sync-verification` worktree with Node 22.

The candidate derived and executed this toolchain:

```json
{
  "nodePath": "/opt/homebrew/Cellar/node@22/22.23.1/bin/node",
  "npmPath": "/opt/homebrew/Cellar/node@22/22.23.1/bin/npm",
  "launchAgentPath": "/Users/bradleybond/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  "childPath": "/opt/homebrew/Cellar/node@22/22.23.1/bin:/Users/bradleybond/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  "nodeVersion": "v22.23.1",
  "npmVersion": "10.9.8",
  "cargoVersion": "cargo 1.93.1 (083ac5135 2025-12-15)"
}
```

The LaunchAgent retained the Cargo-first path, used the absolute Node 22
program, pointed at the persistent UX-017 worktree, and exited with status 0.
Only npm/package-script children received the Node-first path above.

The fresh canonical-main run recorded:

```json
{
  "phase": "installed",
  "installedAt": "2026-08-31T07:30:28.865Z",
  "targetSha": "702dc5b0521f49542d1c6cb73238841006b9a793",
  "installPath": "/Users/bradleybond/Applications/Crystal Ball.app",
  "appSha256": "b3330916dd567381a1b1a4bfa72ff90093f20d4bf851e1a3b96d3cbf7bf7f063",
  "verificationSource": "pull_request",
  "verifiedPrNumber": 1692
}
```

`state.json` recorded the same SHA, time, app hash, and all seven required
checks. The candidate-run stderr window beginning at byte 24,096,523 contained
zero `EBADENGINE` occurrences. The concluding stdout included:

```text
[install-built-app] Installed /Users/bradleybond/Applications/Crystal Ball.app
[sync-main-to-mac] Installed 702dc5b0521f49542d1c6cb73238841006b9a793 to /Users/bradleybond/Applications/Crystal Ball.app
```

Strict signature verification returned `valid on disk` and `satisfies its
Designated Requirement`. The installed and build-source executables both had
SHA-256:

```text
87a5470c546f3a31fbcc8afd09ab7a3514cfbb10a558e83920efd68ce441e116
```

UX-017 is complete: the coordinator, npm, nested Node commands, and installer
now share the supported Node 22 trust root while Cargo and every existing
fail-closed gate remain available.
