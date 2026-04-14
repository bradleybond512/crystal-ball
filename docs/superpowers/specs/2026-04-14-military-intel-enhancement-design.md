# Military Intelligence Enhancement — Design Spec

## Goal

Fill five gaps in Crystal Ball's military intelligence system: multi-theater coordination detection, historical pattern matching, flight-to-vessel strike group detection, strike capability auto-alerting, and predictive assessment (heuristic + LLM).

## Architecture

All five capabilities layer on top of the existing military-surge pipeline. Three are additions to `military-surge.ts`, one is a new `military-patterns.ts` module, and one is a new `military-assessment.ts` module. The data-loader orchestrates them in the existing military fetch cycle. All outputs convert to signals and feed into the situation engine via the established `observeSignals()` pattern.

## Tech Stack

- TypeScript (existing frontend services)
- Existing `runIntel()` for LLM calls (local-first, Claude fallback)
- Existing `situationEngine.observeSignals()` for downstream consumption
- Existing `focalPointDetector` for news context enrichment

---

## 1. Multi-Theater Coordination Detection

**File:** `src/services/military-surge.ts` (additions)

### Types

```typescript
interface MultiTheaterAlert {
  id: string;
  theaters: Array<{
    theaterId: string;
    theaterName: string;
    surgeType: 'airlift' | 'fighter' | 'reconnaissance';
    surgeMultiple: number;
    aircraftCount: number;
  }>;
  coordinationScore: number;    // 0-100, tighter temporal overlap = higher
  description: string;          // e.g., "Dual-front posturing: Iran + Taiwan"
  severity: 'critical';         // always critical
  timestamp: Date;
}
```

### Logic

`detectMultiTheaterCoordination(surges: SurgeAlert[]): MultiTheaterAlert[]`

1. Group active surges by `firstDetected` timestamp
2. Find surges across **2+ distinct theaters** within a **4-hour window**
3. Compute `coordinationScore`:
   - Base = 50
   - +10 per additional theater beyond 2
   - +10 if temporal overlap < 1 hour
   - +10 if 3+ distinct operators involved
   - +10 if any theater is strike-capable
   - Cap at 100
4. Generate description from named combos:
   - Iran + Taiwan = "Dual-front posturing"
   - Baltic + Black Sea = "European theater-wide mobilization"
   - Iran + East Med + Yemen-Red Sea = "Middle East theater-wide surge"
   - Fallback: "Multi-theater coordination: {theater1}, {theater2}, ..."
5. Deduplicate with 4-hour window (same theater set)

### Signal Conversion

`multiTheaterToSignal(alert: MultiTheaterAlert): Signal`
- `type: 'military_surge'`
- `severity: 'critical'`
- `confidence: coordinationScore / 100`
- `title`: alert description
- `description`: per-theater breakdown with aircraft counts and surge multiples

---

## 2. Historical Pattern Matching

**File:** `src/services/military-patterns.ts` (new)

### Types

```typescript
interface ConflictPattern {
  id: string;
  name: string;                          // e.g., "Air Campaign"
  description: string;
  signature: {
    minAircraft: number;
    fighterPct: [number, number];        // [min%, max%] range
    tankerPct: [number, number];
    transportPct: [number, number];
    requireStrikeCapable: boolean;
    requireAwacs: boolean;
    requireMultiOperator: boolean;
  };
}

interface PatternMatch {
  patternId: string;
  patternName: string;
  matchScore: number;                    // 0-100
  theaterId: string;
  theaterName: string;
  breakdown: Record<string, number>;     // per-criterion scores
}
```

### Patterns (6 hardcoded)

1. **Desert Storm** — minAircraft: 15, fighters 30-50%, tankers 10-25%, transport 15-30%, strikeCapable required, AWACS required, multiOperator required
2. **Air Campaign** — minAircraft: 10, fighters >60%, tankers 5-20%, transport <15%, strikeCapable required, AWACS required
3. **Airlift/Deployment** — minAircraft: 8, transport >50%, fighters <20%, strikeCapable not required
4. **Naval Strike Support** — minAircraft: 6, fighters 30-50%, tankers 10-30%, patrol present, maritime theater required
5. **Recon Surge** — minAircraft: 4, recon+AWACS+EW >50%, fighters <20%, strikeCapable not required
6. **Rapid Reaction** — minAircraft: 5, any type mix, baseline must be near zero (surge multiple >4), short time window

