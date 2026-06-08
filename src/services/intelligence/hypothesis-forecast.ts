import type { Hypothesis } from '@/services/analyst-loop';
import type { PCIScore } from './predictive-crisis-index';
import { getProviderSnapshots } from '@/services/insights/insights-state';
import { assessProviderRedundancy } from '@/services/diagnostics/provider-redundancy';
import { getBoostMultiplier } from './forecast-calibration-adapter';

export interface HypothesisForecast {
  hypothesisId: string;
  probability: number;
  trend: 'rising' | 'stable' | 'falling';
  horizon: '6h' | '24h' | '72h';
  components: {
    baseConfidence: number;
    pciBoost: number;
    analogBoost: number;
    providerMultiplier: number;
    calibrationMultiplier: number;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function kindToDomain(): string {
  return 'general';
}

export function forecastHypothesis(
  hypothesis: Hypothesis,
  pci: PCIScore | null,
  analogScore: number | null,
  providerMultiplier = 1,
): HypothesisForecast {
  const baseConfidence = hypothesis.confidence;
  const calibrationMultiplier = getBoostMultiplier();
  const pciBoost = pci !== null && pci.index > 60 ? (pci.index - 60) / 200 : 0;
  const analogBoost = analogScore === null ? 0 : analogScore * 0.1;
  const probability = clamp((baseConfidence + pciBoost + analogBoost) * calibrationMultiplier * providerMultiplier, 0, 1);

  const diff = probability - baseConfidence;
  let trend: HypothesisForecast['trend'] = 'stable';
  if (diff > 0.05) trend = 'rising';
  else if (diff < -0.05) trend = 'falling';

  let horizon: HypothesisForecast['horizon'] = '72h';
  if (hypothesis.risk === 'critical') horizon = '6h';
  else if (hypothesis.risk === 'high') horizon = '24h';

  return {
    hypothesisId: hypothesis.id,
    probability,
    trend,
    horizon,
    components: { baseConfidence, pciBoost, analogBoost, providerMultiplier, calibrationMultiplier },
  };
}

export function forecastAll(hypotheses: Hypothesis[], pci: PCIScore | null): HypothesisForecast[] {
  const snapshots = getProviderSnapshots();
  return hypotheses.map(h => {
    let multiplier = 1;
    try {
      if (snapshots.length > 0) {
        const domain = kindToDomain();
        const domainSnapshots = snapshots.filter(s => s.domain === domain);
        if (domainSnapshots.length > 0) {
          const report = assessProviderRedundancy({ snapshots: domainSnapshots });
          const dr = report.domains.find(d => d.domain === domain);
          if (dr !== undefined) multiplier = dr.confidenceMultiplier;
        }
      }
    } catch {
      multiplier = 1;
    }
    return forecastHypothesis(h, pci, null, multiplier);
  });
}
