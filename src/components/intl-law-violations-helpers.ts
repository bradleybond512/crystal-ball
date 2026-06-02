// intl-law-violations-helpers.ts
// Pure logic for InternationalLawViolationsPanel — no DOM, no Panel imports

export type CourtBody = 'ICJ' | 'ICC' | 'UNSC' | 'ECHR' | 'IACHR' | 'ACHPR' | 'WTO' | 'ITLOS';
export type CaseStatus = 'Active' | 'Pending' | 'Ruled' | 'Enforcement' | 'Dismissed' | 'Withdrawn';
export type ViolationType = 'Genocide' | 'War Crimes' | 'Crimes Against Humanity' | 'Aggression' | 'Treaty Violation' | 'Human Rights' | 'Maritime Law' | 'Trade Law';

export interface LegalCase {
  id: string;
  title: string;
  body: CourtBody;
  applicant: string;
  respondent: string;
  violationType: ViolationType;
  status: CaseStatus;
  filedDate: string;
  ruling?: string;
  description: string;
  severity: number; // 1-10
}

export interface SCResolution {
  id: string;
  resolution: string;
  date: string;
  topic: string;
  vetoedBy?: string[];
  passed: boolean;
  description: string;
}

export interface IntlLawData {
  cases: LegalCase[];
  resolutions: SCResolution[];
  globalComplianceIndex: number; // 0-100
  activeCaseCount: number;
  iccCaseCount: number;
  icjCaseCount: number;
  vetoedResolutionsCount: number;
  mostSevereCases: LegalCase[];
}

const CASES: LegalCase[] = [
  { id: 'C001', title: 'Ukraine v. Russia (Genocide Convention)', body: 'ICJ', applicant: 'Ukraine', respondent: 'Russia', violationType: 'Genocide', status: 'Active', filedDate: '2022-02-26', description: 'Ukraine alleges Russia misuses genocide convention as pretext for war; ICJ ordered provisional measures including halt to military operations. Russia ignored orders.', severity: 10 },
  { id: 'C002', title: 'South Africa v. Israel (Gaza Genocide)', body: 'ICJ', applicant: 'South Africa', respondent: 'Israel', violationType: 'Genocide', status: 'Active', filedDate: '2023-12-29', description: 'SA alleges Israel violating Genocide Convention in Gaza. ICJ ordered provisional measures; case proceeding. High-profile global attention.', severity: 10 },
  { id: 'C003', title: 'ICC Arrest Warrant: Vladimir Putin', body: 'ICC', applicant: 'ICC Prosecutor', respondent: 'Russia / Vladimir Putin', violationType: 'War Crimes', status: 'Active', filedDate: '2023-03-17', ruling: 'Arrest warrant issued March 2023 for unlawful deportation of Ukrainian children', description: 'First sitting head of state of a P5 nation to receive ICC arrest warrant. Putin arrested if entering ICC member state. Russia not ICC member.', severity: 10 },
  { id: 'C004', title: 'ICC Warrant: Netanyahu, Gallant, Hamas Leaders', body: 'ICC', applicant: 'ICC Prosecutor', respondent: 'Israel / Hamas', violationType: 'War Crimes', status: 'Active', filedDate: '2024-05-20', ruling: 'Arrest warrants issued November 2024', description: 'ICC Prosecutor Karim Khan sought warrants against Netanyahu and Gallant (starvation as weapon, other charges) and Hamas leaders (Oct 7 crimes). Warrants issued Nov 2024.', severity: 10 },
  { id: 'C005', title: 'Nicaragua v. Germany (Gaza Arms)', body: 'ICJ', applicant: 'Nicaragua', respondent: 'Germany', violationType: 'Genocide', status: 'Active', filedDate: '2024-02-26', description: 'Nicaragua claims Germany facilitates genocide by supplying arms and aid to Israel in Gaza. ICJ declined provisional measures but case proceeds.', severity: 7 },
  { id: 'C006', title: 'Qatar v. UAE (CERD discrimination)', body: 'ICJ', applicant: 'Qatar', respondent: 'UAE', violationType: 'Human Rights', status: 'Ruled', filedDate: '2018-06-11', ruling: 'ICJ found jurisdiction 2021; merits hearing ongoing', description: 'Qatar claimed UAE violated CERD by discriminating against Qatari nationals during 2017 blockade. Blockade ended 2021 under Al-Ula Agreement.', severity: 5 },
  { id: 'C007', title: 'Russia ICC: MH17 Prosecutions', body: 'ICC', applicant: 'Netherlands / Australia', respondent: 'Russia', violationType: 'War Crimes', status: 'Active', filedDate: '2024-01', description: 'ICC state referral by Netherlands and Australia for downing of MH17 in 2014. Dutch criminal court separately convicted 3 individuals in absentia 2022.', severity: 8 },
  { id: 'C008', title: 'Gambia v. Myanmar (Rohingya Genocide)', body: 'ICJ', applicant: 'Gambia (OIC)', respondent: 'Myanmar', violationType: 'Genocide', status: 'Active', filedDate: '2019-11-11', ruling: 'Provisional measures ordered 2020; Myanmar junta non-compliant', description: 'ICJ ordered Myanmar to protect Rohingya from genocidal acts. Myanmar military coup complicated compliance; case ongoing with junta ignoring orders.', severity: 9 },
  { id: 'C009', title: 'Armenia v. Azerbaijan (Nagorno-Karabakh)', body: 'ICJ', applicant: 'Armenia', respondent: 'Azerbaijan', violationType: 'Human Rights', status: 'Active', filedDate: '2021-09-16', description: 'Armenia alleged CERD violations; ICJ ordered provisional measures. Post-2023 NK takeover complicates proceedings; peace treaty negotiations ongoing.', severity: 7 },
  { id: 'C010', title: 'US v. Iran (Sanctions violations)', body: 'ICJ', applicant: 'Iran', respondent: 'USA', violationType: 'Treaty Violation', status: 'Ruled', filedDate: '2018-07-16', ruling: 'ICJ 2018: US must lift sanctions affecting humanitarian goods; US maintained sanctions citing security exception', description: 'Iran challenged Trump JCPOA withdrawal and reimposed sanctions under 1955 Treaty of Amity. ICJ ordered limited sanctions relief; US contested ruling.', severity: 6 },
];

