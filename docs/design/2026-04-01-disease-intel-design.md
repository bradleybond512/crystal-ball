# Disease Intelligence Panel — Design Spec

**Date:** 2026-04-01
**Status:** Draft

---

## Overview

Add a `DiseaseIntelPanel` (`disease-intel`) that consolidates four complementary epidemiological signals into a single view: COVID-19 variant competition dynamics from Nextstrain, current COVID case counts by country from disease.sh, active epidemic declarations from ReliefWeb, and WHO Disease Outbreak News (DON) alerts. The panel is distinct from the existing `DiseaseOutbreakPanel` (`disease-outbreaks`), which focuses on situation reports and ProMED early warnings. This panel is oriented toward genomic surveillance and active outbreak declarations — earlier and more granular signal.

All four upstream sources are free and require no API key.

---

## Architecture

```
Nextstrain MLR JSON ──────────────────────┐
disease.sh /covid-19/countries ───────────┤
ReliefWeb /v1/disasters?type=EP ──────────┤──▶ sidecar /api/disease-intel
WHO /api/news/diseaseoutbreaknews ────────┘ (4 upstream fetches,
 Promise.allSettled)
 │
 ┌────────────────┤
 ▼ ▼
 src/services/ DeckGLMap
 disease-intel.ts layer: diseaseIntel
 │ (ScatterplotLayer +
 ┌───────┴───────┐ GeoJsonLayer choropleth)
 ▼ ▼
 DiseaseIntelPanel map.setDiseaseIntel(data)
 (tabs: Variants /
 Countries / Alerts)
```

---

## Data Sources

### 1 — Nextstrain COVID Variant Frequencies (Genomic)

**Endpoint:** `https://data.nextstrain.org/files/workflows/forecasts-ncov/open/nextstrain_clades/global/mlr/latest_results.json`
**Method:** GET — no auth, CORS-open
**Update cadence upstream:** Daily (model re-runs on new GISAID/GenBank submissions)
**Sidecar cache TTL:** 4 hours

Returns Multinomial Logistic Regression (MLR) frequency estimates and growth-rate advantages per Nextstrain clade, broken down by country/region. Key fields used:

- `metadata.updated` — ISO timestamp of the model run
- `data[].location` — country/region name
- `data[].clades[].clade` — Nextstrain clade label (e.g. `"24A"`, `"24B"`, `"JN.1"`)
- `data[].clades[].freq.value` — current estimated frequency (0–1)
- `data[].clades[].freq.upper` / `.lower` — 95% credible interval bounds
- `data[].clades[].ga.value` — growth advantage over baseline (positive = expanding)

The `data` array may contain `"global"` as a location alongside country-level rows.

### 2 — COVID-19 Case Counts by Country (disease.sh)

**Endpoint:** `https://disease.sh/v3/covid-19/countries`
**Method:** GET — no auth, CORS-open
**Update cadence upstream:** ~10 minutes
**Sidecar cache TTL:** 30 minutes

Returns an array of per-country objects. Key fields:

- `country` — English country name
- `countryInfo.iso2` — ISO 3166-1 alpha-2 code (used for choropleth join)
- `countryInfo.lat` / `.long` — centroid coordinates
- `cases` — cumulative confirmed
- `active` — active cases
- `todayCases` / `todayDeaths` — 24 h delta
- `casesPerOneMillion` — normalized intensity (used for choropleth fill)
- `updated` — Unix ms timestamp

### 3 — Global Epidemic Declarations (ReliefWeb)

**Endpoint:** `https://api.reliefweb.int/v1/disasters?appname=crystalball&filter[field]=type&filter[value]=EP&limit=20&sort[]=date:desc&fields[include][]=name&fields[include][]=date&fields[include][]=country&fields[include][]=status&fields[include][]=url`
**Method:** GET — no auth, CORS-open
**Update cadence upstream:** Near-real-time on UN OCHA declarations
**Sidecar cache TTL:** 30 minutes

Returns UN OCHA disaster records classified as epidemics (type code `EP`). Key fields:

