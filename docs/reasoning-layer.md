# Crystal Ball — Reasoning Layer

This document describes the renderer-side reasoning stack added under
`claude/enhance-crystal-ball-hj4YK`. Read this before touching any of the
services in the "Service graph" section below — they share a single event
bus, a shared IDB object store, and a set of cross-import conventions that
break easily if you don't know they exist.

## Goal

Fuse the existing surfaces — `situation-engine`, `anomaly-detection`,
`unified-alerts`, `threat-synthesis`, `watchlist` — into a single ranked
list of cross-domain hypotheses with evidence links, learn from user
feedback over time, surface the result as a keyboard-driven overlay HUD,
and expose the same state to Claude via the Crystal Ball MCP server so
external agents can read and write back.

## Service graph

Arrows indicate runtime dependency (value imports). Type-only imports are
erased and not shown.

```
                     ┌─────────────────────┐
                     │   analyst-loop.ts   │◀─ rank() + runAnalystCycle()
                     └─────────┬───────────┘
          ┌────────────────────┼──────────────────────────────┐
          ▼                    ▼                              ▼
 threat-synthesis       situation-engine             anomaly-detection
 (existing)             (existing)                   (existing)
          │                    │                              │
          └──────────────┐     │    ┌─────────────────────────┘
                         ▼     ▼    ▼
                  unified-alerts + alert-routing  ◀── scoreAlert()
                                 │
                                 ▼
                      watchlist-hypothesis-bridge ─── getWatchlistHypotheses()
                                                      (also feeds analyst-loop)

 ranking multipliers applied inside analyst-loop.rank():
   × getHypothesisFeedbackMult()          (hypothesis-feedback.ts)
   × getHypothesisAccuracyMult()          (hypothesis-accuracy.ts)
   + isDismissed() filter                 (analyst-command-listener.ts)
   + dedupeHypotheses()                   (hypothesis-dedupe.ts)

 consumers of the snapshot emitted by analyst-loop:
   → hypothesis-threads          cycle count + trajectory per signature
   → hypothesis-entities         country / ticker / CVE / callsign index
   → hypothesis-accuracy         outcome grading after 2h window
   → hypothesis-skeptic          opt-in second-pass contrarian review
   → hypothesis-notifier         desktop notification on new critical
   → snapshot-archive            120-slot ring buffer for replay
   → action-memory               playbook log keyed by signature
   → sidecar-pusher              POSTs to /api/analyst-state for MCP

 on-demand invocations from the HUD:
   → hypothesis-projection       24/48h forward-look + cascade-sim
   → hypothesis-ensemble         analyst / skeptic / pragmatist fan-out
   → question-suggester          investigative chips → askQuestion()
   → hypothesis-export           markdown bundle to clipboard
```

## Event bus

All cross-service communication uses `document.dispatchEvent` +
`document.addEventListener`. This is a deliberate choice — it keeps
services decoupled without a DI container.

| Event                              | Emitter                 | Consumers                                        |
|------------------------------------|-------------------------|--------------------------------------------------|
| `cb:analyst-hypotheses`            | analyst-loop            | threads, entities, accuracy, skeptic, notifier, snapshot-archive, sidecar-pusher, action-memory(HUD) |
| `cb:mode-advisory`                 | mode-forecast           | pressure-history, pressure-baselines, auto-brief, sidecar-pusher, HUD |
| `cb:pressure-history`              | pressure-history        | HUD                                              |
| `cb:hypothesis-threads`            | hypothesis-threads      | HUD                                              |
| `cb:hypothesis-entities`           | hypothesis-entities     | HUD                                              |
| `cb:auto-brief`                    | auto-brief              | briefing-archive, HUD                            |
| `cb:briefing-archived`             | briefing-archive        | HUD                                              |
| `cb:skeptic-note`                  | hypothesis-skeptic      | HUD                                              |
| `cb:hypothesis-skeptic-requested`  | analyst-command-listener| hypothesis-skeptic (bypass opt-in)               |
| `cb:hypothesis-projection`         | hypothesis-projection   | HUD                                              |
| `cb:hypothesis-ensemble`           | hypothesis-ensemble     | HUD                                              |
| `cb:hypothesis-feedback`           | hypothesis-feedback     | HUD                                              |
| `cb:hypothesis-dismissed`          | analyst-command-listener| HUD                                              |
| `cb:hypothesis-export-copied`      | hypothesis-export       | HUD (flash "copied ✓")                           |
| `cb:snapshot-archived`             | snapshot-archive        | HUD                                              |
| `cb:llm-budget`                    | llm-budget              | HUD                                              |
| `cb:analyst-hud-visibility`        | AnalystHUD              | hypothesis-notifier                              |
| `cb:action-recorded`               | action-memory           | (reserved for future)                            |
| `cb:question-answered`             | question-suggester      | HUD                                              |
| `cb:toggle-analyst-hud`            | bootstrap keybinding    | AnalystHUD                                       |

