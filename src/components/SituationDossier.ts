/**
 * Situation Dossier — Phase 3 of the UI shell re-imagination
 * (docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md §4).
 *
 * Drawer over the Home Shell's map: header badge, honest why-surfaced
 * trace lines, evidence cards composed via evidenceFor metadata, action
 * brief + timeline rail, and a context-free ask bar. Owned by
 * HomeShellOverlay (mounted as a child of .home-shell). All DOM via
 * createElement/textContent — no HTML-string sinks.
 */

import { DEFAULT_PANELS } from '@/config/panels';
import { PANEL_METADATA } from '@/config/panel-metadata';
import { getPlaybookFor, recordAction, summarizePlaybook } from '@/services/action-memory';
import type { HypothesisKind } from '@/services/analyst-loop';
import {
  getNotificationTraceRegistry,
  getPanelHealthRegistry,
  getPipelineTraceRegistry,
} from '@/services/diagnostics/diagnostics-state';
import { buildActionBrief } from '@/services/insights/action-briefs';
import type { ActionBrief, SituationDescriptor } from '@/services/insights/action-briefs';
import { askLive } from '@/services/insights/ask-context';
import { getActiveActionBrief, getRecentEvents } from '@/services/insights/insights-state';
import { buildSharePacket, selectFormat } from '@/services/insights/share-packet';
import { buildDossierView } from '@/services/home-shell/dossier-view';
import type { DossierView, EvidenceCardView, TraceEventLike } from '@/services/home-shell/dossier-view';

export interface SituationDossierOptions {
  getNarrative: (panelId: string) => string | undefined;
  /** Called after open with the situation's coordinates (fly the map). */
  onLocate?: (lat: number, lon: number) => void;
  /** Called when the user opens a panel (host closes shell layers). */
  onOpenPanel: (panelId: string) => void;
}

export class SituationDossier {
  private scrim: HTMLElement | null = null;
  private drawer: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private askAnswerEl: HTMLElement | null = null;
  private subject: SituationDescriptor | null = null;
  private view: DossierView | null = null;
  private showAllRunnersUp = false;
  private openState = false;
  private readonly opts: SituationDossierOptions;

  private readonly onKeydown = (e: KeyboardEvent): void => {
    // Defer to global overlays stacked above the shell.
    if (document.querySelector('.cmdk-v2-overlay:not([hidden])')) return;
    if (document.querySelector('.library-overlay:not([hidden])')) return;
    if (document.querySelector('.hs-focus--open')) return;
    if (e.key === 'Escape' && !e.defaultPrevented && this.openState) {
      e.preventDefault();
      this.close();
    }
  };

  constructor(options: SituationDossierOptions) {
    this.opts = options;
  }

