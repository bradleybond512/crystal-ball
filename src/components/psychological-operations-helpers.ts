// psychological-operations-helpers.ts — pure deterministic helpers

export type PsyopTarget = "population" | "military" | "leadership" | "diaspora" | "international";
export type PsyopChannel = "social-media" | "state-media" | "bot-network" | "deepfake" | "proxy-outlet" | "direct-contact";
export type PsyopPhase = "preparation" | "active" | "exploitation" | "consolidation" | "dormant";
export type ThreatActor = "Russia" | "China" | "Iran" | "North Korea" | "non-state";

export interface PsyopCampaign {
  id: string;
  name: string;
  actor: ThreatActor;
  targetCountries: string[];
  primaryTarget: PsyopTarget;
  channels: PsyopChannel[];
  phase: PsyopPhase;
  startDate: string;
  estimatedReach: number;
  sophisticationScore: number;
  narrativeCoherence: number;
  detectionDifficulty: number;
}

export interface DisinfoCampaign {
  id: string;
  actor: ThreatActor;
  narrative: string;
  targetCountry: string;
  spreadVelocity: number;
  factChecked: boolean;
  retracted: boolean;
  believabilityScore: number;
}

const MOCK_CAMPAIGNS: PsyopCampaign[] = [
  { id: "op-secondary-infektion", name: "Secondary Infektion", actor: "Russia", targetCountries: ["USA", "UK", "Germany", "Ukraine"], primaryTarget: "population", channels: ["proxy-outlet", "social-media", "bot-network"], phase: "active", startDate: "2014-01-01", estimatedReach: 300, sophisticationScore: 85, narrativeCoherence: 78, detectionDifficulty: 72 },
  { id: "op-doppelganger", name: "Doppelganger", actor: "Russia", targetCountries: ["France", "Germany", "USA"], primaryTarget: "population", channels: ["proxy-outlet", "social-media"], phase: "active", startDate: "2022-03-01", estimatedReach: 150, sophisticationScore: 80, narrativeCoherence: 82, detectionDifficulty: 68 },
  { id: "op-spamouflage", name: "Spamouflage Dragon", actor: "China", targetCountries: ["USA", "Canada", "Taiwan", "Australia"], primaryTarget: "diaspora", channels: ["social-media", "bot-network"], phase: "active", startDate: "2019-06-01", estimatedReach: 220, sophisticationScore: 75, narrativeCoherence: 70, detectionDifficulty: 65 },
  { id: "op-ghostwriter", name: "Ghostwriter", actor: "Russia", targetCountries: ["Poland", "Lithuania", "Latvia", "Germany"], primaryTarget: "population", channels: ["proxy-outlet", "state-media", "social-media"], phase: "active", startDate: "2020-01-01", estimatedReach: 80, sophisticationScore: 88, narrativeCoherence: 85, detectionDifficulty: 80 },
  { id: "op-iran-ib01", name: "Iran IB01", actor: "Iran", targetCountries: ["USA", "Israel", "Saudi Arabia"], primaryTarget: "population", channels: ["social-media", "bot-network", "proxy-outlet"], phase: "active", startDate: "2020-09-01", estimatedReach: 60, sophisticationScore: 65, narrativeCoherence: 60, detectionDifficulty: 55 },
  { id: "op-lazarus-narrative", name: "Lazarus Narrative Ops", actor: "North Korea", targetCountries: ["South Korea", "Japan", "USA"], primaryTarget: "diaspora", channels: ["social-media", "direct-contact"], phase: "active", startDate: "2021-05-01", estimatedReach: 20, sophisticationScore: 55, narrativeCoherence: 50, detectionDifficulty: 58 },
  { id: "op-tiktok-sway", name: "TikTok Influence Ops", actor: "China", targetCountries: ["USA", "UK", "EU"], primaryTarget: "population", channels: ["social-media"], phase: "active", startDate: "2023-01-01", estimatedReach: 500, sophisticationScore: 70, narrativeCoherence: 65, detectionDifficulty: 75 },
  { id: "op-rt-embed", name: "RT Embedding Ops", actor: "Russia", targetCountries: ["Germany", "France", "Italy", "Spain"], primaryTarget: "population", channels: ["state-media", "proxy-outlet"], phase: "consolidation", startDate: "2015-01-01", estimatedReach: 200, sophisticationScore: 78, narrativeCoherence: 80, detectionDifficulty: 60 },
];

