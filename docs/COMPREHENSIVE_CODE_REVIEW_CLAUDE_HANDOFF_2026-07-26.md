# Crystal Ball Comprehensive Code Review

Claude implementation handoff

**Review date:** 2026-07-26
**Reviewed commit:** `45e4d6ca62303d3f8c1df6303ccd284af0e95d38`
**Review branch:** `codex/crystalball-comprehensive-review`
**Risk tier:** High
**Baseline recommendation:** Do not release the reviewed commit until Phase 0 is green.

**Implementation update:** 2026-07-26 on this branch; Phase 0 and all safely
bounded fixes below are implemented and verified.

## Instructions for Claude

This document consolidates four independent review passes:

1. Correctness, build, and baseline quality.
2. Feature architecture, lifecycle, configuration, and performance.
3. Data integrity, security, reliability, privacy, and observability.
4. Tests, CI/release, live diagnostics, UX, and accessibility.

Before changing code:

1. Read `AGENTS.md`.
2. Start a fresh `claude/*` branch from the current `macos/main`. This review
   branch is evidence only and may be behind main.
3. Reproduce each finding against the new base. Line numbers below refer to the
   reviewed commit and can move.
4. Reproduce any remaining finding against the current `macos/main`.
5. Use tests first for every bug. Each PR must include a focused regression test.
6. Preserve the strong controls listed under "Controls to preserve."
7. Run the repository's maximum QA/QC workflow and cross-agent review before
   enabling auto-merge.
8. Mark finding IDs as resolved in the PR description. If a finding is rejected,
   record the evidence and tradeoff instead of silently skipping it.

The original review changed no application code. This branch now includes the
bounded remediation described below so Claude can concentrate on the remaining
architectural migrations instead of repeating completed work.

## Implementation status

| Status | Findings |
| --- | --- |
| Resolved | CBR-001, CBR-002, CBR-004, CBR-005, CBR-006, CBR-007, CBR-008, CBR-009, CBR-012, CBR-014, CBR-015, CBR-016, CBR-017, CBR-021, CBR-023, CBR-024 |
| Partially remediated | CBR-010, CBR-011, CBR-013, CBR-019, CBR-022 |
| Architectural follow-up | CBR-003, CBR-018, CBR-020 |

### Completed remediation

- Product variants are validated from one build-time value, reject unknown
  values, own their metadata, and pass browser identity checks for `full`,
  `tech`, `finance`, and `happy`.
- The vault is now explicitly a startup animation. Fake authentication and unused
  biometric permissions/code were removed instead of preserving a misleading
  security claim.
- Panel and application teardown are idempotent, destroy owned panel instances,
  clear late lazy mounts, and stop the shared heartbeat when its last owner exits.
- Diagnostics distinguish `unknown` from `healthy` and cannot emit a false-green
  recommendation. A live run reported 16 healthy, 14 failing, and 93 unknown
  sources with an actionable degraded recommendation.
- Calendar-dependent API tests, Node-incompatible renderer imports, and the
  sidecar health-schema drift have focused regression coverage.
- PR CI now runs API tests, the full sidecar suite, variant identity checks,
  accessibility regression checks, a production build, and a PWA precache
  budget.
- Obsolete vault frame images are excluded from Workbox. The production service
  worker contains 436 entries / 20.46 MiB and zero vault frame entries.
- The verified IP lookup HTML injection path is escaped. YouTube frame messaging
  validates both source and exact parent origin. Claude and Ollama prompt inputs
  treat provider/tool content as untrusted records with explicit boundaries.
- Browser CSP no longer grants loopback connections, shared policy fragments
  cover generated Vite headers, and the deployment header retains the
  non-overlapping navigation/frame restrictions.
- Sentry retains actionable dynamic-import, storage, and runtime failures, tags
  variant/runtime/reason, and deterministically samples only known noisy classes.
- Core shell landmarks, controls, consent focus management, visible accessible
  names, and contrast now pass Lighthouse 100/100 and all eight axe scopes.
- Published metadata no longer embeds manually maintained panel/layer counts.
- Clipboard permission is restricted to the main window; settings and live-news
  windows use a separate capability without clipboard access.

### Partial remediation and residual risk

- CBR-010/011: `maritime-safety` now demonstrates a decoded
  `fresh | stale | degraded` provider-result contract that distinguishes a
  healthy empty response from failure. Other providers still need incremental
  migration, beginning with alerting, personal exposure, and correlation inputs.
- CBR-013: browser policy is centralized and deployment overlap is removed, but
  desktop capability policy and web CSP remain separate policy systems by
  design. Add drift tests when either system gains new origins or permissions.
- CBR-019: the strict CI ratchet is green and the touched color debt was reduced.
  The legacy full-repository ESLint backlog still requires staged mechanical
  cleanup rather than an unsafe review-wide rewrite. The static listener/timer
  imbalance baseline is also stale for 38 files; repair real lifecycle gaps and
  account for element-owned listeners before re-baselining it.
- CBR-022: clipboard scope is fixed, window/source validation is stronger, and
  secret IPC keeps its trusted-window/key allowlist. The renderer still receives
  a broad secret snapshot; replace it with provider-scoped, on-demand commands.
- CBR-003/018: live measurement still shows 406 panels and 48,379 DOM nodes, and
  production still emits multi-megabyte core chunks plus ineffective dynamic
  import warnings. The next major project is a single manifest with truly lazy
  factories and explicit startup budgets.
- CBR-020: saved places, webhook definitions, and reasoning/operator data remain
  plaintext at rest. Define data classes and a keychain-backed encryption and
  migration design before changing storage formats.

## Executive assessment

Crystal Ball has unusually broad intelligence coverage and substantial safety,
security, offline, and diagnostics infrastructure. The main weakness is not lack
of features; it is that feature growth has outrun the product's configuration,
lifecycle, data-contract, and release-gate architecture.

The reviewed commit is not release-ready for five reasons:

- The advertised `tech`, `finance`, and `happy` variants all resolve to `full`.
- The desktop "secure unlock" grants access by default without authenticating and
  starts application initialization before the gate completes.
