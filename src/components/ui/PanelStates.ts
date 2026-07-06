/**
 * Shared panel empty / error state renderers.
 *
 * Every panel that hits a fetch failure or an empty dataset should render
 * one of these helpers instead of hand-rolled red HTTP codes or API-path
 * prose. House rules enforced here:
 *
 *   - No raw HTTP status codes in visible copy — technical detail goes in
 *     a title-attribute tooltip (and the console) only.
 *   - No API paths or "call fn()" instructions in user-facing copy.
 *   - Centered, muted secondary text consistent with the panel body style.
 *
 * The optional retry button dispatches a bubbling CustomEvent (name chosen
 * by the caller) from the button element. The owning panel listens for that
 * event on its content element and re-fetches. A single document-level
 * delegated click listener does the dispatching, so the returned HTML works
 * with the string-based `setContent()` pipeline without per-render wiring.
 */

import { escapeHtml } from '@/utils/sanitize';

export interface PanelErrorOptions {
  /** Short human headline, e.g. "Freight data temporarily unavailable". */
  title: string;
  /**
   * Technical detail (status code, endpoint, etc.). Rendered as a
   * title-attribute tooltip only — never as visible copy.
   */
  detail?: string;
  /**
   * When set, renders a Retry button that dispatches a bubbling
   * CustomEvent with this name from the button element.
   */
  onRetryEventName?: string;
}

export interface PanelEmptyOptions {
  /** Plain-language summary, e.g. "No freight-stress data yet". */
  message: string;
  /** Optional secondary hint, e.g. "The monitor may still be warming up". */
  hint?: string;
}

const RETRY_BTN_CLASS = 'panel-state-retry';

let retryDelegationInstalled = false;

/** One delegated listener turns retry-button clicks into CustomEvents. */
function ensureRetryDelegation(): void {
  if (retryDelegationInstalled || typeof document === 'undefined') return;
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest<HTMLElement>(`.${RETRY_BTN_CLASS}`);
    const eventName = btn?.dataset.retryEvent;
    if (!btn || !eventName) return;
    btn.dispatchEvent(new CustomEvent(eventName, { bubbles: true }));
  });
  retryDelegationInstalled = true;
}

/** Muted, centered error state. Detail stays in the tooltip, never the copy. */
export function renderPanelError(options: PanelErrorOptions): string {
  ensureRetryDelegation();
  const tooltip = options.detail ? ` title="${escapeHtml(options.detail)}"` : '';
  const retry = options.onRetryEventName
    ? `<button type="button" class="${RETRY_BTN_CLASS}" data-retry-event="${escapeHtml(options.onRetryEventName)}" style="padding:3px 12px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(255,255,255,0.04);color:var(--text-secondary,#aaa);border-radius:3px;cursor:pointer;">Retry</button>`
    : '';
  return `<div${tooltip} style="padding:16px 12px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;">
    <div style="font-size:12px;color:var(--text-secondary,#aaa);">${escapeHtml(options.title)}</div>
    ${retry}
  </div>`;
}

/** Muted, centered empty state with an optional secondary hint line. */
export function renderPanelEmpty(options: PanelEmptyOptions): string {
  const hint = options.hint
    ? `<div style="font-size:11px;color:var(--text-secondary,#aaa);opacity:0.7;">${escapeHtml(options.hint)}</div>`
    : '';
  return `<div style="padding:16px 12px;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;">
    <div style="font-size:12px;color:var(--text-secondary,#aaa);">${escapeHtml(options.message)}</div>
    ${hint}
  </div>`;
}
