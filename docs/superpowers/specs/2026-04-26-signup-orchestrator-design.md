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

### Files added

| File | Purpose |
|---|---|
| `src/components/KeyDashboard.ts` | Replaces `RuntimeConfigPanel` body. Renders categorized cards with status. |
| `src/components/SetupWizard.ts` | Modal wizard with tier checkpoints and per-step UX. |
| `src/services/key-validator.ts` | Per-provider validation registry. Three flavors: direct CORS-friendly probe, sidecar-proxied probe, plaintext-noop. |
| `src/services/key-feature-map.ts` | Maps each key → user-facing list of features it unlocks. |
| `src/services/key-shape-registry.ts` | Regex per key for clipboard watcher. ~30 entries; keys without a stable shape are omitted. |
| `src/services/wizard-state.ts` | Persists wizard position, "don't ask again" set, skipped-this-session set, per-key status in localStorage. |
| `src/services/clipboard-watcher.ts` | 500ms-poll Tauri clipboard during active wizard step. Desktop only. |

### Files modified

| File | Change |
|---|---|
| `src/components/RuntimeConfigPanel.ts` | Becomes a thin wrapper that mounts `KeyDashboard`. Existing web-vault banner logic preserved as-is. |
| `src/services/settings-constants.ts` | Add `KEY_CATEGORIES` constant + `categoryFor(key)` helper. |
| `src-tauri/sidecar/local-api-server.mjs` | Add `POST /api/validate-secret` route — body `{ key, value }`, sidecar makes the test call server-side, returns `{ ok, reason? }`. Bearer-auth gated. |

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

## Validation layer

`key-validator.ts` exports:

```ts
export type ValidationResult = { ok: true } | { ok: false, reason: string };

export async function validate(key: RuntimeSecretKey, value: string): Promise<ValidationResult>;
```

Internal map: `Record<RuntimeSecretKey, (v: string) => Promise<ValidationResult>>`. Examples of how each key gets wired:

| Key name (description) | Validator factory |
|------------------------|-------------------|
| Anthropic              | `corsProbe('https://api.anthropic.com/v1/models', { headers: ... })` |
| Groq                   | `corsProbe('https://api.groq.com/openai/v1/models', ...)` |
| Finnhub                | `sidecarProbe('FINNHUB_API_KEY')` |
| Ollama URL             | `plaintextNoop` |
| ACLED email            | `plaintextNoop` |

Each validator has a 5-second timeout. On timeout: `{ ok: false, reason: 'Validation timed out' }`.

Sidecar `POST /api/validate-secret`:

```js
// local-api-server.mjs
app.post('/api/validate-secret', requireBearer, async (req, res) => {
  const { key, value } = req.body;
  const probe = SIDECAR_PROBES[key];
  if (!probe) return res.status(400).json({ ok: false, reason: 'No validator' });
  try {
    const result = await probe(value);  // makes test call server-side
    res.json(result);
  } catch (err) {
    res.json({ ok: false, reason: err.message });
  }
});
```

Probes hit free-tier or zero-cost endpoints when possible (e.g., Finnhub's `GET /quote?symbol=AAPL` consumes a request but returns immediately; NewsAPI's `GET /top-headlines?country=us&pageSize=1`).

## Feature map

`key-feature-map.ts` exports `KEY_FEATURES` as `Partial<Record<RuntimeSecretKey, KeyFeatures>>`, where `KeyFeatures` is `{ features: string[]; panels?: string[] }`. Example entries:

| Key name (description) | Features | Panels |
|------------------------|----------|--------|
| Anthropic              | `/sitrep`, Threat Synthesis, Skeptic persona, Auto-brief | — |
| Finnhub                | Real-time stock quotes, Earnings calendar | Markets |

Rendered as: "✓ Valid — Unlocks: Real-time stock quotes, Earnings calendar". If no entry, the unlock line is omitted silently.

## Empty / first-run state

Dashboard with 0 keys configured replaces the categorized list with a single hero card: "You haven't set up any API keys yet. Run the Setup Wizard to walk through the essentials in ~10 minutes." with one button `[Start Setup Wizard →]`. Once any key is set, the standard dashboard renders.

## Web build behavior

- Dashboard renders identically. Existing web-vault unlock/lock/destroy banner is preserved at the top of the panel (unchanged behavior).
- Wizard runs identically except clipboard watcher is no-op.
- Validation routes that require sidecar fall back to "Saved (unverified)" with ⚠ status — sidecar isn't reachable from web build.

## Error visibility

Validation failures are logged via the existing `reasoning-debug` ring buffer so they appear in the ⌘⇧D diagnostics overlay under a new "key-validator" tag. Sidecar probe errors include status code and provider response snippet (truncated to 200 chars, sanitized of any echoed secret value).

## Testing plan

**Unit (Vitest):**

- `key-validator.test.ts` — mocked `fetch` for direct probes; mocked sidecar response for proxied; timeout behavior; non-200 handling.
- `key-shape-registry.test.ts` — positive (real-shape keys match) + negative (random strings, near-miss prefixes don't match) cases for every registered regex.
- `wizard-state.test.ts` — persistence round-trips, dontAsk add/remove, position resume, skipped-set clears on close.
- `key-feature-map.test.ts` — every key in `KEY_FEATURES` exists in `RuntimeSecretKey` union.

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