- `fields.name` — event name (e.g. `"Cholera - DRC - 2026"`)
- `fields.date.created` — ISO timestamp
- `fields.country[0].name` / `.iso3` — primary affected country
- `fields.status` — `"alert"` | `"ongoing"` | `"past"`
- `fields.url` — canonical ReliefWeb page URL

### 4 — WHO Disease Outbreak News (DON)

**Endpoint:** `https://www.who.int/api/news/diseaseoutbreaknews`
**Method:** GET — no auth
**Update cadence upstream:** Irregular (published as WHO staff issue bulletins)
**Sidecar cache TTL:** 30 minutes

Returns WHO DON items. Key fields:

- `Title` — bulletin title (e.g. `"Mpox - Democratic Republic of the Congo"`)
- `PublicationDate` — ISO date string
- `PrimaryLanguage` — typically `"en"`
- `Url` — full WHO URL for the bulletin

Note: The WHO server may return 403 on direct browser fetch; the sidecar proxy avoids this by setting a `User-Agent` header.

---

## Sidecar Route

**Route:** `GET /api/disease-intel`
**Cache key:** `'disease-intel'`
**Cache TTL:** 30 minutes (shortest TTL among sources — the variant data is the slowest-moving and can tolerate 4 h, but outbreak/DON data can change; 30 min is the binding constraint)

Implementation pattern follows existing disease-related routes:

```js
if (requestUrl.pathname === '/api/disease-intel') {
  const cached = getCached('disease-intel', 30 * 60 * 1000);
  if (cached) return json(cached);

  const NEXTSTRAIN_URL =
 'https://data.nextstrain.org/files/workflows/forecasts-ncov/open/nextstrain_clades/global/mlr/latest_results.json';
  const DISEASE_SH_URL = 'https://disease.sh/v3/covid-19/countries';
  const RELIEFWEB_URL =
 'https://api.reliefweb.int/v1/disasters?appname=crystalball&filter[field]=type&filter[value]=EP&limit=20&sort[]=date:desc&fields[include][]=name&fields[include][]=date&fields[include][]=country&fields[include][]=status&fields[include][]=url';
  const WHO_DON_URL = 'https://www.who.int/api/news/diseaseoutbreaknews';

  try {
 const [nsRes, dsRes, rwRes, whoRes] = await Promise.allSettled([
 fetchWithTimeout(NEXTSTRAIN_URL, { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }, 20_000),
 fetchWithTimeout(DISEASE_SH_URL, { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }, 15_000),
 fetchWithTimeout(RELIEFWEB_URL,  { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }, 15_000),
 fetchWithTimeout(WHO_DON_URL, { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }, 15_000),
 ]);

 const nextstrain  = nsRes.status  === 'fulfilled' && nsRes.value.ok  ? await nsRes.value.json()  : null;
 const covidCountries = dsRes.status === 'fulfilled' && dsRes.value.ok ? await dsRes.value.json() : null;
 const reliefweb = rwRes.status  === 'fulfilled' && rwRes.value.ok  ? await rwRes.value.json()  : null;
 const whoDon = whoRes.status === 'fulfilled' && whoRes.value.ok ? await whoRes.value.json() : null;

 const result = { nextstrain, covidCountries, reliefweb, whoDon, fetchedAt: new Date().toISOString() };
 setCached('disease-intel', result);
 return json(result);
  } catch (error) {
 return json({ error: `disease-intel fetch error: ${error.message ?? error}` }, 502);
  }
}
```

Single combined route (rather than four separate routes) to allow one coordinated cache invalidation and reduce network chatter from the frontend. Each sub-source is individually nullable — a failure in one does not block the others.

---

## TypeScript Types

New file: `src/services/disease-intel.ts`

