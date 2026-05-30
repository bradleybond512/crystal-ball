// maritime-piracy-helpers.ts
// Pure logic for MaritimePiracyPanel — no DOM, no Panel imports

export type PiracyTrend = "increasing" | "stable" | "decreasing";
export type SeverityLevel = "Low" | "Medium" | "High" | "Critical";
export type AttackType =
  | "Boarding"
  | "Hijacking"
  | "Attempted Boarding"
  | "Fired Upon"
  | "Kidnapping"
  | "Armed Robbery";
export type IncidentOutcome =
  | "Hijacked"
  | "Repelled"
  | "Crew Kidnapped"
  | "Escaped"
  | "Fired Upon";

export interface PiracyHotspot {
  id: string;
  region: string;
  annualIncidents: number;
  trend: PiracyTrend;
  primaryTactics: string[];
  severityLevel: SeverityLevel;
  primaryGroups: string[];
  description: string;
  economicImpactBn: number;
}

export interface PiracyIncident {
  id: string;
  date: string;
  region: string;
  shipType: string;
  attackType: AttackType;
  outcome: IncidentOutcome;
  crewImpact: string;
  description: string;
  significance: number; // 1-10
}

export interface PiracyData {
  hotspots: PiracyHotspot[];
  incidents: PiracyIncident[];
  globalPiracyIndex: number;
  totalIncidentsYTD: number;
  highRiskRegions: string[];
  crewsAtRisk: number;
}

const HOTSPOTS: PiracyHotspot[] = [
  {
    id: "H001",
    region: "Gulf of Guinea",
    annualIncidents: 80,
    trend: "stable",
    primaryTactics: ["Boarding", "Kidnapping", "Armed Robbery"],
    severityLevel: "High",
    primaryGroups: ["MEND remnants", "Nigerian criminal gangs"],
    description:
      "West Africa posquos Gulf of Guinea remains the most dangerous maritime zone globally for crew kidnappings. Criminal networks operate from river deltas targeting tankers and cargo vessels.",
    economicImpactBn: 1.2,
  },
  {
    id: "H002",
    region: "Strait of Malacca / Singapore",
    annualIncidents: 40,
    trend: "decreasing",
    primaryTactics: ["Boarding", "Armed Robbery"],
    severityLevel: "Medium",
    primaryGroups: ["Indonesian criminal gangs", "Malaysian criminal gangs"],
    description:
      "Effective ReCAAP coordination has reduced incidents significantly. Most attacks are opportunistic boarding and petty theft targeting anchored vessels in one of the world posquos busiest sea lanes.",
    economicImpactBn: 0.4,
  },
  {
    id: "H003",
    region: "Somali Basin / Indian Ocean",
    annualIncidents: 15,
    trend: "stable",
    primaryTactics: ["Hijacking", "Hostage-taking"],
    severityLevel: "Medium",
    primaryGroups: ["Al-Shabaab-linked pirates", "Somali clan militias"],
    description:
      "Incidents remain far below the 2010 peak of 150+ but Somali piracy has not been eliminated. International naval patrols continue to deter. Economic recovery from peak cost of $7B annually.",
    economicImpactBn: 0.3,
  },
  {
    id: "H004",
    region: "Red Sea / Gulf of Aden (Houthi)",
    annualIncidents: 60,
    trend: "increasing",
    primaryTactics: ["Missile attacks", "Drone strikes", "Vessel seizure"],
    severityLevel: "Critical",
    primaryGroups: ["Houthi movement (state-backed)"],
    description:
      "Houthi attacks on commercial shipping since November 2023 represent state-backed maritime terrorism. Major routes rerouted around Cape of Good Hope adding 10+ days and $10B+ in costs.",
    economicImpactBn: 10.0,
  },
  {
    id: "H005",
    region: "Bangladesh / India Coastline",
    annualIncidents: 25,
    trend: "stable",
    primaryTactics: ["Armed Robbery", "Theft"],
    severityLevel: "Low",
    primaryGroups: ["Local criminal groups", "Coastal gangs"],
    description:
      "Coastal and anchorage robberies targeting vessels at anchor. Predominantly low-level theft with limited violence. Port authority patrols partially effective at deterrence.",
    economicImpactBn: 0.2,
  },
  {
    id: "H006",
    region: "West Africa Offshore (Nigeria)",
    annualIncidents: 30,
    trend: "stable",
    primaryTactics: ["Oil theft", "Bunkering", "Armed Robbery"],
    severityLevel: "High",
    primaryGroups: ["Criminal bunkering networks", "Oil theft syndicates"],
    description:
      "Sophisticated oil theft and illegal bunkering operations costing Nigeria $1.5B annually. Criminal networks operate with offshore vessels and inland pipeline tap infrastructure.",
    economicImpactBn: 1.5,
  },
  {
    id: "H007",
    region: "Philippines / Sulu Sea",
    annualIncidents: 20,
    trend: "decreasing",
    primaryTactics: ["Kidnapping", "Ransom"],
    severityLevel: "Medium",
    primaryGroups: ["Abu Sayyaf remnants", "Criminal kidnapping groups"],
    description:
      "Abu Sayyaf kidnapping operations have declined due to Philippine military pressure, but residual capability remains. Fishing vessels and small cargo ships most at risk.",
    economicImpactBn: 0.3,
  },
];