const RESOLUTIONS: SCResolution[] = [
  { id: 'R001', resolution: 'S/2023/101', date: '2023-02-23', topic: 'Ukraine ceasefire demand (1-year anniversary)', vetoedBy: ['Russia'], passed: false, description: 'Resolution demanding immediate ceasefire and Russian withdrawal from Ukraine vetoed by Russia; China abstained.' },
  { id: 'R002', resolution: 'S/2023/723', date: '2023-10-18', topic: 'Gaza humanitarian ceasefire', vetoedBy: ['USA'], passed: false, description: 'US vetoed Brazil-sponsored resolution demanding humanitarian pause in Gaza. UK and France abstained.' },
  { id: 'R003', resolution: 'S/2024/170', date: '2024-03-25', topic: 'Gaza immediate ceasefire (Ramadan)', vetoedBy: [], passed: true, description: 'UNSC passed first ceasefire resolution for Gaza; USA abstained rather than veto. Non-binding but significant political signal.' },
  { id: 'R004', resolution: 'S/2024/312', date: '2024-04-18', topic: 'Palestinian UN membership bid', vetoedBy: ['USA'], passed: false, description: 'US vetoed Palestinian full UN membership. UNGA later voted 143-9 to expand Palestinian rights as observer state.' },
  { id: 'R005', resolution: 'S/2022/155', date: '2022-02-25', topic: 'Ukraine invasion condemnation', vetoedBy: ['Russia'], passed: false, description: 'Immediate condemnation of Russian invasion vetoed by Russia; China, India, UAE abstained. UNGA Emergency Special Session convened.' },
  { id: 'R006', resolution: 'S/2022/720', date: '2022-10', topic: 'Ukraine annexations condemnation', vetoedBy: ['Russia'], passed: false, description: 'Resolution condemning illegal annexation of Ukrainian territories vetoed by Russia; UNGA voted 143-5 to condemn.' },
  { id: 'R007', resolution: '2728', date: '2024-03-25', topic: 'Gaza ceasefire (March 2024)', vetoedBy: [], passed: true, description: 'Passed 14-0 with US abstention. Called for immediate ceasefire for Ramadan and release of hostages. Israel condemned resolution.' },
  { id: 'R008', resolution: '2769', date: '2024-11', topic: 'South Sudan arms embargo extension', vetoedBy: ['Russia', 'China'], passed: false, description: 'Russia and China vetoed extension of South Sudan arms embargo, ending 8-year sanctions regime despite ongoing conflict.' },
];

export function computeGlobalComplianceIndex(cases: LegalCase[]): number {
  if (!cases.length) return 50;
  const activeSevere = cases.filter(c => (c.status === 'Active' || c.status === 'Pending') && c.severity >= 8);
  const penalty = Math.min(50, activeSevere.length * 8);
  return Math.max(0, 100 - penalty - 10);
}

export function getCasesByBody(cases: LegalCase[], body: CourtBody): LegalCase[] {
  return cases.filter(c => c.body === body);
}

export function getActiveCases(cases: LegalCase[]): LegalCase[] {
  return cases.filter(c => c.status === 'Active' || c.status === 'Pending');
}

export function getVetoedResolutions(resolutions: SCResolution[]): SCResolution[] {
  return resolutions.filter(r => !r.passed);
}

export function getMostSevereCases(cases: LegalCase[], n = 5): LegalCase[] {
  return [...cases].sort((a, b) => b.severity - a.severity).slice(0, n);
}

export function getViolationsByType(cases: LegalCase[], type: ViolationType): LegalCase[] {
  return cases.filter(c => c.violationType === type);
}

export function statusClass(status: CaseStatus): string {
  const map: Record<CaseStatus, string> = { Active: 'status-active', Pending: 'status-pending', Ruled: 'status-ruled', Enforcement: 'status-enforcement', Dismissed: 'status-dismissed', Withdrawn: 'status-withdrawn' };
  return map[status] ?? 'status-pending';
}

export function severityClass(score: number): string {
  if (score >= 9) return 'sev-critical';
  if (score >= 7) return 'sev-high';
  if (score >= 5) return 'sev-medium';
  return 'sev-low';
}

export function bodyBadgeClass(body: CourtBody): string {
  const map: Record<CourtBody, string> = { ICJ: 'body-icj', ICC: 'body-icc', UNSC: 'body-unsc', ECHR: 'body-echr', IACHR: 'body-iachr', ACHPR: 'body-achpr', WTO: 'body-wto', ITLOS: 'body-itlos' };
  return map[body] ?? 'body-icj';
}

export function buildRenderData(): IntlLawData {
  return {
    cases: CASES,
    resolutions: RESOLUTIONS,
    globalComplianceIndex: computeGlobalComplianceIndex(CASES),
    activeCaseCount: getActiveCases(CASES).length,
    iccCaseCount: getCasesByBody(CASES, 'ICC').length,
    icjCaseCount: getCasesByBody(CASES, 'ICJ').length,
    vetoedResolutionsCount: getVetoedResolutions(RESOLUTIONS).length,
    mostSevereCases: getMostSevereCases(CASES, 5),
  };
}
