// coercive-diplomacy-helpers.ts
// Pure logic for CoerciveDiplomacyPanel — no DOM, no Panel imports

export type CoercionActionType =
  | "Expulsion"
  | "Consulate Closure"
  | "Downgrade"
  | "Travel Ban"
  | "Threat"
  | "Recall";

export type CoercionOutcome =
  | "Ongoing"
  | "Resolved"
  | "Escalated"
  | "Partially Resolved"
  | "Failed";

export type TensionStatus = "Active" | "Frozen" | "Easing" | "Escalating";
export type TensionTrend = "improving" | "stable" | "deteriorating";

export interface CoercionIncident {
  id: string;
  actor: string;
  target: string;
  actionType: CoercionActionType;
  date: string;
  description: string;
  outcome: CoercionOutcome;
  severity: number; // 1-10
  linkedConflict?: string;
}

export interface BilateralTension {
  id: string;
  partyA: string;
  partyB: string;
  status: TensionStatus;
  tensionScore: number; // 0-100
  primaryGrievance: string;
  lastIncident: string;
  trend: TensionTrend;
}

export interface CoerciveDiplomacyRenderData {
  incidents: CoercionIncident[];
  tensions: BilateralTension[];
  globalDiplomaticStabilityIndex: number;
  totalExpulsions: number;
  activeIncidents: number;
  highSeverityCount: number;
  mostSevereIncident: CoercionIncident | null;
}

const INCIDENTS: CoercionIncident[] = [
  {
    id: "CD001",
    actor: "Russia",
    target: "Western Nations",
    actionType: "Expulsion",
    date: "2022-03",
    description: "Russia expelled 40+ EU and NATO diplomats following Ukraine invasion; reciprocal expulsions by 30+ Western states totaling 400+ diplomats — largest mass expulsion since Cold War.",
    outcome: "Ongoing",
    severity: 10,
    linkedConflict: "Russia-Ukraine War",
  },
  {
    id: "CD002",
    actor: "China",
    target: "Lithuania",
    actionType: "Consulate Closure",
    date: "2021-11",
    description: "China downgraded relations and forced closure of its Vilnius embassy after Lithuania allowed Taiwan to open representative office using 'Taiwan' name. Economic coercion followed.",
    outcome: "Escalated",
    severity: 8,
    linkedConflict: "Taiwan Strait Tensions",
  },
  {
    id: "CD003",
    actor: "UK",
    target: "Iran",
    actionType: "Downgrade",
    date: "2023-01",
    description: "UK-Iran diplomatic crisis escalated after Iranian-backed threats to British citizens; UK designated IRGC a terrorist organization, Iran recalled ambassador.",
    outcome: "Ongoing",
    severity: 7,
  },
  {
    id: "CD004",
    actor: "China",
    target: "Australia",
    actionType: "Downgrade",
    date: "2020-11",
    description: "China froze ministerial contacts with Australia following Canberra call for COVID-19 inquiry and Huawei ban. Diplomatic freeze lasted until 2023 Albanese-Xi summit.",
    outcome: "Partially Resolved",
    severity: 7,
  },
  {
    id: "CD005",
    actor: "Turkey",
    target: "Sweden",
    actionType: "Threat",
    date: "2022-05",
    description: "Turkey blocked Sweden and Finland NATO accession for 14 months, demanding extradition of Kurdish PKK members and reversal of arms embargo. Sweden met key conditions in June 2023.",
    outcome: "Resolved",
    severity: 8,
  },
  {
    id: "CD006",
    actor: "Russia",
    target: "Estonia",
    actionType: "Expulsion",
    date: "2023-02",
    description: "Russia expelled Estonian ambassador and reduced embassy to skeleton staff after Estonia led EU push to expel Russian diplomats from Baltic states.",
    outcome: "Ongoing",
    severity: 6,
  },
  {
    id: "CD007",
    actor: "Hamas",
    target: "Mediating States",
    actionType: "Threat",
    date: "2023-10",
    description: "Hamas used hostage diplomacy to pressure Qatar, Egypt, and US mediators; 240 hostages taken October 7, used as leverage in ceasefire negotiations through 2024.",
    outcome: "Ongoing",
    severity: 10,
    linkedConflict: "Israel-Hamas War",
  },
  {
    id: "CD008",
    actor: "Russia",
    target: "UK",
    actionType: "Recall",
    date: "2022-03",
    description: "Following Ukraine invasion UK expelled 8 Russian diplomats for undeclared intelligence activities; Russia recalled its ambassador to London and expelled British diplomats in retaliation.",
    outcome: "Ongoing",
    severity: 7,
  },
  {
    id: "CD009",
    actor: "North Korea",
    target: "South Korea",
    actionType: "Downgrade",
    date: "2020-06",
    description: "North Korea severed inter-Korean communication hotlines, demolished Joint Liaison Office in Kaesong, and declared South Korean territory hostile. Balloon campaigns escalated through 2024.",
    outcome: "Escalated",
    severity: 8,
    linkedConflict: "Korean Peninsula Tensions",
  },
  {
    id: "CD010",
    actor: "Israel",
    target: "Turkey",
    actionType: "Recall",
    date: "2023-11",
    description: "Israel recalled its ambassador to Turkey after Erdogan called Hamas fighters freedom fighters and cut trade. Turkey recalled its ambassador to Israel in November 2023.",
    outcome: "Ongoing",
    severity: 7,
    linkedConflict: "Israel-Hamas War",
  },
  {
    id: "CD011",
    actor: "China",
    target: "Canada",
    actionType: "Expulsion",
    date: "2023-05",
    description: "China expelled Canadian diplomat in tit-for-tat response to Canada expelling Chinese diplomat accused of targeting MP Michael Chong and his Hong Kong relatives.",
    outcome: "Ongoing",
    severity: 6,
  },
  {
    id: "CD012",
    actor: "Iran",
    target: "Albania",
    actionType: "Expulsion",
    date: "2022-09",
    description: "Albania severed diplomatic relations with Iran and expelled ambassador after Iranian-linked cyberattack on Albanian government infrastructure. NATO condemned the cyber-enabled coercion.",
    outcome: "Resolved",
    severity: 7,
  },
];

