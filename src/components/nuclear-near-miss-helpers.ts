/**
 * Pure helpers for NuclearNearMissPanel.
 *
 * Covers historical nuclear near-miss incidents and current escalation
 * risk indicators. No DOM, no fetch — safe to import in Node.js tests.
 *
 * Run tests: npx tsx --test tests/components/nuclear-near-miss-panel.test.mts
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type IncidentType =
  | 'False Alarm'
  | 'Unauthorized Action'
  | 'Miscommunication'
  | 'Technical Failure'
  | 'Command Confusion'
  | 'Accident';

export type Severity = 'Serious' | 'Critical' | 'Catastrophic Near-Miss';

export type RiskLevel = 'Normal' | 'Elevated' | 'High' | 'Critical';

export interface NearMissIncident {
  id: string;
  date: string;
  actors: string[];
  incidentType: IncidentType;
  severity: Severity;
  howResolved: string;
  timeToLaunch?: string;
  description: string;
  lesson: string;
}

export interface CurrentRiskIndicator {
  id: string;
  category: string;
  indicator: string;
  level: RiskLevel;
  description: string;
}

export interface NearMissData {
  incidents: NearMissIncident[];
  currentIndicators: CurrentRiskIndicator[];
  historicalRiskScore: number;
  currentRiskScore: number;
  mostDangerousDecade: string;
  /** Seconds to midnight on the Doomsday Clock. */
  doomsday_clock_minutes: number;
}

// ── Static seed data ───────────────────────────────────────────────────────