```ts
// ── Nextstrain variant frequency ────────────────────────────────────────────

export interface NextstrainCladeFreq {
  value: number; // 0–1 frequency estimate
  upper: number; // 95% CI upper bound
  lower: number; // 95% CI lower bound
}

export interface NextstrainCladeGrowthAdv {
  value: number; // growth advantage over baseline; positive = expanding
  upper: number;
  lower: number;
}

export interface NextstrainClade {
  clade: string; // e.g. "24A", "JN.1", "KP.2"
  freq: NextstrainCladeFreq;
  ga: NextstrainCladeGrowthAdv;
}

export interface NextstrainLocation {
  location: string; // country name or "global"
  clades: NextstrainClade[];
}

// ── COVID country case counts ────────────────────────────────────────────────

export interface CovidCountry {
  country: string;
  iso2: string; // from countryInfo.iso2
  lat: number;
  lon: number;
  active: number;
  todayCases: number;
  casesPerOneMillion: number;
  updatedMs: number; // Unix ms
}

// ── ReliefWeb epidemic events ────────────────────────────────────────────────

export interface EpidemicEvent {
  id: string;
  name: string;
  country: string;
  iso3: string;
  status: 'alert' | 'ongoing' | 'past';
  date: Date;
  url: string;
}

// ── WHO Disease Outbreak News ────────────────────────────────────────────────

export interface WhoDonAlert {
  id: string;
  title: string;
  disease: string; // extracted from title
  country: string; // extracted from title
  date: Date;
  url: string;
}

// ── Combined panel data ──────────────────────────────────────────────────────

export interface DiseaseIntelData {
  variants: NextstrainLocation[]; // global + per-country MLR results
  covidCountries: CovidCountry[]; // sorted by active cases desc
  epidemicEvents: EpidemicEvent[];  // ReliefWeb EP disasters, active/alert only
  whoDon: WhoDonAlert[]; // WHO DON, most recent 20
  fetchedAt: Date;
}
```

Raw JSON from the sidecar is shaped to `DiseaseIntelData` in `fetchDiseaseIntel()` in `disease-intel.ts`. The Nextstrain response requires mapping `data[]` into `NextstrainLocation[]`, filtering to locations with at least one clade with `freq.value > 0.01` to reduce noise. Country centroids for map rendering come from the `covidCountries` array (disease.sh provides lat/lon directly); outbreak alert pins use a country-name → lat/lon lookup table (same approach as `DiseaseOutbreakPanel`).

---

## Panel UI

**Panel key:** `disease-intel`
**Panel title:** `Disease Intelligence`
**Category:** `healthEnv`
**Priority:** 2 (enabled by default in `full` variant)
**infoTooltip:** `COVID variant frequencies (Nextstrain genomic surveillance), active case counts by country, epidemic declarations (UN OCHA), and WHO Disease Outbreak News. No API key required.`

### Layout

Three tabs within the panel content area:

**Tab 1 — Variants**

- Header row: model run timestamp from `nextstrain.metadata.updated`
- Table: Clade | Global Freq | Growth Adv | Top Country
  - Clade: label (e.g. `JN.1`)
  - Global Freq: formatted as `%` from the `"global"` location row
  - Growth Adv: `ga.value` formatted as `+0.XX` / `–0.XX`, colored green if positive, red if negative
  - Top Country: location with highest `freq.value` for this clade (excluding `"global"`)
- Sorted by `ga.value` descending (fastest-growing clades first)
- Cap at 15 rows
- Footer: "Source: Nextstrain open GenBank pipeline"

**Tab 2 — Countries**

- Table: Country | Active | Today | Per Million
- Sorted by active cases descending
- Top 50 rows
- Row colored by `casesPerOneMillion` intensity: `>5000` → red badge, `>1000` → orange, otherwise default
- Footer: "Source: disease.sh"

**Tab 3 — Alerts**

- Combined list: ReliefWeb `EpidemicEvent[]` + `WhoDonAlert[]`, merged and sorted by `date` descending
- Each row: severity badge (ONGOING / ALERT / DON) | disease name | country | age
  - ONGOING → `eq-row eq-strong` (orange)
  - ALERT → `eq-row eq-major` (red)
  - DON → `eq-row` (default, WHO DON items)
- Clickable row → opens `url` in external browser
- Cap at 40 rows
- Footer: "Sources: UN OCHA ReliefWeb · WHO Disease Outbreak News"

Tab selection is stored in a `private activeTab: 'variants' | 'countries' | 'alerts'` field and persisted across re-renders but not across page reloads (no localStorage needed — panel re-fetches on refresh).

