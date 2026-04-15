# Crystal Ball — Claude Code Context

## Project Overview

- **App name**: Crystal Ball
- **Bundle ID**: `com.bradleybond.crystalball`
- **Stack**: Tauri 2 + TypeScript + Vite + DeckGL + Cesium.js + Node.js sidecar (port 46123) + MCP server

## Commands

```bash
npm run desktop:build:full   # full production build
npm run typecheck:all        # type-check both tsconfig.json + tsconfig.api.json (must stay at zero errors)
npm run dev                  # vite dev server (web only, no Tauri)
npm run release:prepare -- --bump patch --push   # only supported release path
```

Install built app: copy `src-tauri/target/release/bundle/macos/Crystal Ball.app` to `~/Applications/Crystal Ball.app` (use `node scripts/install-built-app.mjs --relaunch`).

## CANONICAL REPO — SINGLE SOURCE OF TRUTH (MANDATE)

There is exactly ONE place to develop this app:
```
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
    panel-layout.ts         # panel instantiation + sidebar layout
    data-loader.ts          # data fetching, task scheduling
    refresh-scheduler.ts    # scheduleRefresh() — ghost multiplier + hidden×10 + jitter
    event-handlers.ts       # UI events, keyboard shortcuts
  components/
    Panel.ts                # base Panel class
    GlobeHUD.ts             # God's Eye HUD overlay
    GlobeDataManager.ts     # God's Eye Cesium layer manager
    GodsVisionView.ts          # God's Eye 3D globe view
  config/
    panels.ts               # FULL_PANELS, PANEL_CATEGORY_MAP, FULL_MAP_LAYERS
  services/
    mode-manager.ts         # AppMode: ghost | gods-vision | null (default)
    alert-store.ts          # unified alert inbox, IndexedDB persistence
    correlation-engine.ts   # directional rules, causal chains, situation clustering
    navigation.ts           # GPS tracker, routing engine, tile provider
    runtime-config.ts       # API key definitions, feature toggles
    settings-constants.ts   # HUMAN_LABELS, SIGNUP_URLS, SETTINGS_CATEGORIES
    analytics.ts            # PostHog (suppressed in Ghost Mode)
src-tauri/
  sidecar/local-api-server.mjs  # Node.js API proxy, port 46123
  capabilities/default.json     # Tauri capability allowlist
  src/main.rs                   # SUPPORTED_SECRET_KEYS, keychain service "crystal-ball"
mcp-server/                     # MCP server — 19+ tools for Claude Code integration
  src/index.ts                  # server entry point, tool registration
  src/tools/                    # aggregate + granular tool implementations
  src/sidecar-client.ts         # port/token discovery, HTTP helpers
tools/cb-control/               # cross-session coordination daemon (port 46987)
```

## App Modes (`src/services/mode-manager.ts`)

| Mode | Trigger |
|------|---------|
| Default (`null`) | Normal state — no special mode active |
| Ghost | Manual only — ⌘⇧G / sidebar / File menu |
| God's Vision | `G` key or sidebar — full-viewport Cesium 3D globe |

Ghost Mode: polling ×5, analytics suppressed, notifications suppressed, dark crimson sidebar. The old Peace/Finance/War/Disaster modes have been removed — their behaviors are inlined into the default state.

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

Mandatory repo secret scan enforcement in hooks and CI. Keep `npm run secrets:scan:staged` and `npm run secrets:scan` active and passing.