const TENSIONS: BilateralTension[] = [
  {
    id: "T001",
    partyA: "Russia",
    partyB: "NATO",
    status: "Escalating",
    tensionScore: 95,
    primaryGrievance: "Ukraine War, nuclear threats, Baltic state security",
    lastIncident: "2024-09",
    trend: "deteriorating",
  },
  {
    id: "T002",
    partyA: "China",
    partyB: "USA",
    status: "Active",
    tensionScore: 80,
    primaryGrievance: "Taiwan, South China Sea, technology decoupling, Fentanyl",
    lastIncident: "2024-08",
    trend: "stable",
  },
  {
    id: "T003",
    partyA: "China",
    partyB: "Taiwan",
    status: "Escalating",
    tensionScore: 88,
    primaryGrievance: "Sovereignty, military encirclement, US arms sales",
    lastIncident: "2024-10",
    trend: "deteriorating",
  },
  {
    id: "T004",
    partyA: "Iran",
    partyB: "Israel",
    status: "Active",
    tensionScore: 90,
    primaryGrievance: "Nuclear program, proxy wars, direct missile exchanges April 2024",
    lastIncident: "2024-04",
    trend: "deteriorating",
  },
  {
    id: "T005",
    partyA: "North Korea",
    partyB: "South Korea",
    status: "Escalating",
    tensionScore: 82,
    primaryGrievance: "Balloon campaigns, missile tests, military pact with Russia",
    lastIncident: "2024-11",
    trend: "deteriorating",
  },
  {
    id: "T006",
    partyA: "India",
    partyB: "Pakistan",
    status: "Active",
    tensionScore: 65,
    primaryGrievance: "Kashmir, cross-border terrorism, water disputes",
    lastIncident: "2023-12",
    trend: "stable",
  },
  {
    id: "T007",
    partyA: "China",
    partyB: "Philippines",
    status: "Escalating",
    tensionScore: 75,
    primaryGrievance: "South China Sea, Second Thomas Shoal, coast guard confrontations",
    lastIncident: "2024-09",
    trend: "deteriorating",
  },
  {
    id: "T008",
    partyA: "UK",
    partyB: "Argentina",
    status: "Frozen",
    tensionScore: 35,
    primaryGrievance: "Falkland Islands sovereignty dispute",
    lastIncident: "2023-04",
    trend: "stable",
  },
  {
    id: "T009",
    partyA: "Azerbaijan",
    partyB: "Armenia",
    status: "Easing",
    tensionScore: 55,
    primaryGrievance: "Post-Karabakh peace treaty, border demarcation",
    lastIncident: "2024-01",
    trend: "improving",
  },
  {
    id: "T010",
    partyA: "Saudi Arabia",
    partyB: "Iran",
    status: "Easing",
    tensionScore: 48,
    primaryGrievance: "Regional influence, Yemen proxy war, diplomatic normalization via China",
    lastIncident: "2023-03",
    trend: "improving",
  },
];

