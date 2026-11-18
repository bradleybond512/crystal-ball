# UX-051 — total RSS request budget

November 17, 2026. Draft #1915. Implementation candidate:
`ccae02e82d365e4a5e0e63cd3d2321e955ff4b18`.

## Result and boundaries

RSS sidecar work shares one eight-second monotonic deadline across DNS,
redirects, headers and complete response bodies. Deadline expiration returns the
existing sanitized 504 response, allowing the renderer's existing fallback and
`unavailable` classification. Slow feeds can fail earlier than before. The
renderer retains its ten-second signal. Installed and live-network acceptance
remain open; UX-051 is not complete across all environments.

Only production file `src-tauri/sidecar/local-api-server.mjs` changes. Its RSS
operation owns its resolver and cancellation signal, checks late continuations,
and releases timers/listeners on completion. HTTP transport composes the caller
signal with its existing timer. RSS response writing checks client disconnects.
Authentication, CORS, per-hop SSRF validation, validated IPv4 pinning, original
hostname/TLS-name intent, quota handling and three-redirect maximum are retained.
No provider endpoint/schema, dependency, lockfile, persistence or renderer
production code changes. No live application, credentials or production storage
were used. Merging, auto-merge, releases, deployment and installation stay paused.

Tests are in `src-tauri/sidecar/__tests__/rss-request-budget.test.mjs` and the two
existing renderer suites `runtime-fetch-fallback.test.mts` and
`rss-adapters-tracked.test.mts`. Package and targeted-test mappings register
`test:ux051`; inventory assertions reflect the additional real sidecar test.

## Actual validation

The first HTTP body-cancellation test failed against the original implementation:

```text
# pass 0
# fail 1
```

Its actual operation remained pending after caller abort. Final focused command:

```sh
npm run test:ux051
```

The same three stages passed before their order was changed for selector
eligibility: sidecar/security/quota `# pass 82` / `# fail 0`, existing RSS routes
`# pass 18` / `# fail 0`, renderer `# pass 48` / `# fail 0`. The final gate reruns
all three in their registered order. New sidecar coverage is 19 tests within 82.

Additional executed commands passed: `npm run test:agentic-pipeline` (85/0),
`npm run test:sidecar-ci` (16/0), `npm run test:domain-retirement` (2/0 outer
orchestration tests with four child stages), `npm run test:roadmap-controller`
(135/0), `npm run typecheck:all`, `npm run sidecar:bundle-check`,
`node --check src-tauri/sidecar/local-api-server.mjs`, scoped ESLint and
`git diff --check` (each exit zero). Bundle output:

```text
[check-sidecar-bundle] OK — all 35 statically-imported sidecar .mjs modules are present in bundle.resources.
```

Strict selection lists 77 scripts, including `test:ux051`, with no unmapped
source paths. Selection is not execution of those 77 scripts. Hosted execution
of this implementation remains pending publication approval.

Full gate executed on the committed implementation:

```sh
bash scripts/agentic-validate.sh --tests "test:ux051 test:agentic-pipeline test:sidecar-ci test:domain-retirement test:roadmap-controller"
```

Actual excerpts in registered script order:

```text
# pass 48
# fail 0
# pass 82
# fail 0
# pass 18
# fail 0
# pass 85
# fail 0
# pass 16
# fail 0
# pass 2
# fail 0
# pass 135
# fail 0
Agentic validation gate passed.
Tests run: test:ux051 test:agentic-pipeline test:sidecar-ci test:domain-retirement test:roadmap-controller
```

Lockfile consistency, strict lint, both TypeScript configurations, secret scan,
cross-agent configuration, documentation, roadmap check and web build exited
zero. Existing build chunk and changelog-advisory warnings remain visible in the
raw log; no native build or application installation ran.

## Mutation evidence

Clean detached candidate: `ccae02e82d365e4a5e0e63cd3d2321e955ff4b18`. Each mutation was
applied separately, inspected as a nonempty saved diff, and restored to its
recorded SHA-256 with an empty scratch-tree status. All results below have zero
cancelled tests. Baselines: sidecar 19/0, renderer 48/0, inventory 16/0.

| Applied mutation | Suite | Baseline pass/fail → mutated pass/fail |
| --- | --- | --- |
| `deadline-timer-removed` | sidecar | 19/0 → 13/6 |
| `deadline-reset-per-hop` | sidecar | 19/0 → 18/1 |
| `deadline-boundary-exclusive` | sidecar | 19/0 → 18/1 |
| `dns-cancel-removed` | sidecar | 19/0 → 13/6 |
| `dns-late-A-continuation` | sidecar | 19/0 → 16/3 |
| `dns-late-cache-publication` | sidecar | 19/0 → 18/1 |
| `pending-stage-abort-race-removed` | sidecar | 19/0 → 9/10 |
| `body-budget-race-removed` | sidecar | 19/0 → 18/1 |
| `operation-signal-not-forwarded` | sidecar | 19/0 → 12/7 |
| `https-request-destroy-removed` | sidecar | 19/0 → 15/4 |
| `http-caller-signal-dropped` | sidecar | 19/0 → 17/2 |
| `timeout-classification-wrong` | sidecar | 19/0 → 18/1 |
| `normal-request-close-miswired` | sidecar | 19/0 → 7/12 |
| `socket-disconnect-ignored` | sidecar | 19/0 → 18/1 |
| `already-disconnected-ignored` | sidecar | 19/0 → 18/1 |
| `timer-cleanup-removed` | sidecar | 19/0 → 11/8 |
| `listener-cleanup-removed` | sidecar | 19/0 → 7/12 |
| `disconnected-writer-guards-removed` | sidecar | 19/0 → 18/1 |
| `pinned-address-dropped` | sidecar | 19/0 → 13/6 |
| `redirect-limit-shortened` | sidecar | 19/0 → 17/2 |
| `only-first-DNS-address-validated` | sidecar | 19/0 → 18/1 |
| `generic-error-privacy-removed` | sidecar | 19/0 → 18/1 |
| `rss504-cloud-fallback-denied` | renderer | 48/0 → 47/1 |
| `rss504-classified-as-timeout` | renderer | 48/0 → 47/1 |
| `sidecar-inventory-assignment-removed` | inventory | 16/0 → 14/2 |

