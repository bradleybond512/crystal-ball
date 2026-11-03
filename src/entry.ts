import { getGhostModeState } from './services/mode-manager';

interface BootNotice {
  showStartupFailure(): void;
}

async function loadBootNotice(): Promise<BootNotice | undefined> {
  try {
    const [{ mountGhostBootNotice }] = await Promise.all([
      import('./bootstrap/ghost-mode-notice'),
      import('./bootstrap/ghost-mode-notice.css'),
    ]);
    return mountGhostBootNotice();
  } catch (error) {
    globalThis.reportError?.(error);
  }
}

async function startMain(notice?: BootNotice): Promise<void> {
  try {
    const { appStartup } = await import('./main');
    if (notice) void appStartup.catch(() => notice.showStartupFailure());
  } catch (error) {
    notice?.showStartupFailure();
    throw error;
  }
}

// Keeping the entry module synchronous lets the bundler reuse shared chunks
// without generating a separate forwarding module for every lazy import.
function startApplication(): Promise<void> {
  if (getGhostModeState().preference === 'unknown') return loadBootNotice().then(startMain);
  return startMain();
}

export const entryStartup = startApplication();
