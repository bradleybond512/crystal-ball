/**
 * Panel Focus Host — Phase 4 of the UI shell re-imagination.
 *
 * Opens the REAL panel inside the Home Shell: reparents the panel's
 * existing element out of #panelsGrid (the proven map-adoption pattern)
 * into a framed overlay, and restores it on close via a comment
 * placeholder. All DOM via createElement/textContent.
 */

import { DEFAULT_PANELS } from '@/config/panels';
import { PANEL_METADATA, LIBRARY_DOMAIN_LABELS } from '@/config/panel-metadata';

/** Structural face of a mounted panel — keeps the host off the Panel class. */
export interface FocusablePanel {
  getElement(): HTMLElement;
}

export interface PanelFocusHostOptions {
  ensurePanel: (panelId: string) => Promise<unknown>;
  /** "Open in classic" — host closes shell layers, classic navigates. */
  onOpenClassic: (panelId: string) => void;
}

export class PanelFocusHost {
  private scrim: HTMLElement | null = null;
  private frame: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private panelHome: Comment | null = null;
  private panelId: string | null = null;
  private openState = false;
  private openEpoch = 0;
  private strippedClasses: string[] = [];
  private readonly opts: PanelFocusHostOptions;

  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (document.querySelector('.cmdk-v2-overlay:not([hidden])')) return;
    if (document.querySelector('.library-overlay:not([hidden])')) return;
    if (e.key === 'Escape' && !e.defaultPrevented && this.openState) {
      e.preventDefault();
      this.close();
    }
  };

  constructor(options: PanelFocusHostOptions) {
    this.opts = options;
  }

  mount(parent: HTMLElement): void {
    if (this.frame) return;
    this.scrim = el('div', 'hs-focus-scrim');
    this.scrim.addEventListener('click', () => this.close());

    const frame = el('section', 'hs-focus');
    this.headerEl = el('header', 'hs-focus-header');
    this.bodyEl = el('div', 'hs-focus-body');
    frame.append(this.headerEl, this.bodyEl);
    frame.addEventListener('click', (e) => this.onClick(e));

    parent.append(this.scrim, frame);
    this.frame = frame;
  }

  async open(panelId: string): Promise<boolean> {
    if (!this.frame || !this.scrim || !this.bodyEl) return false;
    if (this.openState) this.close();
    // Epoch guard: a second open() or a close() during the lazy-mount await
    // supersedes this call — bail instead of clobbering the newer state.
    const epoch = ++this.openEpoch;
    const panel = (await this.opts.ensurePanel(panelId)) as FocusablePanel | null;
    if (epoch !== this.openEpoch) return true;
    const panelEl = panel && typeof panel.getElement === 'function' ? panel.getElement() : null;
    // A constructed-but-disabled panel keeps .hidden (display:none) — hosting
    // it would show an empty frame, so report failure for the classic fallback.
    if (!panelEl || panelEl.classList.contains('hidden')) return false;

    this.panelId = panelId;
    this.renderHeader(panelId);
    this.panelHome = document.createComment(`hs-focus-home:${panelId}`);
    panelEl.before(this.panelHome);
    // Grid sizing classes carry !important min-heights inside @layer base,
    // which outranks this host's unlayered !important neutralization —
    // strip them while hosted, restore with the panel.
    this.strippedClasses = [...panelEl.classList].filter((c) => /^(?:col-)?span-\d+$/.test(c));
    panelEl.classList.remove(...this.strippedClasses);
    this.bodyEl.replaceChildren(panelEl);

    this.openState = true;
    this.frame.classList.add('hs-focus--open');
    this.scrim.classList.add('hs-focus-scrim--open');
    document.addEventListener('keydown', this.onKeydown, true);
    window.dispatchEvent(new Event('resize'));
    return true;
  }

  close(): void {
    this.openEpoch++;
    if (!this.openState) return;
    this.openState = false;
    this.restorePanel();
    this.frame?.classList.remove('hs-focus--open');
    this.scrim?.classList.remove('hs-focus-scrim--open');
    document.removeEventListener('keydown', this.onKeydown, true);
  }

  isOpen(): boolean {
    return this.openState;
  }

  destroy(): void {
    this.close();
    this.scrim?.remove();
    this.frame?.remove();
    this.scrim = null;
    this.frame = null;
  }

  // ── Internals ─────────────────────────────────────────────────────

  private restorePanel(): void {
    const panelEl = this.hostedElInBody();
    if (panelEl && this.strippedClasses.length) panelEl.classList.add(...this.strippedClasses);
    this.strippedClasses = [];
    if (this.panelHome) {
      if (panelEl) this.panelHome.replaceWith(panelEl);
      else this.panelHome.remove();
      this.panelHome = null;
    }
    this.panelId = null;
    window.dispatchEvent(new Event('resize'));
  }

  private hostedElInBody(): HTMLElement | null {
    const first = this.bodyEl?.firstElementChild;
    return first instanceof HTMLElement ? first : null;
  }

  private renderHeader(panelId: string): void {
    if (!this.headerEl) return;
    const meta = PANEL_METADATA[panelId];
    const title = DEFAULT_PANELS[panelId]?.name ?? panelId;
    const domainLabel = meta ? LIBRARY_DOMAIN_LABELS[meta.domain] : '';
    const actions = el('div', 'hs-focus-actions');
    actions.append(button('classic', 'Open in classic'), button('close', 'Close ⎋'));
    const titleEl = el('span', 'hs-focus-title', meta?.icon ? `${meta.icon} ${title}` : title);
    this.headerEl.replaceChildren(titleEl, el('span', 'hs-focus-domain', domainLabel), actions);
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const action = target.closest<HTMLElement>('.hs-focus-actions [data-action]')?.dataset.action;
    if (action === 'close') {
      this.close();
      return;
    }
    if (action === 'classic' && this.panelId) {
      const id = this.panelId;
      this.close();
      this.opts.onOpenClassic(id);
    }
  }
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(action: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.action = action;
  b.textContent = label;
  return b;
}
