# Usability Uplift — Handoff for Codex

- **Date:** 2026-08-23
- **Author:** Claude; corrected after Codex audit of `origin/main` @ `3bf6d23e`
- **Status:** ACTIVE — UX-000 MONITOR after merged PR #1660; packaged desktop verification pending
- **Audience:** Codex / ChatGPT sessions working this repo
- **Companion docs:** [`docs/superpowers/specs/2026-06-14-grand-strategy-survival-os-design.md`](superpowers/specs/2026-06-14-grand-strategy-survival-os-design.md) (the north star this measures against)

---

## How to use this document

1. Read the **Verified findings** section. It is evidence, not opinion — every
   finding includes either a command you can re-run or the exact code paths and
   method used. Do not re-derive it from scratch; if the evidence now returns
   something different, say so in your PR and update this doc.
2. Pick ONE `UX-NNN` task. Claim it by opening a draft PR whose title names the
   task, and set its row in the Progress Tracker to `IN PROGRESS` in the same PR.
3. Follow the normal delivery path in [`AGENTS.md`](../AGENTS.md): `codex/*` branch,
   PR, cross-agent review verdict (`codex/*` → reviewed by **Claude**), then
   `bash scripts/pr-closeout.sh`.
4. Update the tracker row to `DONE` with the PR number in the same PR that
   completes the work.

**Do not** bundle multiple `UX-NNN` tasks into one PR. They are ordered so each
ships an independently verifiable user outcome or prerequisite gate.

---

## The single finding that frames all of this

**The app's stated centerpiece is not on its default screen.**

The north star defines success as: *open it, and within ~10 seconds you know your
survival posture across every domain, the top threats with time-to-impact and
confidence, the single best move — and you can commit it.*

Measured against the current default surface, posture scores zero. The survival
engine is real, wired, and fed by live data. It is funnelled through one
library-tier panel and one concatenated HTML string.

**This is a surfacing problem, not an engine problem. Do not write new engines.**
The repo's own guardrail from the Surfacing & Coherence cycle — *no engine merges
without a read-surface* — is nominally satisfied and functionally violated here.

---

## Verified findings

Each row was verified against `origin/main` @ `3bf6d23e`. Re-run the shown
commands or inspect the named paths and method to confirm.

### F1 — Posture has zero presence on the default surface

```bash
grep -ci posture src/components/HomeShellOverlay.ts src/services/home-shell/*.ts
```

Returns `0` for all eight files. The Home Shell (default surface since Phase 2 for
the full desktop variant) renders three briefing bands — `personal`, `changed`,
`critical` (see `src/services/home-shell/briefing-view.ts`) — and none of them
carry posture, moves, or time-to-impact.

### F2 — Exactly one surface renders survival posture

```bash
grep -rln "survival-outlook\|SurvivalOutlook" src/components src/app --include="*.ts"
```

Returns only `src/components/StormPosturePanel.ts` (257 lines). Its registration:

- `src/config/panels.ts:321` → `'storm-posture': { name: 'Storm Posture', enabled: true, priority: 1 }`
- `src/config/panel-metadata.ts:403` → `tier: 'library'`, `domain: 'hazards-weather'`

So the multi-axis survival posture is discoverable only by knowing to look for a
weather panel, in the Library tier, among 408 panels.

### F3 — 16 imports collapse into one string

`StormPosturePanel.ts:126-129` calls `renderSurvivalOutlook(...)` and string-concatenates
the result: `` `${banner}${modeChips}${overall}${cards}${movesCard}${outlook}` ``.

`src/services/survival/survival-outlook.ts` aggregates:

```bash
rg -o "from './[^']+'" src/services/survival/survival-outlook.ts \
  | rg -v "survival-types" | sort -u | wc -l
```

```
comms-fallback  comms-fallback-view  decision-consequence  decision-consequence-view
grid-down-certify  grid-down-certify-view  offline-playbook  offline-playbook-view
posture-calibration  posture-trajectory  posture-trajectory-view  projection-calibration
retrospective-digest  retrospective-view  world-branches  world-branches-view
```

