/**
 * KeychainService — frontend cache in front of the Tauri `get_secret` IPC.
 *
 * `loadDesktopSecrets` is invoked at boot, when the settings window opens,
 * and on every `storage` cross-window sync event. Without memoization, each
 * pass reissues `get_secret` for every supported key, and any IPC round-trip
 * that races a keychain ACL refresh can surface a fresh permission prompt.
 *
 * The service guarantees one IPC call per key for the lifetime of the
 * renderer: cache hits return synchronously, in-flight requests dedupe, and
 * writes (`set` / `remove`) update the cache in place.
 */
import { invokeTauri, hasTauriInvokeBridge } from '@/services/tauri-bridge';

class KeychainService {
  private cache = new Map<string, string | null>();
  private inflight = new Map<string, Promise<string | null>>();
  private supportedKeys: Promise<string[]> | null = null;

  async listSupportedKeys(): Promise<string[]> {
    if (!hasTauriInvokeBridge()) return [];
    this.supportedKeys ??= invokeTauri<string[]>('list_supported_secret_keys').catch((error) => {
      this.supportedKeys = null;
      throw error;
    });
    return this.supportedKeys;
  }

  /**
   * Resolve once the native keychain load has finished. Secrets load
   * asynchronously after boot (so a slow Touch ID never freezes the window),
   * which means an early `get` would memoize a null for every key for the whole
   * renderer lifetime. Boot-time loaders await this first. Desktop only — web
   * has no native cache, so it resolves immediately.
   *
   * The cap exceeds the Rust read's own worst-case bound — 120s for the
   * consolidated vault plus, on a one-time migration from the legacy per-key
   * format, up to 77 × 3s of per-key ACL timeouts (~351s). The Rust side always
   * resolves within that bound (each read uses recv_timeout, orphaning a hung
   * thread), so `secrets_ready` flips before this deadline in correct operation
   * — the cap is only a backstop, never the thing that ends the wait, so we
   * never proceed against a still-empty cache and memoize nulls.
   */
  async waitUntilLoaded(capMs = 400_000, stepMs = 250): Promise<void> {
    if (!hasTauriInvokeBridge()) return;
    const deadline = Date.now() + capMs;
    for (;;) {
      let ready = false;
      try {
        ready = (await invokeTauri<boolean>('secrets_ready')) === true;
      } catch {
        // Command unavailable (older shell) or transient bridge error — stop
        // waiting rather than spin; the caller proceeds optimistically.
        return;
      }
      if (ready || Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, stepMs));
    }
  }

  async get(key: string): Promise<string | null> {
    if (!hasTauriInvokeBridge()) return null;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const pending = invokeTauri<string | null>('get_secret', { key })
      .then((value) => {
        this.cache.set(key, value);
        this.inflight.delete(key);
        return value;
      })
      .catch((error) => {
        this.inflight.delete(key);
        throw error;
      });

    this.inflight.set(key, pending);
    return pending;
  }

  async set(key: string, value: string): Promise<void> {
    await invokeTauri<void>('set_secret', { key, value });
    const trimmed = value.trim();
    this.cache.set(key, trimmed.length === 0 ? null : trimmed);
  }

  async remove(key: string): Promise<void> {
    await invokeTauri<void>('delete_secret', { key });
    this.cache.set(key, null);
  }

  /** Drop a single cached entry; the next `get` reissues the IPC call. */
  invalidate(key: string): void {
    this.cache.delete(key);
    this.inflight.delete(key);
  }

  /** Drop every cached entry. Use sparingly — defeats the whole point. */
  invalidateAll(): void {
    this.cache.clear();
    this.inflight.clear();
    this.supportedKeys = null;
  }
}

export const keychainService = new KeychainService();
