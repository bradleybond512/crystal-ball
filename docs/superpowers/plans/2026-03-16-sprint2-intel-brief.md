# Sprint 2 — Intel Brief Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Intel Brief panel that synthesizes all live threat signals into a structured 3-domain brief (Security / Economics / Infrastructure) with a global threat score, AI narrative via Ollama/Groq/OpenRouter, and a rule-based fallback that always renders — even offline with zero API keys.

**Architecture:** `data-loader.loadIntelBrief()` owns the full generation cycle (snapshot → AI sidecar → rule-based fallback → score → panel.update). The panel renders immediately on startup from localStorage cache or a synchronous rule-based brief from empty data. A `wm:mode-changed` listener in `App.ts` triggers immediate regeneration on mode transitions.

**Tech Stack:** TypeScript (strict), Node.js sidecar (no Express — `if pathname ===` routing), Tauri 2 desktop, `node:test` + `tsx --test` for unit tests

> **XSS safety note:** All HTML in `IntelBriefPanel` is assembled using the `esc()` helper (escapes `&`, `<`, `>`, `"`) for any string that originates from AI responses, rule-based synthesis output, or API data. Static strings (CSS values, score numbers, severity labels) are code-controlled. Setting `el.innerHTML` with this escaped output is the established pattern in this codebase (see `CommsHealthPanel`, `EconomicStressPanel`).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/services/intel-brief.ts` | Create | Types + `buildSnapshot()` + `computeGlobalScore()` + `fetchIntelBrief()` + cache helpers |
| `src/services/intel-brief-rules.ts` | Create | Pure synthesis — `buildEmptySnapshot()` + `generateRuleBasedBrief()` |
| `src/components/IntelBriefPanel.ts` | Create | Panel UI — score bar, domain cards, expand/collapse, source indicator |
| `tests/intel-brief-rules.test.mts` | Create | Unit tests for rule-based synthesis + score formula |
| `src-tauri/sidecar/local-api-server.mjs` | Modify | Add `POST /api/intel-brief` with Ollama → Groq → OpenRouter chain |
| `src/services/comms-health.ts` | Modify | Add module-level last-result cache + getter/setter |
| `src/services/economic-stress.ts` | Modify | Add module-level last-result cache + getter/setter |
| `src/config/panels.ts` | Modify | Register `intel-brief` in `FULL_PANELS` + `intelligence` category |
| `src/app/panel-layout.ts` | Modify | Import, `WAR_PRIORITY`, `DISASTER_PRIORITY`, `createPanels()` |
| `src/app/data-loader.ts` | Modify | Call `setLastCommsHealth`/`setLastEconomicStress`; add `loadIntelBrief()` |
| `src/App.ts` | Modify | Add `intelBrief` to refresh batch + `wm:mode-changed` listener |

---

## Chunk 1: Service Layer

### Task 1: Module-level caches in comms-health.ts and economic-stress.ts

`buildSnapshot()` in intel-brief.ts needs access to the last-fetched data from these services. Currently data is pushed to panels and discarded. Add module-level cache variables with getter/setter so `buildSnapshot()` can read them.

**Files:**

- Modify: `src/services/comms-health.ts`
- Modify: `src/services/economic-stress.ts`

- [ ] **Step 1.1: Add cache to comms-health.ts**

Open `src/services/comms-health.ts`. After the `fetchCommsHealth` function, add:

```typescript
let _lastCommsHealth: CommsHealthData | null = null;
export function setLastCommsHealth(data: CommsHealthData): void { _lastCommsHealth = data; }
export function getLastCommsHealth(): CommsHealthData | null { return _lastCommsHealth; }
```

- [ ] **Step 1.2: Add cache to economic-stress.ts**

Open `src/services/economic-stress.ts`. After the `fetchEconomicStress` function, add:

```typescript
let _lastEconomicStress: EconomicStressData | null = null;
export function setLastEconomicStress(data: EconomicStressData): void { _lastEconomicStress = data; }
export function getLastEconomicStress(): EconomicStressData | null { return _lastEconomicStress; }
```

- [ ] **Step 1.3: Verify typecheck passes**

```bash
npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 1.4: Commit**

```bash
git add src/services/comms-health.ts src/services/economic-stress.ts
git commit -m "feat(services): add module-level last-result caches for buildSnapshot() access

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Create src/services/intel-brief.ts

Core types, `buildSnapshot`, `computeGlobalScore`, `fetchIntelBrief`, and localStorage cache helpers.

**Files:**

- Create: `src/services/intel-brief.ts`

- [ ] **Step 2.1: Create the file**

Create `src/services/intel-brief.ts` with this complete content:

```typescript
import type { IntelligenceCache } from '@/app/app-context';
import type { AppMode } from '@/services/mode-manager';
import { getLastCommsHealth } from '@/services/comms-health';
import { getLastEconomicStress } from '@/services/economic-stress';
import { getApiBaseUrl } from '@/services/runtime';

export type BriefSeverity = 'normal' | 'warning' | 'critical' | 'unknown';
export type BriefSource = 'ollama' | 'groq' | 'openrouter' | 'rules' | 'cache';
// Note: 't5' is intentionally excluded — browser T5 is deferred to a future sprint.

export interface IntelBriefDomain {
  severity: BriefSeverity;
  headline: string;
  analysis: string;
}

export interface IntelBriefResult {
  globalScore: number;
  security: IntelBriefDomain;
  economics: IntelBriefDomain;
  infrastructure: IntelBriefDomain;
  generatedAt: string;
  source: BriefSource;
  sourceModel?: string;
  mode: AppMode;
  snapshotAgeMs?: number;
}

export interface IntelBriefSnapshot {
  mode: AppMode;
  security: {
 militaryFlightClusters: number;
 protestEvents: number;
 orefAlertCount: number;
 advisoryCount: number;
 bgpHijacks: number;
 bgpLeaks: number;
 commsOverall: 'normal' | 'warning' | 'critical' | 'unknown';
  };
  economics: {
 stressIndex: number;
 stressTrend: 'rising' | 'stable' | 'falling';
 yieldCurveSeverity: string;
 vixSeverity: string;
 foodSecuritySeverity: string;
 fredKeyMissing: boolean;
  };
  infrastructure: {
 commsOverall: 'normal' | 'warning' | 'critical' | 'unknown';
 bgpSeverity: 'normal' | 'warning' | 'critical';
 ixpStatus: 'normal' | 'warning' | 'critical';
 degradedCables: string[];
 internetOutages: number;
  };
  dataAgeMs: {
 security: number;
 economics: number;
 infrastructure: number;
  };
}

