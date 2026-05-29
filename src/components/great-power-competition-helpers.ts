/**
 * Great Power Competition helpers — pure functions only.
 * No DOM, no fetch, no globals.
 */

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface MilitaryData {
  forceProjection: number;   // 0-100
  nuclearPosture: number;    // 0-100
  cyberCapability: number;   // 0-100
  spaceAssets: number;       // 0-100
}

export interface EconomicData {
  gdpShare: number;          // 0-100
  tradeDominance: number;    // 0-100
  techInvestment: number;    // 0-100
  sanctionsLeverage: number; // 0-100
}

export interface DiplomaticData {
  allianceCount: number;     // 0-100
  unVotingAlignment: number; // 0-100
  softPowerIndex: number;    // 0-100
}

export interface TechData {
  aiChipLeadership: number;  // 0-100
  fiveGDeployment: number;   // 0-100
  spacePrograms: number;     // 0-100
}

export interface InfoData {
  mediaReach: number;               // 0-100
  disinformationCapability: number; // 0-100
  narrativeDominance: number;       // 0-100
}

export interface DomainWeights {
  military: number;
  economic: number;
  diplomatic: number;
  tech: number;
  info: number;
}

export interface DomainBalance {
  leader: string;
  gap: number;
  rankings: Array<{ actor: string; score: number }>;
}

export type TrendDirection = 'rising' | 'falling' | 'stable';

export interface ActorData {
  military: MilitaryData;
  economicPrev?: EconomicData;
  economic: EconomicData;
  diplomatic: DiplomaticData;
  tech: TechData;
  info: InfoData;
}

export interface ActorDataSet {
  actors: Record<string, ActorData>;
  previousScores?: Record<string, Record<string, number>>;
}

export interface DomainScore {
  score: number;
  trend: TrendDirection;
}

export interface ActorPowerProfile {
  name: string;
  domains: {
    military: DomainScore;
    economic: DomainScore;
    diplomatic: DomainScore;
    tech: DomainScore;
    info: DomainScore;
  };
  composite: number;
}

export interface PowerRenderData {
  actors: ActorPowerProfile[];
  domainBalances: Record<string, DomainBalance>;
  updatedAt: string;
}

// ── Default weights ───────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: DomainWeights = {
  military: 0.25,
  economic: 0.25,
  diplomatic: 0.20,
  tech: 0.20,
  info: 0.10,
};

// ── Scoring functions ─────────────────────────────────────────────────────────

/** Average military sub-scores (all inputs 0-100, output 0-100). */
export function scoreMilitaryPower(data: MilitaryData): number {
  const { forceProjection, nuclearPosture, cyberCapability, spaceAssets } = data;
  return (forceProjection + nuclearPosture + cyberCapability + spaceAssets) / 4;
}

/** Average economic sub-scores (all inputs 0-100, output 0-100). */
export function scoreEconomicDominance(data: EconomicData): number {
  const { gdpShare, tradeDominance, techInvestment, sanctionsLeverage } = data;
  return (gdpShare + tradeDominance + techInvestment + sanctionsLeverage) / 4;
}

/** Average diplomatic sub-scores (all inputs 0-100, output 0-100). */
export function scoreDiplomaticReach(data: DiplomaticData): number {
  const { allianceCount, unVotingAlignment, softPowerIndex } = data;
  return (allianceCount + unVotingAlignment + softPowerIndex) / 3;
}

/** Average tech sub-scores (all inputs 0-100, output 0-100). */
export function scoreTechLeadership(data: TechData): number {
  const { aiChipLeadership, fiveGDeployment, spacePrograms } = data;
  return (aiChipLeadership + fiveGDeployment + spacePrograms) / 3;
}

/** Average informational warfare sub-scores (all inputs 0-100, output 0-100). */
export function scoreInfoWarfare(data: InfoData): number {
  const { mediaReach, disinformationCapability, narrativeDominance } = data;
  return (mediaReach + disinformationCapability + narrativeDominance) / 3;
}

