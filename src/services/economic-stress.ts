import { getApiBaseUrl } from '@/services/runtime';

export type Severity = 'normal' | 'warning' | 'critical' | 'unknown';

export interface IndicatorValue {
  value: number;
  label: string;
  severity: Severity;
  lagWeeks?: number;
}

export interface EconomicStressData {
  stressIndex: number;
  trend: 'rising' | 'stable' | 'falling';
  indicators: {
 yieldCurve: IndicatorValue;
 bankSpread: IndicatorValue;
 vix: IndicatorValue;
 fsi: IndicatorValue;
 supplyChain: IndicatorValue;
 jobClaims: IndicatorValue;
  };
  foodSecurity: { value: number | null; severity: Severity };
  updatedAt: string;
  fredKeyMissing?: boolean;
  error?: string;
}

export async function fetchEconomicStress(): Promise<EconomicStressData> {
  const res = await fetch(`${getApiBaseUrl()}/api/economic-stress`);
  if (!res.ok) throw new Error(`economic-stress: ${res.status}`);
  return res.json() as Promise<EconomicStressData>;
}
