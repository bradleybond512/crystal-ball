// global-military-spending-helpers.ts
// Pure logic for GlobalMilitarySpendingPanel — no DOM, no Panel imports

export type SpendingTrend = 'stable' | 'increasing' | 'surging' | 'decreasing';
export type ProcurementCategory = 'Air' | 'Naval' | 'Land' | 'Missile Defense' | 'Nuclear' | 'Space' | 'Cyber';

export interface CountrySpending {
  id: string;
  country: string;
  region: string;
  budgetBn: number; // USD billions 2024
  gdpPercent: number; // % of GDP
  yoyChangePct: number; // year-over-year change %
  trend: SpendingTrend;
  procurementFocus: string[];
  natoMember: boolean;
  notes: string;
}

export interface ArmamentHotspot {
  id: string;
  region: string;
  description: string;
  severity: number; // 1-10
  drivingForce: string;
}

export interface ProcurementEvent {
  id: string;
  date: string;
  program: string;
  countries: string[];
  valueUsdBn: number;
  category: ProcurementCategory;
  description: string;
}

export interface MilitaryRenderData {
  countries: CountrySpending[];
  hotspots: ArmamentHotspot[];
  events: ProcurementEvent[];
  globalRearmamentIndex: number;
  topSpenders: CountrySpending[];
  rearmingCount: number;
  natoComplianceRate: number;
  totalGlobalSpendingBn: number;
}

const COUNTRIES: CountrySpending[] = [
  {
    id: 'C001', country: 'USA', region: 'North America', budgetBn: 916, gdpPercent: 3.4,
    yoyChangePct: 3, trend: 'increasing',
    procurementFocus: ['Nuclear modernization', 'AUKUS submarines', 'Pacific deterrence', 'F-35 deliveries'],
    natoMember: true,
    notes: 'Largest defense budget in the world; FY2024 NDAA $886B authorization',
  },
  {
    id: 'C002', country: 'China', region: 'Asia-Pacific', budgetBn: 225, gdpPercent: 1.7,
    yoyChangePct: 6, trend: 'increasing',
    procurementFocus: ['Carrier fleet expansion', 'J-20 stealth fighters', 'Anti-satellite weapons', 'Hypersonic missiles'],
    natoMember: false,
    notes: 'Estimated figure; actual spending likely 40-50% higher due to off-budget items',
  },
  {
    id: 'C003', country: 'Russia', region: 'East Europe', budgetBn: 109, gdpPercent: 6.7,
    yoyChangePct: 24, trend: 'surging',
    procurementFocus: ['Ukraine war economy', 'Munitions production', 'Drone warfare', 'Air defense systems'],
    natoMember: false,
    notes: 'War-driven surge; defense now 6.7% of GDP — largest share since Soviet era',
  },
  {
    id: 'C004', country: 'India', region: 'South Asia', budgetBn: 83, gdpPercent: 2.4,
    yoyChangePct: 4, trend: 'increasing',
    procurementFocus: ['AMCA indigenous fighter', 'Aircraft carriers', 'Border infrastructure', 'Missile systems'],
    natoMember: false,
    notes: 'Atmanirbhar Bharat policy driving domestic procurement push',
  },
  {
    id: 'C005', country: 'Saudi Arabia', region: 'Middle East', budgetBn: 80, gdpPercent: 6,
    yoyChangePct: 4, trend: 'increasing',
    procurementFocus: ['F-15EX jets', 'Patriot upgrades', 'Naval expansion', 'Air defense'],
    natoMember: false,
    notes: 'Yemen war costs and Iran threat sustain high spending levels',
  },
  {
    id: 'C006', country: 'UK', region: 'Europe', budgetBn: 74, gdpPercent: 2.3,
    yoyChangePct: 11, trend: 'increasing',
    procurementFocus: ['SSN-AUKUS submarines', 'F-35B for carriers', 'Challenger 3 tanks', 'Ukraine aid'],
    natoMember: true,
    notes: 'Exceeds NATO 2% target; AUKUS submarine investment is a generational commitment',
  },
  {
    id: 'C007', country: 'Germany', region: 'Europe', budgetBn: 66, gdpPercent: 1.5,
    yoyChangePct: 20, trend: 'surging',
    procurementFocus: ['Eurofighter expansion', 'F-35A purchase', 'Leopard 2 upgrades', 'IRIS-T air defense'],
    natoMember: true,
    notes: 'Zeitenwende: EUR 100B special fund driving historic defense buildup; at 2% target by 2024',
  },
  {
    id: 'C008', country: 'France', region: 'Europe', budgetBn: 56, gdpPercent: 1.9,
    yoyChangePct: 7, trend: 'increasing',
    procurementFocus: ['Rafale domestic and export', 'Nuclear deterrent ASMP-A', 'MGCS future tank', 'Space Command'],
    natoMember: true,
    notes: 'LPM 2024-2030 military programming law commits EUR 413B over 7 years',
  },
  {
    id: 'C009', country: 'Japan', region: 'Asia-Pacific', budgetBn: 50, gdpPercent: 1.1,
    yoyChangePct: 20, trend: 'surging',
    procurementFocus: ['Tomahawk cruise missiles', 'F-35A/B fleet', 'Destroyer expansion', 'Counter-strike capability'],
    natoMember: false,
    notes: 'Historic shift: targeting 2% of GDP by 2027; acquiring counterstrike capabilities for first time',
  },
  {
    id: 'C010', country: 'South Korea', region: 'Asia-Pacific', budgetBn: 47, gdpPercent: 2.7,
    yoyChangePct: 4, trend: 'increasing',
    procurementFocus: ['KF-21 Boramae fighter', 'K2 tank exports', 'Naval expansion', 'Missile defense'],
    natoMember: false,
    notes: 'Major arms exporter; K2 tanks to Poland; KF-21 fifth-gen fighter development ongoing',
  },
  {
    id: 'C011', country: 'Ukraine', region: 'East Europe', budgetBn: 64, gdpPercent: 34,
    yoyChangePct: 51, trend: 'surging',
    procurementFocus: ['Drones and counter-drone', 'Artillery ammunition', 'F-16 and Patriot air defense', 'Fortifications'],
    natoMember: false,
    notes: 'Full war economy; massive Western military aid supplements national defense budget',
  },
  {
    id: 'C012', country: 'Israel', region: 'Middle East', budgetBn: 27, gdpPercent: 4.5,
    yoyChangePct: 24, trend: 'surging',
    procurementFocus: ['Iron Dome / David Sling', 'F-35I Adir upgrades', 'Precision munitions', 'UAV systems'],
    natoMember: false,
    notes: 'Gaza and Lebanon operations driving emergency procurement; US security assistance included',
  },
  {
    id: 'C013', country: 'Poland', region: 'Europe', budgetBn: 35, gdpPercent: 4,
    yoyChangePct: 35, trend: 'surging',
    procurementFocus: ['K2 Black Panther tanks', 'FA-50 light jets', 'HIMARS', 'Patriot systems'],
    natoMember: true,
    notes: 'Highest NATO defense burden at 4% GDP; massive rearmament driven by Russia border proximity',
  },
  {
    id: 'C014', country: 'Taiwan', region: 'Asia-Pacific', budgetBn: 19, gdpPercent: 2.5,
    yoyChangePct: 11, trend: 'increasing',
    procurementFocus: ['Asymmetric warfare systems', 'HIMARS', 'Harpoon anti-ship missiles', 'Indigenous submarine'],
    natoMember: false,
    notes: 'Porcupine strategy: layered asymmetric deterrence against potential PRC amphibious invasion',
  },
  {
    id: 'C015', country: 'Australia', region: 'Asia-Pacific', budgetBn: 40, gdpPercent: 2,
    yoyChangePct: 11, trend: 'increasing',
    procurementFocus: ['AUKUS nuclear submarines', 'HIMARS', 'Long-range strike', 'Cyber capabilities'],
    natoMember: false,
    notes: 'AUKUS drives historic submarine investment; 2024 Defence Strategic Review shapes force structure',
  },
];

