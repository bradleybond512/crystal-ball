import type { ObservationEvent } from '@/types/intelligence';

// ── Public types ──────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  name: string;
  description: string;
  domain: string;
  region: string;
  startDate: string;
  durationHours: number;
  observations: ObservationEvent[];
  expectedSituations: string[];
  tags: string[];
}

export interface ScenarioReplay {
  scenarioId: string;
  replayId: string;
  startedAt: number;
  currentIndex: number;
  totalEvents: number;
  status: 'running' | 'paused' | 'completed';
  emittedObservations: ObservationEvent[];
}

// ── Storage interface ─────────────────────────────────────────────────

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-scenario-library';
const MAX_TOTAL_SCENARIOS = 50;

// ── Built-in scenarios ────────────────────────────────────────────────

const BUILT_IN_SCENARIOS: readonly Scenario[] = [
  {
    id: 'fukushima-2011',
    name: '2011 Fukushima Daiichi Nuclear Disaster',
    description: 'M9.0 earthquake + tsunami triggered a nuclear cooling failure and radiation release at the Fukushima Daiichi plant.',
    domain: 'natural_disaster',
    region: 'Japan',
    startDate: '2011-03-11',
    durationHours: 72,
    tags: ['earthquake', 'tsunami', 'nuclear', 'radiation', 'evacuation'],
    expectedSituations: [
      'Major seismic event detected near populated coastline',
      'Tsunami warning issued for Pacific coast',
      'Nuclear facility cooling system failure',
      'Radiation release risk elevated',
    ],
    observations: [
      {
        id: 'fukushima-obs-1',
        sourceId: 'usgs-seismic',
        domain: 'natural_disaster',
        timestamp: Date.parse('2011-03-11T05:46:23Z'),
        severity: 'CRITICAL',
        title: 'M9.0 earthquake near Tōhoku coast — major seismic event',
        raw: { magnitude: 9, depth: 29, mmi: 'IX' },
        entityIds: ['tohoku-coast', 'japan-eq-2011'],
        tags: ['earthquake', 'magnitude-9'],
        location: { lat: 38.3, lon: 142.37, radiusKm: 50 },
      },
      {
        id: 'fukushima-obs-2',
        sourceId: 'jma-tsunami',
        domain: 'natural_disaster',
        timestamp: Date.parse('2011-03-11T05:49:00Z'),
        severity: 'CRITICAL',
        title: 'Tsunami warning issued — estimated 10 m wave height for Pacific coast',
        raw: { waveHeightM: 10, affectedCoasts: ['Miyagi', 'Iwate', 'Fukushima'] },
        entityIds: ['pacific-coast-japan'],
        tags: ['tsunami', 'warning'],
        location: { lat: 37.7, lon: 141, radiusKm: 200 },
      },
      {
        id: 'fukushima-obs-3',
        sourceId: 'nisa-nuclear',
        domain: 'natural_disaster',
        timestamp: Date.parse('2011-03-11T15:30:00Z'),
        severity: 'HIGH',
        title: 'Fukushima Daiichi Units 1–3 cooling system failure — emergency declared',
        raw: { units: [1, 2, 3], coolantLoss: true, emergencyLevel: 3 },
        entityIds: ['fukushima-daiichi-plant', 'tepco'],
        tags: ['nuclear', 'cooling-failure', 'ines-3'],
      },
      {
        id: 'fukushima-obs-4',
        sourceId: 'nisa-nuclear',
        domain: 'natural_disaster',
        timestamp: Date.parse('2011-03-12T03:36:00Z'),
        severity: 'CRITICAL',
        title: 'Hydrogen explosion at Unit 1 — radiation release confirmed',
        raw: { unit: 1, explosionType: 'hydrogen', radiationMicroSvH: 1015 },
        entityIds: ['fukushima-daiichi-plant'],
        tags: ['nuclear', 'explosion', 'radiation'],
        location: { lat: 37.42, lon: 141.03, radiusKm: 5 },
      },
      {
        id: 'fukushima-obs-5',
        sourceId: 'npa-japan',
        domain: 'natural_disaster',
        timestamp: Date.parse('2011-03-12T05:44:00Z'),
        severity: 'CRITICAL',
        title: 'Evacuation order expanded to 20 km radius around Fukushima Daiichi',
        raw: { radiusKm: 20, affectedPopulation: 78_000 },
        entityIds: ['fukushima-prefecture', 'japan-government'],
        tags: ['evacuation', 'radiation', 'emergency'],
        location: { lat: 37.42, lon: 141.03, radiusKm: 20 },
      },
    ],
  },
  {
    id: 'covid-2020',
    name: '2020 COVID-19 Emergence',
    description: 'Novel coronavirus emergence in Wuhan, China escalating from cluster outbreak to global pandemic.',
    domain: 'health',
    region: 'Global',
    startDate: '2020-01-01',
    durationHours: 720,
    tags: ['pandemic', 'coronavirus', 'outbreak', 'who', 'zoonotic'],
    expectedSituations: [
      'Novel pathogen emergence detected',
      'Cluster outbreak exceeds containment threshold',
      'Cross-border transmission risk elevated',
    ],
    observations: [
      {
        id: 'covid-obs-1',
        sourceId: 'who-event-information-site',
        domain: 'health',
        timestamp: Date.parse('2020-01-05T00:00:00Z'),
        severity: 'MEDIUM',
        title: 'China reports cluster of pneumonia cases of unknown etiology in Wuhan',
        raw: { cases: 44, location: 'Wuhan, Hubei', status: 'under investigation' },
        entityIds: ['wuhan-china', 'china-cdc'],
        tags: ['pneumonia', 'cluster', 'unknown-etiology'],
        location: { lat: 30.59, lon: 114.31, radiusKm: 50 },
      },
      {
        id: 'covid-obs-2',
        sourceId: 'who-event-information-site',
        domain: 'health',
        timestamp: Date.parse('2020-01-09T00:00:00Z'),
        severity: 'HIGH',
        title: 'Novel coronavirus (2019-nCoV) identified as cause of Wuhan pneumonia cluster',
        raw: { pathogen: '2019-nCoV', betacoronavirus: true, genomicSequence: true },
        entityIds: ['wuhan-china', 'who'],
        tags: ['coronavirus', 'novel-pathogen', 'identified'],
      },
      {
        id: 'covid-obs-3',
        sourceId: 'who-event-information-site',
        domain: 'health',
        timestamp: Date.parse('2020-01-22T00:00:00Z'),
        severity: 'HIGH',
        title: 'WHO emergency committee convened — human-to-human transmission confirmed',
        raw: { humanTransmission: true, cases: 547, deaths: 17 },
        entityIds: ['who', 'china-cdc'],
        tags: ['human-to-human', 'transmission', 'who-emergency'],
      },
      {
        id: 'covid-obs-4',
        sourceId: 'china-nac',
        domain: 'health',
        timestamp: Date.parse('2020-01-23T02:00:00Z'),
        severity: 'HIGH',
        title: 'Wuhan placed under quarantine — travel restrictions issued',
        raw: { city: 'Wuhan', populationAffected: 11_000_000, transportClosed: true },
        entityIds: ['wuhan-china', 'china-government'],
        tags: ['quarantine', 'travel-restriction', 'lockdown'],
        location: { lat: 30.59, lon: 114.31, radiusKm: 50 },
      },
      {
        id: 'covid-obs-5',
        sourceId: 'ecdc-surveillance',
        domain: 'health',
        timestamp: Date.parse('2020-01-30T00:00:00Z'),
        severity: 'CRITICAL',
        title: 'WHO declares Public Health Emergency of International Concern — cross-border spread confirmed in 18 countries',
        raw: { pheic: true, countriesAffected: 18, casesGlobal: 9976 },
        entityIds: ['who', 'global'],
        tags: ['pheic', 'global-spread', 'emergency'],
      },
    ],
  },
  {
    id: 'suez-2021',
    name: '2021 Suez Canal Blockage',
    description: 'Container ship Ever Given ran aground in the Suez Canal, blocking the waterway for six days and disrupting global trade.',
    domain: 'logistics',
    region: 'Suez Canal',
    startDate: '2021-03-23',
    durationHours: 144,
    tags: ['maritime', 'shipping', 'supply-chain', 'canal-blockage', 'trade'],
    expectedSituations: [
      'Critical maritime chokepoint blocked',
      'Global supply chain disruption risk elevated',
    ],
    observations: [
      {
        id: 'suez-obs-1',
        sourceId: 'ais-marinetraffic',
        domain: 'logistics',
        timestamp: Date.parse('2021-03-23T07:40:00Z'),
        severity: 'HIGH',
        title: 'Ever Given (MMSI 353136000) grounded — vessel blocking Suez Canal',
        raw: { mmsi: '353136000', vesselName: 'Ever Given', heading: 'aground', speedKnots: 0 },
        entityIds: ['ever-given-353136000', 'suez-canal'],
        tags: ['vessel-grounding', 'canal-blockage'],
        location: { lat: 30.03, lon: 32.55, radiusKm: 2 },
      },
      {
        id: 'suez-obs-2',
        sourceId: 'sca-authority',
        domain: 'logistics',
        timestamp: Date.parse('2021-03-23T09:00:00Z'),
        severity: 'CRITICAL',
        title: 'Suez Canal Authority suspends transit — canal closed in both directions',
        raw: { status: 'closed', directionAffected: 'both', vesselQueue: 0 },
        entityIds: ['suez-canal-authority', 'suez-canal'],
        tags: ['canal-closed', 'shipping-halt'],
        location: { lat: 30, lon: 32.55, radiusKm: 100 },
      },
      {
        id: 'suez-obs-3',
        sourceId: 'ais-marinetraffic',
        domain: 'logistics',
        timestamp: Date.parse('2021-03-25T12:00:00Z'),
        severity: 'HIGH',
        title: 'Vessel queue reaches 300+ ships — shipping delays estimated 10+ days',
        raw: { vesselQueue: 321, delayEstimateDays: 10, cargoTypesAffected: ['container', 'bulk', 'tanker'] },
        entityIds: ['suez-canal', 'global-shipping'],
        tags: ['shipping-delay', 'queue', 'supply-chain'],
      },
      {
        id: 'suez-obs-4',
        sourceId: 'bloomberg-commodities',
        domain: 'logistics',
        timestamp: Date.parse('2021-03-26T08:00:00Z'),
        severity: 'MEDIUM',
        title: 'Oil and commodity supply impact — Brent crude +3%, European LNG spot price elevated',
        raw: { brentChangePct: 3.1, lngImpact: true, commoditiesAffected: ['oil', 'lng', 'grain'] },
        entityIds: ['brent-crude', 'global-commodities'],
        tags: ['commodity-impact', 'oil-price', 'supply-shock'],
      },
    ],
  },
  {
    id: 'ukraine-2022',
    name: '2022 Ukraine Invasion',
    description: 'Russian military forces crossed into Ukraine on multiple fronts, triggering the largest armed conflict in Europe since WWII.',
    domain: 'geopolitical',
    region: 'Eastern Europe',
    startDate: '2022-02-24',
    durationHours: 48,
    tags: ['conflict', 'military', 'invasion', 'energy', 'refugee'],
    expectedSituations: [
      'Armed conflict outbreak detected',
      'Energy supply disruption risk elevated',
      'Regional refugee crisis developing',
    ],
    observations: [
      {
        id: 'ukraine-obs-1',
        sourceId: 'acled-conflict',
        domain: 'geopolitical',
        timestamp: Date.parse('2022-02-23T22:00:00Z'),
        severity: 'HIGH',
        title: 'Large-scale Russian troop movement across Ukrainian border — multiple crossing points',
        raw: { crossingPoints: ['Kharkiv', 'Sumy', 'Zaporizhzhia', 'Crimea'], troopCount: 'est. 190,000' },
        entityIds: ['russia', 'ukraine', 'nato'],
        tags: ['troop-movement', 'military', 'invasion-start'],
        location: { lat: 49.9, lon: 36.2, radiusKm: 500 },
      },
      {
        id: 'ukraine-obs-2',
        sourceId: 'acled-conflict',
        domain: 'geopolitical',
        timestamp: Date.parse('2022-02-24T03:00:00Z'),
        severity: 'CRITICAL',
        title: 'Russian missile strikes on Ukrainian cities — Kyiv, Kharkiv, Odessa targeted',
        raw: { citiesStruck: ['Kyiv', 'Kharkiv', 'Odessa', 'Mariupol'], strikeType: 'missile+artillery' },
        entityIds: ['russia', 'ukraine', 'kyiv'],
        tags: ['missile-strike', 'military-attack', 'armed-conflict'],
        location: { lat: 50.45, lon: 30.52, radiusKm: 300 },
      },
      {
        id: 'ukraine-obs-3',
        sourceId: 'iea-energy',
        domain: 'geopolitical',
        timestamp: Date.parse('2022-02-24T08:00:00Z'),
        severity: 'HIGH',
        title: 'European natural gas and oil supply threat — Russia-Ukraine pipeline routes at risk',
        raw: { pipelinesAtRisk: ['Nord Stream', 'Soyuz', 'Brotherhood'], naturalGasSharePct: 40 },
        entityIds: ['gazprom', 'europe-energy', 'nord-stream'],
        tags: ['energy-supply', 'natural-gas', 'pipeline-risk'],
      },
      {
        id: 'ukraine-obs-4',
        sourceId: 'unhcr-displacement',
        domain: 'geopolitical',
        timestamp: Date.parse('2022-02-25T12:00:00Z'),
        severity: 'HIGH',
        title: 'Mass civilian displacement — 100,000+ refugees crossing into Poland, Moldova, Romania',
        raw: { refugeeCount: 100_000, destinationCountries: ['Poland', 'Moldova', 'Romania', 'Slovakia'] },
        entityIds: ['ukraine', 'unhcr', 'poland'],
        tags: ['refugee', 'displacement', 'humanitarian'],
        location: { lat: 50.07, lon: 22, radiusKm: 300 },
      },
    ],
  },
  {
    id: 'morocco-2023',
    name: '2023 Morocco Earthquake',
    description: 'M6.8 earthquake struck the High Atlas mountains near Marrakech, causing widespread building collapse and casualties.',
    domain: 'natural_disaster',
    region: 'Morocco',
    startDate: '2023-09-08',
    durationHours: 24,
    tags: ['earthquake', 'collapse', 'search-and-rescue', 'humanitarian', 'atlas'],
    expectedSituations: [
      'Major seismic event in populated region',
      'Mass casualty event — humanitarian response required',
    ],
    observations: [
      {
        id: 'morocco-obs-1',
        sourceId: 'usgs-seismic',
        domain: 'natural_disaster',
        timestamp: Date.parse('2023-09-08T22:11:01Z'),
        severity: 'HIGH',
        title: 'M6.8 earthquake — High Atlas mountains, Morocco, depth 18 km',
        raw: { magnitude: 6.8, depth: 18, mmi: 'VIII', epicenter: 'Ighil, Al Haouz' },
        entityIds: ['high-atlas-morocco', 'morocco-cnrst'],
        tags: ['earthquake', 'magnitude-6'],
        location: { lat: 31.07, lon: -8.41, radiusKm: 30 },
      },
      {
        id: 'morocco-obs-2',
        sourceId: 'gdacs-disaster',
        domain: 'natural_disaster',
        timestamp: Date.parse('2023-09-08T23:00:00Z'),
        severity: 'CRITICAL',
        title: 'Structural collapse reports from Marrakech medina and Al Haouz villages — mass casualty event',
        raw: { collapseLocations: ['Marrakech medina', 'Al Haouz', 'Taroudant'], estimatedCasualties: 1000 },
        entityIds: ['marrakech', 'al-haouz', 'morocco'],
        tags: ['structural-collapse', 'mass-casualty', 'historic-district'],
        location: { lat: 31.63, lon: -8, radiusKm: 100 },
      },
      {
        id: 'morocco-obs-3',
        sourceId: 'moroccan-civil-protection',
        domain: 'natural_disaster',
        timestamp: Date.parse('2023-09-09T04:00:00Z'),
        severity: 'HIGH',
        title: 'Search and rescue operations launched — army and civil protection deployed',
        raw: { searchTeams: 24, armyDeployed: true, areasSearched: ['Al Haouz', 'Marrakech', 'Taroudant'] },
        entityIds: ['morocco-government', 'moroccan-army'],
        tags: ['search-and-rescue', 'emergency-response', 'military-deployment'],
      },
      {
        id: 'morocco-obs-4',
        sourceId: 'ocha-humanitarian',
        domain: 'natural_disaster',
        timestamp: Date.parse('2023-09-09T10:00:00Z'),
        severity: 'HIGH',
        title: 'Morocco requests international aid — death toll exceeds 2,000',
        raw: { deathToll: 2122, injured: 2421, displaced: 300_000, aidRequested: ['Spain', 'France', 'UK', 'Qatar'] },
        entityIds: ['morocco', 'ocha', 'international-aid'],
        tags: ['international-aid', 'death-toll', 'displacement', 'humanitarian-crisis'],
      },
    ],
  },
];

