# Disease Intelligence Sources — Design Spec

**Date:** 2026-05-05
**Status:** Approved (4-PR stack)

## Overview

Add wastewater epidemiology surveillance, refactor ProMED ingestion into a dedicated sidecar route, add ProMED↔WHO DON cross-referencing, and surface the new content as additional tabs on the existing `DiseaseOutbreakPanel`. Ships in four stacked PRs that auto-merge in sequence.

No new panel is added — the existing `DiseaseOutbreakPanel` (`disease-outbreaks`) gains tabs.

## PR 1 — `/api/wastewater` (new endpoint)

### Upstream

- `https://data.cdc.gov/resource/2ew6-ywp6.json` — CDC NWSS SARS-CoV-2 wastewater dataset (SODA API, no auth).
- This dataset is COVID-only. The pathogen taxonomy in our types is extensible (`'COVID-19' | 'flu_a' | 'flu_b' | 'rsv' | 'mpox' | 'norovirus'`); only `'COVID-19'` is populated in this PR. Other pathogens require additional CDC dataset IDs and ship in a follow-up if requested.
- The HTML state-rollup page (`cdc.gov/nwss/rv/COVID19-statewide.html`) is intentionally **not** used — fragile, and we can derive state-level rollups from the SODA rows ourselves.

### Sidecar route

- `GET /api/wastewater`, cache TTL **30 minutes**.
- Sidecar fetches up to ~5000 most-recent rows (`?$limit=5000&$order=date_end DESC`).
- Sidecar transforms WWTP-level rows into state-level `WastewaterSignal[]` via the pure module `src-tauri/sidecar/wastewater-aggregate.mjs`:
  - Group rows by `(pathogen, wwtp_jurisdiction)`. For COVID, all rows have `pathogen = 'COVID-19'`.
  - For each group, take only the most recent reporting window (max `date_end`).
  - `level` = median of `percentile` across WWTPs in that state-window, mapped: ≥80 → `'high'`, ≥60 → `'elevated'`, ≥40 → `'moderate'`, otherwise `'low'`.
  - `trend` = derived from median `ptc_15d`: `> +25` → `'increasing'`, `< -25` → `'decreasing'`, else `'stable'`.
  - `lastUpdated` = max `date_end` for that state.
- Surge-watch: any pathogen with `trend === 'increasing'` in ≥3 jurisdictions → string `'<pathogen> increasing in N states'`.
- Response: `{ signals: WastewaterSignal[], surgeWatches: string[], lastUpdated: string, fetchedAt: string }`.
- On upstream failure: return `{ signals: [], surgeWatches: [], lastUpdated: null, fetchedAt: <now>, degraded: true, reason: <message> }` (matches existing degraded-payload convention).

### Renderer

- `src/services/wastewater.ts` — TS types matching the response, plus a thin `fetchWastewater()` client. No transform logic on the renderer side (sidecar owns it).

### Tests

- `src-tauri/sidecar/__tests__/wastewater-aggregate.test.mjs` — pure tests for the aggregator: SODA row parse, level/trend classification, multi-state surge detection, latest-window selection, malformed-row tolerance.
- Run via `node --test`; wire into the existing `test:sidecar` script.

### No-go in PR 1

- No data-loader wiring, no panel changes, no map layer.

## PR 2 — `/api/promed` (refactor)

### Upstream

- `https://promedmail.org/feed/` (RSS), fetched directly by sidecar with `User-Agent: ${CHROME_UA}`. The renderer's current path is `/api/rss-proxy?url=...` — replace with this dedicated route so caching, parsing, severity classification, and dedup all live server-side.

### Sidecar route

- `GET /api/promed`, cache TTL **15 minutes**.
- Fetches RSS (`text/xml`), parses with a lightweight regex/string parser (sidecar already does this for other RSS feeds — reuse the established style; no new XML library).
- Per item, extract: `id` (RSS `<guid>` or post-ID slug), `title`, `link`, `pubDate`, `description`.
- Pure module `src-tauri/sidecar/promed-classify.mjs`:
  - `classifySeverity(item) → 'NOVEL_PATHOGEN' | 'OUTBREAK' | 'UNUSUAL_CLUSTER' | 'ROUTINE'`
    - `NOVEL_PATHOGEN`: title or description matches `/(novel|new|unidentified|undiagnosed|unknown etiolog|first .* case)/i`.
    - `OUTBREAK`: matches `/(outbreak|epidemic|surge)/i` and not novel.
    - `UNUSUAL_CLUSTER`: matches `/(cluster|unusual|spike|excess)/i` and not novel/outbreak.
    - Otherwise `ROUTINE`.
  - `extractCaseCount(item) → { cases?: number, deaths?: number }` — best-effort regex on `description` (`/([\d,]+)\s+(?:confirmed )?cases?/i`, `/([\d,]+)\s+deaths?/i`).
  - `extractDisease(title) → string` — reuse the existing renderer-side disease list, ported to JS.
  - `extractCountry(title, description) → string` — port of the existing renderer-side helper.
