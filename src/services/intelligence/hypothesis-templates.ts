/**
 * Hypothesis templates — pre-defined competing explanations per domain
 * that seed the HypothesisEngine.
 *
 * Each template specifies:
 *   - label: short headline for the panel ("Mechanical failure")
 *   - description: 2-3 sentence rationale shown when expanded
 *   - priorProbability: domain base rate before any evidence is applied.
 *     Sum across the set roughly approximates 1, but the Bayesian update
 *     does not strictly require it — we re-normalize after the posterior
 *     pass.
 *   - supportingTagFragments / contradictingTagFragments: case-insensitive
 *     substrings checked against `ObservationEvent.tags`. Matches push
 *     observations into the hypothesis's supporting / contradicting lists,
 *     which drives the Bayesian update via likelihood ratios.
 *
 * Pure deterministic. No DOM, no fetch.
 */

export interface HypothesisTemplate {
  label: string;
  description: string;
  priorProbability: number;
  supportingTagFragments: string[];
  contradictingTagFragments: string[];
}

export interface DomainTemplateSet {
  domain: string;
  templates: HypothesisTemplate[];
}

const EARTHQUAKE_TEMPLATES: HypothesisTemplate[] = [
  {
    label: 'Natural seismic event',
    description: 'Tectonic stress release along a known or mapped fault. The most common cause of seismic activity in this region; consistent with the baseline rate.',
    priorProbability: 0.6,
    supportingTagFragments: ['fault', 'tectonic', 'mainshock'],
    contradictingTagFragments: ['induced', 'injection-well', 'mining'],
  },
  {
    label: 'Induced seismicity (mining / injection)',
    description: 'Human-caused stress change from wastewater injection, hydraulic fracturing, or mine collapse. Look for proximity to active wells or extraction sites and shallow focal depths.',
    priorProbability: 0.15,
    supportingTagFragments: ['induced', 'injection', 'mining', 'shallow'],
    contradictingTagFragments: ['deep', 'oceanic-fault'],
  },
  {
    label: 'Aftershock sequence',
    description: 'Continued energy release from a recent larger event. Expect declining magnitude over hours/days following an Omori-law decay curve.',
    priorProbability: 0.2,
    supportingTagFragments: ['aftershock', 'sequence', 'omori'],
    contradictingTagFragments: ['precursor', 'first-event'],
  },
  {
    label: 'Precursor to larger event',
    description: 'Foreshock activity preceding a larger main shock. Relatively rare but consequential — elevated risk if magnitude trend is increasing.',
    priorProbability: 0.05,
    supportingTagFragments: ['precursor', 'swarm', 'increasing-magnitude'],
    contradictingTagFragments: ['aftershock', 'declining'],
  },
];

const WEATHER_TEMPLATES: HypothesisTemplate[] = [
  {
    label: 'Isolated severe storm',
    description: 'Local convective cell driven by daytime heating. Expected to dissipate within a few hours and stay near the originating area.',
    priorProbability: 0.45,
    supportingTagFragments: ['convective', 'thunderstorm', 'isolated'],
    contradictingTagFragments: ['stationary-front', 'system', 'expanding'],
  },
  {
    label: 'Developing system (watch area expanding)',
    description: 'Organizing storm complex whose impact footprint is growing. Watch upgrades and new polygon issuances likely in the next few hours.',
    priorProbability: 0.25,
    supportingTagFragments: ['watch-expanding', 'upgrade', 'system', 'organizing'],
    contradictingTagFragments: ['isolated', 'dissipating'],
  },
  {
    label: 'Stationary front (prolonged impact)',
    description: 'Slow-moving boundary expected to produce repeated training storms over the same area. Flood risk is the dominant concern.',
    priorProbability: 0.2,
    supportingTagFragments: ['stationary-front', 'training', 'flood'],
    contradictingTagFragments: ['fast-moving', 'isolated'],
  },
  {
    label: 'Rapidly intensifying event',
    description: 'Tropical or extratropical system with explosive deepening or unusual ramp-up. Demands immediate downstream coordination.',
    priorProbability: 0.1,
    supportingTagFragments: ['rapid-intensification', 'bomb-cyclone', 'category-jump'],
    contradictingTagFragments: ['weakening', 'steady-state'],
  },
];

const MARITIME_TEMPLATES: HypothesisTemplate[] = [
  {
    label: 'Mechanical or navigation incident',
    description: 'Vessel emergency consistent with engine, steering, or routing failure. Most common cause of unusual track behaviour.',
    priorProbability: 0.4,
    supportingTagFragments: ['engine-failure', 'steering', 'drifting', 'mechanical'],
    contradictingTagFragments: ['piracy', 'spoofing'],
  },
  {
    label: 'Piracy or hostile boarding',
    description: 'Track and emissions pattern consistent with hostile interception. Elevated where transit corridors cross piracy hotspots.',
    priorProbability: 0.1,
    supportingTagFragments: ['piracy', 'boarding', 'hostile', 'attack'],
    contradictingTagFragments: ['port-call', 'maintenance'],
  },
  {
    label: 'Cargo or fuel emergency',
    description: 'Onboard incident affecting cargo (fire, shift, leak) or fuel reserves. Often coincides with sudden speed loss + radio traffic.',
    priorProbability: 0.25,
    supportingTagFragments: ['cargo-shift', 'fuel-emergency', 'fire', 'leak'],
    contradictingTagFragments: ['piracy', 'normal-transit'],
  },
  {
    label: 'Deliberate signal spoofing',
    description: 'AIS / position transmissions appear inconsistent with physical evidence. Suspected dark fleet or sanctions-evasion behavior.',
    priorProbability: 0.05,
    supportingTagFragments: ['ais-gap', 'spoofing', 'dark-fleet', 'sanctions'],
    contradictingTagFragments: ['verified-position'],
  },
];

