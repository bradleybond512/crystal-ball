import { getGhostModeState } from './services/mode-manager';

let notice: { showStartupFailure(): void } | undefined;
if (getGhostModeState().preference === 'unknown') {
  try {
    const [{ mountGhostBootNotice }] = await Promise.all([
      import('./bootstrap/ghost-mode-notice'),
      import('./bootstrap/ghost-mode-notice.css'),
    ]);
    notice = mountGhostBootNotice();
  } catch (error) {
    globalThis.reportError?.(error);
  }
}

function watchStartup(startup: Promise<void>, fallback: { showStartupFailure(): void }): void {
  void startup.catch(() => fallback.showStartupFailure());
}

try {
  const { appStartup } = await import('./main');
  if (notice) watchStartup(appStartup, notice);
} catch (error) {
  notice?.showStartupFailure();
  throw error;
}
