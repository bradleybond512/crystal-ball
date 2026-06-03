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

// During the first seconds of boot the renderer polls get_local_api_port /
// get_local_api_token before the Rust side has spawned the sidecar and assigned
// them. Those specific "not ready yet" failures are expected — callers poll and
// handle the null result, and a genuinely stalled sidecar is caught by the
// heartbeat watchdog. Match the message narrowly so a real failure of these
// commands (anything other than the handshake-not-ready states) still logs.
const TRANSIENT_BOOT_COMMANDS = new Set(['get_local_api_port', 'get_local_api_token']);
const TRANSIENT_BOOT_REASONS = /not yet assigned|not generated|bridge unavailable/i;

function isExpectedBootFailure(command: string, error: unknown): boolean {
  if (!TRANSIENT_BOOT_COMMANDS.has(command)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_BOOT_REASONS.test(message);
}

export async function tryInvokeTauri<T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T | null> {
  try {
 return await invokeTauri<T>(command, payload);
  } catch (error) {
 if (!isExpectedBootFailure(command, error)) {
   // eslint-disable-next-line no-console -- bridged to the desktop log
   console.warn(`[tauri-bridge] Command failed: ${command}`, error);
 }
 return null;
  }
}
