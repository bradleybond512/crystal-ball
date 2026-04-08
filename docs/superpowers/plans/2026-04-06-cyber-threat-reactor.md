# Cyber Threat Reactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Build a cyber-threat reactor that scores incoming threats against the user's device fingerprint and notifies via native notification + toast + persistent inbox panel + map marker, with severity-aware dedupe and rate limiting.

**Architecture:** Three new pure-ish services (`device-identity`, `threat-reactor`, `notification-router`) feed a new `ThreatInboxPanel`. Cyber service hooks into the reactor on each refresh. Reuses existing `send_notification` Tauri command, `alertDB`, `bgpview`, toast system, and deck.gl layer registry.

**Tech Stack:** TypeScript, Vite, Tauri 2, IndexedDB (`alertDB`), deck.gl, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-06-cyber-threat-reactor-design.md`

---

## Task 1: Device Identity Service

**Files:**

- Create: `src/services/device-identity.ts`
- Create: `src/services/__tests__/device-identity.test.ts`

**Context:** First module in the chain. Produces a `DeviceFingerprint` from `bgpview.ts` (already exists — exposes `lookupAsnForCurrentClient` or similar; check actual export name and adapt). Cached in localStorage with 6h TTL. Returns empty fingerprint in Ghost Mode (read mode from `mode-manager.ts`).

- [ ] **Step 1:** Read `src/services/bgpview.ts` to find the function that returns the current client's ASN. If none exists, the service should call `https://api.bgpview.io/ip/self` directly via `fetch`. Read `src/services/mode-manager.ts` to find how to detect Ghost Mode (`getCurrentMode()` or equivalent).
- [ ] **Step 2:** Write the failing test `src/services/__tests__/device-identity.test.ts` with cases:
  - returns cached value when within TTL
  - re-fetches after TTL expires
  - returns empty fingerprint (asn:null, country:null) in Ghost Mode without network call
  - derives `os: 'macos'` from a Mac UA string
  - swallows fetch errors and returns empty fingerprint
- [ ] **Step 3:** Run the test, confirm it fails.
- [ ] **Step 4:** Implement `device-identity.ts` with `getDeviceFingerprint()`, `clearDeviceFingerprintCache()`, the `DeviceFingerprint` interface from the spec, localStorage key `crystalball-device-fingerprint`, and a 6-hour TTL constant.
- [ ] **Step 5:** Run `npm run typecheck:all` and the test — both green.
- [ ] **Step 6:** Commit: `feat(cyber-reactor): add device identity service`

---

## Task 2: Threat Reactor Core

**Files:**

- Create: `src/services/threat-reactor.ts`
- Create: `src/services/__tests__/threat-reactor.test.ts`

**Context:** Pure scoring + tiny event emitter. The `evaluateThreat` function is the heart of the feature — it must be pure and exhaustively tested. Dedupe uses an in-memory `Map<alertId, timestamp>` pruned to 24h.

- [ ] **Step 1:** Write the failing test covering all 5 scoring branches from the spec table:
  - asn_match → 100 when threat.asn === device.asn
  - platform_targeted → 60 when device.os==='macos' and tags include 'macos'
  - country_critical → 40 when same country + critical severity
  - high_severity → 30 catch-all for high/critical
  - returns null for low-severity unrelated threat
  - returns null when device.asn is null AND threat is low severity
  - dedupe: ingest the same threat twice in succession yields one alert
  - dedupe expires after 24h (use a faked clock)
  - onAlert subscribers receive emitted alerts; returned unsubscribe function works
- [ ] **Step 2:** Run the test, confirm it fails.
- [ ] **Step 3:** Implement `threat-reactor.ts`:
  - Export interfaces `NormalizedThreat`, `RelevanceScore`, `RelevanceReason`, `ReactorAlert` exactly as spec'd
  - `evaluateThreat(threat, device)` returns first-matching score or null
  - `ingest(threats)` calls `getDeviceFingerprint()`, evaluates each, dedupes via `Map<string, number>`, emits via subscriber list
  - `alertId` = stable hash of `${source}:${indicator}` (use a small djb2 hash, no crypto needed)
  - `onAlert(handler)` returns an unsubscribe closure
