// pandemic-preparedness-helpers.ts
// Pure logic for PandemicPreparednessPanel — no DOM, no Panel imports

export type ReadinessLevel = 'Strong' | 'Adequate' | 'Weak' | 'Critical Gap';
export type OutbreakSeverity = 'Watch' | 'Alert' | 'Outbreak' | 'Epidemic' | 'Pandemic Potential';
export type PathogenClass = 'Respiratory' | 'Hemorrhagic Fever' | 'Enteric' | 'Zoonotic' | 'Vector-Borne' | 'BSL-4';

export interface CountryReadiness {
  id: string;
  country: string;
  ghsiScore: number; // Global Health Security Index 0-100
  ihrScore: number; // IHR Capacity Score 0-100 (WHO monitoring)
  readinessLevel: ReadinessLevel;
  detectionCapacity: number; // 0-10
  responseCapacity: number; // 0-10
  laboratoryCapacity: number; // 0-10
  healthSystemStrength: number; // 0-10
  keyGap: string;
  population: number; // millions
}

export interface ActiveOutbreak {
  id: string;
  pathogen: string;
  pathogenClass: PathogenClass;
  country: string;
  region: string;
  severity: OutbreakSeverity;
  startDate: string;
  caseCount: number;
  deathCount: number;
  cfr: number; // case fatality rate %
  humanTransmission: boolean;
  internationalRisk: 'Low' | 'Moderate' | 'High' | 'Very High';
  description: string;
  whoStatus: string;
}

export interface PrepData {
  countries: CountryReadiness[];
  outbreaks: ActiveOutbreak[];
  globalPreparednessIndex: number;
  criticalGapCount: number;
  activeOutbreakCount: number;
  pandemicPotentialCount: number;
  avgGhsiScore: number;
}

const COUNTRIES: CountryReadiness[] = [
  { id: 'P001', country: 'United States', ghsiScore: 73, ihrScore: 74, readinessLevel: 'Strong', detectionCapacity: 9, responseCapacity: 8, laboratoryCapacity: 10, healthSystemStrength: 8, keyGap: 'Equity in surge capacity; PHEMCE reform pending', population: 335 },
  { id: 'P002', country: 'United Kingdom', ghsiScore: 75, ihrScore: 82, readinessLevel: 'Strong', detectionCapacity: 9, responseCapacity: 9, laboratoryCapacity: 9, healthSystemStrength: 8, keyGap: 'Post-Brexit WHO coordination gaps', population: 68 },
  { id: 'P003', country: 'South Korea', ghsiScore: 64, ihrScore: 77, readinessLevel: 'Adequate', detectionCapacity: 9, responseCapacity: 8, laboratoryCapacity: 8, healthSystemStrength: 8, keyGap: 'Contact tracing digital infrastructure aging', population: 52 },
  { id: 'P004', country: 'Germany', ghsiScore: 65, ihrScore: 80, readinessLevel: 'Strong', detectionCapacity: 8, responseCapacity: 8, laboratoryCapacity: 9, healthSystemStrength: 9, keyGap: 'Stockpile replenishment post-COVID still incomplete', population: 84 },
  { id: 'P005', country: 'China', ghsiScore: 52, ihrScore: 68, readinessLevel: 'Adequate', detectionCapacity: 7, responseCapacity: 7, laboratoryCapacity: 8, healthSystemStrength: 7, keyGap: 'Transparency in early outbreak reporting; WHO access', population: 1412 },
  { id: 'P006', country: 'India', ghsiScore: 42, ihrScore: 58, readinessLevel: 'Weak', detectionCapacity: 5, responseCapacity: 5, laboratoryCapacity: 6, healthSystemStrength: 5, keyGap: 'Rural health infrastructure; cold chain capacity; lab network outside metro areas', population: 1440 },
  { id: 'P007', country: 'Brazil', ghsiScore: 54, ihrScore: 62, readinessLevel: 'Adequate', detectionCapacity: 6, responseCapacity: 6, laboratoryCapacity: 7, healthSystemStrength: 6, keyGap: 'Amazon surveillance gap; federal-state coordination failures (COVID demonstrated)', population: 215 },
  { id: 'P008', country: 'Nigeria', ghsiScore: 37, ihrScore: 45, readinessLevel: 'Weak', detectionCapacity: 4, responseCapacity: 4, laboratoryCapacity: 4, healthSystemStrength: 3, keyGap: 'Laboratory network coverage; emergency medical supply chain; health worker density', population: 223 },
  { id: 'P009', country: 'DRC', ghsiScore: 28, ihrScore: 35, readinessLevel: 'Critical Gap', detectionCapacity: 3, responseCapacity: 3, laboratoryCapacity: 3, healthSystemStrength: 2, keyGap: 'Active Mpox/Ebola; conflict zones reduce WHO access; no cold chain for vaccines', population: 102 },
  { id: 'P010', country: 'Pakistan', ghsiScore: 35, ihrScore: 42, readinessLevel: 'Critical Gap', detectionCapacity: 4, responseCapacity: 3, laboratoryCapacity: 4, healthSystemStrength: 4, keyGap: 'Polio reservoir; flood-damaged health infrastructure; political instability', population: 231 },
  { id: 'P011', country: 'Indonesia', ghsiScore: 44, ihrScore: 52, readinessLevel: 'Weak', detectionCapacity: 5, responseCapacity: 5, laboratoryCapacity: 5, healthSystemStrength: 5, keyGap: 'Archipelago logistics; H5N1 endemic poultry; poor rural surveillance', population: 280 },
  { id: 'P012', country: 'Egypt', ghsiScore: 35, ihrScore: 48, readinessLevel: 'Weak', detectionCapacity: 5, responseCapacity: 4, laboratoryCapacity: 5, healthSystemStrength: 4, keyGap: 'H5N1 poultry exposure; Nile flooding sanitation risk; political reporting pressure', population: 106 },
];

