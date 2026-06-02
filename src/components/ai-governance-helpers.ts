// ai-governance-helpers.ts
// Pure logic for AIGovernancePanel — no DOM, no Panel imports

export type FrameworkStatus = 'active' | 'proposed' | 'voluntary' | 'expired';
export type FrameworkScope = 'multilateral' | 'bilateral' | 'unilateral' | 'voluntary';
export type BindingNature = 'legally-binding' | 'voluntary' | 'executive-action' | 'treaty';
export type MilitaryAIRisk = 'critical' | 'high' | 'medium' | 'low';
export type LAWSStance = 'developing' | 'opposing' | 'ambiguous' | 'banning';
export type BenchmarkStatus = 'threshold-passed' | 'approaching' | 'controlled' | 'monitored';

export interface AIGovernanceFramework {
  id: string;
  name: string;
  date: string;                 // ISO date of adoption/signing
  signatories: number;          // number of countries/entities
  scope: FrameworkScope;
  status: FrameworkStatus;
  bindingNature: BindingNature;
  description: string;
  keyProvisions: string[];
  region: string;
  governanceScore: number;      // 0-100 contribution to governance
}

export interface MilitaryAIProgram {
  id: string;
  country: string;
  programName: string;
  description: string;
  capability: string;
  status: 'operational' | 'developmental' | 'research';
  lawsStance: LAWSStance;
  riskLevel: MilitaryAIRisk;
  computeConstraints: boolean;  // subject to chip export controls
}

export interface CapabilityBenchmark {
  id: string;
  name: string;
  description: string;
  status: BenchmarkStatus;
  impactLevel: MilitaryAIRisk;
  policyResponse: string;
}

export interface AIGovernanceRenderData {
  frameworks: AIGovernanceFramework[];
  militaryPrograms: MilitaryAIProgram[];
  benchmarks: CapabilityBenchmark[];
  globalGovernanceIndex: number;        // 0-100, higher = more governed
  activeFrameworkCount: number;
  bindingFrameworkCount: number;
  armsRaceRisk: MilitaryAIRisk;
  voluntaryCommitmentCount: number;
  coverageGap: boolean;                 // true if no binding global AI treaty
  recentFrameworks: AIGovernanceFramework[];  // sorted date desc, top 5
}

// ── Data ──────────────────────────────────────────────────────────────────────

