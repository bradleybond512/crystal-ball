interface Workspace {
  init(): Promise<void>;
  openWorkspace(): void;
  destroy(): void;
}

export async function startWorkspace(
  app: Workspace,
  showIntro?: (ready: Promise<void>) => Promise<boolean>,
): Promise<boolean> {
  let opened = false;
  try {
    const ready = app.init();
    // Observe early rejection even while the intro module is loading. Preserve
    // the original failure for the startup recovery UI after the intro exits.
    const outcome = ready.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
    if (showIntro && !await showIntro(ready)) return false;
    const result = await outcome;
    if (!result.ok) throw result.error;
    app.openWorkspace();
    opened = true;
    return true;
  } finally {
    if (!opened) {
      try { app.destroy(); }
      catch (error) { globalThis.reportError?.(error); }
    }
  }
}

export function showWorkspaceStartupFailure(doc: Document, reload: () => void): void {
  if (doc.getElementById('workspace-startup-failure')) return;
  const notice = doc.createElement('section');
  notice.id = 'workspace-startup-failure';
  Object.assign(notice.style, {
    position: 'fixed', insetInline: '1rem', bottom: '1rem', margin: 'auto',
    width: 'fit-content', maxWidth: 'calc(100% - 2rem)', boxSizing: 'border-box',
    zIndex: '10001', padding: '1rem', background: 'var(--surface, Canvas)',
    color: 'var(--text, CanvasText)', border: '1px solid currentColor', borderRadius: '0.5rem',
  });
  const message = doc.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = 'Crystal Ball could not open this workspace.';
  const retry = doc.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Reload workspace';
  retry.addEventListener('click', reload);
  notice.append(message, retry);
  doc.body.append(notice);
  if (doc.activeElement === doc.body) retry.focus();
}
