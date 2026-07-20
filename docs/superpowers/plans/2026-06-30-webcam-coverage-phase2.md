# Webcams Phase 2 — Global Breadth (Implementation Plan)

**Date:** 2026-06-30
**Spec:** `docs/superpowers/specs/2026-06-28-webcam-coverage-and-streaming-design.md` (Phase 2 row)
**Status:** Grounded by a 6-domain source-research pass (66 sources surveyed). Phase 1 (health model + USFS + validation + pinning) is shipped in v2.25.144.

## Goal

Add the maximum number of free/public webcams worldwide via a **generic, config-driven loader** so new sources are a config row + a fixture, not bespoke code. Every adapter stays fixture-tested (no live fetch in unit tests), every source gets its **own DataSourceId** (fail-closed — one source's outage can't mask another), and stale/missing data surfaces through the Phase 1 health model.

## Architecture — generic config-driven loader

`src/services/webcams/webcam-config-loader.ts` — a pure extractor driven by one declarative config per source. Modes: `json` (dotted-path field map, optional array fan-out), `arcgis` (`?where=1=1&outFields=*&f=geojson&resultOffset=N` paging, geometry coords), `static` (existing curated-catalog path). The sidecar fetches + caches + HEAD-validates (reuse `validateWebcamCatalog`); the **extractor is unit-tested against saved fixtures**.

```ts
interface WebcamSourceConfig {
  id: WebcamSource;                 // new enum per source/jurisdiction (own DataSourceId)
  mode: 'json' | 'arcgis' | 'static';
  url: string | string[];          // array → fan-out (Caltrans d1–d12, Autobahn roads)
  arrayPath?: string;              // json: dotted path to records array (pickArray fallback)
  arcgis?: { where?: string; pageSize?: number };
  map: {
    id: Getter; name: Getter;
    lat: Getter; lon: Getter;      // string|number; extractor parseFloats; arcgis falls back to geometry.coordinates
    snapshotUrl: Derive<string>;   // pass-through or template fn (presetId/station → URL)
    streamUrl?: Derive<string>;
    streamType?: Derive<WebcamStreamType>;  // .m3u8→hls, multipart→mjpeg, else snapshot
  };
  category: Derive<WebcamCategory>;
  refreshIntervalSec: number;
  onlineWhen?: (row) => boolean;   // !Disabled && !Blocked; inCollection; KML photo age
  headers?: Record<string,string>; // e.g. { 'Digitraffic-User': 'CrystalBall/1.0' }
  snapshotTtlSec?: number;         // token-expiring sources (Windy <600, Singapore <300)
  metadata?: Record<string,string>;// attribution / license tag
}
```