// ── Service ────────────────────────────────────────────────────────────

export class ScenarioLibrary {
  private static _singleton: ScenarioLibrary | null = null;

  private custom: Scenario[] = [];
  private replays = new Map<string, ScenarioReplay>();
  private storage: StorageLike;
  private hydrated = false;

  private constructor(storage: StorageLike = (globalThis as { localStorage?: StorageLike }).localStorage ?? nullStorage()) {
    this.storage = storage;
  }

  static getInstance(): ScenarioLibrary {
    ScenarioLibrary._singleton ??= new ScenarioLibrary();
    return ScenarioLibrary._singleton;
  }

  static createForTesting(storage: StorageLike): ScenarioLibrary {
    return new ScenarioLibrary(storage);
  }

  static _resetForTests(): void {
    ScenarioLibrary._singleton = null;
  }

  // ── Scenarios ──────────────────────────────────────────────────────

  getScenarios(): Scenario[] {
    this.ensureHydrated();
    return [...BUILT_IN_SCENARIOS, ...this.custom];
  }

  addScenario(scenario: Scenario): void {
    this.ensureHydrated();
    this.custom.push(scenario);
    this.enforceMaxCap();
    this.persist();
  }

  // ── Replay ─────────────────────────────────────────────────────────

  startReplay(scenarioId: string): ScenarioReplay {
    this.ensureHydrated();
    const scenario = this.findScenario(scenarioId);
    if (!scenario) {
      throw new Error(`ScenarioLibrary: unknown scenarioId "${scenarioId}"`);
    }
    const replayId = `${scenarioId}-${Date.now()}`;
    const replay: ScenarioReplay = {
      scenarioId,
      replayId,
      startedAt: Date.now(),
      currentIndex: 0,
      totalEvents: scenario.observations.length,
      status: 'running',
      emittedObservations: [],
    };
    this.replays.set(replayId, replay);
    return { ...replay, emittedObservations: [] };
  }