// ── localStorage cache ────────────────────────────────────────────────────────

const BRIEF_CACHE_KEY = 'crystalball-intel-brief-cache';

interface BriefCache {
  result: IntelBriefResult;
  savedAt: number;
}

export function loadIntelBriefCache(): IntelBriefResult | null {
  try {
 const raw = localStorage.getItem(BRIEF_CACHE_KEY);
 if (!raw) return null;
 return (JSON.parse(raw) as BriefCache).result;
  } catch { return null; }
}

export function saveIntelBriefCache(result: IntelBriefResult): void {
  try {
 localStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify({ result, savedAt: Date.now() } satisfies BriefCache));
  } catch { /* ignore quota errors */ }
}

export function getIntelBriefCacheAgeMs(): number | null {
  try {
 const raw = localStorage.getItem(BRIEF_CACHE_KEY);
 if (!raw) return null;
 return Date.now() - (JSON.parse(raw) as BriefCache).savedAt;
  } catch { return null; }
}

// ── Score formula ─────────────────────────────────────────────────────────────

function clamp(x: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, x));
}

export function computeGlobalScore(snap: IntelBriefSnapshot): number {
  const bgpScore = clamp(snap.security.bgpHijacks / 20 * 100) * 0.35;
  const militaryScore = clamp(snap.security.militaryFlightClusters / 5 * 100) * 0.40;
  const unrestScore = clamp(snap.security.protestEvents / 50 * 100) * 0.25;
  const securityScore = bgpScore + militaryScore + unrestScore;

  const economicsScore = snap.economics.stressIndex;

  const commsMap: Record<string, number> = { normal: 0, warning: 50, critical: 100, unknown: 25 };
  const commsScore = commsMap[snap.infrastructure.commsOverall] ?? 25;
  const outageScore = clamp(snap.infrastructure.internetOutages / 10 * 100);
  const infraScore = commsScore * 0.7 + outageScore * 0.3;

  return Math.round(securityScore * 0.40 + economicsScore * 0.35 + infraScore * 0.25);
}

// ── Snapshot builder ──────────────────────────────────────────────────────────

export function buildSnapshot(cache: IntelligenceCache, mode: AppMode): IntelBriefSnapshot {
  const comms = getLastCommsHealth();
  const econ  = getLastEconomicStress();

  return {
 mode,
 security: {
 militaryFlightClusters: cache.military?.flightClusters?.length ?? 0,
 protestEvents: cache.protests?.events?.length ?? 0,
 orefAlertCount: cache.orefAlerts?.alertCount ?? 0,
 advisoryCount: cache.advisories?.length ?? 0,
 bgpHijacks: comms?.bgp?.hijacks ?? 0,
 bgpLeaks: comms?.bgp?.leaks ?? 0,
 commsOverall: comms?.overall ?? 'unknown',
 },
 economics: {
 stressIndex: econ?.stressIndex ?? 0,
 stressTrend: econ?.trend ?? 'stable',
 yieldCurveSeverity: econ?.indicators?.yieldCurve?.label ?? 'UNKNOWN',
 vixSeverity: econ?.indicators?.vix?.label ?? 'UNKNOWN',
 foodSecuritySeverity: econ?.foodSecurity?.severity ?? 'unknown',
 fredKeyMissing: econ?.fredKeyMissing ?? true,
 },
 infrastructure: {
 commsOverall: comms?.overall ?? 'unknown',
 bgpSeverity: comms?.bgp?.severity ?? 'normal',
 ixpStatus: comms?.ixp?.status ?? 'normal',
 degradedCables:  comms?.cables?.degraded ?? [],
 internetOutages: cache.outages?.length ?? 0,
 },
 dataAgeMs: { security: 0, economics: 0, infrastructure: 0 },
  };
}

// ── Sidecar fetch ─────────────────────────────────────────────────────────────

interface SidecarBriefResponse {
  aiAvailable?: false;
  security?: IntelBriefDomain;
  economics?: IntelBriefDomain;
  infrastructure?: IntelBriefDomain;
  source?: BriefSource;
  sourceModel?: string;
}

export async function fetchIntelBrief(snapshot: IntelBriefSnapshot): Promise<IntelBriefResult | null> {
  const res = await fetch(`${getApiBaseUrl()}/api/intel-brief`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ snapshot }),
  });
  if (!res.ok) throw new Error(`intel-brief: ${res.status}`);
  const data = await res.json() as SidecarBriefResponse;
  if (data.aiAvailable === false) return null;
  if (!data.security || !data.economics || !data.infrastructure) {
 throw new Error('intel-brief: malformed AI response');
  }
  return {
 globalScore: 0, // caller overwrites with computeGlobalScore()
 security: data.security,
 economics: data.economics,
 infrastructure: data.infrastructure,
 generatedAt: new Date().toISOString(),
 source: data.source ?? 'ollama',
 sourceModel: data.sourceModel,
 mode: snapshot.mode,
  };
}
```

- [ ] **Step 2.2: Verify typecheck**

```bash
npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/services/intel-brief.ts
git commit -m "feat(services): add IntelBriefSnapshot/Result types, buildSnapshot, computeGlobalScore

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Create src/services/intel-brief-rules.ts + tests

Pure rule-based synthesis engine. No async, no imports from external services. Always succeeds. `buildEmptySnapshot` is also defined here.

**Files:**

- Create: `src/services/intel-brief-rules.ts`
- Create: `tests/intel-brief-rules.test.mts`

- [ ] **Step 3.1: Write the failing test first**