- Required local suites are red: one renderer test and one API test fail.
- Live diagnostics can report 35 failing sources and approximately 56 unknown
  sources while recommending "All sources within expected freshness windows."
- The full app eagerly mounts almost the entire feature catalog: 406 live panels,
  48,195 DOM nodes, and 2,583 displayed interactive elements in the reviewed
  browser session.

The best improvement is to turn the app from a catalog of always-live panels into
a mission-oriented shell backed by one authoritative feature manifest, lazy panel
factories, explicit provider health contracts, and hard release gates.

## Priority summary

| ID | Priority | Area | Finding |
| --- | --- | --- | --- |
| CBR-001 | P1 | Configuration | All product variants compile as `full` |
| CBR-002 | P1 | Desktop security | "Secure unlock" authenticates nobody by default |
| CBR-003 | P1 | Feature architecture | 407 of 408 configured panels are enabled and 406 mount live |
| CBR-004 | P1 | Lifecycle | App teardown does not destroy the main panel registry |
| CBR-005 | P1 | Diagnostics | Health reporting produces false-green recommendations |
| CBR-006 | P1 | Test gate | Renderer suite fails in a required CI job |
| CBR-007 | P1 | Test gate | API suite has a calendar-dependent failure |
| CBR-008 | P1 | CI | API, full sidecar, and Playwright suites are absent from PR CI |
| CBR-009 | P1 | Web performance | PWA precaches 150 obsolete local vault frames |
| CBR-010 | P2 | Data reliability | Failures are frequently represented as legitimate empty arrays |
| CBR-011 | P2 | Data integrity | External JSON is commonly trusted with type assertions |
| CBR-012 | P1 | Renderer security | Raw HTML sink has a verified user-input injection path |
| CBR-013 | P2 | Security policy | Three CSP definitions have drifted |
| CBR-014 | P2 | AI integrity | Untrusted headlines/tool data lack prompt-injection boundaries |
| CBR-015 | P2 | Observability | Broad Sentry suppression hides actionable failure classes |
| CBR-016 | P2 | Accessibility | Live full-app accessibility baseline is 85/100 |
| CBR-017 | P2 | Accessibility CI | Existing axe baseline does not gate PRs or new violation types |
| CBR-018 | P2 | Maintainability | Core modules and barrels block isolation and effective splitting |
| CBR-019 | P2 | Code quality | Full lint baseline is 1,548 errors and 65 warnings |
| CBR-020 | P2 | Privacy | Sensitive user-created data remains plaintext at rest |
| CBR-021 | P3 | Window messaging | Local YouTube bridge uses wildcard postMessage semantics |
| CBR-022 | P2 | Least privilege | Renderer receives broad secret snapshots and clipboard access |
| CBR-023 | P3 | Product metadata | Published panel/layer counts disagree with runtime |
| CBR-024 | P2 | Operator tooling | `checkup` consumes a stale sidecar health schema |

P1 means fix before release. P2 means schedule immediately after the release
blockers. P3 means hardening or debt that can follow once the core is green.

## Recommended execution order

### Phase 0: Restore trustworthy release gates

Fix CBR-001, CBR-005, CBR-006, CBR-007, CBR-008, and CBR-024.

The goal is not just green tests. The goal is a release pipeline that cannot call
the wrong product variant or a degraded runtime healthy.

### Phase 1: Resolve trust-boundary defects

Fix CBR-002, CBR-012, CBR-013, CBR-014, CBR-020, and CBR-022.

Decide explicitly whether the vault is a security boundary or an animation. The
current hybrid is misleading and fail-open.

### Phase 2: Replace eager feature construction

Fix CBR-003, CBR-004, CBR-009, and the lifecycle part of CBR-018.

Introduce one feature manifest and lazy factories before attempting broad file
reorganization. Avoid a rewrite of all panels.

### Phase 3: Standardize data reliability

Fix CBR-010, CBR-011, and CBR-015 provider by provider, starting with sources that
feed safety, personal exposure, alerting, and correlation.

### Phase 4: Product and maintenance hardening

Fix CBR-016, CBR-017, CBR-019, CBR-021, CBR-023, and the remaining modularization
work in CBR-018.

## Detailed findings

## CBR-001: All product variants compile as `full`

**Priority:** P1
**Confidence:** Confirmed
**Affected features:** Full, Tech, Finance, Happy, desktop packaging, E2E matrix

### Evidence

- `package.json:38-48` sets `VITE_VARIANT` for development and builds.
- `src/config/variant.ts:6` hardcodes `SITE_VARIANT` to `full`.
- `vite.config.ts:84-85` hardcodes `activeVariant` and `activeMeta` to `full`.
- `vite.config.ts:683` exports the hardcoded value as `__BUILD_VARIANT__`.
- A runtime import under `VITE_VARIANT=full|tech|finance|happy` returned `full` in
  all four cases.

Current configuration resolves to:

```text
SITE_VARIANT=full
408 configured panels
407 enabled panels
77 map layers
32 enabled layers
```

### Impact

Variant builds, titles, metadata, panel sets, feeds, and E2E expectations cannot
be trusted. A release can be correctly named but contain the full product.

### Recommendation

Create one validated `BuildVariant` source in Vite:

```ts
type BuildVariant = 'full' | 'tech' | 'finance' | 'happy';
```

Validate `process.env.VITE_VARIANT`, default only when it is absent, and expose the
validated value as a compile-time constant. Consume that constant in config
selection and metadata. Remove file-rewrite assumptions from `variant.ts`.

### Acceptance criteria

- Each build reports the requested variant at runtime.
- Panel, feed, title, manifest, and metadata differences are asserted per variant.
- Unknown variant values fail the build.
- Playwright has one fast identity test for every variant.
- Desktop package variant and renderer variant must match.

## CBR-002: "Secure unlock" authenticates nobody by default

**Priority:** P1
**Confidence:** Confirmed
**Affected features:** Desktop vault intro, biometrics, secrets, saved places,
operator trust

### Evidence

- `src/app/vault-intro.ts:70-87` enables real biometry only when a localStorage
  value is manually set to `true`; otherwise `attemptAuth()` sleeps and returns
  `success`.
