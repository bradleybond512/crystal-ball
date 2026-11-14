# UX-070 — Dependency test coverage and bounded weekly runs

Status: design, draft claim and local implementation approved November 13;
claim publication and implementation pending.
Base: `5955a8d9860ad2f616008a3d738d423fbb8e5415`.

## Objective and evidence

Dependency-only changes must produce explicit test obligations, including on
fork PRs. Add runtime checks using each npm package's actual locked graph and
a bounded weekly run. Preserve existing tests, thresholds, source coverage,
review requirements and delivery settings.

Current inventory: 239 root `test:*` commands, 212 selector-eligible entries,
1,514 JS/TS test files, 22 browser specifications and 234 literal Rust test
declarations. These overlap and are not executed-case counts. Selecting every
eligible command would duplicate umbrella suites, run native builders and
still omit 27 excluded commands and important subproject tests.

The unchanged selector suite passed `# pass 85` / `# fail 0` under Node 22.23.1
with canonical `TMPDIR`. An initial run failed one temporary-path assertion
because macOS exposes both `/var` and `/private/var`; no source change was
needed. Historical CI evidence is from draft #1902 on November 11, not a fresh
complete sweep: renderer failed after 204 seconds and later Smoke stages did
not execute; the targeted job took 82 seconds but its Zizmor-specific selection
only took three. Neither measures full dependency coverage.

Inventory, source hashes, execution constraints and raw cost evidence are in
the local `next-nov13` evidence directory. The implementation PR must retain
a compact reproducible inventory and the actual execution receipts.

## Policy and execution

Keep normal source selection uncapped. Add mandatory dependency obligations
to the trusted selector, rather than candidate-owned override JSON. Existing
JSON-only obligations must become mandatory where applicable; candidate
mappings remain additive. Do not widen the selector's command grammar.

Resolve the trusted main revision once. Read policy, graph inventory and
commands from that revision, record its SHA and fail if mandatory policy is
unavailable. Never substitute candidate commands after a failed trusted read.
This is scoped protection for the new obligations, not a wholesale CI rewrite.

Recognize both manifests and locks for six npm graphs, Cargo manifests/locks,
workflow files, Node pins, Zizmor requirements, MCP configuration and vendored
marketing manifests. Use NUL-delimited changed paths, including both sides
of renames. Unknown dependency-bearing paths require a reviewed mapping and
fail classification; docs-only changes can still select nothing.

Use a small runner with fixed graph IDs and direct argument arrays, bounded
processes and receipts. No workflow input or candidate mapping may supply
arbitrary command strings. A reusable workflow gives each selected graph its
own disposable hosted checkout. Scheduled execution enumerates graphs
explicitly; an empty diff on main must not produce an empty successful run.

| Graph | Runtime obligation | Boundary |
| --- | --- | --- |
| Root | Existing mandatory suites, supply-chain/audit contracts and renderer suite | Node 22 and root lockfile; retain failures |
| MCP | Complete package suite and existing isolated boundary wrappers | Actual nested lockfile, temporary HOME/data, no live server or credentials |
| Marketing | Existing generation, typecheck, lint, build and build-backed tests | Disposable checkout; generated output never copied back |
| Scripts | AIS regression fixtures plus actual `ws` loopback exchange and offline Telegram session serialization | No authentication, Telegram connection or upstream request |
| cb-control | Actual storage SQLite persistence/FTS, local `ws` exchange and bounded PTY marker child | Temporary HOME and `CB_CONTROL_DIR` before import; no daemon, hooks, launchd or tmux session |
| Codex tools | Existing agentic/install/supply-chain guards and pinned CLI `--version` | Empty credential environment and temporary HOME; no model or auth request |

The AIS regression fixture copies a proxy implementation; it does not prove
the scripts graph's dependencies work. Read-only inspection fetched the locked
`better-sqlite3` 11.10.0 and `node-pty` 1.1.0 tarballs and verified both against
their exact lockfile SHA-512 values. No package scripts were executed.
Proposed preparation in disposable hosted Linux is:

```sh
npm --prefix tools/cb-control ci --ignore-scripts
npm --prefix tools/cb-control/node_modules/better-sqlite3 --ignore-scripts run build-release
npm --prefix tools/cb-control/node_modules/node-pty --ignore-scripts run install
```

The first explicit build target runs `node-gyp rebuild --release`, avoiding
the SQLite prebuild downloader. The PTY target checks local prebuilds, finds
none for Linux in the verified tarball, then runs `node-gyp rebuild`. Its
postinstall is unnecessary for Linux runtime. Explicit `npm run` targets run
with `--ignore-scripts`, while implicit pre/post lifecycle hooks stay disabled.
Require Node 22, Python 3, make, a C/C++20 compiler, Linux libutil headers and
PTY access. Node-gyp can fetch matching Node headers and checksums from
nodejs.org unless verified headers are already cached. Record setup receipts
and actual cold-run results; source inspection is not build success. No new
dependencies or broadly enabled lifecycle scripts are proposed.

