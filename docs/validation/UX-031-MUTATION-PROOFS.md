# UX-031 final-source mutation evidence

Source: `4da0d51417e51a9d5a585994fb7bae0b46736310`.

All 16 defined mutants were run separately and killed by behavior assertions. Each began with an empty git status; each applied diff was printed, inspected and saved before tests; each exact original file was restored, its shasum compared, and empty git status confirmed. Final tree is clean. No production, test or dependency edits remain.

Final baselines: unit 20 pass / 0 fail; full browser 5 pass / 0 fail; happy browser 5 pass / 0 fail. Browser targeted baseline 1 pass / 0 fail below refers to the selected case in its corresponding complete five-case baseline, not a separately invented baseline run.

Historical d19defcc0-baseline-unit files preserve the preliminary19/0 run and are not final-source evidence.

| Mutant | Baseline selected | Mutated | Restore |
|---|---|---|---|
| 01-watcher-persists | 20pass / 0fail | 16pass / 4fail | checksum matches; clean |
| 02-manual-session-choice | 20pass / 0fail | 18pass / 2fail | checksum matches; clean |
| 03-startup-session-latch | 20pass / 0fail | 19pass / 1fail | checksum matches; clean |
| 04-watcher-idempotency | 20pass / 0fail | 19pass / 1fail | checksum matches; clean |
| 05-variant-precedence | 20pass / 0fail | 17pass / 3fail | checksum matches; clean |
| 06-main-subscription | 1pass / 0fail | 0pass / 1fail | checksum matches; clean |
| 07-settings-subscription | 1pass / 0fail | 0pass / 1fail | checksum matches; clean |
| 08-main-variant-order | 1pass / 0fail | 0pass / 1fail | checksum matches; clean |
| 09-settings-variant-order | 1pass / 0fail | 0pass / 1fail | checksum matches; clean |
| 10-root-owner | 1pass / 0fail | 0pass / 1fail | checksum matches; clean |
| 11-toolbar-owner | 1pass / 0fail | 0pass / 1fail | checksum matches; clean |
| 12-map-header-owner | 1pass / 0fail | 0pass / 1fail | checksum matches; clean |
| 13-thumb-owner | 1pass / 0fail | 0pass / 1fail | checksum matches; clean |
| 14-thumb-hover-owner | 1pass / 0fail | 0pass / 1fail | checksum matches; clean |
| 15-listener-capability | 20pass / 0fail | 19pass / 1fail | checksum matches; clean |
| 16-stored-variant-precedence | 20pass / 0fail | 19pass / 1fail | checksum matches; clean |

Mutant05 removes the build-precedence guard; mutant16 removes the stored-variant precedence assignment. Scrollbar hover proof is CSSOM applicability, not native pointer rendering.

All commands use Node 22 by prepending `/opt/homebrew/opt/node@22/bin` to PATH. Browser variants ran sequentially on 4295 (full) / 4296 (happy), each with its own artifact directory.

## Exact final-source baselines

All three commands exited 0 from the clean mutation worktree at the source SHA above. Output excerpts below are copied from their logs.

### unit baseline

```bash
npm run test:system-theme
```

```text
# tests 20
# pass 20
# fail 0
```

### full baseline

```bash
env E2E_PORT=4295 VITE_VARIANT=full npx playwright test e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/baseline-full-artifacts
```

```text
  5 passed (51.4s)
```

### happy baseline

```bash
env E2E_PORT=4296 VITE_VARIANT=happy npx playwright test e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/baseline-happy-artifacts
```

```text
  5 passed (51.7s)
```

## 01-watcher-persists

File: `src/utils/theme-manager.ts`.

Restored SHA256: `2fad21df8d2bfb8337612581921c91b8d12c106b2780e045bbd97592ef076e0d`.

```bash
npm run test:system-theme
```

Observed assertion excerpt:

```text
not ok 1 - full follows repeated OS changes without persisting a choice
  ---
  duration_ms: 5.204459
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:1:2248'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    'dark' !== 'light'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'light'
  actual: 'dark'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:90:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/01-watcher-persists.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/01-watcher-persists.log`.

## 02-manual-session-choice

File: `src/utils/theme-manager.ts`.

Restored SHA256: `2fad21df8d2bfb8337612581921c91b8d12c106b2780e045bbd97592ef076e0d`.

```bash
npm run test:system-theme
```

Observed assertion excerpt:

