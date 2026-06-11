# Observability Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four observability seams: (1) a dedicated smoke-test CLI + replay harness in CI, (2) structured logging on both renderer and sidecar with file rotation, (3) a pipeline trace registry tracking facts through the intelligence pipeline, (4) degradation alerting from the health registries through the notification ladder.

**Architecture:** All new intelligence-side code follows the repo's purity invariant (no DOM, no fetch, no globals at import — fixture-testable). Hosts wire pure modules at the edges (`panel-layout.ts`, `data-bridge.ts`, sidecar context). The smoke CLI reuses the existing replay harness (`runReplay`) and self-test catalog; structured logging wraps the existing `log-bridge.ts` breadcrumbs rather than replacing them.

**Tech Stack:** TypeScript (tsx for tests/scripts, `node:test` style `tsx --test`), Node 20 sidecar (`node --test`), GitHub Actions.

**Branch & worktree rules (MANDATORY):** This repo's canonical dir is shared by multiple sessions. Do NOT `git checkout -b` in `~/Developer/crystalball` directly. Create a worktree: `git fetch origin && git worktree add .worktrees/claude-observability -b claude/observability-enhancement origin/main`, work there, push to `origin`, open a PR. Commit this plan file as your first commit. Every commit must include `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`. Run `npm run typecheck:all` before claiming any task complete. Stage files by name, never `git add -A`.

**Conventions you must follow:**
- Frontend unit tests: `*.test.mts` next to source in `__tests__/`, run via `tsx --test <files>` npm scripts (see `package.json` `test:*` for examples).
- Sidecar tests: `src-tauri/sidecar/__tests__/*.test.mjs`, run via `node --test`.
- Pure modules: no `Date.now()` default deep inside logic — accept `now?: () => number` or a `generatedAt` param like `runReplay` does.
- File-header comment style: short block comment describing purpose + invariants (see `src/services/ops/replay-harness.ts:1-21`).

---

## Phase 1 — Smoke CLI + replay in CI

### Task 1: `npm run smoke` script

**Files:**
- Create: `scripts/smoke.mts`
- Modify: `package.json` (scripts block)

The smoke CLI runs three tiers and prints a GREEN/YELLOW/RED report modeled on `scripts/checkup.mjs` (read it first — reuse its color-helper style):

1. **Replay tier (offline, always runs):** `runReplay({ fixtures: buildCatalogReplayFixtures() })` from `src/services/ops/replay-harness.ts` + `src/services/ops/replay-fixtures-catalog.ts`. Verdict `fail` → RED. NOTE: the catalog intentionally contains regression fixtures that may legitimately fail (e.g. `LATE_SEVERE_WIND_FIXTURE` is a recorded *miss*). Before wiring, run `npx tsx -e "import {runReplay} from './src/services/ops/replay-harness'; import {buildCatalogReplayFixtures} from './src/services/ops/replay-fixtures-catalog'; console.log(JSON.stringify(runReplay({fixtures: buildCatalogReplayFixtures()}).results.map(r=>({id:r.fixtureId,outcome:r.outcome})),null,2))"` and record the current baseline. The smoke check asserts the report **matches a committed baseline** (`scripts/smoke-replay-baseline.json` — fixtureId → expected outcome), not that everything passes. A fixture changing outcome in either direction is a smoke failure (regression OR a fix that needs the baseline updated deliberately).
2. **Pipeline tier (offline):** exercise the real big-event → ladder path with a canned input: build a `BigEventInput` fixture (copy a passing one from `src/services/insights/__tests__/` — find with `grep -rl "detectBigEvent" src/services/insights/__tests__/`), run `detectBigEvent`, feed the result to `routeBigEventToLadder` with a fresh `createNotificationTraceRegistry()`, and assert: (a) a critical-tier safety event with `quietHoursActive: true` is still dispatched, (b) a low-tier event with `dedupeMatch: true` is suppressed with `unsafeSuppression === false`. These assert the wiring invariants end-to-end through production code.
3. **Live tier (skippable):** probe `http://127.0.0.1:46123/api/health` with a 2 s timeout exactly like `scripts/checkup.mjs:159-189`. Unreachable → YELLOW (warning), never RED. Pass `--offline` to skip.

Exit codes: 0 green, 1 warnings only, 2 any failure (same contract as checkup).

