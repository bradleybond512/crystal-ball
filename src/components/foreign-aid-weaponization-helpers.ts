// foreign-aid-weaponization-helpers.ts
// Pure logic for ForeignAidWeaponizationPanel — no DOM, no Panel imports

export type AidEventType =
  | "freeze"
  | "cut"
  | "condition"
  | "redirect"
  | "weaponize"
  | "competition"
  | "reform";

export type DonorCategory = "Western" | "BRICS" | "Gulf" | "Multilateral" | "Emerging";

export type LeverageType =
  | "military"
  | "economic"
  | "diplomatic"
  | "infrastructure"
  | "food"
  | "humanitarian";

export interface AidEvent {
  id: string;
  date: string;
  donor: string;
  recipient: string;
  eventType: AidEventType;
  description: string;
  amountBillionUSD?: number;
  impactScore: number; // 1-10
  active: boolean;
  geopoliticalEffect: string;
  sources: string[];
}

export interface DonorProfile {
  id: string;
  name: string;
  category: DonorCategory;
  annualAidBillionUSD: number;
  leverageTypes: LeverageType[];
  conditionality: string;
  politicalAlignment: string;
  keyInstruments: string[];
  incidentCount: number;
  trend: "escalating" | "stable" | "declining";
}

export interface ForeignAidWeaponizationRenderData {
  events: AidEvent[];
  donors: DonorProfile[];
  weaponizationIndex: number; // 0-100
  highImpactCount: number;
  activeConditionCount: number;
  topDonors: DonorProfile[];
  recentEvents: AidEvent[];
}

// ── Data ──────────────────────────────────────────────────────────────────────

