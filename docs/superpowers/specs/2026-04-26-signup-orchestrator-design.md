# Signup Orchestrator — Design Spec

**Date:** 2026-04-26
**Status:** Approved

## Problem

Crystal Ball supports 49 API keys across 8 categories (LLMs, markets, cyber threat intel, conflict, news, aviation/maritime, geo, weather). The user currently has 1 of 49 configured. The existing `RuntimeConfigPanel` API Keys tab presents all 49 keys as a flat list of input fields with no signup links, no validation, no progress tracking, and no guided flow. Onboarding 48 keys means tabbing through a wall of inputs, manually finding signup pages, and never knowing whether a pasted value actually works until a downstream feature breaks.

## Goal

Replace the existing API Keys tab with a hybrid surface that supports both quick one-off edits and a guided onboarding wizard:

- **Dashboard view** — categorized cards with status badges (✓ valid / ⚠ unvalidated / ✗ invalid / ○ unset / ⏸ skipped), inline paste + test, signup links, progress bar.
- **Setup Wizard modal** — grouped flow through 8 priority tiers with checkpoints, "Open Signup ↗" launching the user's default browser, a clipboard watcher that auto-fills when the user copies a key matching the active step's shape, and per-key validation showing which features each key unlocks.

## Non-goals

- No Mail.app rule integration (separate follow-up — only ~8 of 48 providers email keys).
- No browser userscript / Tampermonkey integration.
- No key rotation reminders or expiry warnings.
- No sharing, export, encrypted backup, or multi-profile support.
- No automation of signup itself (captchas, ToS, email verification remain human-in-the-loop).
- No web-build clipboard watching (browser clipboard requires user gesture per read; would prompt-spam).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  UnifiedSettings → "API Keys" tab                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  KeyDashboard (replaces RuntimeConfigPanel body)           │ │
│  │  ├─ Header: "12 of 49 configured"  [Run Wizard] [Filter ▾] │ │
│  │  └─ Categorized cards (8 tiers, collapsible)               │ │
│  │     ├─ Status badge (✓ / ⚠ / ✗ / ○ / ⏸)                    │ │
│  │     ├─ Inline paste field + Test/Save/Clear                │ │
│  │     └─ "Open Signup ↗" link                                │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │ "Run Wizard" click
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  SetupWizard (modal overlay, 720px wide, Esc dismisses)         │
│  ├─ Tier header: "Tier 2 / 8 — Markets & Macro"                 │
│  ├─ Step header: "Step 1 of 4 — Finnhub API Key"                │
│  ├─ Description (from KEY_DESCRIPTIONS)                         │
│  ├─ [Open Signup ↗] (tauri::shell::open)                        │
│  ├─ Paste field (clipboard auto-fill on shape match)            │
│  ├─ [Test] → ✓ Valid · Unlocks: feature, feature, feature       │
│  │           ✗ Invalid: <error from probe>                      │
│  └─ Footer: [← Back] [Skip] [Don't ask again] [Save & Next →]   │
└─────────────────────────────────────────────────────────────────┘
```

### Reuses existing infrastructure

Three pieces from the spec's first draft turned out to already exist in the codebase and are reused as-is:

- **Validation routing** — `verifySecretWithApi()` at `src/services/runtime-config.ts` already dispatches to `verifyWebSecret` (browser, direct CORS probe for ~6 providers) or to the sidecar (desktop). Returns `{ valid, message }`. The dashboard and wizard call this directly.
- **Sidecar validation route** — `POST /api/local-validate-secret` at `src-tauri/sidecar/local-api-server.mjs:5066` already exists with per-provider `case` probes for Groq, OpenRouter, FRED, EIA, Cloudflare, ACLED, URLhaus, ThreatFox, OTX, AbuseIPDB, Wingbits, Finnhub, NASA FIRMS, Ollama, and the relay URLs. New probe `case` blocks added inline as needed; no new route required.
- **Feature-unlock map** — `RUNTIME_FEATURES` at `src/services/runtime-config.ts:240` already has each feature's `requiredSecrets`. The dashboard inverts this index to compute "Unlocks: <features>" per key. No hand-curated `key-feature-map.ts` needed.

### Files added

| File | Purpose |
|---|---|
| `src/components/KeyDashboard.ts` | Replaces `RuntimeConfigPanel` body. Renders categorized cards with status. |
| `src/components/SetupWizard.ts` | Modal wizard with tier checkpoints and per-step UX. |
| `src/services/key-shape-registry.ts` | Regex per key for clipboard watcher. ~25 entries; keys without a stable shape are omitted. |
| `src/services/wizard-state.ts` | Persists wizard position, "don't ask again" set, skipped-this-session set, per-key status in localStorage. |
| `src/services/clipboard-watcher.ts` | 500ms-poll Tauri clipboard during active wizard step. Desktop only. |
| `src/services/key-feature-index.ts` | Pure function: inverts `RUNTIME_FEATURES.requiredSecrets` to `Map<RuntimeSecretKey, string[]>` of feature labels. |

### Files modified

| File | Change |
|---|---|
| `src/components/RuntimeConfigPanel.ts` | Becomes a thin wrapper that mounts `KeyDashboard`. Existing web-vault banner logic preserved as-is. |
| `src/services/settings-constants.ts` | Add `KEY_CATEGORIES` constant + `categoryFor(key)` helper. |
| `src-tauri/sidecar/local-api-server.mjs` | Extend the existing `switch (key)` block at line 1137 with new `case` blocks for any tier-1–8 keys not yet covered (NewsAPI, NewsData, MediaStack, VirusTotal, GreyNoise, etc.). Reuses `fetchWithTimeout`, `isAuthFailure`, `isCloudflareChallenge403`, `ok()`, `fail()` helpers already in the file. |

### Tier and category mapping

```ts
export const KEY_CATEGORIES = [
  { id: 'llm',      label: 'Core LLMs',             tier: 1, keys: ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_API_URL'] },
  { id: 'markets',  label: 'Markets & Macro',       tier: 2, keys: ['FRED_API_KEY', 'EIA_API_KEY', 'FINNHUB_API_KEY', 'FMP_API_KEY'] },
  { id: 'cyber',    label: 'Cyber Threat Intel',    tier: 3, keys: ['OTX_API_KEY', 'ABUSEIPDB_API_KEY', 'URLHAUS_AUTH_KEY', 'THREATFOX_API_KEY', 'VIRUSTOTAL_API_KEY', 'GREYNOISE_API_KEY', 'URLSCAN_API_KEY', 'VULNERS_API_KEY', 'PULSEDIVE_API_KEY', 'HIBP_API_KEY', 'BGPVIEW_API_KEY', 'BITCOINABUSE_API_KEY'] },
  { id: 'conflict', label: 'Conflict & Geopolitics', tier: 4, keys: ['ACLED_ACCESS_TOKEN', 'ACLED_EMAIL', 'ACLED_REFRESH_TOKEN', 'UC_DP_KEY', 'WTO_API_KEY', 'CLOUDFLARE_API_TOKEN'] },
  { id: 'news',     label: 'News',                  tier: 5, keys: ['NEWSAPI_KEY', 'NEWSDATA_API_KEY', 'MEDIASTACK_API_KEY'] },
  { id: 'aviation', label: 'Aviation & Maritime',   tier: 6, keys: ['WINGBITS_API_KEY', 'OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET', 'AISSTREAM_API_KEY', 'AVIATIONSTACK_API', 'ICAO_API_KEY'] },
  { id: 'geo',      label: 'Geo & Maps',            tier: 7, keys: ['GOOGLE_MAPS_API_KEY', 'MAPBOX_API_KEY', 'MAPTILER_API_KEY', 'GEONAMES_USERNAME', 'IPINFO_TOKEN', 'CESIUM_ION_TOKEN'] },
  { id: 'weather',  label: 'Weather & NASA',        tier: 8, keys: ['OWM_API_KEY', 'NASA_API_KEY', 'NASA_FIRMS_API_KEY'] },
];
```

Tier 1–4 are "essential" (count toward the dashboard progress bar). Tier 5–8 are bonus.

Total: 44 keys across the 8 tiers. The remaining 5 supported keys (`CRYSTALBALL_API_KEY`, `WS_RELAY_URL`, `VITE_OPENSKY_RELAY_URL`, `VITE_WS_RELAY_URL`, `OLLAMA_MODEL`) are uncategorized — they remain editable via a "Other / Advanced" collapsed section at the bottom of the dashboard but the wizard skips them. Note: `SHODAN_API_KEY` exists in the TypeScript `RuntimeSecretKey` union but is not present in `SUPPORTED_SECRET_KEYS` (Rust); attempting to save it currently fails silently. This spec excludes Shodan from the dashboard until that mismatch is fixed in a separate change.

### ACLED special case

ACLED requires three values (access token, email, refresh token) from a single signup. Treated as a single virtual wizard step "ACLED Account" that renders three paste fields under one signup link. One status badge for the trio; valid only if all three are set. The dashboard renders the three sub-fields under a single ACLED card.

## Data flow — single key entry via wizard

1. User clicks "Open Signup ↗" → `tauri::shell::open(SIGNUP_URLS[key])` opens default browser.
2. User signs up, copies key from provider dashboard.
3. `clipboard-watcher` polls Tauri `clipboard.readText()` every 500ms; on change, runs the active step's regex from `key-shape-registry`; on match, dispatches `wizard:clipboard-detected` with the value.
4. Wizard auto-fills paste field and shows "Detected from clipboard" banner with `[Use]` / `[Dismiss]`.
5. User clicks "Save & Next" → `runtime-config.setSecretValue(key, value)` (routes to keychain on desktop, web vault on browser).
6. `key-validator.validate(key, value)` runs (5s timeout):
   - Direct CORS probe (Anthropic, Groq, OpenRouter, MapTiler, Mapbox, Cesium) — reuses `runtime-config.verifyWebSecret`.
   - Sidecar-proxied probe (Finnhub, FRED, EIA, NewsAPI, NASA, OWM, etc.) — `POST http://127.0.0.1:46123/api/validate-secret` with bearer auth.
   - Plaintext (OLLAMA_API_URL, ACLED_EMAIL, etc.) — returns `{ ok: true }` if non-empty.
7. On ✓: pull unlocked features from `key-feature-map`, render in green; advance to next step.
8. On ✗: render error inline; user can retry, "Save anyway" (advances with ✗ status), skip, or back out.

## Status badges

Stored in `localStorage` under `cb:key-status:<KEY>` as `{ state, lastChecked, lastError? }`.

| Glyph | State | Meaning |
|---|---|---|
| ✓ | Valid | Last validation succeeded within 30 days |
| ⚠ | Set, unvalidated | Saved but never tested, or last test >30d ago |
| ✗ | Set, invalid | Last validation failed (401/403/network); needs attention |
| ○ | Unset | No value stored |
| ⏸ | Skipped | "Don't ask again" flag set (still unset, hidden from wizard, visible on dashboard) |

## State persistence

All localStorage keys under `cb:setup-wizard:` and `cb:key-status:` namespaces.

```
cb:setup-wizard:position    → { tier: 2, stepIndex: 1 }            (resume point)
cb:setup-wizard:dont-ask    → ['SHODAN_API_KEY', 'HIBP_API_KEY']    (Set serialized)
cb:setup-wizard:skipped     → ['NEWSDATA_API_KEY']                  (this-session only, cleared on wizard close)
cb:key-status:<KEY>         → { state, lastChecked, lastError? }    (per-key)
```

Wizard opens at the lowest tier with any key matching `unset && !dontAsk`. End-of-tier checkpoint screen: "✓ 3 of 4 added; 1 skipped — Continue to Tier N+1, or stop here?" with `[Continue]` and `[Finish for now]`.

## Clipboard watcher

- Active **only while a wizard step is showing** and only on desktop runtime (`isDesktopRuntime() === true`).
- Polls Tauri `clipboard.readText()` every 500ms via existing `tauri-bridge.invokeTauri` plumbing.
- Tracks last-seen content via SHA-1 hash, never raw value.
- On clipboard-content-change: trim, then test against current step's regex. Non-matches are discarded immediately, never logged.
- On match: emit `wizard:clipboard-detected` event with the value.
- Stops polling on wizard dismiss, step advance, or step's regex-less keys.

### key-shape-registry examples

| Key name              | Regex pattern |
|-----------------------|---------------|
| ANTHROPIC API key     | `^sk-ant-[a-zA-Z0-9_-]{40,}$` |
| GROQ API key          | `^gsk_[a-zA-Z0-9]{40,}$` |
| OPENROUTER API key    | `^sk-or-v1-[a-f0-9]{40,}$` |
| FRED API key          | `^[a-f0-9]{32}$` |
| NASA API key          | `^[a-zA-Z0-9]{40}$` |
| CESIUM ION token      | `^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$` (JWT shape) |
| MAPBOX public token   | `^pk\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$` |

Keys without a stable shape (e.g., `GEONAMES_USERNAME`, `OLLAMA_MODEL`) are omitted — clipboard watcher just won't fire for those steps.

## Validation layer (uses existing infrastructure)

The dashboard and wizard call the existing `verifySecretWithApi(key, value)` from `src/services/runtime-config.ts`. That function already:

- Validates locally first (`validateSecret`) and returns immediately on bad shape.
- Routes to `verifyWebSecret` (browser) which performs direct CORS-friendly probes for ~6 providers using `referrerPolicy: 'no-referrer'` and an 8s `AbortController` timeout. Returns `{ valid, message }`.
- Routes to the sidecar `/api/local-validate-secret` (desktop) via `callSidecarWithAuth` (bearer-auth handled by the helper). The sidecar runs the per-provider probe in its `switch (key)` block at line 1137. Probes already exist for Groq, OpenRouter, FRED, EIA, Cloudflare, ACLED, URLhaus, ThreatFox, OTX, AbuseIPDB, Wingbits, Finnhub, NASA FIRMS, Ollama, and the relay URLs.

The implementation work for validation is therefore limited to **adding new sidecar `case` blocks** for the tier-1–8 keys that don't yet have probes (NewsAPI, NewsData, MediaStack, VirusTotal, GreyNoise, URLScan, Vulners, Pulsedive, HIBP, BGPView, BitcoinAbuse, UCDP, WTO, AviationStack, ICAO, AISStream, OpenSky pair, OpenWeatherMap, NASA, IPInfo, GeoNames, Google Maps). Each new `case` follows the existing pattern: hit a free-tier endpoint, distinguish 401/403 from 5xx and Cloudflare challenges, return `ok()` or `fail()` with a one-line message.

Probes hit free-tier or zero-cost endpoints when possible (e.g., NewsAPI's `GET /top-headlines?country=us&pageSize=1`, OpenWeatherMap's `GET /data/2.5/weather?q=London`, etc.).

## Feature index (derived from RUNTIME_FEATURES)

`key-feature-index.ts` exports a single pure function `featuresFor(key: RuntimeSecretKey): string[]` that inverts the existing `RUNTIME_FEATURES` array (each entry has `name`, `requiredSecrets`). Built on import as a `Map<RuntimeSecretKey, string[]>` and looked up O(1).

The unlock line renders as: "✓ Valid — Unlocks: Markets, Earnings, Threat Synthesis". If `featuresFor(key)` returns an empty array, the unlock line is omitted silently.

This means the unlock notes stay automatically in sync with `RUNTIME_FEATURES` — no risk of the two drifting apart over time.

## Empty / first-run state

Dashboard with 0 keys configured replaces the categorized list with a single hero card: "You haven't set up any API keys yet. Run the Setup Wizard to walk through the essentials in ~10 minutes." with one button `[Start Setup Wizard →]`. Once any key is set, the standard dashboard renders.

## Web build behavior

- Dashboard renders identically. Existing web-vault unlock/lock/destroy banner is preserved at the top of the panel (unchanged behavior).
- Wizard runs identically except clipboard watcher is no-op.
- Validation routes that require sidecar fall back to "Saved (unverified)" with ⚠ status — sidecar isn't reachable from web build.

## Error visibility

Validation failures are logged via the existing `reasoning-debug` ring buffer so they appear in the ⌘⇧D diagnostics overlay under a new "key-validator" tag. Sidecar probe errors include status code and provider response snippet (truncated to 200 chars, sanitized of any echoed secret value).

## Testing plan

**Unit (`tsx --test`, the project's test runner — see `npm run test:reasoning` for examples):**

- `src/services/__tests__/key-shape-registry.test.mts` — positive (real-shape keys match) + negative (random strings, near-miss prefixes don't match) cases for every registered regex.
- `src/services/__tests__/wizard-state.test.mts` — persistence round-trips, dontAsk add/remove, position resume, skipped-set clears on close. Uses an in-memory `localStorage` shim like the existing `llm-budget.test.mts`.
- `src/services/__tests__/key-feature-index.test.mts` — sanity-check that every key referenced in `RUNTIME_FEATURES.requiredSecrets` exists in the `RuntimeSecretKey` union, and that `featuresFor()` returns expected feature labels for a sample of keys.
- `src/services/__tests__/categories.test.mts` — every key in `KEY_CATEGORIES` exists in `SUPPORTED_SECRET_KEYS`; no key appears in two categories.

**Integration (smoke):**

- Open wizard with all keys unset → lands on Tier 1 / Step 1 (Anthropic).
- Paste known-bad Anthropic key → ✗ render with reason.
- Paste mocked-good key → ✓ render with unlock note.
- Hit Skip → advances to Step 2 without saving; Anthropic remains unset.
- Hit "Don't ask again" → advances; key added to `dontAsk` localStorage; reopening wizard skips it.
- Complete Tier 1 → checkpoint screen renders with "X of 4 added; Y skipped".
- Click "Finish for now" → wizard closes; reopening resumes at Tier 2 / Step 1.

**Manual:**

- Real keychain write/read on desktop build.
- Real web-vault write/read on browser build.
- Clipboard watcher: copy a real Anthropic key while wizard is on Anthropic step → auto-fill banner appears.
- Clipboard watcher: copy a non-key string → nothing happens, no log entry.

## Out of scope (explicit)

- Mail.app rule integration (separate follow-up).
- Browser userscript / Tampermonkey integration.
- Key rotation reminders.
- Sharing, export, encrypted backup, multi-profile.
- Automating signup itself.
