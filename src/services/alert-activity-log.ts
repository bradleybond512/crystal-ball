/**
 * Alert activity log — what happened in the last hour: new alerts,
 * acks, snoozes, correlations. Powers the "What just happened" timeline view.
 */

import { unifiedAlertStore, type UnifiedAlert } from './unified-alerts';

export type ActivityKind = 'new' | 'ack' | 'snooze' | 'correlate' | 'react';

export interface ActivityEntry {
  t: number;
  kind: ActivityKind;
  alertId: string;
  source: UnifiedAlert['source'];
  severity: UnifiedAlert['severity'];
  title: string;
}

const MAX_ENTRIES = 200;
const buffer: ActivityEntry[] = [];
const seen = new Set<string>();
const ackedSeen = new Set<string>();
const snoozedSeen = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) try { fn(); } catch { /* noop */ }
}

function append(e: ActivityEntry): void {
  buffer.push(e);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  notify();
}

export function getActivity(): ActivityEntry[] {
  return [...buffer].reverse();
}

export function subscribeActivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let started = false;
export function startAlertActivityLog(): void {
  if (started) return;
  started = true;
  // Seed seen-set so the boot snapshot doesn't generate spurious "new" entries.
  for (const a of unifiedAlertStore.getAll()) {
    seen.add(a.id);
    if (a.acknowledged) ackedSeen.add(a.id);
    if (a.snoozedUntil && a.snoozedUntil > Date.now()) snoozedSeen.add(a.id);
  }
  unifiedAlertStore.subscribe(() => {
    const all = unifiedAlertStore.getAll();
    for (const a of all) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        const kind: ActivityKind = a.source === 'correlation' ? 'correlate' : 'new';
        append({ t: Date.now(), kind, alertId: a.id, source: a.source, severity: a.severity, title: a.title });
      }
      if (a.acknowledged && !ackedSeen.has(a.id)) {
        ackedSeen.add(a.id);
        append({ t: Date.now(), kind: 'ack', alertId: a.id, source: a.source, severity: a.severity, title: a.title });
      }
      const isSnoozed = typeof a.snoozedUntil === 'number' && a.snoozedUntil > Date.now();
      if (isSnoozed && !snoozedSeen.has(a.id)) {
        snoozedSeen.add(a.id);
        append({ t: Date.now(), kind: 'snooze', alertId: a.id, source: a.source, severity: a.severity, title: a.title });
      }
    }
  });
}
