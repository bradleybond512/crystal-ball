# Crystal Ball Enhancement Roadmap (2026-05)

Derived from the gap analysis against "the ultimate command center." Sequenced
so each phase ships independently and the heaviest lift (native mobile) lands
**last**, after the data + intelligence foundation is complete.

## Sequencing principle

Most gaps are **"scaffolding exists, wiring doesn't"** — not greenfield. We
ship in waves of increasing cost and decreasing certainty:

1. **Quick wins** — small, high-impact, mostly closing facade panels with real data.
2. **Synthesis wiring** — turn reactive panels into proactive cross-domain chains.
3. **Strategic data builds** — the medium/large new feeds.
4. **Data-quality hardening** — redundancy + freshness so single-source-stale can't mislead.
5. **UX depth** — offline, history, export, per-watchlist thresholds.
6. **Native mobile (LAST)** — biggest UX multiplier, heaviest lift, depends on everything above being solid.

Each line item = one PR unless noted. Complexity: S / M / L / XL. Every PR
follows the house pattern: pure-deterministic core + adapters, ≥1 test suite,
`typecheck:all` clean, cross-agent marker, auto-merge.

---

## Phase 1 — Quick wins (S, high impact)

| # | PR | What | Source | Cx |
|---|----|------|--------|----|
| 1.1 | GOES live imagery | Real imagery behind the `goes-satellite` facade panel | `cdn.star.nesdis.noaa.gov` GeoColor/IR/WV sequences | S |
| 1.2 | NEO / asteroid tracker | New panel + service for close-approach + Sentry risk | NASA NeoWs (no key) + JPL CNEOS Sentry | S |
| 1.3 | WHO DON ingest | Structured Disease Outbreak News parser | WHO DON RSS | S |
| 1.4 | ProMED full ingest | Full mailing-list posts, not keyword RSS | `promedmail.org/feed` | S |
| 1.5 | NWS NDFD gridded forecast | Predictive grids (temp/precip/wind) for saved-places | `api.weather.gov/gridpoints` | S |
| 1.6 | CDC respiratory surveillance | FluView + COVID-Net + RSV-Net | CDC Open Data API | S |
| 1.7 | NWS HeatRisk | #1 weather killer, currently unsurfaced | NWS HeatRisk experimental | S |
| 1.8 | SDN→AIS auto-rule | New OFAC SDN entry lights matching MMSI red | existing OFAC + AIS | S |
| 1.9 | Calibration audit | Sweep predictive panels for missing `recordEvaluation` | internal | S/M |
| 1.10 | Briefing-export everywhere | Export button on base `Panel`, not one panel | internal | S |
| 1.11 | EAGLE-I outages | County-level federated outage time series | ORNL EAGLE-I | S |

---

## Phase 2 — Cross-domain synthesis wiring (M/L, very high impact)

Turns reactive panels into proactive chains. Each is one producer-wiring PR
against the existing `correlation-engine` / `signal-watch` / `threat-aggregator`
scaffolding.

| # | Chain | Pieces (all exist) | Cx |
|---|-------|--------------------|----|
| 2.1 | Earthquake → tsunami → coastal evac | `tsunami-reasoner` → `evacuation` | S |
| 2.2 | Wildfire → smoke → AQI → hospital surge | wildfires + openaq + hospital refs | M |
| 2.3 | CME / X-flare → grid impact → outage forecast | space-weather → power-grid → predictive index | M |
| 2.4 | Drought → fire load → grid load → econ stress | drought-monitor → wildfire-risk → econ | L |
| 2.5 | GDELT tone + ACLED density → escalation forecast | both ingested → `escalation-forecast` | M |
| 2.6 | Confidence calibration loop live on all producers | algorithm-accuracy stack already built | M |
| 2.7 | 24h "what changed" digest across all 200 panels | `what-changed` + `notification-digest` | S |

---

## Phase 3 — Strategic data builds (M/L, high impact)

