# UX-017 mutation proofs

Date: 2026-08-31

## Clean baseline

Proofs 1-6 and 8-9 ran in a detached worktree at implementation commit
`63bd412c` after `npm ci`. Proof 7 was superseded and rerun at repair commit
`697ff1ef`. `git status --short` was empty before every mutation and after
every restoration.

Command:

```bash
/opt/homebrew/opt/node@22/bin/node --test tests/main-sync-agent.test.mjs
```

Baseline checksums and TAP footer:

```text
f8fc7cb889c0e5d637170b9897619d3fa05cd10605c8c1ad5e3f0e51a7e3a761  scripts/sync-main-to-mac.mjs
7c8a670104c2b81a89fe763c270e85d06b59b6c1eb8c8e8e261e1b42bac2860d  scripts/setup-main-sync-agent.mjs
ae60505e7f5508f39b86521ea2fe82bab9fd25f5ff786cf925fe93dc9139788d  tests/main-sync-agent.test.mjs
1..18
# tests 18
# suites 0
# pass 18
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## Proof 1: unsupported Node majors are rejected

Confirmed-applied diff:

```diff
@@ -29,9 +29,7 @@ export const NPM_VERIFICATION_COMMANDS = [
 export function assertSupportedMainSyncNode(version = process.versions.node) {
   const major = Number.parseInt(String(version).split('.')[0], 10);
-  if (major !== 22) {
- throw new Error(`Node 22 is required for main sync; running Node ${version}`);
-  }
+  return major;
 }
```

Raw checksum and TAP failure:

```text
0b2b78f5590e7188ae46a43f855bd25808a31c4646209827f227101a8c2c2a99  scripts/sync-main-to-mac.mjs
not ok 7 - main sync accepts only the supported Node 22 major
  error: 'Missing expected exception.'
  code: 'ERR_ASSERTION'
  operator: 'throws'
# pass 17
# fail 1
```

## Proof 2: every npm stage uses the pinned absolute path

Confirmed-applied diff:

```diff
@@ -409,7 +409,7 @@ async function isInstalledCommitHealthy(state, installPath) {
 export function runVerificationAndBuild(repoDir, toolchain, run = runLoggedCommand) {
   for (const args of NPM_VERIFICATION_COMMANDS) {
- run(toolchain.npmPath, args, { cwd: repoDir, env: toolchain.env });
+ run('npm', args, { cwd: repoDir, env: toolchain.env });
   }
 }
```

Raw checksum and TAP failures:

```text
47e34f146375936c4191e2f1188793c987d370d394f7d89f85a188dd63e54b31  scripts/sync-main-to-mac.mjs
not ok 12 - all main sync verification commands use the pinned npm path and environment
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    + 'npm'
    - '/opt/homebrew/Cellar/node@22/22.23.1/bin/npm'
  code: 'ERR_ASSERTION'
  operator: 'strictEqual'
not ok 14 - all main sync npm verification and build commands use the pinned toolchain
  error: 'every npm stage should execute through the pinned npm path and environment'
  code: 'ERR_ASSERTION'
  operator: 'match'
# pass 16
# fail 2
```

## Proof 3: the selected Node directory leads subprocess PATH

Confirmed-applied diff:

```diff
@@ -51,7 +51,7 @@ export function buildMainSyncToolchain(nodePath = process.execPath, env = proces
  env: {
  ...env,
- PATH: `${nodeDir}:${env.PATH}`,
+ PATH: env.PATH,
  },
```

Raw checksum and TAP failures:

```text
5b8b405e2c2f3d42800d3005adcb6286b9e5d23fff0c5fb6897406daa3beaf4e  scripts/sync-main-to-mac.mjs
not ok 8 - main sync pins npm and subprocess PATH to the selected Node toolchain
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    + '/Users/example/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
    - '/opt/homebrew/Cellar/node@22/22.23.1/bin:/Users/example/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  code: 'ERR_ASSERTION'
  operator: 'strictEqual'
not ok 12 - all main sync verification commands use the pinned npm path and environment
  error: |-
    The input did not match the expected Node-first PATH regular expression.
  code: 'ERR_ASSERTION'
  operator: 'match'
# pass 16
# fail 2
```

## Proof 4: Cargo and the inherited PATH are retained

Confirmed-applied diff:

```diff
@@ -51,7 +51,7 @@ export function buildMainSyncToolchain(nodePath = process.execPath, env = proces
  env: {
  ...env,
- PATH: `${nodeDir}:${env.PATH}`,
+ PATH: nodeDir,
  },
```

Raw checksum and TAP failures:

```text
603691f9418e56b17f7bd190b98439100214a6599dad30f53515b2b4d16fb7a5  scripts/sync-main-to-mac.mjs
not ok 8 - main sync pins npm and subprocess PATH to the selected Node toolchain
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    + '/opt/homebrew/Cellar/node@22/22.23.1/bin'
    - '/opt/homebrew/Cellar/node@22/22.23.1/bin:/Users/example/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  code: 'ERR_ASSERTION'
  operator: 'strictEqual'
not ok 12 - all main sync verification commands use the pinned npm path and environment
  error: |-
    The input did not match the expected Node-first PATH regular expression.
  actual: '/opt/homebrew/Cellar/node@22/22.23.1/bin'
  code: 'ERR_ASSERTION'
  operator: 'match'
# pass 16
# fail 2
```

## Proof 5: a missing sibling npm fails closed

Confirmed-applied diff:

```diff
@@ -59,11 +59,6 @@ export function buildMainSyncToolchain(nodePath = process.execPath, env = proces
 export async function validatePinnedNodeToolchain(nodePath = process.execPath, env = process.env) {
   assertSupportedMainSyncNode();
   const toolchain = buildMainSyncToolchain(nodePath, env);
-  try {
- await access(toolchain.npmPath, fsConstants.X_OK);
-  } catch {
- throw new Error(`Selected Node toolchain has no executable npm sibling at ${toolchain.npmPath}`);
-  }
   return toolchain;
 }
```

Raw checksum and TAP failures:

```text
7d35a0dae4cb7f15be7584356bff24740a10f27677b5796d398f2242fb9a2d1f  scripts/sync-main-to-mac.mjs
not ok 10 - main sync rejects a selected Node toolchain without an executable sibling npm
  error: 'Missing expected rejection.'
  code: 'ERR_ASSERTION'
  operator: 'rejects'
not ok 11 - main sync CLI validates the pinned toolchain before creating sync state
  error: |-
    The input did not match the regular expression /no executable npm sibling/.
  code: 'ERR_ASSERTION'
  operator: 'match'
# pass 16
# fail 2
```

## Proof 6: setup validates Node before replacing the plist

Confirmed-applied diff:

```diff
@@ -144,7 +144,6 @@ function reloadLaunchAgent(launchAgentPath, label) {
 async function main() {
   const options = parseArgs(process.argv.slice(2));
-  assertSupportedMainSyncNode();
   await installLaunchAgent(options);
```

Raw checksum and TAP failure:

```text
d27768e7fda2cc6ea01b390873bac5a10fa83b1d99cf0c44116d073b94e5da85  scripts/setup-main-sync-agent.mjs
not ok 13 - main sync setup validates Node before replacing the LaunchAgent plist
  error: 'setup should validate its Node runtime in main'
  code: 'ERR_ASSERTION'
  operator: '=='
# pass 17
# fail 1
```

## Proof 7: CLI validation records failure before repository mutation

Repair baseline checksums at `697ff1ef`:

```text
69b571219799e2a7aa9ff7a038815cd17093773c75b49bce231629d99bccc696  scripts/sync-main-to-mac.mjs
58e28bc4227d9ee746033aa64188768cce91d22393c15d36289421481294f856  tests/main-sync-agent.test.mjs
```

Confirmed-applied diff:

```diff
@@ -432,6 +432,7 @@ async function installBuiltApp(repoDir, installPath) {
 async function main() {
   const options = parseArgs(process.argv.slice(2));
+  const toolchain = await validatePinnedNodeToolchain();
   const startedAt = new Date().toISOString();
@@ -442,7 +443,6 @@ async function main() {
   });

   try {
- const toolchain = await validatePinnedNodeToolchain();
  await mkdir(options.logDir, { recursive: true });
```

Raw checksum and TAP failure:

```text
f8fc7cb889c0e5d637170b9897619d3fa05cd10605c8c1ad5e3f0e51a7e3a761  scripts/sync-main-to-mac.mjs
not ok 11 - main sync CLI records failure before touching the repository when the pinned toolchain is invalid
  error: |-
    invalid toolchains must replace stale success with a failed status
    + actual - expected
    + 'installed'
    - 'failed'
  code: 'ERR_ASSERTION'
  expected: 'failed'
  actual: 'installed'
  operator: 'strictEqual'
# pass 17
# fail 1
```

## Proof 8: the selected Node path must be absolute

Confirmed-applied diff:

```diff
@@ -40,9 +40,6 @@ export function buildLaunchAgentEnvironmentPath(homeDir = os.homedir()) {
 }

 export function buildMainSyncToolchain(nodePath = process.execPath, env = process.env) {
-  if (typeof nodePath !== 'string' || !path.isAbsolute(nodePath)) {
- throw new Error('Main sync requires an absolute Node executable path');
-  }
   if (!env || typeof env.PATH !== 'string' || env.PATH.length === 0) {
  throw new Error('Main sync requires a non-empty PATH for subprocesses');
   }
```

Raw checksum and TAP failure:

```text
4a3056dc55b468057050920481b4ae090f90f9321e2e7503d18932f50d3d5e5f  scripts/sync-main-to-mac.mjs
not ok 9 - main sync rejects ambiguous toolchain paths and empty subprocess PATH values
  error: 'Missing expected exception.'
  code: 'ERR_ASSERTION'
  operator: 'throws'
# pass 17
# fail 1
```

## Proof 9: subprocess PATH must be non-empty

Confirmed-applied diff:

```diff
@@ -43,9 +43,6 @@ export function buildMainSyncToolchain(nodePath = process.execPath, env = process.env) {
  if (typeof nodePath !== 'string' || !path.isAbsolute(nodePath)) {
  throw new Error('Main sync requires an absolute Node executable path');
   }
-  if (!env || typeof env.PATH !== 'string' || env.PATH.length === 0) {
- throw new Error('Main sync requires a non-empty PATH for subprocesses');
-  }
   const nodeDir = path.dirname(nodePath);
```

Raw checksum and TAP failure:

```text
d6942ebb923252cae8cd4fb14bc658031527a9bd2a7f3617849756ff05390d4d  scripts/sync-main-to-mac.mjs
not ok 9 - main sync rejects ambiguous toolchain paths and empty subprocess PATH values
  error: 'Missing expected exception.'
  code: 'ERR_ASSERTION'
  operator: 'throws'
# pass 17
# fail 1
```

## Exact restoration and final green

After reversing each mutation with `apply_patch`, the historical proofs matched
their original baseline and the repair proof exactly matched `697ff1ef`.
`git status --short` was empty before and after the final repair run.

```text
69b571219799e2a7aa9ff7a038815cd17093773c75b49bce231629d99bccc696  scripts/sync-main-to-mac.mjs
7c8a670104c2b81a89fe763c270e85d06b59b6c1eb8c8e8e261e1b42bac2860d  scripts/setup-main-sync-agent.mjs
58e28bc4227d9ee746033aa64188768cce91d22393c15d36289421481294f856  tests/main-sync-agent.test.mjs
1..18
# tests 18
# suites 0
# pass 18
# fail 0
# cancelled 0
# skipped 0
# todo 0
69b571219799e2a7aa9ff7a038815cd17093773c75b49bce231629d99bccc696  scripts/sync-main-to-mac.mjs
7c8a670104c2b81a89fe763c270e85d06b59b6c1eb8c8e8e261e1b42bac2860d  scripts/setup-main-sync-agent.mjs
58e28bc4227d9ee746033aa64188768cce91d22393c15d36289421481294f856  tests/main-sync-agent.test.mjs
```
