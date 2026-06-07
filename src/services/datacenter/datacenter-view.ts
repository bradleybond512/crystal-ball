import type { DataCenterPosture, DcLevel } from './datacenter-types.ts';

const LEVEL_LABELS: Record<DcLevel, string> = {
  normal: 'All clear', watch: 'Watch', advisory: 'Advisory', warning: 'Warning', critical: 'Critical',
};
const LEVEL_COLORS: Record<DcLevel, string> = {
  normal: '#22c55e', watch: '#eab308', advisory: '#f59e0b', warning: '#f97316', critical: '#ef4444',
};

export function levelLabel(level: DcLevel): string {
  return LEVEL_LABELS[level];
}
export function levelColor(level: DcLevel): string {
  return LEVEL_COLORS[level];
}
export function levelDotClass(level: DcLevel): string {
  return `dc-dot dc-dot--${level}`;
}
export function actionsNowCount(posture: DataCenterPosture): number {
  return posture.actions.filter((a) => a.urgency === 'now').length;
}
export function stripSummary(posture: DataCenterPosture): string {
  const n = actionsNowCount(posture);
  const actionPart = n === 1 ? '1 action now' : `${n} actions now`;
  const base = `${posture.site.name} · ${levelLabel(posture.overall)} · ${posture.headline} · ${actionPart}`;
  // Never imply "all clear" when a feed is down: a missing grid/weather input
  // can read as `normal` purely because it's absent, so surface staleness on
  // the always-visible strip, not just the expanded panel footer.
  return posture.staleInputs.length > 0
    ? `${base} · ⚠ ${posture.staleInputs.join(', ')} stale`
    : base;
}
