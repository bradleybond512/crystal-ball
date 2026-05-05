# EEW Alerts + Seismic Globe Overlays — Design

Date: 2026-05-05
Status: Approved (chat 2026-05-05)
Builds on: PR 255 (seismic types + normalizer), PR 256 (fusion), PR 257 (saved-place shaking estimator)

## Goal

Close the GlobalQuake feature gap with two product surfaces:

1. **Animated P/S-wave rings on the God's Eye 4D globe** — visual situational awareness for active quakes.
2. **Tiered real-time EEW alerts** — 5-rung alert ladder driven by fused seismic events, with macOS iMessage escalation for TIER_5.

Both are layered on top of the existing fusion pipeline (PRs 255-257). No fetch, no globals, no DOM in the engine layers — same invariants as Layers 1-3.

## PR sequence

Six sequential PRs, one layer each, branched stack-style. `gh pr merge --auto --squash` after each opens. Order is fixed by dependency:

| PR | Layer | Branch suffix |
|---|---|---|
| 1 | L4 globe-overlay-emitter (pure engine) | `feat/globe-overlay-emitter` |
| 2 | L5 `/api/seismic-globe-overlays` sidecar route | `feat/globe-overlays-sidecar` |
| 3 | L6 GlobeSeismicWaves Cesium renderer | `feat/globe-seismic-waves` |
| 4 | L7 eew-alert-engine (pure engine) | `feat/eew-alert-engine` |
| 5 | L8 EEW wiring (sidecar + iMessage + persistence + runtime-config) | `feat/eew-alert-wiring` |
| 6 | L9 EEWStatusBar UI | `feat/eew-status-bar` |

## L4 — Globe overlay emitter

**File:** `src/services/seismic/globe-overlay-emitter.ts`

Pure deterministic. Inputs: `FusedSeismicEvent[]`, `nowMs`. Output: `GlobeSeismicOverlay[]` with computed P/S radii.

```ts
export interface GlobeSeismicOverlay {
  eventId: string;
  lat: number;
  lon: number;
  magnitude: number | null;
  pWaveRadiusKm: number;          // 6 km/s × elapsed
  sWaveRadiusKm: number;          // 3.5 km/s × elapsed
  pWaveOpacity: number;           // 1.0 → 0 over travel time
  sWaveOpacity: number;
  ageSec: number;
  expired: boolean;               // true past 4h
}

export interface GlobeOverlayInput {
  events: readonly FusedSeismicEvent[];
  nowMs: number;
  /** Default 4.5. Below this, the event is filtered out. */
  minMagnitude?: number;
  /** Default 50. Hard cap, prioritized by magnitude desc. */
  maxOverlays?: number;
}

export function buildGlobeOverlays(input: GlobeOverlayInput): GlobeSeismicOverlay[];
```

Wave constants reused from `shaking-estimator.ts` (`P_WAVE_KM_PER_SEC = 6`, `S_WAVE_KM_PER_SEC = 3.5`) via re-export through `__INTERNAL`. **Antipodal cap** at ~20,015 km (`Math.PI × EARTH_RADIUS_KM`); past that, opacity = 0 and we mark the wave done.

Opacity decay is linear from 1.0 at radius=0 to 0 at antipode. `expired = ageSec > 4 × 3600` ⇒ excluded from output.

**Tests** (`__tests__/globe-overlay-emitter.test.mts`):
- M<4.5 filtered out
- P-wave radius at t=10s = 60 km, at t=100s = 600 km
- S-wave at t=10s = 35 km
- Opacity at antipodal radius = 0
- Expired (> 4h) filtered out
- 50-event cap honors magnitude priority
- Empty input → empty output
- Future event (`occurredAt > nowMs`) → radii = 0, opacity = 1

## L5 — Sidecar route

**File:** `src-tauri/sidecar/local-api-server.mjs`

New route: `GET /api/seismic-globe-overlays`. Read-only — serves the latest overlay snapshot pushed by the renderer (same pattern as `/api/analyst-state`).

```
GET /api/seismic-globe-overlays
→ 200 { overlays: GlobeSeismicOverlay[], asOf: number }
```

Renderer pushes via `POST /api/seismic-globe-overlays` (auth: existing sidecar bearer). The renderer-side push lives in `src/services/seismic/sidecar-pusher-globe.ts` (mirror of the analyst pusher). Push cadence: 5s tick from `data-loader.ts`.

**Tests:**
- GET returns 200 with `{ overlays: [], asOf }` when nothing pushed
- POST → GET round-trips an overlay payload
- POST without bearer → 401
- POST with malformed body → 400, no state change

## L6 — Cesium renderer

**File:** `src/components/GlobeSeismicWaves.ts` (mirrors `GlobeReactorBeacons.ts`)

