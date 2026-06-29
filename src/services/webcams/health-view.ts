import type { WebcamSourceHealth } from './webcam-types';

const ENV_HINT: Partial<Record<string, string>> = { WINDY: 'WINDY_WEBCAMS_API_KEY', NPS: 'NPS_API_KEY' };

export function healthSummary(health: WebcamSourceHealth[]): { ok: number; degraded: WebcamSourceHealth[]; cta: string[] } {
  const degraded = health.filter(h => h.status !== 'ok' && h.status !== 'empty');
  const cta = health.filter(h => h.status === 'missing_key' && ENV_HINT[h.source])
    .map(h => `${h.source}: add ${ENV_HINT[h.source]} in Settings → API Keys`);
  return { ok: health.filter(h => h.status === 'ok').length, degraded, cta };
}
