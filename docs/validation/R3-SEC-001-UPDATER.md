# R3-SEC-001 updater validation

Validated September 27, 2026. This report covers the bounded native updater repair only. The remaining ten Round 3 findings are open. No installed application was changed.

## User-visible result and architecture

The native process selects the official release and verifies its exact version, architecture, size, hash and mandatory signer identity. The renderer cannot choose an update URL/hash or manufacture readiness from saved state. Supported verified updates offer Restart; unsupported trust produces a canonical manual-download page. Failed checks and failed application clear stale Restart actions in both toast and sidebar. Existing staged bundles meet the same policy before reuse or installation.

Native changes: src-tauri/src/main.rs and new updater_policy.rs. Renderer: desktop-updater.ts, app-context.ts, narrow panel-layout.ts rejection cleanup. Test changes: desktop-updater.test.mts, desktop-updater-signature.test.mjs, desktop-updater-authority.test.mjs and package.json test:desktop-updater wiring. No new dependencies or persistent schema changes.

## Actual validation

Commands ran with Node22 PATH and shared Cargo target. These are actual saved output excerpts, not predicted results.

`cargo test --manifest-path src-tauri/Cargo.toml` (native-full.log)

```text
test result: ok. 83 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.00s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`npm run test:desktop-updater` (updater-test-repair.log)

```text
# pass 13
# fail 0
# pass 22
# fail 0
```

`npm run test:sidecar` (updater-sidecar.log)

```text
# pass 643
# fail 0
```

`VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:desktop-updater"` (updater-gate.log)

```text
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
Secret scan passed for 4889 file(s).
Agentic validation gate passed.
Tests run: test:desktop-updater
```

`npm run bundle:check` (updater-bundle-final.log)

```text
    main-GJwj73b7.js  raw=1.56 MB  gzip=453.5 KB
✓ All bundle-size policies satisfied.
```

Final test-only commit hooks additionally ran `npm run typecheck:all`, staged secret scanning and conflict checks successfully. `git diff --check` and clean status verified after all mutations. The former unrelated alert performance blocker was repaired in PR #1743. The tracker prerequisite landed in PR #1742. Fresh combined renderer validation is recorded below. Native compilation retains existing warnings plus a platform-specific unused UnsupportedPlatform variant; none suppressed.

## Mutation proofs

47 separate applied production mutations:28initial,13supplemental renderer/source,6supplemental native. All start clean, save SHA256, record nonempty applied diff, require real failing assertion/counts, restore identical SHA256 and confirm clean status. Restored suites source13/0, renderer22/0, native34/0. Full hashes/assertions/diffs are retained in each linked JSON and adjacent logs; table values below come directly from those results.

One preliminary coalescing mutation canceled pending tests (19pass/0fail/3cancelled), which was rejected as insufficient evidence. The test was repaired to assert call count before awaiting both promises; its repeated mutation now has21pass/1fail and restored22/0.

| Mutation | File | Baseline pass/fail | Mutated pass/fail | Proof |
|---|---|---|---|---|
| canonical-owner | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| redirect-policy | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| redirect-hop-limit | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| missing-signer | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| installed-integrity | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| local-fingerprint | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| installed-pin-check | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| manifest-version | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| manifest-tag | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| manifest-variant | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| manifest-ambiguity | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| manifest-size | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| manifest-hash-format | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| architecture | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| candidate-version | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| candidate-newness | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| candidate-pin-check | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| download-hash | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| download-length | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| post-swap-check | src-tauri/src/main.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| single-flight | src-tauri/src/main.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| manual-staged-gate | src-tauri/src/main.rs | 13/0 | 12/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| boot-staged-gate | src-tauri/src/main.rs | 13/0 | 12/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| browser-url | src/app/desktop-updater.ts | 22/0 | 20/2 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| native-result-validation | src/app/desktop-updater.ts | 22/0 | 13/9 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| failed-check-state | src/app/desktop-updater.ts | 22/0 | 10/12 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| destroyed-readiness | src/app/desktop-updater.ts | 22/0 | 21/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| sidebar-failed-apply | src/app/panel-layout.ts | 22/0 | 21/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| native-no-renderer-arguments | src-tauri/src/main.rs | 13/0 | 12/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| renderer-no-artifact-arguments | src/app/desktop-updater.ts | 13/0 | 11/2 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| storage-fallback | src/app/desktop-updater.ts | 13/0 | 11/2 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| source-staging-pin | src-tauri/src/main.rs | 13/0 | 12/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| source-installed-integrity | src-tauri/src/main.rs | 13/0 | 12/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| ui-native-version | src/app/desktop-updater.ts | 22/0 | 20/2 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| ui-native-current-version | src/app/desktop-updater.ts | 22/0 | 21/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| ui-manual-dismissal | src/app/desktop-updater.ts | 22/0 | 20/2 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| ui-browser-link | src/app/desktop-updater.ts | 22/0 | 21/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| ui-web-stage | src/app/desktop-updater.ts | 22/0 | 21/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| ui-stale-ready-kind | src/app/desktop-updater.ts | 22/0 | 21/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| ui-coalescing | src/app/desktop-updater.ts | 22/0 | 21/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| ui-toast-apply-failure | src/app/desktop-updater.ts | 22/0 | 21/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| initial-fragment-normalization | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| strict-version-leading-zero | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| self-signed-anchor-compatibility | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| canonical-staged-downgrade | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| native-result-field-schema | src-tauri/src/updater_policy.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |
| symlinked-staged-swap-gate | src-tauri/src/main.rs | 34/0 | 33/1 | [proof](R3-SEC-001-UPDATER-MUTATIONS.json) |

