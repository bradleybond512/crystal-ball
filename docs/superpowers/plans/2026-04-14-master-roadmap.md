# Crystal Ball Master Roadmap — April 2026

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge 3 in-flight feature branches, audit the codebase for performance and security issues, begin the correlation engine v3 upgrade, then build and install on macOS.

**Architecture:** Five sequential workstreams. WS1-2 merge existing work. WS3 audits the merged codebase. WS4 begins the correlation engine upgrade (Phase 1 of 6 from the design doc). WS5 builds and installs.

**Tech Stack:** TypeScript, Vite, Tauri 2, DeckGL, Node.js sidecar, Node built-in test runner, Playwright

---

## Workstream 1: Merge Feature Branches

These branches are clean against `origin/main`. No merge conflicts detected. TypeScript passes on all branches.

### Task 1.1: Merge Map Icons Overhaul

**Files:** 20 files changed, 3404 insertions — includes DeckGLMap.ts refactor, military-patterns.ts, military-surge.ts, ripe-atlas.ts, cached-theater-posture.ts, sidecar endpoints, panel wiring

- [ ] **Step 1: Create PR for map-icons-overhaul**

```bash
git push origin claude/map-icons-overhaul
gh pr create --base main --head claude/map-icons-overhaul \
  --title "feat: map icons overhaul + military intel + RIPE Atlas" \
  --body "Replaces 15 dot layers with Canvas 2D sprite sheets. Adds fighter jet icons with operator colors. Includes military intelligence enhancement (conflict patterns, theater posture, multi-theater coordination) and RIPE Atlas internet connectivity measurements."
```

- [ ] **Step 2: Merge the PR**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 3: Update local main**

```bash
git checkout main
git pull origin main
```

### Task 1.2: Merge High-Impact Data Sources

**Files:** 3 files changed, 37 insertions — data-loader.ts World Bank wiring + test

- [ ] **Step 1: Rebase onto updated main**

```bash
git checkout claude/high-impact-data-sources
git rebase origin/main
```

If `tests/data-sources-wiring.test.mjs` conflicts (both branches create it), combine both test suites — keep the RIPE Atlas tests from main and the World Bank tests from this branch.

- [ ] **Step 2: Run tests to verify**

```bash
npm run test:data
npm run typecheck:all
```

- [ ] **Step 3: Push and create PR**

```bash
git push origin claude/high-impact-data-sources --force-with-lease
gh pr create --base main --head claude/high-impact-data-sources \
  --title "feat: wire World Bank baselines into data-loader" \
  --body "Adds worldBankBaselines to periodic data scheduler. Includes integration test for wiring."
```

- [ ] **Step 4: Merge the PR**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 5: Update local main and clean up**

```bash
git checkout main
git pull origin main
git branch -d claude/multi-theater-coordination
git branch -d claude/ripe-atlas-integration
git branch -d claude/performance-overhaul
git branch -d claude/map-icons-overhaul
git branch -d claude/high-impact-data-sources
```

---

## Workstream 2: Performance & Security Audit

Audit the merged codebase on a fresh branch. Focus on real issues, not style.

### Task 2.1: Create Audit Branch

- [ ] **Step 1: Branch from updated main**

```bash
git fetch origin
git checkout -b claude/perf-security-audit origin/main
```

### Task 2.2: Security Audit

**Scope:** OWASP Top 10 for desktop/web apps, CSP posture, sidecar attack surface, secret handling, IPC safety

**Files to audit (priority order):**
- `src-tauri/sidecar/local-api-server.mjs` — HTTP proxy, CORS, auth, input validation
- `src-tauri/src/main.rs` — keychain access, IPC handlers, secret key validation
- `src-tauri/capabilities/default.json` — Tauri permission allowlist
- `src/services/runtime-config.ts` — API key handling in frontend
- `src/App.ts` — CSP meta tag, eval usage
- `src/services/intel-pipeline.ts` — external data ingestion
- `src/services/threat-synthesis.ts` — LLM prompt injection surface
- `src/workers/analysis.worker.ts` — worker message handling

