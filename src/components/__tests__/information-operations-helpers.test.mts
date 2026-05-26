import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INFO_THREAT_WEIGHTS,
  INFO_THREAT_COMPONENT_LABEL,
  attributionMethodLabel,
  attributionTier,
  attributionTierColor,
  attributionTierLabel,
  bandForInfoThreat,
  clampIntensity,
  computeInfoThreatIndex,
  countCriticalCib,
  countEscalatingForeignCampaigns,
  countFracturedRegions,
  countHighSeverityManipulation,
  countLikelyOrHighAttribution,
  formatAge,
  infoThreatBandColor,
  intensityLabel,
  manipulationKindLabel,
  polarizationBand,
  polarizationBandColor,
  polarizationBandLabel,
  severityColor,
  severityForCibEvent,
  severityForManipulationSignal,
  severityLabel,
  summarizeAttributionAssessments,
  summarizeCibEvents,
  summarizeForeignMediaCampaigns,
  summarizeManipulationSignals,
  summarizeNarrativeRegions,
  summarizeStateActorCampaigns,
  trajectoryColor,
  trajectoryLabel,
  type AttributionAssessment,
  type CibEvent,
  type ForeignMediaCampaign,
  type InfoThreatInput,
  type ManipulationSignal,
  type NarrativeRegion,
  type StateActorCampaign,
} from '../information-operations-helpers';

const NOW = 1_700_000_000_000;

describe('computeInfoThreatIndex', () => {
  it('returns zero score + null topDriver when every component is zero', () => {
    const empty: InfoThreatInput = {
      cibScore: 0,
      foreignMediaScore: 0,
      narrativeWarfareScore: 0,
      manipulationSignalScore: 0,
      stateActorCampaignScore: 0,
      attributionConfidenceScore: 0,
    };
    const r = computeInfoThreatIndex(empty);
    assert.equal(r.score, 0);
    assert.equal(r.band, 'low');
    assert.equal(r.topDriver, null);
  });

  it('saturates at 100 + critical band when every component is 100', () => {
    const saturated: InfoThreatInput = {
      cibScore: 100,
      foreignMediaScore: 100,
      narrativeWarfareScore: 100,
      manipulationSignalScore: 100,
      stateActorCampaignScore: 100,
      attributionConfidenceScore: 100,
    };
    const r = computeInfoThreatIndex(saturated);
    assert.equal(r.score, 100);
    assert.equal(r.band, 'critical');
    assert.ok(r.topDriver !== null);
  });

  it('picks top driver by weighted contribution, not raw score', () => {
    const input: InfoThreatInput = {
      cibScore: 80,
      foreignMediaScore: 100,
      narrativeWarfareScore: 80,
      manipulationSignalScore: 0,
      stateActorCampaignScore: 0,
      attributionConfidenceScore: 0,
    };
    const r = computeInfoThreatIndex(input);
    assert.equal(r.topDriver, INFO_THREAT_COMPONENT_LABEL.cibScore);
  });

  it('clamps out-of-range inputs into [0, 100] before weighting', () => {
    const input: InfoThreatInput = {
      cibScore: -50,
      foreignMediaScore: 1000,
      narrativeWarfareScore: NaN,
      manipulationSignalScore: 0,
      stateActorCampaignScore: 0,
      attributionConfidenceScore: 0,
    };
    const r = computeInfoThreatIndex(input);
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.equal(r.topDriver, INFO_THREAT_COMPONENT_LABEL.foreignMediaScore);
  });

  it('weights sum to 1.0', () => {
    const sum = Object.values(INFO_THREAT_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9);
  });
});

describe('bandForInfoThreat', () => {
  it('respects band boundaries', () => {
    assert.equal(bandForInfoThreat(0), 'low');
    assert.equal(bandForInfoThreat(19), 'low');
    assert.equal(bandForInfoThreat(20), 'moderate');
    assert.equal(bandForInfoThreat(39), 'moderate');
    assert.equal(bandForInfoThreat(40), 'elevated');
    assert.equal(bandForInfoThreat(59), 'elevated');
    assert.equal(bandForInfoThreat(60), 'severe');
    assert.equal(bandForInfoThreat(79), 'severe');
    assert.equal(bandForInfoThreat(80), 'critical');
    assert.equal(bandForInfoThreat(100), 'critical');
  });
});

