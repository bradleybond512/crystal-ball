# Clean-Runner CI Harness Mutation Evidence

Recorded: 2026-08-31
Branch: `codex/ci-clean-runner-harness`
Implementation commits: `fdf5ca51`, `ed1c7e68`

Each proof started with an empty `git status --short`. The mutation was applied
with `apply_patch`, inspected with `git diff`, run red, restored with
`apply_patch`, and checked against the original SHA-256 before the green rerun.

## Native clean-runner behavior

File mutated: `tests/ux010-native-gate.test.mjs`

Stable checksum before and after mutation:

```text
c5d38829c59722a1e2d9de1368d9bf23cc51c2d28a9ba38f0d1a3d733d729394
```

The generated repository `dist` directory was moved intact to an owned
temporary directory before the mutation and restored intact afterward. The
mutation removed only the child-process `TAURI_CONFIG` line. The complete
applied diff was:

```diff
diff --git a/tests/ux010-native-gate.test.mjs b/tests/ux010-native-gate.test.mjs
index 34290aa5..72649aa8 100644
--- a/tests/ux010-native-gate.test.mjs
+++ b/tests/ux010-native-gate.test.mjs
@@ -39,7 +39,6 @@ test('focused native gate executes the current-location Rust contract', () => {
       env: {
         ...process.env,
         CARGO_TERM_COLOR: 'never',
-        TAURI_CONFIG: JSON.stringify({ build: { frontendDist: tauriFrontendDist } }),
       },
       maxBuffer: 10 * 1024 * 1024,
       timeout: 300_000,
```

Command:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH RUSTFLAGS=-Awarnings FORCE_COLOR=0 node --test tests/ux010-native-gate.test.mjs
```

The Cargo compile-progress lines precede this verbatim failing TAP block:

```text
# Subtest: focused native gate executes the current-location Rust contract
not ok 1 - focused native gate executes the current-location Rust contract
  ---
  duration_ms: 39518.837417
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ci-clean-runner-harness/tests/ux010-native-gate.test.mjs:11:1'
  failureType: 'testCodeFailure'
  error: |-
    error: proc macro panicked
        --> src/main.rs:4911:9
         |
    4911 |  .build(tauri::generate_context!())
         |         ^^^^^^^^^^^^^^^^^^^^^^^^^^
         |
         = help: message: The `frontendDist` configuration is set to `"../dist"` but this path doesn't exist

    error: could not compile `crystalball` (bin "crystalball") due to 1 previous error
    warning: build failed, waiting for other jobs to finish...


    101 !== 0

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 0
  actual: 101
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///Users/bradleybond/Developer/crystalball/.worktrees/ci-clean-runner-harness/tests/ux010-native-gate.test.mjs:50:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 39605.552667
```

After restoration, the checksum matched and `git status --short` was empty.
The green rerun produced:

```text
# Subtest: focused native gate executes the current-location Rust contract
ok 1 - focused native gate executes the current-location Rust contract
  ---
  duration_ms: 4835.086416
  type: 'test'
  ...
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 4919.658667
```

Result: `1 pass / 0 fail` became `0 pass / 1 fail` under mutation and returned
to `1 pass / 0 fail` after restoration. The failing assertion was Cargo exit
`101 !== 0` caused by the missing configured frontend resource.

## Exact-zero browser behavior

File mutated: `e2e/home-shell-boot.spec.ts`

Stable checksum before and after mutation:

```text
99a5b241dca509232c905349bc02e85594170449e6039e81d322af9a09073bb2
```

The mutation replaced only the anchored exact-zero matcher with the prior broad
matcher. The complete applied diff was:

```diff
diff --git a/e2e/home-shell-boot.spec.ts b/e2e/home-shell-boot.spec.ts
index 98ad9952..50fc8e5c 100644
--- a/e2e/home-shell-boot.spec.ts
+++ b/e2e/home-shell-boot.spec.ts
@@ -91,7 +91,7 @@ test.describe('home shell default boot', () => {
       }
     }

-    const isExactZeroWorkingStatus = (text: string): boolean => /^working now\s*·\s*0 items\b/i.test(text);
+    const isExactZeroWorkingStatus = (text: string): boolean => /working now.*0 items/i.test(text);
     expect(isExactZeroWorkingStatus('Working now · 0 items in latest update')).toBe(true);
     expect(isExactZeroWorkingStatus('Working now · 10 items in latest update')).toBe(false);
     for (const source of await sources.all()) {
```

Command:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH VITE_VARIANT=full FORCE_COLOR=0 npx playwright test e2e/home-shell-boot.spec.ts --grep "browser harness only" --reporter=line
```

The live-provider console lines precede this verbatim failing Playwright block:

```text
  1) [chromium] › e2e/home-shell-boot.spec.ts:12:3 › home shell default boot › browser harness only: empty client storage keeps Welcome auth groups honest and Deck reports bounded

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: false
    Received: true

      94 |     const isExactZeroWorkingStatus = (text: string): boolean => /working now.*0 items/i.test(text);
      95 |     expect(isExactZeroWorkingStatus('Working now · 0 items in latest update')).toBe(true);
    > 96 |     expect(isExactZeroWorkingStatus('Working now · 10 items in latest update')).toBe(false);
         |                                                                                 ^
      97 |     for (const source of await sources.all()) {
      98 |       const { status, text } = await source.evaluate((node) => {
      99 |         const statusElement = node.querySelector<HTMLElement>('.hs-source-status');
        at /Users/bradleybond/Developer/crystalball/.worktrees/ci-clean-runner-harness/e2e/home-shell-boot.spec.ts:96:81

  1 failed
    [chromium] › e2e/home-shell-boot.spec.ts:12:3 › home shell default boot › browser harness only: empty client storage keeps Welcome auth groups honest and Deck reports bounded
```

After restoration, the checksum matched and `git status --short` was empty.
The green rerun ended with this unedited reporter line:

```text
1 passed (49.0s)
```

Result: `1 passed / 0 failed` became `0 passed / 1 failed` under mutation and
returned to `1 passed / 0 failed` after restoration. The failing assertion was
the deterministic `10 items` case returning `true` where `false` was required.