Extend (don't rebuild): `adapters/dot-extended.ts` (`pickArray`/`buildFeed` seed), `volcano-cam-catalog.ts` (static catalogs), `youtube-live-registry.ts` (embeds), `windy-adapter.ts` + sidecar paginator.

## Prioritized source catalog

| # | Source | Cat | Coverage | Key | Mode | ~Cams | Durab. |
|---|--------|-----|----------|-----|------|-------|--------|
| 1 | Caltrans CWWP2 | traffic | CA (d1–d12) | No | json fan-out | 1,800 | high |
| 2 | Autobahn GmbH | traffic | Germany | No | json 2-step | 1,000+ | high |
| 3 | TfL JamCams | traffic | London | No | json 1-GET | 900 | high |
| 4 | ArcGIS-511 (FL/IA/WSDOT…) | traffic | per-state US | No | arcgis | 1–2.5k ea | high |
| 5 | NDBC BuoyCAM (KML) | coastal | US/oceans | No | json→template | 83 | high |
| 6 | Singapore LTA | traffic | Singapore | No | json 1-GET | 90 | high |
| 7 | Finland Digitraffic | weather | Finland | No | geojson+template | 470 | high |
| 8 | GeoNet NZ | volcano | NZ | No | json→template | 11 | high |
| 9 | DriveBC | traffic | BC | No | geojson | 320+ | high |
| 10 | Quebec 511 WFS | traffic | Quebec | No | geojson | 400+ | high |
| 11 | Iteris/511 v2 (ON/AB) | traffic | ON/AB+ | Yes(free) | json | 500+ ea | high |
| 12 | Iteris/511 legacy (NY/GA/AZ/NV/ID/WI/AK/UT) | traffic | ~8 US | Yes(free) | json | 200–2.5k | high |
| 13 | Windy full sweep | global | worldwide | Yes(wired) | rest | 1k/filter | high |
| 14 | WebCOOS | coastal | US coasts | Yes(token) | rest | dozens | high |
| 15 | Sweden Trafikverket | traffic | Sweden | Yes(free) | rest POST-XML | 540 | high |
| 16 | explore.org / Parks Canada | nature | worldwide | No | embed | 150 | high |
| 17 | NPS AirQuality extend | nature | US parks | No | static | 20–100 | high |
| 18 | Norway Vegvesen DATEX-II | traffic | Norway | Yes(reg) | rest XML | 1,000 | high |
| 19 | GeoNet/INGV/JMA/PHIVOLCS | volcano | intl | No | scrape/curate | 15–100 | med |
| 20 | Iceland eruption cams | volcano | Reykjanes | No | embed | 9–13 | med |

**Out of scope (ruled out):** Webcams.travel/WebcamGalore (= Windy), SkylineWebcams/EarthCam/HDOnTap (commercial/embed-gated), Insecam/Shodan (unauthorized — legal/CFAA risk), MassDOT (TrafficLand-licensed), Traffic Scotland (FTP+reg). Windy Pro (9,990 EUR/yr) — never; use direct gov endpoints.

## Batches (value × feasibility)

- **Batch 1 — keyless, fixture-testable, no live network in tests.** Generic loader → Caltrans + Autobahn + TfL (prove json + fan-out) → ArcGIS mode (FL/IA/WSDOT) → Singapore + Finland + GeoNet + BuoyCAM-dynamic → DriveBC + Quebec → explore.org/NPS catalog extensions → Windy full sweep.
- **Batch 2 — keyed/cheap-key.** One Iteris/511 adapter (~8–10 jurisdictions, free self-serve keys, per-jurisdiction `missing_key` health + own DataSourceId) → Trafikverket → WebCOOS (verify media-URL keyless first) → DATEX-II generic parser (Norway → unlocks Wales/NL/BE/AT). New keys go in **both** `main.rs SUPPORTED_SECRET_KEYS` and sidecar `ALLOWED_ENV_KEYS` + 3 exhaustive Records.
- **Batch 3 — streaming (Phase 3 boundary).** hls.js display, sidecar image proxy (`/api/webcams/proxy?url=`, host-allowlist + matching Referer + SSRF-pinned fail-closed), MJPEG passthrough, on-demand ffmpeg RTSP→HLS relay.

## Batch 1 — Phase A (this PR): loader + 3 anchor sources

TDD; fixtures saved from real upstream payloads; pure extractor tested with no live fetch.

- [ ] **Task 1 — types + config contract.** Add `WebcamSourceConfig` + `Getter`/`Derive` to a new `webcam-config-loader.ts`; extend `WebcamSource` enum with `CALTRANS`, `AUTOBAHN`, `TFL` (own DataSourceIds). Additive to `webcam-types.ts`.
- [ ] **Task 2 — pure extractor + dotted-path getter.** `buildFeedsFromConfig(config, payloads): WebcamFeed[]` handling `json` mode + array fan-out + dotted-path get + `parseFloat` coords + `streamType` inference + `onlineWhen`. Unit-test against fixtures.
- [ ] **Task 3 — Caltrans config + fixture + test.** d1–d12 fan-out; `cctv.imageData.static.currentImageURL`→snapshot, `streamingVideoURL`→hls; string coords. Fixture = trimmed real district JSON.
- [ ] **Task 4 — Autobahn config + fixture + test.** 2-step (road list → per-road webcam); pass `imageurl`; skip empty.
- [ ] **Task 5 — TfL JamCams config + fixture + test.** 1 GET; `additionalProperties[imageUrl]`→snapshot.
- [ ] **Task 6 — sidecar wiring.** `/api/webcams/caltrans|autobahn|tfl` handlers call the loader + `validateWebcamCatalog`; register in the `/api/webcams` `subroutes`; `deriveWebcamSourceHealth` already handles new sources (own DataSourceId each).
- [ ] **Task 7 — panel labels + chips.** `SOURCE_LABELS` + source chips for the 3 new sources in `UnifiedWebcamPanel`; globe-layer already shows all categories.
- [ ] **Task 8 — tests wired into `test:webcams` + `test:sidecar`; typecheck + eslint clean.**

## Risks

1. **URL rot** — prefer first-party `.gov` over aggregators; **never hardcode an image host** (read `snapshotUrl` from the response); keep `validateWebcamCatalog` HEAD-drop; own DataSourceId per jurisdiction; periodic freshness probe.
2. **Cam-image hotlink/CORS/token-expiry** (the real blocker, not API CORS) — sidecar image proxy (host-allowlist + matching Referer + SSRF fail-closed); `snapshotTtlSec` below token-expiry for Windy/Singapore; night-dark cams (BuoyCAM) → health treats as expected-empty. **Pull the proxy forward into Batch 1 if any anchor image is hotlink-protected.**
3. **Key cost / sprawl** — all keyed sources are free self-serve; reject Windy Pro; dual-allowlist + `missing_key` health CTA (never hard-fail); manual-registration feeds (DATEX, WebCOOS) are USFS-style one-time steps, not user-typed keys.
