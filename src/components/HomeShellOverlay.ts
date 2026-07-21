/**
 * Home Shell — Phase 1 of the UI shell re-imagination
 * (docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md).
 *
 * Full-screen overlay: map canvas backdrop + three briefing bands +
 * pinned panel deck + status ribbon. Default-on since Phase 2 for the
 * full desktop variant — see src/services/home-shell/shell-gate.ts for
 * the gate and the classic-view opt-out. Composition logic lives in the
 * pure view-models under src/services/home-shell/. All DOM is built with
 * createElement/textContent — no HTML-string sinks.
 */

import { DEFAULT_PANELS, STORAGE_KEYS } from '@/config/panels';
import { PanelFocusHost } from '@/components/PanelFocusHost';
import { SituationDossier } from '@/components/SituationDossier';
import { getCommandRegistry } from '@/services/command-palette/command-registry';
import {
  getActiveSituation,
  getPersonalImpactReport,
  getPersonalProfile,
  getRecentEvents,
} from '@/services/insights/insights-state';
import type { SituationDescriptor } from '@/services/insights/action-briefs';
import type { PlaybookCategory } from '@/services/insights/reaction-playbooks';
import { getSnapshotCount, getWhatChanged } from '@/services/command-center/what-changed';
import type { WhatChangedEvent } from '@/services/command-center/what-changed';
import { tryInvokeTauri } from '@/services/tauri-bridge';
import {
  getFeatureHealthRegistry,
  getPanelHealthRegistry,
} from '@/services/diagnostics/diagnostics-state';
import { getLiveDiagnosticsSnapshot } from '@/services/diagnostics/live-diagnostics-snapshot';
import { aggregateSystemHealth, contextFromSnapshots } from '@/services/diagnostics/system-health';
import { registerRecurringLoop } from '@/services/diagnostics/recurring-loops';
import type { LoopHandle } from '@/services/diagnostics/recurring-loops';
import { buildBriefingView } from '@/services/home-shell/briefing-view';
import type { BriefingBandView, BriefingView } from '@/services/home-shell/briefing-view';
import { matchPinnablePanels } from '@/services/home-shell/pin-picker-filter';
import {
  buildDeckCards,
  movePin,
  parseDeckPins,
  serializeDeckPins,
  togglePin,
} from '@/services/home-shell/deck-view';
import type { DeckCardView } from '@/services/home-shell/deck-view';
import { buildStatusRibbon } from '@/services/home-shell/status-ribbon-view';
import type { StatusRibbonView } from '@/services/home-shell/status-ribbon-view';
import { safeSetItem } from '@/utils/safe-storage';

const DECK_PINS_KEY = STORAGE_KEYS.deckPins;
const CHANGED_WINDOW_MS = 60 * 60 * 1000;
const REFRESH_MS = 10_000;

interface NarrativeSource {
  getNarrative(): string;
}

export interface HomeShellOptions {
  getPanel: (panelId: string) => NarrativeSource | undefined;
  /** Mounts a lazy panel without touching the classic grid's scroll. */
  ensurePanel: (panelId: string) => Promise<unknown>;
}