const FRAMEWORKS: AIGovernanceFramework[] = [
  {
    id: 'F001',
    name: 'UK AI Safety Summit — Bletchley Declaration',
    date: '2023-11-01',
    signatories: 28,
    scope: 'multilateral',
    status: 'active',
    bindingNature: 'voluntary',
    description:
      'First international declaration on frontier AI safety risks, signed at Bletchley Park, UK. 28 countries including USA, China, and EU member states agreed on the need to manage catastrophic risks from frontier AI models.',
    keyProvisions: [
      'Recognition of catastrophic and existential risks from frontier AI',
      'Commitment to information-sharing on AI safety evaluations',
      'Establishment of international AI Safety Institute network',
      'Voluntary participation in state-backed pre-deployment safety testing',
    ],
    region: 'Global',
    governanceScore: 65,
  },
  {
    id: 'F002',
    name: 'US Executive Order on Safe, Secure, and Trustworthy AI',
    date: '2023-10-30',
    signatories: 1,
    scope: 'unilateral',
    status: 'active',
    bindingNature: 'executive-action',
    description:
      'EO 14110 mandating safety testing, civil-rights protections, and national-security safeguards for AI. Required frontier model developers to share safety-test results with the US government via Defense Production Act authority.',
    keyProvisions: [
      'Mandatory safety testing for frontier AI above 10^26 FLOPs compute threshold',
      'Defense Production Act reporting requirement for AI developers',
      'NIST AI Safety Institute established for evaluations',
      'A100/H100 export-control regime expanded to additional countries',
    ],
    region: 'United States',
    governanceScore: 72,
  },
  {
    id: 'F003',
    name: 'EU AI Act',
    date: '2024-03-13',
    signatories: 27,
    scope: 'multilateral',
    status: 'active',
    bindingNature: 'legally-binding',
    description:
      "World's first comprehensive, legally binding AI regulation. Risk-tiered framework banning social scoring and real-time biometric surveillance, imposing strict obligations on high-risk AI systems, and setting transparency requirements for general-purpose AI models.",
    keyProvisions: [
      'Risk tiers: unacceptable / high / limited / minimal — banned uses include social credit and biometric surveillance',
      'GPAI model obligations above 10^25 FLOPs training compute threshold',
      'AI Office established as EU-level enforcement body',
      'Penalties up to EUR 35 million or 7% of global annual turnover',
      'Phased rollout: prohibitions 2024, high-risk obligations 2026',
    ],
    region: 'European Union',
    governanceScore: 88,
  },
  {
    id: 'F004',
    name: 'G7 Hiroshima AI Process — International Code of Conduct',
    date: '2023-10-30',
    signatories: 7,
    scope: 'voluntary',
    status: 'active',
    bindingNature: 'voluntary',
    description:
      'Voluntary code of conduct for advanced AI developers agreed by G7 nations. Eleven guiding principles covering safety, transparency, and responsible disclosure of frontier AI systems.',
    keyProvisions: [
      'Eleven voluntary principles for frontier AI developers',
      'Identification and mitigation of risks across the AI lifecycle',
      'Incident reporting and information sharing between signatories',
      'Investment in AI safety research and red-teaming',
    ],
    region: 'G7',
    governanceScore: 55,
  },
  {
    id: 'F005',
    name: 'China Generative AI Regulations',
    date: '2023-08-15',
    signatories: 1,
    scope: 'unilateral',
    status: 'active',
    bindingNature: 'legally-binding',
    description:
      'Mandatory regulations for generative AI services in China requiring real-name registration, content alignment with socialist core values, algorithmic transparency to regulators, and security assessments before public deployment.',
    keyProvisions: [
      'Real-name registration required for all generative AI users',
      'Generated content must align with core socialist values',
      'Security assessment required before public deployment',
      'Training-data sourcing and labeling transparency obligations',
    ],
    region: 'China',
    governanceScore: 60,
  },
  {
    id: 'F006',
    name: 'Seoul AI Summit — Seoul Statement',
    date: '2024-05-21',
    signatories: 16,
    scope: 'multilateral',
    status: 'active',
    bindingNature: 'voluntary',
    description:
      "Expanded the Bletchley commitments at the Seoul AI Summit. China joined multilateral AI safety discussions for the first time. Frontier AI labs signed formal safety commitments to UK AISI. Established an international network of AI Safety Institutes.",
    keyProvisions: [
      "China's first participation in a multilateral AI safety framework",
      'Frontier AI companies signed safety commitments to UK AISI',
      'AI Safety Institute network extended across participating nations',
      'Commitment to dual-use AI risk evaluation protocols',
    ],
    region: 'Global',
    governanceScore: 68,
  },
  {
    id: 'F007',
    name: 'UN AI Advisory Body — Governing AI for Humanity',
    date: '2024-09-01',
    signatories: 193,
    scope: 'multilateral',
    status: 'proposed',
    bindingNature: 'voluntary',
    description:
      'UN Secretary-General advisory body report identified a fundamental global AI governance gap and proposed an International AI Governance Panel (IAGP) modelled on the IPCC. Adopted at the Summit of the Future 2024.',
    keyProvisions: [
      'Identified critical global AI governance gap with no binding multilateral instrument',
      'Proposed International AI Governance Panel (IAGP) for scientific consensus',
      'Recommendations for inclusive global AI governance for developing nations',
      'Data commons and compute access proposals for the Global South',
    ],
    region: 'Global (UN)',
    governanceScore: 40,
  },
  {
    id: 'F008',
    name: 'US-China Bilateral AI Safety Talks',
    date: '2024-05-14',
    signatories: 2,
    scope: 'bilateral',
    status: 'active',
    bindingNature: 'voluntary',
    description:
      'First formal bilateral AI safety discussions between the USA and China since the 2023 diplomatic breakdown. Geneva talks covered AI risk, dual-use concerns, and military AI. A second round followed in September 2024.',
    keyProvisions: [
      'First US-China AI safety dialogue since 2023 breakdown',
      'Military AI risk reduction discussed — autonomous weapons escalation concerns raised',
      'Shared acknowledgement of catastrophic AI risk scenarios',
      'Commitment to continued dialogue channel (no binding agreements reached)',
    ],
    region: 'US-China',
    governanceScore: 35,
  },
  {
    id: 'F009',
    name: 'OECD AI Principles',
    date: '2019-05-22',
    signatories: 42,
    scope: 'multilateral',
    status: 'active',
    bindingNature: 'voluntary',
    description:
      'First intergovernmental AI governance standard. 42 nations adopted five principles covering inclusive growth, human-centred values, transparency, robustness, and accountability. Served as the precursor referenced by binding frameworks worldwide.',
    keyProvisions: [
      'Five AI principles: inclusive growth, human values, transparency, robustness, accountability',
      'OECD AI Policy Observatory established for global monitoring',
      'Referenced by G20 communiques, EU AI Act recitals, and US EO 14110',
      'Non-binding but forms the normative foundation for binding legislation',
    ],
    region: 'OECD',
    governanceScore: 50,
  },
  {
    id: 'F010',
    name: 'Frontier AI Safety Commitments to UK AISI',
    date: '2023-11-01',
    signatories: 16,
    scope: 'voluntary',
    status: 'active',
    bindingNature: 'voluntary',
    description:
      'Major frontier AI labs — OpenAI, Anthropic, Google DeepMind, Meta, xAI, and others — committed to pre-deployment safety evaluations with the UK AI Safety Institute and to sharing safety-test results. Commitments expanded at Seoul Summit 2024.',
    keyProvisions: [
      'Pre-deployment safety evaluations conducted by UK AISI',
      'Model access granted to AISI for capability assessments',
      'Information sharing on serious safety incidents',
      'Expanded to international AISI network at Seoul Summit 2024',
    ],
    region: 'Global (Industry)',
    governanceScore: 58,
  },
];