- Polls `/api/seismic-globe-overlays` every 5s.
- For each overlay, draws three Cesium primitives:
  - **Epicenter dot** — pulsing CircleEntity, color by magnitude (M4-5 green, M5-6 yellow, M6-7 orange, M7+ red).
  - **P-wave ring** — `Cesium.EllipseGraphics` with `outline: true, fill: false`, `outlineColor` blue at current opacity.
  - **S-wave ring** — same but red, slightly thicker outline.
- **Click handler** on epicenter: opens detail card with magnitude, depth, place, fused confidence, PAGER alert if any, per-saved-place shaking estimates from L3.
- **Layer toggle button** in `GlobeHUD.ts` controls. Persists toggle state in `localStorage` key `cb:globe-seismic-waves-enabled` (default true).
- **Performance:** entities removed and re-added only when overlay set changes (diff by eventId). Hard cap is enforced server-side by L4, so renderer doesn't need to re-cap.

**Tests:**
- Layer toggle off → `GlobeDataManager` skips fetch
- Magnitude → color mapping (4 boundary cases)
- Diff: removed eventId clears its 3 entities; new eventId adds 3
- (Cesium render itself is not unit-tested; smoke test verifies `addOverlay` / `removeOverlay` are called.)

## L7 — EEW alert engine

**File:** `src/services/seismic/eew-alert-engine.ts`

Pure deterministic. Inputs: `FusedSeismicEvent[]`, `SavedPlaceShakingEstimate[]` (from L3), prior `EewAlertLedger`, `nowMs`. Outputs: `{ alerts: EewAlert[], updatedLedger: EewAlertLedger }`.

```ts
export type EewTier = 'TIER_1_INFO' | 'TIER_2_WATCH' | 'TIER_3_WARNING' | 'TIER_4_SEVERE' | 'TIER_5_EXTREME';

export interface EewAlert {
  eventId: string;
  tier: EewTier;
  reason: string;             // Human-readable trigger ("M6.8 within 180km of saved place 'Home'")
  triggeredAt: number;
  upgradedFrom?: EewTier;     // set when this alert is an upgrade of a prior alert for same eventId
  imessageStatus?: 'pending' | 'sent' | 'failed' | 'disabled';
  imessageError?: string;
}

export interface EewAlertLedger {
  /** eventId → highest tier ever seen + last-fired timestamps per tier */
  events: Record<string, {
    highestTier: EewTier;
    tierFiredAt: Partial<Record<EewTier, number>>;
  }>;
}
```

### Tier rules

| Tier | Trigger |
|---|---|
| TIER_1_INFO | M ≥ 4.0 anywhere, OR M ≥ 2.5 within 200km of any saved place |
| TIER_2_WATCH | M ≥ 5.5 anywhere, OR M ≥ 4.0 within 300km of saved place, OR tsunami watch |
| TIER_3_WARNING | M ≥ 6.5 anywhere, OR M ≥ 5.0 within 200km of saved place, OR tsunami advisory |
| TIER_4_SEVERE | M ≥ 7.0 anywhere, OR M ≥ 6.0 within 300km of saved place, OR tsunami warning |
| TIER_5_EXTREME | M ≥ 8.0 anywhere, OR M ≥ 7.0 within 500km of saved place, OR major tsunami warning |

The engine returns the **highest** tier whose trigger matches. Tsunami flag source: `event.primary.tsunamiFlag` for the watch/advisory/warning ladder is **not** sufficient on its own — `tsunamiFlag` is binary in canonical types, so we conservatively map it to `tsunami_watch` only. A future PR can wire NOAA tsunami feeds for advisory/warning. Spec'd as: tsunami escalation today only fires the watch tier; no advisory/warning until separate tsunami-feed PR. **This is a known gap, called out in the alert reason.**

### Dedup + upgrade

- Same eventId + same tier within 1 hour → suppressed (no new alert emitted).
- Same eventId + higher tier than `highestTier` → emitted with `upgradedFrom = oldHighest`.
- Same eventId + lower tier than `highestTier` → suppressed (we never downgrade).
- Ledger entry expires after 24h (eventId removed) so a re-issued alert for the same fused event pair after a long quiet period can still fire.

### Tests (`__tests__/eew-alert-engine.test.mts`)

- Each tier threshold: anywhere clause, saved-place clause
- Tier upgrade: M5.0 fires TIER_2, then magnitude revised to M7.5 fires TIER_4 with `upgradedFrom = TIER_2`
- Dedup: same tier within 1h → no alert
- Dedup expiry: same tier > 1h later → fires again
- Downgrade suppressed
- Saved-place proximity classifier (uses haversine; no fetch)
- 24h ledger expiry
- Empty input → empty alerts, ledger unchanged

## L8 — EEW wiring

**Files:**
- `src-tauri/sidecar/local-api-server.mjs` — `GET /api/eew-status` route
- `src/services/seismic/eew-pusher.ts` — renderer-side 30s tick that runs the engine and pushes status to sidecar
- `src/services/seismic/eew-ledger-persist.ts` — disk persistence (mirror `mission-ledger`/`algorithm-ledger`)
- `src/services/runtime-config.ts` — six new keys
- `src/services/seismic/eew-imessage.ts` — TIER_5 escalation calling `imessage-bridge.sendImessage`

