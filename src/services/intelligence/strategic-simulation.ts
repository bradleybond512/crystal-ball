const SS_STORAGE_KEY = 'wm-strategic-sim';
const SS_MAX_SCENARIOS = 50;
const SS_SEVERITY_MIN = 0;
const SS_SEVERITY_MAX = 10;

let _ssCounter = 0;
function ssId(): string {
  return `ss-${Date.now()}-${(++_ssCounter).toString(36)}`;
}

export interface DomainCondition {
  domain: string;
  severity: number;
  trend: 'improving' | 'stable' | 'worsening';
}

export interface SimEvent {
  order: number;
  domain: string;
  deltaSeverity: number;
  description: string;
  probability: number;
}

export interface ProjectedOutcome {
  domain: string;
  projectedSeverity: number;
  confidence: number;
  timeframeHours: number;
}

export interface SimulationScenario {
  id: string;
  name: string;
  description: string;
  initialConditions: DomainCondition[];
  eventChain: SimEvent[];
  projectedOutcomes: ProjectedOutcome[];
  status: 'draft' | 'running' | 'completed';
  createdAt: number;
  completedAt?: number;
}

// ── Simulation helpers ────────────────────────────────────────────────

function buildSeverityMap(conditions: DomainCondition[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of conditions) map.set(c.domain, c.severity);
  return map;
}

function applyFiredEvent(map: Map<string, number>, event: SimEvent): void {
  const current = map.get(event.domain) ?? 0;
  map.set(
    event.domain,
    Math.min(SS_SEVERITY_MAX, Math.max(SS_SEVERITY_MIN, current + event.deltaSeverity)),
  );
}

function runChain(
  map: Map<string, number>,
  events: SimEvent[],
  randomFn: () => number,
): number {
  let confidence = 1;
  for (const event of events) {
    confidence *= event.probability;
    if (randomFn() < event.probability) applyFiredEvent(map, event);
  }
  return confidence;
}

function buildOutcomes(
  map: Map<string, number>,
  confidence: number,
  maxOrder: number,
): ProjectedOutcome[] {
  const outcomes: ProjectedOutcome[] = [];
  for (const [domain, projectedSeverity] of map) {
    outcomes.push({
      domain,
      projectedSeverity,
      confidence: Number(confidence.toFixed(4)),
      timeframeHours: maxOrder * 24,
    });
  }
  return outcomes;
}

// ── Service ──────────────────────────────────────────────────────────

export class StrategicSimulationService {
  private static instance: StrategicSimulationService | null = null;

  private scenarios: SimulationScenario[] = [];
  private readonly randomFn: () => number;

  private constructor(randomFn: () => number = Math.random) {
    this.randomFn = randomFn;
    this.ssLoad();
  }

  static getInstance(opts?: { randomFn?: () => number }): StrategicSimulationService {
    StrategicSimulationService.instance ??= new StrategicSimulationService(opts?.randomFn);
    return StrategicSimulationService.instance;
  }

  static reset(): void {
    StrategicSimulationService.instance = null;
  }

  private ssLoad(): void {
    try {
      const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SS_STORAGE_KEY);
      if (raw) this.scenarios = JSON.parse(raw) as SimulationScenario[];
    } catch {
      this.scenarios = [];
    }
  }

  private ssPersist(): void {
    try {
      if (this.scenarios.length > SS_MAX_SCENARIOS) {
        this.scenarios.splice(0, this.scenarios.length - SS_MAX_SCENARIOS);
      }
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(SS_STORAGE_KEY, JSON.stringify(this.scenarios));
    } catch {
      // storage unavailable
    }
  }

  createScenario(
    name: string,
    description: string,
    initialConditions: DomainCondition[],
  ): SimulationScenario {
    const scenario: SimulationScenario = {
      id: ssId(),
      name,
      description,
      initialConditions: initialConditions.map((c) => ({ ...c })),
      eventChain: [],
      projectedOutcomes: [],
      status: 'draft',
      createdAt: Date.now(),
    };
    this.scenarios.push(scenario);
    this.ssPersist();
    return { ...scenario };
  }

  addEvent(scenarioId: string, event: SimEvent): void {
    const scenario = this.scenarios.find((s) => s.id === scenarioId);
    if (scenario?.status !== 'draft') return;
    scenario.eventChain.push({ ...event });
    this.ssPersist();
  }

  run(scenarioId: string): ProjectedOutcome[] {
    const scenario = this.scenarios.find((s) => s.id === scenarioId);
    if (!scenario) return [];

    scenario.status = 'running';

    const severityMap = buildSeverityMap(scenario.initialConditions);
    const events = [...scenario.eventChain].sort((a, b) => a.order - b.order);
    const maxOrder = events.length > 0 ? Math.max(...events.map((e) => e.order)) : 0;

    const confidence = runChain(severityMap, events, this.randomFn);
    const outcomes = buildOutcomes(severityMap, confidence, maxOrder);

    scenario.projectedOutcomes = outcomes;
    scenario.status = 'completed';
    scenario.completedAt = Date.now();

    this.ssPersist();
    return outcomes;
  }

  getScenarios(): SimulationScenario[] {
    return [...this.scenarios];
  }
}
