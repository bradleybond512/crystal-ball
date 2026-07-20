/**
 * Saved-place palette commands (⌘K v2). Pure builder + a small installer
 * that keeps the registry in sync with the saved-places store.
 */

import type { CommandRegistry, PaletteCommand } from './command-registry';

export interface PlaceLike {
  id: string;
  name: string;
  lat: number;
  lon: number;
  primary: boolean;
}

export type DispatchFn = (name: string, detail?: unknown) => void;

export function buildPlaceCommands(places: readonly PlaceLike[], dispatch: DispatchFn): PaletteCommand[] {
  return places.map((p) => ({
    id: `place:${p.id}`,
    title: `Go to ${p.name}`,
    subtitle: 'saved place',
    keywords: [p.name.toLowerCase(), 'place', 'saved', 'go to', 'fly'],
    category: 'navigation',
    icon: '📍',
    weight: p.primary ? 0.5 : 0,
    action: () => dispatch('cb:focus-place', { placeId: p.id, lat: p.lat, lon: p.lon }),
  }));
}

/**
 * Registers place commands now and re-syncs on every saved-places change.
 * Returns an uninstall thunk.
 */
export function installPlaceCommands(
  registry: CommandRegistry,
  deps: {
    getPlaces: () => readonly PlaceLike[];
    subscribe: (listener: () => void) => () => void;
    dispatch: DispatchFn;
  },
): () => void {
  let currentIds: string[] = [];
  const sync = (): void => {
    for (const id of currentIds) registry.unregister(id);
    const cmds = buildPlaceCommands(deps.getPlaces(), deps.dispatch);
    for (const c of cmds) registry.register(c);
    currentIds = cmds.map((c) => c.id);
  };
  sync();
  const unsubscribe = deps.subscribe(sync);
  return () => {
    unsubscribe();
    for (const id of currentIds) registry.unregister(id);
    currentIds = [];
  };
}
