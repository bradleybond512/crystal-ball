import type { SurvivalMove } from '@/services/survival/survival-types';

/** One explicit move action, owned by the surface containing its button. */
export function bindStormMoveActions(root: HTMLElement, actions: {
  resolveMove: (id: string) => SurvivalMove | undefined;
  commitMove: (move: SurvivalMove) => void;
}): () => void {
  const onClick = (event: Event): void => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>('[data-storm-move]');
    if (!button || !root.contains(button)) return;
    const id = button.dataset.stormMove;
    if (!id) return;
    const move = actions.resolveMove(id);
    if (move) actions.commitMove(move);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