Create `tests/intel-brief-rules.test.mts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmptySnapshot, generateRuleBasedBrief } from '../src/services/intel-brief-rules.ts';
import { computeGlobalScore } from '../src/services/intel-brief.ts';

describe('buildEmptySnapshot', () => {
  it('returns all-zero snapshot with given mode', () => {
 const snap = buildEmptySnapshot('peace');
 assert.equal(snap.mode, 'peace');
 assert.equal(snap.security.militaryFlightClusters, 0);
 assert.equal(snap.economics.stressIndex, 0);
 assert.equal(snap.economics.fredKeyMissing, true);
 assert.equal(snap.infrastructure.commsOverall, 'unknown');
  });
});

describe('generateRuleBasedBrief — security', () => {
  it('critical when 3+ clusters and 10+ hijacks', () => {
 const snap = buildEmptySnapshot('war');
 snap.security.militaryFlightClusters = 4;
 snap.security.bgpHijacks = 14;
 const result = generateRuleBasedBrief(snap);
 assert.equal(result.security.severity, 'critical');
 assert.match(result.security.headline, /4 theaters/);
 assert.match(result.security.headline, /14 BGP/);
  });

  it('warning when 1 cluster', () => {
 const snap = buildEmptySnapshot('peace');
 snap.security.militaryFlightClusters = 1;
 assert.equal(generateRuleBasedBrief(snap).security.severity, 'warning');
  });

  it('warning when 5+ bgp hijacks', () => {
 const snap = buildEmptySnapshot('peace');
 snap.security.bgpHijacks = 5;
 assert.equal(generateRuleBasedBrief(snap).security.severity, 'warning');
  });

  it('warning when 5+ oref alerts (no clusters/hijacks)', () => {
 const snap = buildEmptySnapshot('peace');
 snap.security.orefAlertCount = 6;
 assert.equal(generateRuleBasedBrief(snap).security.severity, 'warning');
  });

  it('normal when nothing elevated', () => {
 const snap = buildEmptySnapshot('peace');
 assert.equal(generateRuleBasedBrief(snap).security.severity, 'normal');
  });
});

describe('generateRuleBasedBrief — economics', () => {
  it('unknown when fredKeyMissing', () => {
 const snap = buildEmptySnapshot('peace');
 snap.economics.fredKeyMissing = true;
 assert.equal(generateRuleBasedBrief(snap).economics.severity, 'unknown');
  });

  it('critical when stressIndex >= 85', () => {
 const snap = buildEmptySnapshot('peace');
 snap.economics.fredKeyMissing = false;
 snap.economics.stressIndex = 90;
 assert.equal(generateRuleBasedBrief(snap).economics.severity, 'critical');
 assert.match(generateRuleBasedBrief(snap).economics.headline, /90\/100/);
  });

  it('warning when stressIndex 70-84', () => {
 const snap = buildEmptySnapshot('peace');
 snap.economics.fredKeyMissing = false;
 snap.economics.stressIndex = 75;
 assert.equal(generateRuleBasedBrief(snap).economics.severity, 'warning');
  });

  it('normal when stressIndex < 70 and key present', () => {
 const snap = buildEmptySnapshot('peace');
 snap.economics.fredKeyMissing = false;
 snap.economics.stressIndex = 40;
 assert.equal(generateRuleBasedBrief(snap).economics.severity, 'normal');
  });
});

describe('generateRuleBasedBrief — infrastructure', () => {
  it('critical when commsOverall critical', () => {
 const snap = buildEmptySnapshot('disaster');
 snap.infrastructure.commsOverall = 'critical';
 assert.equal(generateRuleBasedBrief(snap).infrastructure.severity, 'critical');
  });

  it('warning when commsOverall warning', () => {
 const snap = buildEmptySnapshot('peace');
 snap.infrastructure.commsOverall = 'warning';
 assert.equal(generateRuleBasedBrief(snap).infrastructure.severity, 'warning');
  });

  it('warning when 3+ internet outages', () => {
 const snap = buildEmptySnapshot('peace');
 snap.infrastructure.internetOutages = 4;
 assert.equal(generateRuleBasedBrief(snap).infrastructure.severity, 'warning');
  });

  it('normal when all normal', () => {
 const snap = buildEmptySnapshot('peace');
 snap.infrastructure.commsOverall = 'normal';
 assert.equal(generateRuleBasedBrief(snap).infrastructure.severity, 'normal');
  });
});

describe('generateRuleBasedBrief — result shape', () => {
  it('source is always rules', () => {
 assert.equal(generateRuleBasedBrief(buildEmptySnapshot('peace')).source, 'rules');
  });

  it('mode is preserved', () => {
 assert.equal(generateRuleBasedBrief(buildEmptySnapshot('war')).mode, 'war');
  });

  it('generatedAt is a valid ISO timestamp', () => {
 const { generatedAt } = generateRuleBasedBrief(buildEmptySnapshot('peace'));
 assert.ok(!isNaN(Date.parse(generatedAt)));
  });
});

describe('computeGlobalScore', () => {
  it('returns 0 for fully empty snapshot', () => {
 const snap = buildEmptySnapshot('peace');
 snap.economics.stressIndex = 0;
 assert.equal(computeGlobalScore(snap), 0);
  });

  it('increases with military clusters', () => {
 const snap  = buildEmptySnapshot('war');
 snap.security.militaryFlightClusters = 5;
 const snap2 = buildEmptySnapshot('war');
 snap2.security.militaryFlightClusters = 0;
 assert.ok(computeGlobalScore(snap) > computeGlobalScore(snap2));
  });

  it('never exceeds 100 at max inputs', () => {
 const snap = buildEmptySnapshot('war');
 snap.security.militaryFlightClusters = 100;
 snap.security.bgpHijacks = 500;
 snap.security.protestEvents = 1000;
 snap.economics.stressIndex = 100;
 snap.infrastructure.commsOverall = 'critical';
 snap.infrastructure.internetOutages = 100;
 assert.ok(computeGlobalScore(snap) <= 100);
  });
});
```

- [ ] **Step 3.2: Run test to confirm it fails (module not found)**

```bash
npm run test:data -- tests/intel-brief-rules.test.mts
```

Expected: FAIL — `intel-brief-rules.ts` does not exist yet.

- [ ] **Step 3.3: Create src/services/intel-brief-rules.ts**