- [ ] **Step 1:** Run the baseline probe command above; commit its output as `scripts/smoke-replay-baseline.json` in the shape `{ "fixtures": { "<fixtureId>": "pass" | "fail" | "inapplicable" } }`.
- [ ] **Step 2:** Write `scripts/smoke.mts` implementing the three tiers. Import pure modules directly (tsx resolves the `@/` alias only if configured — use relative imports from `scripts/`, e.g. `../src/services/ops/replay-harness`). Pass `generatedAt: 0` to `runReplay` for determinism.
- [ ] **Step 3:** Add to `package.json` scripts: `"smoke": "tsx scripts/smoke.mts"` and `"smoke:offline": "tsx scripts/smoke.mts --offline"`.
- [ ] **Step 4:** Run `npm run smoke:offline` — expect exit 0 and a report listing replay baseline ✓, pipeline invariants ✓, sidecar skipped.
- [ ] **Step 5:** Run `npm run typecheck:all`. Commit: `feat: add npm run smoke — replay baseline + pipeline invariants + sidecar probe`.

### Task 2: replay + smoke in CI

**Files:**
- Create: `.github/workflows/smoke.yml`
- Modify: `package.json` (add `test:replay` alias)

- [ ] **Step 1:** Add `"test:replay": "tsx --test src/services/ops/__tests__/replay-harness.test.mts src/services/ops/__tests__/replay-fixtures-catalog.test.mts"` to package.json (subset of `test:ops`, kept as a named entry point).
- [ ] **Step 2:** Create `.github/workflows/smoke.yml` modeled on `.github/workflows/typecheck.yml` (read it for the checkout/node-setup/permissions pattern — keep `permissions: contents: read`): trigger on `pull_request` + `push: branches: [main]`, steps: checkout, setup-node 20 with npm cache, `npm ci`, `npm run smoke:offline`, `npm run test:replay`.
- [ ] **Step 3:** Run `npx tsx --test src/services/ops/__tests__/replay-harness.test.mts` locally to confirm green; validate workflow with `npx actionlint .github/workflows/smoke.yml` if available (the repo has `actionlint.yml` CI).
- [ ] **Step 4:** Commit: `ci: run smoke suite + replay harness on every PR`.

---

## Phase 2 — Structured logging

### Task 3: renderer structured logger

**Files:**
- Create: `src/services/structured-log.ts`
- Test: `src/services/__tests__/structured-log.test.mts`
- Modify: `package.json` (extend an existing `test:*` script or add `test:structured-log`)

A thin, pure module — does NOT replace `log-bridge.ts`, it feeds it:

```ts
/**
 * Structured logging façade. Emits one JSON-shaped record per call,
 * fans out to console + breadcrumbs + desktop log (warn/error only).
 * Pure core (formatRecord) + impure emit() the hosts call.
 */
import { recordBreadcrumb, logToDesktop } from './log-bridge';

export type SlogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SlogRecord {
  at: number;
  level: SlogLevel;
  category: string;          // e.g. 'pipeline', 'feed', 'notification'
  message: string;
  traceId?: string;          // ties a fact through the pipeline (Phase 3)
  fields?: Record<string, string | number | boolean | null>;
}

export function formatRecord(r: SlogRecord): string {
  // single-line JSON, stable key order for grep-ability
  return JSON.stringify({
    at: r.at, level: r.level, cat: r.category,
    msg: r.message, trace: r.traceId, ...r.fields,
  });
}

export function slog(
  level: SlogLevel, category: string, message: string,
  opts?: { traceId?: string; fields?: SlogRecord['fields']; now?: () => number },
): void { /* build record, console[level], recordBreadcrumb, logToDesktop for warn/error */ }
```