describe('severityForCibEvent', () => {
  it('treats >= 1000 accounts as critical', () => {
    assert.equal(severityForCibEvent(1000, 0.9), 'critical');
    assert.equal(severityForCibEvent(5000, 0.9), 'critical');
  });
  it('treats >= 200 accounts as high', () => {
    assert.equal(severityForCibEvent(200, 0.9), 'high');
    assert.equal(severityForCibEvent(999, 0.9), 'high');
  });
  it('treats >= 20 accounts as moderate', () => {
    assert.equal(severityForCibEvent(20, 0.9), 'moderate');
    assert.equal(severityForCibEvent(199, 0.9), 'moderate');
  });
  it('treats < 20 accounts as low', () => {
    assert.equal(severityForCibEvent(0, 0.9), 'low');
    assert.equal(severityForCibEvent(19, 0.9), 'low');
  });
  it('caps low-confidence (< 0.4) reports at moderate severity', () => {
    assert.equal(severityForCibEvent(1000, 0.3), 'moderate');
    assert.equal(severityForCibEvent(200, 0.39), 'moderate');
  });
  it('does not promote a low-severity row when confidence is low', () => {
    assert.equal(severityForCibEvent(5, 0.1), 'low');
  });
});

describe('summarizeCibEvents', () => {
  const events: CibEvent[] = [
    { id: 'a', platform: 'Meta',  attribution: 'unattributed', accountCount: 50,   targetAudience: 'EU',  narrative: 'climate denial', confidence: 0.6, observedAt: NOW - 60_000 },
    { id: 'b', platform: 'X',     attribution: 'state-X',      accountCount: 2000, targetAudience: 'NA',  narrative: 'election',       confidence: 0.85, observedAt: NOW - 3_600_000 },
    { id: 'c', platform: 'TikTok',attribution: 'state-Y',      accountCount: 300,  targetAudience: 'APAC',narrative: 'covid',          confidence: 0.7, observedAt: NOW - 7_200_000 },
  ];
  it('sorts severe-first then most-recent-first', () => {
    const rows = summarizeCibEvents(events, NOW);
    assert.deepEqual(rows.map((r) => r.id), ['b', 'c', 'a']);
  });
  it('attaches a human-readable age label', () => {
    const rows = summarizeCibEvents(events, NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('a')!.ageLabel, '1m ago');
    assert.equal(byId.get('b')!.ageLabel, '1h ago');
    assert.equal(byId.get('c')!.ageLabel, '2h ago');
  });
  it('clamps confidence into [0, 1]', () => {
    const rows = summarizeCibEvents([
      { ...events[0]!, id: 'd', confidence: 99 },
      { ...events[0]!, id: 'e', confidence: -1 },
    ], NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('d')!.confidence, 1);
    assert.equal(byId.get('e')!.confidence, 0);
  });
});

describe('clampIntensity / intensityLabel', () => {
  it('clamps intensity into [1, 5] and rounds', () => {
    assert.equal(clampIntensity(0), 1);
    assert.equal(clampIntensity(10), 5);
    assert.equal(clampIntensity(NaN), 1);
    assert.equal(clampIntensity(2.7), 3);
  });
  it('produces a label for every clamped value', () => {
    assert.equal(intensityLabel(1), 'Background');
    assert.equal(intensityLabel(3), 'Sustained');
    assert.equal(intensityLabel(5), 'Saturation');
  });
});

