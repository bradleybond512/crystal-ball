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

## Pending local integration qualification, 2026-11-07

Execution source: `4403bf6dcde8c1866304b6270b9161fb756d663e`, clean tree before
and after validation. Its immutable pending UX-044 base is
`946abbc33242f6f49fb2c5b851f43d0022815e54`, not actual main. The later UX-044
evidence-only certificate `2dcd7f2effdd347987de6f38c87fdd046ed4f32a` must be
preserved on the eventual actual-main transition; this source does not claim to
include that certificate. The sole integration conflict was adjacent package.json
test scripts; both scripts were retained. Production delta relative to the pending
base remains only the cap line. Persistent announcements and prior warning,
forecast, sensor and credential lifecycle behavior are inherited unchanged.

Execution root:
`/Users/bradleybond/.codex/worktrees/ux033-reconcile-nov7/crystalball`.
Node binary `/opt/homebrew/opt/node@22/bin/node`, version `v22.23.1`; npm `10.9.8`.
Canonical user TMPDIR, verified with `getconf DARWIN_USER_TEMP_DIR`:
`/var/folders/qt/hq7cydbd06d6g0yksx3mxm3c0000gn/T/`.
Existing dependency symlink target:
`/Users/bradleybond/.codex/worktrees/ux047-warning-freshness-nov1/crystalball/node_modules`.

Source SHA-256 identities:

- `src/components/NotificationStack.ts`: `0924eeaa8fa60ae16dfb7e59d60a60380edc6b3394974a3c32c4e02e7283f6a7`
- `e2e/warning-stack-layout.mjs`: `5e722172564b15614748877c5c71fc5235589409499dce3aaa75f6611854430a`
- `e2e/summary-strip-layout.mjs`: `13ceb8c762e07a433ad3e5a245b4e55af5299650de684d804ba79d36f1bc170d`
- `package.json`: `82cfeb2a8e5c215704663e8c3fd117a42306b4c156f11956ba0419d8fa2fa374`
- `package-lock.json`: `fa0fc7a76d31ce38c5b03b52e88b4c61956e444dc5171e89fab9a105e02e147f`

The unchanged aggregate command, under the runtime above, exited 0:

```text
bash scripts/agentic-validate.sh --tests 'test:warning-stack-layout test:summary-strip-layout test:weather test:ux044 test:ux047 test:warning-delivery'
```

Exact behavioral output, in command order:

```text
RESULT 5 pass / 0 fail
RESULT 9 pass / 0 fail
# tests 411
# pass 411
# fail 0
# tests 26
# pass 26
# fail 0
# tests 124
# pass 124
# fail 0
# tests 44
# pass 44
# fail 0
Agentic validation gate passed.
Tests run: test:warning-stack-layout test:summary-strip-layout test:weather test:ux044 test:ux047 test:warning-delivery
```

Lockfile, strict lint, all typechecks, secrets, cross-agent policy, docs, roadmap
and build steps ran unchanged. Build printed existing bundler timing/dynamic-import
warnings. No large test selector, release build dispatch, review, push or install
was performed during this qualification.

Fresh clean-tree cap mutation on this exact source previously changed geometry
`5 pass / 0 fail` to `0 pass / 5 fail` (exit 1). Confirmed-applied diff:

```diff
-      maxHeight: 'calc((100dvh - var(--below-eew)) * 0.4)',
+      maxHeight: 'calc(100dvh - var(--below-eew))',
```

All five failures reported the full-height shelf exceeding its 40% cap. Restoring
the file reproduced the source SHA-256 above and empty status. This mutation was
part of light integration; the aggregate runtime described above is independently
recorded and does not retroactively change that earlier mutation's runtime.

Local logs and SHA-256:

- `/tmp/ux033-pending-aggregate.log`: `9e1b043e959cfaea3df40733cbe7b541aed76e6153e36d89371f5b20ed24e25b`
- `/tmp/ux033-pending-aggregate-identities.log`: `a576dacd17a85e87aa2db1c4948f710e03ac6845a67d93ee3bec3ec1a51e936d`
- `/tmp/ux033-pending-mutation.log`: `c93508e310a2096ee342fac79924da65f13df746dcf8f25dbb339a4c9395346d`

This is pending-local qualification, not final actual-main acceptance or a fresh
cross-agent verdict. UX-033 remains MONITOR: installed macOS/WebKit and full-app
acceptance are still open. The final transition must preserve intervening evidence,
validate its actual changes, and obtain the required exact-tip review.

## Latest pending evidence integration

The latest metadata-only integration source is
`26f11012c7fd901c19577826d7f65f0f69341bbd`, on local pending accessibility base
`7f18682ae1fa69079e791b5f39a1334233bf2168`. Actual main remains separately pinned
at `f106fc842528b63ccc592f7d12e8089550fc36df`; these pending heads are not main.
[Continuity receipt](UX033-LATEST-PENDING-CONTINUITY.json) verifies all
non-provenance tracked bytes, test/package/mapper/lint inputs and the 674-file
build against qualified source `52687d373ee5f315957b93ac72ebd9962dd5e4df`.
Its unchanged lint:ci and aggregate results are retained as prior execution, not
rerun claims. All 105 effective selected command/owner plans match the latest
upstream UX-044 receipt; no new or changed plan needs execution. Any future
trusted-stage execution must forward `stage.env ?? process.env`.

A fresh complete 103-PR candidate snapshot exits 1 because the upstream
evidence PRs #1853, #1854, #1845 and #1851 remain OPEN. These dependency blockers are explicit
and not waived. No model review, verdict, push or landing occurred. Preserve the
newest upstream receipts on eventual actual-main integration. Native WebKit and
full-app acceptance remain open under MONITOR.