```text
not ok 7 - manual choice remains authoritative when storage throws
  ---
  duration_ms: 3.838334
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:1:3753'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    'light' !== 'dark'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'dark'
  actual: 'light'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:134:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/02-manual-session-choice.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/02-manual-session-choice.log`.

## 03-startup-session-latch

File: `src/utils/theme-manager.ts`.

Restored SHA256: `2fad21df8d2bfb8337612581921c91b8d12c106b2780e045bbd97592ef076e0d`.

```bash
npm run test:system-theme
```

Observed assertion excerpt:

```text
not ok 19 - a stored manual choice survives storage becoming unreadable after startup
  ---
  duration_ms: 10.794833
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:1:7085'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    'light' !== 'dark'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'dark'
  actual: 'light'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:234:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/03-startup-session-latch.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/03-startup-session-latch.log`.

## 04-watcher-idempotency

File: `src/utils/theme-manager.ts`.

Restored SHA256: `2fad21df8d2bfb8337612581921c91b8d12c106b2780e045bbd97592ef076e0d`.

```bash
npm run test:system-theme
```

Observed assertion excerpt:

```text
not ok 12 - repeated watcher setup installs only one media listener
  ---
  duration_ms: 2.589084
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:1:5110'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    2 !== 1
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 1
  actual: 2
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:180:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/04-watcher-idempotency.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/04-watcher-idempotency.log`.

## 05-variant-precedence

File: `src/config/variant.ts`.

Restored SHA256: `e8f27539a336411864e9f816cd0176ff80093edf5af2ec92444f157752deed59`.

```bash
npm run test:system-theme
```

Observed assertion excerpt:

```text
not ok 13 - tech build selection wins before theme bootstrap
  ---
  duration_ms: 9.644959
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:1:6190'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    'full' !== 'tech'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'tech'
  actual: 'full'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:208:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/05-variant-precedence.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/05-variant-precedence.log`.

## 06-main-subscription

File: `src/main.ts`.

Restored SHA256: `30ccced02b0066aa9ff80690009aaa0c24a5fed888a66556af2faae23ae64822`.

```bash
env E2E_PORT=4295 VITE_VARIANT=full npx playwright test e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/06-main-subscription-artifacts --grep 'main bootstrap'
```

Observed assertion excerpt:

```text
Error: expect(locator).toHaveAttribute(expected) failed

    Locator:  locator('html')
    Expected: "light"
    Received: "dark"
    Timeout:  5000ms

    Call log:
      - Expect "toHaveAttribute" with timeout 5000ms
      - waiting for locator('html')
        9 × locator resolved to <html class="" lang="en" data-theme="dark" data-variant="full">…</html>
          - unexpected value "dark"


       7 |
       8 | async function expectTheme(page: Page, theme: string): Promise<void> {
    >  9 |   await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 5000 });
         |                                      ^
      10 |   expect(await page.locator('body').getAttribute('data-theme')).toBeNull();
      11 | }
      12 |
        at expectTheme (/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:9:38)
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:53:13
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/06-main-subscription.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/06-main-subscription.log`.

## 07-settings-subscription

File: `src/settings-main.ts`.

Restored SHA256: `4b76f01b211ae960e67037c1f06a359fd6b8aa387841356dd518ea38731c877d`.

```bash
env E2E_PORT=4295 VITE_VARIANT=full npx playwright test e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/07-settings-subscription-artifacts --grep 'settings bootstrap'
```

Observed assertion excerpt:

```text
Error: expect(locator).toHaveAttribute(expected) failed

    Locator:  locator('html')
    Expected: "light"
    Received: "dark"
    Timeout:  5000ms

    Call log:
      - Expect "toHaveAttribute" with timeout 5000ms
      - waiting for locator('html')
        9 × locator resolved to <html class="" lang="en" data-theme="dark" data-variant="full">…</html>
          - unexpected value "dark"


       7 |
       8 | async function expectTheme(page: Page, theme: string): Promise<void> {
    >  9 |   await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 5000 });
         |                                      ^
      10 |   expect(await page.locator('body').getAttribute('data-theme')).toBeNull();
      11 | }
      12 |
        at expectTheme (/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:9:38)
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:53:13
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/07-settings-subscription.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/07-settings-subscription.log`.

## 08-main-variant-order

File: `src/main.ts`.

Restored SHA256: `30ccced02b0066aa9ff80690009aaa0c24a5fed888a66556af2faae23ae64822`.

