/**
 * Clean-room readiness checklist. Pure: done-state comes in as an id list;
 * persistence (localStorage `cb-smoke-checklist`) is the caller's concern
 * (smoke-state.ts) so this stays fixture-testable.
 */
import type { ChecklistItem, CleanRoomScore } from './smoke-types';

export const CLEAN_ROOM_ITEMS: Omit<ChecklistItem, 'done'>[] = [
  { id: 'hvac-recirculate', label: 'HVAC/AC set to recirculate', rationale: 'Stops pulling smoky outside air through the system.', weight: 3 },
  { id: 'filter-running', label: 'HEPA purifier or box-fan filter running', rationale: 'A HEPA or MERV-13 filter removes most PM2.5 indoors.', weight: 3 },
  { id: 'room-sealed', label: 'One room with windows/doors sealed', rationale: 'A designated clean room concentrates filtration where you sleep.', weight: 2 },
  { id: 'n95-on-hand', label: 'N95/KN95 masks on hand', rationale: 'For unavoidable trips outside during unhealthy air.', weight: 1 },
  { id: 'meds-stocked', label: 'Inhalers / heart-lung meds stocked', rationale: 'Smoke aggravates asthma and cardiovascular conditions.', weight: 1 },
];

const TOTAL_WEIGHT = CLEAN_ROOM_ITEMS.reduce((sum, i) => sum + i.weight, 0);

export function applyDoneState(doneIds: string[]): ChecklistItem[] {
  const done = new Set(doneIds);
  return CLEAN_ROOM_ITEMS.map((i) => ({ ...i, done: done.has(i.id) }));
}

export function scoreCleanRoom(doneIds: string[]): CleanRoomScore {
  const done = new Set(doneIds);
  const earned = CLEAN_ROOM_ITEMS.filter((i) => done.has(i.id)).reduce((s, i) => s + i.weight, 0);
  const score0to100 = Math.round((earned / TOTAL_WEIGHT) * 100);
  let tier: CleanRoomScore['tier'] = 'unprepared';
  if (score0to100 >= 80) tier = 'ready';
  else if (score0to100 >= 40) tier = 'partial';
  return { score0to100, tier };
}
