// propaganda-tracking-helpers.ts
// Pure logic for PropagandaTrackingPanel — no DOM, no Panel imports

export type CampaignStatus = 'Active' | 'Dormant' | 'Concluded';
export type CampaignSeverity = 'Low' | 'Medium' | 'High' | 'Critical';

export interface StateMediaOutlet {
  id: string;
  name: string;
  country: string;
  monthlyReachM: number; // millions
  factCheckScore: number; // 0-100, higher = more accurate
  platformsActive: string[];
  bannedIn: string[];
  annualBudgetM: number; // $M
  primaryNarratives: string[];
}

export interface PropagandaCampaign {
  id: string;
  actor: string;
  startDate: string;
  endDate?: string;
  primaryNarrative: string;
  platforms: string[];
  estimatedReachM: number;
  targetAudience: string;
  status: CampaignStatus;
  severity: CampaignSeverity;
  detectedBy: string;
  description: string;
}

export interface PropagandaData {
  outlets: StateMediaOutlet[];
  campaigns: PropagandaCampaign[];
  globalInfoWarIndex: number; // 0-100
  activeCampaignCount: number;
  totalReachM: number;
  topActors: string[];
}

const OUTLETS: StateMediaOutlet[] = [
  { id: "O001", name: "RT (Russia Today)", country: "Russia", monthlyReachM: 100, factCheckScore: 18, platformsActive: ["YouTube", "Twitter/X", "Telegram", "Website"], bannedIn: ["EU", "UK", "Canada", "Australia"], annualBudgetM: 400, primaryNarratives: ["NATO aggression", "Ukraine war framing", "US election interference", "Anti-Western sentiment"] },
  { id: "O002", name: "CGTN (China Global TV Network)", country: "China", monthlyReachM: 78, factCheckScore: 32, platformsActive: ["YouTube", "Twitter/X", "Facebook", "Website"], bannedIn: ["UK"], annualBudgetM: 300, primaryNarratives: ["Taiwan reunification", "Xinjiang denial", "COVID-19 origins", "Belt and Road Initiative"] },
  { id: "O003", name: "Xinhua News Agency", country: "China", monthlyReachM: 60, factCheckScore: 35, platformsActive: ["Twitter/X", "Facebook", "Wire services", "Website"], bannedIn: [], annualBudgetM: 500, primaryNarratives: ["China economic success", "Belt and Road", "Global South solidarity"] },
  { id: "O004", name: "Sputnik", country: "Russia", monthlyReachM: 35, factCheckScore: 15, platformsActive: ["Telegram", "Website", "Radio"], bannedIn: ["EU", "UK", "Canada", "Australia", "USA"], annualBudgetM: 150, primaryNarratives: ["NATO expansion", "US bioweapons labs", "European energy failure"] },
  { id: "O005", name: "Press TV", country: "Iran", monthlyReachM: 40, factCheckScore: 22, platformsActive: ["YouTube (limited)", "Website", "Telegram"], bannedIn: ["USA", "UK", "EU"], annualBudgetM: 80, primaryNarratives: ["Israel-Gaza framing", "US imperialism", "Iran nuclear legitimacy"] },
  { id: "O006", name: "Al Jazeera", country: "Qatar", monthlyReachM: 410, factCheckScore: 68, platformsActive: ["YouTube", "Twitter/X", "Website", "TV"], bannedIn: ["Saudi Arabia", "UAE", "Egypt", "Bahrain"], annualBudgetM: 650, primaryNarratives: ["Regional Arab coverage", "Gaza conflict coverage", "Democracy movements"] },
  { id: "O007", name: "TRT World", country: "Turkey", monthlyReachM: 22, factCheckScore: 48, platformsActive: ["YouTube", "Twitter/X", "Website"], bannedIn: [], annualBudgetM: 120, primaryNarratives: ["Turkish geopolitical role", "Azerbaijan-Armenia narrative", "Neo-Ottoman framing"] },
  { id: "O008", name: "KCNA (North Korean Central News Agency)", country: "North Korea", monthlyReachM: 3, factCheckScore: 5, platformsActive: ["Website", "State media only"], bannedIn: ["South Korea", "USA", "Japan"], annualBudgetM: 20, primaryNarratives: ["Kim dynasty legitimacy", "US threat narrative", "Nuclear deterrence success"] },
];

