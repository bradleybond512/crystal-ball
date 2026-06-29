# Webcam Coverage & Streaming — Design

**Date:** 2026-06-28
**Status:** Approved design. This document specifies **Phase 1** in detail and sets the roadmap for Phases 2–4.

## Goal

Turn Crystal Ball's webcam features into a reliable, **maximum-coverage, global** situational-awareness surface with **full live streaming**. The owner's directive: *access to the maximum number of free/public webcams worldwide, surfaced for personal and global awareness.*

The effort is **phased** (owner choice: fix the core first, then expand breadth, then streaming, then awareness UX). Keys: **free + cheap keys allowed** (NPS free, Windy ~$5/mo). Each phase is its own spec → plan → build cycle.

## Current state (audit, 2026-06-28)

- **Two working panels:** `LiveWebcamsPanel` (27 hardcoded YouTube geopolitical streams) and `UnifiedWebcamPanel` (aggregates 9 sources via `/api/webcams` with search / filter / favorites / offline-detection / smoke-detection), plus a 3D globe layer `webcam-globe-layer.ts`.
- **Heavily US-centric:** 8 of 9 sources are US-only (FAA airports, DOT511 traffic, AlertWildfire, NPS, USGS volcano/stream, NOAA coastal). The **only** global source is **Windy — which needs a paid key**; without `WINDY_WEBCAMS_API_KEY` the global catalog silently returns nothing.
- **`USFS` source is dead** — present in the `WebcamSource` enum, never implemented.
- **Hardcoded stale catalogs:** volcano (`volcano-cam-catalog.ts`), stream (`streamgauge-adapter.ts`), coastal (`noaa-coastal-catalog.ts`) are fixed ~2024 lists; URLs rot.
- **Silent key/source failure:** missing NPS/Windy/NSW/UK/ROAD511 keys → empty feed, no UI signal.
- **YouTube IDs rot:** 27 hardcoded video IDs ("validated Feb 2026").
- **No live video** except YouTube/Windy embeds — all other sources are refreshing snapshots.
- **Pinning removed:** the orphaned `PinnedWebcamsPanel` (pinned Windy cams, no entry point) was deleted in #1314; the owner wants it restored, re-wired to pin **any** cam.

## Roadmap (decomposition)

| Phase | Theme | Outcome |
|-------|-------|---------|
| **1 (this spec)** | Solidify the core | Existing system reliable; uniform adapter registry; health never silent; pinning restored. |
| 2 | Global breadth | 20+ sources, tens of thousands of cams (Windy full, USFS, DOT/511 → all states + Canada, EU/RWIS, ports/maritime, curated YouTube-live registry, generic public-HLS/snapshot loader). |
| 3 | Full live streaming | `hls.js` playback + on-demand sidecar RTSP/MJPEG→HLS relay + MJPEG; CSP `media-src`/relay-origin updates; snapshot fallback. |
| 4 | Awareness UX | Smoke/motion detection beyond AlertWildfire; map/globe clustering at scale; "cams near my saved places / near a live event" wired into the situation layer. |

## Architecture (established in Phase 1)

### 1. Source-adapter registry

Replace the bespoke per-source wiring with one contract so adding the many Phase-2 sources is uniform and the aggregator can report health consistently.

```ts
interface WebcamSourceAdapter {
  id: WebcamSource;
  scope: 'global' | 'us' | 'region';
  needsKey: boolean;          // true → can report 'missing_key'
  /** Fetch feeds, optionally area-bounded; throws on failure (caught by the aggregator). */
  fetch(opts: { bbox?: BBox; signal?: AbortSignal }): Promise<WebcamFeed[]>;
}
```

The sidecar's `/api/webcams` route iterates the registry, runs every adapter in parallel (existing behaviour), and now also derives **per-source health** from each adapter's outcome. Existing sources are wrapped to the contract incrementally — no big-bang rewrite of their internals.

### 2. Health model (no silent fail)

```ts
type SourceStatus = 'ok' | 'missing_key' | 'down' | 'rate_limited' | 'empty';
interface WebcamSourceHealth {
  source: WebcamSource;
  status: SourceStatus;
  count: number;            // feeds contributed
  needsKey: boolean;
  error?: string;
  lastChecked: number;
}
```

`/api/webcams` returns `{ feeds, bySource, sourceHealth: WebcamSourceHealth[], lastUpdated }`. `UnifiedWebcamPanel` renders a compact **source-health strip**; a `missing_key` source shows a one-line "Add `WINDY_WEBCAMS_API_KEY` in Settings → API Keys" call-to-action instead of vanishing.