- [ ] **Step 4:** Run `npm run typecheck:all` and the test — both green.
- [ ] **Step 5:** Commit: `feat(cyber-reactor): add threat reactor scoring + event emitter`

---

## Task 3: Notification Router

**Files:**

- Create: `src/services/notification-router.ts`
- Create: `src/services/__tests__/notification-router.test.ts`

**Context:** Single chokepoint for all output channels. Subscribes to `threatReactor.onAlert`. Test it with fakes for `alertDB`, `send_notification`, toast, and the map marker layer. The Tauri call should go through the existing helper used elsewhere (search for `tryInvokeTauri` or `invoke('plugin:crystalball|send_notification')` to find the pattern actually used in the codebase — adapt).

- [ ] **Step 1:** Find existing usage patterns:
  - `grep` for `send_notification` in `src/` to see how it's invoked from frontend
  - `grep` for `alertDB.put` to see the `UnifiedAlert` shape (check `src/services/unified-alerts.ts` for the type)
  - find the toast service (`grep` for `showToast` or `toast(`)
  - find the deck.gl layer registry (`grep` for `addLayer` or `cyber-` in `DeckGLMap.ts`)
- [ ] **Step 2:** Write the failing test with fakes for each output channel. Cases:
  - severity gate: minSeverity='high' drops a 'medium' alert
  - rate limit: two consecutive 'medium' alerts → only first triggers native notification, both write to alertDB
  - rate limit: critical alerts bypass rate limit
  - Ghost Mode: skips native notification AND map marker, still writes to alertDB
  - dedupe: if `alertDB` already contains an alert with the same id from <24h ago, skip everything
  - fan-out order: alertDB.put before toast before native notification before map marker
  - notifyToast=false suppresses toast but other channels still fire
