// Frontend → desktop log bridge.
// Forwards renderer-side errors and lifecycle events to the Rust side so
// they land in ~/Library/Logs/com.bradleybond.crystalball/desktop.log
// instead of dying in WebInspector.
import { invokeTauri } from '@/services/tauri-bridge';

let installed = false;

const noop = (): void => { /* deliberately empty */ };

function fmtArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message;
  if (a !== null && typeof a === 'object') {
 try { return JSON.stringify(a).slice(0, 500); } catch { return '[object]'; }
  }
  if (typeof a === 'symbol') return a.toString();
  return String(a as string | number | boolean | bigint | null | undefined);
}

export function logToDesktop(
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG',
  message: string,
  context?: Record<string, unknown>,
): void {
  const ctx = context ? JSON.stringify(context).slice(0, 500) : undefined;
  void invokeTauri<void>('log_frontend', {
 level,
 message: message.slice(0, 1000),
 context: ctx,
  }).catch(noop);
}

export function installLogBridge(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (e) => {
 const err = e.error as Error | undefined;
 logToDesktop('ERROR', `window.onerror: ${e.message}`, {
 filename: e.filename,
 line: e.lineno,
 col: e.colno,
 stack: err?.stack?.slice(0, 800),
 });
  });

  window.addEventListener('unhandledrejection', (e) => {
 const reason: unknown = e.reason;
 const msg = reason instanceof Error ? reason.message : String(reason);
 logToDesktop('ERROR', `unhandledrejection: ${msg}`, {
 stack: reason instanceof Error ? reason.stack?.slice(0, 800) : undefined,
 });
  });

  // eslint-disable-next-line no-console
  const origError = console.error.bind(console);
  // eslint-disable-next-line no-console
  const origWarn = console.warn.bind(console);

  // eslint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
 origError(...args);
 try {
 logToDesktop('ERROR', `console.error: ${args.map(a => fmtArg(a)).join(' ').slice(0, 1000)}`);
 } catch { /* safe */ }
  };
  // eslint-disable-next-line no-console
  console.warn = (...args: unknown[]) => {
 origWarn(...args);
 try {
 logToDesktop('WARN', `console.warn: ${args.map(a => fmtArg(a)).join(' ').slice(0, 1000)}`);
 } catch { /* safe */ }
  };

  // Cmd+Shift+D — copy diagnostics bundle to clipboard
  document.addEventListener('keydown', (e) => {
 if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
 e.preventDefault();
 void copyDiagnostics();
 }
  });

  logToDesktop('INFO', 'log-bridge installed');
}

async function copyDiagnostics(): Promise<void> {
  try {
 const bundle = await invokeTauri<string>('copy_diagnostics', {});
 if (bundle) {
 await navigator.clipboard.writeText(bundle);
 showToast('Diagnostics copied to clipboard');
 logToDesktop('INFO', 'diagnostics bundle copied via Cmd+Shift+D');
 }
  } catch (error) {
 const msg = error instanceof Error ? error.message : String(error);
 showToast(`Diagnostics copy failed: ${msg}`);
  }
}

function showToast(message: string): void {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:8px 14px;border-radius:6px;font:12px -apple-system,sans-serif;z-index:99999;pointer-events:none;';
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}