The list contains 14 runtime imports and two type-only calibration imports. It is
the currently wired user-visible output of epics **E5** (world branches,
decision-consequence), **E6** (grid-down certification, offline playbook, comms
fallback) and the E7 retrospective view — rendered as a fragment at the bottom
of one panel. Retrospective output is normally empty until a live calibration
store is wired, so this does not establish that all E7 behavior is live.

### F4 — Static reachability leaves 5 modules outside the app graph

Static reachability walk from real app entry points over
`src/services/survival/` (56 modules): **51 reachable, 5 not imported by
non-test app code.** This establishes wiring, not runtime health.

Entry points (imported by non-test app code): `board-events`, `scrubber-view`,
`storm-posture-state`, `survival-map-modes`, `survival-moves`, `survival-outlook`,
`survival-outlook-render`, `survival-types`, `time-scrubber`, `world-snapshot`.

Outside the app graph: `lens-board`, `lens-marker-apply`, `lens-marker-style`,
`scrubber-loop`, `survival-posture-view`.

They do not share one blocker:

- The three `lens-*` modules need a stable identity join between incoming events
  and Cesium entities before they can be mounted reliably.
- `survival-posture-view` is a tested, render-ready projection that UX-001 can
  mount; it does not depend on Cesium identity.
- `scrubber-loop` is pure loop bookkeeping, while `TimeScrubberHud` is already
  mounted in `GodsVisionView`. Treat timeline consolidation and map-cursor wiring
  as a design task, not as an unmounted-module task.

> **Note on method:** an earlier pass of this walk reported 46 unreachable. That
> was wrong — the edge regex missed the `.ts` extension used in relative imports
> (`from './survival-posture.ts'`). If you re-run a reachability check, match
> `from '\./([A-Za-z0-9._-]+?)(?:\.ts|\.js)?'`.