const OUTBREAKS: ActiveOutbreak[] = [
  { id: 'O001', pathogen: 'H5N1 Avian Influenza', pathogenClass: 'Respiratory', country: 'USA + global', region: 'Global', severity: 'Alert', startDate: '2024-01', caseCount: 66, deathCount: 4, cfr: 6.1, humanTransmission: false, internationalRisk: 'High', description: 'H5N1 spreading in US dairy cattle since 2024; 66 human cases (farm workers); CFR elevated historically (60%); no sustained human-to-human transmission yet. Candidate vaccines stockpiled.', whoStatus: 'WHO monitoring; not PHEIC' },
  { id: 'O002', pathogen: 'Mpox (Clade Ib)', pathogenClass: 'Zoonotic', country: 'DRC + E. Africa', region: 'Sub-Saharan Africa', severity: 'Pandemic Potential', startDate: '2024-01', caseCount: 63000, deathCount: 1100, cfr: 1.7, humanTransmission: true, internationalRisk: 'High', description: 'New Clade Ib strain more transmissible; spreading beyond DRC to Burundi, Rwanda, Uganda, Kenya. WHO declared PHEIC in August 2024 — 2nd declaration for Mpox. Sexual and household transmission confirmed.', whoStatus: 'PHEIC declared Aug 14 2024' },
  { id: 'O003', pathogen: 'Oropouche Virus', pathogenClass: 'Vector-Borne', country: 'Brazil + Latin America', region: 'South America', severity: 'Outbreak', startDate: '2024-02', caseCount: 8000, deathCount: 4, cfr: 0.05, humanTransmission: false, internationalRisk: 'Moderate', description: 'Arbovirus surge in Brazil; first deaths and fetal deaths reported. No specific treatment. CDC issued Level 2 travel alert for Brazil.', whoStatus: 'Monitoring; no PHEIC' },
  { id: 'O004', pathogen: 'H1N2 Influenza (novel swine)', pathogenClass: 'Respiratory', country: 'USA', region: 'North America', severity: 'Watch', startDate: '2024-10', caseCount: 3, deathCount: 0, cfr: 0, humanTransmission: false, internationalRisk: 'Low', description: 'Novel H1N2 swine flu variant with human cases in Missouri and Michigan; agricultural fair exposures. Close monitoring for genetic drift toward human-adapted strains.', whoStatus: 'WHO monitoring' },
  { id: 'O005', pathogen: 'Marburg Virus', pathogenClass: 'Hemorrhagic Fever', country: 'Rwanda', region: 'East Africa', severity: 'Outbreak', startDate: '2024-09', caseCount: 66, deathCount: 15, cfr: 22.7, humanTransmission: true, internationalRisk: 'Moderate', description: 'First Rwandan Marburg outbreak; healthcare worker cluster; aggressive contact tracing. Outbreak ended Nov 2024. USAMRIID/WHO rapid response successful model.', whoStatus: 'Outbreak concluded Nov 2024' },
  { id: 'O006', pathogen: 'XEC SARS-CoV-2 variant', pathogenClass: 'Respiratory', country: 'Global', region: 'Global', severity: 'Watch', startDate: '2024-08', caseCount: -1, deathCount: -1, cfr: 0.1, humanTransmission: true, internationalRisk: 'Moderate', description: 'XEC recombinant variant dominant globally by late 2024; more immune-evasive than JN.1; no significant severity increase. WHO monitors for JN.1 sublineage evolution.', whoStatus: 'Monitoring; no PHEIC' },
  { id: 'O007', pathogen: 'Cholera (El Tor biotype)', pathogenClass: 'Enteric', country: 'Haiti + Sudan + Syria', region: 'Multiple', severity: 'Epidemic', startDate: '2022-10', caseCount: 900000, deathCount: 7000, cfr: 0.8, humanTransmission: true, internationalRisk: 'Moderate', description: 'Ongoing multi-country cholera wave; Haiti, Sudan, Syria most severe. Conflict and displacement driving spread. Oral cholera vaccine shortage constraining response.', whoStatus: 'WHO emergency response ongoing' },
  { id: 'O008', pathogen: 'H5N2 Avian Influenza', pathogenClass: 'Respiratory', country: 'Mexico', region: 'North America', severity: 'Alert', startDate: '2024-04', caseCount: 1, deathCount: 1, cfr: 100, humanTransmission: false, internationalRisk: 'Low', description: 'First confirmed human H5N2 death (Mexico, April 2024); source undetermined. Rare strain; no ongoing spread detected. CFR is based on single case — unreliable.', whoStatus: 'Investigated; no PHEIC' },
];