## Reviews

Independent review cycle1 found no production defect; it blocked on20newtests without red mutation evidence. Supplemental evidence repairs that finding; final independent review of3301a4267 concludes no blocking findings. The independent conclusion found zero blocking findings after inspecting the supplemental failing assertions, applied diffs and restored hashes. Actual Claude review approved exact code tip3301a426745ae014bc65a0e4e38495769a7e7cfd with zero blockers. The full original Claude review is retained in the corresponding SHA-pinned review evidence. Verdict-only commitd7b9c65688d0de4b42ab2fd4501983505181df38 was recorded and locally verified PASS. Later code changes require fresh review.

## Live probe and limits

### Updater live discovery

Captured 2026-09-27T15:46:08.289576+00:00 from public canonical GitHub release metadata.

Request: https://api.github.com/repos/bradleybond512/crystal-ball/releases/latest. Tag: v2.25.147; 7 assets. Fields consumed: tag_name, assets[].name, assets[].size, assets[].browser_download_url.

Manifest: https://github.com/bradleybond512/crystal-ball/releases/download/v2.25.147/release-manifest.json. JSON object with version, variant, tag, commitSha, generatedAt, and 6 assets. Asset fields: name, path, size, sha256.

Both DMGs and the manifest were probed with HEAD: one HTTP302 from HTTPS github.com to HTTPS release-assets.githubusercontent.com, then HTTP200. The manifest body was downloaded and parsed; neither DMG body was downloaded or mounted. Redirect query strings intentionally omitted from recorded evidence.

The manifest uses spaces in Crystal Ball filenames, while GitHub release assets use dots. Current renderer exact matching therefore misses the manifest hash. Proposed backend mapping must normalize only ASCII spaces to dots, reject collisions, and match architecture, exact version and size. No first-DMG fallback.

No certificate, installed app, Keychain, credential, release or installation operation was performed.

No installed-app, mount, actual signature compatibility, packaged-Mac visual/keyboard smoke, Keychain/certificate/credential operation or native update was run. Tests use pure fixtures and temporary synthetic bundles. Unknown legitimate signer syntax fails closed to manual download. Unsigned release metadata remains a pre-mount exposure if the canonical publisher is compromised; mandatory app signer checks do not authenticate DMG bytes before OS parsing. Signed-artifact provisioning remains a separate design.

## Manual acceptance and rollback

After ordered PR checks and approved delivery, Bradley should check native up-to-date/ready/manual-download states, dismiss/reopen behavior, sidebar and toast failure cleanup, and keyboard controls on a separately authorized test installation. Native real-signature, mount and swap smoke remains user-owned and unperformed; do not treat synthetic fixtures as that evidence.

Prefer disabling automatic update staging/application or a reviewed forward fix for rollback. Do not restore renderer-selected URL/hash authority or optional signer checks. No data migration is required.

## Refresh after prerequisite merges

The updater production and test files are byte-identical to reviewed commit `3301a426745ae014bc65a0e4e38495769a7e7cfd`. All 47 restored production checksums in the committed mutation evidence match the refreshed branch. The evidence includes each actual applied diff and red assertion. No mutation rerun is claimed for the rebase.

Fresh validation on the combined performance/updater tree:

```text
Agentic validation gate passed.
Tests run: test:desktop-updater
✓ All bundle-size policies satisfied.
```

Commands: `VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:desktop-updater"` and `npm run bundle:check`. The gate reran updater tests, lint, both type checks, secret scanning, documentation checks and the full web build. The full renderer suite (`npm run test:renderer`) also passed:

```text
# tests 15120
# pass 15120
# fail 0
# cancelled 0
# skipped 0
```

The refreshed main bundle is 453.5 KB against the unchanged 460 KB policy. The final SHA-pinned review commit records the exact publication review.

## QA/QC report

Risk tier: Critical (privileged update boundary). Automated checks and mutation evidence above passed. Actual native signature, mount, swap and installed-app UI acceptance were not run; those require Bradley’s separately authorized test installation. The unsigned-manifest pre-mount exposure and unknown legitimate signer syntax remain explicit limits. Merge requires the exact-tip Claude verdict and required CI. Rollback must disable the updater or forward-fix without restoring renderer artifact authority.
