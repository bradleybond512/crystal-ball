# Military Intelligence Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill five gaps in the military intelligence pipeline: multi-theater coordination, historical pattern matching, strike group detection, strike capability auto-alerting, and predictive assessment.

**Architecture:** Three functions added to `military-surge.ts`, two new service files (`military-patterns.ts`, `military-assessment.ts`), `TheaterPostureSummary` type extended with `strikeGroupPresent`, and `data-loader.ts` updated to orchestrate all five in the existing military fetch cycle. All outputs use signal type `'military_surge'` and feed into `situationEngine.observeSignals()`.

**Tech Stack:** TypeScript, existing `runIntel()` for LLM, existing situation engine, existing signal pipeline.

**Spec:** `docs/superpowers/specs/2026-04-14-military-intel-enhancement-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/services/military-patterns.ts` | Create | Historical conflict pattern definitions + matching logic |
| `src/services/military-patterns.test.mts` | Create | Tests for pattern matching |
| `src/services/military-assessment.ts` | Create | Escalation heuristics + LLM strategic assessment |
| `src/services/military-assessment.test.mts` | Create | Tests for escalation scoring |
| `src/services/military-surge.ts` | Modify | Add multi-theater, strike groups, strike readiness detection |
| `src/services/__tests__/military-surge.test.mts` | Create | Tests for new military-surge functions |
| `src/app/data-loader.ts` | Modify | Orchestrate all five new capabilities in fetch cycle |

---

### Task 1: Historical Pattern Matching — Types and Patterns

**Files:**
- Create: `src/services/military-patterns.ts`

- [ ] **Step 1: Create the file with types and pattern definitions**

```typescript
import type { TheaterPostureSummary, SurgeAlert } from './military-surge';
import type { SignalType } from '@/utils/analysis-constants';

// ── Types ──

export interface ConflictPattern {
  id: string;
  name: string;
  description: string;
  signature: {
    minAircraft: number;
    fighterPct: [number, number];
    tankerPct: [number, number];
    transportPct: [number, number];
    requireStrikeCapable: boolean;
    requireAwacs: boolean;
    requireMultiOperator: boolean;
  };
}

export interface PatternMatch {
  patternId: string;
  patternName: string;
  matchScore: number;
  theaterId: string;
  theaterName: string;
  breakdown: Record<string, number>;
}

// ── Pattern Library ──

export const CONFLICT_PATTERNS: ConflictPattern[] = [
  {
    id: 'desert-storm',
    name: 'Coalition Air War',
    description: 'Heavy multi-national force with tanker/AWACS support — mirrors Desert Storm buildup',
    signature: {
      minAircraft: 15,
      fighterPct: [30, 50],
      tankerPct: [10, 25],
      transportPct: [15, 30],
      requireStrikeCapable: true,
      requireAwacs: true,
      requireMultiOperator: true,
    },
  },
  {
    id: 'air-campaign',
    name: 'Air Campaign',
    description: 'Fighter-heavy posture with strike enablers — offensive air operations',
    signature: {
      minAircraft: 10,
      fighterPct: [60, 100],
      tankerPct: [5, 20],
      transportPct: [0, 15],
      requireStrikeCapable: true,
      requireAwacs: true,
      requireMultiOperator: false,
    },
  },
  {
    id: 'airlift-deployment',
    name: 'Airlift/Deployment',
    description: 'Transport-heavy movement — rapid force deployment or evacuation',
    signature: {
      minAircraft: 8,
      fighterPct: [0, 20],
      tankerPct: [0, 15],
      transportPct: [50, 100],
      requireStrikeCapable: false,
      requireAwacs: false,
      requireMultiOperator: false,
    },
  },
  {
    id: 'naval-strike-support',
    name: 'Naval Strike Support',
    description: 'Mixed fighter/tanker posture near maritime theater — carrier group air support',
    signature: {
      minAircraft: 6,
      fighterPct: [30, 50],
      tankerPct: [10, 30],
      transportPct: [0, 20],
      requireStrikeCapable: false,
      requireAwacs: false,
      requireMultiOperator: false,
    },
  },
  {
    id: 'recon-surge',
    name: 'Reconnaissance Surge',
    description: 'ISR-heavy posture — intelligence gathering, not strike',
    signature: {
      minAircraft: 4,
      fighterPct: [0, 20],
      tankerPct: [0, 15],
      transportPct: [0, 20],
      requireStrikeCapable: false,
      requireAwacs: false,
      requireMultiOperator: false,
    },
  },
  {
    id: 'rapid-reaction',
    name: 'Rapid Reaction',
    description: 'Sudden spike from near-zero baseline — emergency response or snap deployment',
    signature: {
      minAircraft: 5,
      fighterPct: [0, 100],
      tankerPct: [0, 100],
      transportPct: [0, 100],
      requireStrikeCapable: false,
      requireAwacs: false,
      requireMultiOperator: false,
    },
  },
];
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS (file compiles, no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/services/military-patterns.ts
git commit -m "feat(mil-intel): add conflict pattern type definitions and library

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Historical Pattern Matching — matchPatterns() Logic

**Files:**
- Modify: `src/services/military-patterns.ts`
- Create: `src/services/__tests__/military-patterns.test.mts`

- [ ] **Step 1: Write tests for matchPatterns()**

Create `src/services/__tests__/military-patterns.test.mts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchPatterns, CONFLICT_PATTERNS } from '../military-patterns.ts';
import type { TheaterPostureSummary } from '../military-surge.ts';

function makePosture(overrides: Partial<TheaterPostureSummary> = {}): TheaterPostureSummary {
  return {
    theaterId: 'iran-theater',
    theaterName: 'Iran Theater',
    shortName: 'IRAN',
    targetNation: 'Iran',
    fighters: 0,
    tankers: 0,
    awacs: 0,
    reconnaissance: 0,
    transport: 0,
    bombers: 0,
    drones: 0,
    totalAircraft: 0,
    destroyers: 0,
    frigates: 0,
    carriers: 0,
    submarines: 0,
    patrol: 0,
    auxiliaryVessels: 0,
    totalVessels: 0,
    byOperator: {},
    postureLevel: 'normal',
    strikeCapable: false,
    strikeGroupPresent: false,
    trend: 'stable',
    changePercent: 0,
    summary: '',
    headline: '',
    centerLat: 27,
    centerLon: 51,
    ...overrides,
  };
}

test('returns empty array when aircraft below minimum', () => {
  const posture = makePosture({ totalAircraft: 2, fighters: 2 });
  const matches = matchPatterns(posture);
  assert.equal(matches.length, 0);
});

test('matches air campaign pattern with fighter-heavy posture', () => {
  const posture = makePosture({
    totalAircraft: 12,
    fighters: 8,
    tankers: 2,
    awacs: 1,
    transport: 1,
    strikeCapable: true,
    byOperator: { usaf: 12 },
  });
  const matches = matchPatterns(posture);
  const airCampaign = matches.find(m => m.patternId === 'air-campaign');
  assert.ok(airCampaign, 'should match air campaign');
  assert.ok(airCampaign.matchScore >= 60, `score ${airCampaign.matchScore} should be >= 60`);
});

test('matches airlift pattern with transport-heavy posture', () => {
  const posture = makePosture({
    totalAircraft: 10,
    transport: 7,
    fighters: 1,
    tankers: 1,
    awacs: 0,
    reconnaissance: 1,
    byOperator: { usaf: 10 },
  });
  const matches = matchPatterns(posture);
  const airlift = matches.find(m => m.patternId === 'airlift-deployment');
  assert.ok(airlift, 'should match airlift/deployment');
  assert.ok(airlift.matchScore >= 60, `score ${airlift.matchScore} should be >= 60`);
});

test('coalition pattern requires multi-operator', () => {
  const posture = makePosture({
    totalAircraft: 16,
    fighters: 6,
    tankers: 3,
    transport: 4,
    awacs: 2,
    reconnaissance: 1,
    strikeCapable: true,
    byOperator: { usaf: 16 },
  });
  const matches = matchPatterns(posture);
  const coalition = matches.find(m => m.patternId === 'desert-storm');
  // Single operator — should not match coalition pattern well
  assert.ok(!coalition || coalition.matchScore < 60, 'single-operator should not match coalition');
});