describe('summarizeForeignMediaCampaigns', () => {
  const campaigns: ForeignMediaCampaign[] = [
    { id: 'a', originState: 'X', outlet: 'X-News', theme: 't1', regionsTargeted: ['EU'], intensity: 5, trajectory: 'escalating', observedAt: NOW - 60_000 },
    { id: 'b', originState: 'Y', outlet: 'Y-Today', theme: 't2', regionsTargeted: ['NA'], intensity: 3, trajectory: 'steady',     observedAt: NOW - 7_200_000 },
    { id: 'c', originState: 'Z', outlet: 'Z-Wire',  theme: 't3', regionsTargeted: ['LATAM'], intensity: 4, trajectory: 'declining', observedAt: NOW - 3_600_000 },
  ];
  it('sorts highest-intensity-first then most-recent-first', () => {
    const rows = summarizeForeignMediaCampaigns(campaigns, NOW);
    assert.deepEqual(rows.map((r) => r.id), ['a', 'c', 'b']);
  });
  it('attaches intensity label + trajectory label/color', () => {
    const rows = summarizeForeignMediaCampaigns(campaigns, NOW);
    const first = rows[0]!;
    assert.equal(first.intensityLabel, 'Saturation');
    assert.equal(trajectoryLabel('escalating'), '↑ Escalating');
    assert.ok(trajectoryColor('declining').includes('severity-low'));
  });
});

describe('polarizationBand', () => {
  it('produces 4-band ladder by polarization score', () => {
    assert.equal(polarizationBand(0), 'cohesive');
    assert.equal(polarizationBand(24), 'cohesive');
    assert.equal(polarizationBand(25), 'divided');
    assert.equal(polarizationBand(50), 'polarized');
    assert.equal(polarizationBand(74), 'polarized');
    assert.equal(polarizationBand(75), 'fractured');
    assert.equal(polarizationBand(100), 'fractured');
  });
  it('clamps out-of-range inputs', () => {
    assert.equal(polarizationBand(-50), 'cohesive');
    assert.equal(polarizationBand(1000), 'fractured');
  });
});

describe('summarizeNarrativeRegions', () => {
  const regions: NarrativeRegion[] = [
    { region: 'EU',  topNarrative: 'energy',   intensity: 60, polarization: 40, volume24h: 1000, sourceMix: { stateAlignedPct: 20, partisanMediaPct: 30, organicPct: 50 } },
    { region: 'NA',  topNarrative: 'election', intensity: 90, polarization: 85, volume24h: 5000, sourceMix: { stateAlignedPct: 60, partisanMediaPct: 25, organicPct: 15 } },
    { region: 'LAT', topNarrative: 'cartel',   intensity: 90, polarization: 95, volume24h: 800,  sourceMix: { stateAlignedPct: 5, partisanMediaPct: 80, organicPct: 15 } },
  ];
  it('sorts highest-intensity-first then highest-polarization-first', () => {
    const rows = summarizeNarrativeRegions(regions);
    assert.deepEqual(rows.map((r) => r.region), ['LAT', 'NA', 'EU']);
  });
  it('identifies dominant source bucket', () => {
    const rows = summarizeNarrativeRegions(regions);
    const byRegion = new Map(rows.map((r) => [r.region, r]));
    assert.equal(byRegion.get('NA')!.dominantSource, 'state-aligned');
    assert.equal(byRegion.get('LAT')!.dominantSource, 'partisan-media');
    assert.equal(byRegion.get('EU')!.dominantSource, 'organic');
  });
  it('attaches polarization band', () => {
    const rows = summarizeNarrativeRegions(regions);
    const byRegion = new Map(rows.map((r) => [r.region, r]));
    assert.equal(byRegion.get('EU')!.polarizationBand, 'divided');
    assert.equal(byRegion.get('LAT')!.polarizationBand, 'fractured');
  });
});

describe('severityForManipulationSignal', () => {
  it('elevates deepfake / compromised / cross-platform at lower magnitude', () => {
    assert.equal(severityForManipulationSignal('deepfake_detected', 25, 0.9), 'moderate');
    assert.equal(severityForManipulationSignal('deepfake_detected', 45, 0.9), 'high');
    assert.equal(severityForManipulationSignal('deepfake_detected', 75, 0.9), 'critical');
  });
  it('requires higher magnitude for noisier kinds', () => {
    assert.equal(severityForManipulationSignal('bot_amplification', 25, 0.9), 'low');
    assert.equal(severityForManipulationSignal('bot_amplification', 50, 0.9), 'moderate');
    assert.equal(severityForManipulationSignal('bot_amplification', 75, 0.9), 'high');
    assert.equal(severityForManipulationSignal('bot_amplification', 95, 0.9), 'critical');
  });
  it('caps low-confidence (< 0.4) detections at moderate', () => {
    assert.equal(severityForManipulationSignal('deepfake_detected', 75, 0.3), 'moderate');
    assert.equal(severityForManipulationSignal('bot_amplification', 95, 0.39), 'moderate');
  });
});

