# UX-047 national warning lifecycle — validation evidence

Risk tier: High. Initial checkpoint: `437ae954165402a1e938dead647e88cf5a2edabf`.
Reviewed repair checkpoint: `3a0e4df42e3f33c22cd455acaa966551bbff7d3d`.
Draft claim: #1844. Human design/implementation approval: November 2, 2026 UTC.

This report records the initial lifecycle checkpoint. The [native follow-up](UX-047-FALLBACK-PORTS.md) records the subsequent port-collision repair and acceptance results.

## User-visible behavior and architecture

National NWS snapshots refresh every five minutes in the full variant even when
the NWS panel is absent. The existing scheduler retains its hidden-window network
pause/resume behavior. Complete national membership is separate from retained
history: warnings retire on authoritative absence and expire offline, across
restart, while acknowledgment, pin, snooze and historical evidence survive.

Web and desktop share a bounded, validated backend adapter. The renderer has an
independent boundary validator, a typed complete-snapshot contract and a new
versioned offline cache key. The store persists validated source membership and
an observation watermark in optional v2 metadata. Operational panels, native
indicators and pending digests exclude inactive NWS rows. Historical/model
consumers retain their existing history view. No dependency or notification
policy was changed. Issued uses sent time; Starts shows onset separately.

Affected modules: API/NWS sidecar helper and route, renderer snapshot/client/cache,
unified store and NWS lifecycle/normalizer, App scheduler/data loader, NWS panel,
TriageBar/SummaryStrip/sidebar heat, native menubar/dock, digest/reactions, packaged-resource
registration, focused/browser tests, test routing and roadmap/design evidence.

## Exact validation commands and results

All npm commands used Node 22.23.3 from the existing dependency-repair runtime.
Canonical TMPDIR was supplied to pipeline tests to avoid the macOS /var alias.
Full output is retained under the local `ux047-validation` artifact directory.

```sh
E2E_PORT=4198 VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:ux047 test:ux047-browser test:ux059 test:acc509 test:alert-capacity test:warning-delivery test:ux026 test:weather test:storm-alert-source-revision test:review-trail test:panels:fixtures"
```

Exit 0. Actual output, grouped by named script:

| Command | Quoted output |
| --- | --- |
| `npm run test:ux047` | `# pass 119` / `# fail 0` |
| `npm run test:ux047-browser` | `4 passed (10.8s)` |
| `npm run test:ux059` | `# pass 32` / `# fail 0` |
| `npm run test:acc509` | `# pass 124` / `# fail 0` |
| `npm run test:alert-capacity` | `# pass 11` / `# fail 0` |
| `npm run test:warning-delivery` | `# pass 20` / `# fail 0` |
| `npm run test:ux026` | `# pass 125` / `# fail 0` |
| `npm run test:weather` | `# pass 411` / `# fail 0` |
| `npm run test:storm-alert-source-revision` | `# pass 8` / `# fail 0` |
| `npm run test:review-trail` | `# pass 24` / `# fail 0` |
| `npm run test:panels:fixtures` | `# pass 16` / `# fail 0` |
| `npm run test:api` | `# pass 266` / `# fail 0` |
| `npm run test:sidecar` | `# pass 664` / `# fail 0` |
| `npm run test:agentic-pipeline` | `# pass 77` / `# fail 0` |
| `npm run test:sidecar-ci` | `# pass 13` / `# fail 0` |
| `npm run test:domain-retirement` | outer `# pass 2` / `# fail 0`; inner stages `"pass":135`, `"pass":39`, `"pass":3`, `"pass":248`, each `"fail":0` |
| `npm exec -- tsx --test src/app/__tests__/refresh-scheduler-throttle.test.mts tests/flush-stale-refreshes.test.mjs` | `# pass 13` / `# fail 0` |

The gate ran lockfile checks, strict lint, application/API typechecks, secret
scan, cross-agent tooling checks, docs, roadmap and build. Actual final output:

```text
Secret scan passed for 5757 file(s).
Agentic validation gate passed.
```

Scoped ESLint passed on all 30 changed JS/TS/MTS source/test targets. An additional
post-sync `npm run build` exited 0 with `✓ built in 15.59s`. Packaging check:

```text
[check-sidecar-bundle] OK — all 29 statically-imported sidecar .mjs modules are present in bundle.resources.
```

Initial failures and repairs are retained: broad sidecar isolation omitted the
untracked new helper (192 pass / 17 fail), then passed 664/0 once the helper was
staged; strict ESLint found three lifecycle style errors, repaired without
behavior change; the secret scanner rejected a static synthetic test token,
replaced with a per-test generated token without weakening the scanner.
Build output includes module-extension/chunk-size/plugin timing warnings; no
threshold was weakened or warning suppressed. Browser runs report the existing
Node color/experimental API warnings.

