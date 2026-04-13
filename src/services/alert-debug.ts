/**
 * Alert debug — ring buffer of recent score/reaction events for tuning.
 *
 * Enable with `?debug=triage` (any URL with that query param).
 * `(window as any).cbAlertDebug.dump()` prints the full ring.
 */

export interface DebugEvent {
  t: number;
  kind: 'ingest' | 'react' | 'snooze' | 'ack' | 'correlate';
  alertId: string;
  source?: string;
  severity?: string;
  score?: number;
  note?: string;
}

const RING_SIZE = 500;
const ring: DebugEvent[] = [];
let enabled = false;

export function isDebugEnabled(): boolean { return enabled; }

export function logEvent(e: Omit<DebugEvent, 't'>): void {
  if (!enabled) return;
  ring.push({ t: Date.now(), ...e });
  if (ring.length > RING_SIZE) ring.shift();
}

export function dumpEvents(): DebugEvent[] {
  return [...ring];
}

export function startAlertDebug(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === 'triage') enabled = true;
  } catch { /* noop */ }
  if (!enabled) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).cbAlertDebug = {
    dump: () => { console.table(dumpEvents()); return dumpEvents(); },
    clear: () => { ring.length = 0; },
    enabled: () => enabled,
  };
  // eslint-disable-next-line no-console
  console.log('[alert-debug] enabled — call cbAlertDebug.dump() to inspect');
}