```typescript
import type { AppMode } from '@/services/mode-manager';
import type { IntelBriefSnapshot, IntelBriefResult, IntelBriefDomain } from './intel-brief';

export function buildEmptySnapshot(mode: AppMode): IntelBriefSnapshot {
  return {
 mode,
 security: {
 militaryFlightClusters: 0,
 protestEvents: 0,
 orefAlertCount: 0,
 advisoryCount: 0,
 bgpHijacks: 0,
 bgpLeaks: 0,
 commsOverall: 'unknown',
 },
 economics: {
 stressIndex: 0,
 stressTrend: 'stable',
 yieldCurveSeverity: 'UNKNOWN',
 vixSeverity: 'UNKNOWN',
 foodSecuritySeverity: 'unknown',
 fredKeyMissing: true,
 },
 infrastructure: {
 commsOverall: 'unknown',
 bgpSeverity: 'normal',
 ixpStatus: 'normal',
 degradedCables: [],
 internetOutages: 0,
 },
 dataAgeMs: { security: 0, economics: 0, infrastructure: 0 },
  };
}

function securityDomain(s: IntelBriefSnapshot['security']): IntelBriefDomain {
  const { militaryFlightClusters: mfc, bgpHijacks, orefAlertCount, commsOverall } = s;
  if (mfc >= 3 && bgpHijacks >= 10) {
 return {
 severity: 'critical',
 headline: `${mfc} theaters active, ${bgpHijacks} BGP hijacks`,
 analysis: `Military flight clusters active across ${mfc} theaters with ${bgpHijacks} BGP hijack events indicating potential coordinated infrastructure disruption. ${commsOverall === 'critical' ? 'Communications networks severely degraded.' : 'Recommend elevated cyber posture.'}`,
 };
  }
  if (mfc >= 1 || bgpHijacks >= 5) {
 return {
 severity: 'warning',
 headline: 'Elevated military and network activity',
 analysis: `${mfc > 0 ? `${mfc} military flight cluster(s) active. ` : ''}${bgpHijacks > 0 ? `${bgpHijacks} BGP anomalies detected. ` : ''}Monitor for escalation.`.trim(),
 };
  }
  if (orefAlertCount >= 5) {
 return {
 severity: 'warning',
 headline: `${orefAlertCount} active sirens`,
 analysis: `Active alert sirens in ${orefAlertCount} zones. Potential kinetic activity.`,
 };
  }
  return {
 severity: 'normal',
 headline: 'No significant security anomalies',
 analysis: 'Security indicators within normal parameters. No major military or network disruptions detected.',
  };
}

function economicsDomain(e: IntelBriefSnapshot['economics']): IntelBriefDomain {
  const { stressIndex, stressTrend, yieldCurveSeverity, vixSeverity, foodSecuritySeverity, fredKeyMissing } = e;
  if (fredKeyMissing) {
 return {
 severity: 'unknown',
 headline: 'FRED key required',
 analysis: 'Economic stress data unavailable. Add FRED_API_KEY in Settings to enable economic monitoring.',
 };
  }
  if (stressIndex >= 85) {
 return {
 severity: 'critical',
 headline: `Economic stress critical — ${stressIndex}/100`,
 analysis: `Economic stress index at ${stressIndex}/100. Yield curve ${yieldCurveSeverity}, VIX ${vixSeverity}. Financial system under severe strain. Potential systemic risk.`,
 };
  }
  if (stressIndex >= 70) {
 return {
 severity: 'warning',
 headline: `Economic stress elevated — ${stressIndex}/100`,
 analysis: `Economic stress index at ${stressIndex}/100 and ${stressTrend}. Key indicators: yield curve ${yieldCurveSeverity}, financial stress index elevated. Monitor for continued deterioration.`,
 };
  }
  return {
 severity: 'normal',
 headline: `Economic indicators stable — ${stressIndex}/100`,
 analysis: `Economic stress index at ${stressIndex}/100. Markets functioning normally.${foodSecuritySeverity !== 'normal' ? ' Note: global food security showing pressure.' : ''}`,
  };
}

function infrastructureDomain(i: IntelBriefSnapshot['infrastructure']): IntelBriefDomain {
  const { commsOverall, degradedCables, bgpSeverity, ixpStatus, internetOutages } = i;
  if (commsOverall === 'critical') {
 return {
 severity: 'critical',
 headline: 'Critical infrastructure disruption',
 analysis: `${degradedCables.length > 0 ? degradedCables.join(', ') + ' submarine cable(s) degraded. ' : ''}BGP routing ${bgpSeverity}. ${internetOutages > 0 ? `${internetOutages} internet outages active.` : ''} Critical communications impact.`.trim(),
 };
  }
  if (commsOverall === 'warning' || internetOutages >= 3) {
 return {
 severity: 'warning',
 headline: 'Infrastructure degradation detected',
 analysis: `Communications network degraded. BGP ${bgpSeverity}, IXP ${ixpStatus}. ${internetOutages > 0 ? `${internetOutages} internet outages.` : 'No major outages.'}`,
 };
  }
  return {
 severity: 'normal',
 headline: 'Infrastructure operating normally',
 analysis: 'Communications and internet infrastructure within normal parameters. No significant disruptions detected.',
  };
}

export function generateRuleBasedBrief(snapshot: IntelBriefSnapshot): IntelBriefResult {
  return {
 globalScore: 0, // caller overwrites with computeGlobalScore()
 security: securityDomain(snapshot.security),
 economics: economicsDomain(snapshot.economics),
 infrastructure: infrastructureDomain(snapshot.infrastructure),
 generatedAt: new Date().toISOString(),
 source: 'rules',
 mode: snapshot.mode,
  };
}
```

- [ ] **Step 3.4: Run tests — verify all pass**

```bash
npm run test:data -- tests/intel-brief-rules.test.mts
```

Expected: all tests PASS.

- [ ] **Step 3.5: Typecheck**

```bash
npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 3.6: Commit**

```bash
git add src/services/intel-brief-rules.ts tests/intel-brief-rules.test.mts
git commit -m "feat(services): add rule-based Intel Brief synthesis engine with tests

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Sidecar + Panel + Wiring