const MOCK_DISINFO: DisinfoCampaign[] = [
  { id: "d1", actor: "Russia", narrative: "Ukraine biolabs funded by US DoD", targetCountry: "Global", spreadVelocity: 45000, factChecked: true, retracted: false, believabilityScore: 65 },
  { id: "d2", actor: "China", narrative: "COVID-19 originated at Fort Detrick", targetCountry: "China", spreadVelocity: 120000, factChecked: true, retracted: false, believabilityScore: 40 },
  { id: "d3", actor: "Iran", narrative: "US-Israel axis behind Middle East instability", targetCountry: "Middle East", spreadVelocity: 22000, factChecked: true, retracted: false, believabilityScore: 55 },
  { id: "d4", actor: "Russia", narrative: "NATO expansion caused Ukraine war", targetCountry: "EU", spreadVelocity: 38000, factChecked: true, retracted: false, believabilityScore: 58 },
  { id: "d5", actor: "China", narrative: "Taiwan independence would trigger WWIII", targetCountry: "Asia", spreadVelocity: 67000, factChecked: false, retracted: false, believabilityScore: 52 },
];

export function scoreCampaignThreat(c: PsyopCampaign): number {
  const phaseMultiplier = c.phase === "active" ? 1.0 : c.phase === "exploitation" ? 1.2 : c.phase === "preparation" ? 0.7 : c.phase === "consolidation" ? 0.8 : 0.3;
  const reachFactor = Math.min(100, c.estimatedReach / 5);
  return Math.min(100, Math.round((c.sophisticationScore * 0.3 + c.narrativeCoherence * 0.25 + c.detectionDifficulty * 0.25 + reachFactor * 0.2) * phaseMultiplier));
}

export function getActorCampaignCount(campaigns: PsyopCampaign[]): Record<ThreatActor, number> {
  const counts: Record<ThreatActor, number> = { Russia: 0, China: 0, Iran: 0, "North Korea": 0, "non-state": 0 };
  for (const c of campaigns) counts[c.actor]++;
  return counts;
}

export function filterByActor(campaigns: PsyopCampaign[], actor: ThreatActor): PsyopCampaign[] {
  return campaigns.filter(c => c.actor === actor);
}

export function filterByPhase(campaigns: PsyopCampaign[], phase: PsyopPhase): PsyopCampaign[] {
  return campaigns.filter(c => c.phase === phase);
}

export function computeTotalReach(campaigns: PsyopCampaign[]): number {
  return campaigns.reduce((s, c) => s + c.estimatedReach, 0);
}

export function rankCampaignsByThreat(campaigns: PsyopCampaign[]): PsyopCampaign[] {
  return [...campaigns].sort((a, b) => scoreCampaignThreat(b) - scoreCampaignThreat(a));
}

export function getChannelDistribution(campaigns: PsyopCampaign[]): Record<PsyopChannel, number> {
  const dist: Record<PsyopChannel, number> = { "social-media": 0, "state-media": 0, "bot-network": 0, "deepfake": 0, "proxy-outlet": 0, "direct-contact": 0 };
  for (const c of campaigns) for (const ch of c.channels) dist[ch]++;
  return dist;
}

export function getMostActiveActor(campaigns: PsyopCampaign[]): ThreatActor {
  const counts = getActorCampaignCount(campaigns);
  return (Object.entries(counts).sort(([,a],[,b]) => b - a)[0]?.[0] ?? "Russia") as ThreatActor;
}

export function computeDisinfoExposureScore(campaigns: DisinfoCampaign[]): number {
  const total = campaigns.reduce((s, d) => s + d.spreadVelocity * (d.believabilityScore / 100), 0);
  return Math.min(100, Math.round(total / 50000));
}

export function buildRenderData(): {
  campaigns: PsyopCampaign[];
  disinfo: DisinfoCampaign[];
  totalReachMillions: number;
  mostActiveActor: ThreatActor;
  channelDistribution: Record<PsyopChannel, number>;
  actorCounts: Record<ThreatActor, number>;
  disinfoExposure: number;
} {
  return {
    campaigns: rankCampaignsByThreat(MOCK_CAMPAIGNS),
    disinfo: MOCK_DISINFO,
    totalReachMillions: computeTotalReach(MOCK_CAMPAIGNS),
    mostActiveActor: getMostActiveActor(MOCK_CAMPAIGNS),
    channelDistribution: getChannelDistribution(MOCK_CAMPAIGNS),
    actorCounts: getActorCampaignCount(MOCK_CAMPAIGNS),
    disinfoExposure: computeDisinfoExposureScore(MOCK_DISINFO),
  };
}
