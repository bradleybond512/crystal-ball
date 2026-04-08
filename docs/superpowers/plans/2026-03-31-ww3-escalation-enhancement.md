# WW3 Escalation Enhancement — Implementation Plan

**Date:** 2026-03-31
**Status:** In Progress

## Problem

Crystal Ball has strong raw-event coverage (ACLED, UCDP, GDELT, Telegram OSINT, theater posture) but gaps in:

1. **Authoritative conflict analysis** — events without expert interpretation
2. **Multi-government consensus signals** — no single-country advisory has the weight of 3 govts simultaneously upgrading a warning
3. **Nuclear test detection** — USGS alone covers one sensor network; CTBTO is not public
4. **Official military/diplomatic signaling** — NATO, Pentagon press releases indicate posture shifts before events occur

## Sources to Integrate (all free, no API keys)

### Phase 1 — Conflict Analysis Layer

| Source | Endpoint | Value |
|---|---|---|
| ISW (Inst. for the Study of War) | `https://www.understandingwar.org/feed` (RSS) | Daily situation reports — gold standard for Ukraine/Russia, Gaza, Sudan |
| ReliefWeb (UN OCHA) | `https://api.reliefweb.int/v1/reports` (JSON REST) | All active conflict situation reports, UN-authoritative |
| Bellingcat | `https://www.bellingcat.com/feed/` (RSS) | Covert military movement OSINT, equipment losses, war crimes |

### Phase 2 — Nuclear Test Detection

| Source | Endpoint | Value |
|---|---|---|
| EMSC Seismic | `https://www.seismicportal.eu/fdsnws/event/1/query` (JSON) | Independent European sensor network; cross-reference at known test sites |

**Test site proximity logic** (implemented in sidecar):

- Punggye-ri, NK: 41.27°N, 129.08°E — 50km radius
- Novaya Zemlya, RU: 73.4°N, 54.9°E — 100km radius
- Lop Nor, CN: 41.0°N, 88.4°E — 50km radius
- Nevada Test Site: 37.1°N, 116.0°W — 50km radius

Any M≥4.0 event within these radii at depth ≤20km flagged as `suspectedNuclearTest: true`.

### Phase 3 — Multi-Government Consensus Signal

| Source | Endpoint | Value |
|---|---|---|
| UK FCDO | `https://www.gov.uk/foreign-travel-advice.atom` | Level 1-4 travel warnings for all countries |
| Australia DFAT | `https://www.smartraveller.gov.au/rss` | Australian travel warnings |
| Canada GAC | `https://travel.gc.ca/travelling/advisories.atom` | Canadian travel warnings |

**Convergence logic**: When 2+ governments have warnings for the same country that changed within 7 days, emit a `govConsensusAlert` with escalation delta.

### Phase 4 — Official Military & Diplomatic Feeds

| Source | Endpoint | Value |
|---|---|---|
| US DoD News | `https://www.defense.gov/News/RSS/` | Pentagon press releases — deployments, exercises, posture shifts |
| NATO Newsroom | `https://www.nato.int/cps/en/natohq/news.htm?selectedLocale=en` (RSS) | Article 4/5 language, force posture, new commitments |
| ACAPS Crisis Index | `https://www.acaps.org/api/crises/` (JSON) | Quantified humanitarian crisis severity by country |
| LiveUAMap | `https://liveuamap.com/rss` (RSS) | Near-real-time Ukraine frontline OSINT |

## New Runtime Features (all default: true, no keys required)

```
iswSituationReports — ISW daily conflict analysis
reliefwebCrises — UN OCHA ReliefWeb situation reports
bellingcatOsint — Bellingcat OSINT investigations
emscSeismic — EMSC seismic + nuclear test proximity
fcdoTravelWarnings — UK FCDO travel warning levels
dfatTravelWarnings — Australia DFAT travel warnings
gacTravelWarnings — Canada GAC travel warnings
govWarningConvergence — Multi-government consensus signal
dodNewsRss — US Department of Defense news
natoNewsRss — NATO Newsroom press releases
acapsCrisisSeverity — ACAPS humanitarian crisis index
liveUaMapFeed — LiveUAMap Ukraine frontline OSINT
```

## New Sidecar Routes

```
/api/isw-reports — RSS parse, 30-min cache
/api/reliefweb-crises — JSON REST, 2-hr cache
/api/bellingcat — RSS parse, 30-min cache
/api/emsc-seismic — FDSN JSON, 10-min cache + test-site proximity
/api/fcdo-warnings — Atom parse, 60-min cache
/api/dfat-warnings — RSS parse, 60-min cache
/api/gac-warnings — Atom parse, 60-min cache
/api/gov-convergence — Derived from above three, 30-min cache
/api/dod-news — RSS parse, 30-min cache
/api/nato-news — RSS parse, 30-min cache
/api/acaps-crises — JSON REST, 4-hr cache
/api/liveuamap — RSS parse, 10-min cache
```

## New Panels (12)

```
isw-reports — ISW Situation Reports
reliefweb-crises — UN OCHA Crisis Reports
bellingcat-osint — Bellingcat OSINT
emsc-seismic — Nuclear Test Watch (EMSC)
fcdo-warnings — UK FCDO Warnings
dfat-warnings — Australia DFAT Warnings
gac-warnings — Canada GAC Warnings
gov-warning-convergence — Multi-Gov Consensus Alert
dod-news — Pentagon News
nato-news — NATO Press
acaps-crises — ACAPS Crisis Index
liveuamap — Ukraine Frontline (LiveUA)
```

## Settings Categories Update

- Security & Threats: add `govWarningConvergence`, `emscSeismic`
- Add new category "Conflict Analysis": `iswSituationReports`, `reliefwebCrises`, `bellingcatOsint`, `liveUaMapFeed`
- Add new category "Military & Diplomatic": `dodNewsRss`, `natoNewsRss`, `acapsCrisisSeverity`
- Add new category "Travel Warnings": `fcdoTravelWarnings`, `dfatTravelWarnings`, `gacTravelWarnings`