### Task 4: Sidecar POST /api/intel-brief

Add the 3-provider AI chain (Ollama → Groq → OpenRouter) to the sidecar. Returns domain objects + source/model metadata when AI succeeds, or `{ aiAvailable: false }` when all providers are unavailable or unconfigured.

**Files:**

- Modify: `src-tauri/sidecar/local-api-server.mjs`
- Modify: `src-tauri/sidecar/local-api-server.test.mjs` (add test)

- [ ] **Step 4.1: Write the failing test first**

Open `src-tauri/sidecar/local-api-server.test.mjs`. Add these tests at the end of the file (top-level `test()` calls, same level as existing tests):

```javascript
test('POST /api/intel-brief — returns aiAvailable:false when no providers configured', async () => {
  const server = createLocalApiServer({ env: {} });
  const port = await listen(server);
  try {
 const snapshot = {
 mode: 'peace',
 security: { militaryFlightClusters: 0, protestEvents: 0, orefAlertCount: 0, advisoryCount: 0, bgpHijacks: 0, bgpLeaks: 0, commsOverall: 'unknown' },
 economics: { stressIndex: 0, stressTrend: 'stable', yieldCurveSeverity: 'UNKNOWN', vixSeverity: 'UNKNOWN', foodSecuritySeverity: 'unknown', fredKeyMissing: true },
 infrastructure: { commsOverall: 'unknown', bgpSeverity: 'normal', ixpStatus: 'normal', degradedCables: [], internetOutages: 0 },
 dataAgeMs: { security: 0, economics: 0, infrastructure: 0 },
 };
 const result = await postJsonViaHttp(`http://127.0.0.1:${port}/api/intel-brief`, { snapshot });
 assert.equal(result.status, 200);
 assert.equal(result.body.aiAvailable, false);
  } finally {
 server.close();
  }
});

test('POST /api/intel-brief — returns 400 on missing snapshot', async () => {
  const server = createLocalApiServer({ env: {} });
  const port = await listen(server);
  try {
 const result = await postJsonViaHttp(`http://127.0.0.1:${port}/api/intel-brief`, {});
 assert.equal(result.status, 400);
  } finally {
 server.close();
  }
});
```

- [ ] **Step 4.2: Run tests to confirm they fail (route not yet added)**

```bash
node --test src-tauri/sidecar/local-api-server.test.mjs 2>&1 | tail -20
```

Expected: new tests FAIL — route not found.

- [ ] **Step 4.3: Add POST /api/intel-brief route to the sidecar**

In `src-tauri/sidecar/local-api-server.mjs`, find the `/api/economic-stress` route block and insert the new route immediately after it:

```javascript
  if (requestUrl.pathname === '/api/intel-brief' && req.method === 'POST') {
 const body = await readBody(req);
 if (!body) {
 res.writeHead(400, { 'content-type': 'application/json' });
 res.end(JSON.stringify({ error: 'expected JSON body' }));
 return;
 }

 let snapshot;
 try {
 ({ snapshot } = JSON.parse(body.toString()));
 } catch {
 res.writeHead(400, { 'content-type': 'application/json' });
 res.end(JSON.stringify({ error: 'invalid JSON' }));
 return;
 }

 if (!snapshot || typeof snapshot !== 'object') {
 res.writeHead(400, { 'content-type': 'application/json' });
 res.end(JSON.stringify({ error: 'snapshot required' }));
 return;
 }

 const mode = String(snapshot.mode || 'peace').slice(0, 20);
 const sec = snapshot.security || {};
 const econ = snapshot.economics || {};
 const infra = snapshot.infrastructure || {};
 const cables = Array.isArray(infra.degradedCables) ? infra.degradedCables : [];

 const systemPrompt = `You are a senior intelligence analyst giving a classified briefing. Current threat posture: ${mode}.

SIGNALS SNAPSHOT:
Security: ${Number(sec.militaryFlightClusters) || 0} military clusters | ${Number(sec.protestEvents) || 0} protest events | ${Number(sec.bgpHijacks) || 0} BGP hijacks | ${Number(sec.advisoryCount) || 0} advisories
Economics: Stress ${Number(econ.stressIndex) || 0}/100 (${String(econ.stressTrend || 'stable')}) | Yield ${String(econ.yieldCurveSeverity || 'UNKNOWN')} | VIX ${String(econ.vixSeverity || 'UNKNOWN')} | Food security ${String(econ.foodSecuritySeverity || 'unknown')}
Infrastructure: Comms ${String(infra.commsOverall || 'unknown')} | ${cables.length} cables degraded | IXP ${String(infra.ixpStatus || 'normal')} | ${Number(infra.internetOutages) || 0} internet outages

Respond with ONLY valid JSON — no prose, no markdown:
{"security":{"severity":"normal|warning|critical","headline":"<10 words>","analysis":"<2-3 sentences>"},"economics":{"severity":"normal|warning|critical","headline":"<10 words>","analysis":"<2-3 sentences>"},"infrastructure":{"severity":"normal|warning|critical","headline":"<10 words>","analysis":"<2-3 sentences>"}}`;

 const messages = [{ role: 'user', content: systemPrompt }];

 // Layer 1: Ollama (10s timeout)
 const ollamaUrl = process.env.OLLAMA_API_URL;
 if (ollamaUrl) {
 try {
 const rawModel = process.env.OLLAMA_MODEL || 'llama3.1:8b';
 const model = /^[a-zA-Z0-9._:/-]{1,80}$/.test(rawModel) ? rawModel : 'llama3.1:8b';
 const apiUrl = new URL('/v1/chat/completions', ollamaUrl).toString();
 const ollamaRes = await fetchWithTimeout(apiUrl, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ model, messages, stream: false }),
 }, 10000);
 if (ollamaRes.ok) {
 const data = await ollamaRes.json();
 const text = String(data?.choices?.[0]?.message?.content || '');
 const parsed = JSON.parse(text.trim());
 if (parsed.security && parsed.economics && parsed.infrastructure) {
 return json({ ...parsed, source: 'ollama', sourceModel: model });
 }
 }
 } catch { /* try next provider */ }
 }

 // Layer 2: Groq (10s timeout)
 const groqKey = process.env.GROQ_API_KEY;
 if (groqKey) {
 try {
 const groqRes = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 Authorization: `Bearer ${groqKey}`,
 'User-Agent': CHROME_UA,
 },
 body: JSON.stringify({ model: 'llama3-70b-8192', messages, stream: false }),
 }, 10000);
 if (groqRes.ok) {
 const data = await groqRes.json();
 const text = String(data?.choices?.[0]?.message?.content || '');
 const parsed = JSON.parse(text.trim());
 if (parsed.security && parsed.economics && parsed.infrastructure) {
 return json({ ...parsed, source: 'groq', sourceModel: 'llama3-70b-8192' });
 }
 }
 } catch { /* try next provider */ }
 }

 // Layer 3: OpenRouter (15s timeout)
 const orKey = process.env.OPENROUTER_API_KEY;
 if (orKey) {
 try {
 const orRes = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 Authorization: `Bearer ${orKey}`,
 'User-Agent': CHROME_UA,
 },
 body: JSON.stringify({ model: 'meta-llama/llama-3-70b-instruct', messages, stream: false }),
 }, 15000);
 if (orRes.ok) {
 const data = await orRes.json();
 const text = String(data?.choices?.[0]?.message?.content || '');
 const parsed = JSON.parse(text.trim());
 if (parsed.security && parsed.economics && parsed.infrastructure) {
 return json({ ...parsed, source: 'openrouter' });
 }
 }
 } catch { /* all providers failed */ }
 }

 return json({ aiAvailable: false });
  }