const MILITARY_PROGRAMS: MilitaryAIProgram[] = [
  {
    id: 'M001',
    country: 'USA',
    programName: 'Project Maven / JAIC / CDAO + AUKUS AI Pillar II',
    description:
      'DoD AI strategy executed via Chief Digital and AI Office (CDAO). Project Maven uses AI for battlefield imagery analysis and targeting. AUKUS Pillar II includes AI and autonomous-systems technology sharing with UK and Australia.',
    capability: 'ISR analysis, targeting assistance, autonomous logistics, coalition interoperability',
    status: 'operational',
    lawsStance: 'ambiguous',
    riskLevel: 'high',
    computeConstraints: false,
  },
  {
    id: 'M002',
    country: 'China',
    programName: 'PLA AI Integration — 2025 AI-Capable Military',
    description:
      "PLA 2025 target for AI-capable military operations. CMC AI doctrine integrates AI into C2 systems, ISR, electronic warfare, and autonomous platforms. Military-Civil Fusion (MCF) doctrine deliberately blurs civilian and military AI development.",
    capability: 'C2 automation, autonomous naval/aerial systems, electronic warfare, cognitive domain ops',
    status: 'developmental',
    lawsStance: 'developing',
    riskLevel: 'critical',
    computeConstraints: true,
  },
  {
    id: 'M003',
    country: 'Russia',
    programName: 'Russian AI Weapons Program',
    description:
      'Russia developing AI-enabled autonomous weapons and drone swarms despite significant compute constraints from Western export controls following the 2022 invasion of Ukraine. Uran-9 UGV and S-70 Okhotnik combat drone are notable programs.',
    capability: 'Drone swarms, autonomous ground vehicles, electronic warfare, loitering munitions',
    status: 'developmental',
    lawsStance: 'opposing',
    riskLevel: 'high',
    computeConstraints: true,
  },
  {
    id: 'M004',
    country: 'Israel',
    programName: 'AI-Assisted Targeting Systems (Lavender / Gospel)',
    description:
      'IDF deployed AI-assisted targeting systems including Lavender and Gospel intelligence tools for rapid target identification. Operations in Gaza 2023-2024 raised significant ethical and legal concerns about human oversight in lethal decisions.',
    capability: 'Target identification, strike optimisation, real-time battlefield intelligence',
    status: 'operational',
    lawsStance: 'developing',
    riskLevel: 'critical',
    computeConstraints: false,
  },
];