  tick(replayId: string): ObservationEvent | null {
    const replay = this.replays.get(replayId);
    if (!replay) return null;
    if (replay.status === 'paused' || replay.status === 'completed') return null;

    const scenario = this.findScenario(replay.scenarioId);
    if (!scenario) return null;

    if (replay.currentIndex >= scenario.observations.length) {
      replay.status = 'completed';
      return null;
    }

    const event = scenario.observations[replay.currentIndex]!;
    replay.emittedObservations.push(event);
    replay.currentIndex += 1;

    if (replay.currentIndex >= scenario.observations.length) {
      replay.status = 'completed';
    }

    return event;
  }

  getReplay(replayId: string): ScenarioReplay | null {
    const r = this.replays.get(replayId);
    if (!r) return null;
    return { ...r, emittedObservations: [...r.emittedObservations] };
  }

  pauseReplay(replayId: string): void {
    const replay = this.replays.get(replayId);
    if (replay?.status === 'running') {
      replay.status = 'paused';
    }
  }

  resumeReplay(replayId: string): void {
    const replay = this.replays.get(replayId);
    if (replay?.status === 'paused') {
      replay.status = 'running';
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  private findScenario(id: string): Scenario | undefined {
    const builtin = BUILT_IN_SCENARIOS.find((s) => s.id === id);
    if (builtin) return builtin;
    return this.custom.find((s) => s.id === id);
  }

  private enforceMaxCap(): void {
    const builtInCount = BUILT_IN_SCENARIOS.length;
    const maxCustom = MAX_TOTAL_SCENARIOS - builtInCount;
    while (this.custom.length > maxCustom) {
      this.custom.shift();
    }
  }

  private persist(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.custom));
    } catch {
      // storage unavailable — continue without persistence
    }
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: Scenario[] | null;
    try { parsed = JSON.parse(raw) as Scenario[] | null; } catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry.id === 'string' &&
        typeof entry.name === 'string' &&
        typeof entry.domain === 'string' &&
        typeof entry.durationHours === 'number' &&
        Array.isArray(entry.tags) &&
        Array.isArray(entry.observations) &&
        Array.isArray(entry.expectedSituations)
      ) {
        this.custom.push(entry as Scenario);
      }
    }
  }
}

// ── Null storage fallback ─────────────────────────────────────────────

function nullStorage(): StorageLike {
  return {
    getItem: () => null,
    setItem: () => undefined,
  };
}