```

> **Note on `json()` helper:** The existing sidecar uses `return json(data)` which calls `res.writeHead(200)` + `res.end(JSON.stringify(data))`. Match this pattern exactly. The `return` exits the route handler, preventing fall-through to the 404 handler.

- [ ] **Step 4.4: Run sidecar tests — verify new tests pass**

```bash
node --test src-tauri/sidecar/local-api-server.test.mjs 2>&1 | tail -30
```

Expected: all tests PASS including the two new intel-brief tests.

- [ ] **Step 4.5: Commit**

```bash
git add src-tauri/sidecar/local-api-server.mjs src-tauri/sidecar/local-api-server.test.mjs
git commit -m "feat(sidecar): add POST /api/intel-brief with Ollama/Groq/OpenRouter chain

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Create src/components/IntelBriefPanel.ts

Panel renders immediately on construction from localStorage cache or a synchronous rule-based brief. `update(result)` is the only public data method. Click handling uses event delegation. The panel dispatches `wm:intel-brief-refresh` on ↻ click — `App.ts` handles it.

**XSS note:** All AI-sourced or API-sourced strings (`headline`, `analysis`, `sourceModel`) are passed through `esc()` before being placed in markup. Numbers and severity labels are code-controlled and do not need escaping.

**Files:**

- Create: `src/components/IntelBriefPanel.ts`
- Modify: `src/components/index.ts`

- [ ] **Step 5.1: Create the file**

Create `src/components/IntelBriefPanel.ts`:

```typescript
import { Panel } from './Panel';
import type { IntelBriefResult, BriefSeverity, BriefSource } from '@/services/intel-brief';
import {
  loadIntelBriefCache,
  getIntelBriefCacheAgeMs,
  computeGlobalScore,
} from '@/services/intel-brief';
import { buildEmptySnapshot, generateRuleBasedBrief } from '@/services/intel-brief-rules';
import { getMode } from '@/services/mode-manager';

type Domain = 'security' | 'economics' | 'infrastructure';

// Escapes user/AI-sourced strings before insertion into markup.
function esc(v: string | number): string {
  return String(v)
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;');
}

const SEV_COLOR: Record<BriefSeverity, string> = {
  normal: '#22c55e',
  warning:  '#eab308',
  critical: '#ef4444',
  unknown:  '#64748b',
};

const SEV_BG: Record<BriefSeverity, string> = {
  normal: 'rgba(34,197,94,0.15)',
  warning:  'rgba(234,179,8,0.15)',
  critical: 'rgba(239,68,68,0.15)',
  unknown:  'rgba(100,116,139,0.15)',
};

function scoreLabel(score: number): string {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'ELEVATED';
  return 'LOW';
}

function sourceText(source: BriefSource, model?: string): string {
  switch (source) {
 case 'ollama': return `\u25CF Ollama \u00B7 ${model ?? 'llama3.1:8b'}`;
 case 'groq': return `\u25CF Groq \u00B7 llama3-70b`;
 case 'openrouter':  return `\u25CF OpenRouter`;
 case 'rules': return `\u25CC Rule-based`;
 case 'cache': return `\u25CC Cached`;
  }
}

function sourceDotColor(source: BriefSource): string {
  if (source === 'ollama') return '#3b82f6';
  if (source === 'groq' || source === 'openrouter') return '#a855f7';
  return '#22c55e';
}

export class IntelBriefPanel extends Panel {
  private _expandedDomain: Domain | null = null;

  constructor() {
 super({ id: 'intel-brief', title: 'Intel Brief' });

 // Cold-start: show cached or rule-based result immediately — never blank
 const cached = loadIntelBriefCache();
 if (cached) {
 this._render(cached);
 } else {
 const emptySnap = buildEmptySnapshot(getMode());
 const initial = generateRuleBasedBrief(emptySnap);
 initial.globalScore = computeGlobalScore(emptySnap);
 this._render(initial);
 }

 // Event delegation for expand/collapse and manual refresh
 this.getContentElement().addEventListener('click', (e) => {
 const toggleEl = (e.target as HTMLElement).closest<HTMLElement>('[data-toggle]');
 if (toggleEl) {
 const domain = toggleEl.dataset.toggle as Domain;
 this._expandedDomain = this._expandedDomain === domain ? null : domain;
 this._updateExpandState();
 return;
 }
 if ((e.target as HTMLElement).closest('[data-refresh]')) {
 document.dispatchEvent(new CustomEvent('wm:intel-brief-refresh'));
 }
 });
  }

  update(result: IntelBriefResult): void {
 this._render(result);
  }

  private _domainCard(key: Domain, domain: IntelBriefResult['security'], label: string): string {
 const sev = domain.severity;
 const expanded = this._expandedDomain === key;
 return `
