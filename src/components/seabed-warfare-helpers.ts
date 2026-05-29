// seabed-warfare-helpers.ts
// Pure logic for SeabedWarfarePanel — no DOM, no Panel imports

export type InfraType = 'Submarine Cable' | 'Pipeline' | 'Power Cable' | 'Seabed Sensor' | 'Military Infrastructure';
export type ThreatLevel = 'Low' | 'Elevated' | 'High' | 'Critical';
export type IncidentType = 'Sabotage (Confirmed)' | 'Sabotage (Suspected)' | 'Accident' | 'Surveillance' | 'Positioning';

export interface SeabedAsset {
  id: string;
  name: string;
  type: InfraType;
  route: string;
  operators: string[];
  capacityNote: string;
  threatLevel: ThreatLevel;
  threatActors: string[];
  lastIncident?: string;
  criticalityScore: number; // 1-10
}

export interface SeabedIncident {
  id: string;
  date: string;
  asset: string;
  type: IncidentType;
  location: string;
  suspectedActor: string;
  attribution: 'Confirmed' | 'High Confidence' | 'Suspected' | 'Unknown';
  description: string;
  impactSeverity: number; // 1-10
  resolved: boolean;
}

export interface SeabedData {
  assets: SeabedAsset[];
  incidents: SeabedIncident[];
  globalSeabedRiskIndex: number;
  criticalAssetCount: number;
  highThreatCount: number;
  recentIncidentCount: number;
  mostVulnerableAssets: SeabedAsset[];
}

const ASSETS: SeabedAsset[] = [
  { id: "A001", name: "TAT-14 / AEConnect Atlantic Cables", type: "Submarine Cable", route: "USA — UK — Germany (N. Atlantic)", operators: ["AT&T", "BT", "Deutsche Telekom"], capacityNote: "~30% of transatlantic internet traffic", threatLevel: "High", threatActors: ["Russia (GRU)", "Unknown"], lastIncident: "2024-03", criticalityScore: 10 },
  { id: "A002", name: "Estlink-2", type: "Power Cable", route: "Finland — Estonia (Baltic Sea)", operators: ["Fingrid", "Elering"], capacityNote: "650 MW Baltic grid interconnector", threatLevel: "Critical", threatActors: ["Russia"], lastIncident: "2024-12", criticalityScore: 9 },
  { id: "A003", name: "Nord Stream 1 & 2", type: "Pipeline", route: "Russia — Germany (Baltic Sea)", operators: ["Gazprom"], capacityNote: "Both destroyed Sept 2022; ~55 BCM/yr capacity lost", threatLevel: "Critical", threatActors: ["Multiple attributed"], lastIncident: "2022-09", criticalityScore: 9 },
  { id: "A004", name: "Baltic Cable + BaltLink", type: "Power Cable", route: "Sweden — Germany / Lithuania — Sweden", operators: ["Vattenfall", "Baltic Cable AB"], capacityNote: "600 MW Baltic-Central Europe link", threatLevel: "Elevated", threatActors: ["Russia"], criticalityScore: 7 },
  { id: "A005", name: "Trans-Pacific Cable System (TPC)", type: "Submarine Cable", route: "USA — Japan — Taiwan — Philippines", operators: ["NTT", "AT&T", "KDD"], capacityNote: "Backbone of US-Asia communications", threatLevel: "High", threatActors: ["China (PLA-SSF)"], criticalityScore: 10 },
  { id: "A006", name: "SEA-ME-WE 5 & 6", type: "Submarine Cable", route: "Singapore — Middle East — Europe", operators: ["Orange", "Singtel", "STC"], capacityNote: "Major Europe-Asia internet trunk", threatLevel: "Elevated", threatActors: ["Unknown", "Iran (suspected)"], criticalityScore: 8 },
  { id: "A007", name: "SOSUS/IUSS Sensor Network", type: "Seabed Sensor", route: "N. Atlantic / N. Pacific GIUK gap", operators: ["US Navy"], capacityNote: "Sub-surface acoustic surveillance network", threatLevel: "High", threatActors: ["Russia", "China"], criticalityScore: 10 },
  { id: "A008", name: "Baltic Telecom Cables (x4 cut 2024)", type: "Submarine Cable", route: "Germany — Finland, Sweden — Lithuania, etc.", operators: ["Multiple Nordic carriers"], capacityNote: "4 cables severed Oct-Nov 2024 by suspected Chinese/Russian vessels", threatLevel: "Critical", threatActors: ["China (Yi Peng 3 vessel)", "Russia"], lastIncident: "2024-11", criticalityScore: 9 },
  { id: "A009", name: "EuroAsia Interconnector", type: "Power Cable", route: "Israel — Cyprus — Greece (planned)", operators: ["EuroAsia Interconnector Ltd"], capacityNote: "World longest submarine power cable (898 km)", threatLevel: "Elevated", threatActors: ["Turkey", "Iran (suspected)"], criticalityScore: 7 },
  { id: "A010", name: "Pacific Crossing / PC-1", type: "Submarine Cable", route: "Japan — USA (2 paths across Pacific)", operators: ["NTT Com", "AT&T"], capacityNote: "640 Gbps; critical for US-Japan defense comms", threatLevel: "High", threatActors: ["China (PLA)"], criticalityScore: 9 },
];