### Runtime-config keys

```
EEW_TIER1_ENABLED          (boolean, default true)
EEW_TIER2_ENABLED          (boolean, default true)
EEW_TIER3_ENABLED          (boolean, default true)
EEW_TIER4_ENABLED          (boolean, default true)
EEW_TIER5_ENABLED          (boolean, default true)
EEW_IMESSAGE_TIER5_ENABLED (boolean, default true)
```

The five tier toggles are filters — when off, an alert at that tier is dropped before sidecar push (the engine still computes it; the wiring layer drops it). The iMessage toggle gates only the `sendImessage` call; the alert itself still fires.

### Persistence

`~/Library/Application Support/com.bradleybond.crystalball/eew-ledger.json` — JSON serialization of the `EewAlertLedger` plus the last 200 fired alerts (rolling). Atomic write via temp file + rename. Reload on engine boot. Schema version = 1.

### iMessage TIER_5

When a TIER_5 alert fires AND `EEW_IMESSAGE_TIER5_ENABLED` is true:

1. Read recipient from existing `crystalball-imessage-settings`.
2. If recipient is empty → set `imessageStatus = 'disabled'`, log a warn, do not throw.
3. Build body: `"⚠️ TIER 5 EEW: {alert.reason} — {timestamp}"` (under 160 chars).
4. Call `sendImessage(recipient, body)`.
5. On `{ ok: true }`: `imessageStatus = 'sent'`. On `{ ok: false }`: `imessageStatus = 'failed'`, `imessageError = reason`. **Do not retry.**

The `imessageStatus` is persisted to the ledger so EEWStatusBar (L9) can surface a "iMessage failed" badge.

### Tests

- Sidecar GET when nothing pushed → empty status
- POST/GET round-trip
- iMessage disabled toggle → `imessageStatus = 'disabled'` (and the existing bridge is **not** called)
- Empty recipient → `imessageStatus = 'disabled'`, no throw
- iMessage failure → `imessageStatus = 'failed'`, `imessageError` populated, no retry, ledger updated
- Persistence: write ledger → read ledger round-trips events + tier history
- Atomic write: simulated mid-write crash leaves prior ledger intact

## L9 — EEWStatusBar

**File:** `src/components/EEWStatusBar.ts`

Persistent header — sits above the scrollable panel column. The L9 PR will inspect `panels.ts` and choose between (a) extending the panel registration with a new `fixedHeader: true` flag, or (b) mounting directly via `panel-layout.ts` outside the panel column. Whichever fits the existing pattern with less new surface area.

Visual states:

| State | Color | Content |
|---|---|---|
| ALL CLEAR | gray | "ALL CLEAR" + last event time-ago in subtitle |
| TIER_1 INFO | blue | tier label + last event |
| TIER_2 WATCH | yellow | tier label + last event + S-wave countdown if applicable |
| TIER_3 WARNING | orange | tier label + last event + countdown + "Drop, Cover, Hold On" if STRONG+ likely |
| TIER_4 SEVERE | red | same + repeating soft sound |
| TIER_5 EXTREME | crimson | same + emergency-mode banner + iMessage badge |

iMessage badges (TIER_5 only):
- `imessageStatus = 'sent'` → "iMessage sent ✓"
- `imessageStatus = 'failed'` → "iMessage failed: {error}" (red)
- `imessageStatus = 'disabled'` → "iMessage off" (gray)

S-wave countdown is read from PR 257's `SavedPlaceShakingEstimate.usefulWarningWindowSec` for the place currently nearest the active event, decrementing every second client-side.

Polling: `/api/eew-status` every 5s.

**Tests** (smoke):
- ALL CLEAR rendered when status payload has no active alerts
- TIER_5 + failed iMessage shows red failure badge
- Click on bar → expands to show last 5 alerts list

## Out of scope for this 6-PR stack

- NOAA tsunami feed (advisory/warning ladder beyond `tsunamiFlag`) — separate PR.
- ShakeAlert direct integration (USGS feed already in normalizer).
- Replacing the existing `EarthquakesPanel` / `EmscSeismicPanel` — both stay as event-list views.
- Sound asset selection — TIER_3/4/5 use a placeholder built-in until a sound design pass.
- Tauri capability changes — none required (uses existing `send_imessage` from imessage-bridge).

## Plan invariants honored

- Every score / classification has a deterministic explanation (`reason` string in alerts; tier rules in code constants).
- Every output is fixture-testable; no live fetch in unit tests.
- iMessage failure is logged + surfaced, never retried (avoids spam if Messages.app wedged).
- Stale data: ledger expiry ensures no eventId persists past 24h.
- Disagreement / uncertainty: tsunami advisory/warning gap is **explicit**, not silently averaged into the watch tier.