/**
 * Weighted composite power index.
 * Weights are normalized so they always sum to 1.
 * Unspecified weights fall back to DEFAULT_WEIGHTS.
 */
export function buildCompositeIndex(
  military: number,
  economic: number,
  diplomatic: number,
  tech: number,
  info: number,
  weights?: Partial<DomainWeights>,
): number {
  const w: DomainWeights = {
    military:   weights?.military   ?? DEFAULT_WEIGHTS.military,
    economic:   weights?.economic   ?? DEFAULT_WEIGHTS.economic,
    diplomatic: weights?.diplomatic ?? DEFAULT_WEIGHTS.diplomatic,
    tech:       weights?.tech       ?? DEFAULT_WEIGHTS.tech,
    info:       weights?.info       ?? DEFAULT_WEIGHTS.info,
  };
  const total = w.military + w.economic + w.diplomatic + w.tech + w.info;
  if (total === 0) return 0;
  const norm = 1 / total;
  return (
    military   * w.military   * norm +
    economic   * w.economic   * norm +
    diplomatic * w.diplomatic * norm +
    tech       * w.tech       * norm +
    info       * w.info       * norm
  );
}

/**
 * Given a map of actorName → domain score, return a DomainBalance with the
 * leader, the gap between #1 and #2, and all actors sorted descending.
 */
export function calculateDomainBalance(scores: Record<string, number>): DomainBalance {
  const entries = Object.entries(scores);
  const rankings = entries
    .map(([actor, score]) => ({ actor, score }))
    .sort((a, b) => b.score - a.score);

  if (rankings.length === 0) {
    return { leader: '', gap: 0, rankings: [] };
  }

  const leader = rankings[0]!.actor;
  const topScore = rankings[0]!.score;
  const secondScore = rankings[1]?.score ?? topScore;
  const gap = Math.round((topScore - secondScore) * 100) / 100;

  return { leader, gap, rankings };
}

/**
 * Classify trend direction.
 * >2 difference → rising/falling; <=2 → stable.
 */
export function classifyTrend(current: number, previous: number): TrendDirection {
  const diff = current - previous;
  if (diff > 2)  return 'rising';
  if (diff < -2) return 'falling';
  return 'stable';
}

// ── Mock data ─────────────────────────────────────────────────────────────────

/**
 * Returns deterministic realistic data for the four great powers.
 * Scores reflect consensus academic/think-tank assessments circa 2025.
 */