export function computeGlobalPreparednessIndex(countries: CountryReadiness[]): number {
  if (!countries.length) return 0;
  const wavg = countries.reduce((s, c) => s + c.ghsiScore * c.population, 0);
  const totPop = countries.reduce((s, c) => s + c.population, 0);
  return Math.round(wavg / totPop);
}

export function getByReadiness(countries: CountryReadiness[], level: ReadinessLevel): CountryReadiness[] {
  return countries.filter(c => c.readinessLevel === level);
}

export function getCriticalGapCountries(countries: CountryReadiness[]): CountryReadiness[] {
  return countries.filter(c => c.readinessLevel === 'Critical Gap' || c.readinessLevel === 'Weak');
}

export function getActiveOutbreaks(outbreaks: ActiveOutbreak[]): ActiveOutbreak[] {
  return outbreaks.filter(o => o.severity !== 'Watch' || o.humanTransmission);
}

export function getPandemicPotential(outbreaks: ActiveOutbreak[]): ActiveOutbreak[] {
  return outbreaks.filter(o => o.severity === 'Pandemic Potential' || o.internationalRisk === 'Very High');
}

export function computeAvgGhsi(countries: CountryReadiness[]): number {
  if (!countries.length) return 0;
  return Math.round(countries.reduce((s, c) => s + c.ghsiScore, 0) / countries.length);
}

export function rankByReadiness(countries: CountryReadiness[]): CountryReadiness[] {
  return [...countries].sort((a, b) => a.ghsiScore - b.ghsiScore);
}

export function readinessClass(level: ReadinessLevel): string {
  const m: Record<ReadinessLevel, string> = { Strong: 'read-strong', Adequate: 'read-adequate', Weak: 'read-weak', 'Critical Gap': 'read-critical' };
  return m[level] ?? 'read-weak';
}

export function severityClass(sev: OutbreakSeverity): string {
  const m: Record<OutbreakSeverity, string> = { Watch: 'sev-watch', Alert: 'sev-alert', Outbreak: 'sev-outbreak', Epidemic: 'sev-epidemic', 'Pandemic Potential': 'sev-pandemic' };
  return m[sev] ?? 'sev-watch';
}

export function buildRenderData(): PrepData {
  return {
    countries: COUNTRIES,
    outbreaks: OUTBREAKS,
    globalPreparednessIndex: computeGlobalPreparednessIndex(COUNTRIES),
    criticalGapCount: getCriticalGapCountries(COUNTRIES).length,
    activeOutbreakCount: getActiveOutbreaks(OUTBREAKS).length,
    pandemicPotentialCount: getPandemicPotential(OUTBREAKS).length,
    avgGhsiScore: computeAvgGhsi(COUNTRIES),
  };
}
