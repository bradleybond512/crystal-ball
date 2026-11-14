# UX-066 dependency assessment — November 10, 2026

Status: **IN REVIEW** in [draft #1902](https://github.com/bradleybond512/crystal-ball/pull/1902).
Evaluated main: `5955a8d9860ad2f616008a3d738d423fbb8e5415`.
Inventory snapshot: `2026-11-10T16:14:13.254499+00:00`; 18 open main PRs,
including nine dependency PRs. The November 7 count of 13 is historical.

The draft records this dated assessment and claims UX-066. Local implementation
approval covers Zizmor 1.32.0 and isolated scanner testing. UX-062 baseline
comparisons and the delivery holds remain open.

## Evidence and limits

The local evidence directory is
`/Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/next-nov10`.
It contains `snapshot.json`, `open-prs.json`, `pr-N-files.json`,
`pr-N-checks.json`, named failed-run logs, official registry metadata,
`dependency-alert-current-versions.json` and alert inventories.
`evidence-index.json` pins the captured artifact hashes and evaluated main. These are dated
observations, not fresh executions of each proposed dependency on current main.
The GitHub PR links below and official package links identify remote sources;
local raw evidence is not published by this checkpoint.

**Verified** below means the cited metadata, patch, current-main declaration or
recorded hosted result was inspected. **Pending** means no approval-quality
artifact/content review or reconciled execution has established that property.
Registry hashes, signatures and attestation URLs are available evidence, not a
claim that downloaded bytes, signatures or attestations were verified. No whole
alert payload or secret value is reproduced.

## Exact candidate heads and observed checks

All nine are **HELD**. All were reported `MERGEABLE` at capture, which is not
proof of semantic compatibility with current main. No candidate was rebased or
merged here. The check windows are UTC; every candidate's dependency gate failed.
A green bot cross-agent job does not establish genuine independent review.

| PR / proposed update | Observed head | Check window | Additional failures / reconciliation hold |
| --- | --- | --- | --- |
| [#1897](https://github.com/bradleybond512/crystal-ball/pull/1897) Zizmor 1.31.1 → 1.32.0 | `77af17634894af1dca16f72528f3748a17516132` | Nov 9 23:53–Nov 10 00:01 | None beyond dependency gate; BEHIND. Pin/hash and executable-wheel review pending. |
| [#1896](https://github.com/bradleybond512/crystal-ball/pull/1896) geo-layers 9.4.0 → 9.4.1 | `3b0aa31b9b18fd241698b16ca35bc5443fb71077` | Nov 10 03:04–03:24 | None beyond dependency gate; UNSTABLE. Peer and transitive graph reconciliation pending. |
| [#1895](https://github.com/bradleybond512/crystal-ball/pull/1895) Cesium 1.143.0 → 1.147.0 | `0290ad8f726621ceebb983c1901948a21c5f7f3c` | Nov 10 03:04–03:24 | BLOCKED: typecheck, ESLint, bundle-size and smoke; diagnose each before rerun. |
| [#1894](https://github.com/bradleybond512/crystal-ball/pull/1894) lint-staged 17.3.0 → 17.6.0 | `13684de563fb87b4815a9d6418ccd05a0a9e2bc4` | Nov 10 03:04–03:23 | None beyond dependency gate; UNSTABLE. Local hook/runtime verification pending. |
| [#1893](https://github.com/bradleybond512/crystal-ball/pull/1893) clipboard-manager 2.3.3 → 2.5.0 | `eeaaafeeb83c67a652d36f4eb8f6ed6d3d5d34b9` | Nov 10 03:04–03:17 | BLOCKED: integrity age gate; broad Cargo graph overlaps #1892. |
| [#1892](https://github.com/bradleybond512/crystal-ball/pull/1892) Tauri 2.11.6 → 2.12.5 | `9f49af3e66c48771df545cea0b6ad62bd3a18e07` | Nov 10 03:04–03:23 | BLOCKED: integrity age gate; native and Cargo reconciliation pending. |
| [#1891](https://github.com/bradleybond512/crystal-ball/pull/1891) rust-cache `ad397744…` → `c8037a86…` | `6db55429656f316aa1cf6afa3a236b184706aa41` | Nov 10 03:04–03:24 | None beyond dependency gate; UNSTABLE. Action execution/cache review pending. |
| [#1791](https://github.com/bradleybond512/crystal-ball/pull/1791) SonarJS 4.0.3 → 4.2.2 | `bce1ea697edfe490bd861ec20aa71b254947f4c5` | Nov 1 14:26–14:36 | BEHIND: ESLint and roadmap validate; stale results require current-main diagnosis. |
| [#1750](https://github.com/bradleybond512/crystal-ball/pull/1750) Tauri CLI 2.11.4 → 2.12.4 | `b12449c71bc804e8a2665d9ed7c146aeec2fa358` | Nov 9 23:35–23:53 | None beyond dependency gate; BEHIND. Native build/toolchain reconciliation pending. |

Captured PR API base SHAs: #1896–#1891 use evaluated main above; #1897 and
PR #1750 report `3a9786c45daa9fcf643331ac004ae62e97793f7a`; #1791 reports
`1509a12e4656a40f6725282c83033f1037018cfc`. These are captured base fields,
not independently computed merge bases. Changed files: #1897 only
`.github/tools/zizmor/requirements.txt`; #1896/#1895/#1894/#1791/#1750 only
`package.json` and `package-lock.json`; #1893/#1892 only `src-tauri/Cargo.lock`;
PR #1891 only `.github/workflows/security-audit.yml`,
`.github/workflows/targeted-tests.yml`, and `.github/workflows/test-linux-app.yml`.

Current main still declares each old direct version/pin shown above. This does
not authorize replaying entire stale lockfiles: preserve newer safe transitive
versions and compare the full graph against main before each candidate proceeds.
No candidate is declared superseded merely because another PR overlaps it.

## Necessity, maintenance, license and release age

These are existing dependencies. Necessity describes their existing role and
update rationale; no urgent security fix for these exact nine updates has been
established. The five npm old/new metadata pairs retain their maintainer sets
and repository identities. Publication activity is verified; support promises,
release-content quality and maintainer-account security are not.

| PR | Necessity / maintenance evidence | Verified license metadata | New release date UTC / age at capture |
| --- | --- | --- | --- |
| #1897 | Workflow security scanner; [zizmorcore release](https://github.com/zizmorcore/zizmor/releases/tag/v1.32.0) and [PyPI metadata](https://pypi.org/pypi/zizmor/1.32.0/json) exist. Rule-change suitability pending. | MIT, both versions | Nov 2; over 7 days |
| #1896 | Existing geospatial layers; [visgl npm metadata](https://registry.npmjs.org/@deck.gl%2fgeo-layers) shows patch activity. Specific benefit/peer compatibility pending. | MIT, both versions | Oct 28; over 12 days |
| #1895 | Existing globe renderer; [CesiumGS npm metadata](https://registry.npmjs.org/cesium) shows continuing releases. Four-release migration benefit/cost pending. | Apache-2.0, both versions | Nov 2; over 7 days |
| #1894 | Existing staged-file quality hook; [npm metadata](https://registry.npmjs.org/lint-staged) retains okonet/iiroj. Hook behavior benefit pending. | MIT, both versions | Sep 26; over 45 days |
| #1893 | Existing desktop clipboard integration; [crates metadata](https://crates.io/api/v1/crates/tauri-plugin-clipboard-manager/2.5.0) reports tauri-bot publisher, not yanked. Native change review pending. | Apache-2.0 OR MIT, new version; old artifact license comparison pending | Oct 14; over 26 days; transitive age failure below |
| #1892 | Existing desktop runtime; [crates metadata](https://crates.io/api/v1/crates/tauri/2.12.5) reports tauri-bot publisher, not yanked. Runtime migration review pending. | Apache-2.0 OR MIT, new version; old artifact license comparison pending | Oct 21; over 20 days; transitive age failure below |
| #1891 | Existing CI Rust cache; [upstream commit](https://github.com/Swatinem/rust-cache/commit/c8037a86dde8214a8310e9f54a8fc61ab362aa31) exists. Benefit, maintenance/release mapping and bundled action code pending. | Exact-commit license review pending | Commit Oct 23; release/tag age not established; review as code |
| #1791 | Existing security/quality lint rules; [SonarSource npm metadata](https://registry.npmjs.org/eslint-plugin-sonarjs) retains maintainer set. Newly surfaced findings require repair. | LGPL-3.0-only, both versions | Sep 28; over 43 days |
| #1750 | Existing desktop build CLI; [Tauri npm metadata](https://registry.npmjs.org/@tauri-apps%2fcli) retains maintainer set. Toolchain-alignment benefit pending. | Apache-2.0 OR MIT, both versions | Oct 21; over 20 days |

License metadata is not an audit of bundled/transitive notices. The seven-day
gate applies to every new registry version in the resolved graph, not just the
direct package. No age exception is justified by this table. Both Rust failures
report the same five too-new versions on Nov 10: `brotli-decompressor@6.3.1`
(0.8 days), `serde_spanned@1.1.3` (3.6), `toml@1.2.1+spec-1.1.0` (3.6),
`toml_datetime@1.1.3+spec-1.1.0` (3.6), and
`toml_writer@1.2.0+spec-1.1.0` (6.1). These are observed ages, not unknown
publication dates. Prefer waiting and rerunning the ordinary gate; any urgent
exception needs a specific reviewed rationale.

## Integrity, execution surface and required validation

For each npm candidate, official metadata supplies tarball URL, integrity hash
and registry signature; attestation metadata is present for geo-layers,
lint-staged, SonarJS and Tauri CLI, absent for both inspected Cesium versions.
None has had downloaded-artifact or cryptographic verification in this
checkpoint. Direct metadata shows no added preinstall/install/postinstall hook;
that does not clear transitive packages or establish execution safety.

| PR | Verified execution/provenance facts | Compatibility, build/security impact and pending validation |
| --- | --- | --- |
| #1897 | Requirements patch is pin/hash-only; PyPI lists 11 wheels plus one sdist for 1.32.0 versus 10 wheels plus one sdist for 1.31.1. Windows ARM64 wheel is added. Architect comparison confirms all 12 added hashes equal the 12 PyPI release-artifact SHA256 metadata values (including sdist); `--only-binary` excludes sdist execution. Python >=3.11 and MIT unchanged. | Verify downloaded artifact bytes; review wheel entry points/native binaries and provenance. Preserve `--require-hashes --only-binary=:all:` and scanner enforcement. Run workflow-security/tool-lock tests and Zizmor on exact reconciled head; scanner pass alone is not artifact approval. No app bundle impact expected from its CI-only role. |
| #1896 | No bin or install hooks in either metadata record; build/prepublish scripts unchanged. Unpacked package 3,148,504 → 3,154,775 bytes. | Audit all changed lock entries and deck.gl peer alignment; inspect runtime artifacts/signatures. Run map/globe targeted tests, typecheck, production build, map E2E and bundle comparison. Unpacked size is not delivered bundle size. |
| #1895 | No bin; existing `prepare` script unchanged; Node floor rises >=22.0.0 → >=22.17.0. Unpacked 77,997,646 → 80,196,017 bytes. | Repo permits Node >=22.0.0 <23.0.0, so support-floor reconciliation is required. Recorded TS2339 `getValue` on `string \| Property` at GlobeDataManager.ts:3254/3289 and gods-vision/AutoFollowEngine.ts:297 blocks build. Repair with behavior tests/mutation proof; rerun types, strict lint, globe/map tests, smoke and bundle-size. Asset/worker/transitive script review pending; no size pass inferred from failed build. |
| #1894 | Bin stays `bin/lint-staged.js`; Node >=22.22.1 unchanged; maintainer release scripts change, no new direct install hook. Unpacked 166,499 → 168,006 bytes. | Existing Node-floor mismatch with repo's broad engine range must be understood. Review tinyexec/picomatch/optional yaml graph and CLI contents; verify staged-file selection, quoting, failure and hook behavior in a disposable fixture. Run lockfile, lint and type gates; app bundle impact not expected for dev-only use. |
| #1893 | crates.io gives checksum, no bins, Rust 1.90/edition 2024; artifact/build.rs and provenance not verified. Cargo.lock patch +235/-654. | Full transitive graph and permissions/clipboard behavior review pending; coordinate #1892/#1750 without losing unique changes. Await age gate, audit/deny, Rust and desktop build checks plus clipboard/permission smoke under separately approved native acceptance. Native size/ABI/platform impact unmeasured. |
| #1892 | crates.io gives checksum, no bins, Rust 1.90/edition 2024; artifact/build.rs and provenance not verified. Cargo.lock patch +211/-230. | Broad runtime/Wry/platform graph needs current-main and #1893/#1750 comparison. Await age gate, audit/deny, toolchain/capability/IPC tests, Rust/desktop build and approved platform smoke. Native bundle/performance/security impact unmeasured; web green does not clear IPC or packaging. |
| #1891 | Four full-SHA uses change across three workflows. GitHub commit API reports signature verified; independent verification and source/bundled JS parity pending. | Inspect action.yml, pre/main/post entry points, bundled code, license, inputs, cache keys/poisoning boundaries, network and token access; ensure no permission expansion. Run actionlint, Zizmor, workflow tests and affected Rust jobs. No recorded integrity-check failure for this head; only dependency gate failed. |
| #1791 | Neither metadata record declares scripts/bin. Unpacked 3,404,039 → 4,348,217 bytes. | Nov 1 lint ratchet reports new super-linear-regex findings (including sidecar), assertion and floating-point rules; do not raise baseline or disable rules. Reconcile current main, reproduce and repair confirmed findings with focused tests/mutations; rerun strict lint, types and roadmap. Nov 1 roadmap failure references merged UX-040/#1841 and TODO claims UX-033/#1839, UX-038/#1840: stale evidence, not a current-main diagnosis. Dev-tool size increase is not an app bundle measurement. |
| #1750 | Bin remains `tauri.js`; direct scripts and Node >=10 metadata unchanged. Unpacked 381,640 → 432,536 bytes; optional native artifacts remain unreviewed. | Verify platform package hashes, executable contents/provenance, Rust/runtime alignment with #1892/#1893, CLI config/build behavior and release safeguards. Run lockfile, types, native/desktop build and applicable packaging checks without release/install. No native acceptance or delivered bundle-size result established. |

Every candidate additionally needs current-main graph reconciliation, ordinary
age/integrity/secret gates, targeted tests, the full agentic gate and genuine
independent review on its exact resulting head. The tables record pending work,
not authorization to execute all batches. The October 24 delegation permits only
`dependency-change-approved` and justified `dependency-age-reviewed` after a
complete technical assessment; neither is applied here. `install-scripts-reviewed`
remains human-only.

## Accessible alerts — initial triage, unresolved

Access succeeded: **5 open Dependabot**, **94 open CodeQL**, **0 open secret
scanning alerts**. Zero open secret alerts is not proof that no secret exists.
Current-main lock inspection finds a version inside the advertised vulnerable
range for all five dependency alerts. This establishes version applicability,
not reachable exploitation, remediation or coverage by any of the nine PRs.

| Alert | Advisory / severity | Manifest and applicable version | Hold / next evidence |
| --- | --- | --- | --- |
| #203 | GHSA-g3hv-75wg-m249 / medium | package-lock.json: minimatch 10.2.5 | Patched 11.0.1; trace dependents and major-version compatibility before choosing upgrade. |
| #202 | GHSA-g3hv-75wg-m249 / medium | marketing-site/package-lock.json: minimatch 10.2.5 | Separate marketing graph; patched 11.0.1; same dependency-path review pending. |
| #197 | GHSA-gcqx-w48m-w2h4 / low | package-lock.json: deepmerge 4.3.1 | No patched version listed; assess callers/input exposure and upstream mitigation. |
| #19 | GHSA-cq8v-f236-94qc / low | src-tauri/Cargo.lock: rand 0.7.3 | 0.8.6 also exists but does not remove vulnerable copy; trace old dependent/platform path. |
| #2 | GHSA-wrw7-89jp-8q8g / medium | src-tauri/Cargo.lock: glib 0.18.5 | Patched 0.20.0; GTK/platform graph and compatibility design pending. |

Do not force major overrides merely to clear alert counts. Keep remediation as
explicit, bounded design work; no alert has been dismissed or marked repaired.

CodeQL inventory: 5 critical, 19 high, 70 medium; all latest instances reference
`refs/heads/main`. Critical request-forgery alerts #88–#92 reference
`b7389fb9ca1fb5b0a63c07aea6d20191c916228f` (March 2 scan), in
`scripts/ais-relay.cjs` and `src-tauri/sidecar/local-api-server.mjs`. Main-ref
membership does not make old line locations current. Trace present handlers,
reachable inputs and existing repairs, then rerun/reconcile analysis before
claiming fixed, false positive or currently exploitable. All 94 remain unresolved
in this checkpoint. Alert triage is incomplete, so UX-066 is not DONE.

## Publication update

At draft creation on November 10 (US Central), GitHub listed ten open dependency
updates and seven open Dependabot alerts. Two new critical alerts (#204 and
alert #205) cover one advisory in the marketing site's development manifest and
lockfile. Both specify react-server-dom-webpack 19.2.8. The advisory lists
19.2.9 as the first patched release. Assess the marketing build and dependency
graph before accepting the proposed 19.3.1 update in
[PR #1901](https://github.com/bradleybond512/crystal-ball/pull/1901).
Runtime reachability and remediation remain open.

## Zizmor implementation

The candidate pin matches #1897 and the twelve PyPI release hashes.
Isolated scans of the 23 production workflows returned zero findings at
the CI threshold with both versions. Version 1.32.0 also detected the
wrapped-expression regression. [Validation evidence](UX-066-ZIZMOR-VALIDATION.md)
records artifact inspection, controls, timing and remaining platform limits.
The other dependency updates and the marketing security audit remain open.

The documentation checkpoint passed all 135 roadmap tests and the full local
validation gate. Both reviewers reported zero blockers on source
`705c131490568b68a73fae4cf54418c2c0d6b601`. Revert the two documentation
files to roll back the checkpoint.
