# UX-066 — security integration validation

November 28, 2026. Code candidate `7159ff6330a43befe849418be3ed0ab14ccd90f9`,
canonical base `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`, existing PR #1902.
This report supersedes dated acceptance statements in the preserved November 10
Zizmor reports. Final independent review, publication and hosted acceptance are
pending; none is implied by local results below.

## Result and scope

The combined candidate removes the known blocking cookie, URL and marketing RSC
findings before protected merging. It retains the exact reviewed Zizmor 1.32.0
pin and main's SPC date fix. No application source, storage, permissions, audit
thresholds or ignored advisories change. Only three Cargo package records change
(cookie 0.18.3, URL 2.5.9, form_urlencoded 1.2.3); the marketing pair is byte-for-byte
reviewed #1904 with coherent React/DOM/RSC 19.2.9. The stale UX-076 tracker note is reconciled to merged #1900: GitHub reverified
on November 28, merged November 14 at 21:18:06Z, SHA
`92ff943dfc96c31c1c9f399baf9e1429e75bbd75`. This metadata correction does not
claim new UX-076 implementation. No other #1920 changes are replayed
and its branch/settings remain untouched. The full dependency backlog stays open.

## Dependency assessment and release age

Official archives were bounded and checked for unsafe members before extraction;
checksums match official metadata and committed lock integrity. Rust licenses
remain MIT OR Apache-2.0, npm MIT. No new dependencies, features or lifecycle scripts
are introduced. Cookie's existing build.rs is unchanged; URL/form have none.
No signature or exhaustive upstream source-audit claim is made.

Cookie includes the OsRng nonce fix and inherited parser changes. URL includes
blob-origin recursion removal and inherited parser/performance fixes; form clamps
a suffix offset. DOM/RSC include transport safety changes, requiring the isolated
Worker tests below. Full package/manifest comparisons and receipts are retained.

Cookie 0.18.3 was published November 23 at 07:45:48 UTC, so the ordinary seven-day
age condition is not met until November 30 at that time. A justified
`dependency-age-reviewed` label is appropriate under UX-066's standing delegation:
this minimal available patch addresses RUSTSEC-2026-0594, official bytes and source
were assessed, the build script is unchanged, and library/native/audit regression
checks passed. The direct benefit established here is removal of a known vulnerable dependency
and restoring audit-gate cleanliness; application exposure to the fork issue is
unestablished. Waiting until November 30 at 07:45:48 UTC is the alternative.
This is an explicit review exception, not an ordinary age pass.
URL/form were published November 20 and the npm trio October 14; their ordinary
age condition is met. `dependency-change-approved` is supported by this assessment;
no human-only install-script approval is asserted.

## Actual validation

Node 22.23.1, Rust 1.93.1; isolated dependency homes and caches. Raw logs and
machine-readable receipts are retained under the local artifact directory:

```text
/Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/next-nov28/ux066-cookie
```

`bash scripts/agentic-validate.sh --tests "test:spc-angle test:supply-chain-gates test:workflow-security test:roadmap-controller"`
exited 0. It includes type checks, lint, secrets, docs, lockfile and ordinary build.
Actual selected output follows, in suite order (SPC, supply chain, workflow, roadmap):

```text
# tests 5
# pass 5
# fail 0
# tests 27
# pass 27
# fail 0
# tests 96
# pass 96
# fail 0
# tests 135
# pass 135
# fail 0
Agentic validation gate passed.
Tests run: test:spc-angle test:supply-chain-gates test:workflow-security test:roadmap-controller
```

`npm run audit:locks` on committed HEAD exited 0; it reads Git blobs, not working
files. Existing low/moderate findings remain visible. Actual six-project output:

```text
[npm-audit] .: 1041 dependencies; 0 info, 1 low, 14 moderate, 0 high, 0 critical (@eslint/config-array:moderate, @typescript-eslint/eslint-plugin:moderate, @typescript-eslint/parser:moderate, @typescript-eslint/type-utils:moderate, @typescript-eslint/typescript-estree:moderate, @typescript-eslint/utils:moderate, eslint:moderate, eslint-plugin-sonarjs:moderate, fast-xml-parser:low, glob:moderate, i18next:moderate, minimatch:moderate, typescript-eslint:moderate, vite-plugin-pwa:moderate, workbox-build:moderate)
[npm-audit] .github/tools/codex: 7 dependencies; 0 info, 0 low, 0 moderate, 0 high, 0 critical
[npm-audit] marketing-site: 627 dependencies; 0 info, 0 low, 8 moderate, 0 high, 0 critical (@typescript-eslint/eslint-plugin:moderate, @typescript-eslint/parser:moderate, @typescript-eslint/type-utils:moderate, @typescript-eslint/typescript-estree:moderate, @typescript-eslint/utils:moderate, minimatch:moderate, next:moderate, typescript-eslint:moderate)
[npm-audit] scripts: 47 dependencies; 0 info, 0 low, 0 moderate, 0 high, 0 critical
[npm-audit] tools/cb-control: 41 dependencies; 0 info, 0 low, 0 moderate, 0 high, 0 critical
[npm-audit] tools/mcp-server: 93 dependencies; 0 info, 0 low, 2 moderate, 0 high, 0 critical (@hono/node-server:moderate, hono:moderate)
```