After the reaction repair, this affected gate also exited 0:

```sh
E2E_PORT=4198 VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:ux047 test:warning-delivery test:ux026 test:agentic-pipeline"
```

Actual counts: focused `# pass 124` / `# fail 0`; delivery `# pass 20` /
`# fail 0`; UX026 `# pass 125` / `# fail 0`; pipeline `# pass 77` / `# fail 0`.
The gate again completed strict lint, application/API typechecks, secret scanning,
docs/roadmap and the production build with `Agentic validation gate passed.`

## Live source-body evidence

Request: `https://api.weather.gov/alerts/active?status=actual&message_type=alert,update`.
Consumed fields: feature type/geometry; properties ID, event, headline,
description, severity, urgency, areaDesc, sent, onset, expires, status and
messageType. Top-level type/features and continuation absence are validated.
References were counted for discovery but are not consumed as lifecycle authority.

Three body samples at 03:26:58, 03:27:04 and 03:27:11 UTC each had 428 rows and
2,054,330 bytes, 89 Polygon/339 null geometries, 89 rings and 1,035 vertices.
Minor, Unknown and Future values were present. No pagination field appeared.
These identical short-interval samples do not establish a tail distribution.
8 MiB/2,000 rows and existing geometry budgets are resource caps: exceeding them
fails closed, rather than truncating a response and claiming completeness.

The implemented adapter was probed at 03:57:08 UTC: 430 upstream rows became
430 backend, 430 renderer and 430 lifecycle rows; zero dropped rows; original
observation time preserved. 344 rows had null geometry and 182 onset after sent.
The aggregate receipt and exact read-only probe are retained in `ux047-provider`.

## Review and mutation proof

Provider/sidecar review found no remaining blockers after correcting health-source
classification and aligning temporal/ID/metadata admission before successful
cache writes. The reviewer independently ran provider 25/0, renderer 39/0 and
packaging checks. Two additional renderer byte-limit tests subsequently passed,
bringing that suite to 41/0.

Full independent review identified one P2: retained warnings could trigger
initial reactions or a delayed critical reminder after retiring. Two operational
eligibility checks repaired it; five behavior cases preserve active/non-NWS,
acknowledgment, channel, threshold and timing controls. Actual red `# pass 15` /
`# fail 2` became `# pass 17` / `# fail 0`.

Independent re-review at `3a0e4df42e3f33c22cd455acaa966551bbff7d3d`
concluded: "No blocking findings in code or local evidence" after auditing all
57 mutation proofs against committed contents. One full independent repair cycle
was required. The required separate Sonnet conclusion belongs in the final
SHA-pinned `.agentic/reviews` verdict commit; this report is not that verdict.

[Machine-readable mutation evidence](UX-047-MUTATIONS.json) includes the actual
applied diff, failing assertion excerpt, command, baseline/red counts, full
before/restored SHA256 and clean-state receipts for every mutation. Root and
independent reviewer checked every source checksum against the committed bytes.
The initial 13 proofs at the earlier checkpoint were archived, then all cases
were rerun uniformly at the repaired checkpoint. Equal-snapshot conflict and
health-source classification received separate mutants to avoid masking one
invariant behind another failing assertion. No mutant survived; no syntax/import
failure was counted as behavioral proof.

### Per-behavior mutation results

Checkpoint: 3a0e4df42e3f33c22cd455acaa966551bbff7d3d. 57 independent mutants produced meaningful behavior failures. Every target was restored to its original SHA256 with an empty working tree.

