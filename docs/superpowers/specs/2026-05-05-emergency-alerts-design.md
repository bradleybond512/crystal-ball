# Emergency Alerts + Notification System — Design Spec

**Date:** 2026-05-05
**Status:** Approved (4-PR stack)

## Overview

Wire emergency alerts from FEMA IPAWS / NWS CAP into the renderer, route them to native macOS notifications, expand the iMessage relay to multiple alert types, and add opt-in voice alerts via macOS `say`. Each PR ships independently and stacks on the previous one with auto-rebase merge.

## Constraints (from product owner)

- **Tier definitions** are inline constants, temporary until a real EEW engine lands. Magnitude bands: `M<5 → none`, `M5–5.9 → TIER_2`, `M6–6.9 → TIER_3`, `M7–7.9 → TIER_4`, `M≥8 → TIER_5`.
- **Native notifications** keep the existing Rust `send_notification` invoke command. No `@tauri-apps/plugin-notification` install.
- **Hurricane Cat-3 / wildfire-containment triggers** ship as guarded hooks with TODO comments — the NHC / NIFC data feeds are landing in parallel sessions.
- **CAP feed** uses NWS CAP JSON (`https://api.weather.gov/alerts/active`) only. Skip the ATOM feed.
- **iMessage expansion** uses the existing `BreakingAlert.threatLevel` vocabulary plus a new `threatType` discriminator. The `IMESSAGE_ALERTS` setting whitelists which `threatType` values trigger iMessage.
- **Voice alerts** use a new Rust `speak_aloud` command that shells out to `say` — same pattern as `send_notification`. No shell-plugin churn.

## PR 1 — `/api/alerts/active` (NWS CAP + FEMA disasters)

### Sidecar route

- New `GET /api/alerts/active`, cache TTL **60 seconds** (matches the polling cadence in the user spec).
- Two upstreams in parallel via `Promise.allSettled`:
  - `https://api.weather.gov/alerts/active?status=actual&message_type=alert` (CAP-as-GeoJSON; the existing `/api/nws-alerts` route already proves this works).
  - `https://www.fema.gov/api/open/v2/disasterDeclarationsSummaries?$top=10&$orderby=declarationDate desc` (OData JSON).
- Pure transformer module `src-tauri/sidecar/ipaws-aggregate.mjs`:
  - `parseNwsCapFeatures(features) → IpawsAlert[]` — pulls `id`, `event`, `headline`, `severity`, `urgency`, `certainty`, `areaDesc`, `effective`, `expires`, `centroid`.
  - `parseFemaDisasters(rows) → IpawsAlert[]` — maps `disasterNumber`, `incidentType`, `declarationTitle`, `state`, `declarationDate` into the shared shape with `source = 'FEMA'`.
  - `dedupeAlerts(items) → IpawsAlert[]` — keeps the first occurrence per `id`.
  - `expireAlerts(items, now) → IpawsAlert[]` — drops items past their `effectiveEnd`/`expires` timestamp.
- Sidecar returns `{ alerts: IpawsAlert[], fetchedAt: string, sources: { nws: 'ok'|'degraded', fema: 'ok'|'degraded' } }`.

### Renderer

- `src/services/alerts/ipaws-monitor.ts`:
  - TS types matching the response.
  - Thin `fetchActiveAlerts()` → typed payload, with caller-side caching.
  - Simple poll-loop helper `startIpawsPolling(callback, intervalMs = 60_000)` that emits new alerts (those not seen in the previous tick) and returns a stop handle.
- No data-loader wiring in PR 1 — wiring lives in PR 2 next to the trigger code.

### Tests (`src-tauri/sidecar/ipaws-aggregate.test.mjs`)

- NWS feature parse (full + minimal feature shapes).
- FEMA row parse.
- Dedup-by-id (exact + duplicate sources).
- Expiry drops past-`expires` items at a fixed clock.
- Status flags reflect upstream availability.

## PR 2 — Push notifier + tier constants + ledger

### Tier constants (`src/services/notifications/eew-tiers.ts`)

```ts
// TODO: replace with the real EEW engine's tier output once that lands.
export const EEW_TIERS = {
  TIER_2: { min: 5, max: 6 },     // M5.0–5.9
  TIER_3: { min: 6, max: 7 },     // M6.0–6.9
  TIER_4: { min: 7, max: 8 },     // M7.0–7.9
  TIER_5: { min: 8, max: Infinity },
} as const;
export type EewTier = keyof typeof EEW_TIERS;
export function tierForMagnitude(m: number): EewTier | null { ... }
```

### Push notifier (`src/services/notifications/push-notifier.ts`)

- Wraps the existing `send_notification` Rust command (does NOT pull in `@tauri-apps/plugin-notification`).
- Public surface:
  - `pushNotification({ title, body, sound, actionType })` — calls `tryInvokeTauri('send_notification', ...)`.
  - `requestPermissionIfNeeded()` — no-op on Tauri (the OS handles permission on first send); on web, calls `Notification.requestPermission()` and remembers the result.
  - `firePushForEvent(event)` — type-driven dispatch covering EEW tier, geomagnetic storm, CAP Extreme/Immediate, plus the two TODO hooks.
- Trigger conditions live in one switch with explicit guards:
  - `event.kind === 'seismic' && tier in {TIER_3, TIER_4, TIER_5}` → push
  - `event.kind === 'geomagnetic' && event.kpIndex >= 8` (G4+) → push
  - `event.kind === 'cap' && event.severity === 'Extreme' && event.urgency === 'Immediate'` → push
  - `event.kind === 'hurricane' && event.nhcStorm?.category >= 3` → push (TODO comment: "NHC feed wires up in parallel session")
  - `event.kind === 'wildfire' && event.nifc?.containment < 10` → push (TODO comment: "NIFC feed wires up in parallel session")

