import type { Hypothesis } from '@/services/analyst-loop';
import type { PCIScore } from './predictive-crisis-index';

export interface HypothesisForecast {
  hypothesisId: string;
  probability: number;
  trend: 'rising' | 'stable' | 'falling';
  horizon: '6h' | '24h' | '72h';
  components: {
    baseConfidence: number;
    pciBoost: number;
    analogBoost: number;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function forecastHypothesis(
  hypothesis: Hypothesis,
  pci: PCIScore | null,
  analogScore: number | null,
): HypothesisForecast {
  const baseConfidence = hypothesis.confidence;
  const pciBoost = pci !== null && pci.index > 60 ? (pci.index - 60) / 200 : 0;
  const analogBoost = analogScore === null ? 0 : analogScore * 0.1;
  const probability = clamp(baseConfidence + pciBoost + analogBoost, 0, 1);

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
    components: { baseConfidence, pciBoost, analogBoost },
  };
}

export function forecastAll(hypotheses: Hypothesis[], pci: PCIScore | null): HypothesisForecast[] {
  return hypotheses.map(h => forecastHypothesis(h, pci, null));
}
