export const MODE_FORECAST_THREAT_SOURCE_IDS = {
  finance: 'finance-pressure',
  security: 'security-pressure',
  cyber: 'cyber-pressure',
} as const;

export function isModeForecastThreatSourceEventId(sourceEventId: string): boolean {
  return sourceEventId === MODE_FORECAST_THREAT_SOURCE_IDS.finance
    || sourceEventId === MODE_FORECAST_THREAT_SOURCE_IDS.security
    || sourceEventId === MODE_FORECAST_THREAT_SOURCE_IDS.cyber;
}