```bash
env E2E_PORT=4296 VITE_VARIANT=happy npx playwright test e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/08-main-variant-order-artifacts --grep 'main bootstrap'
```

Observed assertion excerpt:

```text
Error: expect(locator).toHaveAttribute(expected) failed

    Locator:  locator('html')
    Expected: "light"
    Received: "dark"
    Timeout:  5000ms

    Call log:
      - Expect "toHaveAttribute" with timeout 5000ms
      - waiting for locator('html')
        9 × locator resolved to <html class="" lang="en" data-theme="dark" data-variant="happy">…</html>
          - unexpected value "dark"


       7 |
       8 | async function expectTheme(page: Page, theme: string): Promise<void> {
    >  9 |   await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 5000 });
         |                                      ^
      10 |   expect(await page.locator('body').getAttribute('data-theme')).toBeNull();
      11 | }
      12 |
        at expectTheme (/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:9:38)
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:48:11
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/08-main-variant-order.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/08-main-variant-order.log`.

## 09-settings-variant-order

File: `src/settings-main.ts`.

Restored SHA256: `4b76f01b211ae960e67037c1f06a359fd6b8aa387841356dd518ea38731c877d`.

```bash
env E2E_PORT=4296 VITE_VARIANT=happy npx playwright test e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/09-settings-variant-order-artifacts --grep 'settings bootstrap'
```

Observed assertion excerpt:

```text
Error: expect(locator).toHaveAttribute(expected) failed

    Locator:  locator('html')
    Expected: "light"
    Received: "dark"
    Timeout:  5000ms

    Call log:
      - Expect "toHaveAttribute" with timeout 5000ms
      - waiting for locator('html')
        9 × locator resolved to <html class="" lang="en" data-theme="dark" data-variant="happy">…</html>
          - unexpected value "dark"


       7 |
       8 | async function expectTheme(page: Page, theme: string): Promise<void> {
    >  9 |   await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 5000 });
         |                                      ^
      10 |   expect(await page.locator('body').getAttribute('data-theme')).toBeNull();
      11 | }
      12 |
        at expectTheme (/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:9:38)
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:48:11
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/09-settings-variant-order.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/09-settings-variant-order.log`.

## 10-root-owner

File: `src/styles/window-chrome.css`.

Restored SHA256: `f41160dd6da50709016f01edcbdf1732465bc54a62b03c8cd2724c8a06c8e4ce`.

```bash
env E2E_PORT=4295 VITE_VARIANT=full npx playwright test e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/10-root-owner-artifacts --grep 'native light'
```

Observed assertion excerpt:

```text
Error: expect(locator).toHaveCSS(expected) failed

    Locator:  locator('.app-root')
    Expected: "rgba(242, 242, 247, 0.55)"
    Received: "rgba(20, 20, 30, 0.55)"
    Timeout:  5000ms

    Call log:
      - Expect "toHaveCSS" with timeout 5000ms
      - waiting for locator('.app-root')
        9 × locator resolved to <div class="app-root">…</div>
          - unexpected value "rgba(20, 20, 30, 0.55)"


      103 |     await expectTheme(page, theme);
      104 |     const light = theme === 'light';
    > 105 |     await expectStyle(page.locator('.app-root')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.55)' : 'rgba(20, 20, 30, 0.55)');
          |                                                  ^
      106 |     await expectStyle(page.locator('.mac-content-toolbar')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.85)' : 'rgba(28, 28, 30, 0.85)');
      107 |     await expectStyle(page.locator('.panel-header')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.6)' : 'rgba(28, 28, 30, 0.6)');
      108 |     expect(await page.locator('#scroll').evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor)).toBe(light ? 'rgba(0, 0, 0, 0.28)' : 'rgba(120, 120, 120, 0.55)');
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:105:50
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/10-root-owner.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/10-root-owner.log`.

## 11-toolbar-owner

File: `src/styles/macos-native.css`.

Restored SHA256: `65f6c5bdb20d3c91a031aa8c1081218462b211c0a27e021f49cb7a44216c87c2`.

```bash
env E2E_PORT=4295 VITE_VARIANT=full npx playwright test e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/11-toolbar-owner-artifacts --grep 'native light'
```

Observed assertion excerpt:

