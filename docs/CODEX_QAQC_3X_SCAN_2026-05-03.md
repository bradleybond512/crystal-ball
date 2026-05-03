# Codex QA/QC 3x Scan Findings

Date: 2026-05-03

Branch scanned: `claude/domain-superpowers`

Log root: `/tmp/crystalball-qaqc-3x-20260503-114431`

## Scope

Codex ran the same full QA/QC gate set three times against the current dirty
worktree. The worktree already contained the domain-superpowers commit plus
uncommitted source and docs changes. No source fixes were made during this scan.

## Result

Release stance: not ready.

The failures below reproduced across all three passes unless marked otherwise.

## Stable Blockers

### TypeScript and build failures

Commands:

- `npm run typecheck:all`
- `npm run build`

Both commands failed 3/3 passes with the same `gods-vision` contract mismatch.

Primary failing files:

- `src/components/gods-vision/Globe4DManager.ts`
- `src/components/gods-vision/GlobeDegradation.ts`
- `src/components/gods-vision/GlobePillars.ts`
- `src/components/gods-vision/GlobePlayback.ts`
- `src/components/gods-vision/GlobeSwimlane.ts`
- `src/components/gods-vision/GlobeTrails.ts`

Symptoms:

- `GlobeTimeMachine` is used as if it exposes `onTimeChange`,
  `getCurrentMs`, and `getSpeed`, but those methods do not exist.
- `GlobeDataManager` is used as if it exposes `getEventBlocks`,
  `getLayerEntitiesWithTimestamps`, and `getEntityPositionHistory`, but those
  methods do not exist.
- `EventBlock` and `EntityTimestampedSample` are imported from
  `GlobeDataManager`, but are not exported there.

Impact:

- Type checking fails.
- Web build fails before Vite can build.
- Desktop app packaging should not proceed until this is fixed.

### Runtime E2E failures

Command: `npm run test:e2e:runtime`

Result: 7 failed, 5 passed in all 3 passes.

Stable failing scenarios:

- `detectDesktopRuntime covers packaged tauri hosts`
- `runtime fetch patch falls back to cloud for local failures`
- `update badge picks architecture-correct desktop download url`
- `loadMarkets keeps Yahoo-backed data when Finnhub is skipped`
- `fetchHapiSummary maps proto countryCode to iso2 field`
- `cloud fallback blocked without CrystalBall API key`
- `cloud fallback allowed with valid CrystalBall API key`

Observed symptoms:

- Secure localhost desktop-runtime detection returned `false`.
- Secret writes failed because the web key vault was locked.
- The update badge test hit `Cannot read properties of undefined (reading 'call')`.
- Markets did not render Yahoo-backed data when Finnhub was skipped.
- HAPI summary mapping returned an empty `iso2` for the US row.
- Cloud fallback without a Crystal Ball API key did not surface the expected
  fetch error.

### Data and guardrail test failures

Command: `npm run test:data`

Stable failing tests:

- `tests/biometric-gate.test.mjs`
  - Desktop unlock bootstrap should use the shared runtime detector.
- `tests/build-desktop-workflow.test.mjs`
  - Workflow dispatch is expected to be build-only, but the workflow still has
    publish-mode dispatch inputs.
- `tests/deploy-config.test.mjs`
  - PWA precache glob is expected to exclude HTML files.
- `tests/lint-workflow.test.mjs`
  - Markdown lint workflow is expected to lint only changed PR markdown files.
- `tests/panel-visibility-regression.test.mjs`
  - README inventory is stale; expected
    `190 full / 35 tech / 31 finance / 10 happy`.
- `tests/release-doc-sync.test.mjs`
  - `CHANGELOG.md` lacks a dated `2.10.21` section.
- `tests/vault-intro-open-sequence.test.mjs`
  - Vault intro door parts no longer expose `scannerRing`, `statusText`, and
    `boltPins` in the shape expected by the animation helpers.

### Documentation freshness failure

Command: `npm run docs:check`

Stable symptoms:

- `README` says 48 secret keys.
- `main.rs` has 49 keys.
- `docs/API_KEYS.md` references 2 keys.
- `main.rs` has 49 keys.

### Lint failures

Commands:

- `npm run lint:strict`
- `npm run lint`

`npm run lint:strict` failed 3/3 after Playwright generated `test-results`
markdown files. The markdown lint command includes those generated artifacts,
and the generated `error-context.md` files violate `MD047`.

`npm run lint` failed 3/3 with:

- 2,780 total problems.
- 2,764 errors.
- 16 warnings.

The full lint failure includes both broad existing strict-rule debt and local
worktree artifacts under `.claude/worktrees`.

### Feed validation failures

Command: `npm run test:feeds`

Stable failures:

- News24: HTTP 403.
- Bild: empty feed result.

Variable failure:

- 20VC Episodes timed out in pass 1, then passed in passes 2 and 3.

Impact:

- The feed catalog has at least two stable upstream drifts and one flaky source.

## Checks Passing 3/3

The following commands passed all three runs:

- `npm run lockfile:check`
- `npm run version:check`
- `npm run secrets:scan`
- `npm audit --audit-level=moderate`
- `npm run cross-agent:check`
- `npm run lint:ci`
- `npm run test:api`
- `npm run test:sidecar`
- `npm run test:providers`
- `npm run test:reasoning`
- `npm run test:settings`
- `npm run test:diagnostics`
- `npm run test:algorithms`
- `npm run test:weather`
- `npm run test:ops`
- `npm run test:intelligence`
- `npm run test:insights`
- `npm run test:shortage`
- `npm run test:adsb`
- `npm run test:strategic-self-improvement`
- `npm run test:panels:fixtures`
- `npm run test:panels:smoke`
- `npm run bundle:check`
- `npm run build:sidecar-sebuf`

## Recommended Fix Order

1. Fix the `gods-vision` TypeScript contract mismatch so typecheck and build can
   run.
2. Fix the seven runtime E2E failures, especially desktop-runtime detection,
   vault test setup, HAPI `iso2` mapping, and cloud fallback behavior.
3. Fix the stable `test:data` guardrail failures.
4. Update README, API key docs, and changelog for the current version and panel
   inventory.
5. Exclude generated Playwright `test-results` from markdown lint or clean them
   before `lint:strict`.
6. Replace or remove stable-dead feeds: News24 and Bild; investigate 20VC
   timeout flakiness.
7. Decide whether full `npm run lint` is meant to gate the repo. If yes, exclude
   `.claude/worktrees` and burn down the remaining strict-rule debt.