export const NEAR_MISS_INCIDENTS: NearMissIncident[] = [
  {
    id: 'petrov-1983',
    date: '1983-09-26',
    actors: ['Soviet Union', 'United States'],
    incidentType: 'False Alarm',
    severity: 'Catastrophic Near-Miss',
    howResolved:
      'Stanislav Petrov personally decided not to report the alert up the chain of command, judging it a system malfunction.',
    timeToLaunch: '5 minutes',
    description:
      'Soviet early-warning satellite Oko falsely detected five US Minuteman ICBMs launching. Protocol required Petrov to relay the alert to Soviet military leadership, which would likely have triggered a retaliatory strike.',
    lesson:
      'Single human judgment prevented nuclear war. Automated systems alone cannot be trusted for launch decisions.',
  },
  {
    id: 'arkhipov-1962',
    date: '1962-10-27',
    actors: ['Soviet Union', 'United States'],
    incidentType: 'Unauthorized Action',
    severity: 'Catastrophic Near-Miss',
    howResolved:
      'Vasili Arkhipov, the flotilla commander aboard B-59, refused to authorise the torpedo launch, overriding the captain.',
    timeToLaunch: '< 10 minutes',
    description:
      'US destroyers dropped signalling depth charges on Soviet submarine B-59 during the Cuban Missile Crisis. The sub had lost communication and the captain believed war had started. He ordered a nuclear torpedo launched; two of three officers agreed. Arkhipov was the only one who refused.',
    lesson:
      'A single dissenting officer prevented a nuclear exchange at the height of the Cuban Missile Crisis.',
  },
  {
    id: 'goldsboro-1961',
    date: '1961-01-24',
    actors: ['United States'],
    incidentType: 'Accident',
    severity: 'Catastrophic Near-Miss',
    howResolved:
      'One bomb landed safely; the other lost five of six arming switches before a single low-voltage safing switch prevented detonation.',
    timeToLaunch: undefined,
    description:
      'A B-52 broke apart over Goldsboro, North Carolina, releasing two Mark 39 hydrogen bombs. On one weapon, five of six safety mechanisms failed. A single switch prevented a 3.8-megaton detonation.',
    lesson:
      'Safety systems must be redundant by design, not accident. Near-detonation of a weapon over a US state remained classified for decades.',
  },
  {
    id: 'able-archer-83',
    date: '1983-11-07',
    actors: ['NATO', 'Soviet Union'],
    incidentType: 'Miscommunication',
    severity: 'Critical',
    howResolved:
      'KGB officer Oleg Gordievsky (a British double agent) alerted the West to the severity of Soviet alarm; NATO scaled back the exercise.',
    timeToLaunch: undefined,
    description:
      'NATO exercise Able Archer 83 simulated a full nuclear release sequence with unprecedented realism. Soviet intelligence assessed it might be cover for a real first strike. KGB and GRU forces were placed on alert; some nuclear-capable aircraft were readied.',
    lesson:
      'Exercises indistinguishable from real operations can trigger adversary pre-emption. Intelligence sharing between rivals may be essential in crises.',
  },
  {
    id: 'norad-chip-1980',
    date: '1980-06-03',
    actors: ['United States'],
    incidentType: 'Technical Failure',
    severity: 'Critical',
    howResolved:
      'Duty officers noted that no confirmation radar tracks existed; the alert was stood down after six minutes.',
    timeToLaunch: '6 minutes',
    description:
      'A faulty 46-cent integrated circuit in a NORAD communications device displayed 2,200 incoming Soviet missiles on screens across US command. Nuclear bomber crews were scrambled before the error was caught.',
    lesson:
      'Single-point hardware failures can escalate to launch readiness. Physical confirmation must be required before any nuclear response.',
  },
  {
    id: 'norwegian-rocket-1995',
    date: '1995-01-25',
    actors: ['Russia', 'Norway', 'United States'],
    incidentType: 'False Alarm',
    severity: 'Critical',
    howResolved:
      'Russian radar operators tracked the rocket trajectory and determined it would not reach Russian territory; Yeltsin stood down.',
    timeToLaunch: '8 minutes',
    description:
      'A Norwegian Black Brant sounding rocket studying the aurora was misidentified by Russian radar as a US submarine-launched Trident missile. President Yeltsin activated the nuclear briefcase (Cheget) — the first confirmed activation in history.',
    lesson:
      'Scientific launches can be mistaken for offensive strikes. Pre-launch notification systems must reach all relevant parties.',
  },
  {
    id: 'yom-kippur-1973',
    date: '1973-10-24',
    actors: ['United States', 'Soviet Union', 'Israel', 'Egypt'],
    incidentType: 'Command Confusion',
    severity: 'Critical',
    howResolved:
      'Kissinger and the NSC managed the DEFCON 3 alert without presidential involvement; Soviet forces eventually stood down.',
    timeToLaunch: undefined,
    description:
      'During the Yom Kippur War, the Soviet Union threatened military intervention. President Nixon was allegedly incapacitated by alcohol and stress. Kissinger convened a secret NSC session raising the US to DEFCON 3 without informing the president.',
    lesson:
      'Nuclear command authority must be clearly defined and verifiable at all times. Impaired leadership is a structural vulnerability.',
  },
  {
    id: 'balakot-2019',
    date: '2019-02-27',
    actors: ['India', 'Pakistan'],
    incidentType: 'Miscommunication',
    severity: 'Critical',
    howResolved:
      'Pakistani radar operators confirmed the trajectory would miss cities; nuclear forces stood down minutes before a potential authorisation.',
    timeToLaunch: '< 15 minutes',
    description:
      'Following the Balakot airstrike, Pakistan intercepted Indian missiles. Radar initially tracked objects toward Lahore. Pakistani nuclear command briefly considered a retaliatory option before trajectory analysis ruled out an attack on a major city.',
    lesson:
      'Two nuclear-armed states with ongoing territorial conflict remain at high risk. Crisis hotlines and transparency mechanisms are critical.',
  },
  {
    id: 'russia-ukraine-2022',
    date: '2022-09-21',
    actors: ['Russia', 'Ukraine', 'NATO'],
    incidentType: 'Command Confusion',
    severity: 'Serious',
    howResolved:
      'Western intelligence indicated Russia had not yet moved tactical nuclear weapons to forward positions; NATO maintained indirect involvement.',
    timeToLaunch: undefined,
    description:
      'Following Ukrainian battlefield advances in 2022, Russian officials made repeated public nuclear threats. General Zaluzhny and Western analysts assessed a real possibility of tactical nuclear use. A mobilisation decree and annexation declaration raised escalation fears to their highest post-Cold War level.',
    lesson:
      'Nuclear rhetoric used as coercion lowers the perceived threshold for use and destabilises deterrence. Real-time communication channels are essential.',
  },
  {
    id: 'palomares-1966',
    date: '1966-01-17',
    actors: ['United States', 'Spain'],
    incidentType: 'Accident',
    severity: 'Serious',
    howResolved:
      'No nuclear detonation occurred; conventional explosives in two bombs ruptured, scattering plutonium over farmland. All four bombs were eventually recovered.',
    timeToLaunch: undefined,
    description:
      'A B-52 carrying four B28 hydrogen bombs collided with a KC-135 tanker over Palomares, Spain. Two bombs had their conventional explosive lenses detonate, releasing plutonium. The fourth bomb fell into the Mediterranean and was recovered after 80 days.',
    lesson:
      'Airborne alert missions impose large accident risks. The US ended continuous airborne nuclear patrols in 1968 partly as a result.',
  },
  {
    id: 'thule-1968',
    date: '1968-01-21',
    actors: ['United States', 'Denmark'],
    incidentType: 'Accident',
    severity: 'Serious',
    howResolved:
      'No nuclear detonation; conventional explosives did not detonate. Extensive clean-up of radioactive material took months. One bomb was never fully recovered.',
    timeToLaunch: undefined,
    description:
      'A B-52 caught fire and crashed at Thule Air Base, Greenland, scattering four B28 nuclear bombs across the sea ice. The ice melted, contaminating the area with plutonium and uranium.',
    lesson:
      'Nuclear weapons storage and carriage in extreme environments creates accident conditions. Denmark was notified only after the crash.',
  },
  {
    id: 'hawaii-2018',
    date: '2018-01-13',
    actors: ['United States'],
    incidentType: 'False Alarm',
    severity: 'Serious',
    howResolved:
      'An employee clicked the wrong option during a drill; the correction took 38 minutes because no formal correction procedure existed.',
    timeToLaunch: undefined,
    description:
      'The Hawaii Emergency Management Agency accidentally sent a ballistic missile inbound alert to all mobile phones in Hawaii. 38 minutes of public panic followed before a correction was issued.',
    lesson:
      'Public alert systems lack correction protocols. Human error in bureaucratic systems can cause mass panic with downstream military escalation risk.',
  },
];