const INCIDENTS: PiracyIncident[] = [
  {
    id: "I001",
    date: "2023-11-19",
    region: "Red Sea",
    shipType: "Car carrier",
    attackType: "Hijacking",
    outcome: "Hijacked",
    crewImpact: "25 crew members held at Hodeidah",
    description:
      "Houthi commandos seized Galaxy Leader, a vehicle carrier with Israeli ownership links. Crew held at Hodeidah port in Yemen as political leverage; became symbol of Houthi maritime campaign.",
    significance: 9,
  },
  {
    id: "I002",
    date: "2024-02-26",
    region: "Red Sea",
    shipType: "Container ship",
    attackType: "Fired Upon",
    outcome: "Fired Upon",
    crewImpact: "No casualties reported",
    description:
      "Houthi attack on MSC Palatium III using anti-ship missile. Vessel diverted. Part of sustained Houthi campaign targeting vessels with alleged Israel connections or transiting Red Sea.",
    significance: 8,
  },
  {
    id: "I003",
    date: "2023-06-14",
    region: "Gulf of Guinea",
    shipType: "Oil tanker",
    attackType: "Kidnapping",
    outcome: "Crew Kidnapped",
    crewImpact: "7 crew kidnapped, later released",
    description:
      "MT Agisilaos boarded by armed pirates in Gulf of Guinea. Seven crew taken ashore for ransom. Typical Gulf of Guinea criminal network pattern; crew released after ransom payment.",
    significance: 7,
  },
  {
    id: "I004",
    date: "2024-03-06",
    region: "Red Sea",
    shipType: "Bulk carrier",
    attackType: "Fired Upon",
    outcome: "Fired Upon",
    crewImpact: "3 crew members killed",
    description:
      "Houthi attack on True Confidence killed three crew — first confirmed fatalities from Houthi maritime strikes. Bangladesh, Philippines, and Vietnam nationals killed. Escalation threshold crossed.",
    significance: 9,
  },
  {
    id: "I005",
    date: "2024-03-12",
    region: "Strait of Malacca",
    shipType: "Chemical tanker",
    attackType: "Boarding",
    outcome: "Repelled",
    crewImpact: "No casualties",
    description:
      "Small craft approached tanker at anchor in Singapore Strait. Pirates boarded briefly before being driven off by crew. Cargo theft attempted but foiled; illustrates ongoing Malacca opportunism.",
    significance: 5,
  },
  {
    id: "I006",
    date: "2023-08-20",
    region: "Somali Basin",
    shipType: "Fishing vessel",
    attackType: "Attempted Boarding",
    outcome: "Repelled",
    crewImpact: "No casualties",
    description:
      "Skiffs approached fishing vessel 180nm off Somali coast. Vessel activated SSAS and increased speed. Naval patrol responded; pirates withdrew. Demonstrates ongoing Somali threat at lower intensity.",
    significance: 4,
  },
  {
    id: "I007",
    date: "2024-01-15",
    region: "Bangladesh coast",
    shipType: "Cargo vessel",
    attackType: "Armed Robbery",
    outcome: "Repelled",
    crewImpact: "No casualties",
    description:
      "Armed robbers boarded anchored cargo vessel at Chittagong roads. Crew raised alarm; robbers fled with minor stores. Typical low-level anchorage robbery pattern for South Asian coastlines.",
    significance: 4,
  },
  {
    id: "I008",
    date: "2023-04-02",
    region: "Philippines / Sulu Sea",
    shipType: "Fishing vessel",
    attackType: "Kidnapping",
    outcome: "Crew Kidnapped",
    crewImpact: "3 crew kidnapped, released after ransom",
    description:
      "Abu Sayyaf remnants kidnapped crew from fishing vessel in Sulu Sea. Ransom paid after two weeks. Demonstrates continued capability despite Philippine military pressure on the group.",
    significance: 7,
  },
  {
    id: "I009",
    date: "2024-02-08",
    region: "West Africa offshore",
    shipType: "Bunkering vessel",
    attackType: "Armed Robbery",
    outcome: "Hijacked",
    crewImpact: "No crew harm; $50M cargo loss",
    description:
      "Large-scale oil theft off Nigeria. Criminal syndicate offloaded ~200,000 barrels of crude worth $50M in sophisticated offshore transfer. Highlights scale of Nigerian bunkering networks.",
    significance: 8,
  },
  {
    id: "I010",
    date: "2023-12-14",
    region: "Gulf of Guinea",
    shipType: "Product tanker",
    attackType: "Hijacking",
    outcome: "Escaped",
    crewImpact: "All crew freed after 5 days",
    description:
      "MV Monjasa Reformer hijacked by armed pirates in Gulf of Guinea. Vessel held five days while pirates offloaded cargo. Crew released unharmed following naval intervention.",
    significance: 7,
  },
];

