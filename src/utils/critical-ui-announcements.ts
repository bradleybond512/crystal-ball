import { isGhostMode } from '@/services/mode-manager';

const MODE_KEY = 'wm-app-mode';

export function criticalAnnouncementsSuppressed(): boolean {
  if (document.hidden || isGhostMode()) return true;
  try {
    return localStorage.getItem(MODE_KEY) === 'ghost';
  } catch {
    return true;
  }
}

export function watchCriticalAnnouncementSuppression(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === null || event.key === MODE_KEY) onChange();
  };
  document.addEventListener('visibilitychange', onChange);
  document.addEventListener('wm:mode-changed', onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    document.removeEventListener('visibilitychange', onChange);
    document.removeEventListener('wm:mode-changed', onChange);
    window.removeEventListener('storage', onStorage);
  };
}