Files mutated: `src-tauri/sidecar/local-api-server.mjs` for the 22 sidecar
controls, `src/services/runtime.ts` and `src/services/rss.ts` for renderer
regressions, and `package.json` for inventory assignment. Renderer production
files were mutated only in the detached fixture checkout, not in this change.

Original/restored SHA-256 values:

```text
ab08fae22bc4813f2177bccb0586e21fec2f68fd7e72f1e78d3c504df68833d0  src-tauri/sidecar/local-api-server.mjs
a21cf80c18a71b413a19e1f34787465d07acaf0a0b06145134872b2e4a911477  src/services/runtime.ts
15fc67655bb1e8d56015a9d98d069983ba29dc4fa4213bdceb9248a3d91e1639  src/services/rss.ts
06bd0a2b92f02dfd51cd9e1a66ec330682fc969a10359ef3d37de190c86d2d65  package.json
```

Raw `rss-mutations/results.json` names every applied `.diff`, red log, failing
assertion, changed checksum and restored checksum. Representative assertions:
deadline removal fails pending DNS/headers/body and real socket cancellation;
HTTP signal removal leaves operations pending; removed write guards attempt a
response after disconnect; inventory removal reports an unassigned real test.

Final whole-suite restoration passed: sidecar `# pass 19` / `# fail 0`,
renderer `# pass 48` / `# fail 0`, inventory `# pass 16` / `# fail 0`.
The final receipt reports `clean: true`; all four restored hashes match.

## Independent review

Sidecar specialist: zero blocking findings against production SHA-256
`ab08fae22bc4813f2177bccb0586e21fec2f68fd7e72f1e78d3c504df68833d0`.
Independent Sol (`gpt-6.1-sol`, medium): zero blocking findings against
`ccae02e82d365e4a5e0e63cd3d2321e955ff4b18`, independently ran 19/0 and audited
all 25 raw mutation receipts, applied diffs and restoration checksums.
The final documentation-tip addendum and required actual Sonnet review must
clear before recording the SHA-pinned verdict or requesting publication.
The verdict commit and external concluding outputs supply that final evidence;
this report alone is not a publication approval.

## Investigation history and test limits

The first expanded test run was 17/1 because its fake timer intercepted exactly
8000 rather than the monotonic fractional delay. Correcting that fixture produced
18/0; the subsequent pre-disconnected request case produced 19/0. A quota fixture
cleanup warning was removed by resetting the singleton before deleting its
temporary directory. The inventory initially reported 15/1: adding the test made
its exact count 67, not 66. Updating only the exact total and group size restored
16/0; complete-assignment and uniqueness checks remain intact.

A separate native-fetch-only streaming redirect probe failed 0/1 because an
unread redirect socket remained open after one second. That exploratory probe
replaced the shipped buffered HTTP implementation and did not prove activity
beyond eight seconds. Its complete test and red log are retained externally,
not counted as passing coverage or a fixed production defect. Review confirmed
the shipped transport buffers redirect bodies within the operation budget.

Real loopback sockets exercise production cancellation. The HTTPS request
adapter asserts original hostname, TLS-name intent, verification setting, IPv4
family and validated pin before using an owned HTTP socket. It proves request
destruction and socket closure, not a new TLS handshake/certificate-validation
test. Deterministic clocks exercise deadline boundaries. Cooperative event-loop
timers do not establish hard real-time delivery; discovery/authentication and
serialization can consume nominal renderer headroom. Cloud fallback can outlast
local work. No live-provider latency distribution or installed-runtime claim.

## Hosted claim and unresolved dependency audit

Documentation claim `f4d7639639e99e2fa8059201aaaa251a38052abc` completed 13 successful
workflows and one failure: Security Audit. This is claim CI, not implementation
CI. Audit run 44228342001 / job 134546956942 reported on November 18 UTC:
root 12 high / 0 critical; marketing 14 high / 1 critical. The other four npm
projects had no high/critical findings. These findings remain open; this task
changes no dependency or lockfile and does not lower the audit threshold.

## Verification and rollback

After separate publication approval, check all hosted jobs against the final
implementation tip. Future authorized runtime verification should exercise a
normal feed, slow DNS, redirect chains, stalled headers, trickling bodies and a
closed renderer request, checking sanitized timeout/fallback behavior and no
remaining upstream work. Installation and live testing remain paused.

Rollback reverts the focused implementation and its test wiring, restoring the
known longer per-hop budgets; no migration or stored-state conversion is needed.
Proposed implementation commit: `Stop RSS work before the renderer deadline`.
Draft summary: bound local RSS work to eight seconds while preserving existing
security and fallback behavior; fixture acceptance only, dependency audit and
installed/live acceptance remain open.

Raw logs, exploratory disposition and review receipts are retained under the
task artifact directory `next-nov17b/` in the current Codex visualization folder.