```bash
node --input-type=module - <<'NODE'
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const root = 'src';
const survival = 'src/services/survival';
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const appFile = (path) => path.endsWith('.ts')
  && !path.includes('/__tests__/') && !/\.test\.[cm]?ts$/.test(path);
const files = walk(survival).filter(appFile);
const byName = new Map(
  files.map((path) => [path.slice(survival.length + 1, -3), path]),
);
const importPattern = (prefix) => new RegExp(
  String.raw`(?:from\s*|import\s*\(\s*)['"]${prefix}([A-Za-z0-9._-]+?)(?:\.ts|\.js)?['"]`,
  'g',
);
const entries = new Set();
for (const path of walk(root).filter(
  (file) => appFile(file) && !file.startsWith(`${survival}/`),
)) {
  for (const match of readFileSync(path, 'utf8').matchAll(
    importPattern('@/services/survival/'),
  )) if (byName.has(match[1])) entries.add(match[1]);
}
const reachable = new Set(entries);
const queue = [...entries];
while (queue.length > 0) {
  const current = queue.shift();
  for (const match of readFileSync(byName.get(current), 'utf8').matchAll(
    importPattern('\\./'),
  )) if (byName.has(match[1]) && !reachable.has(match[1])) {
    reachable.add(match[1]);
    queue.push(match[1]);
  }
}
console.log({
  modules: files.length,
  reachable: reachable.size,
  outside: [...byName.keys()].filter((x) => !reachable.has(x)).sort(),
});
NODE
```

### F5 — Panel count is now a usability liability

```bash
sed -n '/^const FULL_PANELS:/,/^const TECH_PANELS:/p' src/config/panels.ts \
  | rg -o ': \{ name:' | wc -l
```

Returns **408**. The earlier 502 command was invalid because it continued through
the tech, finance, happy, and category maps. The `intelligence`
`PANEL_CATEGORY_MAP` entry
in `src/config/panels.ts:1239`
holds 307 panel keys. Library's 12 domains and ⌘K make panels *searchable*,
but you must already know what to search for.

### F6 — `CLAUDE.md` is stale on this point

At the reviewed base, `CLAUDE.md` states 406 panels in the Home Shell / Library
sections. The actual count is 408 (F5). This roadmap-integration PR corrects that
single stale number without reflowing the surrounding prose.

---

## Tasks

### UX-000 — Zero-key first-run contract *(do this before UX-001)*

Exit condition: Packaged desktop verification confirms the merged zero-key
first-run contract on the installed app.

Review after: 2026-08-31

The packaged zero-key runtime is still unmeasured. Static wiring shows only that
credentials are not universally required; it does not establish network,
upstream, provider, or data availability: 50 of 58 definitions in
`src/services/providers/provider-registry.ts` use no authentication, 66 of 78
entries in `src/services/runtime-config.ts` require no effective desktop secret,
and a disposable sidecar starts with zero provider/API keys (its local trust
token remains mandatory).

```bash
node --import tsx --input-type=module - <<'NODE'
const { PROVIDER_DEFINITIONS } =
  await import('./src/services/providers/provider-registry.ts');
const { RUNTIME_FEATURES } =
  await import('./src/services/runtime-config.ts');
const noAuth = PROVIDER_DEFINITIONS.filter((x) => x.authType === 'none').length;
const noDesktopKey = RUNTIME_FEATURES.filter(
  (x) => (x.desktopRequiredSecrets ?? x.requiredSecrets).length === 0,
).length;
console.log({ providers: PROVIDER_DEFINITIONS.length, noAuth,
  features: RUNTIME_FEATURES.length, noDesktopKey });
NODE
```

The first visible state is still misleading and not decision-useful:

- `WelcomeFlow` says listed sources work with "no key" while naming NewsAPI and
  OpenWeatherMap; both require configured keys in repository wiring.
- A clean Home Shell begins with an unavailable change digest and all 12 default
  Deck cards marked `not loaded`, without a readiness budget or clear next step.

- **Correct:** distinguish no-key sources from services with free-key tiers.
- **Show:** explicit startup/readiness progress and useful keyless coverage.
- **Require:** every default card settles to useful data or an actionable,
  truthful degraded state within a defined budget; it must not
  remain an indefinite loading placeholder.
- **Non-goal:** a broad provider rewrite. Fix the first-run contract, measure it,
  then proceed to posture surfacing.
- **Done when:** a clean zero-key run tells the user what works now, what is still
  loading, and exactly what an optional key would unlock.

### UX-001 — Posture band on the Home Shell

Dependencies: UX-000

Add survival posture to the default surface as a fourth briefing band.

- **Read from:** `storm-posture-state` — already an entry point, already fed live
  by `src/app/data-loader.ts`. Hydrate persisted posture once for cold/offline
  startup, then subscribe/unsubscribe to shared state; do not add a second fetch
  timer.
- **Reuse:** adapt the existing tested
  `src/services/survival/survival-posture-view.ts` projection, then render it in
  `src/components/HomeShellOverlay.ts`. Do not create a competing view-model.
- **Show:** overall band + the worst 2–3 axes and their lead-threat arrival and
  threat confidence. Do not present `AxisState.confidence` as epistemic
  confidence: production currently aliases its total to threat severity. Omit
  axis confidence until that contract is repaired. Likewise, omit trend unless
  it comes from a real prior-state comparison rather than the default `steady`.
- **Constraint:** the Home Shell is a **read-only** consumer of shared state
  (CommandCenterPanel is the single what-changed snapshot writer). Do not add a
  second writer. A stale, degraded, or non-secure posture must also prevent the
  shell's generic all-clear collapse.
- **Done when:** opening the app with no navigation shows current posture or an
  honest no-snapshot/stale state.

### UX-002 — "Best move now" + commit on the posture band

Dependencies: UX-001

- **Read from:** `buildSurvivalOutlook(...).decision.recommendedMoveId`, whose
  ranking path is `projectPostureTrajectory` → `buildWorldBranches` →
  `evaluateDecisionConsequences`. `null` means Hold.
- **Reuse:** `StormPosturePanel.ts` already implements working commit UI. Extract
  a scoped renderer/commit seam rather than reimplementing or adding another
  document-wide listener. Map the recommended ID back to the exact candidate and
  keep the `commitStormMove` path identical so after-action grading keeps working.
- **Show:** the single top-ranked move with its modeled effect, plus commit.
- **Done when:** the north star's "single best move to make now — and you can
  commit it" is true from the default surface.

### UX-003 — Give Emergency readiness its own reachable surface

Cornerstone #4 is "works at zero bars." Today `grid-down-certify`,
`offline-playbook`, and `comms-fallback` render as a fragment of a string inside a
weather panel (F3). The one thing that must be findable in an emergency is
currently the least findable thing in the app.

- Create one first-class, **read-only Emergency readiness** surface combining
  grid-down certification, offline playbook, comms fallback, and the current
  Lifelines v1 receipt. Show each capability independently with its capture time
  and expiry.
- The v1 receipt proves only a Lifelines snapshot. It must never make the whole
  Emergency Pack read "ready," and UX-003 must not change manifest schemas,
  storage, migration, or fabricate receipts for absent artifacts. UX-009
  exclusively owns the real multi-artifact Pack v2.
- Validate restored survival snapshots before use; do not cast untrusted
  localStorage JSON directly to `WorldSnapshot`.
- Must degrade correctly with the network disabled — that is the whole point of
  the feature. Verify offline, not just in tests.

### UX-004 — Make panels contextual instead of topical

Reuse what already exists rather than adding taxonomy: `src/config/panel-metadata.ts`
already carries `evidenceFor` keyed by `PlaybookCategory` (the situation dossier
consumes it).

- Add an explicit, curated **axis → panels** mapping so a degraded posture axis
  reveals a bounded, deduplicated, ranked set of relevant suggestions on the
  Deck. Keep contextual suggestions separate from persisted user pins.
- Include Disaster Lifelines for relevant supply, mobility, health,
  physical-safety, and energy/water states.
- Goal: panels stop being a 408-item catalog and become consequences of state.
- This is the task that actually pays down the panel count instead of managing it.

### UX-005 — Wire stable identity and mount the personal lens *(High Assurance)*

Exit condition: A producer-to-renderer stable-identity design is approved and
merged with explicit timeline-opacity composition rules.

Review after: 2026-09-01

Standardize stable identity at both incoming-event production and Cesium
entity-creation boundaries, compose existing timeline opacity with lens styling,
then mount `lens-board` / `lens-marker-apply` / `lens-marker-style`.

This remains blocked until the producer-to-renderer identity design lands — do
not start here. Adding IDs only at the renderer is insufficient because current
incoming-event and marker IDs do not consistently join.

### UX-006 — Correct the stale panel count in `CLAUDE.md` *(completed in #1659)*

Update 406 → 408 (F5/F6). PR #1659 makes only that factual `CLAUDE.md` correction.

### UX-007 — Truthful Lifelines discovery *(first Lifelines uplift)*

The server already enforces exact query radii and per-category caps. The panel
currently clamps explicit saved-place requests to 25 km and globally slices its
"All" results, which can hide whole categories.

- Offer explicit 5/10/25/50 km choices. A saved radius is the initial preference,
  not a ceiling on a later user selection.
- Guarantee category representation before filling remaining result slots.
- Show requested radius, returned coverage, and provider coverage/expiry. Say
  "none reported" only inside coverage proven by the current response.
- Put Call and Open in Maps actions directly on eligible result cards; keep the
  existing map-popup actions as well.
- Add no provider, sidecar route, secret, or operational-status inference.

### UX-008 — Immediate, observable Lifelines prewarm

When a user pins a place or explicitly selects Prepare offline, persist the
choice first and enqueue the exact selected Lifelines fingerprint immediately.

- Expose queued/fetching/verifying/ready/partial/failed/cooldown states through
  an accessible live status.
- Verify the written snapshot by reading it back before reporting ready.
- Reuse one coordinator for manual, startup, and storm-triggered preparation.
- Back off failed work with a retry action; never turn failure into a success
  cooldown.

### UX-009 — Real multi-artifact Emergency Pack v2 *(High Assurance)*

Replace the current lifelines-only "pack ready" shortcut with receipts for
artifacts that were actually captured and read-back verified:

- exact Lifelines snapshot;
- scoped alerts;
- validated primary route (alternate optional);
- bounded offline-map coverage;
- bounded comms/contacts export.

Show readiness and expiry per artifact. Migrate v1 manifests as partial,
lifelines-only packs; never promote them to complete. Stage replacement so a
failed refresh cannot erase the last known-good pack. This task requires the
High Assurance storage/migration approval gate before implementation.

### UX-010 — Explicit current-location Lifelines mode *(High Assurance)*

Add a click-initiated, session-only location anchor:

- disclose permission, accuracy, and observation time;
- handle denial, stale fixes, and zero-valued coordinates honestly;
- do not continuously watch, log, analyze, persist, or include the location in a
  pack without a second explicit save/prepare action.

This task requires the precise-location privacy approval gate. Do not add a new
Tauri permission/plugin without a separate design and approval.

### UX-011 — Hazard and closure exposure, never "safe" routing *(High Assurance)*

Keep route computation separate from hazard evidence. Report only:

- reported intersection/impact;
- no reported intersection within the explicitly covered, current feeds; or
- unknown.

Start with existing allowlisted NWS/IPAWS geometry where it is jurisdictionally
applicable. Add 511/WZDx feeds one jurisdiction at a time only after a live body
probe and usage-rights review. Never label a site or route safe, clear, or open
from missing data. This safety-critical reasoning/provider task requires the
High Assurance approval gate.

### UX-012 — Outage coverage matrix and provider telemetry

First surface the evidence already available from ODIN and provider health:
accepted, dropped, and contributed rows; observation time/expiry; covered versus
unknown geography; and the exact source behind every claim. A provider that
contributed zero valid observations must not count as healthy corroboration.

Any new outage origin, sidecar route, allowlist, secret, or cross-provider
reconciliation belongs to tracked High Assurance task UX-015 with live
response-body evidence. Never sum overlapping providers or turn uncovered empty
data into zero outages.

### UX-013 — Hotel operational evidence *(High Assurance provider task)*

Keep OSM lodging as directory-only. Add an operational hotel adapter only if its
license permits the required display/cache behavior and a live probe proves the
consumed schema. Every row must identify source, coverage, observation time, and
expiry. Never infer vacancy, power, access, or availability from a listing,
hours, price, capacity arithmetic, or HTTP 200. If no suitable source exists,
ship only Call/Open in Maps/confirm-directly actions and retain `unknown` status.

### UX-014 — Fuel operational evidence *(High Assurance provider task)*

Keep OSM fuel sites as directory-only. Add operational fuel evidence only behind
the same license, live-probe, bounded-timeout, cache, allowlist, health, and
expiry contract as UX-013. Never infer fuel inventory, power, access, or queue
conditions from a listing, price, hours, or missing report. Hotel and fuel remain
separate PRs so one provider cannot broaden the other's truth boundary.

### UX-015 — New outage provider integration *(High Assurance provider task)*

Add at most one new outage origin per PR after a live response-body probe,
coverage/overlap design, and usage-rights review. Normalize at the provider
boundary, record accepted/dropped/contributed counts, and keep the source
independent from ODIN unless evidence proves otherwise. A valid HTTP response
with zero accepted observations cannot cast a healthy corroboration vote.

### UX-016 — Consolidate timeline controller and cursor wiring *(High Assurance)*

`TimeScrubberHud` is already mounted. Select one timeline controller, connect it
to map-cursor behavior, and remove redundant loop ownership without adding a
second animation loop. Compose its opacity contract with UX-005 lens styling so
two independent writers cannot fight over marker alpha.

### UX-017 — Complete fail-closed Mac main-sync toolchain repair

Implementation merged through PR #1667. Post-merge operational verification is
still required: when this task was added, the local sync agent was in its build
phase and had not yet recorded a successful installation of current `main`.

Dependencies: none

Exit condition: the LaunchAgent installs the merged commit through
`npm run main-sync:run` with Cargo available from
`/Users/bradleybond/.cargo/bin`, Node 22 selected, all required checks green,
and `status.json` recording a successful installation.

Review after: 2026-08-25

- **Change surface:** `scripts/setup-main-sync-agent.mjs`,
  `scripts/sync-main-to-mac.mjs`, and `tests/main-sync-agent.test.mjs` in #1667.
- **Preserve:** the canonical `~/Applications/Crystal Ball.app` target and every
  fail-closed lockfile, typecheck, build, packaging, signing, and required-check
  gate. Do not substitute manual app copying for the installer.
- **Verify:** rerun `npm run main-sync:setup`, then `npm run main-sync:run`, and
  confirm the installed commit and successful phase in
  `~/.crystalball-main-sync/status.json`.

### UX-018 — Restore timely, authoritative forecast resolution

The 2026-08-24 live diagnostic snapshot reported 320 uncertain proxy labels,
348 late resolutions, and 12 overdue outcomes. Treat those counts as a baseline
to refresh, not immutable acceptance thresholds.

Dependencies: UX-017

- **Change surface:** `src/services/intelligence/prediction-resolver.ts`,
  `prediction-resolution-cadence.ts`, `outcome-resolvers.ts`, and the resolution
  quality audit and focused tests.
- **Fix:** make resolver cadence observable and reliable, improve corroboration,
  and increase direct-label collection. Preserve provenance and keep direct,
  proxy, manual, and LLM-derived outcomes separable.
- **Fail closed:** uncertain proxies must never silently become authoritative
  labels or promotion evidence, and stale upstream data must not resolve a
  forecast as though it were current.
- **Done when:** no eligible outcome is overdue for seven consecutive scheduled
  runs; late-resolution causes are classified; direct-label coverage improves;
  and the audit can account for every remaining proxy or unresolved outcome.
- **Verify:** focused resolver/audit tests, `npm run test:intelligence`,
  `npm run test:diagnostics`, `npm run typecheck:all`, and fresh packaged-runtime
  diagnostics after installing merged `main`.

### UX-019 — Recalibrate weak forecast algorithms without lowering safety floors *(High Assurance)*

Use the clean direct/manual evidence produced by UX-018 to replay and, only when
the holdout result supports it, refit `warning-verification`, `analyst-loop`, and
`hierarchical-base-rate`.

Dependencies: UX-018

- **Change surface:** the relevant prediction bridges and algorithm ledger,
  calibration, replay, safe-adjustment, tuning-fixture, and diagnostics modules.
- **Preserve:** current minimum evidence, safety recall, lead-time, calibration,
  and promotion floors. Never make a failing algorithm appear healthy by
  weakening its gate or mixing proxy outcomes into the direct-label cohort.
- **Quarantine:** `warning-verification` remains quarantined until a versioned
  candidate passes the existing safety fixtures and a frozen holdout replay.
- **Done when:** each algorithm has a reproducible before/after decision with
  matched cohorts, Brier/log-loss and calibration evidence, sample counts, and
  an explicit promote, retain, or reject result.
- **Verify:** `npm run test:algorithms`, `npm run test:intelligence`,
  `npm run bench:cognition`, `npm run test:diagnostics`, and the applicable
  champion/challenger promotion gate.

### UX-020 — Grow entity and analog evidence before tuning

The 2026-08-24 snapshot had only 10 entity-trajectory and 24 analyst-loop
evaluations; episodic-analog had 117. These are evidence-collection signals,
not permission to tune against a tiny or repeatedly reused cohort.

Dependencies: UX-018

- **Change surface:** entity-trajectory, episodic-analog, and analyst-loop
  emitters plus their outcome identity, grading, and diagnostics seams.
- **First:** prove eligible forecasts are emitted, uniquely joined, resolved,
  and graded exactly once. Classify missingness before changing weights.
- **Then:** improve evidence weighting only through a versioned challenger and
  frozen, time-ordered holdout comparison after the existing promotion sample
  floor is met. Shared target/window labels must remain deduplicated.
- **Done when:** diagnostics show why any record is excluded, each candidate
  reaches the existing evidence gate, and the resulting promote/retain/reject
  decision is reproducible without proxy-only support.
- **Verify:** focused emitter/grading tests, `npm run test:algorithms`,
  `npm run test:cognition`, `npm run bench:cognition`, and
  `npm run typecheck:all`.

### UX-021 — Classify and recover degraded optional feeds

The 2026-08-24 snapshot reported ACLED, ThreatFox, and AIS as failing, with
AirNow intermittently impaired. A red feed is not automatically a code defect:
the runtime must distinguish absent user-owned credentials, upstream outage,
rate limiting, schema drift, and local adapter failure.

Dependencies: UX-017

- **Change surface:** the affected provider adapters and the shared feed health,
  resilience, latency, diagnostics, and dashboard paths. Add provider code only
  where a fresh live response-body probe demonstrates an implementation defect.
- **Credentials:** document actionable setup for missing optional keys without
  storing or printing secrets. Credential absence must remain `not configured`,
  not be misreported as a healthy feed or a retryable outage.
- **Recovery:** keep bounded timeout, retry/backoff, freshness, provenance, and
  fail-closed semantics. Never infer zero events from missing coverage.
- **Done when:** each named feed has a reproducible state classification and
  either returns fresh validated observations or exposes a truthful actionable
  degraded state; intermittent recovery clears only after a healthy live probe.
- **Verify:** focused adapter/resilience tests, `npm run test:diagnostics`,
  `npm run smoke`, `npm run typecheck:all`, and packaged-runtime feed diagnostics
  using only credentials already configured by the user.

### UX-022 — Make OpenAQ sampling truthful and desktop-local

OpenAQ v3 global latest measurements are a changing offset-paginated sample,
not a completeness-proven global ranking. Keep the user-owned API key and
bounded collection in the desktop sidecar, and make web behavior explicitly
inapplicable rather than recording a failed or healthy provider vote.

- **Change surface:** OpenAQ sidecar collection, normalized renderer contract,
  panel loading/error/empty states, runtime fallback policy, and dead v2 route.
- **Security and reliability:** reject redirects before sending the API key;
  cancel rejected response bodies; bound pages, bytes, concurrency, retries,
  and deadline; invalidate cache and in-flight work on credential rotation.
- **Done when:** the panel says `Recent Highs` and discloses best-effort sample
  coverage; strict adapter output drives health; web performs no OpenAQ fetch;
  malformed, stale, partial, oversized, or all-dropped data fail closed.
- **Verify:** live response-body probes, focused renderer/sidecar mutation tests,
  `npm run test:openaq`, `npm run test:airquality`, `npm run test:providers`,
  `npm run test:sidecar`, and `npm run typecheck:all`.

### UX-023 — Truthful automatic Little Snitch local feed *(High Assurance)*

The Little Snitch panel currently tells the user to write an export file, but
the packaged sidecar does not receive the documented path and the legacy
exporter can fail silently after a Homebrew Node upgrade.

- **Change surface:** the Little Snitch exporter/installer, fixed local sidecar
  path wiring, strict snapshot validation, and the panel's missing/stale/empty
  states.
- **Privilege boundary:** no persistent root job may execute Homebrew Node,
  repository JavaScript, or another user-writable path. Automatic collection
  must authorize only a fixed root-owned read helper; sanitization and storage
  stay unprivileged.
- **Privacy and reliability:** raw traffic CSV remains in a bounded process pipe,
  snapshots are allowlisted, private, bounded, and atomically replaced, and a
  failed refresh cannot overwrite the last known-good snapshot.
- **Done when:** the packaged full desktop app discovers the documented export
  without shell environment setup, distinguishes ready/empty/missing/stale/
  invalid/permission states, and a five-minute background refresh survives a
  Node upgrade without restoring the unsafe legacy daemon.
- **Verify:** focused exporter/installer/sidecar/frontend tests with mutation
  proofs, Rust tests, `npm run typecheck:all`, `npm run secrets:scan`, the
  agentic validation gate, and an installed-app live probe that reports only
  schema, count, freshness, ownership, and mode.

### UX-024 — Persistent pane review trail *(High Assurance)*

Turn the existing alert-backed pane promotion into a finite, persistent review
workflow without changing alert scores, thresholds, or acknowledgement state.

- **Show:** every active unreviewed alert-backed pane in a fixed navigator with
  severity counts, Next unreviewed, Open, and Mark reviewed actions. Decorate
  mounted panes and sidebar entries with matching labeled severity accents so
  lower-ranked issues remain discoverable while scrolling.
- **Review semantics:** reviewing records the exact active evidence identities
  for that pane; it never acknowledges, dismisses, pins, or snoozes an alert.
  Newer evidence for the same alert ID reopens the pane.
- **Promotion:** retain at most three eligible panes using the existing score
  bands. Preserve incumbents while eligible; only an urgent-band newcomer may
  replace a standard-band incumbent. Use CSS order only and never mutate the
  user's saved DOM order.
- **Constraints:** reuse `unifiedAlertStore`, `alert-routing`, the current
  sidebar-heat subscription, and its single decay timer. Strictly validate and
  bound persisted review state, navigate through the existing Home Shell-aware
  resolver, use text/icons in addition to color, and respect reduced motion.
- **Non-goals:** pane-native signals that do not emit `UnifiedAlert`, alert
  scoring or calibration changes, provider/Tauri work, and mobile redesign.
- **Done when:** an analyst can review every active alert-backed pane, clear the
  queue without mutating alert truth, and see the pane reopen on new evidence;
  no more than three panes are promoted and saved pane order remains unchanged.
- **Verify:** focused projection, persistence, promotion, component, navigation,
  accessibility, teardown, and performance tests with mutation proofs;
  `npm run test:renderer`, `npm run typecheck:all`, the agentic validation gate,
  and a manual full-desktop review flow.
- **Evidence:** PR #1689 records 24/24 focused tests, 14,637/14,637 renderer
  tests, zero axe violations at full and compact widths, a 457.6 KiB gzip main
  entry plus a separate 3.6 KiB review chunk, and a passing agentic validation
  gate. Clean-tree mutation proofs confirmed each edit in `git diff` and restored
  the recorded SHA-256: `panel-attention.ts` `eb36aea2...` (score floor: 22/24,
  timestamp identity: 23/24, persistence bound: 23/24, promotion cap: 22/24,
  active-cap retention: 23/24 with pane A reopening at 250 instead of 0),
  `AttentionNavigator.ts` `5974f4c1...` (shell navigation: 23/24, review-focus
  handoff: 22/24), and `panel-layout.ts` `5ab7a05d...` (destroy-before-load:
  23/24). Each restored tree returned to 24/24 with no working-tree diff.

---

## What was NOT verified

State these as open questions rather than treating them as settled:

- **The packaged cold start remains unmeasured.** There are 77 entries in
  `SUPPORTED_SECRET_KEYS` (`src-tauri/src/main.rs:41`). UX-000 records static and
  disposable-sidecar evidence, but not a real packaged desktop run with empty
  keychain/app data and normal provider access.
- The original review covered **structure and reachability, not packaged runtime
  behavior.** The focused browser harness is wired into CI but has not yet run
  on this commit; the packaged desktop UI was not launched.
- Mobile and the non-full site variants were not examined at all.

---

## Progress Tracker

Update the row in the same PR that does the work.

| Task | Title | Status | PR |
|---|---|---|---|
| UX-000 | Zero-key first-run contract | MONITOR | #1660 |
| UX-001 | Posture band on Home Shell | NOT STARTED | — |
| UX-002 | Best move + commit on band | NOT STARTED | — |
| UX-003 | Emergency readiness surface | DONE | #1670 |
| UX-004 | Contextual panel reveal | DONE | #1673 |
| UX-005 | Stable identity + personal lens | BLOCKED — HIGH ASSURANCE | — |
| UX-006 | Fix stale panel count in CLAUDE.md | DONE | #1659 |
| UX-007 | Truthful Lifelines discovery | DONE | #1669 |
| UX-008 | Observable Lifelines prewarm | DONE | #1676 |
| UX-009 | Emergency Pack v2 | DONE | #1678 |
| UX-010 | Current-location Lifelines | DONE | #1684 |
| UX-011 | Hazard/closure exposure | DONE | #1688 |
| UX-012 | Outage coverage + telemetry | DONE | #1683 |
| UX-013 | Hotel operational evidence | NOT STARTED — HIGH ASSURANCE | — |
| UX-014 | Fuel operational evidence | NOT STARTED — HIGH ASSURANCE | — |
| UX-015 | New outage provider integration | NOT STARTED — HIGH ASSURANCE | — |
| UX-016 | Timeline controller + cursor wiring | NOT STARTED — HIGH ASSURANCE | — |
| UX-017 | Complete Mac main-sync toolchain repair | WAITING | #1667 |
| UX-018 | Timely authoritative forecast resolution | NOT STARTED | — |
| UX-019 | Safe forecast algorithm recalibration | NOT STARTED — HIGH ASSURANCE | — |
| UX-020 | Entity and analog evidence growth | NOT STARTED | — |
| UX-021 | Optional-feed classification and recovery | NOT STARTED | — |
| UX-022 | Truthful desktop-local OpenAQ sampling | DONE | #1677 |
| UX-023 | Truthful automatic Little Snitch local feed | DONE | #1685 |
| UX-024 | Persistent pane review trail | DONE | #1689 |