export const CURRENT_RISK_INDICATORS: CurrentRiskIndicator[] = [
  {
    id: 'new-start',
    category: 'Arms Control',
    indicator: 'US-Russia Arms Control',
    level: 'Critical',
    description:
      'New START suspended by Russia in February 2023; no replacement treaty under negotiation. No verified limits on deployed strategic warheads for the first time since 1972.',
  },
  {
    id: 'doomsday-clock',
    category: 'Assessment',
    indicator: 'Doomsday Clock',
    level: 'Critical',
    description:
      '90 seconds to midnight as of January 2023 — the closest to midnight since the clock was established in 1947, reflecting accumulated nuclear, climate, and disruptive-technology risks.',
  },
  {
    id: 'china-buildup',
    category: 'Proliferation',
    indicator: 'China Nuclear Buildup',
    level: 'High',
    description:
      'China expanding from ~300 to ~1,000 warheads by 2035 per DoD estimates. New silo fields visible via satellite in Xinjiang and Gansu. Strategic stability impacts poorly modelled.',
  },
  {
    id: 'dprk-icbm',
    category: 'Proliferation',
    indicator: 'North Korea ICBM Status',
    level: 'High',
    description:
      'DPRK has demonstrated ICBM capability to reach the continental US (Hwasong-17 test, 2022). Miniaturised warhead development ongoing. No arms-control dialogue active.',
  },
  {
    id: 'tactical-doctrine',
    category: 'Doctrine',
    indicator: 'Tactical Nuclear Doctrine',
    level: 'Elevated',
    description:
      'Russia lowered its declared nuclear-use threshold in the September 2024 doctrine update, including a response to conventional attacks on Russian territory. NATO assessing escalation implications.',
  },
  {
    id: 'nc2-reliability',
    category: 'Technical',
    indicator: 'Command-and-Control Reliability',
    level: 'Elevated',
    description:
      'AI-enabled cyber attacks, spoofed early-warning data, and accelerated sensor-to-shooter timelines increase NC2 vulnerability. Multiple states integrating AI into nuclear decision loops.',
  },
  {
    id: 'accidental-launch',
    category: 'Technical',
    indicator: 'Accidental Launch Risk',
    level: 'Elevated',
    description:
      'Hypersonic glide vehicles and launch-on-warning postures reduce decision time from ~30 to under 6 minutes in some scenarios. Increased automation raises probability of no human override.',
  },
  {
    id: 'nuclear-terrorism',
    category: 'Terrorism',
    indicator: 'Nuclear Terrorism Risk',
    level: 'Normal',
    description:
      'IAEA tracking ~4,000 reported nuclear and radiological incidents since 1993. Confirmed HEU seizures declining but risk of dirty bomb or radiological dispersal device persists.',
  },
];

// ── Severity ordering ──────────────────────────────────────────────────────

