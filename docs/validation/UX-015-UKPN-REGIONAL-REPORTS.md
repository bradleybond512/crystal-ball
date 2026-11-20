# UX-015 — bounded UKPN regional incident reports

November 19, 2026 (America/Chicago). [Draft #1919](https://github.com/bradleybond512/crystal-ball/pull/1919).
[Approved design](../plans/2026-11-19-ux015-ukpn-design.md).

## Outcome and acceptance boundary

Grid → Outages gains a separate **UK Power Networks regional reports — not
selected-place coverage** section. Only validated Unplanned records appear;
reported zero remains zero. Empty, stale, unavailable and incomplete responses
remain explicit. UKPN does not change ODIN county evidence, maps, headline
counts, notifications or fusion votes. Real-world coverage is always partial.

Local implementation and fixture evidence do not complete UX-015 acceptance.
The final live provider attempt encountered 101 records, above the approved cap,
and correctly contributed no incidents. Current positive live coherence,
sustained-feed and installed-app acceptance remain open. No app was launched
or installed. Merging, auto-merge, releases, deployment and installation remain
paused. Implementation publication requires separate approval.

## Architecture and files

- `src-tauri/sidecar/ukpn-live-faults.mjs`: fixed HTTPS endpoints, metadata/records/
  metadata coherence, allowlisted projection, one shared acquisition, eight-second
  body-inclusive deadline, 64 KiB/512 KiB caps, 60-second validated cache and
  publication-bound 15-minute expiry. Settled acquisitions abort remaining
  transport work, including unread streaming error responses.
- `api/ukpn-outages.js` and `src-tauri/sidecar/local-api-server.mjs`: existing
  web/local boundaries, no caller URL/query, bounded normalized degraded states.
  Local feed success requires fresh nonempty adapter output and uses publication
  time. `src-tauri/tauri.conf.json` bundles the shared module.
- `src/services/infrastructure/ukpn-outages.ts`: strict renderer contract;
  `grid-intelligence-loader.ts`: independent polling, cancellation, generation
  guard, atomic replacement, exact expiry and teardown;
  `src/components/GridIntelligencePanel.ts`: escaped, attributed regional list,
  distinct publication/retrieval times, deferred tab handlers and focus retention.
- Feed catalog, focused tests, additive selection mappings and sidecar test
  inventory connect the new behavior to existing diagnostics and CI. No added
  dependency, secret, CSP/native permission, persisted schema or alert policy.

## Executed validation

Commands used Node 22 and disposable test HOME/data directories with loopback-only
network guards. Existing dependency directories were reused; the MCP lockfile
matched SHA-256 `5e3a0af29db28e437c3e27c3f2584f97f097b08dc78b2428fe76dfdbb0a8c6a4`.

| Command | Actual output |
| --- | --- |
| `npm run test:ukpn` | `# pass 35`, `# fail 0`; `# pass 37`, `# fail 0` |
| `npm run test:lifelines-grid` | `# pass 99`, `# fail 0`; `# pass 139`, `# fail 0` |
| `npm run test:agentic-pipeline` | `# pass 85`, `# fail 0` |
| `npm run test:roadmap-controller` | `# pass 135`, `# fail 0` |
| `npm run typecheck:all` | `tsc --noEmit && tsc --noEmit -p tsconfig.api.json`, exit 0 |
| `npm run sidecar:bundle-check` | `OK — all 36 statically-imported sidecar .mjs modules are present in bundle.resources.` |
| `bash scripts/agentic-validate.sh --tests "test:ukpn test:lifelines-grid test:agentic-pipeline test:roadmap-controller"` | `Agentic validation gate passed.` |

The gate executed the listed tests, lockfile, strict lint, both type checks,
secret scan, cross-agent metadata, documentation/roadmap checks and build.
The initial secret scan correctly rejected a synthetic token lacking the
standard test marker; the fixture was renamed without changing scanner rules.
Scoped ESLint also required test-only nesting/await cleanup. Existing build
warnings were retained, not suppressed. Commit hooks additionally ran 723 tests:
`# pass 723`, `# fail 0`.

Strict selection mapped 103 scripts with no unmapped source. The first broad
run passed 96 and reported seven failed scripts. After the recorded corrections,
all 103 selected scripts have passing execution evidence; this is an initial
run plus targeted reruns, not a claim that the original command exited zero.

- `test:desktop-identity`: missing `rustc` in isolated PATH; rerun with the
  existing Rust 1.93.1 binary passed `# pass 46`, `# pass 15`, `# pass 24`,
  each with `# fail 0`.
- `test:health-contract`, `test:mcp-companion`, `test:mcp-untrusted`: missing
  existing MCP dependencies in the new checkout; reused the matching locked
  dependency directory. Isolated reruns passed outer `# pass 2`, `# pass 10`,
  `# pass 1`, respectively, each with `# fail 0` and positive inner execution.
- `test:sidecar-ci`: genuine missing UKPN test assignments and stale exact
  inventory counts; added both files to the existing sidecar group without
  changing workflows or loosening coverage. Final Node 22 isolated execution:
  outer `# pass 16`, `# fail 0`; inner 515/0 and 35/0. The expanded existing
  `test:sidecar` also passed `# pass 754`, `# fail 0`.
- `test:ux010`, `test:vault-writer`: missing `cargo` in isolated PATH; reran
  with the installed compiler and offline cached registry in disposable HOME,
  Cargo configuration and build-target directories. `RESULT test:ux010 0`
  (groups 5/0, 36/0, native wrapper 1/0); `RESULT test:vault-writer 0`
  (9/0 and 4/0; Rust output `test result: ok. 45 passed; 0 failed;`).
  No application launch, installation or real Keychain access occurred.

The final inventory gate uses
`bash scripts/agentic-validate.sh --tests "test:ukpn test:sidecar-ci test:agentic-pipeline test:roadmap-controller"`.
Its first documentation check found one extra blank line in this report; that
formatting was fixed without changing validation rules.

## Mutation evidence

Initial clean source `4752285e5148c951811cc3b92227247486e59dec`: 53 experiments,
49 detecting proofs, three retained survivors and one terminated assertion-formatting
worker excluded. Supplementary clean source `9ebc979d1ec0e519c54fe6323092f7a169c19622`:
six detecting proofs. Across those runs, all 52 new test cases were observed red.
The only production delta between sources is the separately proven final transport
abort; exact reconciliation diff is retained.

| Applied mutation | Mutated file | Before pass/fail | Red pass/fail | Outcome |
| --- | --- | --- | --- | --- |
| initial: provider-zero | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 9/10 | detected |
| initial: provider-status | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 18/1 | detected |
| initial: provider-invalid-row | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 17/2 | detected |
| initial: provider-duplicate | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 18/1 | detected |
| initial: provider-version | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 18/1 | detected |
| initial: provider-total | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 18/1 | detected |
| initial: provider-publication | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 15/4 | detected |
| initial: provider-future | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 18/1 | detected |
| initial: provider-fixed-transport | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 17/2 | detected |
| initial: provider-cache-ttl | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 18/1 | detected |
| initial: provider-invalid-cache | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 18/1 | detected |
| initial: provider-body-cap | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 18/1 | detected |
| initial: provider-deadline | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 16/3 | detected |
| initial: provider-shared-detach | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 18/1 | detected |
| initial: provider-last-cancel | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 18/1 | detected |
| initial: provider-reset | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 18/1 | detected |
| initial: provider-preabort | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 17/2 | detected |
| initial: provider-elapsed | `src-tauri/sidecar/ukpn-live-faults.mjs` | 19/0 | 18/1 | detected |
| initial: edge-query | `api/ukpn-outages.js` | 19/0 | 18/1 | detected |
| initial: edge-no-store | `api/ukpn-outages.js` | 19/0 | 17/2 | detected |
| initial: edge-unavailable-status | `api/ukpn-outages.js` | 19/0 | 18/1 | detected |
| initial: native-auth | `src-tauri/sidecar/local-api-server.mjs` | 15/0 | 14/1 | detected |
| initial: native-query | `src-tauri/sidecar/local-api-server.mjs` | 15/0 | 14/1 | detected |
| initial: native-publication-health | `src-tauri/sidecar/local-api-server.mjs` | 15/0 | 13/2 | detected |
| initial: native-empty-health | `src-tauri/sidecar/local-api-server.mjs` | 15/0 | 6/9 | detected |
| initial: native-stale-expiry | `src-tauri/sidecar/ukpn-live-faults.mjs` | 15/0 | 13/2 | detected |
| initial: native-redirect | `src-tauri/sidecar/ukpn-live-faults.mjs` | 15/0 | 15/0 | survived |
| initial: native-quota | `src-tauri/sidecar/local-api-server.mjs` | 15/0 | 14/1 | detected |
| initial: native-caps | `src-tauri/sidecar/local-api-server.mjs` | 15/0 | 11/4 | detected |
| initial: native-bundle | `src-tauri/tauri.conf.json` | 15/0 | 14/1 | detected |
| initial: native-shared-detach | `src-tauri/sidecar/ukpn-live-faults.mjs` | 15/0 | 14/1 | detected |
| initial: native-socket-cancel | `src-tauri/sidecar/local-api-server.mjs` | 15/0 | 15/0 | survived |
| initial: renderer-zero | `src/services/infrastructure/ukpn-outages.ts` | 16/0 | 9/7 | detected |
| initial: renderer-scope | `src/services/infrastructure/ukpn-outages.ts` | 16/0 | 15/1 | detected |
| initial: renderer-counts | `src/services/infrastructure/ukpn-outages.ts` | 16/0 | 15/1 | detected |
| initial: renderer-id-limit | `src/services/infrastructure/ukpn-outages.ts` | 16/0 | 15/1 | detected |
| initial: renderer-expiry | `src/services/infrastructure/ukpn-outages.ts` | 16/0 | 13/3 | detected |
| initial: renderer-timestamp | `src/services/infrastructure/ukpn-outages.ts` | 16/0 | 16/0 | survived |
| initial: renderer-empty | `src/services/infrastructure/ukpn-outages.ts` | 16/0 | 15/1 | detected |
| initial: renderer-unavailable | `src/services/infrastructure/ukpn-outages.ts` | 16/0 | 15/1 | detected |
| initial: renderer-provider-parity | `src-tauri/sidecar/ukpn-live-faults.mjs` | 16/0 | 15/1 | detected |
| initial: loader-poll | `src/services/infrastructure/grid-intelligence-loader.ts` | 16/0 | 15/1 | detected |
| initial: loader-expiry | `src/services/infrastructure/grid-intelligence-loader.ts` | 16/0 | 15/1 | detected |
| initial: loader-replacement | `src/services/infrastructure/grid-intelligence-loader.ts` | 16/0 | 14/2 | detected |
| initial: loader-error-body | `src/services/infrastructure/grid-intelligence-loader.ts` | 16/0 | 15/1 | detected |
| initial: loader-generation | `src/services/infrastructure/grid-intelligence-loader.ts` | 16/0 | 15/1 | detected |
| initial: loader-stop-abort | `src/services/infrastructure/grid-intelligence-loader.ts` | 16/0 | 15/1 | detected |
| initial: panel-escaping | `src/components/GridIntelligencePanel.ts` | 16/0 | 13/1 | terminated; excluded |
| initial: panel-stale | `src/components/GridIntelligencePanel.ts` | 16/0 | 15/1 | detected |
| initial: panel-debounce-wiring | `src/components/GridIntelligencePanel.ts` | 16/0 | 15/1 | detected |
| initial: panel-focus | `src/components/GridIntelligencePanel.ts` | 16/0 | 15/1 | detected |
| initial: panel-headline | `src/components/GridIntelligencePanel.ts` | 16/0 | 15/1 | detected |
| initial: catalog-identity | `src/services/diagnostics/feed-catalog.ts` | 21/0 | 20/1 | detected |
| supplement: cleanup-finally-abort | `src-tauri/sidecar/ukpn-live-faults.mjs` | 20/0 | 19/1 | detected |
| supplement: native-effective-redirect | `src-tauri/sidecar/ukpn-live-faults.mjs` | 15/0 | 14/1 | detected |
| supplement: native-effective-cancel | `src-tauri/sidecar/local-api-server.mjs` | 15/0 | 14/1 | detected |
| supplement: renderer-calendar | `src/services/infrastructure/ukpn-outages.ts` | 16/0 | 15/1 | detected |
| supplement: panel-escaping | `src/components/GridIntelligencePanel.ts` | 16/0 | 15/1 | detected |
| supplement: catalog-removal | `src/services/diagnostics/feed-catalog.ts` | 21/0 | 20/1 | detected |

Redirect-mode and socket-only cancellation mutations survived because independent
guards still rejected/cancelled. Supplementary proofs remove the effective response
rejection and both cancellation subscriptions. The malformed-calendar fixture was
strengthened to avoid an independently invalid expiry. An escaping assertion now
compares boolean absence, avoiding unbounded HappyDOM object formatting on failure.
These corrections preserve the original three survivors and interrupted run; they
are not retrospectively counted as successful detections.

Each applied diff is nonempty and retained with actual failing assertion output.
Every source checksum matched after restoration and each scratch tree was clean.
Final restored groups: provider/edge `20 pass / 0 fail`, native `15 pass / 0 fail`,
renderer/Grid `16 pass / 0 fail`, catalog `21 pass / 0 fail`. Per-experiment JSON
records before/restored SHA-256, diff hash, counts and assertion names.

Final source SHA-256 checksums:

- `src-tauri/sidecar/local-api-server.mjs`: `5cdc3d36afd24b344977e44b75b429a1ab75a9890817e7da7e5d36779a324504`.
- `src-tauri/sidecar/ukpn-live-faults.mjs`: `0971aee68334bea76302454cd316c02ccf42daad15a8e984926aba7acd295ba3`.
- `src/components/GridIntelligencePanel.ts`: `93d5d9c321cbd0f57250d06dbf3541a3363cea7d513c7023577307e79685f638`.
- `src/services/diagnostics/feed-catalog.ts`: `701882e70b959a7953f05b8c9974797840c1f023c436943f4f9876bf1909441a`.
- `src/services/infrastructure/ukpn-outages.ts`: `4f4898ef3cb1954e4bb3c1340917517cbfb5644d6d57313859f83ecb76b0dcbb`.

Clean scratch baseline `14d4bcb530e4f8c1b45d6c4eb84a2fac89f7b9a6` based on `9ebc979d1ec0e519c54fe6323092f7a169c19622`. Only the two final wiring files were copied verbatim from parent candidate; their hashes still match parent files.

Actual isolated focused suite: 15 pass /0 fail → 14 pass /1 fail → 15 pass /0 fail. No cancellations.

Mutation removes only `src-tauri/sidecar/__tests__/ukpn-outages-route.test.mjs` from the `test:sidecar` command. The complete inventory assignment assertion fails. The applied diff, exact logs and per-file SHA256s are retained here. Restored package checksum matches baseline and Git status is empty.

The scratch commit establishes a clean proof baseline only; it was not pushed and does not alter the parent branch. No native tests/install/app/profile were run.

- `package.json`: `2c2be53579735e002fd69e094739f9dd85489beeb9fa85b750a5834548c727cc`
- `tests/sidecar-ci-inventory.test.mjs`: `955d9f72a7d1d54df2d670f10e286a08b58ff51783a8052b2190bd6b77f55868`

## Live source bodies and retained replay

Fixed requests (no credentials):

- `https://ukpowernetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets/ukpn-live-faults`
- `https://ukpowernetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets/ukpn-live-faults/records?limit=100`

Initial retained records: 162,716 bytes, `total_count:100`, 100 returned;
22 Unplanned, 61 Restored, 17 Multiple. SHA-256
`bcbfb0e4b622897916cb4bdbb58e4f5267156576bd8517fb37b961ef229cf1c1`.
Metadata was 11,330 bytes, SHA-256
`e242c884a2c69c4a93bb64b93ce101edbc7a89b5e133ffb52e3bc1f483591e4f`.

Consumed metadata: `metas.default.data_processed`,
`metas.default.records_count`. Consumed record envelope: `total_count`, `results`;
row fields: `incidentreference`, `powercuttype`, `nocustomeraffected`,
`restoreddatetime` (contradiction rejection only), optional `operatingzone`.
Coordinates, postcode, prose, restoration estimates and ambiguous local row dates
are not consumed or rendered.

Retained-body normalizer replay at original receipt
`2026-11-20T04:28:22.701Z`: 100 raw / 22 accepted / 78 excluded / 0 invalid,
including eight reported zero counts. The same retained metadata was reused on
both sides. **This is replay, not a live three-read coherence proof or current
acceptance**, even though the normalizer's synthetic result says verified.

Final implemented acquisition at `2026-11-20T04:57:48.195Z`: metadata count 101,
publication `2026-11-20T04:57:04.805000+00:00`, metadata SHA-256
`f95cef48c7219948243a9f5780896722d0b61e07f66fd5395559fd32e478d1af`.
It stopped before requesting records and returned `unavailable / incomplete_snapshot`,
zero contributed rows. The earlier implemented attempt also rejected 101.
Zero contribution means no accepted evidence, never zero regional outages.
The 100-record cap and 15-minute cutoff are approved product policies, not
statistical tolerances or a provider SLA. No cap expansion or pagination was added.

Raw receipts and logs are retained in task artifacts:
`next-nov18b/ux015-discovery/` beneath the thread visualization directory.
They include original metadata/records/terms hashes, both implemented acquisition
receipts, the replay, streaming cleanup red/green evidence and mutation diffs.

## Review, risks and manual acceptance

Final independent Sol and actual Sonnet reviews must examine the complete diff
and this evidence. Their actual conclusions are retained in task artifacts;
the verdict-only commit records Sonnet's exact reviewed parent. This report
alone is not a review approval or authorization to publish.

The documentation claim has 13 successful hosted workflows; Security Audit
fails on the existing marketing `react-server-dom-webpack` critical finding.
This branch changes no dependency graph. Hosted implementation CI is pending
separate publication approval; the claim's CI cannot certify unpublished code.

Manual acceptance remains open: after separately authorized execution, inspect
Grid → Outages with missing US county evidence; verify UK regional attribution,
keyboard tabs/focus, zero counts, empty/unavailable states and 15-minute expiry
while refresh is pending. Check both web and desktop with a complete live
snapshot of at most 100 rows, then sustained transitions. Do not infer restored
power from disappearing rows or an empty list. No installed profile was accessed.

Rollback removes the isolated provider/route, UKPN panel/loader/catalog additions,
bundled resource and corresponding test wiring. No storage migration or user-data
rollback is required; ODIN remains separate. Preserve security checks when
reverting the feature.

## Proposed draft description

Add bounded UK Power Networks regional incident reports beside existing ODIN
county evidence. Both web and desktop use one shared strict provider; incomplete,
old or unavailable snapshots cannot appear current or count as healthy evidence.
Keep publication/retrieval times distinct and regional coverage explicit.

Local validation and mutation evidence are recorded above. The live 101-row cap
rejection, sustained/installed acceptance and existing marketing audit stay open.
Keep the PR draft and all merge/delivery holds intact.