// ── Helper functions ─────────────────────────────────────────────────────────

export function getByActionType(
  incidents: CoercionIncident[],
  type: CoercionActionType,
): CoercionIncident[] {
  return incidents.filter((i) => i.actionType === type);
}

export function getOngoingTensions(tensions: BilateralTension[]): BilateralTension[] {
  return tensions.filter((t) => t.status === "Active" || t.status === "Escalating");
}

export function getMostSevere(incidents: CoercionIncident[]): CoercionIncident | null {
  if (!incidents.length) return null;
  return incidents.reduce((max, i) => (i.severity > max.severity ? i : max));
}

export function rankByTension(tensions: BilateralTension[]): BilateralTension[] {
  return [...tensions].sort((a, b) => b.tensionScore - a.tensionScore);
}

export function actionClass(type: CoercionActionType): string {
  switch (type) {
    case "Expulsion": return "cd-action-expulsion";
    case "Consulate Closure": return "cd-action-closure";
    case "Downgrade": return "cd-action-downgrade";
    case "Travel Ban": return "cd-action-travel-ban";
    case "Threat": return "cd-action-threat";
    case "Recall": return "cd-action-recall";
    default: return "cd-action-unknown";
  }
}

export function tensionClass(status: TensionStatus): string {
  switch (status) {
    case "Escalating": return "cd-tension-escalating";
    case "Active": return "cd-tension-active";
    case "Frozen": return "cd-tension-frozen";
    case "Easing": return "cd-tension-easing";
    default: return "cd-tension-unknown";
  }
}

export function outcomeClass(outcome: CoercionOutcome): string {
  switch (outcome) {
    case "Ongoing": return "cd-outcome-ongoing";
    case "Escalated": return "cd-outcome-escalated";
    case "Resolved": return "cd-outcome-resolved";
    case "Partially Resolved": return "cd-outcome-partial";
    case "Failed": return "cd-outcome-failed";
    default: return "cd-outcome-unknown";
  }
}

export function computeGlobalDiplomaticStabilityIndex(
  incidents: CoercionIncident[],
  tensions: BilateralTension[],
): number {
  if (!incidents.length && !tensions.length) return 100;
  const incidentPressure = incidents.reduce((sum, i) => {
    const multiplier = i.outcome === "Ongoing" || i.outcome === "Escalated" ? 1.5 : 0.5;
    return sum + i.severity * multiplier;
  }, 0);
  const tensionPressure = tensions.reduce((sum, t) => sum + t.tensionScore, 0);
  const maxIncidentPressure = incidents.length * 10 * 1.5;
  const maxTensionPressure = tensions.length * 100;
  const incidentNorm = maxIncidentPressure > 0 ? incidentPressure / maxIncidentPressure : 0;
  const tensionNorm = maxTensionPressure > 0 ? tensionPressure / maxTensionPressure : 0;
  const instability = Math.round(((incidentNorm + tensionNorm) / 2) * 100);
  return Math.max(0, Math.min(100, 100 - instability));
}

export function buildRenderData(): CoerciveDiplomacyRenderData {
  const incidents = INCIDENTS;
  const tensions = TENSIONS;
  const globalDiplomaticStabilityIndex = computeGlobalDiplomaticStabilityIndex(incidents, tensions);
  const totalExpulsions = getByActionType(incidents, "Expulsion").length;
  const activeIncidents = incidents.filter(
    (i) => i.outcome === "Ongoing" || i.outcome === "Escalated",
  ).length;
  const highSeverityCount = incidents.filter((i) => i.severity >= 8).length;
  const mostSevereIncident = getMostSevere(incidents);
  return {
    incidents,
    tensions,
    globalDiplomaticStabilityIndex,
    totalExpulsions,
    activeIncidents,
    highSeverityCount,
    mostSevereIncident,
  };
}