Pinned Cargo audit used RustSec revision
`c5279d0b0c9e8b70df666eb6d1edbabcfd1176bd`, `--no-fetch`, unchanged policy;
exit 0, vulnerability count 0. Baseline had 2. `cargo deny --locked check sources bans`
exited 0 with `bans ok, sources ok`.

Isolated marketing `npm ci --ignore-scripts`, peer check, typecheck and lint exited
0. `npm test` built the application and executed the real Worker tests: 51 passed,
0 failed. Direct installed audit returns exit 1 at its default moderate threshold;
8 moderate, 0 high, 0 critical is consistent with the unchanged high threshold.

`cargo test --manifest-path src-tauri/Cargo.toml --locked --no-run` exited 0 and
compiled 8 test executables; this compilation step executed none. The later
explicit navigation-only execution below is separate. Initial compilation failed because
an isolated copy lacked the generated XMPP bundle. Existing sebuf/XMPP build scripts
and the ordinary web output supplied the resources before the successful retry;
no resource check was weakened. Existing native warnings remain (38 contract,
10 duplicate bin-test, 11 bin warnings). UX-071 addresses native lint separately.

Cookie upstream library tests: default 21 passed / 0 failed / 1 ignored;
all features 37 passed / 0 failed / 1 ignored. The ignored test is upstream.
These exercise parsing/private-jar roundtrips, not the process-fork vulnerability.
URL's identical three-case origin test passed 1 / failed 2 on 2.5.8 and passed 3 /
failed 0 on 2.5.9. Nested blob and WebSocket inner origins become opaque; HTTP(S)
controls retain tuple origins. No deliberate stack exhaustion was attempted.

The official Zizmor 1.32.0 wheel matched the approved SHA256
`0a999c98015becd9f69919ce01febadfb1c2be9b8ec2ce9ef7eb13ff23ba8eba`.
Offline medium-severity scan completed all 23 workflows, exit 0, no findings.
The changed-file selector passed both selected scripts; explicit native and
marketing checks above cover dependencies omitted by the current selector.

## Mutation evidence

Each tracked-file proof began clean, confirmed the applied `git diff`, restored
exact SHA256 values and ended with empty `git status --short`. Raw diffs, detector
TAP output and audit JSON are retained in `mutation-summary.json` and
`combined-mutations/summary.json` beneath the artifact directory.

- Cookie at `fbe474ebb3`: reverting only its two lock fields changed detector
  **1 pass / 0 fail → 0 pass / 1 fail → 1 pass / 0 fail**, audit findings 1 → 2 → 1.
  Restored Cargo SHA256 `e0ce0ae9671f081283f3e5f7e4f9000583d878b459219bc9d37e693c37cb37cb`.
- URL/form at `7159ff6330`: restoring the old pair changed detector
  **1 pass / 0 fail → 0 pass / 1 fail → 1 pass / 0 fail**, findings 0 → 1 → 0.
- Marketing at `7159ff6330`: restoring main's package pair changed detector
  **1 pass / 0 fail → 0 pass / 1 fail → 1 pass / 0 fail**, critical count 0 → 1 → 0.
  This used the working lock directly with `npm audit --package-lock-only
  --ignore-scripts --audit-level=high`, sanitized environment and empty npm configs;
  it did not use committed-blob `audit:locks` during mutation. Eight moderates remained.

Final restored SHA256:

```text
Cargo.lock: ff58b54103345b6410f656338e666e3d05431531ca8f10696f4105af50ebc095
marketing package.json: a2e94b691eef5edbca7dff08d96f2b504e26a19a17ae54ff498d2d69b1c32f8a
marketing package-lock.json: 2b19677e71fb4bfff6d9181ee3dee31945b1645655021dba7666e21e842d0872
```

## Review follow-up and raw output

Sol and Sonnet reviewed `ac61ffe78c52628ea2b5ce61150f826cc0df4cde`; no code blockers.
Sol requested raw output excerpts; Sonnet requested explicit URL-callsite review,
UX-076 merge confirmation, age alternatives and code/evidence identity verification.
This documentation follow-up resolves those requests; refreshed final-tip review
is still required before recording the verdict.

`rg` inspection found no direct native `.origin()` calls. `open_url` requires HTTPS
and rejects internal hosts; updater redirect validation requires HTTPS, its fixed
release host and raw path constraints; navigation guards compare explicit scheme
and host. Parent inspected these call sites and their existing fixture tests.
The already compiled candidate test binary was then run with only
`navigation_guard_tests::`; no GUI app or private state is used. These debug-build
checks are not release/platform-complete coverage. UX-071's hosted native coverage
and final exact-main installation checks remain required.