## Storage layout

Two persistence layers — localStorage for synchronous bootstrap, IDB for
durable multi-week memory. All reasoning services use the helper module
`reasoning-memory.ts` for IDB access; it shares the `crystalball_db`
database with `alert-store.ts`.

| Storage key                                   | Service                   | Kind     |
|-----------------------------------------------|---------------------------|----------|
| `crystalball-analyst-snapshot-v1`             | analyst-loop              | LS only  |
| `crystalball-mode-forecast-v1`                | mode-forecast             | LS only  |
| `crystalball-hypothesis-feedback-v1`          | hypothesis-feedback       | LS only  |
| `crystalball-hypothesis-accuracy-v1`          | hypothesis-accuracy       | LS + IDB |
| `crystalball-hypothesis-threads-v1`           | hypothesis-threads        | LS + IDB |
| `crystalball-pressure-history-v1`             | pressure-history          | LS only  |
| `crystalball-pressure-baselines-v1`           | pressure-baselines        | LS + IDB |
| `crystalball-relevance-weights-v1`            | relevance-learner         | LS + IDB |
| `crystalball-action-memory-v1`                | action-memory             | LS + IDB |
| `crystalball-auto-brief-v1`                   | auto-brief                | LS only  |
| `crystalball-briefing-archive-v1`             | briefing-archive          | LS + IDB |
| `crystalball-snapshot-archive-v1`             | snapshot-archive          | LS + IDB |
| `crystalball-skeptic-notes-v1`                | hypothesis-skeptic        | LS only  |
| `crystalball-hypothesis-projections-v1`       | hypothesis-projection     | LS + IDB |
| `crystalball-question-answers-v1`             | question-suggester        | LS + IDB |
| `crystalball-hypothesis-ensemble-v1`          | hypothesis-ensemble       | LS + IDB |
| `crystalball-dismissed-hypotheses-v1`         | analyst-command-listener  | LS + IDB |
| `crystalball-llm-budget-v1`                   | llm-budget                | LS + IDB |

**IDB store name:** `reasoning_memory` (new), keypath `key`. Version bump
logic in `reasoning-memory.ts:openWithUpgrade` preserves the `baselines`,
`snapshots`, and `unified_alerts` stores other modules expect.

## MCP surface

The renderer pushes state to the sidecar via
`sidecar-pusher.ts` → `POST /api/analyst-state`. The sidecar caches in
memory (`context._analystState`, ≤10min stale flag) and exposes it via
`GET /api/analyst-state` to the MCP server.

MCP tools registered in `tools/mcp-server/tools/analyst.mjs`:

| Tool                             | Direction | Purpose                                              |
|----------------------------------|-----------|------------------------------------------------------|
| `get_analyst_hypotheses`         | read      | Top ranked hypotheses with thread enrichment         |
| `get_mode_forecast`              | read      | Per-domain pressure + advisories                     |
| `get_analyst_accuracy`           | read      | Per-kind hit/miss ratios                             |
| `get_hot_entities`               | read      | Entities appearing in 2+ concurrent hypotheses       |
| `submit_hypothesis_feedback`     | write     | Thumbs up/down on a signature                        |
| `dismiss_hypothesis`             | write     | Hide from HUD + ranking for 24h                      |
| `run_skeptic_now`                | write     | Force immediate skeptic review                       |