| ID | Source | Baseline pass/fail | Mutated pass/fail | Verified invariant |
| --- | --- | --- | --- | --- |
| P01 | src-tauri/sidecar/nws-alert-snapshot.mjs | 25/0 | 22/3 | Complete national membership on web and desktop |
| P02 | src-tauri/sidecar/nws-alert-snapshot.mjs | 25/0 | 22/3 | Reject continuation and partial metadata |
| P03 | src-tauri/sidecar/nws-alert-snapshot.mjs | 25/0 | 24/1 | Reject over-cap complete national membership |
| P04 | src-tauri/sidecar/nws-alert-snapshot.mjs | 25/0 | 24/1 | Malformed normalized enum cannot populate healthy success cache |
| P05 | src-tauri/sidecar/nws-alert-snapshot.mjs | 25/0 | 23/2 | Provider cache preserves acquisition timestamp |
| P06 | src-tauri/sidecar/nws-alert-snapshot.mjs | 25/0 | 24/1 | Retry-After suppresses premature retries |
| P07 | src-tauri/sidecar/nws-alert-snapshot.mjs | 25/0 | 24/1 | Bounded provider deadline contract and recovery |
| P08 | src-tauri/sidecar/local-api-server.mjs | 25/0 | 24/1 | Desktop health reflects successful acquisition rather than cached delivery |
| P08b | src-tauri/sidecar/local-api-server.mjs | 25/0 | 23/2 | Desktop health uses recognized primary source rather than unrecognized national scope |
| P09 | src-tauri/sidecar/nws-alert-snapshot.mjs | 25/0 | 20/5 | Provider temporal validity: sent, acquisition and expiry |
| P10a | src-tauri/sidecar/nws-alert-snapshot.mjs | 25/0 | 24/1 | Provider identity bound |
| P10b | src-tauri/sidecar/nws-alert-snapshot.mjs | 25/0 | 24/1 | Provider lifecycle metadata byte bound |
| P11 | src/services/nws-alert-snapshot.ts | 41/0 | 39/2 | Renderer retrieval provenance is upstream acquisition time |
| P12 | src/services/nws-alert-snapshot.ts | 41/0 | 37/4 | Renderer temporal validity matches lifecycle boundary |
| P13a | src/services/nws-alert-snapshot.ts | 41/0 | 40/1 | Renderer identity bound |
| P13b | src/services/nws-alert-snapshot.ts | 41/0 | 40/1 | Renderer lifecycle metadata byte bound |
| P14 | src/services/nws-alert-snapshot.ts | 41/0 | 40/1 | Renderer cannot admit future observations that lifecycle rejects |
| P15a | src/services/nws-alerts.ts | 41/0 | 40/1 | Renderer rejects finite declared oversized bodies |
| P15b | src/services/nws-alerts.ts | 41/0 | 40/1 | Renderer rejects finite streamed oversized bodies and recovers |
| L01 | src/services/unified-alerts.ts | 15/0 | 14/1 | Persisted older-watermark rejection |
| L02 | src/services/unified-alerts.ts | 15/0 | 14/1 | Equal membership is a silent idempotent no-op |
| L02b | src/services/unified-alerts.ts | 15/0 | 14/1 | Equal observation with conflicting membership is rejected |
| L03 | src/services/unified-alerts.ts | 15/0 | 13/2 | Durable national retirement watermark |
| L04 | src/services/unified-alerts.ts | 15/0 | 14/1 | Full national metadata survives retained-row cap |
| L05 | src/services/unified-alerts.ts | 4/0 | 2/2 | Offline expiry notifies real renderer and store subscribers |
| L06 | src/services/unified-alerts.ts | 15/0 | 14/1 | Expired and retired NWS replay cannot be newly dispatched |
| L07 | src/services/alert-normalizer.ts | 15/0 | 7/8 | Issued chronology uses sent independently of future onset |
| L08 | src/services/unified-alerts.ts | 15/0 | 14/1 | Verified sent chronology replaces old onset-based chronology |
| L09 | src/services/unified-alerts.ts | 15/0 | 14/1 | Legacy trusted expiry still drives local invalidation |
| L10 | src/services/unified-alerts.ts | 15/0 | 14/1 | Lifecycle teardown and resume cannot lose expiry delivery |
| L11 | src/services/nws-alert-lifecycle.ts | 15/0 | 14/1 | Oversized persisted metadata cannot create trusted membership |
| L12 | src/services/unified-alerts.ts | 15/0 | 14/1 | Verified refresh preserves no-repeat dispatch identity |
| U01 | src/services/nws-alert-snapshot-cache.ts | 20/0 | 19/1 | Backend/cache hits cannot renew acquisition age |
| U02a | src/services/nws-alert-snapshot-cache.ts | 20/0 | 19/1 | National envelope cache has separate legacy namespace |
| U02b | src/services/offline-alert-cache.ts | 20/0 | 19/1 | Critical offline status tracks versioned national cache |
| U03 | src/app/data-loader.ts | 20/0 | 19/1 | Offline snapshots never reconcile national authority |
| U04 | src/app/data-loader.ts | 20/0 | 18/2 | Older snapshots cannot clear newer storm context |
| U05 | src/app/data-loader.ts | 20/0 | 19/1 | Older persisted cache cannot overwrite newer in-memory snapshot |
| U06a | src/app/data-loader.ts | 20/0 | 17/3 | Failed acquisition degrades existing warning display |
| U06b | src/app/data-loader.ts | 20/0 | 19/1 | Expiry cannot certify a fresh complete empty national snapshot |
| U07 | src/app/data-loader.ts | 20/0 | 19/1 | Async ancillary completion cannot restore retired warnings |
| U08 | src/App.ts | 4/0 | 3/1 | Actual five-minute scheduler remains independent of panel presence |
| U09 | src/components/NWSAlertsPanel.ts | 20/0 | 19/1 | Only current complete empty can claim all-clear |
| U10 | src/components/NWSAlertsPanel.ts | 20/0 | 18/2 | Issued and Starts columns remain distinct |
| C01 | src/components/TriageBar.ts | 17/0 | 16/1 | src/components/TriageBar.ts excludes retired warning history |
| C02 | src/components/SummaryStrip.ts | 17/0 | 16/1 | src/components/SummaryStrip.ts excludes retired warning history |
| C03 | src/services/sidebar-heat.ts | 17/0 | 16/1 | src/services/sidebar-heat.ts excludes retired warning history |
| C04 | src/services/native/menubar-status.ts | 17/0 | 15/2 | src/services/native/menubar-status.ts excludes retired warning history |
| C05 | src/services/native/dock-badge.ts | 17/0 | 16/1 | src/services/native/dock-badge.ts excludes retired warning history |
| C06 | src/services/notification-digest.ts | 17/0 | 15/2 | src/services/notification-digest.ts excludes retired warning history |
| C07 | src/services/native/menubar-status.ts | 17/0 | 15/2 | Hidden menubar updates without animation frame |
| C08 | src/services/native/menubar-status.ts | 17/0 | 16/1 | Stale menubar callbacks cannot affect stopped/restarted service |
| C09 | src/services/notification-digest.ts | 17/0 | 16/1 | Digest removes queued retired warnings before summary |
| C10 | src/services/notification-digest.ts | 17/0 | 15/2 | Digest rechecks retirement after async summary before delivery |
| C11 | src/services/notification-digest.ts | 17/0 | 16/1 | Lifecycle refresh prunes retired pending digest warnings |
| C12 | src/services/alert-reactions.ts | 17/0 | 16/1 | Initial alert-reaction subscription excludes already-retired warnings |
| C13 | src/services/alert-reactions.ts | 17/0 | 16/1 | Five-minute delayed re-escalation rechecks operational eligibility |

