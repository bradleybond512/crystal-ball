type TauriInvoke = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;

function resolveInvokeBridge(): TauriInvoke | null {
  if (typeof window === 'undefined') {
 return null;
  }

  const tauriWindow = window as unknown as {
 __TAURI__?: { core?: { invoke?: TauriInvoke } };
 __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };

  const invoke =
 tauriWindow.__TAURI__?.core?.invoke ??
 tauriWindow.__TAURI_INTERNALS__?.invoke;

  return typeof invoke === 'function' ? invoke : null;
}

export function hasTauriInvokeBridge(): boolean {
  return resolveInvokeBridge() !== null;
}

export async function invokeTauri<T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const invoke = resolveInvokeBridge();
  if (!invoke) {
 throw new Error('Tauri invoke bridge unavailable');
  }

  return invoke<T>(command, payload);
}

// Commands that legitimately fail for the first few seconds of boot while the
// Rust side spawns the sidecar and assigns its port/token. Callers poll these
// and handle a null result, so logging each failure as an error is misleading
// noise — a stalled sidecar is caught separately by the heartbeat watchdog.
const TRANSIENT_BOOT_COMMANDS = new Set(['get_local_api_port', 'get_local_api_token']);

export async function tryInvokeTauri<T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T | null> {
  try {
 return await invokeTauri<T>(command, payload);
  } catch (error) {
 if (!TRANSIENT_BOOT_COMMANDS.has(command)) {
 	// eslint-disable-next-line no-console -- bridged to the desktop log
 	console.warn(`[tauri-bridge] Command failed: ${command}`, error);
 }
 return null;
  }
}