export function getMockActorData(): ActorDataSet {
  return {
    actors: {
      US: {
        military: {
          forceProjection: 95,
          nuclearPosture: 90,
          cyberCapability: 88,
          spaceAssets: 92,
        },
        economic: {
          gdpShare: 85,
          tradeDominance: 78,
          techInvestment: 90,
          sanctionsLeverage: 92,
        },
        diplomatic: {
          allianceCount: 92,
          unVotingAlignment: 75,
          softPowerIndex: 85,
        },
        tech: {
          aiChipLeadership: 90,
          fiveGDeployment: 65,
          spacePrograms: 90,
        },
        info: {
          mediaReach: 82,
          disinformationCapability: 55,
          narrativeDominance: 80,
        },
      },
      China: {
        military: {
          forceProjection: 72,
          nuclearPosture: 70,
          cyberCapability: 82,
          spaceAssets: 78,
        },
        economic: {
          gdpShare: 80,
          tradeDominance: 85,
          techInvestment: 85,
          sanctionsLeverage: 55,
        },
        diplomatic: {
          allianceCount: 58,
          unVotingAlignment: 70,
          softPowerIndex: 55,
        },
        tech: {
          aiChipLeadership: 72,
          fiveGDeployment: 88,
          spacePrograms: 75,
        },
        info: {
          mediaReach: 70,
          disinformationCapability: 75,
          narrativeDominance: 60,
        },
      },
      Russia: {
        military: {
          forceProjection: 75,
          nuclearPosture: 88,
          cyberCapability: 78,
          spaceAssets: 70,
        },
        economic: {
          gdpShare: 30,
          tradeDominance: 35,
          techInvestment: 30,
          sanctionsLeverage: 28,
        },
        diplomatic: {
          allianceCount: 35,
          unVotingAlignment: 55,
          softPowerIndex: 38,
        },
        tech: {
          aiChipLeadership: 40,
          fiveGDeployment: 45,
          spacePrograms: 65,
        },
        info: {
          mediaReach: 68,
          disinformationCapability: 85,
          narrativeDominance: 55,
        },
      },
      EU: {
        military: {
          forceProjection: 55,
          nuclearPosture: 35,
          cyberCapability: 60,
          spaceAssets: 55,
        },
        economic: {
          gdpShare: 75,
          tradeDominance: 72,
          techInvestment: 65,
          sanctionsLeverage: 70,
        },
        diplomatic: {
          allianceCount: 80,
          unVotingAlignment: 72,
          softPowerIndex: 78,
        },
        tech: {
          aiChipLeadership: 55,
          fiveGDeployment: 70,
          spacePrograms: 60,
        },
        info: {
          mediaReach: 65,
          disinformationCapability: 30,
          narrativeDominance: 62,
        },
      },
    },
    previousScores: {
      US:     { military: 94, economic: 85, diplomatic: 84, tech: 80, info: 72 },
      China:  { military: 70, economic: 74, diplomatic: 60, tech: 76, info: 68 },
      Russia: { military: 78, economic: 30, diplomatic: 42, tech: 50, info: 69 },
      EU:     { military: 51, economic: 70, diplomatic: 76, tech: 62, info: 52 },
    },
  };
}

// ── Render data builder ───────────────────────────────────────────────────────

/**
 * Build the full render data structure from an ActorDataSet.
 */
export function buildRenderData(actorDataSet: ActorDataSet): PowerRenderData {
  const { actors, previousScores } = actorDataSet;
  const actorNames = Object.keys(actors);

  const profiles: ActorPowerProfile[] = actorNames.map((name) => {
    const data = actors[name]!;
    const prev = previousScores?.[name];

    const milScore  = scoreMilitaryPower(data.military);
    const ecoScore  = scoreEconomicDominance(data.economic);
    const dipScore  = scoreDiplomaticReach(data.diplomatic);
    const techScore = scoreTechLeadership(data.tech);
    const infoScore = scoreInfoWarfare(data.info);

    return {
      name,
      domains: {
        military:   { score: Math.round(milScore  * 10) / 10, trend: classifyTrend(milScore,  prev?.military   ?? milScore)  },
        economic:   { score: Math.round(ecoScore  * 10) / 10, trend: classifyTrend(ecoScore,  prev?.economic   ?? ecoScore)  },
        diplomatic: { score: Math.round(dipScore  * 10) / 10, trend: classifyTrend(dipScore,  prev?.diplomatic ?? dipScore)  },
        tech:       { score: Math.round(techScore * 10) / 10, trend: classifyTrend(techScore, prev?.tech       ?? techScore) },
        info:       { score: Math.round(infoScore * 10) / 10, trend: classifyTrend(infoScore, prev?.info       ?? infoScore) },
      },
      composite: Math.round(
        buildCompositeIndex(milScore, ecoScore, dipScore, techScore, infoScore) * 10,
      ) / 10,
    };
  });

  // Sort by composite descending
  profiles.sort((a, b) => b.composite - a.composite);

  const domainKeys: Array<keyof ActorPowerProfile['domains']> = [
    'military', 'economic', 'diplomatic', 'tech', 'info',
  ];

  const domainBalances: Record<string, DomainBalance> = {};
  for (const domain of domainKeys) {
    const scoreMap: Record<string, number> = {};
    for (const p of profiles) scoreMap[p.name] = p.domains[domain].score;
    domainBalances[domain] = calculateDomainBalance(scoreMap);
  }

  return {
    actors: profiles,
    domainBalances,
    updatedAt: new Date().toISOString(),
  };
}
