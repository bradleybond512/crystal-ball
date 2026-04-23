# Crystal Ball — Claude Code Context

## Project Overview

- **App name**: Crystal Ball
- **Bundle ID**: `com.bradleybond.crystalball`
- **Stack**: Tauri 2 + TypeScript + Vite + DeckGL + Node.js sidecar (port 46123)

## Commands

```bash
npm run desktop:build:full   # full production build
npm run typecheck:all        # type-check both tsconfig.json + tsconfig.api.json (must stay at zero errors)
npm run dev                  # vite dev server (web only, no Tauri)
npm run release:prepare -- --bump patch --push   # only supported release path
```

Install built app: copy `src-tauri/target/release/bundle/macos/Crystal Ball.app` to `~/Applications/Crystal Ball.app` (use `node scripts/install-built-app.mjs --relaunch`).

## Release Management

The supported release path is **tag-driven**. Desktop publishing runs from the `build-desktop.yml` workflow when a `vX.Y.Z` (or `vX.Y.Z-<variant>`) tag is pushed to `origin`. `workflow_dispatch` builds artifacts without publishing.

- Supported variants: `full`, `tech`, `finance` (see `scripts/release-metadata.mjs`).
- Only supported release command: `npm run release:prepare -- --bump patch --push`. It bumps `package.json`, writes the CHANGELOG entry, tags, and pushes — the tag push is what triggers the publisher.
- The release-integrity workflow runs `release-doctor.mjs` per-variant on `main` pushes (strict) and on PRs (with `--allow-existing-target-release` so unrelated PRs don't break).
- Never publish manually with `gh release create` or by hand-editing tags; the workflow collects a manifest, verifies the downloaded payload, and only then promotes to public release.

## CANONICAL REPO — SINGLE SOURCE OF TRUTH (MANDATE)

There is exactly ONE place to develop this app:

```text
~/developer/crystalball
```

- **Never** build, commit, or make changes in any other clone
- **Never** install to `/Applications` from any other build directory
- Always install from: `src-tauri/target/release/bundle/macos/Crystal Ball.app` in this directory
- The Dock and Spotlight should point to `~/Applications/Crystal Ball.app` only

## Git Remotes

- `origin` — `bradleybond512/crystal-ball` — **always push here**

Always commit with: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

## Branch Discipline (MANDATORY for every session)

**Never commit directly to local `main`.** Every session must follow this flow:

```bash
git fetch origin
git checkout -b claude/your-feature-name origin/main  # or codex/your-feature-name
# ... do work, commit freely on the branch ...
git push origin claude/your-feature-name
# open a PR → auto-merge lands it
```

- Branch names: `claude/*` for Claude sessions, `codex/*` for Codex sessions
- Local `main` should only ever be fast-forwarded to `origin/main`, never developed on directly

## Architecture

```
src/                        # TypeScript frontend (Vite)
  app/
    panel-layout.ts         # panel instantiation + sidebar layout + bootstrap
    data-loader.ts          # data fetching, task scheduling
    refresh-scheduler.ts    # scheduleRefresh() — ghost multiplier + hidden×10 + jitter
    event-handlers.ts       # UI events, keyboard shortcuts
  components/
    Panel.ts                # base Panel class
    GlobeHUD.ts             # God's Eye HUD overlay
    GlobeDataManager.ts     # God's Eye Cesium layer manager
    GodsVisionView.ts       # God's Eye 3D globe view
    AnalystHUD.ts           # ⌘⇧A analyst reasoning HUD
    ReasoningDebugOverlay.ts # ⌘⇧D diagnostics overlay
  config/
    panels.ts               # FULL_PANELS, PANEL_CATEGORY_MAP, FULL_MAP_LAYERS
  services/
    mode-manager.ts         # AppMode: peace/finance/war/disaster/ghost
    runtime-config.ts       # API key definitions, feature toggles
    settings-constants.ts   # HUMAN_LABELS, KEY_DESCRIPTIONS, SIGNUP_URLS, SETTINGS_CATEGORIES
    analytics.ts            # PostHog (suppressed in Ghost Mode)
    # ── Analyst reasoning layer (see docs/reasoning-layer.md) ──
    analyst-loop.ts             # cross-domain hypothesis fusion + ranking
    mode-forecast.ts            # per-domain pressure EWMA + advisories
    pressure-baselines.ts       # 168 hour-of-week baselines per domain
    pressure-history.ts         # rolling sparkline samples + critical notif
    hypothesis-threads.ts       # signature-keyed continuity tracker
    hypothesis-entities.ts      # country/ticker/CVE/callsign extraction
    hypothesis-feedback.ts      # signature-keyed thumbs up/down
    hypothesis-accuracy.ts      # outcome-graded hit/miss per kind
    hypothesis-dedupe.ts        # union-find merge across reasoning surfaces
    hypothesis-skeptic.ts       # opt-in second-pass contrarian LLM
    hypothesis-projection.ts    # 24/48h projection + cascade-sim addendum
    hypothesis-ensemble.ts      # analyst/skeptic/pragmatist personas
    hypothesis-notifier.ts      # native notification on critical-first
    hypothesis-export.ts        # markdown bundle for clipboard
    auto-brief.ts               # critical-crossover Claude brief
    briefing-archive.ts         # 200-entry brief ring
    snapshot-archive.ts         # 120-entry analyst-snapshot ring
    action-memory.ts            # playbook recorder ("last time you did X")
    relevance-learner.ts        # per-term boost from user engagement
    watchlist-hypothesis-bridge.ts  # watchlist matches → hypotheses
    question-suggester.ts       # 3 investigative chips per hypothesis
    analyst-command-listener.ts # MCP write-back queue poller
    sidecar-pusher.ts           # mirror analyst state → /api/analyst-state
    llm-adapter.ts              # local-first generateText() (Ollama → cloud)
    llm-budget.ts               # daily cloud-call cap + race-safe reserve
    reasoning-memory.ts         # IDB KV store on shared crystalball_db
    reasoning-debug.ts          # 200-entry ring buffer log
    reasoning-metrics.ts        # latency histograms + counters
src-tauri/
  sidecar/local-api-server.mjs  # Node.js API proxy, port 46123 — exposes
                                # /api/analyst-state + /api/analyst-commands
                                # for MCP read+write to renderer state
  capabilities/default.json     # Tauri capability allowlist
  src/main.rs                   # SUPPORTED_SECRET_KEYS, keychain service "crystal-ball"
tools/mcp-server/
  index.mjs                # MCP server registering 30+ tools
  tools/analyst.mjs        # 9 analyst tools (4 read + 3 write + 2 diagnostic)
```

## Analyst Reasoning Layer

A persistent, renderer-side reasoning stack that fuses `situation-engine`, `anomaly-detection`, `unified-alerts`, `threat-synthesis`, and the `watchlist` into ranked cross-domain hypotheses. The full architecture (event bus, IDB schema, MCP surface, invariants, bootstrap order) lives in [`docs/reasoning-layer.md`](docs/reasoning-layer.md). Highlights:

- **HUD**: ⌘⇧A. Sections: posture advisories (with sparklines), hot entities, ranked hypotheses with thread badges + entity chips + clickable evidence, auto-briefs, briefing timeline, replay scrubber.
- **Diagnostics**: ⌘⇧D. Four tabs (Events / Metrics / State / Boot). HUD footer shows live error counter.
- **LLM**: `llm-adapter.generateText()` is the single entry point; prefers Ollama / LM Studio via `/api/intel-generate` before falling back to `runClaudeAgent`. Daily cloud-call cap enforced by `llm-budget.reserveCloudCall()` (race-safe for parallel personas).
- **MCP**: 4 read + 3 write + 2 diagnostic tools — see `tools/mcp-server/tools/analyst.mjs`.
- **Memory**: IDB `reasoning_memory` store on the shared `crystalball_db` (versionchange handlers in alert-store and reasoning-memory let upgrades happen without blocking each other). LS bootstrap + writtenSinceLoad guard against IDB hydrate races.

## App Modes (`src/services/mode-manager.ts`)

| Mode | Trigger |
|------|---------|
| Peace | default |
| Finance | S&P500 ≥2.5% OR BTC ≥5% OR Oil ≥4% OR Gold ≥2% |
| War | ≥2 war signals > confidence 0.6 (normalized by conflict baselines) |
| Disaster | GDACS Red OR 3+ Orange OR M≥6.5 quake |
| Ghost | Manual only — ⌘⇧G / sidebar / File menu |

Ghost Mode: polling ×5, analytics suppressed, notifications suppressed, dark crimson sidebar.

## CSP Posture

`script-src` includes `'unsafe-eval'`. Required by Cesium (God's Eye 3D globe) for shader compilation. Do not remove without first replacing Cesium with a non-eval globe library. Compensating defenses: trusted-window IPC gating, sidecar bearer auth, no `'unsafe-inline'` on script-src, devtools disabled in production.

## Tauri 2 / WKWebView Gotchas

- **Window drag**: CSS `-webkit-app-region: drag` does NOT work — use JS `mousedown` → `tryInvokeTauri('plugin:window|start_dragging')`. Requires `core:window:allow-start-dragging` in `capabilities/default.json`.
- **Local iframes**: Always `http://127.0.0.1:{port}`, never `localhost` — CSP only allows `127.0.0.1`. Use `getApiBaseUrl()` from `runtime.ts`.
- **Devtools**: Use `--features devtools` flag during dev (NOT in default features).

## Persistence Identifiers

- `localStorage` keys are `crystalball-*` / `cb-*` / `cb:*`
- IndexedDB is `crystalball_db`
- macOS Keychain service is `crystal-ball`
- Log directory is `~/Library/Logs/com.bradleybond.crystalball/`

## Settings / API Keys

API keys entered via gear icon → API Keys tab. None embed the brand in their names; all 49 supported keys are generic API names (ANTHROPIC_API_KEY, GROQ_API_KEY, etc).

## Secret Scan Guardrail

Mandatory repo secret scan enforcement in hooks and CI. This is a user-owned repo on GitHub — provider-native secret validity checks and non-provider patterns don't cover everything on their own, so the compensating control is mandatory repo-level scanning. Keep `npm run secrets:scan:staged` and `npm run secrets:scan` active and passing.
