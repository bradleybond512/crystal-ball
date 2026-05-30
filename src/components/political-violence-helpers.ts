// political-violence-helpers.ts
// Pure logic for PoliticalViolencePanel — no DOM, no Panel imports

export type ConflictType =
  | "Civil War"
  | "Insurgency"
  | "State Repression"
  | "Communal"
  | "Electoral"
  | "Terrorism";

export type Trend = "escalating" | "stable" | "declining";

export type CivilianImpact = "Low" | "Medium" | "High" | "Extreme";

export type EventType =
  | "Battles"
  | "Explosions"
  | "Violence Against Civilians"
  | "Riots"
  | "Strategic Developments";

export interface ViolenceHotspot {
  id: string;
  country: string;
  region: string;
  primaryActor: string;
  conflictType: ConflictType;
  monthlyEvents: number;
  trend: Trend;
  fatalitiesYTD: string;
  civilianImpact: CivilianImpact;
  description: string;
}

export interface ViolenceEvent {
  id: string;
  date: string;
  country: string;
  eventType: EventType;
  actor: string;
  fatalities: number;
  description: string;
  significance: number;
}

export interface PoliticalViolenceData {
  hotspots: ViolenceHotspot[];
  events: ViolenceEvent[];
  globalViolenceIndex: number;
  activeConflictCount: number;
  highCivilianImpactCount: number;
  mostViolentRegion: string;
}

const HOTSPOTS: ViolenceHotspot[] = [
  {
    id: "HS001",
    country: "Sudan",
    region: "Africa",
    primaryActor: "RSF vs SAF",
    conflictType: "Civil War",
    monthlyEvents: 1200,
    trend: "escalating",
    fatalitiesYTD: "150,000+",
    civilianImpact: "Extreme",
    description: "RSF-SAF war erupted April 2023; world's worst humanitarian crisis by 2024 with mass atrocities in Darfur and displacement of 10M+.",
  },
  {
    id: "HS002",
    country: "Gaza/Israel",
    region: "Middle East",
    primaryActor: "IDF vs Hamas",
    conflictType: "Civil War",
    monthlyEvents: 800,
    trend: "stable",
    fatalitiesYTD: "45,000+",
    civilianImpact: "Extreme",
    description: "Hamas October 7 attack triggered Israeli ground offensive; blockade and air campaign generated mass civilian casualties and famine conditions.",
  },
  {
    id: "HS003",
    country: "Ukraine",
    region: "Europe",
    primaryActor: "Ukraine vs Russia",
    conflictType: "Civil War",
    monthlyEvents: 600,
    trend: "stable",
    fatalitiesYTD: "30,000+",
    civilianImpact: "High",
    description: "Full-scale Russian invasion in its third year; frontlines stabilized around Donbas; Kursk incursion reversed by Ukrainian cross-border operation.",
  },
  {
    id: "HS004",
    country: "Myanmar",
    region: "Asia-Pacific",
    primaryActor: "PDFs vs Tatmadaw",
    conflictType: "Insurgency",
    monthlyEvents: 500,
    trend: "escalating",
    fatalitiesYTD: "8,000+",
    civilianImpact: "High",
    description: "Resistance forces advanced significantly in 2024, capturing key towns; junta lost control of border regions.",
  },
  {
    id: "HS005",
    country: "Ethiopia",
    region: "Africa",
    primaryActor: "Fano / OLA vs ENDF",
    conflictType: "Insurgency",
    monthlyEvents: 400,
    trend: "escalating",
    fatalitiesYTD: "12,000+",
    civilianImpact: "High",
    description: "Post-Tigray conflict spread to Amhara (Fano militias) and Oromia (OLA); federal forces conducting airstrikes and mass detentions.",
  },
  {
    id: "HS006",
    country: "DRC",
    region: "Africa",
    primaryActor: "M23/Rwanda vs FARDC",
    conflictType: "Civil War",
    monthlyEvents: 350,
    trend: "escalating",
    fatalitiesYTD: "6,000+",
    civilianImpact: "High",
    description: "M23 rebels backed by Rwanda captured Goma; regional war risk with Rwanda-DRC diplomatic breakdown.",
  },
  {
    id: "HS007",
    country: "Haiti",
    region: "Latin America",
    primaryActor: "Gang coalitions",
    conflictType: "Terrorism",
    monthlyEvents: 300,
    trend: "escalating",
    fatalitiesYTD: "3,000+",
    civilianImpact: "Extreme",
    description: "Gang coalition Viv Ansanm controls 80% of Port-au-Prince; MSS Kenya-led multinational security mission deployed but overwhelmed.",
  },
  {
    id: "HS008",
    country: "Sahel (Mali/Burkina/Niger)",
    region: "Africa",
    primaryActor: "JNIM / IS Sahel",
    conflictType: "Terrorism",
    monthlyEvents: 500,
    trend: "escalating",
    fatalitiesYTD: "10,000+",
    civilianImpact: "High",
    description: "JNIM and IS Sahel expanded territory after French/UN departures; junta governments failing to contain insurgencies despite Russian support.",
  },
  {
    id: "HS009",
    country: "Somalia",
    region: "Africa",
    primaryActor: "Al-Shabaab vs SNAF",
    conflictType: "Terrorism",
    monthlyEvents: 250,
    trend: "stable",
    fatalitiesYTD: "2,000+",
    civilianImpact: "High",
    description: "Al-Shabaab retains rural control across south-central Somalia; frequent bombings in Mogadishu; ATMIS drawdown creating security vacuum.",
  },
  {
    id: "HS010",
    country: "Yemen",
    region: "Middle East",
    primaryActor: "Houthis vs STC/Saudi",
    conflictType: "Civil War",
    monthlyEvents: 200,
    trend: "declining",
    fatalitiesYTD: "1,000+",
    civilianImpact: "High",
    description: "Saudi-Houthi truce fragile; Houthis pivoted to Red Sea drone/missile attacks on shipping; US/UK airstrikes on Houthi infrastructure.",
  },
];

