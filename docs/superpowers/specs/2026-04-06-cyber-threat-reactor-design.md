# Cyber Threat Reactor — Design

**Status:** Approved by user 2026-04-06
**Goal:** When any cyber-intel panel surfaces a threat, automatically determine if it is relevant to the user's device, then notify them via native macOS notification, in-app toast, persistent Threat Inbox panel, and a pulsing map marker — with severity-aware dedupe and rate limiting.

## Architecture

Three new services + one new panel + small touches to two existing files. All new code reuses existing infrastructure: `send_notification` Tauri command (rate-limited 1/30s), `alertDB` IndexedDB store, `bgpview.ts` for ASN, the existing toast system, and the deck.gl map layer registry.

```
src/services/
  device-identity.ts NEW
  threat-reactor.ts NEW
  notification-router.ts NEW
src/components/
  ThreatInboxPanel.ts NEW
  CyberThreatPanel.ts TOUCH (call reactor on refresh)
src/services/cyber/index.ts TOUCH (emit event after fetchCyberThreats)
src/config/panels.ts TOUCH (register ThreatInboxPanel)
src/services/runtime-config.ts TOUCH (cyberReactor toggles)
```

## Modules

### 1. `device-identity.ts`

Single responsibility: produce a `DeviceFingerprint` for the user's machine.

```ts
export interface DeviceFingerprint {
  asn: number | null; // e.g. 7922
  asnOrg: string | null; // e.g. "Comcast Cable"
  country: string | null; // ISO-2
  os: 'macos' | 'windows' | 'linux' | 'unknown';
  fetchedAt: number;
}

export async function getDeviceFingerprint(): Promise<DeviceFingerprint>;
export function clearDeviceFingerprintCache(): void;
```

- Uses `bgpview.ts` (no public-IP exfil — ASN-only). If `bgpview` returns nothing, falls back to `null` ASN and the reactor falls back to country + platform matching.
- OS derived from `navigator.userAgent`.
- Country from `bgpview` response or `navigator.language` fallback.
- Cached in `localStorage['crystalball-device-fingerprint']` with **6-hour TTL**.
- Suppressed in Ghost Mode (returns cached value or empty fingerprint, never makes network call).
- No tests needed — thin wrapper, behavior covered by reactor tests.

### 2. `threat-reactor.ts`

Pure scoring + event emitter.

```ts
export type RelevanceReason =
  | 'asn_match'
  | 'country_critical'
  | 'platform_targeted'
  | 'high_severity';

export interface RelevanceScore {
  score: number; // 0-100
  reason: RelevanceReason;
  explanation: string; // human-readable
}

export interface NormalizedThreat {
  id: string;
  source: string; // 'feodo' | 'urlhaus' | 'cisa-kev' | ...
  indicator: string; // IP, domain, URL, CVE
  indicatorType: 'ip' | 'domain' | 'url' | 'cve' | 'asn';
  severity: 'low' | 'medium' | 'high' | 'critical';
  country?: string;
  asn?: number;
  malwareFamily?: string;
  tags?: string[];
  lat?: number;
  lon?: number;
  title: string;
  body: string;
  firstSeen?: number;
  lastSeen?: number;
}

export interface ReactorAlert {
  threat: NormalizedThreat;
  relevance: RelevanceScore;
  alertId: string; // hash(indicator + source)
  createdAt: number;
}

export function evaluateThreat(
  threat: NormalizedThreat,
  device: DeviceFingerprint,
): RelevanceScore | null;

export function ingest(threats: NormalizedThreat[]): Promise<ReactorAlert[]>;

export function onAlert(handler: (alert: ReactorAlert) => void): () => void;
```

**Scoring rules** (first match wins, returns `null` if nothing matches):

| Score | Reason | Condition |
|------:|--------|-----------|
| 100 | `asn_match` | `threat.asn === device.asn` (and asn != null) |
| 60 | `platform_targeted` | `device.os === 'macos'` AND threat tags/family include macOS markers (`'macos'`, `'osx'`, `'apple'`, `'ios'`) |
| 40 | `country_critical` | `threat.country === device.country` AND `severity ∈ {high, critical}` |
| 30 | `high_severity` | `severity ∈ {high, critical}` (catch-all so high-severity items always surface) |
|  — | (skip)  | low/medium severity with no other match |

`evaluateThreat` is pure and synchronous — easy to unit test.
`ingest` calls `evaluateThreat` for each threat, dedupes against an in-memory `Set<alertId>` (24h window), and emits via `onAlert` subscribers.

### 3. `notification-router.ts`

Single chokepoint that fans out one `ReactorAlert` into all output channels.

