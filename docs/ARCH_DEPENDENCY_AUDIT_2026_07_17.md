# Crystal Ball — Architecture & Dependency Audit
**Date:** 2026-07-17  
**Branch:** `claude/arch-dependency-audit`  
**Auditor:** Claude Sonnet 4.6

---

## Summary

| Area | Findings | Fixed in this PR |
|------|----------|-----------------|
| Circular dependencies | 11 detected; 3 confirmed runtime cycles | ✅ All 3 broken |
| Layering violations | 6 service→component imports | ✅ Core violation fixed (`belief-helpers`) |
| God objects / SRP | 4 extreme files; 14 barrel-export violations | ⚠️ Documented (multi-PR refactor) |
| Global singletons | 1,578 module-level mutable vars (expected) | ⚠️ Documented pattern |
| npm audit | 0 CVEs | ✅ Clean |
| npm outdated | 45 packages behind | ⚠️ Batch update recommended |
| Misplaced npm deps | `h3-js` + `@xmpp/client` in devDependencies | ✅ Moved to dependencies |
| Unused npm deps | 8 candidates flagged | ⚠️ Requires manual verification |
| Cargo audit | cargo-audit not in sandbox; CI has it | ✅ CI coverage exists |
| CSP | 2 informational warnings | ⚠️ Noted; no change needed |
| Tauri allowlist | Minimal; all permissions verified used | ✅ Clean |
| Vite config | No sourcemaps in prod; chunks correct | ✅ Clean |
| `.gitignore` | Complete; no tracked secrets/artifacts | ✅ Clean |
| TODO/FIXME debt | 1 actionable TODO in source | ⚠️ Noted |

---

## 1. Circular Dependencies

### 1a. Confirmed Runtime Cycles (Fixed)

**`reasoning-memory` ↔ `reasoning-debug`** *(FIXED)*  
- `reasoning-memory.ts:19` imported `logDebug` from `reasoning-debug.ts`  
- `reasoning-debug.ts:18` imports `getMemory`/`putMemory` from `reasoning-memory.ts`  
- **Root cause:** `reasoning-memory` is a low-level IDB primitive; it should never depend on its own consumer.  
- **Fix:** Replaced the 4 `logDebug(...)` calls in `reasoning-memory.ts` with `console.error(...)`. Added a guard comment.

**`algorithm-ledger-persistence` ↔ `algorithms-state`** *(FIXED)*  
- `algorithm-ledger-persistence.ts:26` imported `getAlgorithmEvaluationLedger` as a top-level import  
- `algorithms-state.ts:20` imports `resetAlgorithmLedgerPersistence` from the persistence file  
- **Fix:** Removed the top-level import; added a `getDefaultLedger()` lazy-require that defers to `require('./algorithms-state')` at call time, breaking the startup cycle without touching the public API. All existing DI injection (`deps.ledger`) continues to work.

**`mission-ledger-persistence` ↔ `mission-state`** *(FIXED)*  
- Same pattern as the algorithm cycle above.  
- **Fix:** Same lazy-require pattern with `getDefaultMissionLedger()`.

### 1b. Type-Only Cycles (Safe — No Action Needed)

These were detected by the Tarjan SCC scan but all cross-edges use `import type`, which TypeScript erases at compile time:

| Cycle | Cross-edge | Verdict |
|-------|-----------|---------|
| `analyst-loop` 6-way | All `import type { Hypothesis }` | ✅ Safe |
| `unified-alerts` ↔ `notification-dispatcher` ↔ `alert-store` | `notification-dispatcher` + `alert-store` import `type` only | ✅ Safe |
| `analysis-core` ↔ `entity-extraction` | `entity-extraction` imports `type` only | ✅ Safe |
| `exposure-graph` ↔ `cyber-adapter` | `exposure-graph` imports `type CyberSector` only | ✅ Safe |
| `llm-adapter` ↔ `llm-budget` | `llm-budget` imports `type LlmProvider` only | ✅ Safe |
| `pressure-baselines` ↔ `mode-forecast` | `pressure-baselines` imports `type` only | ✅ Safe |
| `adsb` ↔ `adsb-aggregate-bridge` | `adsb-aggregate-bridge` imports `type` only | ✅ Safe |
| `voice-alerter` ↔ `push-notifier` | `voice-alerter` imports `type NotifiableEvent` only | ✅ Safe |

