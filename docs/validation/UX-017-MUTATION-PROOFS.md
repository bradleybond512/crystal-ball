# UX-017 mutation proofs

Date: 2026-08-31

## Baseline

The intended implementation and test files started with these SHA-256 checksums:

```text
7c8a670104c2b81a89fe763c270e85d06b59b6c1eb8c8e8e261e1b42bac2860d  scripts/setup-main-sync-agent.mjs
befebc9aa0acd1108f27556bfe9c99ba298f9781318780a2af0317fb63e53372  scripts/sync-main-to-mac.mjs
f6fc5cf9ece6c0724d22bb6fdd1b034ca59ba3fcc65764ee5c226b98dbbe2821  tests/main-sync-agent.test.mjs
```

Baseline command:

```bash
/opt/homebrew/opt/node@22/bin/node --test tests/main-sync-agent.test.mjs
```

Result: `16 pass / 0 fail`.

## Proofs

Each mutation was temporary and sequential. After applying it, the named
`git diff` command showed the changed production line, and the focused command
above was run unchanged. The production file was restored before the next
mutation.

### 1. Unsupported Node majors are rejected

- Mutation: replaced the `major !== 22` rejection with `return major` in
  `assertSupportedMainSyncNode`.
- Mutated checksum:
  `09f47cabe418f8476d53653c036535a972a573e46da2f31d302ee3bcfbf2535d`.
- Diff confirmation:
  `git diff -- scripts/sync-main-to-mac.mjs | sed -n '1,115p'` showed the
  rejection removed and `return major` present.
- Result: `15 pass / 1 fail`.
- Failing subtest: `main sync accepts only the supported Node 22 major`.
- Failing assertion: `Missing expected exception.` (`ERR_ASSERTION`,
  `assert.throws`).

### 2. npm is invoked by its pinned absolute path

- Mutation: replaced `toolchain.npmPath` with bare `'npm'` in
  `runVerificationAndBuild`.
- Mutated checksum:
  `c04132376df04da0f92c9a6f9c3e220fd1cdb345789510660d13effc8dca66c4`.
- Diff confirmation:
  `git diff -- scripts/sync-main-to-mac.mjs | sed -n '80,145p'` showed
  `runLoggedCommand('npm', ...)`.
- Result: `15 pass / 1 fail`.
- Failing subtest:
  `all main sync npm verification and build commands use the pinned toolchain`.
- Failing assertion:
  `every npm stage should execute through the pinned npm path and environment`
  (`ERR_ASSERTION`, `assert.match`).

### 3. The selected Node directory leads subprocess PATH

- Mutation: replaced `` `${nodeDir}:${env.PATH}` `` with `env.PATH`.
- Mutated checksum:
  `f0c4247af65458b90a82290f571e06b0684214e887e8bb528d16b3a5a5ecd82c`.
- Diff confirmation:
  `git diff -- scripts/sync-main-to-mac.mjs | sed -n '40,78p'` showed
  `PATH: env.PATH`.
- Result: `15 pass / 1 fail`.
- Failing subtest:
  `main sync pins npm and subprocess PATH to the selected Node toolchain`.
- Failing assertion: strict equality expected the selected Node directory
  before the inherited PATH, but the actual value began with
  `/Users/example/.cargo/bin`.

### 4. Cargo and the inherited system PATH are preserved

- Mutation: replaced `` `${nodeDir}:${env.PATH}` `` with `nodeDir`.
- Mutated checksum:
  `d4b81a8ef1deabfe3083e6fd1c0920daa59f18ebd17e7dfc7d57ab01cd28f6ba`.
- Diff confirmation:
  `git diff -- scripts/sync-main-to-mac.mjs | sed -n '46,66p'` showed
  `PATH: nodeDir`.
- Result: `15 pass / 1 fail`.
- Failing subtest:
  `main sync pins npm and subprocess PATH to the selected Node toolchain`.
- Failing assertion: strict equality expected Node, Cargo, and system paths,
  but the actual value contained only
  `/opt/homebrew/Cellar/node@22/22.23.1/bin`.

### 5. A missing or non-executable sibling npm fails closed

- Mutation: removed the `access(toolchain.npmPath, fsConstants.X_OK)` check and
  its error translation.
- Mutated checksum:
  `b67f3ae549d664b490ee7eb04700963fa570af9ac903402d70bf976f052411bb`.
- Diff confirmation:
  `git diff -- scripts/sync-main-to-mac.mjs | sed -n '54,82p'` showed
  `validatePinnedNodeToolchain` returning without the executable check.
- Result: `15 pass / 1 fail`.
- Failing subtest:
  `main sync rejects a selected Node toolchain without an executable sibling npm`.
- Failing assertion: `Missing expected rejection.` (`ERR_ASSERTION`,
  `assert.rejects`).

### 6. Setup validates Node before replacing the LaunchAgent plist

- Mutation: removed `assertSupportedMainSyncNode()` from setup `main`.
- Mutated checksum:
  `d27768e7fda2cc6ea01b390873bac5a10fa83b1d99cf0c44116d073b94e5da85`.
- Diff confirmation:
  `git diff -- scripts/setup-main-sync-agent.mjs | sed -n '1,90p'` showed the
  setup guard absent.
- Result: `15 pass / 1 fail`.
- Failing subtest:
  `main sync setup validates Node before replacing the LaunchAgent plist`.
- Failing assertion: `setup should validate its Node runtime in main`
  (`ERR_ASSERTION`, `assert.ok`).

## Restoration and final green run

Restoration and verification command:

```bash
shasum -a 256 scripts/setup-main-sync-agent.mjs scripts/sync-main-to-mac.mjs tests/main-sync-agent.test.mjs
/opt/homebrew/opt/node@22/bin/node --test tests/main-sync-agent.test.mjs
shasum -a 256 scripts/setup-main-sync-agent.mjs scripts/sync-main-to-mac.mjs tests/main-sync-agent.test.mjs
git status --short
```

The pre-run and post-run checksums exactly matched the baseline values above.
The focused suite reported `16 pass / 0 fail`. Final status contained only the
intended implementation/test modifications and the pre-existing untracked
`node_modules` entry; this evidence file was added afterward.