### Notification ledger (`src/services/notifications/notification-ledger.ts`)

- Append-only ledger of every push fired. Pure types + serialize/loadJson, modelled on `src/services/ops/mission-ledger.ts`.
- Persisted via Tauri to `~/Library/Application Support/Crystal Ball/notification-ledger.json` (same persistence helper as the existing mission/algorithm ledgers — see PR 2 for the wiring pattern).
- Read-only API for the diagnostic surface so future panels can show "what fired and when".

### Tests

- `src/services/notifications/__tests__/push-notifier.test.mts` — type-routing for each event kind, threshold gating, hurricane/wildfire TODO hooks return `{ skipped: 'todo' }` deterministically.
- `src/services/notifications/__tests__/eew-tiers.test.mts` — boundary cases at M5.0, M5.999, M6.0, M8.0.
- `src/services/notifications/__tests__/notification-ledger.test.mts` — append, query-by-time, JSON round-trip.

## PR 3 — iMessage expansion (`threatType` discriminator)

### Settings change (`src/services/imessage-bridge.ts`)

- Existing `ImessageSettings` gains a `threatTypes: ImessageThreatType[]` array — the legacy `threshold` field stays for backward compat.
- `ImessageThreatType` union: `'seismic_tier3' | 'seismic_tier4' | 'seismic_tier5' | 'geomagnetic_g4' | 'wildfire_extreme' | 'hurricane_cat3'`.
- Default is `['seismic_tier5']` — preserves today's behavior.

### New routing module (`src/services/notifications/imessage-bridge-extended.ts`)

- `routeAlertToImessage(event, settings) → { send: boolean, body?: string, reason?: string }` — pure, testable.
- Per-type message templates:
  - `seismic_tier3` → `"Crystal Ball — M{mag} earthquake near {place}, {distance} from saved location"`
  - `seismic_tier4` / `tier5` → similar with stronger language
  - `geomagnetic_g4` → `"Crystal Ball — Geomagnetic storm G{level}: aurora visible to mid-latitudes; possible HF radio + GPS impact"`
  - `wildfire_extreme` → `"Crystal Ball — Wildfire {name} ({state}): containment {pct}%"` (TODO data)
  - `hurricane_cat3` → `"Crystal Ball — Hurricane {name} Cat {n}: {projectedLandfall}"` (TODO data)
- Wiring lives next to `firePushForEvent`: when a push fires, also call `routeAlertToImessage` with the user's settings; if `send`, dispatch via the existing `sendImessage(recipient, body)`.

### Tests (`src/services/notifications/__tests__/imessage-bridge-extended.test.mts`)

- Default settings: only `seismic_tier5` triggers.
- Multi-type whitelist: routes the expected types and skips others.
- Empty whitelist: nothing fires.
- Disabled-globally: nothing fires.
- Body-template format for each type.

## PR 4 — Voice alerter

### Rust command (`src-tauri/src/main.rs`)

- New `speak_aloud(text: String, voice: Option<String>, rate: Option<u32>)` mirroring `send_notification`:
  - Trusted-window guard
  - Rate limit (`VOICE_LAST_SENT` lock, 5-second cooldown — voice is more disruptive than push)
  - Length-cap text (256 bytes), voice (32 bytes), default voice = `Samantha`, default rate = 180
  - Sanitize control characters
  - Shell out to `say` via `std::process::Command::new("say").args(["-v", &voice, "-r", &rate, &text])`
- macOS only — no-op on other platforms.
- Registered in the `tauri::generate_handler!` list.

### Renderer (`src/services/notifications/voice-alerter.ts`)

- `speakAlert(message)` — calls `tryInvokeTauri('speak_aloud', { text, voice, rate })`.
- `fireVoiceForEvent(event, settings)` — gated:
  - `event.kind === 'seismic'` and tier in `{TIER_4, TIER_5}` (M≥7) → speak
  - `event.kind === 'cap' && severity === 'Extreme' && urgency === 'Immediate'` → speak
- Voice-message format: `"Crystal Ball alert — {event type} — {brief description}"` (≤200 chars).

### Settings (`src/services/notifications/voice-settings.ts`)

- localStorage key `crystalball-voice-settings`: `{ enabled: boolean, voice: string, rate: number }`. Default `{ enabled: false, voice: 'Samantha', rate: 180 }`.

### Tests (`src/services/notifications/__tests__/voice-alerter.test.mts`)

- Threshold gating (TIER_3 → no, TIER_4 → yes, CAP-Extreme-Immediate → yes, CAP-Severe-Expected → no).
- Message format includes event type + brief description.
- Disabled-by-default (no opt-in → no speak).

## Branch flow

- PR 1: `claude/emergency-alerts` → `claude/emergency-alerts-pr1-ipaws` from `origin/main`.
- PR 2: `claude/emergency-alerts-pr2-push` from PR 1's branch.
- PR 3: `claude/emergency-alerts-pr3-imessage` from PR 2's branch.
- PR 4: `claude/emergency-alerts-pr4-voice` from PR 3's branch.
- Each push: `gh pr create --base main --fill` then `gh pr merge --auto --rebase` (squash/merge-commit are disabled on this repo per the disease-intel work).

## Out of scope

- Real EEW engine (just placeholder tier constants).
- NHC + NIFC ingest (TODO hooks only).
- Notification preference UI (settings consumed via runtime config / localStorage; UI lands separately).
- Cross-platform (Windows/Linux): `osascript` and `say` are macOS-only; non-macOS paths are no-ops.
