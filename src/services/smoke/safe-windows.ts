/**
 * Safe-window detection over hourly AQI samples.
 * "Safe" = contiguous run with usAqi < threshold (default 100). A null
 * sample is NOT safe — no data must never read as good air.
 */
import type { AqiSample, SafeWindow, DaySummary } from './smoke-types';
import { categorizeUsAqi, AQI_CATEGORY_LABEL } from './aqi-category';

const HOUR_MS = 3_600_000;

function hourLabel(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${ampm}`;
}

function peakOf(run: AqiSample[]): number {
  return Math.max(...run.map((s) => s.usAqi ?? 0));
}

function toWindow(run: AqiSample[]): SafeWindow {
  const startIso = run[0]!.time;
  // Window covers through the END of the last sampled hour.
  const endIso = new Date(new Date(run[run.length - 1]!.time).getTime() + HOUR_MS).toISOString();
  return { startIso, endIso, peakAqi: peakOf(run), label: `${hourLabel(startIso)}–${hourLabel(endIso)}` };
}

export function computeSafeWindows(
  samples: AqiSample[],
  threshold = 100,
): { safeWindows: SafeWindow[]; worstWindow: SafeWindow | null } {
  const safeWindows: SafeWindow[] = [];
  const unsafeRuns: AqiSample[][] = [];
  let safeRun: AqiSample[] = [];
  let unsafeRun: AqiSample[] = [];

  const flushSafe = () => {
    if (safeRun.length > 0) safeWindows.push(toWindow(safeRun));
    safeRun = [];
  };
  const flushUnsafe = () => {
    if (unsafeRun.length > 0) unsafeRuns.push(unsafeRun);
    unsafeRun = [];
  };

  for (const s of samples) {
    const safe = s.usAqi !== null && s.usAqi < threshold;
    if (safe) {
      flushUnsafe();
      safeRun.push(s);
    } else {
      flushSafe();
      if (s.usAqi === null) flushUnsafe();
      else unsafeRun.push(s);
    }
  }
  flushSafe();
  flushUnsafe();

  let worstRun: AqiSample[] | null = null;
  for (const run of unsafeRuns) {
    if (worstRun === null || peakOf(run) > peakOf(worstRun)) worstRun = run;
  }
  return { safeWindows, worstWindow: worstRun ? toWindow(worstRun) : null };
}

export function computeDaySummaries(samples: AqiSample[]): DaySummary[] {
  const byDate = new Map<string, number>();
  for (const s of samples) {
    if (s.usAqi === null) continue;
    const dateIso = s.time.slice(0, 10);
    byDate.set(dateIso, Math.max(byDate.get(dateIso) ?? 0, s.usAqi));
  }
  return [...byDate.entries()].map(([dateIso, maxAqi]) => {
    const category = categorizeUsAqi(maxAqi);
    const weekday = new Date(`${dateIso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    return {
      dateIso,
      maxAqi,
      category,
      headline: `${weekday}: ${AQI_CATEGORY_LABEL[category].toLowerCase()} (peak ${maxAqi})`,
    };
  });
}
