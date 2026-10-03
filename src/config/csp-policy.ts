export function removeWebLoopbackCspSources(html: string): string {
  return html.replace(
    / http:\/\/(?:127\.0\.0\.1|localhost)(?::(?:3000|1420|5173|46123))?/g,
    '',
  );
}

/**
 * Sidecar ports the desktop webview may reach (R4-SEC-008 / R4-BUG-004): the
 * sidecar tries 46123 and then the next ten before an OS-assigned port, so
 * the CSP lists exactly this range — never a loopback wildcard, which would
 * expose every local service to the renderer. Mirrors tauri.conf.json and
 * sidecarCandidatePorts() (tests/csp-allowlist.test.mjs).
 */
export const SIDECAR_PORT_RANGE = Object.freeze({ first: 46_123, last: 46_133 });

export const SIDECAR_CSP_ORIGINS: readonly string[] = Object.freeze(
  Array.from(
    { length: SIDECAR_PORT_RANGE.last - SIDECAR_PORT_RANGE.first + 1 },
    (_, offset) => `http://127.0.0.1:${SIDECAR_PORT_RANGE.first + offset}`,
  ),
);

/** Local model servers the desktop app may call directly (Ollama, LM Studio). */
export const LOCAL_MODEL_CSP_ORIGINS: readonly string[] = Object.freeze([
  'http://127.0.0.1:11434',
  'http://127.0.0.1:1234',
]);

/**
 * R3-SEC-004: Cesium bundles Knockout 3.5.1 as an ES module, where `this` is
 * undefined, so its `this||(0,eval)("this")` really calls eval and would fail
 * once `'unsafe-eval'` is gone. Indirect eval of "this" returns the global
 * object, so `globalThis` is an exact, eval-free replacement.
 */
const INDIRECT_EVAL_THIS = /\(\s*0\s*,\s*eval\s*\)\s*\(\s*(["'`])this\1\s*\)/g;

export function rewriteIndirectEvalThis(code: string): { code: string; count: number } {
  let count = 0;
  const rewritten = code.replace(INDIRECT_EVAL_THIS, () => {
    count += 1;
    return 'globalThis';
  });
  return { code: rewritten, count };
}