### 3. Feed type extensions (forward-compatible with Phase 3)

`WebcamFeed` gains optional streaming fields now (populated later):

```ts
streamUrl?: string;
streamType?: 'hls' | 'mjpeg' | 'youtube' | 'embed' | 'snapshot';
```

### 4. Pinning (restored, any source)

A `pinned-webcams` store keyed by feed `id` (not Windy-specific), persisted in localStorage, plus a re-wired panel that has a **real entry point**: a "Pin" action on any cam card in `UnifiedWebcamPanel` (and the globe popup), and a `panel:pinned-webcams` command + `PANEL_CATEGORY_MAP` entry so it's toggleable. The panel renders the pinned feeds using each feed's existing `snapshotUrl`/embed.

## Phase 1 deliverables

1. **Adapter registry contract** (`webcam-source-registry`) + route existing sources through it; aggregator collects `WebcamSourceHealth`.
2. **Implement `USFS`** — a real adapter (USFS fire/recreation public cams) replacing the dead enum entry, registered + wired into `/api/webcams`.
3. **De-stale the hardcoded catalogs** — volcano / stream / coastal: pull from a live API where one exists; otherwise validate the catalog at fetch time (drop dead URLs, log) and expand it. No more silently-rotten lists.
4. **Per-source health surfacing** — the health model above, end-to-end: sidecar → `fetcher` → `UnifiedWebcamPanel` status strip + missing-key CTA.
5. **Offline-probe backoff** — exponential backoff + jitter + a cap on the HEAD-probe loop; stop hammering rate-limited hosts.
6. **YouTube live registry** — move the 27 hardcoded IDs into a maintained registry module with a per-channel validation/health check; surface dead channels instead of showing a black box. (Bulk expansion is Phase 2.)
7. **Globe-layer filter fix** — the hardcoded `[fire, volcano, coastal]` salience filter drops ~66% of cams; make it configurable / off by default at high zoom.
8. **Restore pinning** — the store + re-wired panel + entry points described above.
9. **Source-health diagnostic** — a webcam-sources probe added to the diagnostics self-test (`standardSelfTestDefinitions`) so a degraded source shows up in System Diagnostics.

## Data flow

```
adapters (registry) ──▶ /api/webcams (sidecar: parallel fetch + dedup + health)
   │                        │  { feeds, bySource, sourceHealth, lastUpdated }
   ▼                        ▼
WebcamSourceHealth      fetcher.ts ──▶ UnifiedWebcamPanel (grid/list/map + health strip + pin)
                                   └─▶ webcam-globe-layer (3D pins, fixed filter)
pinned-store ──▶ PinnedWebcamsPanel (any-source pinboard)
```

## Error handling

- **Per-source isolation:** one adapter throwing never blanks the others (already true via parallel + try/catch); now it also produces a `down`/`error` health row.
- **Missing key:** `missing_key` status + CTA, not an empty grid.
- **Probe storms:** exponential backoff prevents rate-limit cascades.
- **Catalog rot:** dead URLs are dropped at fetch and reported, not shown as broken images.

## Testing

Fixture-based unit tests (no live fetch), consistent with the repo's existing webcam tests:

- registry: every registered adapter has a unique id + valid scope; aggregator derives correct `sourceHealth` from mixed outcomes (ok / throw / empty / missing-key).
- USFS adapter: parses a sample response → `WebcamFeed[]` with correct category/coords.
- health derivation: missing-key adapter → `missing_key`; throwing adapter → `down`; zero feeds → `empty`.
- dedup + sort: unchanged behaviour preserved.
- pinning store: pin/unpin/reorder/persist round-trips for a non-Windy feed.
- catalog validation: a catalog with a known-bad URL is filtered.

## Out of scope (Phase 2+)

- New global sources beyond USFS (Windy-full, EU/RWIS, ports, maritime, bulk YouTube) — Phase 2.
- HLS playback + the RTSP/MJPEG→HLS relay + CSP `media-src` changes — Phase 3.
- Smoke/motion detection expansion, map clustering, cams-near-me/event situation wiring — Phase 4.

## Feasibility to confirm during planning

- Which of volcano/stream/coastal have a **live public API** vs need a curated-but-validated list.
- `USFS` public cam endpoint/pattern (recreation.gov / USFS region feeds) and whether it's keyless.
- (Phase 3 pre-check) ffmpeg availability for the relay — bundle vs system-detect vs degrade-to-snapshot.