export class HomeShellOverlay {
  private root: HTMLElement | null = null;
  private mapSlot: HTMLElement | null = null;
  private topbarEl: HTMLElement | null = null;
  private briefingEl: HTMLElement | null = null;
  private deckEl: HTMLElement | null = null;
  private ribbonEl: HTMLElement | null = null;
  private mapHome: Comment | null = null;
  private loop: LoopHandle | null = null;
  private pins: string[] = [];
  private visible = false;
  private lastGoodPersonalAt: number | undefined;
  private lastGoodChangedAt: number | undefined;
  private dossier: SituationDossier | null = null;
  private focusHost: PanelFocusHost | null = null;
  private _onOpenDossier: ((e: Event) => void) | null = null;
  private _onOpenPanel: ((e: Event) => void) | null = null;
  private lastSituationCommandId: string | null = null;
  private readonly getPanel: HomeShellOptions['getPanel'];
  // used by the focus host
  private readonly ensurePanel: HomeShellOptions['ensurePanel'];

  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !e.defaultPrevented && this.visible) this.hide();
  };

  constructor(options: HomeShellOptions) {
    this.getPanel = options.getPanel;
    this.ensurePanel = options.ensurePanel;
  }

  mount(parent: HTMLElement): void {
    if (this.root) return;
    this.pins = parseDeckPins(
      localStorage.getItem(DECK_PINS_KEY),
      new Set(Object.keys(DEFAULT_PANELS)),
    );

    const root = el('div', 'home-shell');
    root.hidden = true;

    this.mapSlot = el('div', 'home-shell-map');

    const scroll = el('div', 'home-shell-scroll');
    const viewport = el('section', 'home-shell-viewport');

    const topbar = el('header', 'home-shell-topbar');
    this.topbarEl = topbar;
    topbar.append(
      el('span', 'home-shell-brand', '🔮 Crystal Ball'),
      button('home-shell-cmdk', 'cmdk', '⌘K — panels, places, situations…'),
      el('span', 'home-shell-topbar-spacer'),
      button('home-shell-library', 'library', '📚 Library'),
      button('home-shell-exit', 'exit', 'Classic view ⎋'),
    );
    // Drag the window by its top bar. The shell has no classic toolbar, so
    // without this the window can't be moved (WKWebView ignores app-region;
    // must go mousedown → start_dragging). Interactive children are excluded.
    topbar.addEventListener('mousedown', (ev) => {
      const e = ev as MouseEvent;
      if (e.button !== 0) return;
      if ((e.target as Element | null)?.closest('button, input, select, a, [role="button"]')) return;
      e.preventDefault();
      void tryInvokeTauri('plugin:window|start_dragging').catch(() => {/* web build / silent */});
    });

    this.briefingEl = el('div', 'home-shell-briefing');
    // The map backdrop now owns wheel/drag (scroll-zoom + pan), so wheeling
    // over empty areas zooms the map instead of scrolling to the deck — make
    // the hint an explicit scroll-to-deck button.
    const deckHint = el('button', 'home-shell-deck-hint', '▼ Your Deck');
    deckHint.addEventListener('click', () => {
      this.deckEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    viewport.append(this.briefingEl, deckHint);

    this.deckEl = el('section', 'home-shell-deck');
    this.ribbonEl = el('footer', 'home-shell-ribbon');
    // Topbar is a direct child of the scroll container (not the viewport) so its
    // sticky containing block spans the whole scroll — it stays pinned even when
    // the viewport scrolls past to reach the deck. (Nested in the viewport it
    // unstuck the moment the viewport left the scrollport — the vanishing-header bug.)
    scroll.append(topbar, viewport, this.deckEl, this.ribbonEl);
    root.append(this.mapSlot, scroll);

    this.dossier = new SituationDossier({
      getNarrative: (id) => this.getPanel(id)?.getNarrative() ?? undefined,
      onLocate: (lat, lon) => {
        document.dispatchEvent(new CustomEvent('cb:map-focus', { detail: { lat, lon } }));
      },
      onOpenPanel: (panelId) => {
        this.openInFocus(panelId);
      },
    });
    this.dossier.mount(root);

    this.focusHost = new PanelFocusHost({
      ensurePanel: (id) => this.ensurePanel(id),
      onOpenClassic: (panelId) => {
        this.hide();
        document.dispatchEvent(new CustomEvent('cb:navigate-panel', { detail: { panelKey: panelId } }));
      },
    });
    this.focusHost.mount(root);

    this._onOpenDossier = (e: Event) => {
      const id = (e as CustomEvent<{ situationId?: string }>).detail?.situationId;
      const subject = this.resolveSituation(id);
      if (subject) {
        if (!this.visible) this.show();
        this.dossier?.open(subject);
      }
    };
    document.addEventListener('cb:open-dossier', this._onOpenDossier);

    this._onOpenPanel = (e: Event) => {
      const panelKey = (e as CustomEvent<{ panelKey?: string }>).detail?.panelKey;
      if (!panelKey) return;
      if (this.visible) {
        this.openInFocus(panelKey);
      } else {
        document.dispatchEvent(new CustomEvent('cb:navigate-panel', { detail: { panelKey } }));
      }
    };
    document.addEventListener('cb:open-panel', this._onOpenPanel);

    root.addEventListener('click', (e) => this.onClick(e));
    // Pin-picker: filter as the user types, open on focus.
    const onPinInput = (e: Event): void => {
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement && t.dataset.action === 'pin-filter') this.renderPinList(t);
    };
    root.addEventListener('input', onPinInput);
    root.addEventListener('focusin', onPinInput);
    // Close the list when focus/clicks leave the picker.
    root.addEventListener('focusout', (e) => {
      const to = (e as FocusEvent).relatedTarget as Node | null;
      if (!to || !this.deckEl?.querySelector('.hs-pin-picker')?.contains(to)) this.closePinList();
    });
    parent.append(root);
    this.root = root;
  }

  private resolveSituation(id?: string): SituationDescriptor | undefined {
    const active = getActiveSituation();
    if (!id) return active;
    if (active?.id === id) return active;
    const event = getRecentEvents().find((e) => e.eventId === id);
    if (!event) return active;
    return {
      id: event.eventId,
      title: event.description,
      category: categoryForDomain(event.domain),
      severityScore: event.severity,
      confidence: 'medium',
    };
  }

  show(): void {
    if (!this.root || this.visible) return;
    this.visible = true;
    this.root.hidden = false;
    document.body.classList.add('home-shell-active');
    // The sticky topbar lives above the 100dvh viewport in the scroll flow, so
    // publish its measured height to CSS (--hs-topbar-h) — now that the shell is
    // visible it can be measured — keeping the "Your Deck" button on the fold.
    const topH = this.topbarEl?.offsetHeight;
    if (topH && topH > 0) this.root.style.setProperty('--hs-topbar-h', `${topH}px`);
    document.addEventListener('keydown', this.onKeydown);
    this.adoptMap();
    this.loop = registerRecurringLoop('home-shell-refresh', () => this.refresh(), REFRESH_MS, {
      priority: 'low',
      runImmediately: true,
    });
  }

  hide(): void {
    if (!this.root || !this.visible) return;
    this.visible = false;
    this.loop?.cancel();
    this.loop = null;
    document.removeEventListener('keydown', this.onKeydown);
    this.focusHost?.close();
    this.dossier?.close();
    this.releaseMap();
    this.root.hidden = true;
    document.body.classList.remove('home-shell-active');
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
    if (this._onOpenDossier) {
      document.removeEventListener('cb:open-dossier', this._onOpenDossier);
      this._onOpenDossier = null;
    }
    if (this._onOpenPanel) {
      document.removeEventListener('cb:open-panel', this._onOpenPanel);
      this._onOpenPanel = null;
    }
    this.focusHost?.destroy();
    this.focusHost = null;
    this.dossier?.destroy();
    this.dossier = null;
    if (this.lastSituationCommandId) {
      getCommandRegistry().unregister(this.lastSituationCommandId);
      this.lastSituationCommandId = null;
    }
    this.root?.remove();
    this.root = null;
  }

  // ── Data + render ─────────────────────────────────────────────────

  private refresh(): void {
    const now = Date.now();

    let personal;
    try {
      personal = getPersonalImpactReport();
      this.lastGoodPersonalAt = now;
    } catch {
      personal = undefined;
    }

    // getWhatChanged returns [] when the shared store holds fewer than 2
    // snapshots (cold boot, or the single writer — CommandCenterPanel — not
    // recording yet). That is "can't answer", not "nothing changed": leave
    // the digest undefined so the band renders its honest staleness line.
    let changed: WhatChangedEvent[] | undefined;
    try {
      if (getSnapshotCount() >= 2) {
        changed = getWhatChanged(now - CHANGED_WINDOW_MS);
        this.lastGoodChangedAt = now;
      }
    } catch {
      changed = undefined;
    }

    const briefing = buildBriefingView(
      {
        personal,
        lastGoodPersonalAt: this.lastGoodPersonalAt,
        monitoredPlacesCount: getPersonalProfile().savedPlaces.length,
        changed,
        lastGoodChangedAt: this.lastGoodChangedAt,
        situation: getActiveSituation(),
        recentEvents: getRecentEvents().map((e) => ({
          eventId: e.eventId,
          description: e.description,
          domain: e.domain,
          severity: e.severity,
        })),
      },
      now,
    );
    this.renderBriefing(briefing);
    // Skip the deck rebuild while focus is inside it — a 10 s re-render
    // would yank the open pin picker shut mid-filter. Direct calls from
    // setPins still render unconditionally, which releases the guard.
    if (!this.deckEl?.contains(document.activeElement)) this.renderDeck(now);
    this.renderRibbon(now);
    this.syncSituationCommand(getActiveSituation());
  }

  private syncSituationCommand(active: SituationDescriptor | undefined): void {
    const reg = getCommandRegistry();
    if (this.lastSituationCommandId) {
      reg.unregister(this.lastSituationCommandId);
      this.lastSituationCommandId = null;
    }
    if (!active) return;
    const id = 'situation:active';
    reg.register({
      id,
      title: `Dossier: ${active.title}`,
      subtitle: 'active situation',
      keywords: ['situation', 'dossier', active.title.toLowerCase()],
      category: 'navigation',
      icon: '🗂️',
      weight: 1,
      action: () => document.dispatchEvent(new CustomEvent('cb:open-dossier', { detail: { situationId: active.id } })),
    });
    this.lastSituationCommandId = id;
  }

  private renderBriefing(view: BriefingView): void {
    if (!this.briefingEl) return;
    if (view.allClear) {
      const band = el('div', 'hs-band hs-tone-clear');
      band.append(el('div', 'hs-band-headline', view.allClearText));
      this.briefingEl.replaceChildren(band);
      return;
    }
    this.briefingEl.replaceChildren(...view.bands.map((b) => renderBand(b)));
  }

  private renderDeck(now: number): void {
    if (!this.deckEl) return;
    const narratives: Record<string, string | undefined> = {};
    for (const id of this.pins) {
      const n = this.getPanel(id)?.getNarrative();
      narratives[id] = n === '' || n === undefined ? undefined : n;
    }
    const cards = buildDeckCards(
      this.pins,
      { names: DEFAULT_PANELS, health: getPanelHealthRegistry().all(), narratives },
      now,
    );

    const header = el('div', 'hs-deck-header');
    header.append(
      el('span', undefined, 'Your Deck'),
      el('span', 'hs-deck-sub', `${cards.length} pinned · click a card to open`),
      this.buildPinPicker(),
    );

    const grid = el('div', 'hs-deck-grid');
    grid.append(...cards.map((c) => renderDeckCard(c)));
    this.deckEl.replaceChildren(header, grid);
  }

  /** Filterable pin picker. Replaces a 185-item native <select> whose
   *  type-to-jump fired `change` on every matching keystroke and pinned the
   *  wrong panel. This input+list commits ONLY on an explicit item click. */
  private buildPinPicker(): HTMLElement {
    const wrap = el('div', 'hs-pin-picker');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'hs-pin-input';
    input.placeholder = '+ pin a panel…';
    input.dataset.action = 'pin-filter';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.autocomplete = 'off';
    const list = el('ul', 'hs-pin-list');
    list.hidden = true;
    // Keep the input focused while clicking an item, or the focusout handler
    // would hide the list before the click lands (combobox blur race).
    list.addEventListener('mousedown', (e) => e.preventDefault());
    wrap.append(input, list);
    return wrap;
  }

  private renderPinList(input: HTMLInputElement): void {
    const list = input.parentElement?.querySelector<HTMLElement>('.hs-pin-list');
    if (!list) return;
    const matches = matchPinnablePanels(input.value, Object.entries(DEFAULT_PANELS), this.pins);
    list.replaceChildren(
      ...matches.map(([key, name]) => {
        const li = el('li', 'hs-pin-item', name);
        li.dataset.action = 'pin-add';
        li.dataset.panelKey = key;
        li.setAttribute('role', 'option');
        return li;
      }),
    );
    const open = matches.length > 0;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
  }

  private closePinList(): void {
    this.deckEl?.querySelector<HTMLElement>('.hs-pin-list')?.setAttribute('hidden', '');
    this.deckEl?.querySelector<HTMLElement>('.hs-pin-input')?.setAttribute('aria-expanded', 'false');
  }

  private renderRibbon(now: number): void {
    if (!this.ribbonEl) return;
    let view: StatusRibbonView;
    try {
      const snapshot = getLiveDiagnosticsSnapshot();
      const ctx = contextFromSnapshots({
        panels: snapshot.panels,
        sources: snapshot.sources,
        providers: snapshot.providers,
      });
      const report = aggregateSystemHealth({
        panels: snapshot.panels,
        features: getFeatureHealthRegistry().all(ctx),
        sources: snapshot.sources,
        providers: snapshot.providers,
        notifications: snapshot.notificationSummary,
        sidecar: snapshot.sidecar,
      });
      view = buildStatusRibbon(
        { systemStatus: report.status, summary: report.summary, lastSweepAt: now },
        now,
      );
    } catch {
      view = { tone: 'warn', text: 'diagnostics unavailable' };
    }
    const dot = el('span', `hs-ribbon-dot hs-ribbon-${view.tone}`);
    this.ribbonEl.replaceChildren(dot, document.createTextNode(view.text));
  }

  // ── Interactions ──────────────────────────────────────────────────

  /** Open a panel in the focus host; on failure (disabled/unknown panel)
   *  fall back to the classic path so the user still sees its existing
   *  disabled-panel toast instead of a silent no-op. */
  private openInFocus(panelId: string): void {
    void this.focusHost?.open(panelId).then((ok) => {
      if (!ok) {
        this.hide();
        document.dispatchEvent(new CustomEvent('cb:navigate-panel', { detail: { panelKey: panelId } }));
      }
    });
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    // Dossier containment: the drawer handles its own clicks; without this
    // guard its data-panel-key cards bubble into the branches below and
    // double-dispatch. (stopPropagation in the dossier would instead starve
    // the app's document-level outside-click closers — don't do that.)
    if (target.closest('.hs-dossier, .hs-dossier-scrim')) return;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'cmdk') {
      document.dispatchEvent(new CustomEvent('cb:toggle-cmdk'));
      return;
    }
    if (action === 'library') {
      document.dispatchEvent(new CustomEvent('cb:toggle-library'));
      return;
    }
    if (action === 'exit') {
      this.hide();
      return;
    }
    const situationId = target.closest<HTMLElement>('[data-situation-id]')?.dataset.situationId;
    if (situationId) {
      this.dossier?.open(
        this.resolveSituation(situationId) ??
          { id: situationId, title: situationId, category: 'severe_weather', severityScore: 50, confidence: 'low' },
      );
      return;
    }
    const key = target.closest<HTMLElement>('[data-panel-key]')?.dataset.panelKey;
    if (!key) return;
    if (action === 'pin-add') {
      // Explicit pick from the filter list — the only way a pin commits now.
      this.setPins(togglePin(this.pins, key)); // renderDeck rebuilds a fresh, empty picker
      return;
    }
    if (action === 'unpin') {
      this.setPins(togglePin(this.pins, key));
      return;
    }
    if (action === 'move-left') {
      this.setPins(movePin(this.pins, key, -1));
      return;
    }
    if (action === 'move-right') {
      this.setPins(movePin(this.pins, key, 1));
      return;
    }
    // Plain card click → open the panel in the focus host.
    this.openInFocus(key);
  }

  private setPins(pins: string[]): void {
    this.pins = pins;
    safeSetItem(DECK_PINS_KEY, serializeDeckPins(pins));
    this.renderDeck(Date.now());
  }

  // ── Map adoption ──────────────────────────────────────────────────

  private adoptMap(): void {
    const mapEl = document.getElementById('mapContainer');
    if (!mapEl || !this.mapSlot || this.mapHome) return;
    this.mapHome = document.createComment('home-shell-map-home');
    mapEl.before(this.mapHome);
    this.mapSlot.append(mapEl);
    window.dispatchEvent(new Event('resize'));
  }

  private releaseMap(): void {
    if (!this.mapHome) return;
    const mapEl = document.getElementById('mapContainer');
    if (mapEl && this.mapSlot?.contains(mapEl)) {
      this.mapHome.replaceWith(mapEl);
    } else {
      // Map vanished or was moved by someone else — still remove the
      // placeholder so future adoptions aren't permanently blocked.
      this.mapHome.remove();
    }
    this.mapHome = null;
    window.dispatchEvent(new Event('resize'));
  }
}