Actual log excerpts follow (verbatim except removal of terminal color codes):

Marketing `npm test`:

```text
# tests 51
# pass 51
# fail 0
```

Native `cargo test --locked --no-run`:

```text
    Finished `test` profile [unoptimized] target(s) in 46.23s
  Executable unittests src/main.rs (/Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/next-nov28/ux066-cookie/native-target/debug/deps/crystalball-113e99f55c337e4f)
  Executable tests/current_location_contract.rs (/Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/next-nov28/ux066-cookie/native-target/debug/deps/current_location_contract-f7aed1bb1f012790)
  Executable tests/imessage_contract.rs (/Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/next-nov28/ux066-cookie/native-target/debug/deps/imessage_contract-175e071711171e8c)
  Executable tests/notify_policy_contract.rs (/Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/next-nov28/ux066-cookie/native-target/debug/deps/notify_policy_contract-791ab7928a533dd9)
  Executable tests/sidecar_supervisor_contract.rs (/Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/next-nov28/ux066-cookie/native-target/debug/deps/sidecar_supervisor_contract-23139c7cddf7ffb7)
  Executable tests/updater_identity_contract.rs (/Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/next-nov28/ux066-cookie/native-target/debug/deps/updater_identity_contract-acc79d2dd1b90830)
  Executable tests/vault_coordinator_contract.rs (/Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/next-nov28/ux066-cookie/native-target/debug/deps/vault_coordinator_contract-587f4b7926fb461d)
  Executable tests/watchdog_contract.rs (/Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/next-nov28/ux066-cookie/native-target/debug/deps/watchdog_contract-4fc86207540ad06c)
```

Cookie default library tests:

```text
test result: ok. 21 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Cookie all-feature library tests:

```text
test result: ok. 37 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

URL baseline origin tests:

```text
test result: FAILED. 1 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

URL candidate origin tests:

```text
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Zizmor offline scan:

```text
 INFO audit: zizmor: 🌈 completed .github/workflows/accessibility.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/actionlint.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/auto-merge-agent-branches.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/auto-tag.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/auto-update-pr-branches.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/build-desktop.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/bundle-size.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/cleanup-stale-branches.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/cross-agent-review.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/dependency-change-gate.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/eslint.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/lint.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/pages.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/release-integrity.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/roadmap-controller.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/sast.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/secret-scan.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/security-audit.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/smoke.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/targeted-tests.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/test-linux-app.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/typecheck.yml
 INFO audit: zizmor: 🌈 completed .github/workflows/variant-e2e.yml
```

Navigation-only fixture execution:

```text
running 9 tests
test navigation_guard_tests::trusted_window_allows_loopback_dev_only_in_debug ... ok
test navigation_guard_tests::main_window_rejects_external_origin ... ok
test navigation_guard_tests::trusted_window_allows_tauri_scheme ... ok
test navigation_guard_tests::main_window_allows_tauri_scheme ... ok
test navigation_guard_tests::main_window_allows_localhost_dev_only_in_debug ... ok
test navigation_guard_tests::main_window_allows_windows_app_origin ... ok
test navigation_guard_tests::main_window_rejects_loopback_service ... ok
test navigation_guard_tests::trusted_window_allows_windows_app_origin ... ok
test navigation_guard_tests::trusted_window_rejects_external_origin ... ok

test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 108 filtered out; finished in 0.00s
```

## Review, delivery, manual verification and rollback

Fresh Sol and Sonnet review of the final evidence tip remains required. Preserve
actual conclusions externally, and record Sonnet's exact SHA-pinned verdict as the
only new tip before publication. Hosted CI must include both npm and Cargo audits,
even where branch protection does not require them. Preserve the old branch head,
publish with an explicit lease and use the matching-branch clean clone's
`pr-closeout.sh`; never bypass protected merging.

The user authorized safe merging and a new local Mac build. No public release,
deployment or destructive cleanup is authorized. Final exact-main app compilation,
stable signing, bundle/hash checks, installation and launch are still pending.
Manual acceptance must confirm the installed Crystal Ball source identity and
startup without reading private profile data. No GUI application, Keychain or
user storage was accessed during these tests. Moderate findings, full backlog
reconciliation and platform coverage remain open.

Revert this candidate's dependency changes to roll back, but that reintroduces
blocking vulnerabilities and must block delivery. No data migration requires undo.
Preserve the known previous installed bundle through the standard installer;
never weaken signing or audit checks to obtain a build.

Proposed commit: `docs: preserve fresh audit evidence before protected delivery`.
Proposed PR description: reconcile the reviewed Zizmor upgrade with three minimal
security repairs so the first merge passes current audits; preserve current clock
fixes and #1920 workflow, record age rationale and actual test/mutation evidence.
