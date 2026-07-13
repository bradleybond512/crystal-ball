/**
 * Library — Phase 2 of the UI shell re-imagination
 * (docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md).
 *
 * Browsable catalog of every panel, grouped into 8 domains with curated
 * featured rows and a collapsed long tail. Composition logic lives in the
 * pure view-model src/services/home-shell/library-view.ts. All DOM built
 * with createElement/textContent — no HTML-string sinks.
 */

import { DEFAULT_PANELS } from '@/config/panels';
import { LIBRARY_DOMAIN_LABELS, PANEL_METADATA } from '@/config/panel-metadata';
import type { LibraryDomain } from '@/config/panel-metadata';
import { buildLibraryView } from '@/services/home-shell/library-view';
import type { LibraryDomainView, LibraryPanelView } from '@/services/home-shell/library-view';

export class LibraryOverlay {
  private root: HTMLElement | null = null;
  private navEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private searchEl: HTMLInputElement | null = null;
  private visible = false;
  private activeDomain: LibraryDomain = 'personal-safety';
  private query = '';
  private expanded = new Set<LibraryDomain>();

  private readonly onKeydown = (e: KeyboardEvent): void => {
    // cmdk (z 10005) sits above the Library but handles Escape on its input
    // in the target phase, after our capture handler — defer to it while open.
    if (document.querySelector('.cmdk-v2-overlay:not([hidden])')) return;
    if (e.key === 'Escape' && !e.defaultPrevented && this.visible) {
      // preventDefault marks the Escape as consumed so the Home Shell's own
      // document-level handler doesn't also close the layer underneath.
      e.preventDefault();
      this.hide();
    }
  };

  mount(parent: HTMLElement): void {
    if (this.root) return;
    const root = el('div', 'library-overlay');
    root.hidden = true;

    const topbar = el('header', 'library-topbar');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'library-search';
    search.placeholder = 'Filter panels by name or tag…';
    this.searchEl = search;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'library-close';
    close.dataset.action = 'close';
    close.textContent = 'Close ⎋';
    topbar.append(el('span', 'library-title', '📚 Library'), search, close);

    const body = el('div', 'library-body');
    this.navEl = el('nav', 'library-nav');
    this.contentEl = el('div', 'library-content');
    body.append(this.navEl, this.contentEl);
    root.append(topbar, body);

    root.addEventListener('click', (e) => this.onClick(e));
    search.addEventListener('input', () => {
      this.query = search.value;
      this.render();
    });
    parent.append(root);
    this.root = root;
  }

  show(): void {
    if (!this.root || this.visible) return;
    this.visible = true;
    this.root.hidden = false;
    // Fresh filter on every open (house convention: cmdk clears its input on
    // show). Domain selection and expanded long-tails persist deliberately.
    this.query = '';
    if (this.searchEl) this.searchEl.value = '';
    // Capture phase: the Home Shell's bubble-phase Escape handler was
    // registered first (at boot) and would otherwise run before ours and
    // close the layer underneath. Capture runs first regardless of order.
    document.addEventListener('keydown', this.onKeydown, true);
    this.render();
    this.searchEl?.focus();
  }

  hide(): void {
    if (!this.root || !this.visible) return;
    this.visible = false;
    this.root.hidden = true;
    document.removeEventListener('keydown', this.onKeydown, true);
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.hide();
    this.root?.remove();
    this.root = null;
  }

  // ── Render ────────────────────────────────────────────────────────

  private render(): void {
    if (!this.navEl || !this.contentEl) return;
    const view = buildLibraryView(
      { metadata: PANEL_METADATA, names: DEFAULT_PANELS, domainLabels: LIBRARY_DOMAIN_LABELS },
      this.query,
    );

    // A query can empty out the currently active domain while other
    // domains still have matches — jump to the first non-empty one rather
    // than showing a dead-end empty page under a tab that has no results.
    if (view.matchCount > 0) {
      const activeStillHasMatches = view.domains.some(
        (d) => d.domain === this.activeDomain && d.totalCount > 0,
      );
      if (!activeStillHasMatches) {
        const firstNonEmpty = view.domains.find((d) => d.totalCount > 0);
        if (firstNonEmpty) this.activeDomain = firstNonEmpty.domain;
      }
    }

    this.navEl.replaceChildren(
      ...view.domains.map((d) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.domain = d.domain;
        if (d.domain === this.activeDomain) b.classList.add('active');
        b.append(el('span', undefined, d.label), el('span', 'lib-count', String(d.totalCount)));
        return b;
      }),
    );

    if (view.matchCount === 0) {
      this.contentEl.replaceChildren(el('div', 'lib-empty', `No panels match "${this.query}".`));
      return;
    }

    const active = view.domains.find((d) => d.domain === this.activeDomain)!;
    this.contentEl.replaceChildren(...this.renderDomain(active));
  }

  private renderDomain(d: LibraryDomainView): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (d.featured.length > 0) {
      out.push(el('div', 'lib-section-label', 'FEATURED'), grid(d.featured));
    }
    if (d.rest.length > 0) {
      const showAll = this.expanded.has(d.domain) || this.query.trim().length > 0 || d.featured.length === 0;
      if (showAll) {
        out.push(el('div', 'lib-section-label', `MORE (${d.rest.length})`), grid(d.rest));
      } else {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'lib-more';
        more.dataset.action = 'expand';
        more.dataset.domain = d.domain;
        more.textContent = `+ ${d.rest.length} more panels →`;
        out.push(more);
      }
    }
    return out;
  }

  // ── Interactions ──────────────────────────────────────────────────

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close') {
      this.hide();
      return;
    }
    if (action === 'expand') {
      const domain = target.closest<HTMLElement>('[data-domain]')?.dataset.domain as LibraryDomain | undefined;
      if (domain) {
        this.expanded.add(domain);
        this.render();
      }
      return;
    }
    const navDomain = target.closest<HTMLElement>('.library-nav button')?.dataset.domain as LibraryDomain | undefined;
    if (navDomain) {
      this.activeDomain = navDomain;
      this.render();
      return;
    }
    const panelKey = target.closest<HTMLElement>('[data-panel-key]')?.dataset.panelKey;
    if (panelKey) {
      this.hide();
      if (document.body.classList.contains('home-shell-active')) {
        document.dispatchEvent(new CustomEvent('cb:open-panel', { detail: { panelKey } }));
      } else {
        document.dispatchEvent(new CustomEvent('cb:navigate-panel', { detail: { panelKey } }));
      }
    }
  }
}

// ── Module-private helpers ──────────────────────────────────────────

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function grid(panels: readonly LibraryPanelView[]): HTMLElement {
  const g = el('div', 'lib-grid');
  g.append(
    ...panels.map((p) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = p.tier === 'system' ? 'lib-card lib-system' : 'lib-card';
      card.dataset.panelKey = p.panelId;
      if (p.icon) card.append(el('span', 'lib-icon', p.icon));
      card.append(el('span', undefined, p.title));
      return card;
    }),
  );
  return g;
}