<div style="border:1px solid ${SEV_COLOR[sev]}33;border-radius:6px;overflow:hidden;background:${SEV_BG[sev]};">
  <div data-toggle="${key}" style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.6rem;cursor:pointer;user-select:none;">
 <div style="flex:1;min-width:0;">
 <div style="font-size:0.65rem;letter-spacing:0.08em;opacity:0.6;font-weight:600;">${label}</div>
 <div style="font-size:0.72rem;font-weight:700;color:${SEV_COLOR[sev]};margin-top:0.1rem;">${sev.toUpperCase()}</div>
 <div style="font-size:0.68rem;opacity:0.75;margin-top:0.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(domain.headline)}</div>
 </div>
 <span style="font-size:0.7rem;opacity:0.5;flex-shrink:0;">${expanded ? '\u25B2' : '\u25BC'}</span>
  </div>
  <div data-analysis="${key}" style="display:${expanded ? 'block' : 'none'};padding:0 0.6rem 0.5rem;border-top:1px solid ${SEV_COLOR[sev]}22;">
 <p style="font-size:0.7rem;line-height:1.5;opacity:0.85;margin:0.4rem 0 0;">${esc(domain.analysis)}</p>
  </div>
</div>`;
  }

  private _render(result: IntelBriefResult): void {
 const el = this.getContentElement();
 const score = result.globalScore;
 const scoreColor = score >= 70 ? '#ef4444' : score >= 40 ? '#eab308' : '#22c55e';
 const ageMs  = getIntelBriefCacheAgeMs();
 const ageMin = ageMs != null ? Math.round(ageMs / 60000) : null;
 const staleWarning = ageMs != null && ageMs > 30 * 60 * 1000
 ? `<span style="color:#eab308;font-size:0.65rem;margin-left:0.5rem;">Data ${ageMin}m old</span>`
 : '';

 const dotColor = sourceDotColor(result.source);
 // sourceModel is code-controlled (returned by sidecar from env var / const) — esc for defence in depth
 const src = esc(sourceText(result.source, result.sourceModel));

 el.innerHTML = `
<div style="padding:0.75rem;display:flex;flex-direction:column;gap:0.6rem;">
  <div style="display:flex;align-items:center;gap:0.6rem;">
 <span style="font-size:1.5rem;font-weight:800;color:${scoreColor};line-height:1;">${score}</span>
 <div style="flex:1;">
 <div style="font-size:0.65rem;opacity:0.55;margin-bottom:0.2rem;">GLOBAL THREAT SCORE</div>
 <div style="position:relative;height:7px;background:linear-gradient(to right,#22c55e 0%,#eab308 40%,#ef4444 70%,#ef4444 100%);border-radius:4px;">
 <div style="position:absolute;top:-3px;left:${Math.min(score, 99)}%;transform:translateX(-50%);width:3px;height:13px;background:#fff;border-radius:2px;box-shadow:0 0 3px rgba(0,0,0,0.5);"></div>
 </div>
 </div>
 <span style="font-size:0.7rem;font-weight:700;color:${scoreColor};">${scoreLabel(score)}</span>
  </div>
  <div style="display:flex;flex-direction:column;gap:0.4rem;">
 ${this._domainCard('security', result.security, 'SECURITY')}
 ${this._domainCard('economics', result.economics, 'ECONOMICS')}
 ${this._domainCard('infrastructure', result.infrastructure, 'INFRASTRUCTURE')}
  </div>
  <div style="display:flex;align-items:center;gap:0.4rem;padding-top:0.3rem;border-top:1px solid rgba(255,255,255,0.08);">
 <span style="font-size:0.72rem;color:${dotColor};">${src}</span>
 ${staleWarning}
 <div style="flex:1;"></div>
 <button data-refresh style="background:none;border:none;color:inherit;opacity:0.5;cursor:pointer;font-size:0.85rem;padding:0.1rem 0.3rem;" title="Refresh Intel Brief">&#8635;</button>
  </div>
</div>`;
  }

  private _updateExpandState(): void {
 const el = this.getContentElement();
 for (const dom of ['security', 'economics', 'infrastructure'] as const) {
 const analysisEl = el.querySelector<HTMLElement>(`[data-analysis="${dom}"]`);
 const arrowEl = el.querySelector<HTMLElement>(`[data-toggle="${dom}"] span`);
 if (analysisEl) analysisEl.style.display = this._expandedDomain === dom ? 'block' : 'none';
 if (arrowEl) arrowEl.textContent = this._expandedDomain === dom ? '\u25B2' : '\u25BC';
 }
  }
}
```

- [ ] **Step 5.2: Export from components index**

Open `src/components/index.ts`. Add:

```typescript
export * from './IntelBriefPanel';
```

- [ ] **Step 5.3: Typecheck**

```bash
npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 5.4: Commit**

```bash
git add src/components/IntelBriefPanel.ts src/components/index.ts
git commit -m "feat(components): add IntelBriefPanel with score bar, domain cards, expand/collapse

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Wiring — panels.ts, panel-layout.ts, data-loader.ts, App.ts

**Files:**

- Modify: `src/config/panels.ts`
- Modify: `src/app/panel-layout.ts`
- Modify: `src/app/data-loader.ts`
- Modify: `src/App.ts`

- [ ] **Step 6.1: Register panel in panels.ts**

In `src/config/panels.ts`:

1. After `'economic-stress': { name: 'Economic Stress Index', enabled: true, priority: 1 },` add:

```typescript
  'intel-brief': { name: 'Intel Brief', enabled: true, priority: 1 },
```

1. Find the `intelligence` entry in `PANEL_CATEGORY_MAP`. Add `'intel-brief'` at the front of `panelKeys`:

```typescript
  intelligence: {
 labelKey: 'header.panelCatIntelligence',
 panelKeys: ['intel-brief', 'alert-center', 'cii', 'strategic-risk', 'intel', 'gdelt-intel', 'cascade', 'telegram-intel'],
 variants: ['full'],
  },
```