const BENCHMARKS: CapabilityBenchmark[] = [
  {
    id: 'B001',
    name: 'Frontier Model Compute Threshold (10^26 FLOPs)',
    description:
      'US EO 14110 and the EU AI Act both set 10^26 FLOPs training compute as the threshold triggering mandatory safety obligations for general-purpose AI models. Current frontier models are at or above this threshold.',
    status: 'threshold-passed',
    impactLevel: 'high',
    policyResponse: 'US EO mandatory government reporting; EU AI Act GPAI obligations and systemic-risk rules',
  },
  {
    id: 'B002',
    name: 'Advanced AI Chip Export Controls (A100/H100)',
    description:
      'BIS October 2023 rules banned export of NVIDIA A100, H100, and equivalent AI chips to China and other adversary nations without a licence. Rules expanded October 2024 to cover H20 and other workaround chips.',
    status: 'controlled',
    impactLevel: 'high',
    policyResponse: 'BIS export-control rules; AUKUS technology-sharing carve-outs; Wassenaar coordination',
  },
  {
    id: 'B003',
    name: 'Autonomous Lethal Weapons (LAWS) Treaty Gap',
    description:
      'No binding international treaty prohibits fully autonomous lethal weapons. CCW discussions have continued since 2014 without agreement. Major powers (US, Russia, China) have consistently blocked a binding prohibition.',
    status: 'monitored',
    impactLevel: 'critical',
    policyResponse: 'CCW GGE discussions; US DoD Directive 3000.09 on meaningful human control; ICRC campaigns',
  },
  {
    id: 'B004',
    name: 'Frontier AI Dual-Use Capability (CBRN Uplift)',
    description:
      'Current frontier models demonstrate meaningful uplift in CBRN-related research, cyberattack planning, and biological-synthesis guidance. Red-teaming by UK and US AISI confirmed biological uplift risk at current capability levels.',
    status: 'approaching',
    impactLevel: 'critical',
    policyResponse: 'UK/US AISI mandatory red-teaming; pre-deployment evaluations under Bletchley commitments',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns only frameworks with status === 'active'. */
export function getActiveFrameworks(
  frameworks: AIGovernanceFramework[],
): AIGovernanceFramework[] {
  return frameworks.filter(f => f.status === 'active');
}

/** Returns frameworks filtered to the given status. */
export function getByStatus(
  frameworks: AIGovernanceFramework[],
  status: FrameworkStatus,
): AIGovernanceFramework[] {
  return frameworks.filter(f => f.status === status);
}

/**
 * Returns military AI programs sorted by risk level descending (critical first).
 * This is the primary "arms race indicator" display list.
 */
export function getAIArmsRaceIndicators(
  programs: MilitaryAIProgram[],
): MilitaryAIProgram[] {
  const order: Record<MilitaryAIRisk, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return [...programs].sort((a, b) => order[a.riskLevel] - order[b.riskLevel]);
}

/** CSS class for a framework status badge. */
export function frameworkStatusClass(status: FrameworkStatus): string {
  const map: Record<FrameworkStatus, string> = {
    active: 'status-active',
    proposed: 'status-proposed',
    voluntary: 'status-voluntary',
    expired: 'status-expired',
  };
  return map[status] ?? 'status-proposed';
}

/** CSS class for a military AI or benchmark risk level. */
export function riskClass(risk: MilitaryAIRisk): string {
  const map: Record<MilitaryAIRisk, string> = {
    critical: 'risk-critical',
    high: 'risk-high',
    medium: 'risk-medium',
    low: 'risk-low',
  };
  return map[risk] ?? 'risk-low';
}

/** CSS class for a framework's binding nature. */
export function bindingClass(nature: BindingNature): string {
  const map: Record<BindingNature, string> = {
    'legally-binding': 'binding-legal',
    voluntary: 'binding-voluntary',
    'executive-action': 'binding-exec',
    treaty: 'binding-treaty',
  };
  return map[nature] ?? 'binding-voluntary';
}

/** CSS class for a framework's geographic scope. */
export function scopeClass(scope: FrameworkScope): string {
  const map: Record<FrameworkScope, string> = {
    multilateral: 'scope-multi',
    bilateral: 'scope-bilateral',
    unilateral: 'scope-uni',
    voluntary: 'scope-voluntary',
  };
  return map[scope] ?? 'scope-voluntary';
}

/**
 * Computes the global AI governance index (0-100).
 * Weights active, binding frameworks more heavily;
 * penalises each critical-risk military AI program.
 */
export function computeGovernanceIndex(
  frameworks: AIGovernanceFramework[],
  programs: MilitaryAIProgram[],
): number {
  const active = frameworks.filter(f => f.status === 'active');
  if (!active.length) return 0;

  const weightFor = (f: AIGovernanceFramework): number => {
    if (f.bindingNature === 'legally-binding') return 1.5;
    if (f.bindingNature === 'executive-action') return 1.2;
    return 1;
  };

  const weightedSum = active.reduce((s, f) => s + f.governanceScore * weightFor(f), 0);
  const totalWeight = active.reduce((s, f) => s + weightFor(f), 0);
  const base = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const criticalCount = programs.filter(p => p.riskLevel === 'critical').length;
  const penalty = criticalCount * 5;

  return Math.max(0, Math.min(100, Math.round(base - penalty)));
}

/** Returns the highest risk level present among the given military programs. */
export function getArmsRaceRisk(programs: MilitaryAIProgram[]): MilitaryAIRisk {
  if (programs.some(p => p.riskLevel === 'critical')) return 'critical';
  if (programs.some(p => p.riskLevel === 'high')) return 'high';
  if (programs.some(p => p.riskLevel === 'medium')) return 'medium';
  return 'low';
}

/** Builds the full render-data payload consumed by AIGovernancePanel. */
export function buildRenderData(): AIGovernanceRenderData {
  return {
    frameworks: FRAMEWORKS,
    militaryPrograms: MILITARY_PROGRAMS,
    benchmarks: BENCHMARKS,
    globalGovernanceIndex: computeGovernanceIndex(FRAMEWORKS, MILITARY_PROGRAMS),
    activeFrameworkCount: FRAMEWORKS.filter(f => f.status === 'active').length,
    bindingFrameworkCount: FRAMEWORKS.filter(f => f.bindingNature === 'legally-binding').length,
    armsRaceRisk: getArmsRaceRisk(MILITARY_PROGRAMS),
    voluntaryCommitmentCount: FRAMEWORKS.filter(f => f.bindingNature === 'voluntary').length,
    coverageGap: !FRAMEWORKS.some(
      f =>
        f.scope === 'multilateral' &&
        f.bindingNature === 'legally-binding' &&
        f.signatories > 50,
    ),
    recentFrameworks: [...FRAMEWORKS]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5),
  };
}