### Logic

`matchPatterns(posture: TheaterPostureSummary, surges?: SurgeAlert[]): PatternMatch[]`

1. For each pattern, compute match score:
   - Aircraft type percentages compared against signature ranges (0-20 pts per type, proportional to how well it fits the range)
   - Boolean criteria (strikeCapable, AWACS, multiOperator): 10 pts each if met, 0 if required but missing
   - Total normalized to 0-100
2. Return matches with score >= 60
3. Sort by score descending

### Signal Emission

When any match scores 80+, emit via `patternMatchToSignal()`:
- `type: 'military_surge'`
- `severity: 'high'` (80-89) or `'critical'` (90+)
- `confidence: matchScore / 100`
- `title`: "Taiwan theater matches Air Campaign pattern (87%)"

### Exports

```typescript
export function matchPatterns(posture: TheaterPostureSummary, surges?: SurgeAlert[]): PatternMatch[];
export function patternMatchToSignal(match: PatternMatch): Signal;
export const CONFLICT_PATTERNS: ConflictPattern[];
```

---

## 3. Flight-to-Vessel Strike Group Detection

**File:** `src/services/military-surge.ts` (additions)

### Types

```typescript
interface StrikeGroupAlert {
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
```

### Logic

`detectStrikeGroups(flights: MilitaryFlight[], vessels: MilitaryVessel[]): StrikeGroupAlert[]`

1. Identify **capital ships**: vessels where `vesselType` matches carrier/cruiser/destroyer patterns, or clusters of 2+ warships within 50km of each other
2. For each capital ship (or warship cluster), search for military flights within **150km** (fighters, tankers) and **300km** (AWACS)
3. Classify formation:
   - Any fighters within 150km = `carrier_air_patrol` (severity: high)
   - Fighters + tankers within 150km = `strike_ready` (severity: critical)
   - Above + AWACS within 300km = `full_c2` (severity: critical)
4. Skip if no flights found near any vessel group
5. Deduplicate by vessel group (same vessels = same alert, 2-hour window)
6. Compute center position as centroid of all vessels in group

### Signal Conversion

`strikeGroupToSignal(alert: StrikeGroupAlert): Signal`
- `type: 'military_surge'`
- `severity`: from alert
- `confidence: 0.85` (high — spatial co-location is strong evidence)
- `title`: "Strike group detected: {formation} near {theater/location}"
- `location`: center of group

### Theater Posture Integration

After strike group detection, set `strikeGroupPresent: true` on matching theater posture summaries. Add this boolean field to `TheaterPostureSummary`.

---

## 4. Strike Capability Auto-Alerting

**File:** `src/services/military-surge.ts` (additions)

### Types

```typescript
interface StrikeReadinessAlert {
  id: string;
  theaterId: string;
  theaterName: string;
  transition: 'became_capable' | 'sustained' | 'lost_capability';
  postureLevel: 'elevated' | 'critical';
  assets: { tankers: number; awacs: number; fighters: number };
  thresholds: { minTankers: number; minAwacs: number; minFighters: number };
  patternMatch: PatternMatch | null;       // from Section 2 if available
  strikeGroupPresent: boolean;             // from Section 3
  severity: 'critical' | 'high';
  timestamp: Date;
}
```

### Logic

`detectStrikeReadiness(postures: TheaterPostureSummary[], patterns: Map<string, PatternMatch[]>): StrikeReadinessAlert[]`

1. Maintain `previousStrikeState: Map<string, boolean>` (module-level, persists across calls)
2. For each theater posture where `postureLevel !== 'normal'`:
   - Check `strikeCapable`
   - Compare to previous state
   - If **transition to capable**: emit alert with `transition: 'became_capable'`, severity `critical`
   - If **sustained capable** (was capable last cycle too): emit alert with `transition: 'sustained'`, severity `high`
   - If **lost capability**: emit alert with `transition: 'lost_capability'`, severity `medium` (informational — de-escalation signal)