- [ ] **Step 1: Run automated secret scan**

```bash
npm run secrets:scan
```

- [ ] **Step 2: Audit sidecar for injection, SSRF, auth bypass**

Read `src-tauri/sidecar/local-api-server.mjs` and check:
- Are all proxy endpoints validating/sanitizing URL parameters?
- Is bearer auth enforced on all routes?
- Can a malicious page reach the sidecar (CORS origin check)?
- Are there any open redirects or SSRF vectors?

- [ ] **Step 3: Audit Tauri IPC surface**

Read `src-tauri/capabilities/default.json` and `src-tauri/src/main.rs`:
- Are capabilities minimal (principle of least privilege)?
- Are IPC command handlers validating input?
- Is keychain access properly scoped?

- [ ] **Step 4: Audit LLM prompt construction**

Read `src/services/threat-synthesis.ts` and any file calling Claude Agent:
- Is user-controlled data interpolated into prompts without sanitization?
- Can external alert titles/bodies inject prompt instructions?

- [ ] **Step 5: Fix all findings, commit**

```bash
git add <specific files>
git commit -m "security: fix audit findings

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 2.3: Performance Audit

**Scope:** Frontend rendering, data loader efficiency, memory leaks, sidecar response times

**Files to audit (priority order):**
- `src/components/DeckGLMap.ts` — layer count, update frequency, sprite sheet size
- `src/app/data-loader.ts` — polling intervals, concurrent requests, deduplication
- `src/app/refresh-scheduler.ts` — ghost multiplier, timer management
- `src/services/alert-correlator.ts` — O(n²) correlation checks, cache pruning
- `src/services/anomaly-baselines.ts` — ring buffer sizing, memory footprint
- `src/services/situation-engine.ts` — reassessment interval, max situation count
- `src/workers/analysis.worker.ts` — message throughput, blocking operations
- `src-tauri/sidecar/local-api-server.mjs` — response caching, connection pooling

- [ ] **Step 1: Profile alert correlator hotpath**

Check `alert-correlator.ts` for:
- How many alerts are compared per cycle? (500 max store × 44 rules = potential O(22K) checks)
- Is haversine computed redundantly?
- Are expired alerts pruned before correlation?

- [ ] **Step 2: Profile data-loader concurrency**

Check `data-loader.ts` for:
- Are all API calls running concurrently or serialized?
- Is there request deduplication for overlapping schedules?
- Are failed requests retried with backoff?

- [ ] **Step 3: Check for memory leaks**

Grep for patterns:
- `addEventListener` without corresponding `removeEventListener`
- `setInterval` without `clearInterval`
- Growing arrays/maps without size limits
- Closures capturing large objects

- [ ] **Step 4: Fix all findings, commit**

```bash
git add <specific files>
git commit -m "perf: fix audit findings

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 2.4: Run Full Test Suite

- [ ] **Step 1: Run all tests**

```bash
npm run typecheck:all
npm run test:data
npm run secrets:scan
```

Expected: All pass with zero errors.

- [ ] **Step 2: Push and create PR**

```bash
git push origin claude/perf-security-audit
gh pr create --base main --head claude/perf-security-audit \
  --title "fix: performance and security audit" \
  --body "Comprehensive audit of merged codebase. Fixes security findings (sidecar, IPC, prompt injection surface) and performance issues (correlator hotpath, memory leaks, data loader concurrency)."
```

- [ ] **Step 3: Merge**

```bash
gh pr merge --squash --delete-branch
git checkout main
git pull origin main
```

---

## Workstream 3: Correlation Engine v3 — Phase 1 (Foundation)

Phase 1 from the design doc: unified event schema, controlled event taxonomy, normalized timestamps/locations.

### Task 3.1: Create Branch

- [ ] **Step 1: Branch from updated main**

```bash
git fetch origin
git checkout -b claude/correlation-engine-v3-phase1 origin/main
```

### Task 3.2: Define Unified Event Schema

