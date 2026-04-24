import { tryInvokeTauri } from '@/services/tauri-bridge';
import { isDesktopRuntime } from '@/services/runtime';

const CONNECTED_KEY = 'wm-youtube-connected';

export function isYouTubeConnected(): boolean {
  // In a regular browser the user is already authenticated to YouTube via
  // their cookie jar, so the in-app "connected" flag is always true in web.
  if (!isDesktopRuntime()) return true;
  return localStorage.getItem(CONNECTED_KEY) === 'true';
}

export function setYouTubeConnected(val: boolean): void {
  localStorage.setItem(CONNECTED_KEY, String(val));
}

export function signInToYouTube(): void {
  if (!isDesktopRuntime()) {
 // Web: YouTube auth is cookie-based in the browser; opening youtube.com
 // in a new tab lets the user sign in there if they aren't already.
 window.open('https://www.youtube.com/', '_blank', 'noopener');
 return;
  }
  void tryInvokeTauri('open_youtube_login');
}

export function signOutOfYouTube(): void {
  if (!isDesktopRuntime()) {
 window.open('https://www.youtube.com/logout', '_blank', 'noopener');
 return;
  }
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