Full applied diffs, actual assertion excerpts, commands, source hashes and clean states are in UX-047-MUTATIONS.json. Full individual logs remain in the mutation artifact directory.

Native packaged/WKWebView runtime remains unverified; no installed app or production storage was accessed.

## Restored validation

Restored final verification (all exit 0):

```text
npm run test:ux047
# tests 124
# pass 124
# fail 0

E2E_PORT=4197 VITE_VARIANT=full npm run test:ux047-browser
4 passed (13.4s)

npm run typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
```

After the last health-source mutant, the restored provider suite again reported
`pass 25` / `fail 0`. All earlier full checks apply to identical restored bytes.

## Checks not run and remaining limits

Actual packaged WKWebView offline/restart acceptance has not been run. Chromium
uses synthetic isolated browser storage and blocked external requests; native
consumer tests exercise IPC payload behavior but do not establish installed-app
runtime behavior. CI has not run on these local implementation commits; draft #1844 currently
contains the claim only. No installation, release, merge or production-data
mutation was performed. Native acceptance remains a delivery gate.

## Manual verification and rollback

Before delivery, use an isolated packaged native test profile to verify national
counts above 100, panel-hidden five-minute refresh, network loss/expiry, restart,
older cache rejection, acknowledgment/pin/snooze retention and issued/start labels.
Confirm a failed or partial provider response displays stale/unavailable and a
validated empty live response alone displays no active warnings. Do not use
production storage for synthetic warning injection.

Rollback must revert the provider/client contract, source lifecycle and its
consumers together. Optional v2 source metadata and the separate cache namespace
leave historical records intact. An old build cannot promise anti-resurrection
semantics; roll forward to the validated build before relying on that behavior.

Proposed commit: `Keep national warnings current across refresh and restart`.
Draft PR description: Complete national NWS snapshots refresh every five minutes
and retire/expire operational warnings across offline periods and restarts while
preserving history and user state. Validation, mutation/review evidence and
native-runtime limitations are recorded here. Keep delivery paused until the
remaining acceptance and authorization gates are satisfied.

## QA/QC release stance

Local code and evidence review: no unresolved blocking finding. Checks passed:
focused/regression/browser tests, mutation proofs, types, lint, secret scanning,
packaging-resource validation and production build. Checks not run: packaged
WKWebView runtime acceptance and GitHub CI for the local implementation tip.
Residual risk: native offline/restart behavior remains unverified; feed bounds
are resource caps, not an empirically proven maximum national incident load.
No residual risk has been accepted as permission to deliver. Release stance:
keep the task in progress and the PR draft until native acceptance and required
publication/delivery approvals are satisfied.
