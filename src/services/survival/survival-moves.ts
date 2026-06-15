// src/services/survival/survival-moves.ts
import type { PostureDelta, SurvivalMove, SurvivalPosture, WorldSnapshot } from './survival-types.ts';
import type { MoveProvider } from './move-provider.ts';
import { makeWeatherMoveProvider } from './weather-move-provider.ts';
import { makeSupplyMoveProvider } from './supply-move-provider.ts';



export interface MovesOptions {
  now?: number;
  maxMoves?: number;
}

export function availableMovesFrom(
  providers: readonly MoveProvider[],
  posture: SurvivalPosture,
  now: number,
): SurvivalMove[] {
  return providers.flatMap((p) => p.provide(posture, now));
}

export function availableMoves(
  posture: SurvivalPosture,
  _snapshot: WorldSnapshot,
  options: MovesOptions = {},
): SurvivalMove[] {
  return availableMovesFrom(
    [makeWeatherMoveProvider({ maxMoves: options.maxMoves }), makeSupplyMoveProvider()],
    posture,
    options.now ?? Date.now(),
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function projectMoveEffect(move: SurvivalMove, _posture: SurvivalPosture): PostureDelta[] {
  return move.effect;
}

export {type MoveProvider} from './move-provider.ts';