- Cap output at 100 most-recent posts.
- Response shape:

  ```ts
  {
    alerts: ProMedAlert[],         // {id, title, link, pubDate, disease, country, severity, cases?, deaths?}
    lastFetch: string,
    novelCount: number,            // count of severity='NOVEL_PATHOGEN' in alerts
    outbreakCount: number          // count of severity='OUTBREAK' in alerts
  }
  ```

- On upstream failure: degraded-payload shape mirroring PR 1.

### Renderer refactor

- `src/services/disease-outbreak.ts:fetchProMED` — replace direct RSS fetch + `DOMParser` with a `fetch('/api/promed')` call; map the new payload back into the existing `DiseaseOutbreak[]` shape consumed by `DiseaseOutbreakPanel`. Severity from the new endpoint maps to the existing 1-5 numeric scale (NOVEL=5, OUTBREAK=4, UNUSUAL=3, ROUTINE=2 — preserves the panel's red/orange ordering).
- Drop the renderer's local regex/`DOMParser` ProMED path. Keep `extractDiseaseName`/`extractCountry` for the WHO + ReliefWeb code paths that still use them.

### Tests

- `src-tauri/sidecar/__tests__/promed-classify.test.mjs` — pure tests: severity classification on representative titles, case-count extraction, disease/country extraction, novel-pathogen heuristic.
- Sidecar route is exercised indirectly via the classifier tests (route handler is thin glue around the classifier).

## PR 3 — WHO DON cross-reference (extend `/api/disease-intel`)

- In the existing `/api/disease-intel` handler ([local-api-server.mjs:3673](src-tauri/sidecar/local-api-server.mjs:3673)), after `whoDon` is fetched, hit the in-memory `/api/promed` cache via `getCached('promed', 15 * 60_000)`. If absent, populate it via the same fetcher PR 2 introduces.
- Pure module `src-tauri/sidecar/who-promed-cross-reference.mjs`:
  - Input: `{ whoDon: WhoDonItem[], promedAlerts: ProMedAlert[] }`.
  - For each WHO DON item, find ProMED alerts where:
    - disease names match (case-insensitive substring match on the extracted disease tokens), AND
    - country matches, AND
    - ProMED `pubDate` is within ±14 days of WHO `PublicationDate`.
  - Output: `crossReferencedWithPromed: { whoDonId: string, promedIds: string[] }[]`. Empty list if no matches; one entry per WHO DON item that has at least one match.
- Append `crossReferencedWithPromed` to the existing `/api/disease-intel` response. No removal of fields, no behavior change for existing consumers.
- Disease-intel renderer service gets the new field but ignores it for now — surfaced in PR 4.

### Tests

- `src-tauri/sidecar/__tests__/who-promed-cross-reference.test.mjs` — pure tests: empty inputs, no-overlap fixtures, exact-match fixtures, near-date fixtures (±13d hit, ±15d miss), country-mismatch (no match), disease-mismatch (no match).

## PR 4 — Panel tabs

### `DiseaseOutbreakPanel`

- Add a tab strip at the top of the panel content area: **Outbreaks · Wastewater · Cross-Referenced**.
  - **Outbreaks** — existing list, no change.
  - **Wastewater** — table of `WastewaterSignal` rows, sorted by `level` desc then `trend` (increasing first). Each row: pathogen badge, jurisdiction, level pill (color: high=red, elevated=orange, moderate=yellow, low=neutral), trend arrow (↑ red, ↓ green, → grey), 15d-percentile, last update age. Surge-watch banner above the table if `surgeWatches.length > 0`.
  - **Cross-Referenced** — list of WHO DON items that have at least one ProMED match, with a `↔ ProMED` badge and an inline expandable list of matching ProMED post IDs.
- Active tab persisted to `localStorage['cb:disease-outbreak-tab']`.
- Wastewater tab pulls from a new `WastewaterPanelInput` injected via `panel.setWastewater(data)` from `data-loader.ts`. New task: `runGuarded('wastewater', () => this.loadWastewater())` calling `fetchWastewater()` from PR 1's renderer service.
- Cross-Referenced tab pulls from the existing `/api/disease-intel` payload (now enriched in PR 3) — no new loader task, just new rendering.

### Tests

- `tests/panels/panel-fixtures.test.mts` — extend with a `disease-outbreaks` fixture exercising all three tabs (smoke render).
- `src/services/__tests__/wastewater.test.mts` — types-only validation of the renderer fetcher (response shape sanity).

## Branch flow

- PR 1: branch `claude/wastewater-api` from `origin/main`.
- PR 2: branch `claude/promed-route` from `claude/wastewater-api`.
- PR 3: branch `claude/who-don-crossref` from `claude/promed-route`.
- PR 4: branch `claude/disease-outbreak-tabs` from `claude/who-don-crossref`.
- Each push: `gh pr create --base main --fill` then `gh pr merge --auto --squash`.
- Sidecar lives at `src-tauri/sidecar/local-api-server.mjs`. Pure modules colocated in `src-tauri/sidecar/`. Sidecar tests run via the existing `test:sidecar` script.

## Out of scope

- Multi-pathogen wastewater (flu A/B, RSV, mpox, norovirus) — requires additional CDC dataset IDs not in scope for this stack.
- Map layer for wastewater hot-spots — explicitly skipped per design conversation.
- New `BioIntelPanel` — explicitly rejected in favor of tabs on the existing panel.
