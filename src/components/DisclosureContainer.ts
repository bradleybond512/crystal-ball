/**
 * Progressive Disclosure container helpers.
 *
 * Two entry points share the same underlying `disclosureService`:
 *
 *   1. `mountDisclosureContainer()` — DOM-based. Mounts a wrapper with
 *      the level-switcher button row + content host inside `host`.
 *      Returns `{ element, refresh, unmount }`. Designed for new panels
 *      built around DOM nodes (rather than HTML-string render loops).
 *
 *   2. `renderDisclosureSwitcherHtml()` + `attachDisclosureClickDelegation()`
 *      — HTML-string flavor. The existing panels in this codebase build
 *      their content as HTML and call `setContent(html)`; they embed the
 *      switcher snippet at the top of their HTML and call the delegation
 *      helper once to wire clicks.
 *
 * Both flavors stay in sync because they read + write the same
 * `disclosureService` singleton.
 */

import {
  DISCLOSURE_LEVELS,
  cycleDisclosureLevel,
  disclosureLabel,
  disclosureLongLabel,
  disclosureService,
  type DisclosureLevel,
} from '@/services/ui/progressive-disclosure';
import { h, rawHtml, replaceChildren } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';

export interface DisclosureRenderers {
  renderSummary: () => Node | string;
  renderDetail: () => Node | string;
  /** Optional. When omitted, the "Raw" button is hidden. */
  renderRaw?: () => Node | string;
}

export interface DisclosureMount {
  readonly element: HTMLElement;
  refresh(): void;
  unmount(): void;
}

const SWITCHER_CLASS = 'disclosure-switcher';
const HOST_CLASS = 'disclosure-host';
const ROOT_CLASS = 'disclosure-root';

/**
 * Mount a 3-level disclosure surface inside `host`. The container is
 * appended to `host` (host is not cleared — callers can layer disclosure
 * containers next to other content).
 */
export function mountDisclosureContainer(
  panelId: string,
  host: HTMLElement,
  renderers: DisclosureRenderers,
): DisclosureMount {
  const hasRaw = typeof renderers.renderRaw === 'function';
  const contentHost = h('div', { className: HOST_CLASS });
  const switcher = h('div', { className: SWITCHER_CLASS });
  const root = h('div', { className: ROOT_CLASS, dataset: { panelId } }, switcher, contentHost);

  const renderSwitcher = (): void => {
    replaceChildren(switcher, ...buildSwitcherButtons(panelId, hasRaw));
  };

  const renderContent = (): void => {
    const level = disclosureService.getLevel(panelId);
    const node = pickRender(level, renderers);
    if (node === null) {
      replaceChildren(contentHost);
      return;
    }
    const fragment = typeof node === 'string' ? rawHtml(node) : node;
    replaceChildren(contentHost, fragment);
  };

  const renderAll = (): void => {
    renderSwitcher();
    renderContent();
  };

  renderAll();

  const onClick = (e: Event): void => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest<HTMLElement>('[data-disclosure-level]');
    if (!btn) return;
    const next = btn.dataset.disclosureLevel;
    if (next === 'summary' || next === 'detail' || next === 'raw') {
      disclosureService.setLevel(panelId, next);
    }
  };
  switcher.addEventListener('click', onClick);

  const unsubscribe = disclosureService.subscribe(panelId, () => {
    renderAll();
  });

  host.append(root);

  return {
    element: root,
    refresh: renderAll,
    unmount: () => {
      switcher.removeEventListener('click', onClick);
      unsubscribe();
      if (root.parentNode === host) root.remove();
    },
  };
}

function pickRender(level: DisclosureLevel, renderers: DisclosureRenderers): Node | string | null {
  if (level === 'summary') return renderers.renderSummary();
  if (level === 'detail') return renderers.renderDetail();
  if (level === 'raw' && renderers.renderRaw) return renderers.renderRaw();
  // Asked for raw without renderer — fall back to detail.
  return renderers.renderDetail();
}

function buildSwitcherButtons(panelId: string, hasRaw: boolean): HTMLElement[] {
  const current = disclosureService.getLevel(panelId);
  return DISCLOSURE_LEVELS
    .filter((level) => level !== 'raw' || hasRaw)
    .map((level) => buildSwitcherButton(panelId, level, current));
}

function buildSwitcherButton(panelId: string, level: DisclosureLevel, current: DisclosureLevel): HTMLElement {
  const isActive = level === current;
  const btn = h('button', {
    type: 'button',
    className: `disclosure-switcher-btn${isActive ? ' is-active' : ''}`,
    title: disclosureLongLabel(level),
    'aria-label': `Show ${disclosureLongLabel(level)}`,
    'aria-pressed': isActive ? 'true' : 'false',
    dataset: { disclosureLevel: level, disclosurePanel: panelId },
  }, disclosureLabel(level));
  return btn;
}

/**
 * Render the level-switcher button row as an HTML string. Used by panels
 * that build their content via HTML templates (the bulk of this codebase).
 *
 * The output is safe to drop inside an existing template; the panel must
 * separately call `attachDisclosureClickDelegation(this.content, panelId)`
 * once to wire click handling.
 */
export function renderDisclosureSwitcherHtml(
  panelId: string,
  opts: { showRaw?: boolean } = {},
): string {
  const showRaw = opts.showRaw === true;
  const current = disclosureService.getLevel(panelId);
  const buttons = DISCLOSURE_LEVELS
    .filter((level) => level !== 'raw' || showRaw)
    .map((level) => switcherButtonHtml(panelId, level, current))
    .join('');
  return `<div class="${SWITCHER_CLASS}" data-disclosure-panel="${escapeHtml(panelId)}" role="group" aria-label="Disclosure level">${buttons}</div>`;
}

function switcherButtonHtml(panelId: string, level: DisclosureLevel, current: DisclosureLevel): string {
  const isActive = level === current;
  const cls = `disclosure-switcher-btn${isActive ? ' is-active' : ''}`;
  const aria = isActive ? 'true' : 'false';
  const long = disclosureLongLabel(level);
  return `<button type="button" class="${cls}" data-disclosure-level="${level}" data-disclosure-panel="${escapeHtml(panelId)}" aria-pressed="${aria}" aria-label="Show ${escapeHtml(long)}" title="${escapeHtml(long)}">${escapeHtml(disclosureLabel(level))}</button>`;
}

/**
 * Wire delegated click handling for any switcher rendered via
 * `renderDisclosureSwitcherHtml()` and re-rendered as part of the host's
 * content. Returns a cleanup function.
 *
 * The panel passes the element it owns (typically the `content` element
 * its HTML lives inside). The handler reads `data-disclosure-level` and
 * `data-disclosure-panel` from the click target and forwards to the
 * service — so a single delegation install survives every re-render.
 */
export function attachDisclosureClickDelegation(
  content: HTMLElement,
  defaultPanelId: string,
): () => void {
  const handler = (e: Event): void => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest<HTMLElement>('[data-disclosure-level]');
    if (!btn) return;
    const level = btn.dataset.disclosureLevel;
    if (level !== 'summary' && level !== 'detail' && level !== 'raw') return;
    const panelId = btn.dataset.disclosurePanel ?? defaultPanelId;
    e.preventDefault();
    e.stopPropagation();
    disclosureService.setLevel(panelId, level);
  };
  content.addEventListener('click', handler);
  return () => content.removeEventListener('click', handler);
}

/** Exposed for tests + diagnostics. */
export const __internals = {
  buildSwitcherButtons,
  pickRender,
  cycleDisclosureLevel,
  SWITCHER_CLASS,
  HOST_CLASS,
  ROOT_CLASS,
};