3. Attach best pattern match for this theater if available (score 60+)
4. Attach `strikeGroupPresent` from posture
5. Update `previousStrikeState`

### Signal Conversion

`strikeReadinessToSignal(alert: StrikeReadinessAlert): Signal`
- `type: 'military_surge'`
- `severity`: from alert
- `confidence`: 0.9 for `became_capable`, 0.8 for `sustained`, 0.7 for `lost_capability`
- `title`: "Iran theater: strike capability ACTIVATED — matches Air Campaign pattern (85%)" or "Iran theater: strike capability sustained"
- Enrichment: pattern match and strike group info in metadata

---

## 5. Predictive Assessment (Heuristic + LLM)

**File:** `src/services/military-assessment.ts` (new)

### Types

```typescript
type EscalationLevel = 'routine' | 'elevated' | 'high' | 'critical';

interface EscalationAssessment {
  score: number;                         // 0-100
  level: EscalationLevel;
  components: {
    surgeScore: number;                  // 0-20
    strikeCapabilityScore: number;       // 0-20
    strikeGroupScore: number;            // 0-15
    patternMatchScore: number;           // 0-15
    multiTheaterScore: number;           // 0-15
    foreignPresenceScore: number;        // 0-15
  };
  confirmationIndicators: string[];
  deescalationIndicators: string[];
  timestamp: Date;
}

interface StrategicAssessment {
  summary: string;                       // 2-3 sentence overview
  likelyIntent: string;                  // assessed purpose of movements
  projection72h: string;                 // what to expect next
  keyIndicators: string[];               // things to watch
  confidenceLevel: 'low' | 'moderate' | 'high';
  timestamp: Date;
  model: string;                         // which LLM produced this
}
```

### Heuristic Layer

`assessEscalationIndicators(ctx: EscalationContext): EscalationAssessment`

Where `EscalationContext` bundles:
- `postures: TheaterPostureSummary[]`
- `surges: SurgeAlert[]`
- `strikeGroups: StrikeGroupAlert[]`
- `patternMatches: Map<string, PatternMatch[]>`
- `multiTheaterAlerts: MultiTheaterAlert[]`
- `foreignPresence: ForeignPresenceAlert[]`

Scoring:
- **surgeScore** (0-20): `min(20, activeSurges * 5 + max(surgeMultiple - 2) * 3)`
- **strikeCapabilityScore** (0-20): `strikeCapableTheaters * 10`, cap 20
- **strikeGroupScore** (0-15): 15 if `full_c2`, 10 if `strike_ready`, 5 if `carrier_air_patrol`, 0 if none
- **patternMatchScore** (0-15): `min(15, bestMatchScore / 100 * 15)`
- **multiTheaterScore** (0-15): 15 if multi-theater alert active, 0 otherwise
- **foreignPresenceScore** (0-15): `min(15, foreignAlerts * 5)`

Level thresholds:
- `routine`: score < 25
- `elevated`: 25-49
- `high`: 50-74
- `critical`: 75+

Confirmation indicators generated per active component:
- Surge active: "Watch for additional transport aircraft arriving in {theater}"
- Strike capable: "Monitor for tanker orbit establishment near {theater}"
- Pattern match: "Current posture matches {pattern} — watch for {next expected step}"

De-escalation indicators:
- "Transport aircraft departing {theater}"
- "AWACS/tanker withdrawal from {theater}"
- "Return to baseline activity levels"

### LLM Layer

`runStrategicAssessment(ctx: EscalationContext, newsContext: string): Promise<StrategicAssessment>`

Trigger conditions:
- Escalation level transitions to `elevated` or higher
- OR a new critical military signal arrives while already >= `elevated`
- AND last LLM assessment was >= 15 minutes ago

Rate limiting:
- Minimum 15-minute interval between LLM calls
- Skip if no new critical signals since last assessment
- Track via `lastAssessmentTime` and `lastAssessmentSignalCount` (module-level)