- `src/app/vault-intro.ts:1146-1163` proceeds through the unlock animation on that
  fake success.
- `src/app/vault-intro.ts:1174-1185` skips the gate after a crash sentinel.
- `src/main.ts:351-359` starts `app.init()` before awaiting the vault result.
- A separate fail-closed implementation exists in `src/app/biometric-gate.ts` but
  is not the boot path.

### Impact

The UI and copy communicate a security boundary that does not exist. Data,
providers, and secrets can begin hydrating behind the overlay before the decision.
This conflicts with the repository's fail-closed safety rule.

### Recommendation

Choose one honest behavior:

1. **Security boundary:** require successful OS authentication before creating or
   initializing `App`; fail closed on plugin failure; provide an explicit recovery
   path that does not silently grant access.
2. **Animation only:** remove secure-unlock and biometric claims, remove the fake
   authentication state machine, and present it as an optional intro.

Do not keep an opt-in localStorage flag as the switch for a security boundary.
Repair or replace the crashing plugin before re-enabling the secure path.

### Acceptance criteria

- No sensitive initialization starts before successful authentication.
- Disabled, unavailable, cancelled, timed-out, and crashed authentication do not
  silently unlock.
- Recovery behavior is explicit, tested, and visible to the user.
- Automated tests cover every authentication outcome.

## CBR-003: Almost the entire feature catalog mounts at startup

**Priority:** P1
**Confidence:** Confirmed by configuration and live runtime
**Affected features:** Startup, memory, accessibility, polling, navigation,
variant behavior

### Evidence

- `src/config/panels.ts` configures 408 full-variant panels; 407 are enabled.
- The live browser session contained 406 `.panel` elements and 48,195 DOM nodes.
- The same session contained 2,583 displayed interactive elements.
- The repository contains 460 top-level `*Panel.ts` files.
- 282 top-level panel files contain 291 `setInterval()` calls.
- Only 177 top-level panel files use `renderWhenVisible`.
- `src/app/panel-layout.ts` directly constructs panels outside the authoritative
  `DEFAULT_PANELS` registry.
- Panel ordering in `src/app/panel-layout.ts:3225-3245` derives only from
  `DEFAULT_PANELS`, so constructed-but-unregistered panels drift from visibility
  and ordering policy.

### Impact

Disabled or undiscovered features can still construct, subscribe, poll, and
contribute DOM. Startup cost and accessibility scale with the whole catalog
instead of the user's mission. Configuration is not authoritative.

### Recommendation

Introduce one manifest:

```ts
interface FeatureManifestEntry {
  id: string;
  variant: BuildVariant[];
  defaultEnabled: boolean;
  capabilities: string[];
  providers: string[];
  create: () => Promise<Panel>;
}
```

Use dynamic factories. Construct only panels that are pinned, navigated to,
enabled for the current mission, or required for a visible safety surface. Keep a
small default deck and expose the rest through Library/search.

Do not instantiate a feature merely to make it discoverable.

### Acceptance criteria

- One registry owns identity, variant, default state, order, providers, factory,
  and cleanup.
- No panel constructor runs for an unavailable or unrequested feature.
- Startup DOM and panel-instance budgets are explicit and tested.
- Default full-app interactive count is reduced by at least an order of magnitude.
- Navigation lazy-mounts a panel and teardown releases it.

## CBR-004: Main panel instances survive App teardown

**Priority:** P1
**Confidence:** Confirmed by source
**Affected features:** Reload, HMR, tests, secondary windows, memory, timers

### Evidence

- `src/components/Panel.ts:378-380` adds every instance to a static set and starts a
  global five-second heartbeat ticker.
- `src/components/Panel.ts:1089-1128` iterates the static set and installs global
  document listeners.
- `src/components/Panel.ts:1422-1465` has meaningful instance cleanup.
- `src/App.ts:535-560` destroys application modules.
- `src/app/panel-layout.ts:796-852` destroys overlays, banners, happy panels, and
  the map, but does not iterate `ctx.panels` and call `destroy()`.
- No caller of `Panel.stopHeartbeatTicker` was found.

### Impact

Hundreds of instances can remain reachable through the static set after teardown,
retaining observers, abort controllers, document handlers, timers, and
subscriptions. Reinitialization can duplicate work and state.

### Recommendation

Make the panel registry an owner, not a loose dictionary. During
`PanelLayoutManager.destroy()`:

1. Deduplicate `Object.values(ctx.panels)`.
2. Destroy every owned panel.
3. Clear the registry and references.
4. Stop static tickers and global listeners when the instance set becomes empty.

### Acceptance criteria

- An init/destroy/init test ends each cycle with zero old instances.
- Active recurring-loop, observer, subscription, and timer counts return to the
  pre-init baseline.
- Destroy is idempotent.

## CBR-005: Diagnostics can recommend "all healthy" with 35 failures

**Priority:** P1
**Confidence:** Confirmed by live `window.cbDiag` output
**Affected features:** System status, safety case, operator decisions, support

### Evidence

The reviewed live session returned:

```text
totalSources: 123
healthy: 32
degraded: 0
failing: 35
silent: 0
unknown: approximately 56
recommendation: "All sources within expected freshness windows."
```

The `unknown` count is not present in `DiagnosticReport`, even though unknown is a
valid source status.

- `src/services/api-diagnostic.ts:186-192` counts healthy, degraded, failing, and
  silent but omits unknown.
- `src/services/api-diagnostic.ts:205-220` only warns for offline state,
  risk-required failing/silent sources, three or more tripped breakers, or silent
  sources.
- If none of those conditions match and at least one source is healthy, line 220
  claims all sources are within freshness windows, regardless of ordinary failing
  or unknown sources.
- An unknown risk-required source is excluded from `requiredSourcesFailing`, while
  its own notes say degradation reduces signal quality.

### Impact

The feature designed to answer "can I trust the system right now?" can return a
false-green answer. This is more dangerous than no diagnostic.

### Recommendation

Define an explicit aggregate health state and reason codes. Unknown must not imply
healthy. Recommendations should derive from exhaustive status counts and required
capabilities, not a handful of special cases.