- [ ] **Step 6.2: Add to priority lists and createPanels() in panel-layout.ts**

1. Add import with the other component imports:

```typescript
import { IntelBriefPanel } from '@/components/IntelBriefPanel';
```

1. In `WAR_PRIORITY` (around line 114), append `'intel-brief'` after `'comms-health'`:

```
'cii', 'satellite-fires', 'ucdp-events', 'displacement', 'space-weather', 'comms-health', 'intel-brief',
```

1. In `DISASTER_PRIORITY` (around line 121), append `'intel-brief'` after `'economic-stress'`:

```
'oref-sirens', 'weather', 'air-quality', 'comms-health', 'economic-stress', 'intel-brief',
```

1. In `createPanels()`, after the `economic-stress` panel line:

```typescript
 this.ctx.panels['intel-brief'] = new IntelBriefPanel();
```

- [ ] **Step 6.3: Update data-loader.ts**

1. Add `getMode` to the existing mode-manager import (line 61):

```typescript
import { evaluateWarThreat, evaluateFinanceTrigger, evaluateCommodityTrigger, evaluateDisasterTrigger, checkFinanceAutoTriggerTimeout, getMode } from '@/services/mode-manager';
```

1. Add new service imports near the existing comms-health/economic-stress imports:

```typescript
import { fetchCommsHealth, setLastCommsHealth } from '@/services/comms-health';
import { fetchEconomicStress, setLastEconomicStress } from '@/services/economic-stress';
import { buildSnapshot, fetchIntelBrief, computeGlobalScore, saveIntelBriefCache } from '@/services/intel-brief';
import { generateRuleBasedBrief } from '@/services/intel-brief-rules';
import type { IntelBriefPanel } from '@/components/IntelBriefPanel';
```

> **Note:** `fetchCommsHealth` and `fetchEconomicStress` are likely already imported. Only add the new names (`setLastCommsHealth`, `setLastEconomicStress`, and the intel-brief imports). Check the existing import lines and extend them.

1. In `loadCommsHealth()`, add `setLastCommsHealth(data)` after the fetch:

```typescript
  async loadCommsHealth(): Promise<void> {
 try {
 const data = await fetchCommsHealth();
 setLastCommsHealth(data);
 (this.ctx.panels['comms-health'] as CommsHealthPanel)?.update(data);
 } catch (error) {
 console.warn('[comms-health] fetch failed', error);
 (this.ctx.panels['comms-health'] as CommsHealthPanel)?.update(null);
 }
  }
```

1. In `loadEconomicStress()`, add `setLastEconomicStress(data)` after the fetch:

```typescript
  async loadEconomicStress(): Promise<void> {
 try {
 const data = await fetchEconomicStress();
 setLastEconomicStress(data);
 (this.ctx.panels['economic-stress'] as EconomicStressPanel)?.update(data);
 } catch (error) {
 console.warn('[economic-stress] fetch failed', error);
 (this.ctx.panels['economic-stress'] as EconomicStressPanel)?.update(null);
 }
  }
```

1. After `loadEconomicStress()`, add:

```typescript
  async loadIntelBrief(): Promise<void> {
 const snapshot = buildSnapshot(this.ctx.intelligenceCache, getMode());
 let result = null;
 try {
 result = await fetchIntelBrief(snapshot);
 } catch { /* sidecar unreachable — use rule-based */ }
 if (!result) {
 result = generateRuleBasedBrief(snapshot);
 }
 result.globalScore = computeGlobalScore(snapshot);
 (this.ctx.panels['intel-brief'] as IntelBriefPanel)?.update(result);
 saveIntelBriefCache(result);
  }
```

- [ ] **Step 6.4: Wire scheduleRefresh and listeners in App.ts**

1. Add import with the other panel type imports:

```typescript
import type { IntelBriefPanel } from '@/components/IntelBriefPanel';
```

1. In `setupRefreshIntervals()`, in the batch array after the `economicStress` entry (around line 538), add:

```typescript
 { name: 'intelBrief', fn: () => this.dataLoader.loadIntelBrief(), intervalMs: 15 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
```

1. Near the end of `setupRefreshIntervals()` (after the batch `if` block closes), add:

```typescript
 if (SITE_VARIANT === 'full') {
 document.addEventListener('wm:mode-changed', () => {
 void this.dataLoader.loadIntelBrief();
 });
 document.addEventListener('wm:intel-brief-refresh', () => {
 void this.dataLoader.loadIntelBrief();
 });
 }
```

- [ ] **Step 6.5: Typecheck — must be zero errors**

```bash
npm run typecheck:all
```

Expected: zero errors. Fix any errors before continuing.

- [ ] **Step 6.6: Run all tests**

```bash
npm run test:data && npm run test:sidecar
```

Expected: all tests pass.

- [ ] **Step 6.7: Commit wiring**

```bash
git add src/config/panels.ts src/app/panel-layout.ts src/app/data-loader.ts src/App.ts
git commit -m "feat: wire Intel Brief panel into config, scheduler, and mode-change handler

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] **Step 7.1: Full typecheck**

```bash
npm run typecheck:all
```

Expected: zero errors.

- [ ] **Step 7.2: All tests pass**

```bash
npm run test:data && npm run test:sidecar
```

Expected: all pass.

- [ ] **Step 7.3: Manual acceptance criteria checklist**

Launch dev mode (`npm run dev`) and verify:

- [ ] Panel appears immediately on load (score bar + 3 domain cards visible — never blank)
- [ ] Collapsed cards show severity badge + headline
- [ ] Clicking a card expands it to show analysis text
- [ ] Clicking the same card again collapses it
- [ ] Clicking a different card collapses the previous one
- [ ] Source indicator shows `◌ Rule-based` (or `◌ Cached`) on cold start
- [ ] ↻ button visible in panel footer
- [ ] After load, `crystalball-intel-brief-cache` key exists in localStorage (DevTools > Application)
- [ ] Global score bar needle moves to correct position
- [ ] `SUPPORTED_SECRET_KEYS` count in `src-tauri/src/main.rs` still = 25 (no new keys added)