const SEVERITY_ORDER: Record<SeverityLevel, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 };

export function getHighSeverity(
  hotspots: PiracyHotspot[],
  threshold: SeverityLevel = "High",
): PiracyHotspot[] {
  return hotspots.filter(h => SEVERITY_ORDER[h.severityLevel] >= SEVERITY_ORDER[threshold]);
}

export function getIncreasingRegions(hotspots: PiracyHotspot[]): PiracyHotspot[] {
  return hotspots.filter(h => h.trend === "increasing");
}

export function getByAttackType(incidents: PiracyIncident[], type: AttackType): PiracyIncident[] {
  return incidents.filter(i => i.attackType === type);
}

export function computeGlobalPiracyIndex(hotspots: PiracyHotspot[]): number {
  if (!hotspots.length) return 0;
  const severityWeight: Record<SeverityLevel, number> = { Low: 1, Medium: 2, High: 3, Critical: 5 };
  const trendMult: Record<PiracyTrend, number> = { increasing: 1.3, stable: 1.0, decreasing: 0.7 };
  const totalWeighted = hotspots.reduce((sum, h) => {
    return sum + h.annualIncidents * severityWeight[h.severityLevel] * trendMult[h.trend];
  }, 0);
  // Normalize to 0-100: 1000 weighted incident-points ≈ index 100
  return Math.min(100, Math.round(totalWeighted / 10));
}

export function severityClass(level: SeverityLevel): string {
  const map: Record<SeverityLevel, string> = {
    Low: "piracy-low",
    Medium: "piracy-medium",
    High: "piracy-high",
    Critical: "piracy-critical",
  };
  return map[level] ?? "piracy-low";
}

export function trendClass(trend: PiracyTrend): string {
  const map: Record<PiracyTrend, string> = {
    increasing: "trend-up",
    stable: "trend-flat",
    decreasing: "trend-down",
  };
  return map[trend] ?? "trend-flat";
}

export function attackTypeClass(type: AttackType): string {
  const map: Record<AttackType, string> = {
    Boarding: "attack-boarding",
    Hijacking: "attack-hijacking",
    "Attempted Boarding": "attack-attempted",
    "Fired Upon": "attack-fired",
    Kidnapping: "attack-kidnapping",
    "Armed Robbery": "attack-robbery",
  };
  return map[type] ?? "attack-boarding";
}

export function buildRenderData(): PiracyData {
  const totalIncidentsYTD = HOTSPOTS.reduce((s, h) => s + h.annualIncidents, 0);
  const highRiskRegions = HOTSPOTS.filter(
    h => h.severityLevel === "High" || h.severityLevel === "Critical",
  ).map(h => h.region);
  // Estimate crews at risk: significant incidents * avg crew size of 20
  const crewsAtRisk = INCIDENTS.filter(i => i.significance >= 7).length * 20;
  return {
    hotspots: HOTSPOTS,
    incidents: INCIDENTS,
    globalPiracyIndex: computeGlobalPiracyIndex(HOTSPOTS),
    totalIncidentsYTD,
    highRiskRegions,
    crewsAtRisk,
  };
}