Use one health contract for the renderer, sidecar, CLI, Safety Case, and status
strip. Add consistency invariants such as:

```text
healthy + degraded + failing + silent + unknown = totalSources
aggregate=healthy implies every required source is healthy or explicitly optional
```

### Acceptance criteria

- The reproduced snapshot cannot produce a healthy recommendation.
- Unknown sources are counted and visible.
- Required unknown sources lower aggregate confidence.
- Renderer, sidecar, and CLI fixtures yield the same verdict.
- A diagnostic contract test covers mixed healthy/failing/unknown input.

## CBR-006: Required renderer suite is red

**Priority:** P1
**Confidence:** Reproduced
**Affected features:** Command palette, i18n, PR smoke workflow

### Evidence

`npm run test:renderer` produced 12,586 passing tests and one failure:

```text
TypeError: import.meta.glob is not a function
```

The failure originates at `src/services/i18n.ts:15`, imported by
`src/services/command-palette/__tests__/command-palette-panel.test.mts`.
`.github/workflows/smoke.yml:32` runs this suite.

### Recommendation

Move locale discovery behind an injectable adapter. The pure test path should not
execute Vite-only `import.meta.glob`, or the test bootstrap must supply a faithful
glob fixture. Avoid a test-only global that diverges from production behavior.

### Acceptance criteria

- The isolated command-palette test passes.
- Full `test:renderer` passes.
- A regression test proves locale discovery works in both Vite and Node test
  environments.

## CBR-007: API test expires as the calendar advances

**Priority:** P1
**Confidence:** Reproduced
**Affected features:** Economic stress, OFR data, API reliability

### Evidence

`npm run test:api` produced 222 passing tests and one failure.

`api/__tests__/economic-stress.test.mjs:108-132` uses a fixed 2026-04-15 fixture.
`api/economic/stress.js:135-149` applies a rolling 90-day window. On 2026-07-26 the
fixture is outside the window, so `ofr.latest` is `null`.

### Recommendation

Inject a clock into rolling-window normalization or construct fixtures relative to
a frozen test clock. Do not loosen the production freshness window to make the
test pass.

### Acceptance criteria

- The test produces the same result on any wall-clock date.
- Boundary cases at 89, 90, and 91 days are explicit.
- `npm run test:api` runs in CI.

## CBR-008: Major test surfaces do not gate PRs

**Priority:** P1
**Confidence:** Confirmed by workflow inspection
**Affected features:** API, sidecar routes, desktop integration, E2E, variants

### Evidence

The repository has 1,038 test/spec files:

```text
src:       617
tests:     292
src-tauri:  58
api:        45
e2e:        11
tools:      11
scripts:     4
```

The renderer glob correctly covers all 617 `src/**/*.test.mts` files. The problem
is outside that set:

- No workflow invokes `npm run test:api`.
- No workflow invokes the full `npm run test:sidecar`.
- No workflow invokes `npm run test:e2e` or an equivalent Playwright matrix.
- Smoke CI runs offline replay, the renderer suite, cognition benchmark, MCP
  tests, and a seven-file security-hardening slice.

### Impact

The current API failure can merge unnoticed. Sidecar route and integration
regressions outside the hardening slice can also merge. Variant identity is never
verified end to end.

### Recommendation

Add CI jobs with path-aware triggers but mandatory rollup checks:

- API suite.
- Full sidecar suite on Node 22.
- Fast Chromium smoke for all variants.
- Full-app accessibility scan.
- Desktop compile/check on relevant paths.

Keep the offline smoke and hardening suites.

### Acceptance criteria

- Every root test family has a CI owner and command.
- Required checks cannot be skipped by a path-filtered job without a successful
  rollup result.
- The intentionally failing API test blocks a test branch.

## CBR-009: PWA precaches obsolete ignored vault frames

**Priority:** P1
**Confidence:** Confirmed by build output
**Affected features:** Web install, first load, updates, storage, bandwidth

### Evidence

- `vite.config.ts:762-765` precaches every built JS, CSS, icon, PNG, SVG, WOFF2,
  and JSON file under 6 MiB.
- `.gitignore:38-42` says the old vault frame assets were replaced.
- The local `public/` directory contains 150 ignored vault PNGs totaling 183 MiB.
- The generated service worker contains 586 revisions and all 150 vault frames.
- The build reported a precache size of 208,207.80 KiB.
- The current `dist/` uses approximately 217 MiB on disk.

### Impact

An untracked local asset can silently change the release artifact. PWA install and
update cost can exceed 200 MiB, despite the assets no longer being part of the
feature.

### Recommendation

Make the build hermetic:

- Add explicit Workbox ignores for obsolete/generated local assets.
- Prefer an allowlist of true app-shell assets.
- Add a precache byte and entry-count budget to CI.
- Build release artifacts from a clean checkout.

Do not delete the user's ignored local frame files as part of the fix. Exclude them
from the build.

### Acceptance criteria

- A clean and dirty checkout produce the same manifest.
- No vault frame appears in `sw.js`.
- Precache bytes and entry count are printed and budgeted in CI.

## CBR-010: Network failures masquerade as legitimate empty data

**Priority:** P2
**Confidence:** Confirmed pattern; migrate provider by provider
**Affected features:** Panels, fusion, alerts, health, stale-data behavior

### Evidence

Examples:

- `src/services/acaps.ts:17-25` returns `[]` for unavailable feature, non-OK HTTP,
  and exceptions.
- `src/services/newsapi.ts:26-36` returns `[]` for the same distinct states.
- A conservative text scan found 99 service files containing `fetch`, `catch`, and
  `return []`; this is a migration inventory, not proof that every instance is a
  bug.

The live diagnostic session showed both "no data" errors and many unknown sources,
confirming that empty/failure state is difficult to classify consistently.

### Impact

Callers cannot distinguish:

- Feature disabled.
- Healthy source with zero current records.
- Upstream failure.
- Invalid schema.
- Stale cached fallback.

This can suppress warnings and contaminate correlation confidence.

### Recommendation

Adopt a shared result contract:

```ts
interface FetchResult<T> {
  data: T;
  status: 'fresh' | 'stale' | 'degraded' | 'disabled';
  source: string;
  fetchedAt: number;
  errorCode?: string;
}
```

Centralize provider state, stale-cache fallback, and retry metadata. An empty array
may be valid data, but it must not be the error channel.

### Acceptance criteria

- Safety and alert sources migrate first.
- UI renders distinct empty, stale, disabled, and failed states.
- Fusion excludes or downweights degraded inputs explicitly.
- Tests cover healthy-empty and failed-empty separately.

## CBR-011: External JSON is trusted with compile-time assertions

**Priority:** P2
**Confidence:** Confirmed pattern
**Affected features:** 100+ provider and API response paths

### Evidence

A source scan found 105 cases of:

```ts
await someResponse.json() as SomeType
```

Representative paths include `src/app/data-loader.ts`, disease intelligence,
maritime safety, evacuation routing, NWS forecasts, ADS-B, and weather services.
A TypeScript assertion does not validate runtime data.

### Impact

Provider schema drift reaches normalization and rendering as `undefined`, invalid
numbers, malformed dates, or unexpected nesting. Failures occur far from ingress
and are harder to attribute.

### Recommendation

Validate at ingress with small runtime schemas or generated decoders. Keep schemas
close to the provider adapter, normalize only validated records, and record
schema-rejection metrics with redacted samples.

### Acceptance criteria

- High-impact providers reject malformed fixtures deterministically.
- Schema rejection appears in provider health.
- A provider returning HTML with HTTP 200 is classified as invalid response, not
  "empty."

## CBR-012: Raw HTML sink has a verified user-input injection path

**Priority:** P1
**Confidence:** Confirmed HTML injection; script execution not claimed
**Affected features:** Panel rendering, IP Info, renderer trust boundary

### Evidence

- `src/components/Panel.ts:883-925` ultimately assigns arbitrary strings to
  `this.content.innerHTML`.
- `src/components/IpInfoPanel.ts:72-85` includes the raw invalid IP input in
  `currentError`.
- `src/components/IpInfoPanel.ts:158-168` interpolates `currentError` into HTML
  without escaping.
- `src/components/ipinfo-tab.ts` correctly escapes other inputs, which makes this
  error path an identifiable gap.

### Impact

An operator can inject markup into the renderer by entering an invalid IP-shaped
string. Current CSP reduces some script paths, but markup injection is still real.
The renderer also has authenticated sidecar access and broad feature state, so
defense in depth matters.

### Recommendation

Immediate fix: escape `currentError` and the loading interpolation, with a
regression test using hostile markup.

Architectural fix: make text/DOM-node rendering the safe default. Isolate raw HTML
behind a `TrustedHTML`-style API that requires sanitization or explicit review.

### Acceptance criteria

- Hostile IP input renders as text.
- A test fails if a panel error message creates an element.
- New raw `innerHTML` entry points are linted or code-reviewed centrally.

## CBR-013: Content Security Policy has three drifting sources

**Priority:** P2
**Confidence:** Confirmed
**Affected features:** Web, Tauri, Vercel, analytics, WASM

### Evidence

- `index.html:7` defines one CSP and allows `unsafe-eval`.
- `src-tauri/tauri.conf.json:16` defines another and allows `unsafe-eval` plus
  `wasm-unsafe-eval`.
- `vercel.json:16` defines a third and allows `unsafe-inline` plus
  `wasm-unsafe-eval`.
- Lighthouse reported a CSP issue for the Vercel analytics script in the reviewed
  local session.

### Impact

Security behavior differs by target and changes can be applied to only one surface.
It is unclear which unsafe directive is genuinely required.

### Recommendation

Generate target CSPs from one typed source with documented per-target deltas.
Inventory the exact dependency requiring each unsafe directive. Add tests that
assert effective directives for web and desktop.

### Acceptance criteria

- One source produces all target CSPs.
- Each unsafe directive has an owner and rationale.
- Analytics consent and CSP behavior agree.
- CSP tests fail on undeclared connect/script origins.

## CBR-014: External content lacks semantic prompt-injection boundaries

**Priority:** P2
**Confidence:** Confirmed architectural gap
**Affected features:** Claude agent, summaries, forecasts, cognition integrity

### Evidence

- `api/claude-agent.js:197-228` includes external GDELT headlines in tool results.
- `api/claude-agent.js:294-376` sends tool results back to the model without an
  explicit system rule that source content is untrusted data.
- `src-tauri/sidecar/local-api-server.mjs:5162-5177` interpolates external
  headlines into a summary prompt.
- `src/utils/prompt-sanitize.ts` removes control characters and bounds length; it
  does not and cannot establish semantic trust.

### Impact

A headline or feed record can contain instructions that manipulate analysis. The
current tools are read-only, so the primary risk is corrupted intelligence output,
false confidence, and misleading recommendations rather than direct mutation.

### Recommendation

- Delimit external records as untrusted data.
- Add a system rule never to follow instructions contained in records.
- Require citations and source IDs in generated claims.
- Add confidence/abstention behavior when sources conflict.
- Maintain a malicious-headline regression corpus.

### Acceptance criteria

- Injection fixtures do not alter requested task or system policy.
- Generated claims preserve source attribution.
- Tool schemas and prompt builders distinguish trusted instructions from data.

## CBR-015: Observability suppresses broad actionable errors

**Priority:** P2
**Confidence:** Confirmed
**Affected features:** Sentry, support, provider outages, storage, map runtime

### Evidence

`src/main.ts:27-139` ignores broad classes including IndexedDB connection loss,
dynamic-import failures, quota errors, and generic timeout text.
`src/main.ts:140-157` drops every `TypeError` whose frames are entirely in map
chunks.

The live browser simultaneously logged numerous JSON parse errors, CORS failures,
and failed feeds.

### Impact

Real regressions can disappear from telemetry because they resemble historically
noisy failures. Operators see panel degradation without enough evidence to group
or prioritize it.

### Recommendation

Replace blanket ignores with:

- Stable fingerprints.
- Rate limits and sampling.
- Provider/variant/runtime tags.
- Expected-vs-unexpected error codes.
- A small retained evidence sample.

