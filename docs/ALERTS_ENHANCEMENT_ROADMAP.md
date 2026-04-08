# Crystal Ball — Alerts Enhancement Roadmap

> **Created**: 2026-03-31
> **Last updated**: 2026-03-31
> **Branch**: `claude/enhance-alerts-sorting-rYp3l`
> **Status**: Active

---

## Vision

Transform Crystal Ball's fragmented alert panels into a unified, intelligent alert system that surfaces the right information at the right time — sorted by relevance, aware of the user's location, and actionable on first glance.

---

## Current State

### What exists today

- **7+ independent alert panels**: AlertCenter, Hazards, NWS, Tsunami, GDACS, Volcano, OREF
- **Breaking news pipeline**: RSS feeds -> threat classifier -> keyword matching -> `wm:breaking-news` event
- **Proximity alerts**: Wildfires, hazmat, oil spills, air quality (distance-filtered against user home location)
- **Threat classification**: 5-level keyword-based (`critical`/`high`/`medium`/`low`/`info`)
- **Evidence pack system**: Corroboration scoring, source trust tiers, freshness tracking
- **Correlation & signal aggregation**: Regional clustering, convergence zones
- **Native notifications**: macOS banners via Tauri `send_notification` (app must be running)
- **Offline caching**: localStorage snapshots with 4-hour TTL
- **Settings**: Master toggle, sound, sensitivity (`critical-only` / `critical-and-high`)

### Key limitations

- No single view to see all alerts sorted by importance
- Alert history lost on app restart (in-memory only, 100-item cap)
- Proximity filtering only covers 4 hazard types — not earthquakes, weather, conflicts, or news
- No composite relevance score combining severity + distance + freshness + novelty
- No alert grouping — 5 articles about the same hurricane = 5 separate items
- No user-defined rules or per-category thresholds
- No background alerting when app is closed

---

## Roadmap

### Phase 0 — Foundation (P0) `[IN PROGRESS]`

#### 0.1 Unified Alert Inbox

- [ ] Create `UnifiedAlertInboxPanel` that ingests from all alert sources
- [ ] Normalize all alert types into a common `UnifiedAlert` interface:

  ```typescript
  interface UnifiedAlert {
 id: string;
 source: 'breaking-news' | 'nws' | 'gdacs' | 'tsunami' | 'volcano' | 'oref' | 'hazard' | 'correlation' | 'cyber';
 severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
 title: string;
 body: string;
 timestamp: number;
 location?: { lat: number; lon: number; label?: string };
 distanceMi?: number; // populated when user location is set
 relevanceScore?: number; // composite score (Phase 0.2)
 situationId?: string; // group key (Phase 1.2)
 acknowledged: boolean;
 pinned: boolean;
 raw: unknown; // original source object
  }
  ```

- [ ] Sort controls: severity | time | distance | relevance score
- [ ] Filter bar: by source type, severity level, acknowledged/unread
- [ ] Acknowledge (dismiss) and pin (star) individual alerts
- [ ] Badge count for unread alerts in sidebar
- [ ] Keyboard shortcuts: `J/K` navigate, `A` acknowledge, `P` pin, `1-5` filter severity

#### 0.2 Composite Relevance Scoring

- [ ] Create `src/services/relevance-scoring.ts`
- [ ] Score formula: `severity_weight * proximity_weight * freshness_weight * novelty_weight * source_trust_weight`
  - **Severity**: critical=1.0, high=0.8, medium=0.5, low=0.25, info=0.1
  - **Proximity**: 1.0 at 0km, decays to 0.3 at radius limit, 0.2 for no-location alerts
  - **Freshness**: 1.0 at 0min, 0.7 at 1hr, 0.4 at 6hr, 0.2 at 24hr (exponential decay)
  - **Novelty**: 1.0 for first report, 0.5 for 2nd-3rd, 0.3 for 4th+
  - **Source trust**: tier1=1.0, tier2=0.8, tier3=0.6, tier4=0.4
- [ ] Expose `computeRelevanceScore(alert: UnifiedAlert, userLocation?: UserLocation): number`
- [ ] Default sort in unified inbox = relevance score descending
- [ ] Visual indicator: relevance bar or heat dot next to each alert

---

### Phase 1 — Intelligence (P1) `[PLANNED]`

#### 1.1 Cross-Source Proximity Filtering

- [ ] Extend proximity scoring to GDACS earthquakes, NWS weather alerts, OREF sirens, ACLED conflict events, breaking news with coordinates
- [ ] "Near Me" toggle in unified inbox — filters to alerts within user's chosen radius
- [ ] Distance badge on every alert that has coordinates
- [ ] Sort-by-distance option

#### 1.2 Alert Grouping (Situations)