export const SEVERITY_ORDER: Record<Severity, number> = {
  'Catastrophic Near-Miss': 3,
  Critical: 2,
  Serious: 1,
};

export const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  Critical: 4,
  High: 3,
  Elevated: 2,
  Normal: 1,
};

// ── Filter / sort helpers ──────────────────────────────────────────────────

export function getBySeverity(
  incidents: NearMissIncident[],
  severity: Severity,
): NearMissIncident[] {
  return incidents.filter((i) => i.severity === severity);
}

export function getByType(
  incidents: NearMissIncident[],
  incidentType: IncidentType,
): NearMissIncident[] {
  return incidents.filter((i) => i.incidentType === incidentType);
}

export function getHighRisk(indicators: CurrentRiskIndicator[]): CurrentRiskIndicator[] {
  return indicators.filter((ind) => ind.level === 'High' || ind.level === 'Critical');
}

// ── Score computation ──────────────────────────────────────────────────────

const SEVERITY_SCORE: Record<Severity, number> = {
  'Catastrophic Near-Miss': 100,
  Critical: 65,
  Serious: 30,
};

const RISK_LEVEL_SCORE: Record<RiskLevel, number> = {
  Critical: 100,
  High: 70,
  Elevated: 40,
  Normal: 10,
};

/**
 * Derives a 0-100 historical risk score from the incident dataset.
 * Weighted average of per-incident severity scores, capped at 100.
 */
export function computeHistoricalRiskScore(incidents: NearMissIncident[]): number {
  if (incidents.length === 0) return 0;
  const total = incidents.reduce((sum, i) => sum + SEVERITY_SCORE[i.severity], 0);
  return Math.min(100, Math.round(total / incidents.length));
}

/**
 * Derives a 0-100 current risk score from the live indicator dataset.
 * Weighted average of per-indicator level scores, capped at 100.
 */
export function computeCurrentRiskScore(indicators: CurrentRiskIndicator[]): number {
  if (indicators.length === 0) return 0;
  const total = indicators.reduce((sum, ind) => sum + RISK_LEVEL_SCORE[ind.level], 0);
  return Math.min(100, Math.round(total / indicators.length));
}

// ── CSS class helpers ──────────────────────────────────────────────────────

export function severityClass(severity: Severity): string {
  switch (severity) {
    case 'Catastrophic Near-Miss':
      return 'nnm-sev-catastrophic';
    case 'Critical':
      return 'nnm-sev-critical';
    case 'Serious':
      return 'nnm-sev-serious';
  }
}

export function riskLevelClass(level: RiskLevel): string {
  switch (level) {
    case 'Critical':
      return 'nnm-risk-critical';
    case 'High':
      return 'nnm-risk-high';
    case 'Elevated':
      return 'nnm-risk-elevated';
    case 'Normal':
      return 'nnm-risk-normal';
  }
}

// ── buildRenderData ────────────────────────────────────────────────────────

export interface NearMissRenderData {
  incidents: NearMissIncident[];
  currentIndicators: CurrentRiskIndicator[];
  historicalRiskScore: number;
  currentRiskScore: number;
  mostDangerousDecade: string;
  doomsday_clock_minutes: number;
  catastrophicCount: number;
  criticalIndicatorCount: number;
}

export function buildRenderData(data: NearMissData): NearMissRenderData {
  const sorted = [...data.incidents].sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
  );
  const catastrophicCount = getBySeverity(data.incidents, 'Catastrophic Near-Miss').length;
  const criticalIndicatorCount = getHighRisk(data.currentIndicators).length;
  return {
    incidents: sorted,
    currentIndicators: [...data.currentIndicators].sort(
      (a, b) => RISK_LEVEL_ORDER[b.level] - RISK_LEVEL_ORDER[a.level],
    ),
    historicalRiskScore: data.historicalRiskScore,
    currentRiskScore: data.currentRiskScore,
    mostDangerousDecade: data.mostDangerousDecade,
    doomsday_clock_minutes: data.doomsday_clock_minutes,
    catastrophicCount,
    criticalIndicatorCount,
  };
}

// ── Default data export ────────────────────────────────────────────────────

export const NEAR_MISS_DATA: NearMissData = {
  incidents: NEAR_MISS_INCIDENTS,
  currentIndicators: CURRENT_RISK_INDICATORS,
  historicalRiskScore: computeHistoricalRiskScore(NEAR_MISS_INCIDENTS),
  currentRiskScore: 72,
  mostDangerousDecade: '1980s',
  doomsday_clock_minutes: 90,
};
