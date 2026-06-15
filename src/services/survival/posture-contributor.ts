// src/services/survival/posture-contributor.ts
import type { PostureThreat } from './survival-types.ts';

/** A pluggable source of posture threats. Each contributor returns threats
 *  already tagged with their SurvivalAxis, so a new domain plugs into the
 *  posture engine without changing it. Pure: no fetch/DOM. */
export interface PostureContributor {
  /** Stable id, e.g. 'weather', 'shortage'. */
  id: string;
  contribute(now: number): PostureThreat[];
}