const CAMPAIGNS: PropagandaCampaign[] = [
  { id: "C001", actor: "Russia", startDate: "2022-02", primaryNarrative: "Ukraine war justification (denazification)", platforms: ["Telegram", "RT", "Sputnik", "Social media bots"], estimatedReachM: 400, targetAudience: "Russian domestic + Global South", status: "Active", severity: "Critical", detectedBy: "EU DisinfoLab, DFRLab, Bellingcat", description: "Coordinated narrative campaign framing Ukraine invasion as defensive operation against NATO and neo-Nazis; includes bot networks, fake accounts, and state media." },
  { id: "C002", actor: "China", startDate: "2021-03", primaryNarrative: "Xinjiang human rights denial", platforms: ["Twitter/X", "Facebook", "YouTube", "CGTN", "Xinhua"], estimatedReachM: 200, targetAudience: "Global, especially Global South and OIC members", status: "Active", severity: "High", detectedBy: "Oxford Internet Institute, Australian Strategic Policy Institute", description: "Coordinated network of state media, fake accounts, and diplomatic messaging denying Uyghur repression; promotes Xinjiang tourism videos." },
  { id: "C003", actor: "China", startDate: "2020-01", endDate: "2021-06", primaryNarrative: "COVID-19 lab leak suppression", platforms: ["WHO engagement", "Social media", "Diplomatic pressure"], estimatedReachM: 1000, targetAudience: "Global scientific community + public", status: "Concluded", severity: "Critical", detectedBy: "US Intelligence Community, Australian authorities", description: "Suppression of early COVID outbreak data and promotion of natural origin hypothesis; pressure on WHO investigators." },
  { id: "C004", actor: "Russia", startDate: "2024-01", primaryNarrative: "European energy crisis blame-shifting", platforms: ["RT", "Sputnik", "Telegram", "Far-right European media"], estimatedReachM: 150, targetAudience: "European public (Germany, France, Italy, Hungary)", status: "Active", severity: "High", detectedBy: "EU East StratCom Task Force", description: "Amplifies European energy prices and economic hardship; blames EU sanctions rather than Russian aggression; targets far-right and far-left political movements." },
  { id: "C005", actor: "Iran", startDate: "2023-10", primaryNarrative: "Israel-Hamas conflict framing", platforms: ["Press TV", "Telegram", "Twitter/X"], estimatedReachM: 80, targetAudience: "Arab world, Global Muslim community", status: "Active", severity: "High", detectedBy: "Meta Threat Intelligence, Microsoft DTAC", description: "Coordinated amplification of Hamas-sympathetic content; promotes Iranian resistance axis narrative; includes fake news site network." },
  { id: "C006", actor: "Russia", startDate: "2016-01", endDate: "2017-01", primaryNarrative: "2016 US presidential election interference", platforms: ["Facebook", "Twitter", "Instagram", "YouTube"], estimatedReachM: 126, targetAudience: "US swing state voters", status: "Concluded", severity: "Critical", detectedBy: "US Senate Intelligence Committee, Mueller Report, Facebook", description: "Internet Research Agency troll farm created 80,000+ Facebook posts reaching 126M users; targeted divisive social issues." },
  { id: "C007", actor: "China", startDate: "2022-08", primaryNarrative: "Taiwan provocation narrative post-Pelosi visit", platforms: ["CGTN", "Xinhua", "Twitter/X bot network", "WeChat"], estimatedReachM: 300, targetAudience: "Chinese domestic, Southeast Asia, Global", status: "Dormant", severity: "High", detectedBy: "Mandiant, Stanford Internet Observatory", description: "Coordinated amplification framing Nancy Pelosi Taiwan visit as US aggression; included bot networks creating false impression of global condemnation." },
  { id: "C008", actor: "North Korea", startDate: "2023-06", primaryNarrative: "Nuclear deterrence legitimacy", platforms: ["KCNA", "Diplomatic channels", "Russian-aligned media"], estimatedReachM: 10, targetAudience: "Domestic population, sympathetic global media", status: "Active", severity: "Low", detectedBy: "NK News, 38 North, South Korean NIS", description: "Routine state messaging on nuclear program as defensive deterrent; amplified via Russian and Chinese state media." },
];

export function computeGlobalInfoWarIndex(campaigns: PropagandaCampaign[]): number {
  if (!campaigns.length) return 0;
  const active = campaigns.filter(c => c.status === "Active");
  if (!active.length) return 5;
  const sevWeights: Record<CampaignSeverity, number> = { Critical: 10, High: 7, Medium: 4, Low: 2 };
  const score = active.reduce((s, c) => s + sevWeights[c.severity], 0);
  return Math.min(100, Math.round(score * 2));
}

export function getActiveCampaigns(campaigns: PropagandaCampaign[]): PropagandaCampaign[] {
  return campaigns.filter(c => c.status === "Active");
}

export function getDormantCampaigns(campaigns: PropagandaCampaign[]): PropagandaCampaign[] {
  return campaigns.filter(c => c.status === "Dormant");
}

export function getConcludedCampaigns(campaigns: PropagandaCampaign[]): PropagandaCampaign[] {
  return campaigns.filter(c => c.status === "Concluded");
}

export function getTopActors(campaigns: PropagandaCampaign[]): string[] {
  const counts: Record<string, number> = {};
  for (const c of campaigns) {
    counts[c.actor] = (counts[c.actor] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([actor]) => actor);
}

export function computeTotalReach(outlets: StateMediaOutlet[]): number {
  return outlets.reduce((s, o) => s + o.monthlyReachM, 0);
}

export function getCriticalCampaigns(campaigns: PropagandaCampaign[]): PropagandaCampaign[] {
  return campaigns.filter(c => c.severity === "Critical");
}

export function rankOutletsByReach(outlets: StateMediaOutlet[]): StateMediaOutlet[] {
  return [...outlets].sort((a, b) => b.monthlyReachM - a.monthlyReachM);
}

export function severityClass(severity: CampaignSeverity): string {
  const map: Record<CampaignSeverity, string> = { Critical: "sev-critical", High: "sev-high", Medium: "sev-medium", Low: "sev-low" };
  return map[severity] ?? "sev-low";
}

export function statusClass(status: CampaignStatus): string {
  const map: Record<CampaignStatus, string> = { Active: "status-active", Dormant: "status-dormant", Concluded: "status-concluded" };
  return map[status] ?? "status-concluded";
}

export function buildRenderData(): PropagandaData {
  return {
    outlets: OUTLETS,
    campaigns: CAMPAIGNS,
    globalInfoWarIndex: computeGlobalInfoWarIndex(CAMPAIGNS),
    activeCampaignCount: getActiveCampaigns(CAMPAIGNS).length,
    totalReachM: computeTotalReach(OUTLETS),
    topActors: getTopActors(CAMPAIGNS),
  };
}
