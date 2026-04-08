# PizzINT — Pentagon Pizza Index Design Spec

**Date:** 2026-03-30
**Status:** Approved

## Summary

The `PizzIntIndicator` component, data-loader wiring, App.ts setup, and all types are already implemented in the codebase. The only broken piece is `src/services/pizzint.ts`, which calls a gRPC backend that doesn't exist in this fork. Fix: add two sidecar proxy routes and rewrite the service to call them directly, computing DEFCON from raw location data.

---

## 1. What Already Exists (no changes needed)

| File | Status |
|---|---|
| `src/components/PizzIntIndicator.ts` | Complete — DEFCON badge + expandable panel with locations + tensions |
| `src/app/data-loader.ts` — `loadPizzInt()` | Complete — calls `fetchPizzIntStatus()` + `fetchGdeltTensions()`, 10-min refresh |
| `src/App.ts` — `setupPizzIntIndicator()` | Complete — attaches indicator to header on init |
| `src/types/index.ts` — `PizzIntStatus`, `PizzIntLocation`, `GdeltTensionPair` | Complete |

---

## 2. Sidecar Routes

**File:** `src-tauri/sidecar/local-api-server.mjs`

Add two routes using the existing `CHROME_UA` constant (already defined at line ~252):

### `GET /api/pizzint/dashboard`

Proxies `https://www.pizzint.watch/api/dashboard-data` with `User-Agent: CHROME_UA` and `Accept: application/json`. Returns raw JSON response as-is. On non-2xx, returns `{ success: false, data: [] }` with the upstream status code forwarded.

### `GET /api/pizzint/gdelt`

Proxies `https://www.pizzint.watch/api/gdelt/batch?pairs=usa_russia,russia_ukraine,usa_china,china_taiwan,usa_iran,usa_venezuela` with `User-Agent: CHROME_UA` and `Accept: application/json`. Returns raw JSON as-is. On error, returns `[]`.

Both routes use `getApiBaseUrl()` is not applicable (these are sidecar-internal routes). Standard error handling: catch fetch errors, log to console, return safe fallback.

---

## 3. Rewritten `src/services/pizzint.ts`

Drop the gRPC `IntelligenceServiceClient` import entirely. Replace with direct sidecar calls.

### API response shapes

```ts
// From /api/pizzint/dashboard
interface DashboardResponse {
  success: boolean;
  data: Array<{
 place_id: string;
 name: string;
 address: string;
 current_popularity: number; // 0–100
 percentage_of_usual: number | null;
 is_spike: boolean;
 spike_magnitude: number | null;
 data_source: string;
 recorded_at: string;
 data_freshness: string; // 'fresh' | 'stale'
 is_closed_now?: boolean;
 lat?: number;
 lng?: number;
  }>;
}

// From /api/pizzint/gdelt
type GdeltResponse = Array<{
  id: string;
  countries: [string, string];
  label: string;
  score: number;
  trend: 'rising' | 'stable' | 'falling';
  change_percent: number;
  region: string;
}>;
```

### DEFCON computation

Computed from open locations (`!is_closed_now`):

```
aggregateActivity = average(current_popularity) across open locations
activeSpikes = count(is_spike === true)

DEFCON 1: activeSpikes >= 7  OR aggregateActivity >= 85
DEFCON 2: activeSpikes >= 4  OR aggregateActivity >= 70
DEFCON 3: activeSpikes >= 2  OR aggregateActivity >= 50
DEFCON 4: activeSpikes >= 1  OR aggregateActivity >= 30
DEFCON 5: otherwise (normal)
```

### DEFCON labels (hardcoded English — avoids missing i18n keys)

| Level | Label |
|---|---|
| 1 | MAXIMUM ALERT |
| 2 | ELEVATED ALERT |
| 3 | HEIGHTENED |
| 4 | GUARDED |
| 5 | NORMAL |

### Circuit breakers

Kept as-is — `pizzintBreaker` and `gdeltBreaker` wrap the sidecar calls with the same parameters (3 max failures, 5-min cooldown, 30-min cache TTL for status, 10-min for GDELT).

### Sidecar URL

Use `getApiBaseUrl()` from `@/services/runtime` (same as all other services). Full URL: `` `${getApiBaseUrl()}/api/pizzint/dashboard` ``.

---

## 4. Files Changed

| Action | File |
|---|---|
| Modify | `src-tauri/sidecar/local-api-server.mjs` — add 2 routes |
| Modify | `src/services/pizzint.ts` — drop gRPC, call sidecar directly |

---

## Out of Scope

- Changing the `PizzIntIndicator` component UI
- Custom GDELT pair configuration
- Persisting DEFCON history
