export interface DestroyablePanel {
  destroy(): void;
}

export function destroyUniquePanels(
  panels: Iterable<DestroyablePanel | null | undefined>,
): void {
  for (const panel of new Set(panels)) {
    panel?.destroy();
  }
}
