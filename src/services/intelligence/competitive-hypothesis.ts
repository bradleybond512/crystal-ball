/**
 * Competitive Hypothesis Engine — for each Situation, generates 2-3
 * competing explanations (primary / alternative / devil-advocate) and
 * scores them against incoming evidence.
 *
 * The engine prevents anchoring on the first plausible explanation by
 * forcing the system to carry at least one alternative and one
 * contrarian framing alongside the leading hypothesis. Evidence
 * additions nudge confidences and re-normalize the set so the three
 * confidences continue to sum to 1.0; consensus is only declared when
 * one hypothesis pulls clearly ahead.
 *
 * Pure module — no DOM, no fetch, no globals at import time.
 * Persists sets to localStorage under `wm-hypothesis-sets`
 * (LIFO ring buffer, capped at 200 sets).
 */

// ── Public types ──────────────────────────────────────────────────────

export type HypothesisType = 'primary' | 'alternative' | 'devil-advocate';

export type HypothesisStatus = 'active' | 'supported' | 'refuted' | 'merged';

export type EvidenceAlignment = 'supporting' | 'contradicting' | 'neutral';

export interface HypothesisEvidence {
  evidenceId: string;
  alignment: EvidenceAlignment;
  /** 0-1 — how strongly this piece of evidence weighs in. */
  weight: number;
}

export interface Hypothesis {
  id: string;
  situationId: string;
  type: HypothesisType;
  claim: string;
  rationale: string;
  /** 0-1; sums to 1.0 across the set after re-normalization. */
  confidence: number;
  status: HypothesisStatus;
  evidence: HypothesisEvidence[];
  createdAt: number;
  updatedAt: number;
}

export interface HypothesisSet {
  situationId: string;
  hypotheses: Hypothesis[];
  leadingHypothesis: Hypothesis | null;
  /** True iff the leading hypothesis is > 0.7 AND every other is < 0.4. */
  consensusReached: boolean;
}

export type HypothesisSetListener = (set: HypothesisSet) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface CompetitiveHypothesisEngineOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-hypothesis-sets';
export const MAX_SETS = 200;

export const INITIAL_CONFIDENCE: Record<HypothesisType, number> = {
  primary: 0.6,
  alternative: 0.3,
  'devil-advocate': 0.1,
};

export const CONFIDENCE_CEILING = 0.95;
export const CONFIDENCE_FLOOR = 0.05;
export const EVIDENCE_STEP = 0.1;
export const CONSENSUS_LEAD_FLOOR = 0.7;
export const CONSENSUS_OTHERS_CEILING = 0.4;

// ── Domain templates ─────────────────────────────────────────────────

interface HypothesisTemplate {
  claim: string;
  rationale: string;
}

interface DomainTemplate {
  primary: HypothesisTemplate;
  alternative: HypothesisTemplate;
  'devil-advocate': HypothesisTemplate;
}

const GENERIC_TEMPLATE: DomainTemplate = {
  primary: {
    claim: 'Event is a genuine, independently-caused incident',
    rationale: 'Default explanation when no domain-specific framing is available — treat the signal at face value.',
  },
  alternative: {
    claim: 'Event is a downstream consequence of a separate, larger driver',
    rationale: 'The reported incident may be a secondary effect rather than the root cause; check for cascading triggers.',
  },
  'devil-advocate': {
    claim: 'Event is an artifact of measurement or reporting bias',
    rationale: 'Treat the signal sceptically — sensor calibration, source incentives, or selection effects could be inflating it.',
  },
};