// ── Module-private helpers ──────────────────────────────────────────

/** Map an event's free-text domain to the playbook category whose evidence
 *  and actions fit it. The live bridges emit only weather/earthquake today;
 *  the other rows cover synthetic and future bridge domains. Unknown domains
 *  fall back to severe_weather — its dossier renders honestly (evidence and
 *  brief clearly weather-labeled) rather than pretending domain knowledge. */
const DOMAIN_TO_CATEGORY: Readonly<Record<string, PlaybookCategory>> = {
  weather: 'severe_weather',
  earthquake: 'earthquake',
  seismic: 'earthquake',
  wildfire: 'wildfire',
  conflict: 'conflict_escalation',
  cyber: 'cyber_campaign',
  health: 'disease_outbreak',
  disease: 'disease_outbreak',
  energy: 'grid_outage',
  grid: 'grid_outage',
  infrastructure: 'grid_outage',
  utility: 'grid_outage',
  finance: 'banking_outage',
  market: 'banking_outage',
  travel: 'travel_disruption',
  aviation: 'travel_disruption',
  food: 'food_shortage',
  fuel: 'oil_fuel_shortage',
};

function categoryForDomain(domain: string): PlaybookCategory {
  return DOMAIN_TO_CATEGORY[domain] ?? 'severe_weather';
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, action: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  if (className) b.className = className;
  b.dataset.action = action;
  b.textContent = label;
  return b;
}