- [ ] **Step 3:** Run, confirm it fails.
- [ ] **Step 4:** Implement `notification-router.ts`:
  - `RouterConfig` matching the spec
  - Module-level rate-limit timestamps: `const lastNotifiedBySeverity = new Map<Severity, number>()`
  - Rate limits: critical=0ms, high=60_000ms, medium=300_000ms, low=300_000ms
  - `startNotificationRouter()` subscribes to `threatReactor.onAlert`, returns the unsubscribe closure
  - `getRouterConfig()` / `updateRouterConfig(patch)` read/write a module-level config object hydrated from localStorage `crystalball-cyber-reactor-config`
  - For the dedupe check, query `alertDB.getAll({ since: Date.now() - 86_400_000 })` and look for matching id (don't add a new index — keep change footprint small)
  - For the map marker, add to a layer named `cyber-reactor-markers` and remove via `setTimeout` after 5 min. If the map module isn't initialized, swallow.
- [ ] **Step 5:** Run typecheck + tests — green.
- [ ] **Step 6:** Commit: `feat(cyber-reactor): add notification router with severity-gated fan-out`

---

## Task 4: Threat Inbox Panel

**Files:**

- Create: `src/components/ThreatInboxPanel.ts`
- Modify: `src/config/panels.ts`

**Context:** New top-level sidebar panel under the cyber category. Inherits from `Panel` base class (`src/components/Panel.ts`, `getContentElement()` is public per CLAUDE.md). Queries `alertDB` for `source: 'threat-reactor'` rows.

- [ ] **Step 1:** Read `src/components/Panel.ts` and one existing cyber panel (e.g. `CyberThreatPanel.ts`) to understand the panel pattern, its lifecycle hooks, and how panels render rows. Read `src/config/panels.ts` to see how `FULL_PANELS` entries are structured.
- [ ] **Step 2:** Implement `ThreatInboxPanel.ts`:
  - Class `ThreatInboxPanel extends Panel`
  - On mount: query `alertDB.getAll({ source: 'threat-reactor' })`, render rows sorted newest-first
  - 30s refresh interval (cleared on destroy)
  - Each row shows: relative time, severity badge, title, relevance reason chip, source feed
  - Row actions: Ack (calls `alertDB.put` with `acknowledged: true`), Pin (toggles a `pinned` flag stored in `tags`), Copy IOC (clipboard), Show on map (dispatches a custom event `wm:focus-map` with `{lat, lon}` — find the existing event name by grepping)
  - Filter controls at top: severity multi-select, "show acknowledged" checkbox, relevance reason filter
  - Empty state: "No relevant cyber threats detected."
- [ ] **Step 3:** Register in `src/config/panels.ts` `FULL_PANELS` with `id: 'threat-inbox'`, `category: 'cyber'`, `priority: 2`, `enabled: true`. Add to `PANEL_CATEGORY_MAP` if needed.
- [ ] **Step 4:** Run `npm run typecheck:all` — green.
- [ ] **Step 5:** Commit: `feat(cyber-reactor): add Threat Inbox panel`

---

## Task 5: Wire Reactor Into Cyber Service + Bootstrap

**Files:**

- Modify: `src/services/cyber/index.ts`
- Modify: `src/components/CyberThreatPanel.ts`
- Modify: `src/services/runtime-config.ts`
- Modify: bootstrap entry (find via `grep` for where services initialize — likely `src/app/bootstrap.ts` or `src/main.ts`)

**Context:** Final wiring step. Cyber service emits to reactor on each fetch; bootstrap starts the router; runtime-config exposes user toggles.

- [ ] **Step 1:** Add adapter function `cyberThreatToNormalized(t: CyberThreat): NormalizedThreat` inside `src/services/cyber/index.ts`. Map fields: `id, source, indicator, indicatorType, severity, country, lat, lon, malwareFamily, tags`. Build `title` as `${type.replace(/_/g, ' ')}: ${indicator}` and `body` as `${malwareFamily ?? ''} from ${source}`.
- [ ] **Step 2:** In `fetchCyberThreats`, after the breaker resolves, fire-and-forget: `void import('@/services/threat-reactor').then(m => m.ingest(resp.threats.map(toCyberThreat).map(cyberThreatToNormalized)));` — dynamic import to avoid circular deps.
- [ ] **Step 3:** Same hook in `CyberThreatPanel.ts` refresh path so manual refreshes also feed the reactor.
- [ ] **Step 4:** In `runtime-config.ts`:
  - Add `'cyberReactor'` (and 4 child toggles `cyberReactorNotifyNative`, `cyberReactorNotifyToast`, `cyberReactorNotifyMap`, plus minSeverity stored separately) to `RuntimeFeatureId` union
  - Add feature definitions with `defaultEnabled: true`
  - No new `RuntimeSecretKey` — reactor needs no API key
- [ ] **Step 5:** In the bootstrap file, after existing service init, add:

  ```ts
  import { startNotificationRouter } from '@/services/notification-router';
  startNotificationRouter();
  ```

  Store the returned unsubscribe in case future code needs to tear it down.
- [ ] **Step 6:** Run `npm run typecheck:all` — green. Then run all reactor-related tests — green.
- [ ] **Step 7:** Commit: `feat(cyber-reactor): wire reactor into cyber service + bootstrap`

---

## Task 6: Build, Install, Smoke Test

**Files:** none (verification only)

- [ ] **Step 1:** Run `npm run desktop:build:full` from `~/developer/crystalball`. Confirm clean build.
- [ ] **Step 2:** Run `pkill -x crystalball 2>/dev/null; sleep 0.5; node scripts/install-built-app.mjs --relaunch` to install + relaunch.
- [ ] **Step 3:** Open the new "Threat Inbox" panel in the sidebar. Confirm it renders without errors and shows the empty state until threats arrive.
- [ ] **Step 4:** Open Settings → API Keys / Features and confirm the cyber reactor toggles are visible.
- [ ] **Step 5:** Report any runtime errors back to the controller for fixing before final review.