- [ ] **Step 1:** Write failing tests for `formatRecord`: stable single-line JSON, fields flattened, `trace` omitted-as-undefined handled (JSON.stringify drops undefined — assert the key is absent). Run `npx tsx --test src/services/__tests__/structured-log.test.mts` — expect FAIL (module missing).
- [ ] **Step 2:** Implement. Check `logToDesktop`'s real signature at `src/services/log-bridge.ts:70` and `recordBreadcrumb` at `:28` before calling them. Guard `slog` debug-level output behind `import.meta.env.DEV` like existing code does.
- [ ] **Step 3:** Tests pass; `npm run typecheck:all` clean.
- [ ] **Step 4:** Adopt in two call-sites as proof (don't mass-migrate): `src/services/insights/data-bridge.ts` (log each `bridgeWeatherAlertsToInsights` run: count in, count bridged) and one feed-failure path in `src/app/data-loader.ts`. Keep existing console lines that tests depend on.
- [ ] **Step 5:** Commit: `feat: structured logging façade over log-bridge + first two call-sites`.

### Task 4: sidecar file logging with rotation

**Files:**
- Create: `src-tauri/sidecar/sidecar-logger.mjs`
- Test: `src-tauri/sidecar/__tests__/sidecar-logger.test.mjs`
- Modify: `src-tauri/sidecar/local-api-server.mjs` (context.logger wiring — read how `context.logger` is constructed first; it currently defaults to `console`)

`createSidecarLogger({ dir, maxBytes = 5_000_000, keep = 2, now })` returns `{ info, warn, error, child }` writing single-line JSON (`{at, level, msg, ...fields}`) to `<dir>/sidecar.log`, rotating to `sidecar.log.1` when size exceeds `maxBytes` (rename-based rotation; delete `.{keep}` overflow). It must ALSO still mirror warn/error to the console methods so Tauri's stdout capture keeps working. Default `dir`: `path.join(os.homedir(), 'Library/Logs/com.bradleybond.crystalball')` on darwin, fall back to `os.tmpdir()` elsewhere. Never throw from a log call — wrap appends in try/catch (same philosophy as the event-store append in the sidecar).

- [ ] **Step 1:** Write failing tests in `node --test` style using a temp dir (`fs.mkdtempSync`): writes JSON lines; rotation triggers at maxBytes (use tiny maxBytes like 200); console mirror called for error level (inject a fake console); a throwing fs append doesn't propagate.
- [ ] **Step 2:** Run `node --test src-tauri/sidecar/__tests__/sidecar-logger.test.mjs` — FAIL.
- [ ] **Step 3:** Implement; tests pass.
- [ ] **Step 4:** Wire into `local-api-server.mjs`: where `context.logger` defaults to `console`, default it to `createSidecarLogger(...)` instead, behind `process.env.CB_SIDECAR_FILE_LOG !== '0'`. Run `npm run test:sidecar` — must stay green (existing tests inject their own logger; verify).
- [ ] **Step 5:** Run `node scripts/check-sidecar-bundle.mjs` (new file must be included in the bundle — read that script to see how files are enumerated and add `sidecar-logger.mjs` wherever the bundle manifest lists sidecar files).
- [ ] **Step 6:** Commit: `feat: sidecar JSON file logging with size rotation`.

---

## Phase 3 — Pipeline trace registry

### Task 5: pure registry

**Files:**
- Create: `src/services/diagnostics/pipeline-trace.ts`
- Test: `src/services/diagnostics/__tests__/pipeline-trace.test.mts`
- Modify: `src/services/diagnostics/diagnostics-state.ts` (add singleton getter, mirror the `getNotificationTraceRegistry` pattern at `:53`), `package.json` (append test file to `test:diagnostics`)

Model directly on `notification-trace.ts` (factory + interface + JSON-serializable snapshot):

```ts
export type PipelineStage =
  | 'ingested'      // fact entered via data-bridge / data-loader
  | 'scored'        // truth-score / shortage-score / posture computed
  | 'clustered'     // joined a Situation
  | 'evaluated'     // big-event detector ran
  | 'routed'        // ladder decision recorded
  | 'dropped';      // explicitly filtered out (with reason)

export interface PipelineTraceEvent {
  at: number; stage: PipelineStage; reason?: string;
  detail?: Record<string, string | number | boolean | null>;
}

export interface PipelineTraceEntry {
  traceId: string;            // caller-supplied stable id (alert id, fact id)
  domain: string;             // 'weather' | 'shortage' | ... free-form
  createdAt: number;
  events: PipelineTraceEvent[];
}

export interface PipelineTraceRegistry {
  record(traceId: string, domain: string, event: Omit<PipelineTraceEvent,'at'> & {at?: number}): void;
  get(traceId: string): PipelineTraceEntry | undefined;
  /** Entries that entered ≥ staleMs ago and never reached 'routed' or 'dropped'. */
  stalled(now: number, staleMs: number): readonly PipelineTraceEntry[];
  snapshot(): { entries: readonly PipelineTraceEntry[]; total: number };
}

export function createPipelineTraceRegistry(opts?: { cap?: number /* default 500, FIFO evict */ }): PipelineTraceRegistry;
```

`record` auto-creates the entry on first call (createdAt = first event's at). `at` defaults via an injected `now` only at the host layer — inside the registry require explicit `at` OR accept `opts.now`; follow whichever pattern `createNotificationTraceRegistry` uses (read `notification-trace.ts:180` first and copy it).

- [ ] **Step 1:** Failing tests: record/get round-trip; FIFO eviction at cap; `stalled()` returns only entries without `routed`/`dropped` older than staleMs; snapshot is JSON-round-trippable (`JSON.parse(JSON.stringify(...))` deep-equals).
- [ ] **Step 2:** Implement; `npx tsx --test src/services/diagnostics/__tests__/pipeline-trace.test.mts` passes.
- [ ] **Step 3:** Add `getPipelineTraceRegistry()` to `diagnostics-state.ts` and reset it inside `resetDiagnosticsState()`. Append the test file to the `test:diagnostics` script. `npm run test:diagnostics` green; typecheck clean.
- [ ] **Step 4:** Commit: `feat: pipeline trace registry — fact lifecycle through the intelligence pipeline`.

### Task 6: wire trace recording + expose via MCP

**Files:**
- Modify: `src/services/insights/data-bridge.ts` (record `ingested` per bridged event, traceId = the event's stable id — read how `IncomingEvent` ids are built there), `src/services/insights/notification-ladder.ts` host or its caller (record `evaluated` + `routed`; find the caller with `grep -rn "routeBigEventToLadder" src/ --include="*.ts" | grep -v __tests__ | grep -v notification-ladder.ts`), `src/services/sidecar-pusher.ts` (add `pipelineTrace: getPipelineTraceRegistry().snapshot()` to the mirrored state — read the existing payload shape first and match it), `tools/mcp-server/tools/analyst.mjs` (new tool `get_pipeline_trace` reading the mirrored state from `/api/analyst-state`, filterable by domain and `stalledOnly`).

- [ ] **Step 1:** Wire `ingested` in data-bridge with `slog('info','pipeline',...)` alongside (Phase 2 logger, same traceId — this is where traceId and logs join up). Wire `evaluated`/`routed` at the ladder call-site, recording `routed` with `reason: decision.reason` and `detail: { rung: decision.rung, dispatched: decision.dispatched }`.
- [ ] **Step 2:** Extend the sidecar-pusher payload. Check the sidecar's `/api/analyst-state` route accepts arbitrary payload keys (read the route in `local-api-server.mjs`); if it validates a schema, extend it.
- [ ] **Step 3:** Add the MCP tool following the exact registration pattern of `get_reasoning_debug_log` in `tools/mcp-server/tools/analyst.mjs` (same fetch-from-sidecar approach, same error shape). Params: `{ domain?: string, stalledOnly?: boolean, limit?: number = 25 }`. `stalledOnly` filters entries whose last event stage is not `routed`/`dropped` and whose createdAt is > 10 min old.
- [ ] **Step 4:** Existing-suite check: `npm run test:insights` (data-bridge has tests — if recording breaks purity assumptions in tests, inject the registry as an optional param defaulting to the singleton, the pattern used elsewhere in insights). Typecheck clean.
- [ ] **Step 5:** Commit: `feat: wire pipeline trace through data-bridge + ladder, expose get_pipeline_trace MCP tool`.

---

## Phase 4 — Degradation alerting + persistent metrics

### Task 7: pure degradation detector

**Files:**
- Create: `src/services/diagnostics/degradation-alerts.ts`
- Test: `src/services/diagnostics/__tests__/degradation-alerts.test.mts`
- Modify: `package.json` (append to `test:diagnostics`)

```ts
/**
 * Compares two SystemHealthReport snapshots and emits alerts for
 * transitions that warrant user attention. Pure — host owns timing.
 */
import type { SystemHealthReport } from './system-health-types';

export interface DegradationAlert {
  id: string;                       // stable: `${kind}:${subjectId}:${toStatus}`
  kind: 'feature' | 'panel' | 'notification_pipeline';
  subjectId: string;
  fromStatus: string;
  toStatus: string;                 // 'degraded' | 'unsafe' | 'stale' | 'failing'
  safetyCritical: boolean;          // unsafe feature transitions only
  headline: string;                 // plain English for the notification
}

export function detectDegradations(
  prev: SystemHealthReport | null,
  curr: SystemHealthReport,
): readonly DegradationAlert[];
```

Rules: (1) feature healthy→degraded or any→unsafe alerts (unsafe ⇒ safetyCritical=true); (2) panel transitions into stale/failing alert; (3) `unsafeSuppressions` count increasing in the notification-trace summary alerts; (4) recovery (degraded→healthy) emits nothing (YAGNI); (5) `prev === null` emits nothing (first run baseline). Read `system-health-types.ts` for the actual report shape before writing — field names above are indicative, match the real types.

- [ ] **Step 1:** Failing tests with hand-built minimal `SystemHealthReport` fixtures covering all five rules.
- [ ] **Step 2:** Implement; tests pass; append test to `test:diagnostics`; typecheck.
- [ ] **Step 3:** Commit: `feat: pure degradation detector over system-health snapshots`.

### Task 8: host wiring through the notification ladder

**Files:**
- Modify: `src/app/panel-layout.ts` (a 60 s interval near the existing 30 s provider tick — find it with `grep -n "30" src/app/panel-layout.ts | grep -i interval` or search for `bridgeSourcesToProviderRedundancy`)

Each tick: build `curr` via `aggregateFromRegistries` (see `system-health.ts:100`), run `detectDegradations(prev, curr)`, and for each alert register it on the notification trace registry at domain `'system'` with `urgency: alert.safetyCritical ? 'critical' : 'normal'` and `safetyCritical: alert.safetyCritical` — reuse `routeBigEventToLadder`'s registry-recording shape OR call `registry.register` + `recordEvent` directly (simpler; copy the event sequence from `notification-ladder.ts:95-121`). Dedupe by alert `id` with a session-scoped `Set` so a persistent degradation alerts once, not every minute. Dispatch native notification only for `safetyCritical` alerts (find how existing critical notifications dispatch natively: `grep -rn "hypothesis-notifier" src/services/ | head -3` and reuse that mechanism).

- [ ] **Step 1:** Wire the interval + dedupe set; `slog('warn','diagnostics', alert.headline, {traceId: alert.id})` per alert.
- [ ] **Step 2:** Manual verification: `npm run dev`, then in the browser console force a degradation (e.g. call the panel-health registry's error recorder via the diagnostics state if exposed on window, or temporarily lower the stale threshold) and confirm a system-domain trace entry appears in the SystemDiagnosticPanel Notifications tab.
- [ ] **Step 3:** `npm run typecheck:all` + `npm run test:diagnostics`. Commit: `feat: degradation alerting — health-registry transitions route through notification trace`.

### Task 9: persistent reasoning metrics

**Files:**
- Modify: `src/services/reasoning-metrics.ts`
- Test: extend its existing test file if present (`ls src/services/__tests__/ | grep -i metric`), else create `src/services/__tests__/reasoning-metrics-persist.test.mts`

Counters (not histograms — YAGNI) persist across reloads: on `snapshot()`-shaped state change, debounce-write counters to the existing `reasoning-memory` IDB KV (key `cb-reasoning-counters-v1`, 10 s debounce — copy the debounce pattern from `reasoning-debug.ts`); on module init, hydrate counters additively. Guard the IDB calls so the module stays importable in tests/node (reasoning-memory already handles non-browser gracefully — verify by reading it).

- [ ] **Step 1:** Failing test: counters hydrate additively from an injected fake store; debounced persist called once for a burst of increments (inject fake timers or a `flushForTest` hook — follow whatever `reasoning-debug.ts` tests do).
- [ ] **Step 2:** Implement; tests + typecheck green.
- [ ] **Step 3:** Commit: `feat: persist reasoning metric counters across reloads`.

### Task 10: integrate smoke into checkup + docs

**Files:**
- Modify: `scripts/checkup.mjs` (add replay-baseline check as section 7, reusing the smoke script's baseline-compare function — export it from `scripts/smoke.mts` or duplicate the 10-line compare), `CLAUDE.md` (add `npm run smoke` to the Commands section and one line each for pipeline-trace + degradation-alerts under the diagnostics docs), `docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md` only if it lists these gaps (check first).

- [ ] **Step 1:** Wire + run `npm run checkup` end-to-end (expect GREEN or pre-existing YELLOWs only).
- [ ] **Step 2:** `npm run docs:check` must pass (it flags doc/source drift — if it complains about counts, fix the docs it names).
- [ ] **Step 3:** Commit: `docs: register smoke suite + new diagnostics in checkup and CLAUDE.md`.

---

## Final verification (whole branch)

- [ ] `npm run typecheck:all` — zero errors.
- [ ] `npm run checkup` — GREEN/YELLOW only.
- [ ] `npm run smoke:offline` — exit 0.
- [ ] `npm run test:diagnostics && npm run test:insights && npm run test:sidecar && npm run test:replay` — all green.
- [ ] `npm run secrets:scan` — clean.
- [ ] `npm run cross-check` — note the required cross-agent reviewer for the PR.
- [ ] Push `claude/observability-enhancement` to origin, open PR.