### Acceptance criteria

- Dynamic-import and storage-loss regressions remain observable.
- Known noisy failures are sampled, not erased.
- Provider health and Sentry share stable reason codes.

## CBR-016: Full-app accessibility baseline is 85/100

**Priority:** P2
**Confidence:** Confirmed by Lighthouse and keyboard testing
**Affected features:** Core shell, replay, summary, consent, all-panel DOM

### Evidence

Desktop Lighthouse against the live full app:

```text
Accessibility: 85/100
Failed audits: 7 total across accessibility, best practices, and agentic browsing
```

Verified accessibility failures:

- `src/app/layout/html.ts:202` and `:251` render `#regionSelect` without a label.
- `src/components/AlertReplayScrubber.ts:52-58` renders the replay slider without
  an accessible name.
- `src/components/SummaryStrip.ts:201-233` gives alert and freshness buttons
  accessible names that omit their visible text, producing label/content mismatch.
- `src/styles/main.css:19463-19466` produces 4.28:1 contrast for the 8 px ACTIVE
  badge, below the required 4.5:1.
- Live DOM inspection found 335 controls, 220 without programmatically associated
  labels, including 122 displayed controls. This heuristic includes offscreen
  panels and requires component-by-component triage.
- The live page had 2,413 displayed interactive elements smaller than 44 by 44 px.
  Compact desktop controls do not all require a 44 px box, but 14-16 px panel
  buttons are materially hard to target.
- With the first-run analytics consent element present as a dialog, the first Tab
  focused the underlying Home Shell command button; the next Tab focused Library.
  `src/components/AnalyticsConsentBanner.ts:29-97` neither focuses the choice nor
  places it early in keyboard order.

### Recommendation

Fix the core shell first, then shared panel primitives:

1. Label every select, input, slider, and icon-only button.
2. Make accessible names contain visible text.
3. Add shared minimum hit-area styling for icon controls.
4. Fix contrast tokens rather than one-off colors.
5. Give first-run dialogs intentional focus behavior.
6. Reduce mounted panel count; an accessibility tree with thousands of controls is
   itself an operability problem.

### Acceptance criteria

- Lighthouse accessibility reaches 100 for the default shell.
- Axe reports zero serious/critical violations in the shell.
- Keyboard flow reaches first-run choices predictably.
- Shared panel controls pass label and hit-area tests.
- Reduced-motion behavior is verified.

## CBR-017: Accessibility regression tooling does not protect PRs

**Priority:** P2
**Confidence:** Confirmed
**Affected features:** Axe, Playwright, shared UI

### Evidence

- `e2e/a11y-baseline.spec.ts` scans the dashboard and seven panels.
- `e2e/a11y-baseline.json` already records eight dashboard violation types.
- The spec only fails when the total violation count increases.
- `e2e/a11y-baseline.spec.ts:123-127` logs a new violation ID but does not fail if
  another violation disappears and the count stays equal.
- Playwright is not invoked by PR CI.

### Recommendation

Make the shell and shared primitives zero-baseline. For temporarily accepted panel
violations, compare stable fingerprints or exact rule/selector allowlists with
owners and expiry dates. Fail on any new rule or node.

### Acceptance criteria

- Accessibility job is required in CI.
- A new violation type fails even if total count is unchanged.
- Baseline entries have owner, reason, and expiration.

## CBR-018: Core modules are too concentrated and barrels defeat splitting

**Priority:** P2
**Confidence:** Confirmed
**Affected features:** Sidecar, map, data loader, panel layout, bundle graph

### Evidence

```text
18,934 lines  src-tauri/sidecar/local-api-server.mjs
 6,718 lines  src/components/DeckGLMap.ts
 4,508 lines  src-tauri/src/main.rs
 4,198 lines  src/app/data-loader.ts
 3,498 lines  src/app/panel-layout.ts
```

`src/components/index.ts` and `src/services/index.ts` re-export large portions of
the product. Core paths import these barrels. Vite emitted many warnings where a
module is both statically and dynamically imported, preventing intended chunk
separation.

The current bundle check still passes:

```text
Total initial JS: 4.71 MiB of 6 MiB
Panels gzip:      1.09 MiB of 1.2 MiB
Main gzip:        429.4 KiB of 460 KiB
```

The panels and main chunks are close enough to their caps that feature growth will
keep creating emergency budget pressure.

### Recommendation

Refactor by seam, not by arbitrary file size:

- Sidecar route modules with explicit dependencies and shared security middleware.
- Map layer registry and interaction controller.
- Data-loader domain adapters.
- Panel manifest/factory and layout renderer.
- Direct imports for lazy feature boundaries.

### Acceptance criteria

- Dynamic imports create distinct chunks without static-import warnings.
- Sidecar route security tests run against extracted modules.
- Core module budgets are tracked.
- No new import barrel crosses a lazy boundary.

## CBR-019: Full lint baseline is not actionable

**Priority:** P2
**Confidence:** Reproduced
**Affected features:** Maintainability, refactors, contributor feedback

### Evidence

`npm run lint` reported:

```text
1,548 errors
65 warnings
```

Some are generated-data or rule-noise issues, but many are real. PR CI runs
`npm run lint:ci`, which checks changed TypeScript/JavaScript only. That protects
new edits but leaves the baseline effectively unauditable.

### Recommendation

Create an explicit baseline file or debt partition, exclude generated artifacts,
and burn down rule families in small PRs. Do not disable useful rules globally to
make the number fall.

### Acceptance criteria

- Generated code has narrow exclusions.
- Existing debt is recorded and cannot grow.
- New/changed code is clean.
- A dated plan reaches a clean full lint.

## CBR-020: Sensitive user-created data remains plaintext at rest

**Priority:** P2
**Confidence:** Confirmed in current storage paths and prior privacy audit
**Affected features:** Saved places, geofences, webhooks, reasoning memory

### Evidence

- `src/services/saved-places.ts` stores saved-place coordinates in localStorage.
- `src/services/custom-geofence.ts` and `src/services/geofence-alerts.ts` persist
  geofence data in localStorage.