const DOMAIN_TEMPLATES: Record<string, DomainTemplate> = {
  earthquake: {
    primary: {
      claim: 'Tectonic stress release along an active fault line',
      rationale: 'The most likely cause for an earthquake signal in the absence of contrary evidence: accumulated tectonic stress releasing along a known fault.',
    },
    alternative: {
      claim: 'Secondary aftershock cascade from a recent major event',
      rationale: 'Strong recent quakes within ~500 km can produce a several-day aftershock sequence — this could be one of those rather than a fresh main shock.',
    },
    'devil-advocate': {
      claim: 'Reported magnitude is overstated due to sensor proximity bias',
      rationale: 'A single nearby seismic station can amplify the local response and overstate the regional magnitude; cross-check distant stations before treating it as a major event.',
    },
  },
  biosurv: {
    primary: {
      claim: 'Genuine outbreak with sustained human-to-human transmission',
      rationale: 'Default framing when case counts climb in a defined geography — assume a real cluster and respond accordingly.',
    },
    alternative: {
      claim: 'Improved surveillance or testing capacity is unmasking baseline prevalence',
      rationale: 'A jump in detected cases can reflect more aggressive testing rather than a true increase; cross-check positivity rate and sample throughput.',
    },
    'devil-advocate': {
      claim: 'Cluster is misclassified — laboratory contamination or syndromic overlap',
      rationale: 'Lab contamination and overlapping clinical presentations can produce apparent clusters that disappear under confirmatory testing.',
    },
  },
  weather: {
    primary: {
      claim: 'Synoptic-scale system tracking as numerical models predict',
      rationale: 'Most weather alerts trace back to a clearly-modelled cyclone, front, or trough already in the operational forecast.',
    },
    alternative: {
      claim: 'Mesoscale convective complex amplifying beyond NWP guidance',
      rationale: 'Small-scale convective systems can intensify faster than global models resolve; treat as potentially more severe than the headline forecast.',
    },
    'devil-advocate': {
      claim: 'Alert is driven by a single noisy observation, not a coherent atmospheric structure',
      rationale: 'A lone radar artifact or station spike can trigger downstream alerts even when the broader pattern doesn\'t support the headline severity.',
    },
  },
  maritime: {
    primary: {
      claim: 'Reported vessel is operating as observed with normal commercial intent',
      rationale: 'AIS and routing data align with the vessel\'s declared trade — no exceptional explanation required.',
    },
    alternative: {
      claim: 'Vessel is engaging in evasive behavior (AIS spoofing, dark activity)',
      rationale: 'Pattern of AIS gaps, track inconsistencies, or anomalous loiter time may indicate evasion of sanctions, smuggling, or illegal fishing.',
    },
    'devil-advocate': {
      claim: 'Apparent anomaly is an AIS transmission or receiver failure, not vessel intent',
      rationale: 'AIS coverage gaps and ship-side equipment faults regularly produce "dark" segments with no operational meaning.',
    },
  },
  aviation: {
    primary: {
      claim: 'Flight is operating per filed flight plan within normal parameters',
      rationale: 'Most ADS-B anomalies resolve to routine ATC instructions, weather avoidance, or planned reroutes.',
    },
    alternative: {
      claim: 'Aircraft is responding to an in-flight emergency or contingency',
      rationale: 'Unusual altitude/speed profile, holding patterns, or transponder code changes can indicate squawk 7700 / 7600 events not yet annotated.',
    },
    'devil-advocate': {
      claim: 'Track anomaly is a sensor coverage gap, not real aircraft behavior',
      rationale: 'ADS-B reception drops near terrain and at low altitudes can produce gaps and ghost positions that look like maneuvers.',
    },
  },
  geopolitical: {
    primary: {
      claim: 'State actor is acting consistently with prior signalling and doctrine',
      rationale: 'Most observed moves track the actor\'s stated policy and historical playbook — read the action at face value first.',
    },
    alternative: {
      claim: 'Move is a deliberate feint to shape adversary expectations',
      rationale: 'The action may be theatre — visible enough to be noticed, calibrated to influence a separate decision elsewhere.',
    },
    'devil-advocate': {
      claim: 'Observed signal is a translation or sourcing artifact, not a real policy shift',
      rationale: 'Headlines built on a single mistranslated quote or unverified social-media post repeatedly turn out to be artifacts; require corroboration.',
    },
  },
  cyber: {
    primary: {
      claim: 'Targeted intrusion consistent with a known threat actor TTP set',
      rationale: 'Indicators and timing align with one of the catalogued APT clusters — treat as a deliberate campaign.',
    },
    alternative: {
      claim: 'Opportunistic exploitation of a freshly-disclosed CVE',
      rationale: 'Mass scanning following a disclosure can produce intrusion telemetry that looks targeted but is actually broad and indiscriminate.',
    },
    'devil-advocate': {
      claim: 'Anomalous traffic is a misconfigured scanner or red-team exercise',
      rationale: 'Internal vulnerability scans, attack-surface tools, and authorised red-team work routinely generate alerts that mimic intrusions.',
    },
  },
  wildfire: {
    primary: {
      claim: 'Active wildfire driven by current fuel moisture + wind conditions',
      rationale: 'Default explanation when satellite hotspots correlate with low fuel moisture and elevated wind — treat as a real wildfire.',
    },
    alternative: {
      claim: 'Prescribed burn or industrial flare incorrectly flagged as wildfire',
      rationale: 'Agricultural burns, gas-field flares, and prescribed forestry burns regularly trigger automated hotspot detections.',
    },
    'devil-advocate': {
      claim: 'Hotspot is a satellite sensor artifact (sun glint, hot bare surface)',
      rationale: 'Sun-glint off water, urban heat islands, and bare hot soil can produce false-positive thermal anomalies that look like fire.',
    },
  },
};

