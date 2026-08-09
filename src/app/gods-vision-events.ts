export function bindGodsVisionControls(
  document: Document,
  toggle: () => void,
): () => void {
  const onToggle = (): void => {
    toggle();
  };
  const onButtonClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (target?.closest?.('#godsVisionBtn')) {
      const ToggleEvent = document.defaultView?.CustomEvent ?? CustomEvent;
      document.dispatchEvent(new ToggleEvent('cb:toggle-gods-vision'));
    }
  };

  document.addEventListener('cb:toggle-gods-vision', onToggle);
  document.addEventListener('click', onButtonClick);

  return () => {
    document.removeEventListener('cb:toggle-gods-vision', onToggle);
    document.removeEventListener('click', onButtonClick);
  };
}