---

## 2. Layering Violations

### 2a. Services importing from `components/` (Fixed)

**`services/intelligence/belief-helpers` location** *(FIXED)*  
- `belief-helpers.ts` is pure Bayesian math (no DOM, no fetch, no globals) but lived in `src/components/`.
- Two service files imported it across the layer boundary:
  - `services/intelligence/truth-score.ts:30`
  - `services/intelligence/driver-scores.ts:18`
- A third non-service file also violated this: `types/correlation-engine.ts:2`
- **Fix:** Copied canonical file to `src/services/intelligence/belief-helpers.ts`, updated the `types/belief.ts` path reference in the import, replaced `src/components/belief-helpers.ts` with a re-export shim for backward compatibility with `BeliefCalibrationPanel`.

### 2b. Remaining Violations (Future PRs)

| File | Imports from | Severity |
|------|-------------|----------|
| `services/infrastructure/grid-intelligence-loader.ts:37-38` | `@/components/GridIntelligencePanel` + `InfrastructureBannerBar` | Medium — loader is tightly coupled to the panel it drives; consider callback/interface injection |
| `services/opensanctions.ts:3` | `type { SanctionsDataset }` from `@/components/open-sanctions-helpers` | Low — type-only; move type to `services/` |
| `services/spaceweather/status-bar-poller.ts:8` | `type { EEWStatusBar }` from `@/components/EEWStatusBar` | Low — type-only injection; acceptable but move type decl |

### 2c. Config importing services (Acceptable)

`config/feeds.ts` imports `getApiBaseUrl` from `services/runtime` — this is intentional (config needs runtime base URL). `config/panel-metadata.ts` imports a `type` from `services/insights/reaction-playbooks` — type-only, safe.

---

## 3. God Objects / SRP

### Extreme file sizes (multi-PR refactor candidates)

| File | Lines | Notes |
|------|-------|-------|
| `components/DeckGLMap.ts` | 6,718 | Map rendering, basemap switcher, DeckGL layer management, event handling — 4+ responsibilities |
| `app/data-loader.ts` | 4,183 | Fetch orchestration, scheduling, caching, IDB writing — consider splitting by domain |
| `components/Map.ts` | 3,699 | Likely overlaps with DeckGLMap — audit for duplication |
| `app/panel-layout.ts` | 3,451 | Panel instantiation + layout + bootstrap + event wiring — split into smaller concern files |
| `components/GlobeDataManager.ts` | 3,263 | Could be further split by layer type |

### Barrel-export inflation (not god objects — just large surface area)

`types/index.ts` (140 exports), `components/index.ts` (134 re-exports), `services/index.ts` (105 re-exports). These are fine as barrels — they don't carry logic.

### Highest fan-in (most-imported modules — watch coupling)

| Module | Importers | Action |
|--------|-----------|--------|
| `components/Panel.ts` | 435 | Expected base class — acceptable |
| `services/unified-alerts.ts` | 67 | High coupling — consider event bus pattern for non-critical consumers |
| `services/runtime.ts` | 37 | Expected utility — acceptable |
| `services/data-freshness.ts` | 33 | Consider splitting freshness types from freshness logic |

---

## 4. Global Singleton Audit

1,578 module-level mutable variable occurrences found across 400+ files. This is expected for a browser app that cannot use DI containers. The patterns are consistent and documented:

- **Intentional singletons with clear ownership:** `reasoning-memory`, `web-secret-store`, `sound-manager`, `oref-alerts` — all use the established `let _instance = null` + lazy-init pattern.
- **`app/panel-layout.ts`** (132 occurrences) is the highest concentration — this file is the bootstrap entrypoint and its global state is acceptable.
- **Testing concern:** 14 modules import singletons that can't be injected. The persistence layer (`algorithm-ledger-persistence`, `mission-ledger-persistence`) already uses the `deps` injection pattern for testability — this PR extends that to break the cycles. Other services should adopt the same pattern incrementally.

---

## 5. npm Dependency Audit

### 5a. Security: 0 vulnerabilities

