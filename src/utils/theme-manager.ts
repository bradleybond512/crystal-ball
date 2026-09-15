import { invalidateColorCache } from './theme-colors';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'crystalball-theme';
const DEFAULT_THEME: Theme = 'dark';
let sessionChoice: Theme | null = null;
let watchingSystemTheme = false;

const THEME_META_COLORS: Record<Theme, Record<'happy' | 'default', string>> = {
  dark:  { happy: '#1A2332', default: '#0a0f0a' },
  light: { happy: '#FAFAF5', default: '#f8f9fa' },
};

/**
 * Read the stored theme preference from localStorage.
 * Returns 'dark' or 'light' if valid, otherwise DEFAULT_THEME.
 */
export function getStoredTheme(): Theme {
  try {
 const stored = localStorage.getItem(STORAGE_KEY);
 if (stored === 'dark' || stored === 'light') return stored;
  } catch {
 // localStorage unavailable (e.g., sandboxed iframe, private browsing)
  }
  return DEFAULT_THEME;
}

/**
 * Read the current theme from the document root's data-theme attribute.
 */
export function getCurrentTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  if (value === 'dark' || value === 'light') return value;
  return DEFAULT_THEME;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  invalidateColorCache();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    const variant = document.documentElement.dataset.variant;
    meta.content = THEME_META_COLORS[theme][variant === 'happy' ? 'happy' : 'default'];
  }
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
}

/** Apply and persist an explicit choice, retaining it if storage is unavailable. */
export function setTheme(theme: Theme): void {
  sessionChoice = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The session choice remains authoritative when persistence fails.
  }
  applyTheme(theme);
}

/**
 * Apply the stored theme preference to the document before components mount.
 * Only sets the data-theme attribute and meta theme-color — does NOT dispatch
 * events or invalidate the color cache (components aren't mounted yet).
 *
 * The inline script in index.html already handles the fast FOUC-free path.
 * This is a safety net for cases where the inline script didn't run.
 */
export function applyStoredTheme(): void {
  const variant = document.documentElement.dataset.variant;

  // Check raw localStorage to distinguish "no preference" from "explicitly chose dark"
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* noop */ }
  const hasExplicitPreference = raw === 'dark' || raw === 'light';

  let effective: Theme;
  if (sessionChoice) {
    effective = sessionChoice;
  } else if (hasExplicitPreference) {
 // User made an explicit choice — respect it regardless of variant
 effective = raw as Theme;
 sessionChoice = effective;
  } else if (variant === 'happy') {
 // happy variant defaults to light
 effective = 'light';
  } else {
 // No stored preference: follow the OS dark/light setting
 const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
 effective = prefersDark ? 'dark' : 'light';
  }

  document.documentElement.dataset.theme = effective;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
 meta.content = THEME_META_COLORS[effective][variant === 'happy' ? 'happy' : 'default'];
  }
}

/**
 * Watch for OS-level dark/light mode changes and sync the app theme
 * when the user has no explicit stored preference.
 * Call once after applyStoredTheme() during app bootstrap.
 */
export function watchSystemTheme(): void {
  if (watchingSystemTheme) return;
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq || typeof mq.addEventListener !== 'function') return;
  watchingSystemTheme = true;

  mq.addEventListener('change', (e) => {
 let raw: string | null = null;
 try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* noop */ }
 const hasExplicitPreference = raw === 'dark' || raw === 'light';
 const variant = document.documentElement.dataset.variant;

 // Only follow OS if no explicit user preference and not the happy variant
 if (!sessionChoice && !hasExplicitPreference && variant !== 'happy') {
 applyTheme(e.matches ? 'dark' : 'light');
 }
  });
}