const EVENTS: ViolenceEvent[] = [
  {
    id: "EV001",
    date: "2024-12-15",
    country: "Sudan",
    eventType: "Battles",
    actor: "RSF",
    fatalities: 700,
    description: "RSF massacre in Wad Madani, Gezira state — systematic killings of civilians and looting as RSF captured Sudan's second city.",
    significance: 9,
  },
  {
    id: "EV002",
    date: "2024-06-08",
    country: "Gaza/Israel",
    eventType: "Explosions",
    actor: "IDF",
    fatalities: 45,
    description: "Israeli airstrike on Rafah displaced persons camp killed 45 civilians; sparked international condemnation and ICJ proceedings.",
    significance: 8,
  },
  {
    id: "EV003",
    date: "2024-10-13",
    country: "Myanmar",
    eventType: "Battles",
    actor: "PDF / MNDAA",
    fatalities: 340,
    description: "Resistance forces captured Mandalay military base in Sagaing region; largest territorial gain for resistance in 2024.",
    significance: 7,
  },
  {
    id: "EV004",
    date: "2024-10-03",
    country: "Haiti",
    eventType: "Violence Against Civilians",
    actor: "Viv Ansanm gang coalition",
    fatalities: 115,
    description: "Gang massacre in Pont-Sonde, Artibonite — gunmen killed 115 civilians in coordinated attack on bus passengers and bystanders.",
    significance: 8,
  },
  {
    id: "EV005",
    date: "2024-01-21",
    country: "DRC",
    eventType: "Explosions",
    actor: "M23 / Rwanda",
    fatalities: 19,
    description: "Shelling of Goma international airport by M23 forces as siege of North Kivu capital intensified; commercial aviation suspended.",
    significance: 7,
  },
  {
    id: "EV006",
    date: "2024-08-04",
    country: "Ethiopia",
    eventType: "Battles",
    actor: "Fano militia",
    fatalities: 120,
    description: "Fano forces temporarily seized Debre Tabor in Amhara region; federal air force conducted retaliatory strikes on civilian areas.",
    significance: 7,
  },
  {
    id: "EV007",
    date: "2024-08-06",
    country: "Ukraine",
    eventType: "Strategic Developments",
    actor: "Ukrainian Armed Forces",
    fatalities: 200,
    description: "Ukraine launched cross-border incursion into Russia's Kursk Oblast — first foreign occupation of Russian territory since WWII.",
    significance: 9,
  },
  {
    id: "EV008",
    date: "2024-08-24",
    country: "Sahel (Mali/Burkina/Niger)",
    eventType: "Violence Against Civilians",
    actor: "JNIM",
    fatalities: 200,
    description: "JNIM massacre in Barsalogho, Burkina Faso — civilians forced to dig trenches then executed; deadliest jihadist attack in Sahel in 2024.",
    significance: 8,
  },
  {
    id: "EV009",
    date: "2024-06-01",
    country: "Somalia",
    eventType: "Explosions",
    actor: "Al-Shabaab",
    fatalities: 10,
    description: "Al-Shabaab VBIED attack on Lido Beach Hotel in Mogadishu; prolonged siege targeting government officials.",
    significance: 7,
  },
  {
    id: "EV010",
    date: "2024-06-25",
    country: "Kenya",
    eventType: "Riots",
    actor: "Gen Z protesters",
    fatalities: 39,
    description: "Anti-finance-bill protests in Nairobi turned violent; protesters stormed parliament; security forces killed 39 demonstrators.",
    significance: 6,
  },
];