## Shared pre-abort repair qualification

Pending local merge `e34b31282` commits the exact tested tree
`9d0cb54c0ac24460bdff3ccb5bef109f992f2fd5` with normal hooks. It preserves the
upstream accessibility base `7b278de42a26954f2e4eb5ba60c9af2e6be0e691`.
[Repair receipt](UX033-PREABORT-PENDING-CONTINUITY.json) records the only two
changed executable inputs: the shared transport-evidence helper and its test.
Fresh Node22 light checks passed transport 14/0, geometry 5/0 and summary 9/0.
Own geometry production/test and cap-mutation hashes remain unchanged.

The common credential mutation proof is reused only after exact helper and test
SHA-256 matching: 14/0 green, 8/6 with the pre-abort guard removed, 14/0 restored.
This is not a new local mutation run. Normal commit hooks passed, but prior full
lint/build/aggregate receipts do not qualify this changed helper or current build.
A fresh unchanged aggregate/build and explicit lint:ci remain mandatory before
review. No model, verdict, push, actual-main merge, release or installation was
performed. Native WebKit and full-app acceptance remain open under MONITOR.

## Repaired composite qualification at main pin 8174ce37

Fresh qualification executed source `69a2a1864e907e0acf7690283138bfe9bda091c4`,
including pending accessibility `28538e31ac9e881c8d58a087b97b35537c440abe` and the
shared pre-abort helper repair. Actual main was separately held at
`8174ce37131fa73f3cbb8aeaadfae4272b0f2404`; the composite is not claimed as main.
[Execution receipt](UX033-REPAIRED-COMPOSITE-VALIDATION.json) records source/tree,
input/build hashes, exact runtime, locked marketing dependencies, full effective
selector ownership and live snapshot provenance.

The unchanged prescribed aggregate/build exited 0: geometry 5/0, summary 9/0,
weather 411/0, accessibility 26/0, warning lifecycle 124/0 and delivery 45/0.
A fresh focused transport run passed 14/0. Explicit unchanged lint:ci exited 0:
1006 baselined findings, no increases, 63 changed files, zero errors and one
no-matching-configuration warning for the FAA declaration file. No rules or
baselines changed. The sidecar generated xmpp bundle was absent; dist stayed in
place and no artifacts or tracked sources were moved or excluded.

The full effective selector audit contains 95 scripts and passes its mapping
gate; it is an audit, not a new 95-suite execution claim. A fresh complete
103-PR candidate snapshot exits 1 because the accessibility and credential PRs
(#1854 and #1851) remain OPEN. These dependency blockers are retained without waiver.
The shared main pin and heavy slot were released after qualification completed.
No model review, verdict, push or actual-main merge occurred. Native WebKit and
full-app acceptance remain open under MONITOR.

## Final upstream source, still pending publication

Linear preparation source `5a763d686afa02d25f53da9403dccd30d1599e69` applies the
exact owned UX-033 delta onto frozen upstream
`37057d929e8bacff500dd8d58ea2ca01e6332252`. That accessibility source is still
unreviewed/unpushed; PR #1854 is OPEN. Direct branch API authority confirms actual
main separately at `0a01b4b24f1dc5f8beb617ade94650a514d2728b`; per-PR base SHA is
not used as current-main authority. The prior reconcile branch remains preserved.

[Pending continuity receipt](UX033-FINAL-UPSTREAM-PENDING-CONTINUITY.json)
verifies all 5557 non-evidence inputs, tool binaries, locked marketing dependencies
and 674 build files against qualified repaired source `69a2a1864`. No full
aggregate, build or lint rerun is claimed. Effective selection now contains 59
scripts. Only two command/ownership changes needed fresh execution: PR-owned
sidecar orchestration passed 13/0 with separate inner counts 338/0 and 35/0;
trusted-main credential validation passed 125/0. Stage environment overrides were
forwarded correctly. SQLite emitted its experimental warning.

The fresh complete 103-PR candidate snapshot still exits 1 because upstream
accessibility PR #1854 is OPEN. No waiver, candidate readiness or final exact-main
review readiness is claimed. No model, new verdict, push, merge to main, release
or installation occurred. Native WebKit/full-app acceptance remains MONITOR.

## Actual-main integration after accessibility merge

The owned UX-033 delta is now prepared linearly on verified actual main
`42034cfaa8d49004de90e333dd1946e9e505a936`, which contains merged PR #1854.
Its source and review certificate are retained. The previous prepared head
`9340e6678d2e1ade96359d1df28243e689a5f86d` remains backed up; the original
remote PR branch is untouched.

[Actual-main continuity receipt](UX033-ACTUAL-MAIN-CONTINUITY.json) verifies
all 5557 qualified non-evidence inputs, 674 build files, tool binaries and the
installed marketing dependency lock unchanged. Therefore the qualified repaired
aggregate/build and explicit lint:ci results above are reused, not rerun.
The full effective selector now contains 48 scripts with a passing mapping gate.
Only accessibility changed command ownership to trusted actual main; its exact
trusted command was rerun with stage environment forwarding and passed 26/0.
Eleven formerly selected suites dropped out with the merged ancestry. Selection
is audited, not a claim that all 48 suites ran again.

A fresh complete live snapshot contains 103 records, including 27 open-main PRs;
the candidate roadmap gate exits 0 with no dependency waiver. Prior pending-base
receipts remain historical evidence, not descriptions of the current branch.
Final exact-source Sonnet review and publication remain coordinator-owned.
Native WebKit and full-app acceptance remain open under MONITOR. No new model
review, verdict, push, main merge, release or installation was performed here.
