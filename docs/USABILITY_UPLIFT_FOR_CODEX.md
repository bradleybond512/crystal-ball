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

The packaged zero-key runtime was tested on 2026-09-18; useful Home coverage
was not demonstrated ([handoff #1725](https://github.com/bradleybond512/crystal-ball/issues/1725)).
Static wiring shows only that
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

Historical findings before merged PR #1660 (retained as the rationale for the
implemented contract; not new findings against current main):

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

Packaged protocol: [isolated zero-key acceptance](plans/2026-09-15-ux000-packaged-acceptance.md).
The existing source implementation is delivered. The isolated account test completed
with zero loaded credentials, but Home showed zero useful cards and twelve needing
attention on both launches. Timing captures and useful coverage remain incomplete;
no packaged pass is claimed. The test profile is now a used reproduction profile.
[Follow-up discovery](plans/2026-09-18-ux000-test-followup.md) owns bounded repairs.
Home contributor readiness merged in PR #1726;
[request-error preservation](plans/2026-09-19-ux000-request-error-preservation.md)
merged in PR #1728. [Local basic maps](plans/2026-09-20-ux000-local-map.md)
are claimed in PR #1729. UX-001 remains blocked until packaged acceptance passes.

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

Implementation merged through PRs #1667 and #1693. Post-merge operational
verification completed on 2026-08-31 from a separate, SHA-pinned controller
checkout.

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
- **Verify:** after merge, stop the worktree-backed job and install from a
  separate controller checkout detached at the exact reviewed, merged SHA.
  Keep the moving `~/.crystalball-main-sync/repo` build clone separate. Use
  absolute Node 22 and `--no-start`, then inspect both the plist and loaded
  launchd state before removing the worktree. Require the canonical target and
  successful phase in `~/.crystalball-main-sync/status.json`, required-check
  provenance, matching installed/build hashes, and a valid strict signature.
- **Operational verification (2026-08-30):** the isolated fail-closed run
  installed canonical `main` at
  `ace938183462b50ef9ce871ab931e297a3e49942`, recorded `phase: installed`,
  preserved required-check evidence from PR #1689, and passed strict signature
  verification. It also proved the repair is incomplete: the Node 22
  coordinator's Cargo-first `PATH` resolves npm and nested package scripts
  through Node 26. See `docs/validation/UX-017-MAIN-SYNC-EVIDENCE.md` and the
  approval-pending design in
  `docs/architecture/UX_017_PINNED_NODE_TOOLCHAIN_BRIEF.md`.
- **Remediation verification (2026-08-31):** the approved pinned-toolchain
  change installed canonical `main` at
  `702dc5b0521f49542d1c6cb73238841006b9a793` with Node 22.23.1, npm 10.9.8,
  and Cargo 1.93.1. The candidate log window contained zero `EBADENGINE`
  warnings, `status.json` recorded `phase: installed`, installed/build
  executable hashes matched, and strict signature verification passed. The
  exact transcript and required-check provenance are in
  `docs/validation/UX-017-MAIN-SYNC-EVIDENCE.md`.
- **Post-merge relocation (2026-08-31):** PR #1693 merged at
  `6357dfa582146155c2f4cd01df52737a3000b61a`. The loaded LaunchAgent now runs
  Node 22.23.1 from the separate detached `controller` checkout while only the
  sibling `repo` is disposable. It installed the merged target with all
  required-check provenance, zero `EBADENGINE` warnings in a fail-closed log
  window, matching executable hashes, a valid strict signature, and launchd
  exit code 0. The exit condition is satisfied.

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

Merged evidence (PR #1692): the MCP implementation reads only the
authenticated, allowlisted missing-key projection and classifies ACLED,
ThreatFox, and AIS as `not_configured` without probing them when required
credentials are explicitly absent. A 2026-08-30 candidate run against the
running desktop sidecar reported 7 healthy, 3 not configured, and 0 degraded
representative feeds. Configured optional feeds now fail closed when ThreatFox
contributes zero observations, AIS is disconnected, or ACLED reports an
upstream failure; malformed feed envelopes cannot disappear from monitoring.
The current ACLED and ThreatFox sidecar adapters erase upstream HTTP 429 status,
so truthful named-feed rate-limit classification remains unresolved pending a
credentialed live probe and a separately approved provider-contract change.
Weekly persistence remains schema v1 and ignores configuration-only
states instead of recording a rollback-incompatible provider outage, while a
separate schema-v1 companion preserves the three-state weekly provider history
for additive MCP output and safe rollback. The ThreatFox registry now truthfully
declares its required key. Focused MCP tests passed 74/74; the full MCP suite
passed 232/232; provider tests passed 157/157; diagnostics passed 418/418 plus
28/28 Node tests; both TypeScript configurations passed.
Repository smoke remained YELLOW because the live `usgs-surface-water` feed
was erroring. PR #1692 merged the completed optional-key and degraded-feed
classification work; the tracker is waiting for a separately approved
High Assurance provider-contract design and credentialed live probe before
implementing truthful HTTP-429 classification.

Dependencies: UX-017

Exit condition: A concrete provider-contract design preserves upstream HTTP-429
evidence for ACLED and ThreatFox, a credentialed live probe confirms the actual
response shape, and the user explicitly approves that High Assurance design.

Review after: 2026-09-01

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
- **Evidence:** PR #1689 records 24/24 focused tests, 14,690/14,690 renderer
  tests, zero axe violations at full and compact widths, a 457.6 KiB gzip main
  entry plus a separate 3.7 KiB review chunk, and a passing agentic validation
  gate. The complete clean-tree mutation transcript, confirmed diffs, exact
  failing assertions, full restored SHA-256 values, and quoted validation output
  are recorded in `docs/validation/UX-024-MUTATION-PROOFS.md`.

### UX-026 — Location and saved-place impact in alert digests *(High Assurance)*

Status: MONITOR
Evidence: #1704 — reviewed source candidate; local and CI evidence in the PR.
Exit condition: Complete packaged digest expiry, keyboard/focus, cached-camera and partial-source acceptance; resolve or explicitly retain the two conservative NWS data limitations documented by review.
Review after: 2026-09-22

This is manual acceptance tracking, not a recurring task or monitoring automation.

Make every "Since you last looked" story immediately answer where the event is
and whether current evidence indicates impact to any saved place.

- **Show:** a deterministic location row and saved-place impact row on every
  story. Impact states are `likely`, `possible`, `no reported overlap`,
  `unknown`, or `not evaluated`; never say safe, unaffected, or all clear.
- **Fail closed:** `no reported overlap` requires complete, current affected-area
  evidence evaluated against every saved place. Missing, stale, malformed,
  centroid-only, cold-rehydrated, partial-member, or over-budget evidence is
  `unknown`. A global alert is only `possible` at saved places unless direct
  evidence supports a stronger conclusion.
- **Privacy:** saved-place names, IDs, coordinates, radii, tags, notes, and
  priority stay local. Model output may summarize why a story matters but cannot
  supply or override location, impact state, place names, or evidence wording.
- **Scope:** add a shared pure alert-presentation projection, but wire only the
  digest overlay in this task. Preserve alert ranking, thresholds, cadence,
  acknowledgement, snooze/pin state, dismissal behavior, providers, and polling.
- **Accessibility:** expose the overlay as a labeled modal dialog, render stories
  as semantic articles, trap and restore focus, retain Escape/backdrop/close
  dismissal, and provide bounded scrolling at compact sizes.
- **Done when:** no rendered story can omit either required row; model failure
  falls back to deterministic ranked-alert cards; saved-place or member changes
  reproject locally without another model call; complete negative weather
  coverage is explicitly labeled as not an all-clear.
- **Verify:** focused projection, prompt/privacy, fallback, component,
  accessibility, lifecycle, performance, and mutation tests; `npm run
  test:weather`, `npm run test:renderer`, `npm run typecheck:all`, and the
  agentic validation gate.
- **September 14 resumption:** the approved third repair cycle completed the
  malformed-response, optional-onset and bounded-validation repairs. Candidate
  `b81d9dc28` passed the 15,327-test agentic gate; 25 literal mutation proofs
  were rebuilt on a clean isolated copy. Independent review still blocks
  acceptance on open-digest expiry invalidation and FAA partial-source loading.
  Bradley approved the [fourth-cycle repair](plans/2026-09-14-ux026-fourth-cycle-proposal.md)
  after these findings. Fourth source `a3c3c3c0c` fixes both, but independent
  review found that ordinary healthy GDACS cache hits lose camera hazard context.
  Bradley approved the bounded [cached-context repair](plans/2026-09-14-ux026-cached-gdacs-repair.md);
  source `f977aee1f` passed 15,350 tests and independent source review.
  On September 15 the approved map dependency prerequisite merged to main;
  UX-026 rebased without behavioral changes and passed 15,342 tests in the
  integration gate plus the separate 8-test storm-source suite. The fresh audit
  reports zero vulnerabilities; the 444.4 KB main bundle passes the unchanged
  460 KB limit. Fresh Claude review and publication closeout remain open. See
  [resumption evidence](validation/UX-026-RESUMPTION.md) and
  [literal proofs](validation/UX-026-MUTATION-PROOFS.md). No merge or installation
  occurred; the recurring controller remains deleted.

---

### UX-027 — Evidence-scoped Home reassurance *(High Assurance)*

Replace unsupported Home all-clear claims with the limits of available reports,
while preserving detected threats and their actions. Bradley approved the
[implementation design](plans/2026-09-07-ux027-evidence-scoped-home-design.md)
on 2026-09-07.

- **Scope:** briefing projection, Home rendering, focused behavioral tests.
- **Coverage contract:** report generation is not source freshness. No current
  production input establishes complete per-place coverage; empty, unavailable,
  offline, or freshly recomputed reports cannot produce an all-clear state.
- **Show:** three persistent bands with evidence limitations; distinguish zero
  saved places, missing reports, and empty available reports. Preserve positive
  impacts, worldwide context, severity, action text, and dossier links.
- **Non-goals:** providers, spatial matching, forecasting, posture/planned
  benefit, notifications, storage, and UX-025/UX-026 ownership.
- **Done when:** degraded/empty states never imply clearance; calculation time
  cannot refresh evidence age; positive threats remain visible.
- **Verify:** Home, survival, renderer, actual targeted-suite selection, type
  checks, unchanged bundle budget, mutation proofs, independent review, and
  manual packaged evidence with an identified build.
- **Evidence:** [validation report](validation/UX-027-EVIDENCE-SCOPED-HOME.md) records automated and mutation checks, six native scenarios, restoration, and independent acceptance review.

---

### UX-031 — Reliable system appearance lifecycle

Status: MONITOR
Evidence: #1720 — source merged with clean audit, tests and review.
Exit condition: Verify system appearance switching in the packaged main window and its unified Settings dialog; retain initial-paint and full native visual acceptance as explicitly scoped follow-ups.
Review after: 2026-09-22

Source is delivered; packaged acceptance remains open. This status does not start
an automation or claim native acceptance.

Follow repeated system light/dark changes in main and Settings when no manual
choice exists. Preserve explicit choices (including session choices when storage
fails), happy's light default, html-owned theme, and existing theme events.
Correct the affected native light selector groups using the production cascade.
No native bridge, new materials, UX-025 experiment or initial-paint claim.

Acceptance: focused behavioral and real-bootstrap browser tests, applied-diff
mutation proof, packaged appearance verification and independent/Claude review.
Design: [UX-031 appearance brief](plans/2026-09-15-ux031-system-appearance.md).

---

### UX-032 — Settings keyboard containment

Status: MONITOR
Evidence: #1723 — reviewed source candidate and automated/mutation evidence.
Exit condition: Verify Settings focus, Tab, Escape, Places Edit handoff and foreground command palette in the identified packaged main build; retain full VoiceOver and appearance acceptance separately.
Review after: 2026-09-22

This is manual acceptance tracking, not a new scheduled automation.

Packaged main `ee2a7aaac9be` on macOS 27.0 (26A428), September 15:
native menu Settings opens the unified dialog without moving focus inside.
Tab focuses the background Safety review banner. Escape dismisses Settings and
also switches Home to Classic. Reproduced through native UI automation; no
settings values were changed, and Home was restored afterward.

Acceptance: entering Settings moves focus inside; Tab and Shift-Tab remain in
visible enabled controls; Escape dismisses only Settings; closing restores a
connected invoking control; repeated opens and tab changes remain usable.
Keep native appearance acceptance separate. No native bridge or preference
migration is included.

Design: [UX-032 brief](plans/2026-09-15-ux032-settings-keyboard.md).
Evidence: [validation and review](validation/UX-032-SETTINGS-KEYBOARD.md),
[literal mutation proofs](validation/UX-032-MUTATION-PROOFS.md).

---

## September 22 reliability intake from PR 1731

The [reviewed handoff](https://github.com/bradleybond512/crystal-ball/blob/ac70c0f6a0db3cfb3ff9d46b0f2bad129eb2e94a/docs/UI_PERF_HANDOFF_FOR_CODEX.md)
adds a warning-reliability priority lane. The
[integration brief](plans/2026-09-22-pr1731-integration.md) records corrections,
ownership and approval boundaries. UX-045 is the first design task, followed by
retention, situation identity, authoritative warning lifecycle and truthful
coverage before further reassuring Home surfaces. Existing tasks remain active.

These are accepted investigation/repair tasks, not claims that every historical
count or proposed remedy has been independently verified. PRs1730 and1732 remain
open; a locally installed build is not a merge. H19 was independently reproduced
against current main without real notifications. Correlation work belongs to
ACC-509 and ACC-510 in the prediction tracker, coordinated with PR1732.

The original report's proposed UX-039/UX-041 are intentionally not allocated:
blanket timeout/storage wrappers were undermined by its own later corrections.
UX-038 covers URL handling only; its unrelated persistence work is UX-057.
Do not turn H9 or the disproved sidecar-port/auth theories into tasks.
The seismic magnitude-type mismatch remains a discovery item under the existing
source-fusion program, requiring domain evidence before tolerance changes.

### UX-033 — Keep content reachable during stacked warnings

Status: NOT STARTED
Source findings: PR1731 H1.

Acceptance: Cap the measured notification stack and its reserved space together. At small window sizes, stacked warnings remain scrollable while content and navigation remain reachable.

### UX-034 — Assign ownership of top-of-window surfaces

Status: MONITOR — partial layout prerequisite in #1730
Evidence: #1730 — measured posture row, corrected offsets and data-center strip styling.
Exit condition: Complete the top-of-window rail inventory and verify remaining overlap and native macOS/WebKit acceptance; keep UX-033 stack-height capping separate.
Review after: 2026-09-23
Source findings: PR1731 H2.

Acceptance: Inventory each rail as measured content or an intentional overlay; verify no overlap with summary, controls or navigation. PR #1730 moves the posture banner into the measured stack, corrects summary/breaking offsets and styles the data-center strip. Chromium regression and mutation evidence: [PR-1730-SUMMARY-STACK-LAYOUT.md](validation/PR-1730-SUMMARY-STACK-LAYOUT.md). Full rail inventory, remaining overlap acceptance and native verification are unfinished. UX-033 stack-height capping remains separate; this PR does not complete it.

### UX-035 — Gate background panel work by actual need

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 H3.

Acceptance: Profile foreground/background behavior before selecting panels. Reduce invisible presentation work while preserving safety monitoring and data dependencies; do not blanket-disable off-screen acquisition.

### UX-036 — Spread refresh work and honor battery policy

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 M1/M3.

Acceptance: Measure synchronized refresh cost and introduce bounded staggering through existing scheduling conventions; preserve maximum warning-detection latency and foreground recovery.

### UX-037 — Prevent new unowned stacking levels

Status: NOT STARTED
Source findings: PR1731 M2.

Acceptance: Inventory intentional stacking contexts and introduce a reviewed ratchet without changing current modal, focus or critical-banner behavior.

### UX-038 — Constrain video-channel link construction

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 L1.

Acceptance: Verify configured and external handle paths, encode safe URL components and reject unsafe destinations with behavioral tests. Keep storage optimizations separate.

### UX-040 — Expose unavailable and stale feed outcomes

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 M4/M8.

Acceptance: Distinguish denied, malformed, unavailable and stale-cache outcomes from a verified empty result. Start with measured failures; never log credentials or treat every isolated catch as a defect.

### UX-042 — Construct panels when needed without losing coverage

Status: MONITOR — HIGH ASSURANCE; partial prerequisite in #1714
Evidence: #1714 — five diagnostic factories use asynchronous construction, with browser lifecycle and last-viewed regression evidence. No measured startup savings established; the diagnostic chunk remains reachable from the startup graph.
Exit condition: Complete separately designed and approved construction profiling and any further lifecycle changes; verify service startup, Home contributors, restored layouts and on-demand navigation before declaring this task complete.
Review after: 2026-09-23
Source findings: PR1731 M6/H7.

Acceptance: Measure construction time independently from parsing; defer selected presentation objects while preserving service startup, Home contributors, restored layouts and on-demand navigation.

The broader construction program remains unimplemented. This partial evidence
and tracking update do not authorize it. Current bounded evidence and limits:
[PR-1714-INTEGRATION.md](validation/PR-1714-INTEGRATION.md).

### UX-043 — Reduce repeated alert subscriber scans

Status: NOT STARTED
Source findings: PR1731 M7.

Acceptance: Measure fan-out cost and update subscriber contracts without losing updates, ack/pin changes or failure isolation. Demonstrate behavior and cost under a full store.

### UX-044 — Announce critical UI changes accessibly

Status: NOT STARTED
Source findings: PR1731 L3.

Acceptance: Review PR1730 and add missing live-region semantics without repeated announcements or focus theft. Verify screen-reader and keyboard behavior on identified surfaces.

### UX-045 — Keep advisories from suppressing warnings

Status: DONE
Evidence: #1733 — approved badge-only source repair, focused regression tests and three applied mutation proofs.
Approval: September 22, operator approved the badge-only correction; broader notification policy remains separate.
Source findings: PR1731 H19.

Acceptance: Allowed badge-only alerts must not consume the interruptive notification cooldown. Retain duplicate limits, critical bypass and user policies. Queue/coalescing is a separate lifecycle decision, not an implicit expansion of this repair.

### UX-046 — Preserve alert priorities at capacity

Status: DONE — HIGH ASSURANCE
Claim: #1734. The operator approved the bounded capacity policy on September 22, 2026.
Source findings: PR1731 H18. Source-age retention is tracked separately in UX-059.

Acceptance: after the existing capacity-enforcement flush, retain at most 500
alerts, evicting unpinned acknowledged entries before unpinned unacknowledged
entries and pinned entries last. Define all-pinned overflow and exact timestamp
ties explicitly. Preserve existing age, hydration, archive and notification
behavior; this task does not resolve the repeated pruning of old active alerts.
Coordinate with open PR1732 without modifying its hydration purge.
Design: [bounded cap repair](plans/2026-09-22-ux046-alert-cap.md).
Evidence: #1734 — [capacity regression and mutation results](validation/UX-046-ALERT-CAPACITY.md).
Implementation, local gates and independent substantive review pass. Final integration verdict and required CI govern merge.

### UX-047 — Keep national weather warnings current

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 H12/H13/H14.

Acceptance: Schedule authoritative NWS refresh and reconcile updates, cancellations and expiry across restart; display issued and future-onset times honestly. Preserve national coverage, distinguish partial/failed fetches from an authoritative empty result, and reuse only helpers whose semantics match.

### UX-048 — Restore verified GDACS ingestion

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 H11.

Acceptance: Probe current response bodies and required parameters before choosing an endpoint; retain request, row count and consumed fields. Contract-test successful, malformed and empty responses without caching malformed bodies.

### UX-049 — Distinguish quiet sensors from missing observations

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 H21.

Acceptance: Carry real observation/fetch age and coverage into threat summaries. A failed or stale domain cannot become a freshly checked quiet sensor because aggregation ran. Check all-domain reassurance and partial coverage.

### UX-050 — Make Ghost Mode suppression unmistakable

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 H20.

Acceptance: Approve explicit policy for critical alerts versus privacy/silence preferences; show persistent mode and suppression accounting. Do not silently bypass an existing user-selected privacy mode.

### UX-051 — Align RSS request budgets across boundaries

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 M12.

Acceptance: Bound total sidecar redirect/request time below the renderer budget while preserving SSRF, authorization and cancellation checks. Test slow redirects and timely error delivery.

### UX-052 — Restrain derived alert interruptions

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 H15 remainder.

Acceptance: Separate derived-notification policy from authoritative warnings; define domain, cooldown, quiet-hour and burst accounting rules. Coordinate with ACC-509; do not change inference severity to mask delivery defects.

### UX-053 — Finish boot without awaiting all data sources

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 P0.

Acceptance: Define usable first-screen readiness separately from background acquisition; preserve initialization dependencies and failure visibility. Measure cold/warm boot and warning readiness, not only completion of one promise.

### UX-054 — Cover subproject dependencies in security checks

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 M10.

Acceptance: Inventory all maintained lockfiles and exposed tools; add appropriately scoped audit coverage and resolve confirmed reachable issues without weakening thresholds.

### UX-055 — Surface stale credential validation honestly

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 M11.

Acceptance: Show validation age and distinguish unavailable validation from an invalid key. Re-check only with explicit bounded provider behavior; do not rotate credentials or expose values.

### UX-056 — Bound retained storage without losing user evidence

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 M9.

Acceptance: Measure live storage and classify owned cache versus user evidence before proposing retention or cleanup. Backup, migration, deletion and installed profile changes require a separate approved design.

### UX-057 — Persist panel state only when it changes

Status: NOT STARTED
Source findings: PR1731 L2.

Acceptance: Inspect the six reported timer writers; remove redundant writes while preserving state across reload, failed storage and teardown. Verify each actual writer before changing it. Any cognition or self-tuning writer requires high-assurance design approval before implementation.

---

### UX-058 — Account for deferred and updated warnings

Status: NOT STARTED — HIGH ASSURANCE
Source findings: PR1731 H19 follow-up and UX-045 scope limits.

Acceptance: design bounded handling of distinct warnings suppressed during an
interruptive cooldown, same-ID severity escalation, explicit channel preferences
and operator-visible suppression accounting. Define event identity, expiry,
cancellation, acknowledgement, mode changes, capacity, restart and teardown before
introducing a queue or digest. Preserve user privacy/silence choices and prevent
burst replay. UX-045 does not claim these behaviors are repaired.

---

### UX-059 — Retain active alerts using authoritative lifecycle evidence

Status: IN REVIEW — HIGH ASSURANCE
Claim: dependent draft #1739; approved [implementation brief](plans/2026-09-25-ux059-warning-retention.md). Integration hold depends on ACC-509 #1738.
Source findings: PR1731 H17; separated from UX-046's capacity-only correction.

Acceptance: separate event time from verified observation/retention time and
retain active multi-day alerts without notifying on every repoll. Cached replay,
failed fetches and old storm context must not manufacture freshness. Preserve
source chronology, ack/pin state and archive semantics. Define legacy metadata,
expiry, restart and migration behavior in an approved design; coordinate with
UX-047, ACC-509 and PR1732's hydration purge. Do not replace source timestamps
with the current clock or claim capacity ordering alone repairs retention.

---

### UX-060 — Preserve onboarding keyboard ownership against proactive digest

Status: DONE
Evidence: #1735 — [focus regression and mutation results](validation/UX-060-ONBOARDING-FOCUS.md).
Acceptance: first-run Welcome retains keyboard focus against digest handlers and late results. Skip proactive digest on the onboarding boot; preserve explicit post-onboarding opening, focus restoration and cancellation. No automatic resume queue.
Validation: focused 36/0, existing digest 115/0, final Home browser 6/0, twelve applied mutation runs, types and named gate. Earlier browser readiness failures remain documented; native acceptance is not claimed. Independent and substantive Claude review found no blocking findings; final integration verdict and required CI govern merge.

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
| UX-000 | Zero-key first-run contract | MONITOR | #1660; [failed packaged test](https://github.com/bradleybond512/crystal-ball/issues/1725); Home #1726; request errors #1728; basic map #1729; [validation](validation/PR-1729-LOCAL-BASEMAP.md) |
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
| UX-013 | Hotel operational evidence | DONE | #1699 |
| UX-014 | Fuel operational evidence | NOT STARTED — HIGH ASSURANCE | — |
| UX-015 | New outage provider integration | NOT STARTED — HIGH ASSURANCE | — |
| UX-016 | Timeline controller + cursor wiring | NOT STARTED — HIGH ASSURANCE | — |
| UX-017 | Complete Mac main-sync toolchain repair | DONE | #1693 |
| UX-018 | Timely authoritative forecast resolution | NOT STARTED | — |
| UX-019 | Safe forecast algorithm recalibration | NOT STARTED — HIGH ASSURANCE | — |
| UX-020 | Entity and analog evidence growth | NOT STARTED | — |
| UX-021 | Optional-feed classification and recovery | WAITING | #1692 |
| UX-022 | Truthful desktop-local OpenAQ sampling | DONE | #1677 |
| UX-023 | Truthful automatic Little Snitch local feed | DONE | #1685 |
| UX-024 | Persistent pane review trail | DONE | #1689 |
| UX-026 | Location + saved-place impact in alert digests | MONITOR | #1704 |
| UX-027 | Evidence-scoped Home reassurance | DONE | #1707 |
| UX-031 | Reliable system appearance lifecycle | MONITOR | #1720 |
| UX-032 | Settings keyboard containment | MONITOR | #1723 |
| UX-033 | Keep content reachable during stacked warnings | NOT STARTED | — |
| UX-034 | Assign ownership of top-of-window surfaces | MONITOR | #1730 |
| UX-035 | Gate background panel work by actual need | NOT STARTED — HIGH ASSURANCE | — |
| UX-036 | Spread refresh work and honor battery policy | NOT STARTED — HIGH ASSURANCE | — |
| UX-037 | Prevent new unowned stacking levels | NOT STARTED | — |
| UX-038 | Constrain video-channel link construction | NOT STARTED — HIGH ASSURANCE | — |
| UX-040 | Expose unavailable and stale feed outcomes | NOT STARTED — HIGH ASSURANCE | — |
| UX-042 | Construct panels when needed without losing coverage | MONITOR | #1714 |
| UX-043 | Reduce repeated alert subscriber scans | NOT STARTED | — |
| UX-044 | Announce critical UI changes accessibly | NOT STARTED | — |
| UX-045 | Keep advisories from suppressing warnings | DONE | #1733 |
| UX-046 | Preserve alert priorities at capacity | DONE — HIGH ASSURANCE | #1734 |
| UX-047 | Keep national weather warnings current | NOT STARTED — HIGH ASSURANCE | — |
| UX-048 | Restore verified GDACS ingestion | NOT STARTED — HIGH ASSURANCE | — |
| UX-049 | Distinguish quiet sensors from missing observations | NOT STARTED — HIGH ASSURANCE | — |
| UX-050 | Make Ghost Mode suppression unmistakable | NOT STARTED — HIGH ASSURANCE | — |
| UX-051 | Align RSS request budgets across boundaries | NOT STARTED — HIGH ASSURANCE | — |
| UX-052 | Restrain derived alert interruptions | NOT STARTED — HIGH ASSURANCE | — |
| UX-053 | Finish boot without awaiting all data sources | NOT STARTED — HIGH ASSURANCE | — |
| UX-054 | Cover subproject dependencies in security checks | NOT STARTED — HIGH ASSURANCE | — |
| UX-055 | Surface stale credential validation honestly | NOT STARTED — HIGH ASSURANCE | — |
| UX-056 | Bound retained storage without losing user evidence | NOT STARTED — HIGH ASSURANCE | — |
| UX-057 | Persist panel state only when it changes | NOT STARTED | — |
| UX-058 | Account for deferred and updated warnings | NOT STARTED — HIGH ASSURANCE | — |
| UX-059 | Retain active alerts using authoritative lifecycle evidence | IN REVIEW — HIGH ASSURANCE | #1739; approved [brief](plans/2026-09-25-ux059-warning-retention.md); ACC-509 #1738 integration hold |
| UX-060 | Preserve onboarding keyboard ownership against proactive digest | DONE | #1735 |