---

## Map Layer Integration

**MapLayers key:** `diseaseIntel` (`boolean`)
Added to `MapLayers` type in `src/types/index.ts`.
Default: `false` in all variants (opt-in — choropleth adds visual weight, should not override existing layers).

### Sub-layer A — COVID Case Choropleth (GeoJsonLayer)

- Source: world country GeoJSON (already used by the `economic` layer if applicable, otherwise load from `ne_110m_admin_0_countries.geojson` bundled in `public/`)
- Fill color: linear scale on `casesPerOneMillion`
  - 0 → `[0, 0, 0, 0]` (transparent)
  - 1000 → `[255, 180, 0, 60]`
  - 5000 → `[255, 80, 0, 100]`
  - 20000+ → `[200, 0, 0, 130]`
- Join key: ISO 3166-1 alpha-2 (`iso2`) → GeoJSON `ISO_A2` property
- Updated when `diseaseIntel` layer is enabled and `loadDiseaseIntel()` fires
- Layer order: below conflict/military layers, above waterways

### Sub-layer B — Variant Dominance Dots (ScatterplotLayer)

- One dot per country from `covidCountries`, placed at `[lon, lat]`
- Radius: 6px base
- Color: based on dominant clade in that country (highest `freq.value`)
  - Defined palette per major clade family: JN.1 lineage → `[100, 180, 255]`, KP lineage → `[255, 120, 60]`, XBB lineage → `[160, 100, 255]`, other → `[180, 180, 180]`
- Visible only when `diseaseIntel` layer is enabled
- Tooltip on hover: country name, dominant clade, frequency %

### Sub-layer C — Outbreak Alert Pins (ScatterplotLayer)

- One pin per `EpidemicEvent` + `WhoDonAlert` (deduplicated by country+disease within 30 days)
- Pin color: `[255, 60, 60]` for ONGOING/ALERT, `[255, 160, 60]` for DON
- Radius: 8px, pulsing outline via DeckGL `stroked: true, lineWidthMinPixels: 2`
- Click → panel scroll to matching Alerts tab row + highlight

All three sub-layers are grouped under the single `diseaseIntel` toggle. The layer switcher label is `"Disease Intel"`.

**Implementation note:** Disease intel data is passed to the map via `deckGLMap.setDiseaseIntel(data: DiseaseIntelData)`, following the same `set*` setter pattern as `setFAACameras`.

---

## Update Intervals

| Signal | Sidecar cache TTL | Frontend re-poll |
|---|---|---|
| Nextstrain variants | 4 h (but combined route is 30 min) | 30 min via `scheduleRefresh` |
| disease.sh countries | 30 min | 30 min |
| ReliefWeb EP events | 30 min | 30 min |
| WHO DON | 30 min | 30 min |

