// quantum-tech-race-helpers.ts — pure deterministic helpers

export type QuantumDomain = 'computing' | 'communications' | 'sensing' | 'cryptography';
export type MaturityLevel = 'theoretical' | 'experimental' | 'early-prototype' | 'advanced-prototype' | 'operational';
export type SecurityImplication = 'harvest-now-decrypt-later' | 'post-quantum-migration' | 'quantum-key-distribution' | 'quantum-sensor-threat' | 'quantum-radar';

export interface QuantumProgram {
  country: string;
  domain: QuantumDomain;
  maturity: MaturityLevel;
  qubitCount?: number;
  annualInvestmentUSD: number;
  militaryApplication: boolean;
  threatToEncryption: number; // 0-100 (how close to breaking RSA-2048)
  leadingInstitutions: string[];
  dominanceScore: number; // 0-100
}

export interface QuantumThreat {
  id: string;
  type: SecurityImplication;
  actor: string;
  urgency: 'immediate' | 'near-term' | 'medium-term' | 'long-term';
  affectedSystems: string[];
  description: string;
}

const MOCK_PROGRAMS: QuantumProgram[] = [
  { country: 'USA', domain: 'computing', maturity: 'advanced-prototype', qubitCount: 1121, annualInvestmentUSD: 3200000000, militaryApplication: true, threatToEncryption: 45, leadingInstitutions: ['IBM', 'Google', 'NIST', 'DARPA'], dominanceScore: 88 },
  { country: 'China', domain: 'computing', maturity: 'advanced-prototype', qubitCount: 504, annualInvestmentUSD: 15000000000, militaryApplication: true, threatToEncryption: 35, leadingInstitutions: ['USTC', 'Baidu', 'Alibaba Quantum Lab'], dominanceScore: 82 },
  { country: 'China', domain: 'communications', maturity: 'operational', annualInvestmentUSD: 2000000000, militaryApplication: true, threatToEncryption: 0, leadingInstitutions: ['USTC', 'QuantumCTek'], dominanceScore: 95 },
  { country: 'USA', domain: 'cryptography', maturity: 'operational', annualInvestmentUSD: 800000000, militaryApplication: true, threatToEncryption: 0, leadingInstitutions: ['NIST', 'NSA'], dominanceScore: 90 },
  { country: 'EU', domain: 'computing', maturity: 'early-prototype', qubitCount: 127, annualInvestmentUSD: 1200000000, militaryApplication: false, threatToEncryption: 15, leadingInstitutions: ['IQM', 'Pasqal', 'QuTech'], dominanceScore: 65 },
  { country: 'Russia', domain: 'sensing', maturity: 'experimental', annualInvestmentUSD: 500000000, militaryApplication: true, threatToEncryption: 0, leadingInstitutions: ['Rosatom', 'Moscow State University'], dominanceScore: 55 },
  { country: 'UK', domain: 'computing', maturity: 'early-prototype', qubitCount: 56, annualInvestmentUSD: 700000000, militaryApplication: false, threatToEncryption: 10, leadingInstitutions: ['Oxford', 'Cambridge', 'Riverlane'], dominanceScore: 60 },
  { country: 'Japan', domain: 'computing', maturity: 'advanced-prototype', qubitCount: 64, annualInvestmentUSD: 900000000, militaryApplication: false, threatToEncryption: 12, leadingInstitutions: ['Fujitsu', 'IBM Japan', 'RIKEN'], dominanceScore: 62 },
];

const MOCK_THREATS: QuantumThreat[] = [
  { id: 'hndl-china', type: 'harvest-now-decrypt-later', actor: 'China', urgency: 'immediate', affectedSystems: ['diplomatic comms', 'military secrets', 'financial data'], description: 'Chinese actors collecting encrypted data now for future decryption when cryptographically-relevant QC arrives' },
  { id: 'pqc-migration', type: 'post-quantum-migration', actor: 'Global', urgency: 'near-term', affectedSystems: ['PKI infrastructure', 'TLS', 'SSH', 'government comms'], description: 'Critical infrastructure must migrate to NIST PQC standards before Q-Day' },
  { id: 'qkd-military', type: 'quantum-key-distribution', actor: 'China', urgency: 'near-term', affectedSystems: ['military C2', 'strategic comms'], description: 'China deploying QKD satellite network for unhackable military communications' },
  { id: 'quantum-radar', type: 'quantum-radar', actor: 'China', urgency: 'medium-term', affectedSystems: ['stealth aircraft', 'UAVs'], description: 'Quantum radar systems could render stealth technology ineffective' },
];

export function scoreQuantumDominance(program: QuantumProgram): number {
  return program.dominanceScore;
}

export function classifyMaturityTier(maturity: MaturityLevel): 'operational' | 'near-term' | 'developmental' {
  if (maturity === 'operational' || maturity === 'advanced-prototype') return 'near-term';
  if (maturity === 'experimental' || maturity === 'early-prototype') return 'developmental';
  return 'developmental';
}

export function getLeadingCountryByDomain(programs: QuantumProgram[], domain: QuantumDomain): string {
  const domainPrograms = programs.filter(p => p.domain === domain);
  if (domainPrograms.length === 0) return 'unknown';
  return domainPrograms.sort((a, b) => b.dominanceScore - a.dominanceScore)[0].country;
}

export function computeEncryptionThreatLevel(programs: QuantumProgram[]): number {
  return Math.max(...programs.map(p => p.threatToEncryption));
}

export function rankProgramsByDominance(programs: QuantumProgram[]): QuantumProgram[] {
  return [...programs].sort((a, b) => b.dominanceScore - a.dominanceScore);
}

export function getTotalInvestment(programs: QuantumProgram[]): number {
  return programs.reduce((s, p) => s + p.annualInvestmentUSD, 0);
}

export function filterMilitaryPrograms(programs: QuantumProgram[]): QuantumProgram[] {
  return programs.filter(p => p.militaryApplication);
}

export function getUrgentThreats(threats: QuantumThreat[]): QuantumThreat[] {
  return threats.filter(t => t.urgency === 'immediate' || t.urgency === 'near-term');
}

export function buildRenderData(): {
  programs: QuantumProgram[];
  threats: QuantumThreat[];
  maxEncryptionThreat: number;
  totalInvestment: number;
  leadingCountry: string;
} {
  const ranked = rankProgramsByDominance(MOCK_PROGRAMS);
  return {
    programs: ranked,
    threats: MOCK_THREATS,
    maxEncryptionThreat: computeEncryptionThreatLevel(MOCK_PROGRAMS),
    totalInvestment: getTotalInvestment(MOCK_PROGRAMS),
    leadingCountry: ranked[0]?.country ?? 'unknown',
  };
}
