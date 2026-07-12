/**
 * Status ribbon view-model — one-line system health for the home
 * shell footer. Pure; `now` caller-supplied.
 */

import { formatAge } from './deck-view.ts';

export type RibbonTone = 'ok' | 'warn' | 'bad';

export interface StatusRibbonInputs {
  /** SystemHealthReport.status */
  systemStatus: string;
  /** SystemHealthReport.summary */
  summary: string;
  lastSweepAt?: number;
}

export interface StatusRibbonView {
  tone: RibbonTone;
  text: string;
}

const BAD_STATUSES = new Set(['failing', 'blind', 'unsafe']);

function ribbonTone(status: string): RibbonTone {
  if (status === 'healthy') return 'ok';
  if (BAD_STATUSES.has(status)) return 'bad';
  return 'warn';
}

export function buildStatusRibbon(inputs: StatusRibbonInputs, now: number): StatusRibbonView {
  const tone = ribbonTone(inputs.systemStatus);
  const sweep = inputs.lastSweepAt === undefined ? '' : ` · updated ${formatAge(now - inputs.lastSweepAt)} ago`;
  return { tone, text: `${inputs.summary}${sweep}` };
}