  mount(parent: HTMLElement): void {
    if (this.drawer) return;
    this.scrim = el('div', 'hs-dossier-scrim');
    this.scrim.addEventListener('click', () => this.close());

    const drawer = el('aside', 'hs-dossier');
    this.headerEl = el('header', 'hs-dossier-header');
    this.bodyEl = el('div', 'hs-dossier-body');
    const ask = el('div', 'hs-dossier-ask');
    const askInput = document.createElement('input');
    askInput.type = 'search';
    askInput.placeholder = 'Ask: why high risk? · what changed? · what to watch?';
    askInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && askInput.value.trim()) {
        e.stopPropagation();
        this.renderAnswer(askInput.value.trim());
      }
    });
    this.askAnswerEl = el('div', 'hs-dossier-answer');
    ask.append(askInput, this.askAnswerEl);
    drawer.append(this.headerEl, this.bodyEl, ask);
    drawer.addEventListener('click', (e) => this.onClick(e));

    parent.append(this.scrim, drawer);
    this.drawer = drawer;
  }

  open(subject: SituationDescriptor): void {
    if (!this.drawer || !this.scrim) return;
    this.subject = subject;
    this.showAllRunnersUp = false;
    this.refresh();
    this.openState = true;
    this.drawer.classList.add('hs-dossier--open');
    this.scrim.classList.add('hs-dossier-scrim--open');
    document.addEventListener('keydown', this.onKeydown, true);

    const location = getRecentEvents().find((e) => e.eventId === subject.id)?.location;
    if (location && this.opts.onLocate) this.opts.onLocate(location.latitude, location.longitude);
  }

  close(): void {
    if (!this.drawer || !this.scrim || !this.openState) return;
    this.openState = false;
    this.drawer.classList.remove('hs-dossier--open');
    this.scrim.classList.remove('hs-dossier-scrim--open');
    document.removeEventListener('keydown', this.onKeydown, true);
  }

  isOpen(): boolean {
    return this.openState;
  }

  destroy(): void {
    this.close();
    this.scrim?.remove();
    this.drawer?.remove();
    this.scrim = null;
    this.drawer = null;
  }

  // ── Data + render ─────────────────────────────────────────────────

  private refresh(): void {
    if (!this.subject || !this.headerEl || !this.bodyEl) return;
    const now = Date.now();
    const narratives: Record<string, string | undefined> = {};
    for (const key of Object.keys(PANEL_METADATA)) {
      if (PANEL_METADATA[key]?.evidenceFor?.includes(this.subject.category)) {
        narratives[key] = this.opts.getNarrative(key);
      }
    }
    this.view = buildDossierView(
      {
        situation: this.subject,
        metadata: PANEL_METADATA,
        names: DEFAULT_PANELS,
        health: getPanelHealthRegistry().all(),
        narratives,
        pipelineEvents: readPipelineEvents(this.subject.id),
        notificationEvents: readNotificationEvents(this.subject.id),
      },
      now,
    );
    this.renderHeader(this.view);
    this.renderBody(this.view, this.briefForSubject());
  }

  /** The active brief belongs to the ACTIVE situation — only use it when the
   *  drawer's subject IS that situation; otherwise build one for the subject
   *  so an event-row dossier never shows another situation's actions. */
  private briefForSubject(): ActionBrief | undefined {
    if (!this.subject) return undefined;
    const active = getActiveActionBrief();
    if (active?.situationId === this.subject.id) return active;
    return buildActionBrief(this.subject);
  }

  private renderHeader(view: DossierView): void {
    if (!this.headerEl) return;
    const badge = el('span', `hs-dossier-badge hs-dossier-badge--${view.badge.tone}`, view.badge.text);
    const share = button('share', 'Share ⌘E');
    const close = button('close', 'Close ⎋');
    const actions = el('div', 'hs-dossier-actions');
    actions.append(share, close);
    this.headerEl.replaceChildren(
      el('span', 'hs-dossier-title', view.title),
      badge,
      el('span', 'hs-dossier-subline', view.subline),
      actions,
    );
  }

  private renderBody(view: DossierView, brief: ActionBrief | undefined): void {
    if (!this.bodyEl) return;
    this.bodyEl.replaceChildren(this.renderMainColumn(view), this.renderRailColumn(view, brief));
  }

  private renderMainColumn(view: DossierView): HTMLElement {
    const main = el('div', 'hs-dossier-main');
    main.append(el('div', 'hs-dossier-section-label', 'WHY THIS SURFACED'));
    const why = el('div', 'hs-dossier-why');
    for (const line of view.whySurfaced) why.append(el('div', undefined, line));
    main.append(why);

    main.append(el('div', 'hs-dossier-section-label', `EVIDENCE · ${view.evidence.length} PANELS`));
    if (view.evidence.length === 0) {
      main.append(el('div', 'hs-dossier-why', 'no evidence panels are mapped for this situation category in this variant'));
    } else {
      main.append(grid(view.evidence));
    }
    this.appendRunnersUp(main, view);
    return main;
  }

  private appendRunnersUp(main: HTMLElement, view: DossierView): void {
    if (view.runnersUp.length === 0) return;
    if (this.showAllRunnersUp) {
      main.append(el('div', 'hs-dossier-section-label', `MORE (${view.runnersUp.length})`));
      main.append(grid(view.runnersUp));
      return;
    }
    const more = button('more', `+ ${view.runnersUp.length} lower-relevance panels →`);
    more.className = 'hs-dossier-more';
    main.append(more);
  }

  private renderRailColumn(view: DossierView, brief: ActionBrief | undefined): HTMLElement {
    const rail = el('div', 'hs-dossier-rail');
    rail.append(el('div', 'hs-dossier-section-label', brief ? `ACTION BRIEF · ${brief.tier.toUpperCase()}` : 'ACTION BRIEF'));
    rail.append(this.renderActionBrief(brief));
    rail.append(el('div', 'hs-dossier-section-label', 'TIMELINE'));
    rail.append(renderTimeline(view));
    return rail;
  }

  private renderActionBrief(brief: ActionBrief | undefined): HTMLElement {
    const briefEl = el('div', 'hs-dossier-brief');
    if (brief) {
      briefEl.append(el('div', 'hs-brief-tier', brief.headline));
      for (const action of brief.recommendedActions) briefEl.append(el('div', undefined, `☐ ${action}`));
      if (brief.confirmingSources.length > 0) {
        briefEl.append(el('div', undefined, `watch: ${brief.confirmingSources.join(', ')}`));
      }
    } else {
      briefEl.append(el('div', undefined, 'no action brief for this situation'));
    }
    const memory = this.memorySummary();
    if (memory) briefEl.append(el('div', 'hs-dossier-memory', memory));
    return briefEl;
  }

  private renderAnswer(question: string): void {
    if (!this.askAnswerEl) return;
    const packet = askLive(question);
    const wrap = el('div');
    wrap.append(el('div', undefined, packet.answer));
    const followups = el('div', 'hs-dossier-followups');
    for (const f of packet.followUps) {
      const b = button('followup', f);
      followups.append(b);
    }
    wrap.append(followups);
    this.askAnswerEl.replaceChildren(wrap);
  }

  private memorySummary(): string | undefined {
    if (!this.subject) return undefined;
    const book = getPlaybookFor(memoryRef(this.subject.category));
    return book ? summarizePlaybook(book) : undefined;
  }

  // ── Interactions ──────────────────────────────────────────────────

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close') {
      this.close();
      return;
    }
    if (action === 'share') {
      this.share();
      return;
    }
    if (action === 'more') {
      this.showAllRunnersUp = true;
      if (this.view) this.renderBody(this.view, this.briefForSubject());
      return;
    }
    if (action === 'followup') {
      const q = target.textContent ?? '';
      if (q) this.renderAnswer(q);
      return;
    }
    const panelKey = target.closest<HTMLElement>('[data-panel-key]')?.dataset.panelKey;
    if (panelKey && this.subject) {
      recordAction(memoryRef(this.subject.category), 'panel-jump', panelKey);
      this.close();
      this.opts.onOpenPanel(panelKey);
    }
  }

  private share(): void {
    if (!this.subject || !this.view) return;
    const packet = buildSharePacket({
      shareId: `dossier-${this.subject.id}`,
      briefing: {
        title: this.view.title,
        generatedAt: Date.now(),
        summary: `${this.view.badge.text} — ${this.view.subline}`,
        category: this.subject.category,
        severityScore: this.subject.severityScore,
        confidence: this.subject.confidence,
        sections: [
          { heading: 'Why this surfaced', bullets: [...this.view.whySurfaced] },
          { heading: 'Evidence', bullets: this.view.evidence.map((c) => `${c.title} — ${c.statusLabel}`) },
          { heading: 'Timeline', bullets: this.view.timeline.map((r) => `${clock(r.at)} ${r.label}`) },
        ],
      },
    });
    void navigator.clipboard?.writeText(selectFormat(packet, 'markdown'));
    if (this.subject) recordAction(memoryRef(this.subject.category), 'export', 'dossier-share');
  }
}