```text
Error: expect(locator).toHaveCSS(expected) failed

    Locator:  locator('.mac-content-toolbar')
    Expected: "rgba(242, 242, 247, 0.85)"
    Received: "rgba(28, 28, 30, 0.85)"
    Timeout:  5000ms

    Call log:
      - Expect "toHaveCSS" with timeout 5000ms
      - waiting for locator('.mac-content-toolbar')
        9 × locator resolved to <div class="mac-content-toolbar">Toolbar</div>
          - unexpected value "rgba(28, 28, 30, 0.85)"


      104 |     const light = theme === 'light';
      105 |     await expectStyle(page.locator('.app-root')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.55)' : 'rgba(20, 20, 30, 0.55)');
    > 106 |     await expectStyle(page.locator('.mac-content-toolbar')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.85)' : 'rgba(28, 28, 30, 0.85)');
          |                                                             ^
      107 |     await expectStyle(page.locator('.panel-header')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.6)' : 'rgba(28, 28, 30, 0.6)');
      108 |     expect(await page.locator('#scroll').evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor)).toBe(light ? 'rgba(0, 0, 0, 0.28)' : 'rgba(120, 120, 120, 0.55)');
      109 |     // CSSOM checks hover-rule applicability; this does not claim a WKWebView pointer test.
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:106:61
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/11-toolbar-owner.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/11-toolbar-owner.log`.

## 12-map-header-owner

File: `src/styles/macos-native.css`.

Restored SHA256: `65f6c5bdb20d3c91a031aa8c1081218462b211c0a27e021f49cb7a44216c87c2`.

```bash
env E2E_PORT=4295 VITE_VARIANT=full npx playwright test e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/12-map-header-owner-artifacts --grep 'native light'
```

Observed assertion excerpt:

```text
Error: expect(locator).toHaveCSS(expected) failed

    Locator:  locator('.panel-header')
    Expected: "rgba(242, 242, 247, 0.6)"
    Received: "rgba(28, 28, 30, 0.6)"
    Timeout:  5000ms

    Call log:
      - Expect "toHaveCSS" with timeout 5000ms
      - waiting for locator('.panel-header')
        9 × locator resolved to <div class="panel-header">Map</div>
          - unexpected value "rgba(28, 28, 30, 0.6)"


      105 |     await expectStyle(page.locator('.app-root')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.55)' : 'rgba(20, 20, 30, 0.55)');
      106 |     await expectStyle(page.locator('.mac-content-toolbar')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.85)' : 'rgba(28, 28, 30, 0.85)');
    > 107 |     await expectStyle(page.locator('.panel-header')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.6)' : 'rgba(28, 28, 30, 0.6)');
          |                                                      ^
      108 |     expect(await page.locator('#scroll').evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor)).toBe(light ? 'rgba(0, 0, 0, 0.28)' : 'rgba(120, 120, 120, 0.55)');
      109 |     // CSSOM checks hover-rule applicability; this does not claim a WKWebView pointer test.
      110 |     const hoverColors = await page.locator('#scroll').evaluate((element) => {
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:107:54
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/12-map-header-owner.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/12-map-header-owner.log`.

## 13-thumb-owner

File: `src/styles/macos-native.css`.

Restored SHA256: `65f6c5bdb20d3c91a031aa8c1081218462b211c0a27e021f49cb7a44216c87c2`.

```bash
env E2E_PORT=4295 VITE_VARIANT=full npx playwright test e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/13-thumb-owner-artifacts --grep 'native light'
```

Observed assertion excerpt:

```text
Error: expect(received).toBe(expected) // Object.is equality

    Expected: "rgba(0, 0, 0, 0.28)"
    Received: "rgba(120, 120, 120, 0.55)"

      106 |     await expectStyle(page.locator('.mac-content-toolbar')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.85)' : 'rgba(28, 28, 30, 0.85)');
      107 |     await expectStyle(page.locator('.panel-header')).toHaveCSS('background-color', light ? 'rgba(242, 242, 247, 0.6)' : 'rgba(28, 28, 30, 0.6)');
    > 108 |     expect(await page.locator('#scroll').evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor)).toBe(light ? 'rgba(0, 0, 0, 0.28)' : 'rgba(120, 120, 120, 0.55)');
          |                                                                                                                                         ^
      109 |     // CSSOM checks hover-rule applicability; this does not claim a WKWebView pointer test.
      110 |     const hoverColors = await page.locator('#scroll').evaluate((element) => {
      111 |       const colors: string[] = [];
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:108:137
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/13-thumb-owner.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/13-thumb-owner.log`.

## 14-thumb-hover-owner

