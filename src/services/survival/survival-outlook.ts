/**
 * Survival Outlook — pure orchestrator that runs the derivable survival cores
 * from a live `WorldSnapshot` + posture + candidate moves and maps each result
 * through its board view-model.
 *
 * This is the single seam a renderer needs: give it the same inputs the Storm
 * Posture panel already has on hand (snapshot, projected posture, available
 * moves) and it returns the six forward/offline boards plus the retrospective.
 * No DOM, no fetch, no globals, no clock — every core is deterministic and the
 * only ambient input (`now`) is threaded through explicitly.
 *
 * The current-posture board is intentionally NOT produced here: the panel
 * already renders live posture at the top, and posture is consumed internally
 * only as the trajectory's starting point. Retrospective is fed empty
 * calibration histories by default (no live calibration store exists yet) — it
 * renders its honest empty state until one is wired.
 */

import type {
  SurvivalMove,
  SurvivalPosture,
  WorldSnapshot,
} from './survival-types.ts';
import type { MoveEffectCalibration } from './posture-calibration.ts';
import type { ProjectionCalibration } from './projection-calibration.ts';

import { projectPostureTrajectory } from './posture-trajectory.ts';
import { buildWorldBranches } from './world-branches.ts';
import { evaluateDecisionConsequences } from './decision-consequence.ts';
import { certifyGridDown } from './grid-down-certify.ts';
import { resolveOfflinePlaybook } from './offline-playbook.ts';
import { resolveCommsFallback } from './comms-fallback.ts';
import { buildRetrospectiveDigest } from './retrospective-digest.ts';

import {
  buildPostureTrajectoryBoardView,
  type PostureTrajectoryBoardView,
} from './posture-trajectory-view.ts';
import {
  buildWorldBranchesBoardView,
  type WorldBranchesBoardView,
} from './world-branches-view.ts';
import {
  buildDecisionBoardView,
  type DecisionBoardView,
} from './decision-consequence-view.ts';
import {
  buildGridDownBoardView,
  type GridDownBoardView,
} from './grid-down-certify-view.ts';
import {
  buildOfflinePlaybookBoardView,
  type OfflinePlaybookBoardView,
} from './offline-playbook-view.ts';
import {
  buildCommsFallbackBoardView,
  type CommsFallbackBoardView,
} from './comms-fallback-view.ts';
import {
  buildRetrospectiveBoardView,
  type RetrospectiveBoardView,
} from './retrospective-view.ts';

export interface SurvivalOutlookInputs {
  /** Wall-clock reference (ms). Threaded through so callers stay deterministic. */
  now?: number;
  /** Move-effect calibration history (delivered vs modeled). Empty by default. */
  moveCalibrations?: readonly MoveEffectCalibration[];
  /** Projection calibration history (reached vs projected). Empty by default. */
  projectionCalibrations?: readonly ProjectionCalibration[];
}

/** The board view-models a renderer maps over, in display order. */
export interface SurvivalOutlook {
  trajectory: PostureTrajectoryBoardView;
  branches: WorldBranchesBoardView;
  decision: DecisionBoardView;
  gridDown: GridDownBoardView;
  offline: OfflinePlaybookBoardView;
  comms: CommsFallbackBoardView;
  retrospective: RetrospectiveBoardView;
}

/**
 * Run the seven derivable survival cores and surface each as a board view.
 * `posture` is the starting posture (the panel's projected/aged posture) and
 * feeds the trajectory; `moves` are the candidate moves the decision board
 * scores against the branch set.
 */
export function buildSurvivalOutlook(
  snapshot: WorldSnapshot,
  posture: SurvivalPosture,
  moves: readonly SurvivalMove[],
  inputs: SurvivalOutlookInputs = {},
): SurvivalOutlook {
  const now = inputs.now;
  const moveCalibrations = inputs.moveCalibrations ?? [];
  const projectionCalibrations = inputs.projectionCalibrations ?? [];

  const trajectory = projectPostureTrajectory(posture);
  const branches = buildWorldBranches(trajectory);
  const decision = evaluateDecisionConsequences(branches, moves);
  const gridDown = certifyGridDown(snapshot, now === undefined ? {} : { now });
  const offline = resolveOfflinePlaybook(snapshot);
  const comms = resolveCommsFallback(snapshot);
  const retrospective = buildRetrospectiveDigest(
    [...moveCalibrations],
    [...projectionCalibrations],
  );

  return {
    trajectory: buildPostureTrajectoryBoardView(trajectory),
    branches: buildWorldBranchesBoardView(branches),
    decision: buildDecisionBoardView(decision),
    gridDown: buildGridDownBoardView(gridDown),
    offline: buildOfflinePlaybookBoardView(offline),
    comms: buildCommsFallbackBoardView(comms),
    retrospective: buildRetrospectiveBoardView(retrospective),
  };
}