const HYPOTHESIS_TYPES: readonly HypothesisType[] = ['primary', 'alternative', 'devil-advocate'];

// ── Helpers ──────────────────────────────────────────────────────────

function safeStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected !== undefined) return injected;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function cloneEvidence(e: HypothesisEvidence): HypothesisEvidence {
  return { ...e };
}

function cloneHypothesis(h: Hypothesis): Hypothesis {
  return { ...h, evidence: h.evidence.map((e) => cloneEvidence(e)) };
}

function cloneSet(set: HypothesisSet): HypothesisSet {
  return {
    situationId: set.situationId,
    hypotheses: set.hypotheses.map((h) => cloneHypothesis(h)),
    leadingHypothesis: set.leadingHypothesis ? cloneHypothesis(set.leadingHypothesis) : null,
    consensusReached: set.consensusReached,
  };
}

function templateFor(domain: string): DomainTemplate {
  return DOMAIN_TEMPLATES[domain] ?? GENERIC_TEMPLATE;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Re-normalize a set's confidences so they sum to 1.0, preserving
 *  relative ordering. If every value is below the floor, distributes
 *  equally — only happens in degenerate test fixtures. */
function normalizeConfidences(hypotheses: Hypothesis[]): void {
  if (hypotheses.length === 0) return;
  const total = hypotheses.reduce((sum, h) => sum + h.confidence, 0);
  if (total <= 0) {
    const equal = Number((1 / hypotheses.length).toFixed(4));
    for (const h of hypotheses) h.confidence = equal;
    return;
  }
  for (const h of hypotheses) {
    h.confidence = Number((h.confidence / total).toFixed(4));
  }
}

function recomputeDerived(set: HypothesisSet): void {
  if (set.hypotheses.length === 0) {
    set.leadingHypothesis = null;
    set.consensusReached = false;
    return;
  }
  let leader = set.hypotheses[0]!;
  for (const h of set.hypotheses) {
    if (h.confidence > leader.confidence) leader = h;
  }
  set.leadingHypothesis = leader;
  const others = set.hypotheses.filter((h) => h.id !== leader.id);
  set.consensusReached = leader.confidence > CONSENSUS_LEAD_FLOOR
    && others.every((h) => h.confidence < CONSENSUS_OTHERS_CEILING);
}

// ── Service ──────────────────────────────────────────────────────────

interface InternalState {
  // Ordered most-recently-updated first.
  order: string[];
  sets: Map<string, HypothesisSet>;
}

export class CompetitiveHypothesisEngine {
  private state: InternalState = { order: [], sets: new Map() };
  private listeners = new Set<HypothesisSetListener>();
  private storage: StorageLike | null;
  private clock: () => number;
  private hydrated = false;
  private idSeq = 0;

  constructor(options: CompetitiveHypothesisEngineOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Generate ───────────────────────────────────────────────────────

  generate(situationId: string, domain: string, severity: string): HypothesisSet {
    this.ensureHydrated();
    const existing = this.state.sets.get(situationId);
    if (existing) return cloneSet(existing);

    const tpl = templateFor(domain);
    const now = this.clock();
    const hypotheses: Hypothesis[] = HYPOTHESIS_TYPES.map((type) => {
      this.idSeq += 1;
      const t = tpl[type];
      return {
        id: `hyp-${now.toString(36)}-${this.idSeq}`,
        situationId,
        type,
        claim: t.claim,
        rationale: `[${domain}/${severity}] ${t.rationale}`,
        confidence: INITIAL_CONFIDENCE[type],
        status: 'active' as HypothesisStatus,
        evidence: [],
        createdAt: now,
        updatedAt: now,
      };
    });
    const set: HypothesisSet = {
      situationId, hypotheses, leadingHypothesis: null, consensusReached: false,
    };
    normalizeConfidences(set.hypotheses);
    recomputeDerived(set);
    this.state.sets.set(situationId, set);
    this.state.order.unshift(situationId);
    this.enforceCapacity();
    this.schedulePersist();
    this.notify(set);
    return cloneSet(set);
  }

  // ── Evidence + status updates ──────────────────────────────────────

  addEvidence(hypothesisId: string, evidence: HypothesisEvidence): Hypothesis | undefined {
    this.ensureHydrated();
    const located = this.locate(hypothesisId);
    if (!located) return undefined;
    const { set, hypothesis } = located;
    const weight = clamp(evidence.weight, 0, 1);
    hypothesis.evidence.push({ ...evidence, weight });
    if (evidence.alignment === 'supporting') {
      hypothesis.confidence = clamp(
        hypothesis.confidence + weight * EVIDENCE_STEP, CONFIDENCE_FLOOR, CONFIDENCE_CEILING,
      );
    } else if (evidence.alignment === 'contradicting') {
      hypothesis.confidence = clamp(
        hypothesis.confidence - weight * EVIDENCE_STEP, CONFIDENCE_FLOOR, CONFIDENCE_CEILING,
      );
    }
    // neutral → no nudge
    hypothesis.updatedAt = this.clock();
    normalizeConfidences(set.hypotheses);
    recomputeDerived(set);
    this.bumpOrder(set.situationId);
    this.schedulePersist();
    this.notify(set);
    return cloneHypothesis(hypothesis);
  }

  updateStatus(hypothesisId: string, status: HypothesisStatus): Hypothesis | undefined {
    this.ensureHydrated();
    const located = this.locate(hypothesisId);
    if (!located) return undefined;
    const { set, hypothesis } = located;
    if (hypothesis.status === status) return cloneHypothesis(hypothesis);
    hypothesis.status = status;
    hypothesis.updatedAt = this.clock();
    recomputeDerived(set);
    this.bumpOrder(set.situationId);
    this.schedulePersist();
    this.notify(set);
    return cloneHypothesis(hypothesis);
  }

  // ── Reads ──────────────────────────────────────────────────────────

  getSet(situationId: string): HypothesisSet | null {
    this.ensureHydrated();
    const found = this.state.sets.get(situationId);
    return found ? cloneSet(found) : null;
  }

  getAllSets(limit?: number): HypothesisSet[] {
    this.ensureHydrated();
    const list = this.state.order
      .map((id) => this.state.sets.get(id))
      .filter((s): s is HypothesisSet => s !== undefined);
    const capped = typeof limit === 'number' ? list.slice(0, Math.max(0, limit)) : list;
    return capped.map((s) => cloneSet(s));
  }

  subscribe(listener: HypothesisSetListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  unsubscribe(listener: HypothesisSetListener): void {
    this.listeners.delete(listener);
  }

  /** Test seam — clears state and persisted blob. */
  resetForTesting(): void {
    this.state = { order: [], sets: new Map() };
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  private locate(hypothesisId: string): { set: HypothesisSet; hypothesis: Hypothesis } | null {
    for (const set of this.state.sets.values()) {
      const hypothesis = set.hypotheses.find((h) => h.id === hypothesisId);
      if (hypothesis) return { set, hypothesis };
    }
    return null;
  }

  private bumpOrder(situationId: string): void {
    const idx = this.state.order.indexOf(situationId);
    if (idx === -1) return;
    if (idx === 0) return;
    this.state.order.splice(idx, 1);
    this.state.order.unshift(situationId);
  }

  private enforceCapacity(): void {
    if (this.state.order.length <= MAX_SETS) return;
    const dropped = this.state.order.splice(MAX_SETS);
    for (const id of dropped) this.state.sets.delete(id);
  }

  private notify(set: HypothesisSet): void {
    const snapshot = cloneSet(set);
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* isolate */ }
    }
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as HypothesisSet[] | null;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (entry && typeof entry.situationId === 'string' && Array.isArray(entry.hypotheses)) {
          const restored = cloneSet(entry);
          recomputeDerived(restored);
          this.state.sets.set(restored.situationId, restored);
          this.state.order.push(restored.situationId);
        }
      }
    } catch {
      // corrupt — leave empty
    }
  }

  // Coalesces a burst of mutations into one JSON.stringify write on the next
  // microtask (in-memory state stays synchronous); fixes the renderer-hang
  // stringify storm.
  private persistScheduled = false;
  private schedulePersist(): void {
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    queueMicrotask(() => { this.persistScheduled = false; this.persist(); });
  }

  private persist(): void {
    if (!this.storage) return;
    const payload = this.state.order
      .map((id) => this.state.sets.get(id))
      .filter((s): s is HypothesisSet => s !== undefined);
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* best effort */ }
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: CompetitiveHypothesisEngine | null = null;

export function getCompetitiveHypothesisEngine(): CompetitiveHypothesisEngine {
  _singleton ??= new CompetitiveHypothesisEngine();
  return _singleton;
}

export function __resetCompetitiveHypothesisEngineSingleton(): void {
  _singleton = null;
}

export const __internals = {
  DOMAIN_TEMPLATES,
  GENERIC_TEMPLATE,
  HYPOTHESIS_TYPES,
  CONSENSUS_LEAD_FLOOR,
  CONSENSUS_OTHERS_CEILING,
  EVIDENCE_STEP,
  CONFIDENCE_CEILING,
  CONFIDENCE_FLOOR,
  MAX_SETS,
};
