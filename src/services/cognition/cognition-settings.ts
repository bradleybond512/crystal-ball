/**
 * Cognition kill-switches — master enable/disable for each learning-layer
 * service (COGNITIVE_ENHANCEMENT_PLAN surfacing wave).
 *
 * Safety posture:
 *   - Fail-safe: any storage read error is treated as ENABLED (current
 *     behavior unchanged) and logged once — a broken settings store must
 *     never silently flip the cognition layer off.
 *   - Default ON: absence of a stored value means enabled.
 *   - No partial states: each switch is a single boolean read at the
 *     service's entry point; there is no cached mirror to get out of sync.
 *
 * Persisted as one JSON object under `crystalball-cognition-flags-v2`
 * (same localStorage pattern as ai-flow-settings.ts). Setters dispatch
 * `cb:cognition-flags-changed` on document so open surfaces can re-render.
 *
 * The v1 key (`crystalball-cognition-flags-v1`) belonged to the original
 * PR 6 UI wiring that was lost in a rebase; v2 uses different switch names
 * so no migration is attempted.
 */

export type CognitionSwitchKey =
  | 'evoi-planner'
  | 'episodic-recall'
  | 'bocpd'
  | 'consolidation'
  | 'shadow-algorithms'
  | 'calibration-bridges';

export const COGNITION_SWITCHES: readonly CognitionSwitchKey[] = [
  'evoi-planner',
  'episodic-recall',
  'bocpd',
  'consolidation',
  'shadow-algorithms',
  'calibration-bridges',
];

const STORAGE_KEY = 'crystalball-cognition-flags-v2';
const EVENT_NAME = 'cb:cognition-flags-changed';

let warnedReadError = false;

function loadFlags(): Partial<Record<CognitionSwitchKey, boolean>> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return {};
    return parsed as Partial<Record<CognitionSwitchKey, boolean>>;
  } catch (error) {
    // Fail-safe: treat as all-enabled. Log once, not per read — entry
    // points consult this on every cycle.
    if (!warnedReadError) {
      warnedReadError = true;
      // eslint-disable-next-line no-console -- fail-safe path must surface even with logger unavailable
      console.warn('[cognition-settings] flag read failed — treating all switches as ON', error);
    }
    return {};
  }
}

/** True unless the user explicitly turned the switch off. Fail-safe ON. */
export function isCognitionEnabled(key: CognitionSwitchKey): boolean {
  return loadFlags()[key] !== false;
}

export function setCognitionEnabled(key: CognitionSwitchKey, value: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const flags = loadFlags();
    flags[key] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch (error) {
    // eslint-disable-next-line no-console -- fail-safe path must surface even with logger unavailable
    console.warn('[cognition-settings] flag write failed', error);
  }
  try {
    document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key, value } }));
  } catch { /* non-browser environments */ }
}

export function subscribeCognitionFlags(cb: (key?: CognitionSwitchKey) => void): () => void {
  const handler = (e: Event): void => {
    cb((e as CustomEvent<{ key?: CognitionSwitchKey }>).detail?.key);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => document.removeEventListener(EVENT_NAME, handler);
}