- `src/services/webhook-dispatcher.ts:92-113` stores webhook configuration in
  localStorage.
- `src/services/reasoning-memory.ts` stores reasoning history in IndexedDB.
- `docs/PRIVACY_AUDIT_2026-06-11.md:144-146` previously recorded the wider set of
  plaintext user data; the above current paths remain.

### Impact

Home/work/medical coordinates, watch configuration, webhook endpoints, and
reasoning history are available to the local webview profile and backups. FileVault
is a useful machine-level control but does not provide app-level separation.

### Recommendation

Use an OS-keychain-backed local data key on desktop and the existing web-vault
derivation path on web. Prioritize saved-place coordinates and webhook secrets.
Add export, clear-data, retention, and migration behavior.

### Acceptance criteria

- New sensitive records are encrypted at rest.
- Migration is resumable and fail-closed.
- Clearing the app removes encrypted data and keys as documented.
- Logs and diagnostics never export plaintext personal records.

## CBR-021: Local YouTube bridge uses wildcard messaging

**Priority:** P3
**Confidence:** Confirmed; current payload is low sensitivity
**Affected features:** Live news, webcams, desktop embed bridge

### Evidence

- `src-tauri/sidecar/local-api-server.mjs:5630-5644` posts playback messages to
  `window.parent` with target origin `*` and accepts message events without an
  origin check.
- `api/youtube/embed.js:108-160` has the stronger pattern: validated
  `parentOrigin`, source/origin checks, and scoped replies.
- Renderer receivers do some source checks, but the local bridge remains broader.

### Recommendation

Mirror the cloud bridge. Pass an allowlisted parent origin, validate source and
origin, and validate the message schema.

### Acceptance criteria

- Wildcard target origins are removed.
- Unexpected origins and malformed messages are ignored in tests.

## CBR-022: Privilege and secret access are broader than feature need

**Priority:** P2
**Confidence:** Confirmed architectural concern
**Affected features:** Runtime config, settings, clipboard, renderer blast radius

### Evidence

- `src/services/runtime-config.ts:1064-1068` returns a cloned snapshot containing
  the full runtime secret map.
- Multiple general renderer services consume runtime snapshots rather than
  feature-scoped credentials.
- `src-tauri/capabilities/default.json` grants clipboard read access to the main,
  settings, and live-channels windows.
- The identified clipboard read use is the setup wizard; most other clipboard
  operations are writes.

### Recommendation

Replace broad snapshots with capability-scoped accessors that return only the
credential or presence bit required by one provider. Split Tauri capabilities by
window and workflow; only the setup context should read the clipboard unless a
verified feature requires it.

### Acceptance criteria

- A panel cannot enumerate unrelated configured secrets.
- Live-channels cannot read clipboard content without a documented feature need.
- Capability tests assert least privilege per window.

## CBR-023: Published product counts disagree with runtime

**Priority:** P3
**Confidence:** Confirmed
**Affected features:** README, SEO metadata, operator expectations

### Evidence

- Runtime config: 408 panels, 407 enabled, 77 layers.
- `README.md:20` says 407 live panels.
- `README.md:26` says the full variant has 404 panels.
- `index.html:13` and `vite.config.ts:57` advertise 264 panels and 75 layers.

### Recommendation

Generate counts from the feature manifest during docs/build checks. Avoid embedding
manual numbers in multiple sources.

### Acceptance criteria

- README, HTML metadata, manifest, and runtime derive from one count source.
- CI fails when generated metadata is stale.

## CBR-024: `checkup` consumes a stale health contract

**Priority:** P2
**Confidence:** Confirmed by CLI against the installed app
**Affected features:** Developer checkup, support, release confidence

### Evidence

`npm run checkup` completed 1,427 tests and reported Yellow:

```text
Could not find keychain-secrets line
Heartbeat stale by 392s
20 panel fetch errors
```

The installed sidecar's `/api/health` response simultaneously reported:

```text
ok: true
keys_configured: 0
keys_total: 37
keys_missing_count: 37
feeds: 4 entries
```

- `scripts/checkup.mjs:110-121` infers key count from log wording instead of the
  health response.
- `scripts/checkup.mjs:168-170` looks for `data.feed_health`.
- `src-tauri/sidecar/local-api-server.mjs:5807-5824` actually returns
  `keys_configured`, `keys_total`, and a `feeds` array.
- `scripts/smoke.mts` already understands the current schema, so the repository has
  two diverging health clients.

### Impact

The CLI misses the actionable fact that zero credentials are configured and fails
to report the four tracked feeds. Operator tooling can drift without a shared
contract test.

### Recommendation

Create one typed health client/decoder used by smoke, checkup, renderer, and tests.
Use live response fields first and logs only for supplemental evidence.

### Acceptance criteria

- The reproduced response reports `0/37 keys` and `4 feeds`.
- Health payload fixtures are contract-tested against the sidecar producer.
- Checkup and smoke cannot diverge on verdict or field names.

## Cross-cutting product recommendation

Crystal Ball should expose features through mission packs instead of enabling
nearly every panel:

- **Personal safety:** saved places, official alerts, weather, air, power, routes.
- **Global watch:** situations, conflicts, sanctions, logistics, source confidence.
- **Cyber:** CISA, CVE, IOC, outages, infrastructure.
- **Markets:** macro, commodities, freight, prediction markets.
- **Operations:** feed health, diagnostics, safety case, replay, quality debt.

Each pack should declare:

- Required and optional providers.
- Default visible panels.
- Background services.
- Alert policies.
- Offline behavior.
- Secrets/capabilities.
- Health and confidence rollup.
- Cleanup function.

This preserves the feature catalog while making startup, trust, and operator
attention proportional to the chosen mission.

## Controls to preserve

The review found strong foundations that should not be weakened:

- Sidecar binds to loopback and uses timing-safe bearer authentication.
- Host/CORS/SSRF guards and redirect pinning have focused hardening tests.
- Request body and cache sizes are capped.
- Renderer fetches receive a global timeout and desktop fallback behavior.
- `RefreshScheduler` supports visibility pause, backoff, jitter, and bounded flush
  concurrency.