describe('summarizeManipulationSignals', () => {
  const signals: ManipulationSignal[] = [
    { id: 'a', platform: 'X',      kind: 'bot_amplification',           magnitude: 85, confidence: 0.9, description: 'spike', detectedAt: NOW - 60_000 },
    { id: 'b', platform: 'TikTok', kind: 'deepfake_detected',           magnitude: 50, confidence: 0.9, description: 'face swap', detectedAt: NOW - 3_600_000 },
    { id: 'c', platform: 'Meta',   kind: 'compromised_account_cluster', magnitude: 75, confidence: 0.9, description: 'creds', detectedAt: NOW - 7_200_000 },
  ];
  it('sorts severe-first then most-recent-first', () => {
    const rows = summarizeManipulationSignals(signals, NOW);
    // 'a' (bot, mag 85 → critical for noisy kind). 'c' (compromised,
    // mag 75 → critical for elevated kind). 'b' (deepfake, mag 50 →
    // high for elevated kind). Critical tie broken by recency: a > c.
    assert.deepEqual(rows.map((r) => r.id), ['a', 'c', 'b']);
  });
  it('attaches the kind label', () => {
    const rows = summarizeManipulationSignals(signals, NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('b')!.kindLabel, manipulationKindLabel('deepfake_detected'));
  });
});

describe('manipulationKindLabel', () => {
  it('covers every manipulation kind', () => {
    const labels: Array<'bot_amplification' | 'hashtag_manipulation' | 'deepfake_detected' | 'cross_platform_coordination' | 'astroturf_pattern' | 'compromised_account_cluster'> = [
      'bot_amplification', 'hashtag_manipulation', 'deepfake_detected',
      'cross_platform_coordination', 'astroturf_pattern', 'compromised_account_cluster',
    ];
    for (const k of labels) {
      assert.ok(manipulationKindLabel(k).length > 0);
    }
  });
});

describe('summarizeStateActorCampaigns', () => {
  const campaigns: StateActorCampaign[] = [
    { id: 'a', actor: 'State-X', campaign: 'theme-1', theme: 't', targetAudience: 'aud', mediums: ['tv'], intentInference: 'shape opinion', observedAt: NOW - 60_000 },
    { id: 'b', actor: 'State-Y', campaign: 'theme-2', theme: 't', targetAudience: 'aud', mediums: ['tv', 'social', 'radio', 'diaspora'], intentInference: 'mobilize', observedAt: NOW - 3_600_000 },
    { id: 'c', actor: 'State-Z', campaign: 'theme-3', theme: 't', targetAudience: 'aud', mediums: ['tv', 'social'], intentInference: 'distract', observedAt: NOW - 7_200_000 },
  ];
  it('sorts by medium count desc then recency', () => {
    const rows = summarizeStateActorCampaigns(campaigns, NOW);
    assert.deepEqual(rows.map((r) => r.id), ['b', 'c', 'a']);
  });
  it('passes through intent inference verbatim', () => {
    const rows = summarizeStateActorCampaigns(campaigns, NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('a')!.intentInference, 'shape opinion');
  });
});

