import { tryInvokeTauri } from '@/services/tauri-bridge';

const CONNECTED_KEY = 'wm-youtube-connected';

export function isYouTubeConnected(): boolean {
  return localStorage.getItem(CONNECTED_KEY) === 'true';
}

export function setYouTubeConnected(val: boolean): void {
  localStorage.setItem(CONNECTED_KEY, String(val));
}

export function signInToYouTube(): void {
  void tryInvokeTauri('open_youtube_login');
}

export function signOutOfYouTube(): void {
  void tryInvokeTauri('open_youtube_logout');
}

/**
 * Wire up YouTube sign-in/sign-out events. Call once at app startup or
 * when the settings UI mounts. `onUpdate` is called whenever connection
 * state changes so the UI can re-render.
 */
export function initYouTubeAccountListeners(onUpdate: () => void): void {
  document.addEventListener('wm:youtube-signed-in', () => {
 setYouTubeConnected(true);
 onUpdate();
  });
  document.addEventListener('wm:youtube-signed-out', () => {
 setYouTubeConnected(false);
 onUpdate();
  });
}