File: `src/styles/macos-native.css`.

Restored SHA256: `65f6c5bdb20d3c91a031aa8c1081218462b211c0a27e021f49cb7a44216c87c2`.

```bash
env E2E_PORT=4295 VITE_VARIANT=full npx playwright test e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/14-thumb-hover-owner-artifacts --grep 'native light'
```

Observed assertion excerpt:

```text
Error: expect(received).toBe(expected) // Object.is equality

    Expected: "rgba(0, 0, 0, 0.5)"
    Received: "rgba(100, 100, 100, 0.8)"

      127 |       return colors;
      128 |     });
    > 129 |     expect(hoverColors.at(-1)).toBe(light ? 'rgba(0, 0, 0, 0.5)' : 'rgba(100, 100, 100, 0.8)');
          |                                ^
      130 |     await expectStyle(page.locator('.app-root')).toHaveCSS('backdrop-filter', 'blur(20px) saturate(1.8)');
      131 |     await expectStyle(page.locator('.mac-content-toolbar')).toHaveCSS('backdrop-filter', 'blur(24px) saturate(1.8)');
      132 |   }
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/e2e/system-theme.spec.ts:129:32
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/14-thumb-hover-owner.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/14-thumb-hover-owner.log`.

## 15-listener-capability

File: `src/utils/theme-manager.ts`.

Restored SHA256: `2fad21df8d2bfb8337612581921c91b8d12c106b2780e045bbd97592ef076e0d`.

```bash
npm run test:system-theme
```

Observed assertion excerpt:

```text
not ok 20 - missing media change-listener API preserves startup and manual appearance
  ---
  duration_ms: 2.82475
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:1:7394'
  failureType: 'testCodeFailure'
  error: |-
    Got unwanted exception.
    Actual message: "mq.addEventListener is not a function"
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  actual:
  error: 'mq.addEventListener is not a function'
  name: 'TypeError'
  stack: |-
    Object.watchSystemTheme (evalmachine.<anonymous>:115:8)
    <anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:244:37)
    getActual (node:assert:609:5)
    Function.doesNotThrow (node:assert:777:32)
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:244:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/15-listener-capability.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/15-listener-capability.log`.

## 16-stored-variant-precedence

File: `src/config/variant.ts`.

Restored SHA256: `e8f27539a336411864e9f816cd0176ff80093edf5af2ec92444f157752deed59`.

```bash
npm run test:system-theme
```

Observed assertion excerpt:

```text
not ok 16 - full build retains stored variant before hostname
  ---
  duration_ms: 7.596041
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:1:6346'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    'full' !== 'happy'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'happy'
  actual: 'full'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux031-mutation-proof-20260915/src/utils/__tests__/theme-manager.test.mts:213:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
```

Full diff: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/16-stored-variant-precedence.diff`. Log: `/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/mutations/16-stored-variant-precedence.log`.

## Confirmed applied diffs

These saved diffs were inspected before each targeted run. The before and after SHA-256 values are identical to the restored values above for every row.

### 01-watcher-persists

```diff
diff --git a/src/utils/theme-manager.ts b/src/utils/theme-manager.ts
index 2ed8145d9..c9ad81f63 100644
--- a/src/utils/theme-manager.ts
+++ b/src/utils/theme-manager.ts
@@ -115,7 +115,7 @@ export function watchSystemTheme(): void {
 
  // Only follow OS if no explicit user preference and not the happy variant
  if (!sessionChoice && !hasExplicitPreference && variant !== 'happy') {
- applyTheme(e.matches ? 'dark' : 'light');
+ setTheme(e.matches ? 'dark' : 'light');
  }
   });
 }
