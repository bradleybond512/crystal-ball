/**
 * Stub for Vite asset / worker imports (e.g. `?worker`, `?url`, `?raw`).
 * Returns a no-op default plus common worker constructors so panel
 * components can `new MyWorker()` without throwing. The harness never
 * exercises the worker code path itself.
 */

class StubWorker {
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
  onmessage = null;
  onerror = null;
}

export default StubWorker;
export const url = '';
export const raw = '';