**Files:**
- Create: `src/types/correlation-engine.ts`
- Test: `tests/correlation-engine-schema.test.mts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/correlation-engine-schema.test.mts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  type NormalizedEvent,
  type CanonicalEntity,
  type CorrelationResult,
  type CorrelationAlert,
  EVENT_TAXONOMY,
  SEVERITY_BUCKETS,
  normalizeTimestamp,
  normalizeLocation,
} from '../src/types/correlation-engine.ts';

describe('NormalizedEvent schema', () => {
  it('EVENT_TAXONOMY contains all required event types', () => {
    const required = [
      'conflict', 'protest', 'riot', 'military_activity',
      'cyber_incident', 'internet_disruption', 'weather_disaster',
      'earthquake', 'economic_shock', 'sanctions_action',
      'shipping_disruption', 'aviation_anomaly', 'outbreak',
      'humanitarian_update', 'displacement', 'food_insecurity',
      'energy_disruption', 'wildfire', 'flooding',
    ];
    for (const t of required) {
      assert.ok(EVENT_TAXONOMY.includes(t), `Missing taxonomy entry: ${t}`);
    }
  });

  it('normalizeTimestamp returns UTC ISO string and precision', () => {
    const result = normalizeTimestamp('2026-04-14T14:00:00Z');
    assert.equal(result.utc, '2026-04-14T14:00:00.000Z');
    assert.equal(result.precision, 'exact');
  });

  it('normalizeTimestamp handles day-only precision', () => {
    const result = normalizeTimestamp('2026-04-14');
    assert.ok(result.utc.startsWith('2026-04-14'));
    assert.equal(result.precision, 'day');
  });

  it('normalizeLocation returns lat/lon/country/confidence', () => {
    const result = normalizeLocation({ lat: 12.34, lon: 56.78, country: 'Somalia' });
    assert.equal(result.lat, 12.34);
    assert.equal(result.lon, 56.78);
    assert.equal(result.country, 'Somalia');
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });

  it('SEVERITY_BUCKETS maps score ranges to labels', () => {
    assert.equal(SEVERITY_BUCKETS(10), 'low');
    assert.equal(SEVERITY_BUCKETS(35), 'moderate');
    assert.equal(SEVERITY_BUCKETS(55), 'notable');
    assert.equal(SEVERITY_BUCKETS(75), 'high');
    assert.equal(SEVERITY_BUCKETS(95), 'critical');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/correlation-engine-schema.test.mts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/types/correlation-engine.ts

// --- Controlled Event Taxonomy ---
export const EVENT_TAXONOMY = [
  'conflict', 'protest', 'riot', 'military_activity',
  'cyber_incident', 'internet_disruption', 'weather_disaster',
  'earthquake', 'economic_shock', 'sanctions_action',
  'shipping_disruption', 'aviation_anomaly', 'outbreak',
  'humanitarian_update', 'displacement', 'food_insecurity',
  'energy_disruption', 'wildfire', 'flooding',
] as const;

export type EventType = typeof EVENT_TAXONOMY[number];

// --- Timestamp normalization ---
export type TimestampPrecision = 'exact' | 'hour' | 'day' | 'approximate';

export interface NormalizedTimestamp {
  utc: string;            // ISO 8601 UTC
  sourceOriginal: string; // as received
  precision: TimestampPrecision;
}

export function normalizeTimestamp(raw: string): NormalizedTimestamp {
  const d = new Date(raw);
  const hasTime = raw.includes('T') || raw.includes(' ');
  const hasMinutes = /\d{2}:\d{2}/.test(raw);
  let precision: TimestampPrecision = 'approximate';
  if (hasTime && hasMinutes) precision = 'exact';
  else if (hasTime) precision = 'hour';
  else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) precision = 'day';

  return {
    utc: d.toISOString(),
    sourceOriginal: raw,
    precision,
  };
}

// --- Location normalization ---
export interface NormalizedLocation {
  lat: number;
  lon: number;
  country: string;
  region?: string;
  admin1?: string;
  sourceLabel?: string;
  confidence: number; // 0–1
}

export function normalizeLocation(input: {
  lat?: number;
  lon?: number;
  country?: string;
  region?: string;
  admin1?: string;
  label?: string;
}): NormalizedLocation {
  const hasCoords = input.lat != null && input.lon != null;
  return {
    lat: input.lat ?? 0,
    lon: input.lon ?? 0,
    country: input.country ?? 'Unknown',
    region: input.region,
    admin1: input.admin1,
    sourceLabel: input.label,
    confidence: hasCoords && input.country ? 0.95
      : hasCoords ? 0.8
      : input.country ? 0.4
      : 0.1,
  };
}

// --- Severity buckets ---
export function SEVERITY_BUCKETS(score: number): string {
  if (score <= 20) return 'low';
  if (score <= 40) return 'moderate';
  if (score <= 60) return 'notable';
  if (score <= 80) return 'high';
  return 'critical';
}

// --- Core schemas ---
export interface NormalizedEvent {
  id: string;
  source: string;
  sourceEventId?: string;
  eventType: EventType;
  subtype?: string;
  title: string;
  summary?: string;
  timestamp: NormalizedTimestamp;
  location: NormalizedLocation;
  entities: string[];            // canonical entity IDs
  domains: string[];             // e.g. ['conflict', 'economic']
  severityScore: number;         // 0–100
  confidenceScore: number;       // 0–100
  rawTags: string[];
  metadata: Record<string, unknown>;
}

export interface CanonicalEntity {
  id: string;
  entityType: 'person' | 'company' | 'vessel' | 'aircraft' | 'port' | 'airport'
    | 'government' | 'armed_group' | 'infrastructure' | 'country' | 'region' | 'city' | 'facility' | 'media';
  name: string;
  aliases: string[];
  country?: string;
  sanctionsStatus?: 'clear' | 'watchlist' | 'sanctioned';
  identifiers: Record<string, string>; // imo, mmsi, icao, etc.
  relationships: EntityRelationship[];
}

export interface EntityRelationship {
  type: 'owned_by' | 'subsidiary_of' | 'allied_with' | 'operates_in' | 'linked_to';
  targetId: string;
  confidence: number;
}

export interface CorrelationResult {
  id: string;
  eventIds: string[];
  correlationType: string;
  timeWindowHours: number;
  geoRadiusKm: number;
  score: number;           // 0–100
  confidence: number;      // 0–100
  explanation: string;
  signals: string[];
}

export interface CorrelationAlert {
  id: string;
  title: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  alertType: string;
  relatedCorrelationId: string;
  riskScore: number;
  confidence: number;
  createdAt: string;
  recommendedAttentionWindow: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test tests/correlation-engine-schema.test.mts
```
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/correlation-engine.ts tests/correlation-engine-schema.test.mts
git commit -m "feat(correlation): add unified event schema + controlled taxonomy