function renderBand(b: BriefingBandView): HTMLElement {
  const band = el('div', `hs-band hs-tone-${b.tone}`);
  band.append(el('div', 'hs-band-label', b.label), el('div', 'hs-band-headline', b.headline));
  for (const entry of b.entries) {
    if (entry.situationId) {
      const line = document.createElement('button');
      line.type = 'button';
      line.className = 'hs-band-line hs-band-link';
      line.textContent = entry.text;
      line.dataset.situationId = entry.situationId;
      band.append(line);
    } else {
      band.append(el('div', 'hs-band-line', entry.text));
    }
  }
  if (b.staleness) band.append(el('div', 'hs-band-stale', b.staleness));
  return band;
}

function renderDeckCard(c: DeckCardView): HTMLElement {
  const card = el('div', `hs-card hs-card-${c.tone}`);
  card.dataset.panelKey = c.panelId;
  card.append(el('div', 'hs-card-title', c.title));
  if (c.narrative) card.append(el('div', 'hs-card-narrative', c.narrative));
  card.append(el('div', 'hs-card-status', c.statusLabel));

  const actions = el('div', 'hs-card-actions');
  const controls: readonly (readonly [string, string, string])[] = [
    ['move-left', '‹', 'Move left'],
    ['move-right', '›', 'Move right'],
    ['unpin', '×', 'Unpin'],
  ];
  for (const [action, glyph, title] of controls) {
    const b = button('', action, glyph);
    b.title = title;
    b.dataset.panelKey = c.panelId;
    actions.append(b);
  }
  card.append(actions);
  return card;
}