test('coalition pattern matches with multi-operator', () => {
  const posture = makePosture({
    totalAircraft: 18,
    fighters: 7,
    tankers: 3,
    transport: 5,
    awacs: 2,
    reconnaissance: 1,
    strikeCapable: true,
    byOperator: { usaf: 10, raf: 4, faf: 4 },
  });
  const matches = matchPatterns(posture);
  const coalition = matches.find(m => m.patternId === 'desert-storm');
  assert.ok(coalition, 'multi-operator should match coalition');
  assert.ok(coalition.matchScore >= 60, `score ${coalition.matchScore} should be >= 60`);
});

test('rapid reaction requires high surge multiple', () => {
  const posture = makePosture({
    totalAircraft: 6,
    fighters: 3,
    transport: 3,
    byOperator: { usaf: 6 },
  });
  // Without surges, rapid reaction should not match (no surge data)
  const matches = matchPatterns(posture);
  const rapid = matches.find(m => m.patternId === 'rapid-reaction');
  assert.ok(!rapid || rapid.matchScore < 60, 'no surge data should not match rapid reaction');
});

test('results sorted by score descending', () => {
  const posture = makePosture({
    totalAircraft: 12,
    fighters: 8,
    tankers: 2,
    awacs: 1,
    transport: 1,
    strikeCapable: true,
    byOperator: { usaf: 12 },
  });
  const matches = matchPatterns(posture);
  for (let i = 1; i < matches.length; i++) {
    assert.ok(matches[i - 1]!.matchScore >= matches[i]!.matchScore, 'should be sorted descending');
  }
});