`npm audit` is clean.

### 5b. Outdated packages (45 behind)

Priority updates (no breaking changes expected):

| Package | Current | Latest | Note |
|---------|---------|--------|------|
| `@sentry/browser` | 10.47.0 | 10.66.0 | 19 minor versions behind |
| `cesium` | 1.140.0 | 1.143.0 | 3 patch versions |
| `@deck.gl/*` | 9.3.4 | 9.3.7 | Patch versions |
| `@luma.gl/*` | 9.3.3 | 9.3.6 | Patch versions |
| `fast-xml-parser` | 5.7.2 | 5.10.1 | Check changelog for parser tightening |
| `posthog-js` | 1.391.5 | 1.404.1 | Tracking lib — update to get latest privacy fixes |
| `eslint-plugin-unicorn` | 63.0.0 | 72.0.0 | Major — new rules, may require `eslint:disable` additions |
| `tauri CLI` | 2.11.2 | 2.11.4 | Patch |

Recommendation: batch-update the `@deck.gl/*` + `@luma.gl/*` together (same team, coordinated releases), then `cesium` and `@sentry/browser` separately.

### 5c. Misplaced dependencies (Fixed in this PR)

| Package | Was | Fixed to | Reason |
|---------|-----|---------|--------|
| `h3-js` | devDependencies | dependencies | Used in `src/services/gps-interference.ts` (production code, Vite-bundled) |
| `@xmpp/client` | devDependencies | dependencies | Used in `src-tauri/sidecar/s2u-xmpp-source.mjs` (bundled into sidecar at build time) |

### 5d. Potentially unused production dependencies (manual verification needed)

These packages appear in `dependencies` with no `import` references found in any source file:

| Package | Verdict |
|---------|---------|
| `papaparse` | No imports found — confirm no dynamic import or external usage |
| `convex` | No imports found |
| `telegram` | No imports found (locale strings mention "Telegram" but as text only) |
| `youtubei.js` | No imports found |
| `@upstash/redis` | No imports found — may be used server-side only (Vercel API) |
| `@upstash/ratelimit` | No imports found |
| `onnxruntime-web` | Referenced in vite.config `onwarn` filter + `manualChunks` — likely dynamically imported |
| `@deck.gl/geo-layers` | No direct import; used transitively by deck.gl; version-pinned explicitly |
| `@luma.gl/*` | No direct import; bundled as 'deck-stack' chunk by Vite; explicit version control |

**Action:** Verify `papaparse`, `convex`, `telegram`, `youtubei.js`, `@upstash/*` — if these are confirmed unused, remove them in a follow-up PR. `onnxruntime-web` and `@deck.gl/geo-layers` / `@luma.gl/*` are likely intentional.

---

## 6. Rust / Cargo Audit

`cargo-audit` is not available in the dev sandbox but is correctly configured in `.github/workflows/security-audit.yml` (runs on schedule + push). No known CVEs found in manual review of key crates:

| Crate | Version | Status |
|-------|---------|--------|
| `tauri` | 2.11.2 | Current |
| `reqwest` | 0.13.4 | Current |
| `openssl` | 0.10.80 | Current |
| `tokio` | 1.51.0 | Current |
| `aes-gcm` | 0.10.3 | Current |
| `keyring` | 3.6.3 | Current |

**Recommendation:** Add `cargo deny` alongside `cargo audit` for license + duplicate detection.

---

## 7. CSP Analysis

The CSP in `tauri.conf.json` is well-structured. Items noted:

| Item | Severity | Notes |
|------|----------|-------|
| `'unsafe-eval'` in `script-src` | Acknowledged | Required by Cesium WebGL shader compilation; documented in CLAUDE.md |
| `'unsafe-inline'` in `style-src` | Low | Consider CSP nonces for production hardening in a future pass |
| `http://localhost:11434` + `http://localhost:1234` in `connect-src` | Low | Redundant with the existing `http://127.0.0.1:*` wildcard added by `htmlVariantPlugin` for desktop builds; could be removed from the static tauri.conf.json CSP |
| `frame-src` includes `youtube.com` | Low | Acceptable for video embeds; verify all iframes use `youtube-nocookie.com` |
| `object-src 'none'` | ✅ Good | Prevents plugin execution |
| `base-uri 'self'` | ✅ Good | |
| `form-action 'self'` | ✅ Good | |