Cargo retains audit/deny and selects existing pinning/build boundary
contracts. Report **Cargo runtime coverage pending UX-071**; source assertions
are not crate tests. Zizmor's independent audit remains in place. Browser
variants retain their current checks; broader scheduled browser coverage is
an explicit remaining item. No real application startup or user Keychain
access belongs in this run.

## Proposed schedule and resource limits

- Wednesday 03:23 UTC, plus manual execution.
- Six npm graph jobs and one fixture job, at most two running concurrently.
- Nineteen minutes per execution job including setup, three minutes for
  planning and four for aggregation: at most 140 runner-minutes per run.
- Ten minutes per test stage; 30 seconds per CLI probe. Native preparation
  must fit inside the job limit.
- Continue independent jobs after failures; one active scheduled run at a
  time, without canceling an active run for a new one.
- Seven-day retention for bounded logs and receipts.
- Preserve the current targeted job's 30-minute limit and all existing checks.

Record hosted Node, npm and node-gyp versions and verify explicit
`npm run --ignore-scripts` behavior there before native preparation; the
read-only lifecycle inspection used local tooling.

The fixture job includes `test:globe-overlay`, `test:finance`, `test:climate`,
`test:native-lows`, `test:advisor-json-extraction`, `test:angle-span-text`,
`test:spc-angle`, `test:foreign-mil-angle` and `test:dsca-angle`.
The SPC clock defect stays a failure until its repair is present; do not skip
it. Native wrappers that regenerate bundles or prune `dist` are excluded from
this fixture pool and require separate disposable native lanes.

These limits are proposed ceilings, not measured capacity. Completion requires
cold Linux execution of every admitted graph and a mixed dependency selection.
A timeout fails; it does not justify silently dropping tests or extending
budgets without review.

## Reporting, trust and rollout

Receipts record policy SHA, execution SHA, event, changed graphs, graph/stage
IDs, command ID, start time, duration, status, exit code and bounded log
artifact. Test receipts also record discovered files and executed cases.
Never invent counts for builds/lint or add overlapping suites into a unique
coverage total. Preserve inner execution evidence for wrapper tests.

Statuses are passed, failed, timed out and not executed. Missing receipts,
zero-case test execution, failure or timeout fail the aggregate check. Setup
failure lists later stages as not executed, while other graphs continue.

Use hosted runners, read-only repository permissions and no secrets, OIDC,
deployment environments or persisted checkout credentials. No candidate
execution through `pull_request_target`. Temporary HOME and loopback guards
reduce accidental access; they are not OS isolation. Do not upload environment
dumps, generated tokens or user-state caches.

Merging remains paused. Candidate policy can be exercised through an
explicitly labeled, unprivileged preview; it cannot yet be described as
trusted-main enforcement. A future separately authorized merge activates the
main policy. No fallback to candidate policy is allowed to hide this boundary.

## Tasks and validation

1. Security specialist: trusted graph classification and runner in selector
   and new bounded dependency runner files. Test all graphs, unknown/deleted/
   renamed paths, missing policy, candidate removal and hostile filenames.
2. Test engineer: actual scripts and cb-control dependency contracts, isolated
   state, bounded cleanup and offline/loopback behavior. Depends on agreed
   runner interface and reviewed native setup.
3. Security specialist: reusable/weekly workflows and aggregate receipts.
   Depends on runner; test missing execution, timeouts and setup failures.
4. Parent: current inventory, tracker, raw local/hosted validation and residual
   coverage holds. Claim only UX-070 in its own draft PR after approval.
5. Independent Sol and actual Sonnet reviewers: complete final diff and
   execution evidence, independently of implementation.

Run `test:agentic-pipeline`, `test:workflow-security`, `test:supply-chain-gates`,
`test:install-scripts`, `test:ux054` and the new policy/runner/runtime suites,
then `typecheck:all` and the full agentic gate naming those suites. Mutations
must remove graph obligations, substitute candidate policy, admit unknown
graphs, bypass timeout/missing-receipt guards and break each newly asserted
runtime behavior. Record actual red counts and restored checksums.

Governance-only checks are a smaller alternative but cannot establish runtime
compatibility. Full alias execution is broader yet misses graphs and mixes
unsafe environments. The proposed graph-specific approach makes both the
coverage and its limits visible.

Rollback removes the new schedule and policy only after review of the lost
coverage, preserving existing checks. There is no production data migration.
UX-070 stays open until approved jobs actually execute and failures are
resolved or explicitly handed off. Inventory and schedule enumeration alone
do not complete it.

Approved scope: this bounded policy, runtime tests, schedule/budgets,
documentation-only draft claim and local implementation. Code publication
remains a separate reviewed step. Merging, auto-merge, releases, deployment
and application installation stay paused.