test('CONFLICT_PATTERNS has 6 entries', () => {
  assert.equal(CONFLICT_PATTERNS.length, 6);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/services/__tests__/military-patterns.test.mts`
Expected: FAIL — `matchPatterns` is not yet exported

- [ ] **Step 3: Implement matchPatterns()**

Add to `src/services/military-patterns.ts` after the `CONFLICT_PATTERNS` array:

```typescript
// ── Matching Logic ──

function pctScore(actual: number, range: [number, number]): number {
  const [lo, hi] = range;
  if (actual >= lo && actual <= hi) return 20;
  const dist = actual < lo ? lo - actual : actual - hi;
  return Math.max(0, Math.round(20 - dist * 0.6));
}

export function matchPatterns(
  posture: TheaterPostureSummary,
  surges?: SurgeAlert[],
): PatternMatch[] {
  const total = posture.totalAircraft;
  const results: PatternMatch[] = [];

  for (const pattern of CONFLICT_PATTERNS) {
    if (total < pattern.minAircraft) continue;

    const breakdown: Record<string, number> = {};
    const sig = pattern.signature;

    // Percentage-based scoring (0-20 each, 3 categories = 60 max)
    const fighterPct = total > 0 ? (posture.fighters / total) * 100 : 0;
    const tankerPct = total > 0 ? (posture.tankers / total) * 100 : 0;
    const transportPct = total > 0 ? (posture.transport / total) * 100 : 0;

    breakdown.fighterPct = pctScore(fighterPct, sig.fighterPct);
    breakdown.tankerPct = pctScore(tankerPct, sig.tankerPct);
    breakdown.transportPct = pctScore(transportPct, sig.transportPct);

    // Boolean criteria (10 pts each, 3 categories = 30 max)
    if (sig.requireStrikeCapable) {
      breakdown.strikeCapable = posture.strikeCapable ? 10 : 0;
    } else {
      breakdown.strikeCapable = 10;
    }

    if (sig.requireAwacs) {
      breakdown.awacs = posture.awacs > 0 ? 10 : 0;
    } else {
      breakdown.awacs = 10;
    }

    const operatorCount = Object.keys(posture.byOperator).length;
    if (sig.requireMultiOperator) {
      breakdown.multiOperator = operatorCount >= 2 ? 10 : 0;
    } else {
      breakdown.multiOperator = 10;
    }

    // Rapid reaction bonus: requires surge multiple > 4
    if (pattern.id === 'rapid-reaction') {
      const theaterSurges = surges?.filter(s => s.theater.id === posture.theaterId) ?? [];
      const maxMultiple = theaterSurges.reduce((m, s) => Math.max(m, s.surgeMultiple), 0);
      breakdown.rapidSurge = maxMultiple > 4 ? 10 : 0;
    }

    // Recon surge bonus: recon + AWACS + EW dominance
    if (pattern.id === 'recon-surge') {
      const reconPct = total > 0 ? ((posture.reconnaissance + posture.awacs) / total) * 100 : 0;
      breakdown.reconDominance = reconPct >= 50 ? 10 : Math.round(reconPct / 5);
    }

    // Normalize to 0-100
    const maxPossible = Object.keys(breakdown).length * (Object.keys(breakdown).length <= 6 ? 10 : 20);
    const rawScore = Object.values(breakdown).reduce((a, b) => a + b, 0);
    const normalized = Math.round((rawScore / Math.max(1, maxPossible)) * 100);

    // Recalculate with correct max: 60 (pct) + 30 (bool) + bonus = 90-100
    const totalPoints = breakdown.fighterPct + breakdown.tankerPct + breakdown.transportPct
      + breakdown.strikeCapable + breakdown.awacs + breakdown.multiOperator
      + (breakdown.rapidSurge ?? 0) + (breakdown.reconDominance ?? 0);
    const maxPoints = 60 + 30 + (breakdown.rapidSurge !== undefined ? 10 : 0) + (breakdown.reconDominance !== undefined ? 10 : 0);
    const matchScore = Math.round((totalPoints / maxPoints) * 100);

    if (matchScore >= 60) {
      results.push({
        patternId: pattern.id,
        patternName: pattern.name,
        matchScore,
        theaterId: posture.theaterId,
        theaterName: posture.theaterName,
        breakdown,
      });
    }
  }

  results.sort((a, b) => b.matchScore - a.matchScore);
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/services/__tests__/military-patterns.test.mts`
Expected: PASS — all 8 tests green

- [ ] **Step 5: Add patternMatchToSignal()**

Add to `src/services/military-patterns.ts`:

```typescript
// ── Signal Conversion ──

export function patternMatchToSignal(match: PatternMatch): {
  id: string;
  type: SignalType;
  source: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;
  category: string;
  timestamp: Date;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const severity = match.matchScore >= 90 ? 'critical' as const : 'high' as const;
  const pattern = CONFLICT_PATTERNS.find(p => p.id === match.patternId);
  const description = `${match.theaterName} matches "${match.patternName}" profile at ${match.matchScore}% confidence. ${pattern?.description ?? ''}`;
  const metadata = {
    patternId: match.patternId,
    matchScore: match.matchScore,
    theaterId: match.theaterId,
    breakdown: match.breakdown,
  };

  return {
    id: `pattern-${match.patternId}-${match.theaterId}-${Date.now()}`,
    type: 'military_surge' as SignalType,
    source: 'Military Pattern Analysis',
    title: `${match.theaterName} matches ${match.patternName} pattern (${match.matchScore}%)`,
    description,
    severity,
    confidence: match.matchScore / 100,
    category: 'military',
    timestamp: new Date(),
    data: metadata,
    metadata,
  };
}
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/military-patterns.ts src/services/__tests__/military-patterns.test.mts
git commit -m "feat(mil-intel): implement historical conflict pattern matching

6 patterns (Coalition Air War, Air Campaign, Airlift/Deployment, Naval
Strike Support, Recon Surge, Rapid Reaction) scored against theater
posture. Matches >= 80% emitted as signals.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Add strikeGroupPresent to TheaterPostureSummary

**Files:**
- Modify: `src/services/military-surge.ts`

- [ ] **Step 1: Add the field to TheaterPostureSummary interface**

In `src/services/military-surge.ts`, find the `TheaterPostureSummary` interface and add `strikeGroupPresent` after the `strikeCapable` field:

```typescript
  strikeCapable: boolean;
  strikeGroupPresent: boolean;
  trend: 'increasing' | 'stable' | 'decreasing';
```

- [ ] **Step 2: Initialize the field in getTheaterPostureSummaries()**

Find where `TheaterPostureSummary` objects are constructed in `getTheaterPostureSummaries()` and add `strikeGroupPresent: false` alongside the existing `strikeCapable` assignment.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck:all`
Expected: May show errors in files that construct `TheaterPostureSummary` objects — fix any missing `strikeGroupPresent` field initializations.

- [ ] **Step 4: Commit**

```bash
git add src/services/military-surge.ts
git commit -m "feat(mil-intel): add strikeGroupPresent field to TheaterPostureSummary

Initialized to false; will be set by detectStrikeGroups() in a later task.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Multi-Theater Coordination Detection

**Files:**
- Modify: `src/services/military-surge.ts`
- Create: `src/services/__tests__/military-surge.test.mts`

- [ ] **Step 1: Write tests for detectMultiTheaterCoordination()**

Create `src/services/__tests__/military-surge.test.mts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectMultiTheaterCoordination,
  multiTheaterToSignal,
} from '../military-surge.ts';
import type { SurgeAlert } from '../military-surge.ts';

function makeSurge(overrides: Partial<SurgeAlert> = {}): SurgeAlert {
  return {
    id: 'fighter-iran-theater',
    theater: { id: 'iran-theater', name: 'Iran Theater', baseIds: [], centerLat: 27, centerLon: 51 },
    type: 'fighter',
    currentCount: 10,
    baselineCount: 3,
    surgeMultiple: 3.3,
    aircraftTypes: new Map([['F-15', 6], ['F-16', 4]]),
    nearbyBases: ['Al Udeid'],
    firstDetected: new Date(),
    lastUpdated: new Date(),
    ...overrides,
  };
}

test('returns empty when fewer than 2 theaters', () => {
  const surges = [makeSurge()];
  const result = detectMultiTheaterCoordination(surges);
  assert.equal(result.length, 0);
});

test('detects coordination across 2 theaters within 4h window', () => {
  const now = new Date();
  const surges = [
    makeSurge({ id: 'fighter-iran', theater: { id: 'iran-theater', name: 'Iran Theater', baseIds: [], centerLat: 27, centerLon: 51 }, firstDetected: now }),
    makeSurge({ id: 'fighter-taiwan', theater: { id: 'taiwan-theater', name: 'Taiwan Strait', baseIds: [], centerLat: 24, centerLon: 121 }, firstDetected: new Date(now.getTime() + 60 * 60 * 1000) }),
  ];
  const result = detectMultiTheaterCoordination(surges);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.theaters.length, 2);
  assert.equal(result[0]!.severity, 'critical');
});

test('does not detect coordination outside 4h window', () => {
  const now = new Date();
  const surges = [
    makeSurge({ id: 'fighter-iran', theater: { id: 'iran-theater', name: 'Iran Theater', baseIds: [], centerLat: 27, centerLon: 51 }, firstDetected: now }),
    makeSurge({ id: 'fighter-taiwan', theater: { id: 'taiwan-theater', name: 'Taiwan Strait', baseIds: [], centerLat: 24, centerLon: 121 }, firstDetected: new Date(now.getTime() + 5 * 60 * 60 * 1000) }),
  ];
  const result = detectMultiTheaterCoordination(surges);
  assert.equal(result.length, 0);
});

test('multiTheaterToSignal produces valid signal', () => {
  const now = new Date();
  const surges = [
    makeSurge({ id: 'fighter-iran', theater: { id: 'iran-theater', name: 'Iran Theater', baseIds: [], centerLat: 27, centerLon: 51 }, firstDetected: now }),
    makeSurge({ id: 'fighter-taiwan', theater: { id: 'taiwan-theater', name: 'Taiwan Strait', baseIds: [], centerLat: 24, centerLon: 121 }, firstDetected: now }),
  ];
  const alerts = detectMultiTheaterCoordination(surges);
  assert.equal(alerts.length, 1);
  const signal = multiTheaterToSignal(alerts[0]!);
  assert.equal(signal.type, 'military_surge');
  assert.equal(signal.severity, 'critical');
  assert.equal(signal.category, 'military');
  assert.ok(signal.confidence > 0 && signal.confidence <= 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/services/__tests__/military-surge.test.mts`
Expected: FAIL — functions not yet exported

- [ ] **Step 3: Implement detectMultiTheaterCoordination() and multiTheaterToSignal()**

Add these types and functions to `src/services/military-surge.ts` after the existing `surgeAlertToSignal` function. Also export `MultiTheaterAlert` and `SurgeAlert` types.

```typescript
// ── Multi-Theater Coordination ──

export interface MultiTheaterAlert {
  id: string;
  theaters: Array<{
    theaterId: string;
    theaterName: string;
    surgeType: 'airlift' | 'fighter' | 'reconnaissance';
    surgeMultiple: number;
    aircraftCount: number;
  }>;
  coordinationScore: number;
  description: string;
  severity: 'critical';
  timestamp: Date;
}

const COORDINATION_WINDOW_MS = 4 * 60 * 60 * 1000;
const seenMultiTheaterAlerts = new Set<string>();

const NAMED_COMBOS: Record<string, string> = {
  'iran-theater+taiwan-theater': 'Dual-front posturing: Iran + Taiwan',
  'baltic-theater+blacksea-theater': 'European theater-wide mobilization',
  'iran-theater+east-med-theater+yemen-redsea-theater': 'Middle East theater-wide surge',
  'iran-theater+east-med-theater': 'Eastern Mediterranean / Iran corridor surge',
  'baltic-theater+korea-theater': 'NATO / Pacific dual alert',
};

export function detectMultiTheaterCoordination(surges: SurgeAlert[]): MultiTheaterAlert[] {
  if (surges.length < 2) return [];

  // Group surges by theater
  const byTheater = new Map<string, SurgeAlert>();
  for (const s of surges) {
    const existing = byTheater.get(s.theater.id);
    if (!existing || s.surgeMultiple > existing.surgeMultiple) {
      byTheater.set(s.theater.id, s);
    }
  }

  if (byTheater.size < 2) return [];

  // Check temporal window
  const sorted = [...byTheater.values()].sort(
    (a, b) => a.firstDetected.getTime() - b.firstDetected.getTime(),
  );
  const earliest = sorted[0]!.firstDetected.getTime();
  const latest = sorted[sorted.length - 1]!.firstDetected.getTime();
  if (latest - earliest > COORDINATION_WINDOW_MS) return [];

  // Deduplicate
  const theaterIds = [...byTheater.keys()].sort();
  const dedupeKey = theaterIds.join('+');
  if (seenMultiTheaterAlerts.has(dedupeKey)) return [];
  seenMultiTheaterAlerts.add(dedupeKey);
  setTimeout(() => seenMultiTheaterAlerts.delete(dedupeKey), COORDINATION_WINDOW_MS);

  // Compute coordination score
  let score = 50;
  score += Math.min(20, (theaterIds.length - 2) * 10);
  if (latest - earliest < 60 * 60 * 1000) score += 10;
  const operators = new Set(surges.map(s => {
    const types = [...s.aircraftTypes.keys()];
    return types.join(',');
  }));
  if (operators.size >= 3) score += 10;
  score = Math.min(100, score);

  // Named combo lookup
  const description = NAMED_COMBOS[dedupeKey]
    ?? `Multi-theater coordination: ${sorted.map(s => s.theater.name).join(', ')}`;

  const theaters = sorted.map(s => ({
    theaterId: s.theater.id,
    theaterName: s.theater.name,
    surgeType: s.type,
    surgeMultiple: s.surgeMultiple,
    aircraftCount: s.currentCount,
  }));

  return [{
    id: `multi-theater-${dedupeKey}-${Date.now()}`,
    theaters,
    coordinationScore: score,
    description,
    severity: 'critical' as const,
    timestamp: new Date(),
  }];
}

export function multiTheaterToSignal(alert: MultiTheaterAlert): {
  id: string;
  type: SignalType;
  source: string;
  title: string;
  description: string;
  severity: 'critical';
  confidence: number;
  category: string;
  timestamp: Date;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const theaterDetails = alert.theaters
    .map(t => `${t.theaterName}: ${t.aircraftCount} aircraft (${t.surgeType}, ${t.surgeMultiple.toFixed(1)}x baseline)`)
    .join('; ');

  const metadata = {
    theaters: alert.theaters,
    coordinationScore: alert.coordinationScore,
  };

  return {
    id: alert.id,
    type: 'military_surge' as SignalType,
    source: 'Military Flight Tracking',
    title: alert.description,
    description: `Simultaneous military surges across ${alert.theaters.length} theaters. ${theaterDetails}`,
    severity: 'critical',
    confidence: alert.coordinationScore / 100,
    category: 'military',
    timestamp: alert.timestamp,
    data: metadata,
    metadata,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/services/__tests__/military-surge.test.mts`
Expected: PASS — all 4 tests green

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/military-surge.ts src/services/__tests__/military-surge.test.mts
git commit -m "feat(mil-intel): add multi-theater coordination detection

Detects simultaneous surges across 2+ theaters within a 4-hour window.
Always critical severity. Named combo descriptions for known pairs.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Strike Group Detection

**Files:**
- Modify: `src/services/military-surge.ts`
- Modify: `src/services/__tests__/military-surge.test.mts`

- [ ] **Step 1: Write tests for detectStrikeGroups()**

Append to `src/services/__tests__/military-surge.test.mts`:

```typescript
import type { MilitaryFlight, MilitaryVessel } from '../../types/index.ts';
import {
  detectStrikeGroups,
  strikeGroupToSignal,
} from '../military-surge.ts';

function makeFlight(overrides: Partial<MilitaryFlight> = {}): MilitaryFlight {
  return {
    id: 'f1',
    callsign: 'VIPER01',
    hexCode: 'AE1234',
    aircraftType: 'fighter',
    operator: 'usn',
    operatorCountry: 'USA',
    lat: 25.0,
    lon: 55.0,
    altitude: 25000,
    heading: 90,
    speed: 400,
    onGround: false,
    lastSeen: new Date(),
    confidence: 'high',
    ...overrides,
  };
}

function makeVessel(overrides: Partial<MilitaryVessel> = {}): MilitaryVessel {
  return {
    id: 'v1',
    mmsi: '123456789',
    name: 'USS Nimitz',
    vesselType: 'carrier',
    operator: 'usn',
    operatorCountry: 'USA',
    lat: 25.0,
    lon: 55.0,
    heading: 180,
    speed: 12,
    lastAisUpdate: new Date(),
    confidence: 'high',
    ...overrides,
  };
}

test('detects carrier air patrol when fighters near carrier', () => {
  const carrier = makeVessel({ id: 'cv1', vesselType: 'carrier', lat: 25.0, lon: 55.0 });
  const fighter = makeFlight({ id: 'f1', aircraftType: 'fighter', lat: 25.5, lon: 55.5 });
  const result = detectStrikeGroups([fighter], [carrier]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.formation, 'carrier_air_patrol');
  assert.equal(result[0]!.severity, 'high');
});

test('detects strike_ready when fighters + tankers near carrier', () => {
  const carrier = makeVessel({ id: 'cv1', vesselType: 'carrier', lat: 25.0, lon: 55.0 });
  const fighter = makeFlight({ id: 'f1', aircraftType: 'fighter', lat: 25.5, lon: 55.5 });
  const tanker = makeFlight({ id: 't1', aircraftType: 'tanker', lat: 25.3, lon: 55.3 });
  const result = detectStrikeGroups([fighter, tanker], [carrier]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.formation, 'strike_ready');
  assert.equal(result[0]!.severity, 'critical');
});

test('detects full_c2 with AWACS within 300km', () => {
  const carrier = makeVessel({ id: 'cv1', vesselType: 'carrier', lat: 25.0, lon: 55.0 });
  const fighter = makeFlight({ id: 'f1', aircraftType: 'fighter', lat: 25.5, lon: 55.5 });
  const tanker = makeFlight({ id: 't1', aircraftType: 'tanker', lat: 25.3, lon: 55.3 });
  // AWACS ~200km away
  const awacs = makeFlight({ id: 'a1', aircraftType: 'awacs', lat: 26.8, lon: 55.0 });
  const result = detectStrikeGroups([fighter, tanker, awacs], [carrier]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.formation, 'full_c2');
});

test('returns empty when no capital ships', () => {
  const patrol = makeVessel({ id: 'p1', vesselType: 'patrol', lat: 25.0, lon: 55.0 });
  const fighter = makeFlight({ id: 'f1', aircraftType: 'fighter', lat: 25.0, lon: 55.0 });
  const result = detectStrikeGroups([fighter], [patrol]);
  assert.equal(result.length, 0);
});

test('returns empty when flights too far from vessels', () => {
  const carrier = makeVessel({ id: 'cv1', vesselType: 'carrier', lat: 25.0, lon: 55.0 });
  // Fighter ~500km away
  const fighter = makeFlight({ id: 'f1', aircraftType: 'fighter', lat: 29.0, lon: 55.0 });
  const result = detectStrikeGroups([fighter], [carrier]);
  assert.equal(result.length, 0);
});

test('strikeGroupToSignal produces valid signal', () => {
  const carrier = makeVessel({ id: 'cv1', vesselType: 'carrier', lat: 25.0, lon: 55.0 });
  const fighter = makeFlight({ id: 'f1', aircraftType: 'fighter', lat: 25.5, lon: 55.5 });
  const alerts = detectStrikeGroups([fighter], [carrier]);
  assert.equal(alerts.length, 1);
  const signal = strikeGroupToSignal(alerts[0]!);
  assert.equal(signal.type, 'military_surge');
  assert.ok(signal.confidence >= 0.8);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/services/__tests__/military-surge.test.mts`
Expected: FAIL — `detectStrikeGroups` not exported

- [ ] **Step 3: Implement detectStrikeGroups() and strikeGroupToSignal()**

Add to `src/services/military-surge.ts`. Needs to import `MilitaryVessel` from `@/types`:

Update the import at the top:
```typescript
import type { MilitaryFlight, MilitaryVessel, MilitaryOperator } from '@/types';
```

Add after the multi-theater code:

```typescript
// ── Strike Group Detection ──

export interface StrikeGroupAlert {
  id: string;
  vessels: Array<{ id: string; name: string; vesselType: string; lat: number; lon: number }>;
  flights: Array<{ id: string; callsign: string; aircraftType: string; operator: string }>;
  centerLat: number;
  centerLon: number;
  formation: 'carrier_air_patrol' | 'strike_ready' | 'full_c2';
  theaterId: string | null;
  severity: 'high' | 'critical';
  timestamp: Date;
}

const CAPITAL_SHIP_TYPES = new Set(['carrier', 'destroyer', 'amphibious']);
const FLIGHT_RADIUS_KM = 150;
const AWACS_RADIUS_KM = 300;
const seenStrikeGroupAlerts = new Set<string>();

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findTheaterForPosition(lat: number, lon: number): string | null {
  for (const theater of POSTURE_THEATERS) {
    if (lat <= theater.bounds.north && lat >= theater.bounds.south &&
        lon <= theater.bounds.east && lon >= theater.bounds.west) {
      return theater.id;
    }
  }
  return null;
}

export function detectStrikeGroups(
  flights: MilitaryFlight[],
  vessels: MilitaryVessel[],
): StrikeGroupAlert[] {
  const capitalShips = vessels.filter(v => CAPITAL_SHIP_TYPES.has(v.vesselType));
  if (capitalShips.length === 0) return [];

  const alerts: StrikeGroupAlert[] = [];

  for (const ship of capitalShips) {
    // Find nearby flights
    const nearbyFighters: MilitaryFlight[] = [];
    const nearbyTankers: MilitaryFlight[] = [];
    let nearbyAwacs: MilitaryFlight[] = [];

    for (const flight of flights) {
      const dist = haversineKm(ship.lat, ship.lon, flight.lat, flight.lon);
      if (dist <= FLIGHT_RADIUS_KM) {
        if (flight.aircraftType === 'fighter' || flight.aircraftType === 'bomber') nearbyFighters.push(flight);
        if (flight.aircraftType === 'tanker') nearbyTankers.push(flight);
        if (flight.aircraftType === 'awacs') nearbyAwacs.push(flight);
      } else if (dist <= AWACS_RADIUS_KM && flight.aircraftType === 'awacs') {
        nearbyAwacs.push(flight);
      }
    }

    if (nearbyFighters.length === 0) continue;

    // Classify formation
    let formation: StrikeGroupAlert['formation'];
    let severity: 'high' | 'critical';

    if (nearbyFighters.length > 0 && nearbyTankers.length > 0 && nearbyAwacs.length > 0) {
      formation = 'full_c2';
      severity = 'critical';
    } else if (nearbyFighters.length > 0 && nearbyTankers.length > 0) {
      formation = 'strike_ready';
      severity = 'critical';
    } else {
      formation = 'carrier_air_patrol';
      severity = 'high';
    }

    // Deduplicate
    const dedupeKey = `sg-${ship.id}`;
    if (seenStrikeGroupAlerts.has(dedupeKey)) continue;
    seenStrikeGroupAlerts.add(dedupeKey);
    setTimeout(() => seenStrikeGroupAlerts.delete(dedupeKey), 2 * 60 * 60 * 1000);

    const allFlights = [...nearbyFighters, ...nearbyTankers, ...nearbyAwacs];

    alerts.push({
      id: `strike-group-${ship.id}-${Date.now()}`,
      vessels: [{ id: ship.id, name: ship.name, vesselType: ship.vesselType, lat: ship.lat, lon: ship.lon }],
      flights: allFlights.map(f => ({ id: f.id, callsign: f.callsign, aircraftType: f.aircraftType, operator: f.operator })),
      centerLat: ship.lat,
      centerLon: ship.lon,
      formation,
      theaterId: findTheaterForPosition(ship.lat, ship.lon),
      severity,
      timestamp: new Date(),
    });
  }

  return alerts;
}

export function strikeGroupToSignal(alert: StrikeGroupAlert): {
  id: string;
  type: SignalType;
  source: string;
  title: string;
  description: string;
  severity: 'high' | 'critical';
  confidence: number;
  category: string;
  timestamp: Date;
  location: { lat: number; lon: number; name: string };
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const formationLabels: Record<string, string> = {
    carrier_air_patrol: 'Carrier Air Patrol',
    strike_ready: 'Strike-Ready Formation',
    full_c2: 'Full C2 Strike Package',
  };
  const vesselNames = alert.vessels.map(v => v.name).join(', ');
  const flightSummary = alert.flights.map(f => `${f.callsign} (${f.aircraftType})`).join(', ');

  const metadata = {
    formation: alert.formation,
    vesselCount: alert.vessels.length,
    flightCount: alert.flights.length,
    theaterId: alert.theaterId,
    vessels: alert.vessels,
    flights: alert.flights,
  };

  return {
    id: alert.id,
    type: 'military_surge' as SignalType,
    source: 'Military Flight Tracking',
    title: `Strike group: ${formationLabels[alert.formation]} near ${vesselNames}`,
    description: `${alert.vessels.length} capital ship(s) with ${alert.flights.length} aircraft in proximity. Vessels: ${vesselNames}. Aircraft: ${flightSummary}`,
    severity: alert.severity,
    confidence: 0.85,
    category: 'military',
    timestamp: alert.timestamp,
    location: { lat: alert.centerLat, lon: alert.centerLon, name: vesselNames },
    data: metadata,
    metadata,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/services/__tests__/military-surge.test.mts`
Expected: PASS — all strike group tests green

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/military-surge.ts src/services/__tests__/military-surge.test.mts
git commit -m "feat(mil-intel): add strike group detection (flight-to-vessel coordination)

Detects carrier air patrol, strike-ready, and full C2 formations by
cross-referencing military flights within 150-300km of capital ships.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Strike Capability Auto-Alerting

**Files:**
- Modify: `src/services/military-surge.ts`
- Modify: `src/services/__tests__/military-surge.test.mts`

- [ ] **Step 1: Write tests for detectStrikeReadiness()**

Append to `src/services/__tests__/military-surge.test.mts`:

```typescript
import {
  detectStrikeReadiness,
  strikeReadinessToSignal,
  resetStrikeReadinessState,
} from '../military-surge.ts';
import type { TheaterPostureSummary } from '../military-surge.ts';

function makePostureSummary(overrides: Partial<TheaterPostureSummary> = {}): TheaterPostureSummary {
  return {
    theaterId: 'iran-theater',
    theaterName: 'Iran Theater',
    shortName: 'IRAN',
    targetNation: 'Iran',
    fighters: 6,
    tankers: 2,
    awacs: 1,
    reconnaissance: 0,
    transport: 1,
    bombers: 0,
    drones: 0,
    totalAircraft: 10,
    destroyers: 0,
    frigates: 0,
    carriers: 0,
    submarines: 0,
    patrol: 0,
    auxiliaryVessels: 0,
    totalVessels: 0,
    byOperator: { usaf: 10 },
    postureLevel: 'elevated',
    strikeCapable: true,
    strikeGroupPresent: false,
    trend: 'increasing',
    changePercent: 30,
    summary: '',
    headline: '',
    centerLat: 27,
    centerLon: 51,
    ...overrides,
  };
}

test('detects became_capable transition', () => {
  resetStrikeReadinessState();
  const postures = [makePostureSummary({ strikeCapable: true, postureLevel: 'elevated' })];
  const result = detectStrikeReadiness(postures, new Map());
  assert.equal(result.length, 1);
  assert.equal(result[0]!.transition, 'became_capable');
  assert.equal(result[0]!.severity, 'critical');
});

test('detects sustained capability on second call', () => {
  resetStrikeReadinessState();
  const postures = [makePostureSummary({ strikeCapable: true, postureLevel: 'elevated' })];
  detectStrikeReadiness(postures, new Map()); // first call — became_capable
  const result = detectStrikeReadiness(postures, new Map()); // second call — sustained
  assert.equal(result.length, 1);
  assert.equal(result[0]!.transition, 'sustained');
  assert.equal(result[0]!.severity, 'high');
});

test('skips normal posture level', () => {
  resetStrikeReadinessState();
  const postures = [makePostureSummary({ strikeCapable: true, postureLevel: 'normal' })];
  const result = detectStrikeReadiness(postures, new Map());
  assert.equal(result.length, 0);
});

test('skips non-strike-capable', () => {
  resetStrikeReadinessState();
  const postures = [makePostureSummary({ strikeCapable: false, postureLevel: 'elevated' })];
  const result = detectStrikeReadiness(postures, new Map());
  assert.equal(result.length, 0);
});

test('strikeReadinessToSignal produces valid signal', () => {
  resetStrikeReadinessState();
  const postures = [makePostureSummary({ strikeCapable: true, postureLevel: 'critical' })];
  const alerts = detectStrikeReadiness(postures, new Map());
  const signal = strikeReadinessToSignal(alerts[0]!);
  assert.equal(signal.type, 'military_surge');
  assert.equal(signal.severity, 'critical');
  assert.ok(signal.title.includes('ACTIVATED'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/services/__tests__/military-surge.test.mts`
Expected: FAIL — functions not yet exported

- [ ] **Step 3: Implement detectStrikeReadiness(), strikeReadinessToSignal(), and resetStrikeReadinessState()**

Add to `src/services/military-surge.ts`:

```typescript
// ── Strike Capability Auto-Alerting ──

import type { PatternMatch } from './military-patterns';

export interface StrikeReadinessAlert {
  id: string;
  theaterId: string;
  theaterName: string;
  transition: 'became_capable' | 'sustained' | 'lost_capability';
  postureLevel: 'elevated' | 'critical';
  assets: { tankers: number; awacs: number; fighters: number };
  thresholds: { minTankers: number; minAwacs: number; minFighters: number };
  patternMatch: PatternMatch | null;
  strikeGroupPresent: boolean;
  severity: 'critical' | 'high' | 'medium';
  timestamp: Date;
}

const previousStrikeState = new Map<string, boolean>();

export function resetStrikeReadinessState(): void {
  previousStrikeState.clear();
}

export function detectStrikeReadiness(
  postures: TheaterPostureSummary[],
  patterns: Map<string, PatternMatch[]>,
): StrikeReadinessAlert[] {
  const alerts: StrikeReadinessAlert[] = [];

  for (const posture of postures) {
    if (posture.postureLevel === 'normal') continue;

    const wasCapable = previousStrikeState.get(posture.theaterId) ?? false;
    const isCapable = posture.strikeCapable;

    previousStrikeState.set(posture.theaterId, isCapable);

    if (!isCapable) continue;

    const theater = POSTURE_THEATERS.find(t => t.id === posture.theaterId);
    const thresholds = theater?.strikeIndicators ?? { minTankers: 1, minAwacs: 1, minFighters: 3 };

    const transition = wasCapable ? 'sustained' as const : 'became_capable' as const;
    const severity = transition === 'became_capable' ? 'critical' as const : 'high' as const;

    const theaterPatterns = patterns.get(posture.theaterId) ?? [];
    const bestPattern = theaterPatterns.length > 0 ? theaterPatterns[0]! : null;

    alerts.push({
      id: `strike-readiness-${posture.theaterId}-${Date.now()}`,
      theaterId: posture.theaterId,
      theaterName: posture.theaterName,
      transition,
      postureLevel: posture.postureLevel as 'elevated' | 'critical',
      assets: { tankers: posture.tankers, awacs: posture.awacs, fighters: posture.fighters },
      thresholds,
      patternMatch: bestPattern,
      strikeGroupPresent: posture.strikeGroupPresent,
      severity,
      timestamp: new Date(),
    });
  }

  return alerts;
}

export function strikeReadinessToSignal(alert: StrikeReadinessAlert): {
  id: string;
  type: SignalType;
  source: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium';
  confidence: number;
  category: string;
  timestamp: Date;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const confidenceMap = { became_capable: 0.9, sustained: 0.8, lost_capability: 0.7 };
  const transitionLabel = alert.transition === 'became_capable' ? 'ACTIVATED' : alert.transition === 'sustained' ? 'SUSTAINED' : 'LOST';

  let title = `${alert.theaterName}: strike capability ${transitionLabel}`;
  if (alert.patternMatch && alert.patternMatch.matchScore >= 60) {
    title += ` \u2014 matches ${alert.patternMatch.patternName} (${alert.patternMatch.matchScore}%)`;
  }

  const assetDesc = `${alert.assets.fighters} fighters, ${alert.assets.tankers} tankers, ${alert.assets.awacs} AWACS (thresholds: ${alert.thresholds.minFighters}/${alert.thresholds.minTankers}/${alert.thresholds.minAwacs})`;

  const metadata = {
    theaterId: alert.theaterId,
    transition: alert.transition,
    postureLevel: alert.postureLevel,
    assets: alert.assets,
    thresholds: alert.thresholds,
    patternMatch: alert.patternMatch ? { id: alert.patternMatch.patternId, score: alert.patternMatch.matchScore } : null,
    strikeGroupPresent: alert.strikeGroupPresent,
  };

  return {
    id: alert.id,
    type: 'military_surge' as SignalType,
    source: 'Military Flight Tracking',
    title,
    description: `Strike readiness ${transitionLabel.toLowerCase()} in ${alert.theaterName}. Assets: ${assetDesc}. Posture: ${alert.postureLevel}.`,
    severity: alert.severity,
    confidence: confidenceMap[alert.transition],
    category: 'military',
    timestamp: alert.timestamp,
    data: metadata,
    metadata,
  };
}
```

Note: The `import type { PatternMatch }` should be added at the top of the file alongside the other imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/services/__tests__/military-surge.test.mts`
Expected: PASS — all strike readiness tests green

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/military-surge.ts src/services/__tests__/military-surge.test.mts
git commit -m "feat(mil-intel): add strike capability state-change alerting

Detects transitions to/from strike-capable state per theater. Critical
severity on became_capable, high on sustained. Attaches pattern match
and strike group context.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Predictive Assessment — Heuristic Layer

**Files:**
- Create: `src/services/military-assessment.ts`
- Create: `src/services/__tests__/military-assessment.test.mts`

- [ ] **Step 1: Write tests**

Create `src/services/__tests__/military-assessment.test.mts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { assessEscalationIndicators } from '../military-assessment.ts';
import type { EscalationContext } from '../military-assessment.ts';

function makeContext(overrides: Partial<EscalationContext> = {}): EscalationContext {
  return {
    postures: [],
    surges: [],
    strikeGroups: [],
    patternMatches: new Map(),
    multiTheaterAlerts: [],
    foreignPresence: [],
    ...overrides,
  };
}

test('routine level with no activity', () => {
  const result = assessEscalationIndicators(makeContext());
  assert.equal(result.level, 'routine');
  assert.ok(result.score < 25);
});

test('elevated level with active surges', () => {
  const ctx = makeContext({
    surges: [
      {
        id: 's1', theater: { id: 'iran-theater', name: 'Iran', baseIds: [], centerLat: 27, centerLon: 51 },
        type: 'fighter', currentCount: 10, baselineCount: 3, surgeMultiple: 3.3,
        aircraftTypes: new Map(), nearbyBases: [], firstDetected: new Date(), lastUpdated: new Date(),
      },
    ],
    foreignPresence: [
      {
        id: 'fp1', operator: 'usaf', operatorCountry: 'USA',
        region: { id: 'persian-gulf', name: 'Persian Gulf', lat: 26, lon: 52, radiusKm: 200 },
        aircraftCount: 4, flights: [], firstDetected: new Date(),
      },
    ],
  });
  const result = assessEscalationIndicators(ctx);
  assert.ok(result.score >= 25, `score ${result.score} should be >= 25`);
  assert.ok(result.level === 'elevated' || result.level === 'high');
});

test('critical level with multi-theater + strike groups', () => {
  const ctx = makeContext({
    surges: [
      {
        id: 's1', theater: { id: 'iran-theater', name: 'Iran', baseIds: [], centerLat: 27, centerLon: 51 },
        type: 'fighter', currentCount: 15, baselineCount: 3, surgeMultiple: 5,
        aircraftTypes: new Map(), nearbyBases: [], firstDetected: new Date(), lastUpdated: new Date(),
      },
    ],
    strikeGroups: [
      {
        id: 'sg1', vessels: [], flights: [], centerLat: 25, centerLon: 55,
        formation: 'full_c2', theaterId: 'iran-theater', severity: 'critical', timestamp: new Date(),
      },
    ],
    multiTheaterAlerts: [
      {
        id: 'mt1', theaters: [], coordinationScore: 80, description: 'test',
        severity: 'critical', timestamp: new Date(),
      },
    ],
    foreignPresence: [
      { id: 'fp1', operator: 'usaf', operatorCountry: 'USA', region: { id: 'r1', name: 'R', lat: 0, lon: 0, radiusKm: 100 }, aircraftCount: 5, flights: [], firstDetected: new Date() },
      { id: 'fp2', operator: 'raf', operatorCountry: 'UK', region: { id: 'r2', name: 'R', lat: 0, lon: 0, radiusKm: 100 }, aircraftCount: 3, flights: [], firstDetected: new Date() },
    ],
    postures: [
      {
        theaterId: 'iran-theater', theaterName: 'Iran', shortName: 'IRAN', targetNation: 'Iran',
        fighters: 10, tankers: 3, awacs: 2, reconnaissance: 0, transport: 0, bombers: 0, drones: 0, totalAircraft: 15,
        destroyers: 0, frigates: 0, carriers: 0, submarines: 0, patrol: 0, auxiliaryVessels: 0, totalVessels: 0,
        byOperator: { usaf: 15 }, postureLevel: 'critical', strikeCapable: true, strikeGroupPresent: true,
        trend: 'increasing', changePercent: 50, summary: '', headline: '', centerLat: 27, centerLon: 51,
      },
    ],
  });
  const result = assessEscalationIndicators(ctx);
  assert.ok(result.score >= 75, `score ${result.score} should be >= 75 for critical`);
  assert.equal(result.level, 'critical');
});

test('produces confirmation and de-escalation indicators', () => {
  const ctx = makeContext({
    surges: [
      {
        id: 's1', theater: { id: 'iran-theater', name: 'Iran Theater', baseIds: [], centerLat: 27, centerLon: 51 },
        type: 'fighter', currentCount: 8, baselineCount: 3, surgeMultiple: 2.7,
        aircraftTypes: new Map(), nearbyBases: [], firstDetected: new Date(), lastUpdated: new Date(),
      },
    ],
  });
  const result = assessEscalationIndicators(ctx);
  assert.ok(result.confirmationIndicators.length > 0, 'should have confirmation indicators');
  assert.ok(result.deescalationIndicators.length > 0, 'should have de-escalation indicators');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/services/__tests__/military-assessment.test.mts`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Create military-assessment.ts with types and heuristic implementation**

Create `src/services/military-assessment.ts`:

```typescript
import type { TheaterPostureSummary, SurgeAlert, MultiTheaterAlert, StrikeGroupAlert, ForeignPresenceAlert } from './military-surge';
import type { PatternMatch } from './military-patterns';
import type { SignalType } from '@/utils/analysis-constants';
import { runIntel } from './intel-provider';
import { focalPointDetector } from './focal-point-detector';

// ── Types ──

export type EscalationLevel = 'routine' | 'elevated' | 'high' | 'critical';

export interface EscalationContext {
  postures: TheaterPostureSummary[];
  surges: SurgeAlert[];
  strikeGroups: StrikeGroupAlert[];
  patternMatches: Map<string, PatternMatch[]>;
  multiTheaterAlerts: MultiTheaterAlert[];
  foreignPresence: ForeignPresenceAlert[];
}

export interface EscalationAssessment {
  score: number;
  level: EscalationLevel;
  components: {
    surgeScore: number;
    strikeCapabilityScore: number;
    strikeGroupScore: number;
    patternMatchScore: number;
    multiTheaterScore: number;
    foreignPresenceScore: number;
  };
  confirmationIndicators: string[];
  deescalationIndicators: string[];
  timestamp: Date;
}

export interface StrategicAssessment {
  summary: string;
  likelyIntent: string;
  projection72h: string;
  keyIndicators: string[];
  confidenceLevel: 'low' | 'moderate' | 'high';
  timestamp: Date;
  model: string;
}

// ── Heuristic Escalation Scoring ──

function scoreLevel(score: number): EscalationLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'elevated';
  return 'routine';
}

export function assessEscalationIndicators(ctx: EscalationContext): EscalationAssessment {
  const maxSurgeMultiple = ctx.surges.reduce((m, s) => Math.max(m, s.surgeMultiple), 0);
  const surgeScore = Math.min(20, ctx.surges.length * 5 + Math.max(0, maxSurgeMultiple - 2) * 3);

  const strikeCapableCount = ctx.postures.filter(p => p.strikeCapable).length;
  const strikeCapabilityScore = Math.min(20, strikeCapableCount * 10);

  let strikeGroupScore = 0;
  for (const sg of ctx.strikeGroups) {
    if (sg.formation === 'full_c2') { strikeGroupScore = 15; break; }
    if (sg.formation === 'strike_ready') strikeGroupScore = Math.max(strikeGroupScore, 10);
    else strikeGroupScore = Math.max(strikeGroupScore, 5);
  }

  let bestPatternScore = 0;
  for (const matches of ctx.patternMatches.values()) {
    for (const m of matches) bestPatternScore = Math.max(bestPatternScore, m.matchScore);
  }
  const patternMatchScore = Math.min(15, Math.round(bestPatternScore / 100 * 15));

  const multiTheaterScore = ctx.multiTheaterAlerts.length > 0 ? 15 : 0;

  const foreignPresenceScore = Math.min(15, ctx.foreignPresence.length * 5);

  const score = Math.round(surgeScore + strikeCapabilityScore + strikeGroupScore + patternMatchScore + multiTheaterScore + foreignPresenceScore);

  // Build indicators
  const confirmationIndicators: string[] = [];
  const deescalationIndicators: string[] = [];

  for (const surge of ctx.surges) {
    confirmationIndicators.push(`Watch for additional ${surge.type} aircraft arriving in ${surge.theater.name}`);
  }
  for (const posture of ctx.postures) {
    if (posture.strikeCapable) {
      confirmationIndicators.push(`Monitor for tanker orbit establishment near ${posture.theaterName}`);
    }
  }
  for (const matches of ctx.patternMatches.values()) {
    if (matches.length > 0) {
      confirmationIndicators.push(`Current posture matches ${matches[0]!.patternName} — watch for force concentration`);
    }
  }
  if (ctx.multiTheaterAlerts.length > 0) {
    confirmationIndicators.push('Monitor for coordinated timing across theaters');
  }

  if (ctx.surges.length > 0) {
    deescalationIndicators.push('Transport aircraft departing active theaters');
  }
  deescalationIndicators.push('AWACS/tanker withdrawal from forward positions');
  deescalationIndicators.push('Return to baseline activity levels');

  return {
    score,
    level: scoreLevel(score),
    components: {
      surgeScore,
      strikeCapabilityScore,
      strikeGroupScore,
      patternMatchScore,
      multiTheaterScore,
      foreignPresenceScore,
    },
    confirmationIndicators,
    deescalationIndicators,
    timestamp: new Date(),
  };
}

// ── LLM Strategic Assessment ──

let lastAssessmentTime = 0;
let lastAssessmentSignalCount = 0;
let cachedAssessment: StrategicAssessment | null = null;
let previousEscalationLevel: EscalationLevel = 'routine';

const ASSESSMENT_INTERVAL_MS = 15 * 60 * 1000;

export function getLatestAssessment(): StrategicAssessment | null {
  return cachedAssessment;
}

function formatPosturesForPrompt(postures: TheaterPostureSummary[]): string {
  return postures
    .filter(p => p.postureLevel !== 'normal')
    .map(p => `- ${p.theaterName}: ${p.totalAircraft} aircraft (${p.fighters}F/${p.tankers}T/${p.awacs}A/${p.transport}Tr), posture=${p.postureLevel}, strike=${p.strikeCapable ? 'YES' : 'no'}, trend=${p.trend}`)
    .join('\n') || 'None active';
}

function formatSurgesForPrompt(surges: SurgeAlert[]): string {
  return surges
    .map(s => `- ${s.theater.name}: ${s.type} surge, ${s.currentCount} aircraft (${s.surgeMultiple.toFixed(1)}x baseline)`)
    .join('\n') || 'None';
}

function formatStrikeGroupsForPrompt(groups: StrikeGroupAlert[]): string {
  return groups
    .map(g => `- ${g.formation} near ${g.vessels.map(v => v.name).join(', ')}: ${g.flights.length} aircraft`)
    .join('\n') || 'None';
}

function formatPatternsForPrompt(patterns: Map<string, PatternMatch[]>): string {
  const lines: string[] = [];
  for (const [theaterId, matches] of patterns) {
    for (const m of matches) {
      lines.push(`- ${m.theaterName}: ${m.patternName} at ${m.matchScore}%`);
    }
  }
  return lines.join('\n') || 'None';
}

function formatMultiTheaterForPrompt(alerts: MultiTheaterAlert[]): string {
  return alerts
    .map(a => `- ${a.description} (score: ${a.coordinationScore})`)
    .join('\n') || 'None';
}

export async function runStrategicAssessment(
  ctx: EscalationContext,
  newsContext: string,
): Promise<StrategicAssessment | null> {
  const system = 'You are a military intelligence analyst providing strategic assessment of military movements and posture changes. Respond ONLY with valid JSON, no markdown.';
  const prompt = `Assess the following military situation:

THEATER POSTURES:
${formatPosturesForPrompt(ctx.postures)}

ACTIVE SURGES:
${formatSurgesForPrompt(ctx.surges)}

STRIKE GROUPS:
${formatStrikeGroupsForPrompt(ctx.strikeGroups)}

PATTERN MATCHES:
${formatPatternsForPrompt(ctx.patternMatches)}

MULTI-THEATER COORDINATION:
${formatMultiTheaterForPrompt(ctx.multiTheaterAlerts)}

RECENT NEWS CONTEXT:
${newsContext || 'No relevant news context available'}

Respond with JSON:
{"summary":"2-3 sentence strategic overview","likelyIntent":"assessed purpose of observed movements","projection72h":"what is likely in the next 72 hours","keyIndicators":["indicator1","indicator2"],"confidenceLevel":"low|moderate|high"}`;

  try {
    const response = await runIntel(prompt, { system, maxTokens: 500, temperature: 0.2 });
    const jsonMatch = response.response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as {
      summary?: string;
      likelyIntent?: string;
      projection72h?: string;
      keyIndicators?: string[];
      confidenceLevel?: string;
    };

    const assessment: StrategicAssessment = {
      summary: parsed.summary ?? 'Assessment unavailable',
      likelyIntent: parsed.likelyIntent ?? 'Unknown',
      projection72h: parsed.projection72h ?? 'Insufficient data',
      keyIndicators: parsed.keyIndicators ?? [],
      confidenceLevel: (['low', 'moderate', 'high'].includes(parsed.confidenceLevel ?? '') ? parsed.confidenceLevel : 'low') as 'low' | 'moderate' | 'high',
      timestamp: new Date(),
      model: response.model,
    };
    cachedAssessment = assessment;
    return assessment;
  } catch {
    return null;
  }
}

export async function maybeRunStrategicAssessment(
  escalation: EscalationAssessment,
  ctx: EscalationContext,
): Promise<void> {
  const now = Date.now();
  const levelChanged = escalation.level !== previousEscalationLevel && escalation.level !== 'routine';
  const newCriticalSignals = ctx.surges.length + ctx.strikeGroups.length + ctx.multiTheaterAlerts.length;
  const hasCriticalActivity = newCriticalSignals > lastAssessmentSignalCount && escalation.level !== 'routine';
  const cooldownExpired = now - lastAssessmentTime >= ASSESSMENT_INTERVAL_MS;

  previousEscalationLevel = escalation.level;

  if (escalation.level === 'routine') return;
  if (!levelChanged && !hasCriticalActivity) return;
  if (!cooldownExpired) return;

  lastAssessmentTime = now;
  lastAssessmentSignalCount = newCriticalSignals;

  // Get news context from focal point detector
  const countries = new Set<string>();
  for (const posture of ctx.postures) {
    if (posture.targetNation) countries.add(posture.targetNation);
  }
  for (const fp of ctx.foreignPresence) {
    countries.add(fp.operatorCountry);
  }

  let newsContext = '';
  try {
    const correlation = focalPointDetector.getNewsCorrelationContext([...countries]);
    newsContext = typeof correlation === 'string' ? correlation : JSON.stringify(correlation);
  } catch {
    // News context is best-effort
  }

  void runStrategicAssessment(ctx, newsContext);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/services/__tests__/military-assessment.test.mts`
Expected: PASS — all 4 tests green

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/military-assessment.ts src/services/__tests__/military-assessment.test.mts
git commit -m "feat(mil-intel): add escalation heuristics and LLM strategic assessment

Composite escalation score (0-100) from 6 weighted components.
LLM assessment triggered when escalation >= elevated, rate-limited
to 15-minute intervals.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Data-Loader Integration

**Files:**
- Modify: `src/app/data-loader.ts`

- [ ] **Step 1: Add new imports**

At the top of `src/app/data-loader.ts`, update the existing military-surge import (line 83) and add new imports:

```typescript
import { analyzeFlightsForSurge, surgeAlertToSignal, detectForeignMilitaryPresence, foreignPresenceToSignal, getTheaterPostureSummaries, detectMultiTheaterCoordination, multiTheaterToSignal, detectStrikeGroups, strikeGroupToSignal, detectStrikeReadiness, strikeReadinessToSignal, type TheaterPostureSummary } from '@/services/military-surge';
import { matchPatterns, patternMatchToSignal } from '@/services/military-patterns';
import { assessEscalationIndicators, maybeRunStrategicAssessment } from '@/services/military-assessment';
```

- [ ] **Step 2: Update the initial military processing block (around line 1523-1542)**

Replace the existing `if (!isInLearningMode())` block starting at line 1523 with the enhanced version. Find the block that starts with `if (!isInLearningMode()) {` and contains `analyzeFlightsForSurge` and `detectForeignMilitaryPresence`, and replace it:

```typescript
 if (!isInLearningMode()) {
 const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
 if (surgeAlerts.length > 0) {
 const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
 addToSignalHistory(surgeSignals);
 situationEngine.observeSignals(surgeSignals);
 evaluateWarThreat(surgeSignals);
 (this.ctx.panels['alert-center'] as AlertCenterPanel)?.addSignals(surgeSignals);
 if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(surgeSignals);
 }
 const foreignAlerts = detectForeignMilitaryPresence(flightData.flights);
 if (foreignAlerts.length > 0) {
 const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
 addToSignalHistory(foreignSignals);
 situationEngine.observeSignals(foreignSignals);
 evaluateWarThreat(foreignSignals);
 (this.ctx.panels['alert-center'] as AlertCenterPanel)?.addSignals(foreignSignals);
 if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(foreignSignals);
 }

 // Enhanced military intelligence
 const postures = getTheaterPostureSummaries(flightData.flights);
 const multiTheaterAlerts = detectMultiTheaterCoordination(surgeAlerts);
 const patternMatches = new Map<string, import('@/services/military-patterns').PatternMatch[]>();
 for (const posture of postures) {
 const matches = matchPatterns(posture, surgeAlerts);
 if (matches.length > 0) patternMatches.set(posture.theaterId, matches);
 }
 const strikeGroups = detectStrikeGroups(flightData.flights, vesselData.vessels);
 for (const sg of strikeGroups) {
 const p = postures.find(pp => pp.theaterId === sg.theaterId);
 if (p) p.strikeGroupPresent = true;
 }
 const strikeReadiness = detectStrikeReadiness(postures, patternMatches);
 const enhancedSignals = [
 ...multiTheaterAlerts.map(multiTheaterToSignal),
 ...[...patternMatches.values()].flatMap(ms => ms.filter(m => m.matchScore >= 80).map(patternMatchToSignal)),
 ...strikeGroups.map(strikeGroupToSignal),
 ...strikeReadiness.map(strikeReadinessToSignal),
 ];
 if (enhancedSignals.length > 0) {
 addToSignalHistory(enhancedSignals);
 situationEngine.observeSignals(enhancedSignals);
 (this.ctx.panels['alert-center'] as AlertCenterPanel)?.addSignals(enhancedSignals);
 if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(enhancedSignals);
 }
 const escalation = assessEscalationIndicators({
 postures, surges: surgeAlerts, strikeGroups, patternMatches, multiTheaterAlerts, foreignPresence: foreignAlerts,
 });
 void maybeRunStrategicAssessment(escalation, {
 postures, surges: surgeAlerts, strikeGroups, patternMatches, multiTheaterAlerts, foreignPresence: foreignAlerts,
 });
 }
```

- [ ] **Step 3: Update the refresh/update cycle block (around line 2534-2553)**

Apply the same enhancement to the second `if (!isInLearningMode())` block in the refresh cycle. This block is near line 2534 and has identical structure. Replace it with the same enhanced version from Step 2 (adapting variable references — `flightData` and `vesselData` are already in scope).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/data-loader.ts
git commit -m "feat(mil-intel): integrate all 5 enhanced capabilities into fetch cycle

Data-loader now runs multi-theater coordination, pattern matching,
strike group detection, strike readiness alerting, and escalation
assessment after each military data fetch. Enhanced signals feed
into situation engine and alert center.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Full Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx tsx --test src/services/__tests__/military-patterns.test.mts src/services/__tests__/military-surge.test.mts src/services/__tests__/military-assessment.test.mts`
Expected: ALL PASS

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck:all`
Expected: PASS — zero errors

- [ ] **Step 3: Run full production build**

Run: `npm run desktop:build:full`
Expected: Build completes, app installs successfully

- [ ] **Step 4: Push branch**

```bash
git push origin claude/map-icons-overhaul
```