| # | PR | What | Source | Cx |
|---|----|------|--------|----|
| 3.1 | USGS ShakeMap raster | Intensity contours on globe (not just magnitude) | USGS ShakeMap GeoJSON | M |
| 3.2 | Hospital capacity / ICU | Per-state surge metric | HHS Protect / state ESSENCE | M |
| 3.3 | Power-outage live map | Globe layer + cascade producer | EAGLE-I or curated 50-state | L |
| 3.4 | Copernicus EMS | Global rapid-mapping activations + Sentinel-2 | Copernicus EMS public API | M |
| 3.5 | Tornado TVS / debris signature | Radar-derived "on the ground" evidence | NEXRAD L3 TVS via NOAA THREDDS | L |
| 3.6 | Dark-web leak-site intel | Clearnet-indexed Tor leak sites only | Ahmia + MISP/CIRCL feeds | L |
| 3.7 | Election integrity (seasonal) | Machine-by-county + state SoS during windows | EAC + Verified Voting | L |
| 3.8 | Heat/cold mortality risk | CDC heat-vuln index + NWS HeatRisk overlay | CDC + NWS | S |

---

## Phase 4 — Data-quality hardening (M)

| # | PR | What | Cx |
|---|----|------|----|
| 4.1 | Provider redundancy: finance | FRED → Finnhub → FMP fallback chain | M |
| 4.2 | Provider redundancy: geopolitics | Fusion + degradation for the 1-file dir | M |
| 4.3 | Provider redundancy: wildfires | Confirm 4 panels get the same fire; add per-panel diagnostic | M |
| 4.4 | Climate panel honesty | Back the `climate-superpower` panel with a real feed or demote it | S |
| 4.5 | OSINT auth audit | Telegram/Reddit: official API vs fragile scraping | M |

---

## Phase 5 — UX depth (M/L)

| # | PR | What | Cx |
|---|----|------|----|
| 5.1 | Genuine offline mode | Workbox tile cache + IndexedDB last-24h sidecar cache + "stale: N min" badge | M |
| 5.2 | Per-watchlist threshold matrix | `{watchlist × domain × threshold}` editable per place | M |
| 5.3 | Embedded history scrubber | Timeline sub-control on each domain panel, not standalone | L |
| 5.4 | Cross-platform push | Apple Push + FCM + ntfy.sh delivery channels | M |
| 5.5 | macOS menu-bar quickview | Ambient awareness without opening the app | M |
| 5.6 | Voice query in | On-device Whisper → context-aware brief | M |

---

## Phase 6 — Native mobile (LAST, XL)

The biggest UX multiplier and the heaviest lift. Deliberately last: it depends
on a solid data + intelligence foundation and a hosted-sidecar story. Spans
weeks; ~6 PRs.

| # | PR | What | Cx |
|---|----|------|----|
| 6.1 | Tauri 2 mobile targets | iOS + Android build config; sidecar runs hosted or via background fetch | XL |
| 6.2 | APNs / FCM push pipeline | Critical-alert entitlement (Apple review-gated) | XL |
| 6.3 | Offline-first mobile cache | Reuse Phase 5.1 cache layer on device | L |
| 6.4 | iOS Live Activity / Lock Screen widget | Ambient awareness without opening app (Swift bridge) | L |
| 6.5 | Mobile-native layout pass | Touch-first re-layout of the 200-panel system | L |
| 6.6 | Hosted sidecar tier | The backend mobile depends on; auth + rate limiting | XL |

---

## Moonshots (deferred — after calibration is trusted)

- Counterfactual causality engine (replay + lifecycle already built)
- Multi-user war-room mode (read-only shared links; needs server state + auth)
- On-demand Sentinel-2 satellite change detection
- Real-time voice agent for hands-free brief

---

## Execution notes

- Phases 1–4 can run as parallel streams; 5 depends on nothing but is lower
  urgency; **6 is gated on 1–5 being solid.**
- Calibration (2.6) is a prerequisite for any moonshot — counterfactuals lie
  if the underlying scores aren't honest.
- Every new feed gets a provider-redundancy entry in the same PR (don't accrue
  Phase 4 debt while building Phases 1–3).