// ── Module-private helpers ──────────────────────────────────────────

/**
 * Synthetic per-category action-memory key. `HypothesisRef.kind` is a
 * strict `HypothesisKind` union (analyst-loop hypotheses only); the
 * dossier isn't a hypothesis, so the synthetic `dossier:<category>`
 * string is cast through — signatureFor() only ever interpolates it
 * into a template string, never switches on it.
 */
function memoryRef(category: string): { kind: HypothesisKind; evidence: never[]; region: string } {
  return { kind: `dossier:${category}` as HypothesisKind, evidence: [], region: '' };
}

function readPipelineEvents(situationId: string): TraceEventLike[] | undefined {
  try {
    const entry = getPipelineTraceRegistry().get(situationId);
    if (!entry) return undefined;
    return entry.events.map((e) => ({ at: e.at, stage: e.stage, reason: e.reason }));
  } catch {
    return undefined;
  }
}

function readNotificationEvents(situationId: string): TraceEventLike[] | undefined {
  try {
    const entries = getNotificationTraceRegistry().bySituation(`nws-${situationId}`);
    if (entries.length === 0) return undefined;
    return entries.flatMap((t) => t.events.map((e) => ({ at: e.at, kind: e.kind, reason: e.reason })));
  } catch {
    return undefined;
  }
}

function grid(cards: readonly EvidenceCardView[]): HTMLElement {
  const g = el('div', 'hs-dossier-grid');
  for (const c of cards) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `hs-card hs-card-${c.tone}`;
    card.dataset.panelKey = c.panelId;
    card.append(el('div', 'hs-card-title', c.title));
    if (c.narrative) card.append(el('div', 'hs-card-narrative', c.narrative));
    card.append(el('div', 'hs-card-status', c.statusLabel));
    card.append(el('div', 'hs-card-reason', c.reason));
    g.append(card);
  }
  return g;
}

function renderTimeline(view: DossierView): HTMLElement {
  const timeline = el('div', 'hs-dossier-timeline');
  if (view.timeline.length === 0) {
    timeline.append(el('div', undefined, 'no trace events recorded'));
  }
  for (const row of view.timeline) {
    timeline.append(el('div', undefined, `${clock(row.at)} ${row.label}`));
  }
  return timeline;
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

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