- Secrets scan passed across the tracked repository.
- Lockfile and version consistency checks passed.
- TypeScript application/API checks passed.
- `cargo check` passed with only dead-code warnings.
- Full build and bundle budgets passed.
- Sidecar and MCP suites passed.
- GitHub actions are SHA-pinned in reviewed workflows.
- Analytics is opt-in in the current implementation.
- An axe baseline and provider diagnostics system already exist; improve them
  rather than replacing them blindly.

## Baseline verification evidence

| Check | Result |
| --- | --- |
| `npm run typecheck:all` | Pass |
| `cargo check` | Pass; five dead-code warnings |
| `npm run build:full` | Pass |
| `npm run bundle:check` | Pass |
| `npm run test:sidecar` | Pass |
| MCP server tests | Pass; 99/99 |
| `npm run test:sec-hardening` | Pass; 69/69 |
| `npm run secrets:scan` | Pass; 4,156 files |
| `npm run lockfile:check` | Pass |
| `npm run version:check` | Pass |
| `npm run checkup` | Yellow; 1,427 tests pass, three warnings |
| `npm run test:renderer` | Fail; 12,586/12,587 pass |
| `npm run test:api` | Fail; 222/223 pass |
| `npm run lint` | Fail; 1,548 errors, 65 warnings |
| Lighthouse accessibility | 85/100 |
| `npm audit` | Inconclusive; npm advisory response was malformed twice |

The npm audit result is not a clean bill of health. It was unavailable because the
registry advisory response could not be decoded, including after a network-enabled
retry.

The local `.env.local` file was mode `0644`. The sidecar's plaintext credential
loader has fail-closed checks, but the operator should change the file to `0600`
outside this review if it contains credentials. Do not print or commit its values.

## Implementation verification evidence

| Check | Result |
| --- | --- |
| `npm run typecheck:all` | Pass |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Pass; five existing dead-code warnings |
| `npm run build` | Pass |
| Production PWA budget | Pass; 436 entries / 20.46 MiB, zero vault frame entries |
| `npm run test:renderer` | Pass; 12,629/12,629 |
| `npm run test:api` | Pass; 224/224 |
| `npm run test:sidecar` | Pass; 458/458 |
| `npm run test:data` | Pass, including release, bundle, and feature-registry contracts |
| `npm run lint:strict` | Pass |
| `npm run lockfile:check` | Pass |
| `npm run secrets:scan` | Pass; 4,176 files |
| GitHub Dependabot package versions | All 21 disclosed alerts moved to patched versions in the branch lockfiles |
| Root dependency install | Pass; Sharp 0.35.3 completed a PNG encode/decode smoke test |
| Variant Playwright identity matrix | Pass; full, tech, finance, happy |
| Playwright axe baseline | Pass; 8/8 scopes |
| Lighthouse snapshot | Accessibility 100; 35/35 checks |
| MCP server tests | Pass; 99/99 |
| `npm run checkup` | Yellow; 1,427 tests, 12 checks, 0 failures, 3 operator-runtime warnings |
| Live `cbDiag.report()` | 16 healthy, 14 failing, 93 unknown; degraded recommendation |

The live provider failures above are expected in a Vite-only browser session
without deployed API routes and credentials. The relevant regression is that
they are now visible and no longer summarized as healthy.

GitHub disclosed 21 open Dependabot alerts on `main`. The implementation updates
all affected lockfile entries to GitHub's first-patched version or newer:
`fast-uri`, `sharp`, `dompurify`, `protobufjs`, both `brace-expansion` lines,
`js-yaml`, `hono`, `@hono/node-server`, `body-parser`, and `serde_with`. The MCP
install now reports zero known vulnerabilities. The first root CI audit exposed
newer npm-registry advisories in `brace-expansion`, `js-yaml`, and `postcss`;
those paths were moved to `brace-expansion` 5.0.8, the unaffected
`markdownlint-cli2` 0.22.1 / `js-yaml` 4.1.1 line, and `postcss` 8.5.23.
`glob` was also moved to 13.0.6 because 11.1.0 is deprecated as vulnerable.
The resulting local `npm ci` summary reports one high and two moderate
advisories. Treat that remaining registry high as unresolved until the next CI
audit log identifies its dependency path.

## Remaining Claude PR plan

Recommended follow-up PR boundaries:

1. `perf/lazy-mission-panel-factories`
2. `reliability/provider-result-contract-alerting`
3. `reliability/provider-result-contract-correlation`
4. `security/provider-scoped-secret-ipc`
5. `privacy/keychain-backed-user-data`
6. `chore/core-module-boundaries`
7. `chore/eslint-debt-slices`

Keep security, storage migration, lifecycle, and mechanical lint cleanup in
separate PRs. Preserve the regression tests and release gates added by this
branch.

## Required verification for implementation

Run the narrow test first for each finding, then the appropriate full gates:

```bash
npm run lockfile:check
npm run version:check
npm run typecheck:all
npm run lint:ci
npm run test:renderer
npm run test:api
npm run test:sidecar
npm run test:sec-hardening
(cd tools/mcp-server && npm test)
npm run test:e2e
npm run build:full
npm run build:tech
npm run build:finance
npm run build:happy
npm run bundle:check
npm run secrets:scan
cargo check --manifest-path src-tauri/Cargo.toml
npm run checkup
```

For accessibility work:

```bash
VITE_VARIANT=full npx playwright test e2e/a11y-baseline.spec.ts
```

Also inspect the generated service worker and assert:

```text
0 vault frame entries
precache bytes within the new budget
variant metadata matches the requested build
```

## Definition of done

The review is resolved when:

- Phase 0 checks are required and green.
- Desktop authentication behavior is honest and fail-closed if called secure.
- Default startup constructs only the mission shell and requested panels.
- Teardown releases every owned feature and global loop.
- Health cannot be green with failed or unknown required sources.
- Provider failures are distinguishable from healthy empty results.
- External data is validated before normalization.
- Raw user/provider text cannot reach an HTML sink unescaped.
- The default shell has no serious accessibility violations.
- Release artifacts are hermetic and variant-correct.
- Documentation and product counts are generated from the same manifest as runtime.