- [ ] Create `src/services/situation-clustering.ts`
- [ ] Group alerts by: geographic proximity (< 100km) + temporal proximity (< 6hr) + category overlap
- [ ] `Situation` interface:

  ```typescript
  interface Situation {
 id: string;
 label: string; // auto-generated: "Hurricane X — Gulf Coast"
 alerts: UnifiedAlert[];
 severity: AlertSeverity; // highest among children
 trend: 'escalating' | 'stable' | 'de-escalating';
 firstSeen: number;
 lastUpdate: number;
  }
  ```

- [ ] Collapsible situation cards in unified inbox
- [ ] Situation summary: "3 NWS warnings + 1 GDACS red + 2 news articles"
- [ ] Mini-timeline showing escalation/de-escalation within a situation

#### 1.3 Alert Persistence (IndexedDB)

- [ ] Create `src/services/alert-store.ts` using existing `crystalball_db`
- [ ] Object store: `unified_alerts` with indexes on `timestamp`, `severity`, `source`, `situationId`
- [ ] Retain alerts for 30 days (configurable)
- [ ] Migrate in-memory buffers (AlertCenterPanel's 100-item array, correlation signal history) to IndexedDB-backed
- [ ] Alert history view: searchable, filterable archive panel
- [ ] Basic trend stats: "12 critical alerts this week (up from 4 last week)"

---

### Phase 2 — Personalization (P2) `[PLANNED]`

#### 2.1 Multi-Location Watchlist

- [ ] `UserLocation[]` array instead of single home location
- [ ] Add/remove watched locations: home, office, family, travel destinations
- [ ] Per-location radius setting
- [ ] Alerts tagged with which watched location they're near
- [ ] Geofences: draw custom zones on the map that trigger alerts for any event inside

#### 2.2 User-Defined Alert Rules

- [ ] Rules engine: condition -> action

  ```
  IF source=gdacs AND severity>=orange AND distance<=500km THEN notify=sound+banner
  IF source=nws AND event_type=tornado AND distance<=100km THEN notify=critical+sound
  IF source=breaking-news AND category=conflict AND region=Middle East THEN notify=badge-only
  ```

- [ ] Rule builder UI in Settings panel
- [ ] Preset rule templates (earthquake watcher, storm chaser, conflict monitor, financial alert)
- [ ] Quiet hours / DND schedule (separate from Ghost Mode)
- [ ] Per-severity delivery preferences: critical=sound+banner, high=banner, medium=badge, low=silent

#### 2.3 Actionable Response Cards

- [ ] Context-specific action checklists per alert category:
  - Earthquake: drop/cover/hold, check gas, aftershock window
  - Hurricane/tornado: shelter locations, evacuation routes
  - Conflict escalation: embassy contacts, travel advisories
  - Financial trigger: portfolio links, market status
  - Cyber threat: IOC details, mitigation steps
- [ ] Share button: system share sheet with alert summary
- [ ] "Track this" button: pin situation and get updates
- [ ] Snooze: "remind me in 1h if still developing"

---

### Phase 3 — Always-On (P3) `[FUTURE]`

#### 3.1 Background Alerting

- [ ] Lightweight background sidecar that polls critical feeds when UI is closed
- [ ] macOS notification center with action buttons (open app, dismiss, snooze)
- [ ] Optional webhook/email digest for critical-only alerts
- [ ] Battery-aware polling: reduce frequency on battery power

#### 3.2 Escalation Tracking

- [ ] Situation lifecycle: emerging -> active -> peak -> de-escalating -> resolved
- [ ] Auto-resolve situations with no new alerts for 12+ hours
- [ ] Escalation notifications: "Hurricane X upgraded from Orange to Red"
- [ ] Post-incident summary generation

---

## Architecture Notes

### Event Flow (Target State)

```
Data Sources (RSS, NWS, GDACS, OREF, ACLED, ...)
 |
 v
  [Data Loader] — fetches raw data per source
 |
 v
  [Alert Normalizer] — converts to UnifiedAlert
 |
 v
  [Relevance Scorer] — computes composite score
 |
 v
  [Situation Clusterer] — groups related alerts
 |
 v
  [Alert Store (IndexedDB)] — persists + deduplicates
 |
 v
  [Rules Engine] — evaluates user-defined rules
 |
 v
  [Notification Dispatcher] — badge, banner, sound, native
 |
 v
  [Unified Inbox UI] — sort, filter, acknowledge, act
```

### Key Design Principles

1. **Backward compatible**: Existing panels keep working; unified inbox is additive
2. **Progressive enhancement**: Each phase builds on the previous
3. **Performance budget**: Relevance scoring must be < 1ms per alert; clustering < 10ms per batch
4. **Offline-first**: IndexedDB store serves as source of truth; network enriches it
5. **No false sense of security**: Alert system must clearly indicate data freshness and source reliability

---

## Progress Log

| Date | Phase | Item | Status | Notes |
|------|-------|------|--------|-------|
| 2026-03-31 | — | Roadmap created | Done | Initial analysis of current system |
| | | | | |

---

*Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>*
