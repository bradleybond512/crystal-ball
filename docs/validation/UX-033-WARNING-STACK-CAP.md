# UX-033 warning stack cap

Assessment: 2026-11-07 UTC. Standard UI slice, PR #1839. Implementation and
Chromium geometry qualification complete. Independent Sonnet review approved the
bounded code slice with zero blocking findings. Installed macOS/WebKit acceptance
remains pending. UX-033 is MONITOR, not fully complete.

## Brief and approved scope

Goal: leave content and navigation reachable when many warnings are present.
Acceptance: bound both the rendered shelf and its measured reserved space to 40%
of the viewport remaining below EEW, without changing warning order or actions.
Constraints: retain ResizeObserver/offsetHeight publication, overflow scrolling,
pointer behavior, mount/destroy semantics, existing web and native-style layouts.
Non-goals: provider behavior, native architecture, security, changing individual
warning components, rail inventory (UX-034), release, installation or deployment.
Unknown: installed WebKit/native acceptance. Risk: low, isolated CSS geometry;
rounded offsetHeight can differ from the fractional rendered height by 0.5px.
Coordinator completed discovery/design and assigned implementation/testing to
ui_map_engineer/test_engineer before production editing.

## Change and evidence

Only production edit: `src/components/NotificationStack.ts` now sets
`maxHeight: 'calc((100dvh - var(--below-eew)) * 0.4)'`.
No architecture, lifecycle, observer or provider changes.

`e2e/warning-stack-layout.mjs` bundles the real component, serves `main.css` and
its complete stylesheet graph (including alerts and macOS-native rules), and uses
real Chromium layout/ResizeObserver. Synthetic 48px warning rows isolate shelf
behavior from provider state. These are not installed native/WebKit tests.

Five scenarios: web 640x360, web 360x640, native-style expanded 640x360 and
900x360, native-style collapsed 640x360. Each checks empty, below-cap and overflow
states, actual versus published height, priority order, keyboard Tab/Enter to the
last warning, scroll/click access, content and navigation hit-testing, content
scrolling, viewport resize, row removal and destroy/disconnected observer.
Web #app top/height and native-style main/sidebar padding reservations are checked.
Existing <=720px alerts.css intentionally makes the native-style shelf span the
window; the wide expanded case also checks its 180px sidebar inset.

Observed overflowing geometry (rendered / reserved / expected cap):

- Web 640x360: 131.1875 / 131 / 131.2px, top 32px.
- Web 360x640: 243.1875 / 243 / 243.2px, top 32px.
- Native-style 360px high: 126.390625 / 126 / 126.4px, top 44px.
- Resize to 480px high: web 179.1875 / 179 / 179.2px;
  native-style 174.390625 / 174 / 174.4px.

## Commands and actual output

Tests were written first. Before changing production code, the initial four-case
browser harness produced `RESULT 0 pass / 4 fail`, including
`FAIL web short shelf 328 exceeds cap 131.20000000000002`.

After fixing and extending wide-sidebar coverage:

```text
npm run test:warning-stack-layout
RESULT 5 pass / 0 fail
npm run test:summary-strip-layout
RESULT 8 pass / 0 fail
npm run test:weather
ℹ tests 411
ℹ pass 411
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Full gate command:
`bash scripts/agentic-validate.sh --tests "test:warning-stack-layout test:summary-strip-layout test:weather"`.
Initial attempt and commit hook stopped with
`src/components/DeckGLMap.ts(6,33): error TS2307: Cannot find module '@deck.gl/maplibre' or its corresponding type declarations.`
The supplied dependency symlink was stale. This worktree's symlink was switched
to an existing dependency tree with the identical package-lock SHA1
`fb335ca45843e581df479fd7be76ba980b68fe35`, including @deck.gl/maplibre 9.4.0.
No other worktree, dependency manifest, lockfile, check or validation rule changed.
All commit hooks then passed. Rerunning the full gate exited 0:

```text
Agentic validation gate passed.
Tests run: test:warning-stack-layout test:summary-strip-layout test:weather
This gate does NOT prove a new test fails without its fix — attach a mutation proof (AGENTS.md).
```

Build emitted existing ineffective-dynamic-import warnings; no warning suppression
or validation changes were made.

## Clean-tree mutation proof

Baseline commit `20dd480c3`, empty `git status --short`, recorded SHA-256:
`4c2d67ac63db0a5ab77167f8fa063ffd5103080723ad894e67fbbb10a93e0406`.
The confirmed `git diff` reversed only the cap:

```diff
-      maxHeight: 'calc((100dvh - var(--below-eew)) * 0.4)',
+      maxHeight: 'calc(100dvh - var(--below-eew))',
```

`npm run test:warning-stack-layout` changed from `RESULT 5 pass / 0 fail` to:

```text
FAIL web short shelf 328 exceeds cap 131.20000000000002
FAIL web narrow shelf 608 exceeds cap 243.20000000000002
FAIL native-style expanded shelf 316 exceeds cap 126.4
FAIL native-style wide expanded shelf 316 exceeds cap 126.4
FAIL native-style collapsed shelf 316 exceeds cap 126.4
RESULT 0 pass / 5 fail
```

Mutated command exited 1. `git restore src/components/NotificationStack.ts`
restored the identical SHA-256 above and empty `git status --short`.

## Remaining acceptance and rollback

Independent Claude Sonnet 4.6 (medium effort) approved implementation/docs SHA
`25887d6f84c1215345a052d2451d6d4c2c66b5b6` with zero blocking findings. A fresh
exact-tip review covers this subsequent metadata correction before publication.
Coordinator owns publication and landing. Do not interpret this
browser fixture as installed macOS/WebKit acceptance or a complete warning-source
integration test. On the installed app, trigger multiple warnings at a short
window height, exercise bottom actions with keyboard and scrolling, verify
content/navigation with sidebar expanded/collapsed, then resize and dismiss.
No build dispatch, installation, deployment or native acceptance was performed.
Rollback is the one-line maxHeight reversion (with regression expectations
updated deliberately); it restores the full-height occlusion risk.