const HOTSPOTS: ArmamentHotspot[] = [
  {
    id: 'H001', region: 'East Europe / Ukraine',
    description: 'Russia in full war economy; Ukraine receiving unprecedented Western military transfers. Active conventional warfare driving global ammunition shortages and accelerating rearmament across NATO.',
    severity: 10,
    drivingForce: 'Russia invasion of Ukraine; NATO weapons transfers; Russian mobilization and industrial ramp-up',
  },
  {
    id: 'H002', region: 'Europe (NATO Eastern Flank)',
    description: 'Post-Ukraine invasion rearmament across all NATO members; Eastern flank countries surging beyond 4% GDP. Germany Zeitenwende, Poland at highest NATO defense burden, Baltics rapidly expanding.',
    severity: 9,
    drivingForce: 'Russia threat perception; NATO 2% target enforcement; lessons from Ukraine war',
  },
  {
    id: 'H003', region: 'Indo-Pacific',
    description: 'China naval expansion triggering arms race responses from Japan, South Korea, Taiwan, Australia, and India. AUKUS submarine deal, Japanese counter-strike capability, and Taiwan asymmetric buildup define the arc.',
    severity: 8,
    drivingForce: 'PRC military modernization; Taiwan Strait tensions; South China Sea territorial disputes',
  },
  {
    id: 'H004', region: 'Middle East',
    description: 'Israel-Gaza/Lebanon conflict driving emergency procurement; Iran nuclear program and Houthi Red Sea attacks fueling Gulf arms purchases. Record US arms sales to regional partners.',
    severity: 8,
    drivingForce: 'October 7 aftermath; Iran regional proxy network; Houthi maritime disruption',
  },
];

