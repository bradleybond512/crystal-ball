/**
 * Lightweight DOM + fetch setup for the panel smoke harness.
 *
 * Runs once at import time. Installs:
 *   - happy-dom Window/Document/Element on globalThis
 *   - localStorage / sessionStorage shims on the happy-dom window
 *   - a deterministic fetch() mock that replies with empty fixtures for
 *     every /api/* route the renderer calls
 *   - a no-op IntersectionObserver / ResizeObserver / matchMedia
 *
 * Pure side-effects — no exports needed for consumers; just `await import('./setup-dom.mts')`.
 *
 * The setup intentionally stays minimal. Panels that need richer fixtures
 * call `installFixture(panelId, body)` from `./fixture-store.mts` before
 * the harness mounts them.
 */

import { Window } from 'happy-dom';

import { getFixture } from './fixture-store.mts';

// Mounted panels schedule async fire-and-forget refreshes that reject after
// the harness has already classified the panel. Capture those globally so
// they don't propagate to node:test's runner and make the npm script exit
// non-zero. The summary test logs the count separately.
export const POST_MOUNT_ERRORS: string[] = [];
process.on('unhandledRejection', (reason) => {
  POST_MOUNT_ERRORS.push(reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason));
});
process.on('uncaughtException', (err) => {
  POST_MOUNT_ERRORS.push(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
});

const happyWindow = new Window({ url: 'http://127.0.0.1:46123/' });

const G = globalThis as unknown as Record<string, unknown>;

// Mirror the happy-dom window onto globalThis so `import` time module-level
// code that references `window` / `document` directly (e.g. Panel.ts) works.
G.window = happyWindow;
G.document = happyWindow.document;
G.HTMLElement = happyWindow.HTMLElement;
G.HTMLDivElement = happyWindow.HTMLDivElement;
G.HTMLButtonElement = happyWindow.HTMLButtonElement;
G.Element = happyWindow.Element;
G.Node = happyWindow.Node;
G.Event = happyWindow.Event;
G.CustomEvent = happyWindow.CustomEvent;
G.DOMException = happyWindow.DOMException;
G.MutationObserver = happyWindow.MutationObserver;
G.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
G.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as NodeJS.Timeout);
G.localStorage = happyWindow.localStorage;
G.sessionStorage = happyWindow.sessionStorage;
// `location` and `navigator` may be read-only on globalThis in newer Node —
// use defineProperty so we still get happy-dom's implementations exposed.
function safeAssign(key: string, value: unknown): void {
  try {
    G[key] = value;
  } catch {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
}
safeAssign('location', happyWindow.location);
safeAssign('navigator', happyWindow.navigator);
// happy-dom exposes window.getComputedStyle but doesn't mirror it onto
// global; mirror it so panels that call the bare global don't crash.
G.getComputedStyle = happyWindow.getComputedStyle?.bind(happyWindow) ?? (() => ({
  getPropertyValue: () => '',
  display: '',
  visibility: '',
}));
G.matchMedia = happyWindow.matchMedia ?? (() => ({
  matches: false,
  media: '',
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  onchange: null,
  dispatchEvent: () => false,
}));

// happy-dom's IntersectionObserver/ResizeObserver are sometimes missing on older
// builds — install no-op shims if needed.
if (typeof G.IntersectionObserver !== 'function') {
  G.IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] { return []; }
  };
}
if (typeof G.ResizeObserver !== 'function') {
  G.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// PostHog reads navigator.userAgent — happy-dom usually provides one.
// Suppress analytics so import-time effects don't reach out to the network.
G.__POSTHOG_DISABLED = true;

// `import.meta.env` shim. The loader rewrites source references to
// `(globalThis.__viteImportMetaEnv||{})`; this is its backing store.
G.__viteImportMetaEnv = {
  DEV: false,
  PROD: false,
  MODE: 'test',
  BASE_URL: '/',
  VITE_VARIANT: 'full',
};

// ── Fetch mock ──────────────────────────────────────────────────────────────
// All harness fetches resolve from the in-memory fixture store. Unmatched
// routes return an empty 200 JSON so panels can render an "empty" path
// rather than throwing on a missing network.
type RecordedCall = { url: string; method: string };
const fetchCalls: RecordedCall[] = [];

function asUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof (input as { url?: unknown }).url === 'string') {
    return (input as { url: string }).url;
  }
  return String(input);
}

G.fetch = (input: unknown, init?: { method?: string; signal?: AbortSignal }): Promise<Response> => {
  const url = asUrl(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  fetchCalls.push({ url, method });

  // Honor abort for parity with real fetch
  if (init?.signal?.aborted) {
    return Promise.reject(new (G.DOMException as new (m: string, n: string) => Error)('Aborted', 'AbortError'));
  }

  const fixture = getFixture(url, method);
  const body = fixture?.body ?? { ok: true, items: [], data: [] };
  const status = fixture?.status ?? 200;
  const headers = new (happyWindow.Headers as unknown as new (init?: Record<string, string>) => Headers)({
    'content-type': 'application/json',
  });
  const response = new (happyWindow.Response as unknown as new (b: string, init: { status: number; headers: Headers }) => Response)(
    JSON.stringify(body),
    { status, headers },
  );
  return Promise.resolve(response);
};

export function getFetchCalls(): readonly RecordedCall[] {
  return fetchCalls;
}

export function clearFetchCalls(): void {
  fetchCalls.length = 0;
}

export { happyWindow };