```

### 02-manual-session-choice

```diff
diff --git a/src/utils/theme-manager.ts b/src/utils/theme-manager.ts
index 2ed8145d9..b2fc6d264 100644
--- a/src/utils/theme-manager.ts
+++ b/src/utils/theme-manager.ts
@@ -48,7 +48,6 @@ function applyTheme(theme: Theme): void {
 
 /** Apply and persist an explicit choice, retaining it if storage is unavailable. */
 export function setTheme(theme: Theme): void {
-  sessionChoice = theme;
   try {
     localStorage.setItem(STORAGE_KEY, theme);
   } catch {
```

### 03-startup-session-latch

```diff
diff --git a/src/utils/theme-manager.ts b/src/utils/theme-manager.ts
index 2ed8145d9..564d25543 100644
--- a/src/utils/theme-manager.ts
+++ b/src/utils/theme-manager.ts
@@ -79,7 +79,6 @@ export function applyStoredTheme(): void {
   } else if (hasExplicitPreference) {
  // User made an explicit choice — respect it regardless of variant
  effective = raw as Theme;
- sessionChoice = effective;
   } else if (variant === 'happy') {
  // happy variant defaults to light
  effective = 'light';
```

### 04-watcher-idempotency

```diff
diff --git a/src/utils/theme-manager.ts b/src/utils/theme-manager.ts
index 2ed8145d9..1ac2c8015 100644
--- a/src/utils/theme-manager.ts
+++ b/src/utils/theme-manager.ts
@@ -102,7 +102,6 @@ export function applyStoredTheme(): void {
  * Call once after applyStoredTheme() during app bootstrap.
  */
 export function watchSystemTheme(): void {
-  if (watchingSystemTheme) return;
   const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
   if (!mq || typeof mq.addEventListener !== 'function') return;
   watchingSystemTheme = true;
```

### 05-variant-precedence

```diff
diff --git a/src/config/variant.ts b/src/config/variant.ts
index 77978ea65..38cccf51e 100644
--- a/src/config/variant.ts
+++ b/src/config/variant.ts
@@ -9,7 +9,7 @@ export const SITE_VARIANT: SiteVariant = requestedVariant && SITE_VARIANTS.has(r
 
 export function initializeVariant(): void {
   let variant = SITE_VARIANT;
-  if (variant === 'full') {
+  {
     let stored: string | null = null;
     try { stored = localStorage.getItem('crystalball-variant'); } catch { /* storage unavailable */ }
     if (stored && SITE_VARIANTS.has(stored as SiteVariant)) {
```

### 06-main-subscription

```diff
diff --git a/src/main.ts b/src/main.ts
index 167bebe52..476b93c5b 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -284,7 +284,6 @@ void import('@/services/always-on').then(({ applyAlwaysOn }) => applyAlwaysOn())
 // Resolve the variant before choosing its default appearance.
 initializeVariant();
 applyStoredTheme();
-watchSystemTheme();
 
 // is-desktop-macos drives a macOS-specific design system that hides
 // .header and replaces it with a sidebar+toolbar shell. Only Tauri builds
```

### 07-settings-subscription

```diff
diff --git a/src/settings-main.ts b/src/settings-main.ts
index f559fa026..338b160fe 100644
--- a/src/settings-main.ts
+++ b/src/settings-main.ts
@@ -754,7 +754,6 @@ function handleSearch(query: string): void {
 async function initSettingsWindow(): Promise<void> {
   initializeVariant();
   applyStoredTheme();
-  watchSystemTheme();
   await initI18n();
 
   try { await resolveLocalApiPort(); } catch { /* use default */ }
```

### 08-main-variant-order

```diff
diff --git a/src/main.ts b/src/main.ts
index 167bebe52..45b1fabcc 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -282,8 +282,8 @@ loadDesktopSecretsWhenReady().then(async () => {
 void import('@/services/always-on').then(({ applyAlwaysOn }) => applyAlwaysOn()).catch(() => {});
 
 // Resolve the variant before choosing its default appearance.
-initializeVariant();
 applyStoredTheme();
+initializeVariant();
 watchSystemTheme();
 
 // is-desktop-macos drives a macOS-specific design system that hides
```

### 09-settings-variant-order

```diff
diff --git a/src/settings-main.ts b/src/settings-main.ts
index f559fa026..73a19dd1b 100644
--- a/src/settings-main.ts
+++ b/src/settings-main.ts
@@ -752,8 +752,8 @@ function handleSearch(query: string): void {
 // ── Init ──
 
 async function initSettingsWindow(): Promise<void> {
-  initializeVariant();
   applyStoredTheme();
+  initializeVariant();
   watchSystemTheme();
   await initI18n();
```

### 10-root-owner

```diff
diff --git a/src/styles/window-chrome.css b/src/styles/window-chrome.css
index bb3394b6c..41b1788a5 100644
--- a/src/styles/window-chrome.css
+++ b/src/styles/window-chrome.css
@@ -22,7 +22,7 @@ body.is-desktop-macos .app-root {
   -webkit-backdrop-filter: blur(20px) saturate(180%);
 }
 
-[data-theme="light"] body.is-desktop-macos .app-root {
+body.is-desktop-macos[data-theme="light"] .app-root {
   background: rgba(242, 242, 247, 0.55);
 }
```

### 11-toolbar-owner

```diff
diff --git a/src/styles/macos-native.css b/src/styles/macos-native.css
index 1d5d10f94..3a794b763 100644
--- a/src/styles/macos-native.css
+++ b/src/styles/macos-native.css
@@ -934,7 +934,7 @@ body.is-desktop-macos .mac-content {
   /* Note: no -webkit-app-region here — JS startDragging() handles drag (see _setupToolbarDrag) */
 }
 
-[data-theme="light"] body.is-desktop-macos .mac-content-toolbar {
+body.is-desktop-macos[data-theme="light"] .mac-content-toolbar {
   background: rgba(242, 242, 247, 0.85);
 }
```

### 12-map-header-owner

```diff
diff --git a/src/styles/macos-native.css b/src/styles/macos-native.css
index 1d5d10f94..7f4c09997 100644
--- a/src/styles/macos-native.css
+++ b/src/styles/macos-native.css
@@ -1085,7 +1085,7 @@ body.is-desktop-macos .map-section .panel-header {
   font-family: var(--mac-font);
 }
 
-[data-theme="light"] body.is-desktop-macos .map-section .panel-header {
+body.is-desktop-macos[data-theme="light"] .map-section .panel-header {
   background: rgba(242, 242, 247, 0.6);
 }
```

### 13-thumb-owner

```diff
diff --git a/src/styles/macos-native.css b/src/styles/macos-native.css
index 1d5d10f94..399553ce9 100644
--- a/src/styles/macos-native.css
+++ b/src/styles/macos-native.css
@@ -1193,7 +1193,7 @@ body.is-desktop-macos ::-webkit-scrollbar-corner {
 }
 
 /* Light-mode thumb — darker against light backgrounds */
-[data-theme="light"] body.is-desktop-macos ::-webkit-scrollbar-thumb {
+body.is-desktop-macos[data-theme="light"] ::-webkit-scrollbar-thumb {
   background: rgba(0, 0, 0, 0.28);
 }
 [data-theme="light"] body.is-desktop-macos ::-webkit-scrollbar-thumb:hover {
```

### 14-thumb-hover-owner

```diff
diff --git a/src/styles/macos-native.css b/src/styles/macos-native.css
index 1d5d10f94..2e6b42873 100644
--- a/src/styles/macos-native.css
+++ b/src/styles/macos-native.css
@@ -1196,7 +1196,7 @@ body.is-desktop-macos ::-webkit-scrollbar-corner {
 [data-theme="light"] body.is-desktop-macos ::-webkit-scrollbar-thumb {
   background: rgba(0, 0, 0, 0.28);
 }
-[data-theme="light"] body.is-desktop-macos ::-webkit-scrollbar-thumb:hover {
+body.is-desktop-macos[data-theme="light"] ::-webkit-scrollbar-thumb:hover {
   background: rgba(0, 0, 0, 0.50);
 }
```

### 15-listener-capability

```diff
diff --git a/src/utils/theme-manager.ts b/src/utils/theme-manager.ts
index 2ed8145d9..fcd2e2d93 100644
--- a/src/utils/theme-manager.ts
+++ b/src/utils/theme-manager.ts
@@ -104,7 +104,7 @@ export function applyStoredTheme(): void {
 export function watchSystemTheme(): void {
   if (watchingSystemTheme) return;
   const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
-  if (!mq || typeof mq.addEventListener !== 'function') return;
+  if (!mq) return;
   watchingSystemTheme = true;
 
   mq.addEventListener('change', (e) => {
```

### 16-stored-variant-precedence

```diff
diff --git a/src/config/variant.ts b/src/config/variant.ts
index 77978ea65..3ea355971 100644
--- a/src/config/variant.ts
+++ b/src/config/variant.ts
@@ -13,7 +13,7 @@ export function initializeVariant(): void {
     let stored: string | null = null;
     try { stored = localStorage.getItem('crystalball-variant'); } catch { /* storage unavailable */ }
     if (stored && SITE_VARIANTS.has(stored as SiteVariant)) {
-      variant = stored as SiteVariant;
+      variant = SITE_VARIANT;
     } else {
       const prefix = location.hostname.split('.')[0];
       if (prefix && SITE_VARIANTS.has(prefix as SiteVariant)) variant = prefix as SiteVariant;
```