const AID_EVENTS: AidEvent[] = [
  {
    id: "FA001",
    date: "2025-01-20",
    donor: "USA",
    recipient: "Global (90+ countries)",
    eventType: "freeze",
    description:
      "Trump administration froze 0B+/year USAID budget via executive order on inauguration day. DOGE deployed to State Dept and USAID; 10,000+ programs paused worldwide. Largest single-event foreign aid disruption in US history. Humanitarian programs, HIV/AIDS treatment, food security, and development projects halted.",
    amountBillionUSD: 60,
    impactScore: 10,
    active: true,
    geopoliticalEffect:
      "Massive vacuum in global development finance; China and Gulf states moving to fill gaps; NGO ecosystem facing collapse; US soft power decline accelerating.",
    sources: ["Executive Order Jan 20 2025", "USAID shutdown notices", "State Dept DOGE memo"],
  },
  {
    id: "FA002",
    date: "2024-04-24",
    donor: "USA",
    recipient: "Ukraine",
    eventType: "condition",
    description:
      "Congress passed 1B Ukraine aid package after six-month Congressional battle. Trump had blocked the package demanding border security legislation. Final package included military hardware, ammunition, and economic support. Trump continued threatening to cut off aid after taking office.",
    amountBillionUSD: 61,
    impactScore: 9,
    active: false,
    geopoliticalEffect:
      "NATO cohesion test; Russia emboldened during aid gap; Ukraine forced to ration ammunition; European allies scrambling to fill gaps.",
    sources: ["HR 815 signed April 24 2024", "Congressional Budget Office", "DoD Ukraine Security Assistance Initiative"],
  },
  {
    id: "FA003",
    date: "2023-01-01",
    donor: "USA",
    recipient: "Egypt",
    eventType: "condition",
    description:
      "US Congress withheld 5M of Egypt annual .3B military aid on human rights grounds: political prisoners, press freedom, due process. Administration repeatedly waived conditions citing national security interests. Ongoing debate between strategic value (Suez Canal, Camp David) vs. human rights conditionality.",
    amountBillionUSD: 1.3,
    impactScore: 6,
    active: true,
    geopoliticalEffect:
      "Egypt hedging toward Russia and China; purchased Russian Su-35s; participates in Chinese-led forums while maintaining US military relationship.",
    sources: ["SFOPS appropriations", "State Dept human rights report", "Cairo Bureau diplomatic cables"],
  },
  {
    id: "FA004",
    date: "2022-01-01",
    donor: "China",
    recipient: "Global South (140+ countries)",
    eventType: "condition",
    description:
      "Belt and Road Initiative infrastructure aid tied to diplomatic recognition of PRC over Taiwan, UN voting alignment, and exclusion of Western telecom infrastructure (Huawei). China provided 43B in BRI commitments 2013-2021. Aid conditioned on non-interference framing that bars human rights conditions.",
    amountBillionUSD: 843,
    impactScore: 9,
    active: true,
    geopoliticalEffect:
      "Taiwan recognition down to 12 countries (2024); China controls UN voting blocs on Xinjiang Tibet Hong Kong; debt-trap diplomacy controversy (Hambantota Port, Ethiopia, Zambia).",
    sources: ["AidData Research Lab BRI study 2021", "OECD DAC", "Global Development Policy Center Boston University"],
  },
  {
    id: "FA005",
    date: "2023-07-01",
    donor: "EU",
    recipient: "Tunisia",
    eventType: "condition",
    description:
      "EU signed 105M EUR Memorandum of Understanding with Tunisia for migration control; aid explicitly conditioned on Tunisia preventing migrants from crossing to Europe. Human rights groups criticized deal as incentivizing pushbacks into Libyan desert. Deal bypassed standard EU democratic conditionality.",
    amountBillionUSD: 0.105,
    impactScore: 7,
    active: true,
    geopoliticalEffect:
      "EU democratic conditionality credibility undermined; precedent for security-over-values aid; Morocco deal 2022 (500M EUR) followed same template.",
    sources: ["EU-Tunisia MoU July 2023", "European Commission press release", "Amnesty International report"],
  },
  {
    id: "FA006",
    date: "2022-07-22",
    donor: "Russia",
    recipient: "Global (Middle East, Africa)",
    eventType: "weaponize",
    description:
      "Russia used Black Sea Grain Initiative as diplomatic leverage. Withdrew from and rejoined the deal multiple times 2022-2023, using access to 45M tonnes/year of Ukrainian grain as geopolitical tool. Provided subsidized grain to African allies (Egypt, Ethiopia). Sabotaged Kakhovka dam 2023 destroying irrigation for 600,000 hectares.",
    amountBillionUSD: 0,
    impactScore: 8,
    active: false,
    geopoliticalEffect:
      "Food price spikes hit MENA and Sub-Saharan Africa hardest; increased Russian influence in African Union; grain deal collapse July 2023 led to price surge.",
    sources: ["UN Black Sea Grain Initiative reports", "USDA global supply forecasts", "WFP emergency assessments"],
  },
  {
    id: "FA007",
    date: "2023-10-07",
    donor: "Gulf States",
    recipient: "Egypt, Jordan, PA",
    eventType: "condition",
    description:
      "Gulf states provided 5B+ in financial support to Egypt, Jordan, and Palestinian Authority with implicit conditions of political silence on Gaza policy. Qatar maintained Hamas political office funding (0M/mo) as mediation tool. Saudi-UAE split on Gaza stance reflected in aid conditionality.",
    amountBillionUSD: 25,
    impactScore: 8,
    active: true,
    geopoliticalEffect:
      "Gulf states using financial aid as primary regional stability mechanism; Egypt prevented from publicly criticizing Israel offensive; PA funding tied to security cooperation.",
    sources: ["IMF Egypt Article IV", "Jordan MOU with Gulf Cooperation Council", "AP Qatar Hamas funding investigation"],
  },
  {
    id: "FA008",
    date: "2024-02-01",
    donor: "India",
    recipient: "Bangladesh, Sri Lanka, Nepal, Maldives",
    eventType: "competition",
    description:
      "India Quad alignment aid strategy: B+ in lines of credit to Sri Lanka (post-IMF crisis), B to Bangladesh, infrastructure grants to Nepal. Counter to Chinese BRI presence. Maldives elected pro-China president (Nov 2023) who expelled Indian military; India cut fuel subsidies in response demonstrating aid leverage.",
    amountBillionUSD: 12,
    impactScore: 7,
    active: true,
    geopoliticalEffect:
      "Neighborhood First doctrine vs. China BRI competition in South Asia; Sri Lanka demonstrating willingness to play China vs. India; Nepal hydropower project arena.",
    sources: ["MEA India development partnership", "Quad Infrastructure Partnership", "RIS New Delhi policy brief"],
  },
  {
    id: "FA009",
    date: "2022-02-27",
    donor: "Germany",
    recipient: "Ukraine (Zeitenwende redirect)",
    eventType: "redirect",
    description:
      "Zeitenwende: Scholz announced 100B EUR special defence fund redirecting Germany from 0.5% to 2% GDP defense. ODA redirected: Ukraine received 8.8B EUR (2022-2024) vs. traditional development partners. German development bank KfW shifted portfolio toward conflict response.",
    amountBillionUSD: 8.8,
    impactScore: 7,
    active: true,
    geopoliticalEffect:
      "EU development architecture being reshaped by security priorities; traditional aid recipients (Africa, Latin America) facing reduced German support; NATO reinforcement.",
    sources: ["Bundestag Sondervermogen legislation", "BMZ development report 2023", "KfW annual report 2023"],
  },
  {
    id: "FA010",
    date: "2021-11-01",
    donor: "UK",
    recipient: "Global",
    eventType: "cut",
    description:
      "UK cut Official Development Assistance from 0.7% to 0.5% GDP (Nov 2020, implemented 2021), citing COVID-19 costs. Cut reduced UK aid by ~4B GBP/year. Labour government reversed to 0.7% commitment in 2024 manifesto though fiscal constraints remain.",
    amountBillionUSD: 4,
    impactScore: 6,
    active: false,
    geopoliticalEffect:
      "UK soft power decline in Commonwealth; Global Britain credibility undermined; FCDO capability hollowed out; Africa aid programs cut 30-80%.",
    sources: ["FCDO ODA statistics 2021-2024", "Overseas Development Institute analysis", "Labour manifesto 2024"],
  },
  {
    id: "FA011",
    date: "2022-01-01",
    donor: "Saudi Arabia",
    recipient: "Yemen, Somalia, Sudan",
    eventType: "competition",
    description:
      "Saudi-UAE aid competition in Horn of Africa and Yemen: Saudi Fund for Development disbursed 5B since 2017. UAE competes with separate Abu Dhabi Fund channels; divergent Yemen war exit strategies reflected in competing aid conditionality. Somalia: UAE-Qatar proxy competition via infrastructure grants tied to political alignment.",
    amountBillionUSD: 35,
    impactScore: 7,
    active: true,
    geopoliticalEffect:
      "Divided Gulf aid undermining Yemen peace process; Somalia political fragmentation aided by competing Gulf patrons; Sudan civil war both Saudi and UAE backing different factions.",
    sources: ["Saudi Fund for Development annual report", "UN Panel of Experts Yemen report", "Crisis Group Horn of Africa analysis"],
  },
  {
    id: "FA012",
    date: "2023-01-01",
    donor: "World Bank",
    recipient: "Global South",
    eventType: "reform",
    description:
      "Developing world pushback on World Bank/IMF structural adjustment conditionality. Zambia, Ghana, Sri Lanka defaults exposed debt architecture failures. G20 Common Framework criticized as too slow. Ghana secured B IMF package with austerity conditions opposed by civil society. Paris Summit 2023 called for conditionality reform.",
    amountBillionUSD: 3,
    impactScore: 6,
    active: true,
    geopoliticalEffect:
      "IMF conditionality providing opening for China/Russia alternative financing without conditions; Global South debt architecture reform urgency; SDR reallocation debate ongoing.",
    sources: ["IMF Ghana program documents", "G20 Common Framework progress report", "Jubilee Debt Campaign analysis"],
  },
];