describe('attributionTier', () => {
  it('ladders by confidence', () => {
    assert.equal(attributionTier(0.1,  'behavioral', false), 'unverified');
    assert.equal(attributionTier(0.3,  'behavioral', false), 'low');
    assert.equal(attributionTier(0.55, 'behavioral', false), 'moderate');
    assert.equal(attributionTier(0.7,  'behavioral', false), 'likely');
    assert.equal(attributionTier(0.9,  'behavioral', false), 'high');
  });
  it('multi-method promotes one rung (capped at high)', () => {
    assert.equal(attributionTier(0.1, 'multi_method', false), 'low');
    assert.equal(attributionTier(0.55, 'multi_method', false), 'likely');
    assert.equal(attributionTier(0.95, 'multi_method', false), 'high');
  });
  it('dissent demotes one rung (capped at unverified)', () => {
    assert.equal(attributionTier(0.9,  'behavioral', true), 'likely');
    assert.equal(attributionTier(0.55, 'behavioral', true), 'low');
    assert.equal(attributionTier(0.1,  'behavioral', true), 'unverified');
  });
  it('multi-method + dissent net out', () => {
    assert.equal(attributionTier(0.55, 'multi_method', true), 'moderate');
  });
});

describe('summarizeAttributionAssessments', () => {
  const assessments: AttributionAssessment[] = [
    { id: 'a', claim: 'c1', suspectedActor: 'X', method: 'technical',    confidence: 0.9, corroborationCount: 3, dissent: false, assessedAt: NOW - 60_000 },
    { id: 'b', claim: 'c2', suspectedActor: 'Y', method: 'behavioral',   confidence: 0.5, corroborationCount: 1, dissent: true,  assessedAt: NOW - 3_600_000 },
    { id: 'c', claim: 'c3', suspectedActor: 'Z', method: 'multi_method', confidence: 0.7, corroborationCount: 4, dissent: false, assessedAt: NOW - 7_200_000 },
  ];
  it('sorts highest-tier-first then highest-confidence-first', () => {
    const rows = summarizeAttributionAssessments(assessments, NOW);
    // 'a' (tech 0.9) → high. 'c' (multi 0.7→promoted) → high. Tie broken
    // by confidence desc, so 'a' > 'c'. 'b' (behav 0.5 → moderate
    // demoted by dissent → low) trails.
    assert.deepEqual(rows.map((r) => r.id), ['a', 'c', 'b']);
  });
  it('surfaces dissent on the row, never averaged away', () => {
    const rows = summarizeAttributionAssessments(assessments, NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('b')!.dissent, true);
    assert.equal(byId.get('a')!.dissent, false);
  });
});

describe('attributionMethodLabel + tier label/color', () => {
  it('covers every attribution method', () => {
    const methods: Array<'technical' | 'behavioral' | 'linguistic' | 'distribution' | 'multi_method'> = [
      'technical', 'behavioral', 'linguistic', 'distribution', 'multi_method',
    ];
    for (const m of methods) {
      assert.ok(attributionMethodLabel(m).length > 0);
    }
  });
  it('covers every tier with label + color', () => {
    const tiers: Array<'unverified' | 'low' | 'moderate' | 'likely' | 'high'> = [
      'unverified', 'low', 'moderate', 'likely', 'high',
    ];
    for (const t of tiers) {
      assert.ok(attributionTierLabel(t).length > 0);
      assert.ok(attributionTierColor(t).length > 0);
    }
  });
});