const AVIATION_TEMPLATES: HypothesisTemplate[] = [
  {
    label: 'Mechanical failure',
    description: 'Aircraft system anomaly consistent with engine, hydraulics, or pressurization issues. The most common driver of unscheduled diverts.',
    priorProbability: 0.4,
    supportingTagFragments: ['mechanical', 'engine', 'pressurization', 'hydraulic'],
    contradictingTagFragments: ['weather-divert', 'security'],
  },
  {
    label: 'Weather divert',
    description: 'Route adjustment driven by deteriorating en-route or destination conditions. Look for SIGMET / AIRMET coverage along the planned path.',
    priorProbability: 0.3,
    supportingTagFragments: ['sigmet', 'airmet', 'divert', 'weather'],
    contradictingTagFragments: ['mechanical', 'security'],
  },
  {
    label: 'Security incident',
    description: 'Behaviour consistent with onboard security event (squawk 7500, unscheduled descent, no-fly compliance). Cross-check with ATC freq + NOTAMs.',
    priorProbability: 0.05,
    supportingTagFragments: ['squawk-7500', 'security', 'hijack', 'restricted-airspace'],
    contradictingTagFragments: ['weather', 'mechanical'],
  },
  {
    label: 'ATC conflict / near-miss',
    description: 'Sudden vector change or altitude deviation consistent with traffic separation conflict. Often paired with TCAS resolution advisories.',
    priorProbability: 0.15,
    supportingTagFragments: ['tcas', 'near-miss', 'separation', 'vector-change'],
    contradictingTagFragments: ['stable-cruise'],
  },
];

const BIOSURVEILLANCE_TEMPLATES: HypothesisTemplate[] = [
  {
    label: 'Seasonal outbreak (expected)',
    description: 'Cluster fits the expected seasonal pattern (influenza, RSV, norovirus). Baseline severity until R0 exceeds expectation.',
    priorProbability: 0.45,
    supportingTagFragments: ['influenza', 'rsv', 'seasonal', 'expected'],
    contradictingTagFragments: ['novel', 'out-of-season'],
  },
  {
    label: 'Novel pathogen emergence',
    description: 'Symptom profile or detection method suggests an unfamiliar agent. Demands rapid characterization and travel/contact tracing.',
    priorProbability: 0.1,
    supportingTagFragments: ['novel', 'unknown-pathogen', 'emergent'],
    contradictingTagFragments: ['known', 'seasonal'],
  },
  {
    label: 'Point-source contamination',
    description: 'Case map tightly clusters around a shared water, food, or environmental exposure. Public-health investigation should focus on the shared source.',
    priorProbability: 0.2,
    supportingTagFragments: ['cluster', 'point-source', 'water', 'foodborne'],
    contradictingTagFragments: ['dispersed', 'community-transmission'],
  },
  {
    label: 'Reporting artifact',
    description: 'Apparent surge tracks reporting changes (new lab, holiday backlog catch-up) rather than true incidence increase. Confirm against denominator.',
    priorProbability: 0.25,
    supportingTagFragments: ['backlog', 'reporting-change', 'new-lab'],
    contradictingTagFragments: ['lab-confirmed', 'genomic'],
  },
];

const CYBER_TEMPLATES: HypothesisTemplate[] = [
  {
    label: 'Opportunistic ransomware',
    description: 'Broad-spectrum extortion campaign exploiting a known vulnerability. Typically high volume / low targeting precision.',
    priorProbability: 0.45,
    supportingTagFragments: ['ransomware', 'leakage-site', 'mass-scan', 'cve'],
    contradictingTagFragments: ['targeted', 'apt', 'insider'],
  },
  {
    label: 'Targeted nation-state intrusion',
    description: 'Tactics, infrastructure, and target selection match a known APT. Slower-burning; emphasis on persistence and lateral movement.',
    priorProbability: 0.15,
    supportingTagFragments: ['apt', 'nation-state', 'spear-phish', 'lateral-movement'],
    contradictingTagFragments: ['ransomware', 'opportunistic'],
  },
  {
    label: 'Supply chain compromise',
    description: 'Initial access through a trusted vendor or software update channel. Look for shared dependency or signing key across victims.',
    priorProbability: 0.15,
    supportingTagFragments: ['supply-chain', 'signed-binary', 'vendor-compromise'],
    contradictingTagFragments: ['direct-exploit', 'phishing-only'],
  },
  {
    label: 'Insider threat',
    description: 'Access pattern consistent with abuse of legitimate credentials. Often surfaces via anomalous data egress from privileged accounts.',
    priorProbability: 0.25,
    supportingTagFragments: ['insider', 'credential-abuse', 'data-egress', 'privileged'],
    contradictingTagFragments: ['external', 'remote-exploit'],
  },
];

