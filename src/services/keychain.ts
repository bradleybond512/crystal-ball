/**
 * KeychainService — the renderer's view of the native secret vault.
 *
 * R4-SEC-001: a webview may WRITE any supported secret (`set` / `remove`), but
 * it reads back only presence for every key (`get_secret_status`) and values
 * for the small renderer-readable allowlist (`get_renderer_config`: plaintext
 * settings and the map/tile keys that end up in client-side URLs anyway).
 * Sidecar-only values never enter this process; native pushes them to the
 * sidecar itself. Both reads come from the native in-memory cache, never the
 * Keychain, so they cannot raise an ACL prompt and need no memoization.
 */
import { invokeTauri, hasTauriInvokeBridge } from '@/services/tauri-bridge';

export interface SecretStatusRow {
  key: string;
  present: boolean;
}

class KeychainService {
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

/** Which supported keys are set. Never carries a value. */
  async status(): Promise<Map<string, boolean>> {
    if (!hasTauriInvokeBridge()) return new Map();
    const rows = await invokeTauri<unknown>('get_secret_status');
    const present = new Map<string, boolean>();
    for (const row of Array.isArray(rows) ? rows : []) {
      const candidate = row as Partial<SecretStatusRow> | null;
      if (candidate && typeof candidate.key === 'string') present.set(candidate.key, candidate.present === true);
    }
    return present;
  }

  /** Values for the renderer-readable allowlist only (native enforces it). */
  async rendererConfig(): Promise<Record<string, string>> {
    if (!hasTauriInvokeBridge()) return {};
    const config = await invokeTauri<unknown>('get_renderer_config');
    const values: Record<string, string> = {};
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
        if (typeof value === 'string') values[key] = value;
      }
    }
    return values;
  }

  async set(key: string, value: string): Promise<void> {
    await invokeTauri<void>('set_secret', { key, value });
  }

  async remove(key: string): Promise<void> {
    await invokeTauri<void>('delete_secret', { key });
  }

  /** Forget the memoized supported-key list (e.g. after another window wrote). */
  invalidateAll(): void {
    this.supportedKeys = null;
  }
}

export const keychainService = new KeychainService();
