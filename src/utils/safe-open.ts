import { invokeTauri } from '@/services/tauri-bridge';
import { isDesktopRuntime } from '@/services/runtime';

/**
 * Open an external URL safely.
 *
 * Validates the URL before opening: only `https:` scheme is accepted.
 * On desktop, routes through Tauri's `open_url` command (which also enforces
 * HTTPS and blocks private IPs in Rust). On web, falls back to window.open
 * with noopener,noreferrer.
 *
 * No fallback to window.open when Tauri rejects the URL — fail closed.
 */
export function openExternalSafe(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // eslint-disable-next-line no-console -- security diagnostic
    console.warn('[safe-open] Rejected malformed URL:', url);
    return;
  }

  if (parsed.protocol !== 'https:') {
    // eslint-disable-next-line no-console -- security diagnostic
    console.warn('[safe-open] Rejected non-HTTPS URL:', url);
    return;
  }

  if (isDesktopRuntime()) {
    void invokeTauri<void>('open_url', { url }).catch((error: unknown) => {
      // eslint-disable-next-line no-console -- security diagnostic
      console.warn('[safe-open] Tauri open_url failed', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