Write-back path: MCP → `POST /api/analyst-commands` → sidecar queue →
renderer polls `GET /api/analyst-commands` via `analyst-command-listener.ts`
every 10s (30s Ghost Mode) → applies via `signatureFor` match.

## LLM routing

`llm-adapter.ts → generateText()` is the single entry point used by
`auto-brief`, `hypothesis-skeptic`, `hypothesis-projection`,
`question-suggester`, and `hypothesis-ensemble`.

1. Prefers local LLM via sidecar `/api/intel-generate` (Ollama / LM Studio → Groq).
2. On local failure, tries `runClaudeAgent` (cloud agent) — gated by
   `canSpend('cloud-agent')` from `llm-budget.ts`.
3. Returns `{ provider: 'none' }` when budget exhausted or everything fails;
   callers are written to treat this as a soft-retry condition.

`llm-budget.ts` enforces a daily cap on cloud calls (default 50, UTC-midnight
rollover). Local calls are uncounted.

## Sitrep citations

`src-tauri/sidecar/sitrep-filter.mjs` now emits a `citations[]` array in
the `/api/sitrep-bundle` response. The `.claude/commands/sitrep.md` subagent
prompt instructs the model to reference items inline with keys like `[wx-1]`
and append a CITATIONS footer. The main-context client can parse the footer
to deep-link each citation to its panel.

## Invariants to respect

1. **Ghost Mode suppression.** Most services check `isGhostMode()` and
   short-circuit notifications, LLM calls, or learning. Mirror this pattern
   if you add another service.
2. **No circular imports.** `hypothesis-accuracy` and `analyst-command-listener`
   both avoid importing `getAnalystSnapshot` from `analyst-loop` — they
   listen to `cb:analyst-hypotheses` instead. If you import `analyst-loop`
   at the value level from any of its consumers, you will create a cycle.
3. **Type-only imports from the pusher to type-only.** `sidecar-pusher.ts`
   imports types from `analyst-loop` and `mode-forecast`; keep those imports
   `type-only` to avoid cycles through the pusher.
4. **IDB is best-effort.** Every service also writes to localStorage so the
   first render has data. IDB errors are logged and swallowed — don't add
   throw-on-error paths that would crash the boot.
5. **Bootstrap order matters.** See `src/app/panel-layout.ts`. The current
   order is:

   ```text
   startRelevanceLearner → startModeForecast → startPressureBaselines
   → startPressureHistory → startAnalystLoop → startHypothesisThreads
   → startHypothesisEntities → startHypothesisAccuracy → startAutoBrief
   → startHypothesisSkeptic → startActionMemory → startBriefingArchive
   → startSnapshotArchive → startHypothesisNotifier → startSidecarPusher
   → startAnalystCommandListener
   ```

   `analyst-loop` must start after the things it depends on are listening
   so they don't miss its first snapshot.

## Keyboard shortcuts

| Shortcut        | Action                       |
|-----------------|------------------------------|
| ⌘⇧A (Ctrl⇧A)    | Toggle AnalystHUD            |
| ⌘⇧H (Ctrl⇧H)    | Export briefing to clipboard |
| ⌘⇧S (Ctrl⇧S)    | Toggle StatusOverlay         |
| ⌘⇧G (Ctrl⇧G)    | Toggle Ghost Mode            |

Inside the AnalystHUD:

| Shortcut        | Action                                      |
|-----------------|---------------------------------------------|
| Esc             | Close                                       |
| ↑ / ↓           | Select next/previous hypothesis row         |
| Enter           | Expand / collapse projection on selection   |
| Shift+Enter     | Expand / collapse ensemble on selection     |

## Tests

| Suite                        | Count | Command                    |
|------------------------------|-------|----------------------------|
| Reasoning unit tests         | 34    | `npm run test:reasoning`   |
| MCP analyst tools            | 11    | `cd tools/mcp-server && node --test __tests__/analyst-tools.test.mjs` |
| Sidecar (includes analyst-state) | 78 | `npm run test:sidecar`     |

Pure-logic services have direct unit tests. Services with heavy DOM / IDB /
localStorage dependencies (HUD, notifiers, poller) are exercised indirectly
through the sidecar and MCP test suites, which mock the sidecar and assert
against the public API shapes.