export function getByRegion(
  hotspots: ViolenceHotspot[],
  region: string,
): ViolenceHotspot[] {
  return hotspots.filter(h => h.region === region);
}

export function getHighImpact(
  hotspots: ViolenceHotspot[],
  threshold: CivilianImpact = "High",
): ViolenceHotspot[] {
  const rank: Record<CivilianImpact, number> = {
    Low: 1,
    Medium: 2,
    High: 3,
    Extreme: 4,
  };
  return hotspots.filter(h => rank[h.civilianImpact] >= rank[threshold]);
}

export function getEscalating(hotspots: ViolenceHotspot[]): ViolenceHotspot[] {
  return hotspots.filter(h => h.trend === "escalating");
}

export function getByEventType(
  events: ViolenceEvent[],
  type: EventType,
): ViolenceEvent[] {
  return events.filter(e => e.eventType === type);
}

export function computeGlobalViolenceIndex(
  hotspots: ViolenceHotspot[],
): number {
  if (hotspots.length === 0) return 0;
  const trendMultiplier: Record<Trend, number> = {
    escalating: 1.3,
    stable: 1.0,
    declining: 0.7,
  };
  const impactMultiplier: Record<CivilianImpact, number> = {
    Low: 0.5,
    Medium: 1.0,
    High: 1.5,
    Extreme: 2.0,
  };
  const total = hotspots.reduce((sum, h) => {
    return (
      sum +
      h.monthlyEvents *
        trendMultiplier[h.trend] *
        impactMultiplier[h.civilianImpact]
    );
  }, 0);
  return Math.min(100, Math.round(total / 100));
}

export function conflictTypeClass(type: ConflictType): string {
  const map: Record<ConflictType, string> = {
    "Civil War": "pv-type-civil-war",
    Insurgency: "pv-type-insurgency",
    "State Repression": "pv-type-repression",
    Communal: "pv-type-communal",
    Electoral: "pv-type-electoral",
    Terrorism: "pv-type-terrorism",
  };
  return map[type] ?? "pv-type-unknown";
}

export function civilianImpactClass(impact: CivilianImpact): string {
  const map: Record<CivilianImpact, string> = {
    Low: "pv-impact-low",
    Medium: "pv-impact-medium",
    High: "pv-impact-high",
    Extreme: "pv-impact-extreme",
  };
  return map[impact] ?? "pv-impact-unknown";
}

export function eventTypeClass(type: EventType): string {
  const map: Record<EventType, string> = {
    Battles: "pv-event-battles",
    Explosions: "pv-event-explosions",
    "Violence Against Civilians": "pv-event-vac",
    Riots: "pv-event-riots",
    "Strategic Developments": "pv-event-strategic",
  };
  return map[type] ?? "pv-event-unknown";
}

export function buildRenderData(
  hotspots: ViolenceHotspot[],
  events: ViolenceEvent[],
): PoliticalViolenceData {
  const globalViolenceIndex = computeGlobalViolenceIndex(hotspots);
  const activeConflictCount = hotspots.filter(h => h.trend !== "declining").length;
  const highCivilianImpactCount = getHighImpact(hotspots, "High").length;
  const regionCounts: Record<string, number> = {};
  for (const h of hotspots) {
    regionCounts[h.region] = (regionCounts[h.region] ?? 0) + h.monthlyEvents;
  }
  const mostViolentRegion =
    Object.entries(regionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return {
    hotspots,
    events,
    globalViolenceIndex,
    activeConflictCount,
    highCivilianImpactCount,
    mostViolentRegion,
  };
}

export { HOTSPOTS, EVENTS };