Prompt construction:
```
System: You are a military intelligence analyst providing strategic assessment
of military movements and posture changes. Respond in structured JSON format.

User: Assess the following military situation:

THEATER POSTURES:
{formatted posture summaries for non-normal theaters}

ACTIVE SURGES:
{surge alerts with details}

STRIKE GROUPS:
{strike group formations if any}

PATTERN MATCHES:
{historical pattern match results}

MULTI-THEATER COORDINATION:
{multi-theater alerts if any}

RECENT NEWS CONTEXT:
{from focalPointDetector for relevant countries}

Respond with JSON:
{
  "summary": "2-3 sentence strategic overview",
  "likelyIntent": "assessed purpose of the observed movements",
  "projection72h": "what is likely to happen in the next 72 hours",
  "keyIndicators": ["indicator1", "indicator2", ...],
  "confidenceLevel": "low|moderate|high"
}
```

Uses `runIntel(prompt, { system, maxTokens: 500, temperature: 0.2 })`.

Parse response as JSON. On parse failure, extract what's possible or skip.

### Caching

- Cache `StrategicAssessment` in module-level variable
- Expose via `getLatestAssessment(): StrategicAssessment | null`
- Situation engine attaches it to military-domain situations as metadata

---

## Data-Loader Integration

All five capabilities integrate at the end of the existing military fetch cycle in `data-loader.ts`:

```typescript
// Existing
const surgeAlerts = analyzeFlightsForSurge(flights);
const foreignAlerts = detectForeignMilitaryPresence(flights);
const postures = getTheaterPostureSummaries(flights);

// New — Section 1
const multiTheaterAlerts = detectMultiTheaterCoordination(surgeAlerts);

// New — Section 2
const patternMatches = new Map<string, PatternMatch[]>();
for (const posture of postures) {
  const matches = matchPatterns(posture, surgeAlerts);
  if (matches.length > 0) patternMatches.set(posture.theaterId, matches);
}

// New — Section 3
const strikeGroups = detectStrikeGroups(flights, vessels);

// New — Section 4
const strikeReadiness = detectStrikeReadiness(postures, patternMatches);

// New — Section 5
const escalation = assessEscalationIndicators({
  postures, surges: surgeAlerts, strikeGroups,
  patternMatches, multiTheaterAlerts, foreignPresence: foreignAlerts,
});

// Collect all new signals
const newSignals = [
  ...multiTheaterAlerts.map(multiTheaterToSignal),
  ...patternMatches.values().flatMap(ms => ms.filter(m => m.matchScore >= 80).map(patternMatchToSignal)),
  ...strikeGroups.map(strikeGroupToSignal),
  ...strikeReadiness.map(strikeReadinessToSignal),
];

// Feed to existing pipeline
if (newSignals.length > 0) {
  addToSignalHistory(newSignals);
  situationEngine.observeSignals(newSignals);
}

// LLM assessment (async, non-blocking)
maybeRunStrategicAssessment(escalation, { postures, surgeAlerts, strikeGroups, patternMatches, multiTheaterAlerts, foreignAlerts });
```

## Signal Type Reuse

All new signals use `type: 'military_surge'` — this is the existing signal type already handled by the situation engine, signal aggregator, and alert store. No new signal types needed.

## New Exports Summary

| Module | New Exports |
|--------|-------------|
| `military-surge.ts` | `detectMultiTheaterCoordination()`, `multiTheaterToSignal()`, `detectStrikeGroups()`, `strikeGroupToSignal()`, `detectStrikeReadiness()`, `strikeReadinessToSignal()` |
| `military-patterns.ts` (new) | `matchPatterns()`, `patternMatchToSignal()`, `CONFLICT_PATTERNS` |
| `military-assessment.ts` (new) | `assessEscalationIndicators()`, `runStrategicAssessment()`, `getLatestAssessment()`, `maybeRunStrategicAssessment()` |
| `TheaterPostureSummary` type | New field: `strikeGroupPresent: boolean` |

## What This Does NOT Include

- ML-based behavioral clustering (not enough training data client-side)
- OSINT fusion with external sources like Bellingcat/ISW (no API available)
- New UI panels or visual changes (these capabilities surface through existing Situation Panel and Alert Center)
- Changes to the alert-correlator causal rules (the signals feed into the existing correlation engine as-is)