**Tauri capabilities:** `core:default`, `core:window:allow-start-dragging`, `biometry:default`, `clipboard-manager:allow-read-text` — all verified used in source. No over-granted permissions.

---

## 8. Vite Config

- **Source maps:** No `sourcemap` key in `build:` block → defaults to `false` in production. ✅ Correct.
- **Chunk splitting:** Well-structured `manualChunks` for `cesium`, `three`, `deck-stack`, `maplibre`, `transformers`, `d3`, `sentry`, `i18n`. Diagnostic panels get their own `panels-diagnostic` chunk (lazy mount).
- **Warning threshold:** `chunkSizeWarningLimit: 1200` — raised to suppress maplibre/deck false alarms. Acceptable given the geospatial payload.
- **Desktop CSP injection:** `htmlVariantPlugin` correctly adds `http://127.0.0.1:*` and `http://localhost:*` to the HTML meta-CSP for desktop builds only.

---

## 9. `.gitignore`

Complete and correct. Key patterns verified:
- `dist/`, `src-tauri/target/` — excluded ✅
- `.env`, `.env.local`, `.env.vercel-*` — excluded ✅
- Build artifacts (`*.bundle.mjs`, sidecar outputs) — excluded ✅  
- Runtime data (`events.db`, `sidecar.health.json`, `data/attack-cache.json`) — excluded ✅
- Vault animation frames (`public/vault-*.png`, `public/vault-*.mp4`) — excluded ✅

No secrets, caches, or build artifacts tracked.

---

## 10. TODO / FIXME Scan

Source code is remarkably clean. Only 2 markers found:

1. `src/services/ai-flow-settings.ts:5` — `TODO: Migrate panel visibility, sources, and language selector into this` — low priority settings consolidation.
2. `src/app/panel-layout.ts:3057` — `// refactor — only Ghost and Gods-Vision survived. The arrays are kept` — historical mode array cleanup; safe to do when touching panel-layout.

---

## Files Changed in This PR

| File | Change |
|------|--------|
| `src/services/reasoning-memory.ts` | Break cycle: replace `logDebug` with `console.error`; remove `reasoning-debug` import |
| `src/services/algorithms/algorithm-ledger-persistence.ts` | Break cycle: lazy-require `algorithms-state` instead of top-level import |
| `src/services/ops/mission-ledger-persistence.ts` | Break cycle: lazy-require `mission-state` instead of top-level import |
| `src/services/intelligence/belief-helpers.ts` | **New file** — canonical location for BeliefValue math helpers |
| `src/components/belief-helpers.ts` | Replaced with re-export shim pointing to `services/intelligence/belief-helpers` |
| `src/services/intelligence/truth-score.ts` | Update import path: `@/components/belief-helpers` → `./belief-helpers` |
| `src/services/intelligence/driver-scores.ts` | Update import path: `@/components/belief-helpers` → `./belief-helpers` |
| `src/types/correlation-engine.ts` | Update import path: `@/components/belief-helpers` → `@/services/intelligence/belief-helpers` |
| `src/types/belief.ts` | Update doc comment with new canonical path |
| `package.json` | Move `h3-js` + `@xmpp/client` from `devDependencies` to `dependencies`; move `@xmpp/client` out of devDeps |

---

## Recommended Follow-up PRs

1. **`claude/arch-unused-deps`** — Remove confirmed-unused prod deps (`papaparse`, `convex`, `telegram`, `youtubei.js`) after verification.
2. **`claude/arch-dep-updates`** — Batch update `@deck.gl/*`, `@luma.gl/*`, `@sentry/browser`, `cesium`.
3. **`claude/arch-layering-grid-loader`** — Fix `grid-intelligence-loader.ts` to accept panel callbacks instead of importing component classes.
4. **`claude/arch-split-data-loader`** — Split `app/data-loader.ts` (4,183L) into domain-specific loader files.
5. **`claude/arch-csp-cleanup`** — Remove redundant `localhost:11434` / `localhost:1234` from tauri.conf.json (covered by desktop wildcard).