```ts
export interface RouterConfig {
  minSeverity: 'low' | 'medium' | 'high' | 'critical';
  notifyNative: boolean;
  notifyToast: boolean;
  notifyMap: boolean;
}

export function startNotificationRouter(): () => void;
export function getRouterConfig(): RouterConfig;
export function updateRouterConfig(patch: Partial<RouterConfig>): void;
```

`startNotificationRouter()` subscribes to `threatReactor.onAlert` and for each alert:

1. **Severity gate**: drop if below `config.minSeverity`.
2. **Dedupe**: skip if `alertDB` already has a row with `id === alertId` from the last 24h.
3. **Rate limit**:
 - `critical` → fire immediately (no rate limit beyond Tauri's existing 1/30s)
 - `high` → max 1 native notification per 60s
 - `medium`/`low` → max 1 native notification per 5 min
 - In-app toast and inbox writes are NOT rate-limited (only native notifications are noisy)
4. **Fan-out** in this order:
 - `alertDB.put(...)` — writes a `UnifiedAlert` with `source: 'threat-reactor'` so the inbox query picks it up
 - In-app toast (existing toast service) if `notifyToast`
 - `tryInvokeTauri('plugin:crystalball|send_notification', ...)` if `notifyNative`
 - Drop a marker on the deck.gl `cyber-reactor-markers` layer if `notifyMap` and `threat.lat/lon` set — pulsing red dot, auto-removes after 5 min
5. **Ghost Mode**: skip native notification + map marker; still write to inbox.

Rate-limit timestamps live in module-level state (per-severity `Map<string, number>`).

### 4. `ThreatInboxPanel.ts`

New top-level sidebar panel. Inherits from `Panel` base class.

- Queries `alertDB.getAll({ source: 'threat-reactor' })` on mount, refreshes every 30s
- Columns: time (relative), severity badge, title, relevance reason chip, source feed
- Row actions: **Ack** (sets `acknowledged: true`), **Pin**, **Copy IOC**, **Show on map** (centers deck.gl camera on threat lat/lon, drops a temporary marker)
- Filters: severity multi-select, "show acknowledged", relevance reason
- Empty state: "No relevant cyber threats detected."
- Registered in `src/config/panels.ts` `FULL_PANELS` with `category: 'cyber'`, `priority: 2`

### 5. Touches

- **`src/services/cyber/index.ts`** — after `fetchCyberThreats` resolves, normalize each `CyberThreat` to `NormalizedThreat` and call `threatReactor.ingest(...)`. Don't block; fire and forget.
- **`src/components/CyberThreatPanel.ts`** — same hook on its refresh path so manual refreshes feed the reactor.
- **`src/services/runtime-config.ts`** — add `cyberReactor` feature group with toggles: `enabled`, `minSeverity`, `notifyNative`, `notifyToast`, `notifyMap`. Defaults: `enabled: true, minSeverity: 'medium', notifyNative: true, notifyToast: true, notifyMap: true`.
- **`src/app/bootstrap.ts`** (or wherever services initialize) — call `startNotificationRouter()` after init.

## Data flow

```
fetchCyberThreats() ─┐
 ├─→ threatReactor.ingest(threats[])
CyberThreatPanel ────┘ │
 ├─→ evaluateThreat(threat, device)
 │ │
 │ └─→ RelevanceScore | null
 │
 └─→ emit ReactorAlert
 │
 ▼
 notificationRouter (subscribed)
 │
 ├─→ alertDB.put()  ──→ ThreatInboxPanel
 ├─→ toast()
 ├─→ send_notification (Tauri)
 └─→ deck.gl marker layer
```

## Error handling

- Device fingerprint failure → reactor still runs with `{asn:null, country:null, os}` and only matches on `platform_targeted` / `high_severity` rules.
- `alertDB.put` failure → logged via `console.warn`, fan-out continues for other channels.
- `send_notification` failure → swallowed (Tauri command already returns `Result`).
- Reactor `ingest` errors are isolated per-threat: one bad threat does not abort the batch.

## Testing strategy

Pure functions get unit tests, side-effecting modules get integration tests with fakes.

| File | Test type | Coverage |
|------|-----------|----------|
| `threat-reactor.test.ts` | unit | All 5 scoring branches + dedupe + null device |
| `notification-router.test.ts` | unit with fakes | Severity gate, rate limit per severity, Ghost Mode suppression, fan-out order |
| `device-identity.test.ts` | unit | Cache hit/miss, TTL expiry, Ghost Mode no-network |
| `ThreatInboxPanel` | smoke | Renders rows, ack mutates store |

## Out of scope

- Public-IP lookup (using ASN-only per user decision)
- Email/Slack notification channels
- ML/heuristic detection — rules are deterministic
- Auto-blocking firewall actions