const EVENTS: ProcurementEvent[] = [
  {
    id: 'E001', date: '2024-Q1', program: 'AUKUS Nuclear Submarines (SSN-AUKUS)',
    countries: ['USA', 'UK', 'Australia'], valueUsdBn: 368, category: 'Naval',
    description: 'Trilateral agreement for Australia to acquire 3-5 Virginia-class SSNs by 2030s; UK and Australia jointly developing SSN-AUKUS design for late 2030s service entry.',
  },
  {
    id: 'E002', date: '2024', program: 'F-35 Joint Strike Fighter Deliveries',
    countries: ['USA', 'UK', 'Germany', 'Japan', 'South Korea', 'Israel', 'Poland', 'Australia'], valueUsdBn: 85, category: 'Air',
    description: 'Lockheed Martin delivered 100+ F-35s in 2024; cumulative backlog of 800+ aircraft across international partner nations at various contract stages.',
  },
  {
    id: 'E003', date: '2024', program: 'Leopard 2 Expansion',
    countries: ['Germany', 'Poland', 'Sweden', 'Finland', 'Norway'], valueUsdBn: 22, category: 'Land',
    description: 'Multiple NATO nations ordering Leopard 2A8 variant; Rheinmetall expanded production to 50+ tanks/year as Eastern flank demand surges post-Ukraine.',
  },
  {
    id: 'E004', date: '2024', program: 'Patriot / THAAD Sales and Transfers',
    countries: ['USA', 'Ukraine', 'Germany', 'Poland', 'Saudi Arabia', 'Taiwan'], valueUsdBn: 40, category: 'Missile Defense',
    description: 'Record Patriot battery transfers to Ukraine; FMS sales to NATO partners and Gulf states; THAAD battery emergency deployment to Israel during October escalation.',
  },
  {
    id: 'E005', date: '2024', program: 'K2 Black Panther Tank — Poland Contract',
    countries: ['South Korea', 'Poland'], valueUsdBn: 14, category: 'Land',
    description: 'Poland ordered 180 additional K2 tanks; production localization agreement with Polish defense industry; total K2 order exceeds 1,000 units across two phases.',
  },
  {
    id: 'E006', date: '2024', program: 'Japan Tomahawk Cruise Missile Purchase',
    countries: ['USA', 'Japan'], valueUsdBn: 2.35, category: 'Missile Defense',
    description: 'Japan acquired 400 Tomahawk Block IV/V cruise missiles; first offensive counterstrike capability in post-war Japanese defense history.',
  },
  {
    id: 'E007', date: '2024', program: 'Germany EUR 100B Sondervermogen Disbursements',
    countries: ['Germany'], valueUsdBn: 30, category: 'Air',
    description: 'Continued disbursement of special defense fund: Eurofighter Typhoon upgrades, F-35A purchase finalized, CH-47F Chinook helicopters, MGCS next-gen tank development.',
  },
];

export function getTopSpenders(countries: CountrySpending[], n = 5): CountrySpending[] {
  return [...countries].sort((a, b) => b.budgetBn - a.budgetBn).slice(0, n);
}

export function getRearmingCountries(countries: CountrySpending[], thresholdPct = 10): CountrySpending[] {
  return countries.filter(c => c.yoyChangePct >= thresholdPct);
}

export function computeGlobalRearmamentIndex(countries: CountrySpending[]): number {
  if (!countries.length) return 0;
  const avgYoy = countries.reduce((s, c) => s + c.yoyChangePct, 0) / countries.length;
  // Scale: 0% avg YoY = 0 index; 30%+ avg YoY = 100 index
  return Math.min(100, Math.max(0, Math.round((avgYoy / 30) * 100)));
}

export function computeNATOComplianceRate(countries: CountrySpending[]): number {
  const natoMembers = countries.filter(c => c.natoMember);
  if (!natoMembers.length) return 0;
  const compliant = natoMembers.filter(c => c.gdpPercent >= 2);
  return Math.round((compliant.length / natoMembers.length) * 100);
}

export function gdpPercentClass(pct: number): string {
  if (pct >= 4) return 'mil-critical';
  if (pct >= 2.5) return 'mil-high';
  if (pct >= 2) return 'mil-moderate';
  if (pct >= 1.5) return 'mil-low';
  return 'mil-minimal';
}

export function trendClass(trend: SpendingTrend): string {
  const map: Record<SpendingTrend, string> = {
    surging: 'trend-surging',
    increasing: 'trend-up',
    stable: 'trend-flat',
    decreasing: 'trend-down',
  };
  return map[trend] ?? 'trend-flat';
}

export function trendArrow(trend: SpendingTrend): string {
  return (
    { surging: '↑↑', increasing: '↑', stable: '→', decreasing: '↓' }[trend] ?? '→'
  );
}

export function buildRenderData(): MilitaryRenderData {
  const totalGlobalSpendingBn = COUNTRIES.reduce((s, c) => s + c.budgetBn, 0);
  return {
    countries: COUNTRIES,
    hotspots: HOTSPOTS,
    events: EVENTS,
    globalRearmamentIndex: computeGlobalRearmamentIndex(COUNTRIES),
    topSpenders: getTopSpenders(COUNTRIES, 5),
    rearmingCount: getRearmingCountries(COUNTRIES, 10).length,
    natoComplianceRate: computeNATOComplianceRate(COUNTRIES),
    totalGlobalSpendingBn,
  };
}