const DONORS: DonorProfile[] = [
  {
    id: "D001",
    name: "USA",
    category: "Western",
    annualAidBillionUSD: 60,
    leverageTypes: ["military", "economic", "humanitarian"],
    conditionality: "Democracy, human rights, counter-narcotics, counter-terrorism: selectively applied based on strategic interest.",
    politicalAlignment: "NATO allies, Israel, Egypt, Jordan, Gulf states, Indo-Pacific partners.",
    keyInstruments: ["USAID", "MCC", "DoD 333 Security Assistance", "ESF", "PEPFAR", "FMF"],
    incidentCount: 3,
    trend: "declining",
  },
  {
    id: "D002",
    name: "China",
    category: "BRICS",
    annualAidBillionUSD: 85,
    leverageTypes: ["infrastructure", "economic", "diplomatic"],
    conditionality: "Taiwan non-recognition, PRC UN voting alignment, market access, Huawei inclusion; no human rights conditions.",
    politicalAlignment: "Global South, SCO members, African Union, BRI signatories.",
    keyInstruments: ["China EXIM Bank", "Silk Road Fund", "AIIB", "South-South Cooperation Fund", "BRI bilateral MOUs"],
    incidentCount: 1,
    trend: "escalating",
  },
  {
    id: "D003",
    name: "EU",
    category: "Western",
    annualAidBillionUSD: 72,
    leverageTypes: ["economic", "humanitarian", "diplomatic"],
    conditionality: "Rule of law, democratic governance, migration control (increasingly dominant), trade compliance.",
    politicalAlignment: "EU candidate states, African ACP partners, MENA neighborhood.",
    keyInstruments: ["NDICI-Global Europe", "EIB", "EBRD", "EU Trust Funds", "EFSD+"],
    incidentCount: 1,
    trend: "stable",
  },
  {
    id: "D004",
    name: "Gulf States",
    category: "Gulf",
    annualAidBillionUSD: 20,
    leverageTypes: ["economic", "military", "diplomatic"],
    conditionality: "Political silence on human rights, Sunni alignment, anti-Iran positioning, trade and investment reciprocity.",
    politicalAlignment: "Egypt, Jordan, Pakistan, Yemen government, GCC bloc.",
    keyInstruments: ["Saudi Fund for Development", "Abu Dhabi Fund", "Qatar Investment Authority", "Kuwait Fund"],
    incidentCount: 2,
    trend: "escalating",
  },
  {
    id: "D005",
    name: "Japan",
    category: "Western",
    annualAidBillionUSD: 17,
    leverageTypes: ["infrastructure", "economic", "diplomatic"],
    conditionality: "Governance, anti-corruption, climate standards, Free and Open Indo-Pacific alignment.",
    politicalAlignment: "Southeast Asia, Pacific islands, India, Africa, Ukraine.",
    keyInstruments: ["JICA", "JBIC", "TICAD framework", "Quad infrastructure"],
    incidentCount: 0,
    trend: "stable",
  },
  {
    id: "D006",
    name: "India",
    category: "Emerging",
    annualAidBillionUSD: 5,
    leverageTypes: ["infrastructure", "diplomatic", "economic"],
    conditionality: "Neighborhood First alignment, anti-China counterbalancing, non-interference framing, connectivity projects using Indian firms.",
    politicalAlignment: "South Asian neighbors, Africa (IAFS), Pacific islands, Global South voice.",
    keyInstruments: ["MEA development partnerships", "EXIM Bank lines of credit", "ITEC technical cooperation", "UPI payment diplomacy"],
    incidentCount: 1,
    trend: "escalating",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function computeWeaponizationIndex(events: AidEvent[]): number {
  if (!events.length) return 0;
  const activeHigh = events.filter(e => e.active && e.impactScore >= 7);
  const ratio = activeHigh.length / events.length;
  const avg = activeHigh.length > 0
    ? activeHigh.reduce((s, e) => s + e.impactScore, 0) / activeHigh.length
    : 0;
  return Math.min(100, Math.round(ratio * 60 + avg * 4));
}

export function getByDonor(events: AidEvent[], donor: string): AidEvent[] {
  return events.filter(e => e.donor === donor);
}

export function getHighImpactEvents(events: AidEvent[], threshold = 7): AidEvent[] {
  return events.filter(e => e.impactScore >= threshold);
}

export function getActiveConditionality(events: AidEvent[]): AidEvent[] {
  return events.filter(e => e.active && e.eventType === "condition");
}

export function donorLeverageClass(leverageType: LeverageType): string {
  const map: Record<LeverageType, string> = {
    military: "lev-military",
    economic: "lev-economic",
    diplomatic: "lev-diplomatic",
    infrastructure: "lev-infra",
    food: "lev-food",
    humanitarian: "lev-humanitarian",
  };
  return map[leverageType] ?? "lev-economic";
}

export function impactClass(score: number): string {
  if (score >= 9) return "imp-critical";
  if (score >= 7) return "imp-high";
  if (score >= 5) return "imp-medium";
  return "imp-low";
}

export function eventTypeClass(eventType: AidEventType): string {
  const map: Record<AidEventType, string> = {
    freeze: "et-freeze",
    cut: "et-cut",
    condition: "et-condition",
    redirect: "et-redirect",
    weaponize: "et-weaponize",
    competition: "et-competition",
    reform: "et-reform",
  };
  return map[eventType] ?? "et-condition";
}

export function getImpactCategory(score: number): string {
  if (score >= 9) return "Critical";
  if (score >= 7) return "High";
  if (score >= 5) return "Medium";
  return "Low";
}

export function buildRenderData(): ForeignAidWeaponizationRenderData {
  return {
    events: AID_EVENTS,
    donors: DONORS,
    weaponizationIndex: computeWeaponizationIndex(AID_EVENTS),
    highImpactCount: AID_EVENTS.filter(e => e.impactScore >= 7).length,
    activeConditionCount: getActiveConditionality(AID_EVENTS).length,
    topDonors: [...DONORS].sort((a, b) => b.annualAidBillionUSD - a.annualAidBillionUSD).slice(0, 5),
    recentEvents: [...AID_EVENTS].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
  };
}
