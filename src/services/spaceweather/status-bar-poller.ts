/**
 * Background poller that pushes SpaceWxStatus into the EEWStatusBar
 * banner every 5 minutes. Pulls from the same /api/spaceweather/status
 * endpoint the SpaceWeatherPanel uses; both can share the sidecar's
 * 5-min response cache without doubling the upstream NOAA load.
 */

import type { EEWStatusBar } from '@/components/EEWStatusBar';
import type { SpaceWxStatus } from '@/services/spaceweather/swpc-monitor';
import { getApiBaseUrl } from '@/services/runtime';

const POLL_MS = 5 * 60 * 1000;

export function startSpaceWeatherStatusBarPoller(
  bar: EEWStatusBar,
): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const resp = await fetch(`${getApiBaseUrl()}/api/spaceweather/status`, {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) return;
      const status = (await resp.json()) as SpaceWxStatus;
      bar.setSpaceWeatherStatus(status);
    } catch {
      // Network errors are non-fatal — the banner just keeps the prior state.
    }
  };

  void tick();
  timer = setInterval(() => { void tick(); }, POLL_MS);

  return {
    stop(): void {
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
