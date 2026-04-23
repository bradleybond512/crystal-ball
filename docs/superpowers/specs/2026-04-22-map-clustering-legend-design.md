# 2D Map Clustering + Full Legend — Design Spec

**Date**: 2026-04-22
**Status**: Approved

## Problem

1. Only 3 of ~20 rendered marker layers cluster on the 2D map (techHQs, techEvents, protests). All other layers render every individual marker, making the map noisy at low zoom.
2. The legend only shows 6 items for the geopolitical variant. ~30 layer types render distinct icons with no legend entry.

## Clustering

### Approach

Extend the existing `clusterMarkers()` in `Map.ts` to all marker-heavy layers. Same-layer-only clustering — earthquakes cluster with earthquakes, never with fires.

### Layers to Cluster (13 total, adding 10 new)

**New**: earthquakes, fires, EONET events, nuclear sites, irradiators, bases, economic centers, minerals, AIS disruptions, flight delays, weather alerts, outages

**Existing** (keep): techHQs (remove city groupKey), techEvents (remove location groupKey), protests (remove country groupKey)

**Skip**: spaceports (~20, sparse), ports (~30, sparse), cable advisories (few), military flights/vessels (server-side clustering), waterways (diamond labels), sanctions (polygon fill)

### Cluster Rendering

Reuse existing pattern — circular badge with count, colored to match the layer's primary color. Pixel radius scales with zoom (tighter at high zoom, looser at low zoom), same adaptive pattern already used for techHQs/protests.

### GroupKey Removal

Drop country/city/location groupKey constraints from all existing clustered layers. Clustering becomes purely spatial — if two markers overlap on screen, they cluster regardless of grouping.

## Legend Panel

### Position & Behavior

- Bottom-left corner of the map, above existing controls
- Collapsed state: small "Legend" button
- Expanded state: floating panel ~220px wide, max-height 60vh with overflow scroll
- Remembers state in localStorage (`cb-map-legend-open`)
- Only shows entries for layers currently toggled ON

### Category Groupings

**Geopolitical**: hotspots (high/elevated/monitoring), conflict zones, protests, sanctions, Iran attacks

**Military / Strategic**: bases, nuclear sites, irradiators, military flights, military vessels, dark vessels

**Infrastructure**: undersea cables, cable faults, pipelines, internet outages, AI datacenters, GPS jamming

**Transport**: ports, AIS disruptions, flight delays, strategic waterways

**Natural**: earthquakes, EONET events (storm/fire/volcano etc.), active fires, weather alerts

**Economic**: economic centers, stock exchanges, financial centers, central banks, commodity hubs

**Tech**: tech HQs, startup hubs, cloud regions, accelerators, tech events

**Cyber**: APT groups

### Icon/Label Entries

Each entry shows the actual icon/emoji/shape used on the map paired with a short label. Categories show as small section headers. Empty categories (no active layers in that group) are hidden.

## Files Changed

- `src/components/Map.ts` — Add clustering to 10 more layers in `renderOverlays()`, replace `createLegend()` with collapsible legend panel
- `src/styles/main.css` — New `.map-legend-panel` styles (collapsible, categories, scroll)

## Out of Scope

- DeckGL 3D map and God's Eye clustering (separate components)
- Layer toggle sidebar (stays as-is)
- Layer help popup (stays as-is)
- Map popup click behavior
- New layer types or data sources