describe('counts / aggregators', () => {
  it('countCriticalCib counts only critical', () => {
    const rows = summarizeCibEvents([
      { id: 'a', platform: 'p', attribution: 'a', accountCount: 5000, targetAudience: 't', narrative: 'n', confidence: 0.9, observedAt: NOW },
      { id: 'b', platform: 'p', attribution: 'a', accountCount: 50,   targetAudience: 't', narrative: 'n', confidence: 0.9, observedAt: NOW },
    ], NOW);
    assert.equal(countCriticalCib(rows), 1);
  });
  it('countEscalatingForeignCampaigns counts only escalating', () => {
    const rows = summarizeForeignMediaCampaigns([
      { id: 'a', originState: 's', outlet: 'o', theme: 't', regionsTargeted: [], intensity: 3, trajectory: 'escalating', observedAt: NOW },
      { id: 'b', originState: 's', outlet: 'o', theme: 't', regionsTargeted: [], intensity: 3, trajectory: 'declining',  observedAt: NOW },
    ], NOW);
    assert.equal(countEscalatingForeignCampaigns(rows), 1);
  });
  it('countFracturedRegions counts only fractured polarization', () => {
    const rows = summarizeNarrativeRegions([
      { region: 'a', topNarrative: 'n', intensity: 90, polarization: 90, volume24h: 0, sourceMix: { stateAlignedPct: 33, partisanMediaPct: 33, organicPct: 34 } },
      { region: 'b', topNarrative: 'n', intensity: 90, polarization: 30, volume24h: 0, sourceMix: { stateAlignedPct: 33, partisanMediaPct: 33, organicPct: 34 } },
    ]);
    assert.equal(countFracturedRegions(rows), 1);
  });
  it('countHighSeverityManipulation counts high + critical', () => {
    const rows = summarizeManipulationSignals([
      { id: 'a', platform: 'p', kind: 'bot_amplification', magnitude: 90, confidence: 0.9, description: 'd', detectedAt: NOW },
      { id: 'b', platform: 'p', kind: 'bot_amplification', magnitude: 20, confidence: 0.9, description: 'd', detectedAt: NOW },
    ], NOW);
    assert.equal(countHighSeverityManipulation(rows), 1);
  });
  it('countLikelyOrHighAttribution counts likely + high', () => {
    const rows = summarizeAttributionAssessments([
      { id: 'a', claim: 'c', suspectedActor: 'x', method: 'technical', confidence: 0.9, corroborationCount: 1, dissent: false, assessedAt: NOW },
      { id: 'b', claim: 'c', suspectedActor: 'x', method: 'technical', confidence: 0.3, corroborationCount: 1, dissent: false, assessedAt: NOW },
    ], NOW);
    assert.equal(countLikelyOrHighAttribution(rows), 1);
  });
});

describe('display constants', () => {
  it('infoThreatBandColor covers every band', () => {
    for (const b of ['low','moderate','elevated','severe','critical'] as const) {
      assert.ok(infoThreatBandColor(b).length > 0);
    }
  });
  it('severityColor + severityLabel cover every severity', () => {
    for (const s of ['low','moderate','high','critical'] as const) {
      assert.ok(severityColor(s).length > 0);
      assert.ok(severityLabel(s).length > 0);
    }
  });
  it('polarizationBandColor + polarizationBandLabel cover every band', () => {
    for (const b of ['cohesive','divided','polarized','fractured'] as const) {
      assert.ok(polarizationBandColor(b).length > 0);
      assert.ok(polarizationBandLabel(b).length > 0);
    }
  });
  it('trajectoryColor + trajectoryLabel cover every trajectory', () => {
    for (const t of ['escalating','steady','declining'] as const) {
      assert.ok(trajectoryColor(t).length > 0);
      assert.ok(trajectoryLabel(t).length > 0);
    }
  });
  it('INFO_THREAT_COMPONENT_LABEL covers every weighted key', () => {
    for (const k of Object.keys(INFO_THREAT_WEIGHTS)) {
      const labelMap = INFO_THREAT_COMPONENT_LABEL as Record<string, string>;
      const label = labelMap[k];
      assert.ok(label !== undefined && label.length > 0);
    }
  });
});

describe('formatAge', () => {
  it('renders coarsely by magnitude', () => {
    assert.equal(formatAge(NOW, NOW), 'just now');
    assert.equal(formatAge(NOW - 60_000, NOW), '1m ago');
    assert.equal(formatAge(NOW - 3_600_000, NOW), '1h ago');
    assert.equal(formatAge(NOW - 86_400_000, NOW), '1d ago');
    assert.equal(formatAge(NOW - 7 * 86_400_000, NOW), '1w ago');
    assert.equal(formatAge(NOW - 35 * 86_400_000, NOW), '1mo ago');
    assert.equal(formatAge(NOW - 400 * 86_400_000, NOW), '1y ago');
  });
  it('clamps negative deltas to "just now"', () => {
    assert.equal(formatAge(NOW + 60_000, NOW), 'just now');
  });
});