The frontend service uses a 30-minute TTL (same as the sidecar's combined-route TTL). In Ghost Mode the refresh multiplier is ×5, so effective poll interval is 150 minutes.

---

## Data Loader Wiring

`src/app/data-loader.ts` additions:

1. Import: `import { fetchDiseaseIntel } from '@/services/disease-intel';`
2. Import: `import { DiseaseIntelPanel } from '@/components/DiseaseIntelPanel';`
3. Task registration (full variant only):

 ```ts
 if (SITE_VARIANT === 'full') tasks.push({ name: 'diseaseIntel', task: runGuarded('diseaseIntel', () => this.loadDiseaseIntel()) });
 ```

4. Loader method:

 ```ts
 async loadDiseaseIntel(): Promise<void> {
 try {
 const data = await fetchDiseaseIntel();
 (this.ctx.panels['disease-intel'] as DiseaseIntelPanel)?.update(data);
 if (this.ctx.mapLayers.diseaseIntel) {
 this.ctx.deckGLMap?.setDiseaseIntel(data);
 }
 } catch (error) {
 console.warn('[disease-intel] fetch failed', error);
 (this.ctx.panels['disease-intel'] as DiseaseIntelPanel)?.update(null);
 }
 }
 ```

---

## Error Handling

The sidecar uses `Promise.allSettled` — a failure in any one upstream source returns `null` for that field while the others still populate. The frontend service handles each null field independently:

| Failure scenario | Panel behavior |
|---|---|
| Nextstrain unavailable | Variants tab shows `"Variant data unavailable"` banner; other tabs unaffected |
| disease.sh unavailable | Countries tab shows empty state; choropleth layer hidden |
| ReliefWeb unavailable | Alerts tab shows only WHO DON rows (if available) |
| WHO DON unavailable | Alerts tab shows only ReliefWeb rows (if available) |
| All four fail | Panel shows `showError('Disease intelligence data unavailable — all sources failed')` |
| Sidecar returns 502 | Service retries once after 5 s; on second failure shows error state |

Partial data (e.g. variants available but no country case data) is considered a valid render state — the panel renders what it has. The panel's `update(data: DiseaseIntelData | null)` method checks for null and shows a global error only when the entire payload is null.

Stale data display: the panel footer shows `fetchedAt` formatted as `timeAgo()`. If `fetchedAt` is more than 2 hours old, the footer adds a `⚠ stale` indicator.

---

## Files to Create / Modify

| File | Change |
|---|---|
| `src-tauri/sidecar/local-api-server.mjs` | Add `GET /api/disease-intel` route |
| `src/services/disease-intel.ts` | New service: types, fetch, transform, in-memory cache |
| `src/components/DiseaseIntelPanel.ts` | New panel component (three-tab layout) |
| `src/types/index.ts` | Add `diseaseIntel: boolean` to `MapLayers` |
| `src/config/panels.ts` | Add `'disease-intel'` to `FULL_PANELS`; add `diseaseIntel: false` to all `*_MAP_LAYERS`; add to `healthEnv` category |
| `src/app/data-loader.ts` | Add import + `loadDiseaseIntel()` + task push |
| `src/components/DeckGLMap.ts` | Add `setDiseaseIntel()` setter + three sub-layers |

No new API keys. No `SUPPORTED_SECRET_KEYS` changes in `main.rs`. No new Tauri capabilities required (all upstream calls go through the sidecar's existing HTTP fetch).

---

## Constraints & Notes

- **Nextstrain data shape is not versioned.** The MLR results JSON schema can change between model runs; the frontend service should defensively access all fields with optional chaining and validate that `data` is an array before iterating.
- **disease.sh coverage.** Some territories return `countryInfo.iso2: null` or `"?"`. Filter these out before choropleth join and dot placement.
- **ReliefWeb `past` status.** Filter to `status !== 'past'` in the frontend service — the API returns up to 20 records sorted by date, which may include resolved events. Only `'alert'` and `'ongoing'` events should appear in the Alerts tab; `'past'` events are discarded.
- **WHO DON extraction.** The DON endpoint response shape may vary (has changed previously). Treat the response as `unknown`, validate it is an array, and use optional chaining on all field accesses. If the `Url` field is present, validate it begins with `https://` before using it in an `<a href>`.
- **Clade palette maintenance.** The `dominant clade → color` mapping will go stale as new variants emerge. Keep the palette in a dedicated `CLADE_COLORS` constant at the top of `disease-intel.ts` so it can be updated without touching rendering logic.
- **Panel deduplication from `disease-outbreaks`.** WHO DON alerts from this panel and WHO alerts from `DiseaseOutbreakPanel` may cover the same events (different endpoint, same source). No cross-panel deduplication is attempted — the two panels serve different purposes (this one: genomic + formal declarations; that one: early warning + ProMED). Users who want a single unified view should use the Alert Center.
- **Globe choropleth performance.** Country-level GeoJSON at 110m resolution is ~200 KB. Ensure it is loaded once and reused across sessions (cache in module scope, not re-fetched per render). If the map already bundles country polygons for another layer, share that reference.
- **Sidecar combined route vs. per-source routes.** A single `/api/disease-intel` route simplifies frontend polling and cache management. If future requirements call for different refresh rates per source (e.g., refresh WHO DON every 10 min independently), split into per-source routes at that point. Premature splitting adds complexity for no current benefit.