Phase 1 of correlation engine v3 upgrade. Defines NormalizedEvent,
CanonicalEntity, CorrelationResult, CorrelationAlert types. Adds
EVENT_TAXONOMY, normalizeTimestamp, normalizeLocation, SEVERITY_BUCKETS.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 3.3: Add Source-to-Taxonomy Mapping

**Files:**
- Create: `src/services/event-taxonomy-mapper.ts`
- Test: `tests/event-taxonomy-mapper.test.mts`

This maps the 23 existing `AlertSource` values to the controlled `EventType` taxonomy.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/event-taxonomy-mapper.test.mts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapSourceToEventType, mapRawTagsToEventType } from '../src/services/event-taxonomy-mapper.ts';

describe('event-taxonomy-mapper', () => {
  it('maps known alert sources to event types', () => {
    assert.equal(mapSourceToEventType('nws', 'Tornado Warning'), 'weather_disaster');
    assert.equal(mapSourceToEventType('gdacs', 'Earthquake M6.5'), 'earthquake');
    assert.equal(mapSourceToEventType('acled', 'Armed clash'), 'conflict');
    assert.equal(mapSourceToEventType('cyber', 'DDoS attack'), 'cyber_incident');
  });

  it('uses title keywords when source is ambiguous', () => {
    assert.equal(mapSourceToEventType('breaking-news', 'Massive protest in capital'), 'protest');
    assert.equal(mapSourceToEventType('breaking-news', 'Oil prices surge 8%'), 'economic_shock');
    assert.equal(mapSourceToEventType('breaking-news', 'Wildfire spreads across region'), 'wildfire');
  });

  it('returns closest match for unknown sources', () => {
    const result = mapSourceToEventType('unknown-feed', 'Something happened');
    assert.ok(result, 'Should return a fallback event type');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/event-taxonomy-mapper.test.mts
```

- [ ] **Step 3: Write the implementation**

```typescript
// src/services/event-taxonomy-mapper.ts
import type { EventType } from '../types/correlation-engine.ts';

const SOURCE_DEFAULT_MAP: Record<string, EventType> = {
  nws: 'weather_disaster',
  gdacs: 'earthquake',
  tsunami: 'earthquake',
  acled: 'conflict',
  cyber: 'cyber_incident',
  'ripe-atlas': 'internet_disruption',
  cloudflare: 'internet_disruption',
  ais: 'shipping_disruption',
  aviation: 'aviation_anomaly',
  'power-grid': 'energy_disruption',
  reliefweb: 'humanitarian_update',
  fewsnet: 'food_insecurity',
  'world-bank': 'economic_shock',
  sanctions: 'sanctions_action',
  military: 'military_activity',
};

const KEYWORD_RULES: Array<{ pattern: RegExp; type: EventType }> = [
  { pattern: /protest|demonstrat|march|rally/i, type: 'protest' },
  { pattern: /riot|looting|mob/i, type: 'riot' },
  { pattern: /wildfire|bush ?fire|forest fire/i, type: 'wildfire' },
  { pattern: /flood|inundat/i, type: 'flooding' },
  { pattern: /earthquake|seismic|quake/i, type: 'earthquake' },
  { pattern: /outbreak|epidemic|pandemic|disease/i, type: 'outbreak' },
  { pattern: /displac|refugee|migrat|evacuati/i, type: 'displacement' },
  { pattern: /sanction|embargo/i, type: 'sanctions_action' },
  { pattern: /oil|currency|inflation|GDP|recession|stock|price surge/i, type: 'economic_shock' },
  { pattern: /cyber|DDoS|hack|breach|ransomware/i, type: 'cyber_incident' },
  { pattern: /internet|outage|connectivity|BGP/i, type: 'internet_disruption' },
  { pattern: /military|troops|airstrike|missile|drone strike/i, type: 'military_activity' },
  { pattern: /conflict|clash|fighting|combat|war/i, type: 'conflict' },
  { pattern: /tornado|hurricane|cyclone|typhoon|storm/i, type: 'weather_disaster' },
  { pattern: /famine|food|hunger|crop/i, type: 'food_insecurity' },
  { pattern: /power|grid|blackout|energy/i, type: 'energy_disruption' },
  { pattern: /ship|port|vessel|maritime/i, type: 'shipping_disruption' },
  { pattern: /flight|aviation|aircraft|airspace/i, type: 'aviation_anomaly' },
];

export function mapSourceToEventType(source: string, title: string): EventType {
  // Try keyword rules first (more specific)
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(title)) return rule.type;
  }
  // Fall back to source default
  return SOURCE_DEFAULT_MAP[source] ?? 'conflict';
}

export function mapRawTagsToEventType(tags: string[]): EventType | null {
  const joined = tags.join(' ');
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(joined)) return rule.type;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test tests/event-taxonomy-mapper.test.mts
```

- [ ] **Step 5: Commit**

```bash
git add src/services/event-taxonomy-mapper.ts tests/event-taxonomy-mapper.test.mts
git commit -m "feat(correlation): add source-to-taxonomy mapper

Maps 23 AlertSource values to controlled EventType taxonomy using
source defaults + keyword-based title analysis for ambiguous sources.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 3.4: Bridge Existing UnifiedAlert to NormalizedEvent

**Files:**
- Create: `src/services/alert-to-event-bridge.ts`
- Test: `tests/alert-to-event-bridge.test.mts`

This bridges the existing `UnifiedAlert` type into the new `NormalizedEvent` schema so the v3 engine can consume existing alert data without breaking anything.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/alert-to-event-bridge.test.mts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedAlertToNormalizedEvent } from '../src/services/alert-to-event-bridge.ts';
import type { EventType } from '../src/types/correlation-engine.ts';

describe('alert-to-event-bridge', () => {
  const mockAlert = {
    id: 'test-1',
    source: 'nws' as const,
    severity: 'high' as const,
    title: 'Tornado Warning for Dallas County',
    body: 'Take shelter immediately.',
    timestamp: Date.parse('2026-04-14T15:00:00Z'),
    location: { lat: 32.78, lon: -96.80, label: 'Dallas, TX' },
    relevanceScore: 0.85,
    acknowledged: false,
    pinned: false,
  };

  it('converts UnifiedAlert to NormalizedEvent', () => {
    const event = unifiedAlertToNormalizedEvent(mockAlert);
    assert.equal(event.id, 'test-1');
    assert.equal(event.source, 'nws');
    assert.equal(event.eventType, 'weather_disaster' satisfies EventType);
    assert.equal(event.title, 'Tornado Warning for Dallas County');
    assert.equal(event.location.lat, 32.78);
    assert.ok(event.timestamp.utc.includes('2026-04-14'));
    assert.ok(event.severityScore >= 0 && event.severityScore <= 100);
    assert.ok(event.confidenceScore >= 0 && event.confidenceScore <= 100);
  });

  it('maps severity strings to numeric scores', () => {
    const event = unifiedAlertToNormalizedEvent(mockAlert);
    assert.equal(event.severityScore, 80); // 'high' → 80

    const lowAlert = { ...mockAlert, severity: 'low' as const };
    assert.equal(unifiedAlertToNormalizedEvent(lowAlert).severityScore, 20);
  });

  it('handles alerts without location gracefully', () => {
    const noLoc = { ...mockAlert, location: undefined };
    const event = unifiedAlertToNormalizedEvent(noLoc);
    assert.equal(event.location.confidence, 0.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/alert-to-event-bridge.test.mts
```

- [ ] **Step 3: Write the implementation**

```typescript
// src/services/alert-to-event-bridge.ts
import type { NormalizedEvent } from '../types/correlation-engine.ts';
import { normalizeTimestamp, normalizeLocation } from '../types/correlation-engine.ts';
import { mapSourceToEventType } from './event-taxonomy-mapper.ts';

const SEVERITY_SCORE_MAP: Record<string, number> = {
  critical: 100,
  high: 80,
  medium: 50,
  low: 20,
  info: 5,
};

export function unifiedAlertToNormalizedEvent(alert: {
  id: string;
  source: string;
  severity: string;
  title: string;
  body: string;
  timestamp: number;
  location?: { lat: number; lon: number; label?: string };
  relevanceScore: number;
  [key: string]: unknown;
}): NormalizedEvent {
  return {
    id: alert.id,
    source: alert.source,
    eventType: mapSourceToEventType(alert.source, alert.title),
    title: alert.title,
    summary: alert.body,
    timestamp: normalizeTimestamp(new Date(alert.timestamp).toISOString()),
    location: normalizeLocation({
      lat: alert.location?.lat,
      lon: alert.location?.lon,
      label: alert.location?.label,
    }),
    entities: [],
    domains: [mapSourceToEventType(alert.source, alert.title).split('_')[0]],
    severityScore: SEVERITY_SCORE_MAP[alert.severity] ?? 30,
    confidenceScore: Math.round(alert.relevanceScore * 100),
    rawTags: [],
    metadata: {},
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test tests/alert-to-event-bridge.test.mts
```

- [ ] **Step 5: Run full type check**

```bash
npm run typecheck:all
```

- [ ] **Step 6: Commit**

```bash
git add src/services/alert-to-event-bridge.ts tests/alert-to-event-bridge.test.mts
git commit -m "feat(correlation): bridge UnifiedAlert to NormalizedEvent

Converts existing alert data into the v3 normalized event schema.
Maps severity strings to 0-100 scores, normalizes timestamps and
locations, assigns event types via taxonomy mapper.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Task 3.5: Push Phase 1 and Create PR

- [ ] **Step 1: Run full test suite**

```bash
npm run typecheck:all
npm run test:data
npm run secrets:scan
```

- [ ] **Step 2: Push and create PR**

```bash
git push origin claude/correlation-engine-v3-phase1
gh pr create --base main --head claude/correlation-engine-v3-phase1 \
  --title "feat(correlation): v3 Phase 1 — unified event schema + taxonomy" \
  --body "First phase of correlation engine v3 upgrade (design doc: ~/Documents/crystal_ball_correlation_engine_howto.md).

Adds:
- Unified NormalizedEvent, CanonicalEntity, CorrelationResult, CorrelationAlert types
- Controlled event taxonomy (19 event types)
- Timestamp and location normalization with precision/confidence
- Source-to-taxonomy mapper (keyword + source heuristics)
- Bridge from existing UnifiedAlert to NormalizedEvent

Next: Phase 2 (temporal/spatial correlation windows, scoring upgrades)"
```

- [ ] **Step 3: Merge**

```bash
gh pr merge --squash --delete-branch
git checkout main
git pull origin main
```

---

## Workstream 4: Build & Install

### Task 4.1: Full Production Build

- [ ] **Step 1: Final checks**

```bash
npm run typecheck:all
npm run test:data
npm run secrets:scan
```

- [ ] **Step 2: Build**

```bash
npm run desktop:build:full
```

Expected: Build completes, producing `src-tauri/target/release/bundle/macos/Crystal Ball.app`

### Task 4.2: Install on Mac

- [ ] **Step 1: Install using the canonical script**

```bash
node scripts/install-built-app.mjs --relaunch
```

This copies to `~/Applications/Crystal Ball.app` and relaunches.

- [ ] **Step 2: Verify app launches and key features work**

Confirm:
- App launches from ~/Applications
- Map renders with new sprite sheet icons
- Military intel layers visible
- RIPE Atlas data loading
- World Bank baselines loading
- Correlation alerts still firing
- Ghost mode still works (Cmd+Shift+G)

---

## Workstream 5: Correlation Engine v3 — Phases 2-6 (Future)

These are tracked here for continuity but are separate implementation plans.

### Phase 2: Core Correlation Upgrades
- Configurable temporal windows (5min to 30 days per event class)
- Spatial clustering with configurable radii
- Hotspot detection and spillover analysis
- Improved severity/confidence scoring with explainability traces

### Phase 3: Entity Intelligence
- NER-based entity extraction from alert titles/bodies
- Canonical entity registry with alias resolution
- Entity graph with confidence-weighted relationships
- Identifier-based matching (IMO, MMSI, ICAO)

### Phase 4: Cross-Domain Logic
- Rule engine with declarative rule definitions (replace 44 hardcoded rules)
- Risk scoring per country/region/entity (weighted heuristic, 0-100)
- Time-decay functions so scores don't stay permanently hot
- Multi-signal correlated alerts

### Phase 5: Advanced Detection
- Multivariate anomaly detection (correlated source spikes)
- Causal chain builder with sequence templates
- Prediction layer with conservative confidence language
- Analyst feedback loop (confirm/reject/annotate)

### Phase 6: Refinement
- Historical replay mode
- Weight tuning from feedback data
- False-positive reduction
- Narrative generation improvements

---

## Stash Cleanup

After all merges complete, clean up the 5 stashes:

```bash
git stash drop stash@{4}
git stash drop stash@{3}
git stash drop stash@{2}
git stash drop stash@{1}
git stash drop stash@{0}
```

These are all WIP snapshots from the interrupted sessions and their contents are covered by the merged branches.
