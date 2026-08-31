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

### LaunchAgent installation

Command and exit status:

```text
$ /opt/homebrew/opt/node@22/bin/node scripts/setup-main-sync-agent.mjs
{
  "label": "com.bradleybond.crystalball.main-sync",
  "launchAgentPath": "/Users/bradleybond/Library/LaunchAgents/com.bradleybond.crystalball.main-sync.plist",
  "syncRoot": "/Users/bradleybond/.crystalball-main-sync",
  "intervalSeconds": 300,
  "started": true
}
exit status: 0
```

### Derived toolchain

Command:

```bash
/opt/homebrew/opt/node@22/bin/node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {buildLaunchAgentEnvironmentPath,buildMainSyncToolchain} from './scripts/sync-main-to-mac.mjs'; const launchPath=buildLaunchAgentEnvironmentPath(); const toolchain=buildMainSyncToolchain(process.execPath,{PATH:launchPath}); const run=(c,a)=>spawnSync(c,a,{env:toolchain.env,encoding:'utf8'}).stdout.trim(); console.log(JSON.stringify({nodePath:toolchain.nodePath,npmPath:toolchain.npmPath,launchAgentPath:launchPath,childPath:toolchain.env.PATH,nodeVersion:run('node',['--version']),npmVersion:run(toolchain.npmPath,['--version']),cargoVersion:run('cargo',['--version'])},null,2));"
```

Raw output and exit status:

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

```text
exit status: 0
```

### Loaded LaunchAgent

Command:

```text
$ /bin/launchctl print gui/501/com.bradleybond.crystalball.main-sync | sed -n '1,45p'
```

Raw output excerpt and exit status:

```text
gui/501/com.bradleybond.crystalball.main-sync = {
  active count = 0
  path = /Users/bradleybond/Library/LaunchAgents/com.bradleybond.crystalball.main-sync.plist
  type = LaunchAgent
  state = not running

  program = /opt/homebrew/Cellar/node@22/22.23.1/bin/node
  arguments = {
    /opt/homebrew/Cellar/node@22/22.23.1/bin/node
    /Users/bradleybond/Developer/crystalball/.worktrees/codex-ux017-main-sync-verification/scripts/sync-main-to-mac.mjs
    --sync-root
    /Users/bradleybond/.crystalball-main-sync
  }

  working directory = /Users/bradleybond/Developer/crystalball/.worktrees/codex-ux017-main-sync-verification

  stdout path = /Users/bradleybond/.crystalball-main-sync/logs/main-sync.stdout.log
  stderr path = /Users/bradleybond/.crystalball-main-sync/logs/main-sync.stderr.log

  environment = {
    OSLogRateLimit => 64
    PATH => /Users/bradleybond/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
    XPC_SERVICE_NAME => com.bradleybond.crystalball.main-sync
  }

  runs = 2
  last exit code = 0
exit status: 0
```

The LaunchAgent retained the Cargo-first path, used the absolute Node 22
program, pointed at the persistent UX-017 worktree, and exited with status 0.
Only npm/package-script children received the Node-first path above.

### Fresh canonical-main installation

The fresh canonical-main run first recorded this installed status before the
next polling cycle changed the status phase to `idle`:

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

The exact state/status inspection command, raw output, and exit status were:

```text
$ sed -n '1,180p' /Users/bradleybond/.crystalball-main-sync/state.json; sed -n '1,160p' /Users/bradleybond/.crystalball-main-sync/status.json
{
  "installedAt": "2026-08-31T07:30:28.865Z",
  "installedSha": "702dc5b0521f49542d1c6cb73238841006b9a793",
  "installPath": "/Users/bradleybond/Applications/Crystal Ball.app",
  "appPath": "/Users/bradleybond/.crystalball-main-sync/repo/src-tauri/target/release/bundle/macos/Crystal Ball.app",
  "appSha256": "b3330916dd567381a1b1a4bfa72ff90093f20d4bf851e1a3b96d3cbf7bf7f063",
  "repoSlug": "bradleybond512/crystal-ball",
  "branch": "main",
  "requiredChecks": [
    "typecheck",
    "secret-scan",
    "actionlint",
    "integrity-checks",
    "release-doctor",
    "cross-agent-review",
    "targeted-tests"
  ],
  "verificationSource": "pull_request",
  "verifiedPrNumber": 1692
}
{
  "phase": "idle",
  "checkedAt": "2026-08-31T07:47:20.758Z",
  "targetSha": "702dc5b0521f49542d1c6cb73238841006b9a793",
  "installedSha": "702dc5b0521f49542d1c6cb73238841006b9a793",
  "requiredChecks": [
    "typecheck",
    "secret-scan",
    "actionlint",
    "integrity-checks",
    "release-doctor",
    "cross-agent-review",
    "targeted-tests"
  ],
  "verificationSource": "pull_request",
  "verifiedPrNumber": 1692
}
exit status: 0
```

The candidate-run stderr window beginning at byte 24,096,523 contained zero
`EBADENGINE` occurrences:

```text
$ if tail -c +24096523 /Users/bradleybond/.crystalball-main-sync/logs/main-sync.stderr.log | rg -q 'EBADENGINE'; then echo 'EBADENGINE present'; else echo 'EBADENGINE count: 0'; fi
EBADENGINE count: 0
exit status: 0
```

The exact stdout lookup and result were:

```text
$ rg -n 'Installed 702dc5b0521f49542d1c6cb73238841006b9a793|\[install-built-app\] Installed' /Users/bradleybond/.crystalball-main-sync/logs/main-sync.stdout.log | tail -n 2
653467:[install-built-app] Installed /Users/bradleybond/Applications/Crystal Ball.app
653468:[sync-main-to-mac] Installed 702dc5b0521f49542d1c6cb73238841006b9a793 to /Users/bradleybond/Applications/Crystal Ball.app
exit status: 0
```

### Installed artifact verification

Signature command, raw output, and exit status:

```text
$ codesign --verify --deep --strict --verbose=4 '/Users/bradleybond/Applications/Crystal Ball.app'
/Users/bradleybond/Applications/Crystal Ball.app: valid on disk
/Users/bradleybond/Applications/Crystal Ball.app: satisfies its Designated Requirement
exit status: 0
```

Installed/build-source identity command, raw output, and exit status:

```text
$ shasum -a 256 '/Users/bradleybond/Applications/Crystal Ball.app/Contents/MacOS/crystalball' '/Users/bradleybond/.crystalball-main-sync/repo/src-tauri/target/release/bundle/macos/Crystal Ball.app/Contents/MacOS/crystalball'
87a5470c546f3a31fbcc8afd09ab7a3514cfbb10a558e83920efd68ce441e116  /Users/bradleybond/Applications/Crystal Ball.app/Contents/MacOS/crystalball
87a5470c546f3a31fbcc8afd09ab7a3514cfbb10a558e83920efd68ce441e116  /Users/bradleybond/.crystalball-main-sync/repo/src-tauri/target/release/bundle/macos/Crystal Ball.app/Contents/MacOS/crystalball
exit status: 0
```

The controlled run verifies that the coordinator, npm, nested Node commands,
and installer share the supported Node 22 trust root while Cargo and every
existing fail-closed gate remain available. Final completion remains subject
to exact-tip validation and independent review.