const SPACE_TEMPLATES: HypothesisTemplate[] = [
  {
    label: 'Transient solar event',
    description: 'Short-duration M / X-class flare with limited Earth-directed component. Communications and GPS impacts likely brief.',
    priorProbability: 0.5,
    supportingTagFragments: ['flare', 'm-class', 'x-class', 'transient'],
    contradictingTagFragments: ['sustained', 'cme'],
  },
  {
    label: 'Sustained geomagnetic storm',
    description: 'Coronal mass ejection arrived at Earth; Kp index elevated for hours. Higher-latitude utilities and HF radio should brace for sustained impact.',
    priorProbability: 0.2,
    supportingTagFragments: ['cme', 'geomagnetic-storm', 'kp', 'sustained'],
    contradictingTagFragments: ['transient', 'flare-only'],
  },
  {
    label: 'Radiation belt enhancement',
    description: 'Spike in trapped particle flux. Risk concentrated on satellite operators and high-altitude crewed flights.',
    priorProbability: 0.15,
    supportingTagFragments: ['radiation-belt', 'particle-flux', 'sep-event'],
    contradictingTagFragments: ['quiet', 'geomag-only'],
  },
  {
    label: 'Communication interference only',
    description: 'Effects confined to HF radio absorption / GPS degradation, no significant ground impact. Notify users; coordinate with SWPC for updates.',
    priorProbability: 0.15,
    supportingTagFragments: ['hf-blackout', 'gps-degradation', 'comms-only'],
    contradictingTagFragments: ['grid-impact', 'satellite-loss'],
  },
];

const GENERIC_TEMPLATES: HypothesisTemplate[] = [
  {
    label: 'Isolated incident',
    description: 'Single event with no observable connection to broader activity. Likely contained; routine monitoring sufficient.',
    priorProbability: 0.4,
    supportingTagFragments: ['isolated', 'single', 'localized'],
    contradictingTagFragments: ['coordinated', 'pattern', 'wave'],
  },
  {
    label: 'Coordinated multi-vector event',
    description: 'Multiple correlated signals across domains suggest a coordinated action. Watch for follow-on activity and broader impact.',
    priorProbability: 0.2,
    supportingTagFragments: ['coordinated', 'multi-vector', 'pattern', 'wave'],
    contradictingTagFragments: ['isolated'],
  },
  {
    label: 'Escalating situation',
    description: 'Severity or footprint trending upward. Expect tier upgrades, additional warnings, and resource demand growth.',
    priorProbability: 0.25,
    supportingTagFragments: ['escalating', 'expanding', 'upgrade', 'intensifying'],
    contradictingTagFragments: ['de-escalating', 'stable'],
  },
  {
    label: 'False alarm / misclassification',
    description: 'Signal patterns suggest a data artifact or upstream misclassification. Confirm via independent source before broadcasting downstream.',
    priorProbability: 0.15,
    supportingTagFragments: ['false-alarm', 'misclassification', 'sensor-fault', 'artifact'],
    contradictingTagFragments: ['confirmed', 'multi-source'],
  },
];

const DOMAIN_TEMPLATES: Record<string, HypothesisTemplate[]> = {
  earthquake: EARTHQUAKE_TEMPLATES,
  seismic: EARTHQUAKE_TEMPLATES,
  weather: WEATHER_TEMPLATES,
  maritime: MARITIME_TEMPLATES,
  aviation: AVIATION_TEMPLATES,
  biosurveillance: BIOSURVEILLANCE_TEMPLATES,
  health: BIOSURVEILLANCE_TEMPLATES,
  cyber: CYBER_TEMPLATES,
  space: SPACE_TEMPLATES,
  spaceweather: SPACE_TEMPLATES,
};

/** Return the template set for a domain, falling back to a generic
 *  4-template set when no domain-specific bank exists. Caller gets a
 *  fresh array — safe to mutate. */
export function templatesForDomain(domain: string): HypothesisTemplate[] {
  const key = domain.toLowerCase();
  const set = DOMAIN_TEMPLATES[key] ?? GENERIC_TEMPLATES;
  return set.map((t) => cloneTemplate(t));
}

export function allDomainKeys(): string[] {
  return Object.keys(DOMAIN_TEMPLATES);
}

function cloneTemplate(t: HypothesisTemplate): HypothesisTemplate {
  return {
    label: t.label,
    description: t.description,
    priorProbability: t.priorProbability,
    supportingTagFragments: [...t.supportingTagFragments],
    contradictingTagFragments: [...t.contradictingTagFragments],
  };
}

export const __internals = { GENERIC_TEMPLATES, DOMAIN_TEMPLATES };