const INCIDENTS: SeabedIncident[] = [
  { id: "I001", date: "2024-11-18", asset: "Baltic Telecom Cables (x4 cut 2024)", type: "Sabotage (Suspected)", location: "Baltic Sea", suspectedActor: "China (Yi Peng 3) / Russia", attribution: "High Confidence", description: "Estlink-2 power cable and C-Lion1 Finland-Germany cable severed same day. Chinese bulk carrier Yi Peng 3 anchored on cable route; detained by Sweden/Finland. Two more cables cut within weeks.", impactSeverity: 9, resolved: false },
  { id: "I002", date: "2022-09-26", asset: "Nord Stream 1 & 2", type: "Sabotage (Confirmed)", location: "Baltic Sea (Bornholm area)", suspectedActor: "Multiple attributed (Ukraine/UK/Russia disputed)", attribution: "Confirmed", description: "Explosives destroyed 3 of 4 Nord Stream pipeline sections. Largest peacetime attack on energy infrastructure. Seaquake sensors confirmed underwater explosions. No definitive state attribution.", impactSeverity: 10, resolved: true },
  { id: "I003", date: "2024-03-15", asset: "TAT-14 / AEConnect Atlantic Cables", type: "Surveillance", location: "N. Atlantic", suspectedActor: "Russia (Northern Fleet)", attribution: "Suspected", description: "Russian research vessels Yantar and Sibiryakov with deep-sea submersibles operating near transatlantic cable routes. Pattern consistent with pre-sabotage reconnaissance.", impactSeverity: 6, resolved: false },
  { id: "I004", date: "2023-10-08", asset: "Baltic Cable + BaltLink", type: "Sabotage (Suspected)", location: "Baltic Sea", suspectedActor: "Russia (suspected)", attribution: "Suspected", description: "Balticconnector Finland-Estonia gas pipeline and Cinia telecom cable severed same night. Chinese ship Newnew Polar Bear identified as likely culprit (anchor drag). Russia beneficiary.", impactSeverity: 8, resolved: true },
  { id: "I005", date: "2024-01-20", asset: "SEA-ME-WE 5 & 6", type: "Sabotage (Suspected)", location: "Red Sea", suspectedActor: "Houthi (Iran-proxied)", attribution: "High Confidence", description: "Houthi attacks on container ships caused indirect damage to Red Sea cables. EIG, Seacom, TGN-EA cables cut by fallen ship anchors during Houthi anti-shipping campaign.", impactSeverity: 7, resolved: false },
  { id: "I006", date: "2024-08-01", asset: "SOSUS/IUSS Sensor Network", type: "Positioning", location: "GIUK Gap", suspectedActor: "Russia", attribution: "High Confidence", description: "Russian Yantar-class intel vessel loitered over NATO SOSUS sensor nodes in GIUK gap. Deepwater submersibles deployed. Assessment: mapping/disruption preparation.", impactSeverity: 7, resolved: false },
];

export function computeGlobalSeabedRiskIndex(assets: SeabedAsset[], incidents: SeabedIncident[]): number {
  if (!assets.length) return 0;
  const highThreat = assets.filter(a => a.threatLevel === "High" || a.threatLevel === "Critical");
  const assetScore = (highThreat.length / assets.length) * 60;
  const recentUnresolved = incidents.filter(i => !i.resolved && i.type.startsWith("Sabotage"));
  const incidentScore = Math.min(40, recentUnresolved.length * 12);
  return Math.min(100, Math.round(assetScore + incidentScore));
}

export function getCriticalAssets(assets: SeabedAsset[]): SeabedAsset[] {
  return assets.filter(a => a.threatLevel === "Critical");
}

export function getHighThreatAssets(assets: SeabedAsset[]): SeabedAsset[] {
  return assets.filter(a => a.threatLevel === "High" || a.threatLevel === "Critical");
}

export function getMostVulnerable(assets: SeabedAsset[], n = 5): SeabedAsset[] {
  return [...assets].sort((a, b) => b.criticalityScore - a.criticalityScore).slice(0, n);
}

export function getUnresolvedIncidents(incidents: SeabedIncident[]): SeabedIncident[] {
  return incidents.filter(i => !i.resolved);
}

export function getConfirmedSabotage(incidents: SeabedIncident[]): SeabedIncident[] {
  return incidents.filter(i => i.type === "Sabotage (Confirmed)");
}

export function threatLevelClass(level: ThreatLevel): string {
  const m: Record<ThreatLevel, string> = { Low: "threat-low", Elevated: "threat-elevated", High: "threat-high", Critical: "threat-critical" };
  return m[level] ?? "threat-low";
}

export function incidentTypeClass(type: IncidentType): string {
  const m: Record<IncidentType, string> = { "Sabotage (Confirmed)": "inc-sabotage", "Sabotage (Suspected)": "inc-suspected", "Accident": "inc-accident", "Surveillance": "inc-surv", "Positioning": "inc-position" };
  return m[type] ?? "inc-surv";
}

export function buildRenderData(): SeabedData {
  return {
    assets: ASSETS,
    incidents: INCIDENTS,
    globalSeabedRiskIndex: computeGlobalSeabedRiskIndex(ASSETS, INCIDENTS),
    criticalAssetCount: getCriticalAssets(ASSETS).length,
    highThreatCount: getHighThreatAssets(ASSETS).length,
    recentIncidentCount: INCIDENTS.length,
    mostVulnerableAssets: getMostVulnerable(ASSETS, 5),
  };
}
