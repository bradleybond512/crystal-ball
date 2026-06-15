// src/services/survival/move-provider.ts
import type { SurvivalMove, SurvivalPosture } from './survival-types.ts';

/** A pluggable source of survival moves. Each provider proposes moves for the
 *  current posture (typically for the threats on its own axis), so a new domain
 *  plugs in its playbook without changing the move engine. Pure: no fetch/DOM. */
export interface MoveProvider {
  /** Stable id, e.g. 'weather', 'supply'. */
  id: string;
  provide(posture: SurvivalPosture, now: number): SurvivalMove[];
}
