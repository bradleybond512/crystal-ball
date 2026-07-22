/**
 * AnalystHUD — floating overlay showing top analyst-loop hypotheses,
 * mode-forecast advisories, and the latest auto-brief.
 *
 * Toggles with ⌘⇧A (Ctrl+Shift+A on non-mac) or the `cb:toggle-analyst-hud`
 * event. Hidden by default. Subscribes to `cb:analyst-hypotheses`,
 * `cb:mode-advisory`, and `cb:auto-brief` for live updates.
 *
 * Evidence links call `jumpToPanel()` from alert-reactions so clicking a
 * citation scrolls the relevant panel into view.
 */

import { replaceChildren } from '@/utils/dom-utils';
import { formatDurationMinutes } from '@/utils/format-duration';
import { isGhostMode } from '@/services/mode-manager';
import { jumpToPanel, flashPanel } from '@/services/alert-reactions';
import { subscribeAnalyst, getAnalystSnapshot, type Hypothesis, type HypothesisEvidence, type AnalystSnapshot } from '@/services/analyst-loop';
import { subscribeModeAdvisory, getForecastSnapshot, type ForecastSnapshot, type ModeAdvisory } from '@/services/mode-forecast';
import { subscribeAutoBrief, getLatestBriefs, isAutoBriefEnabled, setAutoBriefEnabled, type AutoBrief } from '@/services/auto-brief';
import { thumbsUp, thumbsDown } from '@/services/hypothesis-feedback';
import { getKindAccuracy } from '@/services/hypothesis-accuracy';
import { getThreadFor } from '@/services/hypothesis-threads';
import { entitiesForHypothesis, entitiesFromHypothesis, getHotEntities, type EntityMention } from '@/services/hypothesis-entities';
import { getSkepticNote, isSkepticEnabled, setSkepticEnabled, subscribeSkeptic } from '@/services/hypothesis-skeptic';
import { getAlternativeView, isAlternativesEnabled, setAlternativesEnabled, subscribeAlternatives } from '@/services/hypothesis-alternatives';
import { getPressureHistory, buildSparklinePath, subscribePressureHistory } from '@/services/pressure-history';
import { getPlaybookFor, summarizePlaybook, recordAction, noteRecurrence } from '@/services/action-memory';
import { suggestQuestionsRanked, getCachedAnswer, askQuestion, subscribeQuestionAnswered } from '@/services/question-suggester';
import { getArchive, subscribeBriefingArchive } from '@/services/briefing-archive';
import { projectHypothesis, getCachedProjection, subscribeProjection } from '@/services/hypothesis-projection';
import { exportHypothesisToClipboard } from '@/services/hypothesis-export';
import { getBudgetStatus, subscribeBudget, setCloudCap, resetBudget } from '@/services/llm-budget';
import { getTotalErrorCount, subscribeDebug, logDebug } from '@/services/reasoning-debug';
import { isLlmEgressDisclosed, setLlmEgressDisclosed, isLocalModelOnly, setLocalModelOnly, subscribeLlmEgressChange } from '@/services/ai-flow-settings';
import { getAllSnapshots, subscribeSnapshotArchive } from '@/services/snapshot-archive';
import { runEnsemble, getCachedEnsemble, subscribeEnsemble } from '@/services/hypothesis-ensemble';
import { forecastAll, type HypothesisForecast } from '@/services/intelligence/hypothesis-forecast';
import { requestSuperforecast, getCachedSuperforecast } from '@/services/cognition/superforecast-state';
import { buildForecastProvenanceLines, buildSuperforecastLines } from './forecast-provenance-view';
import { buildCheckNextItems } from '@/services/cognition/evoi-surface';
import type { CollectionAction } from '@/services/cognition/evoi-planner';
import { recall, type Recall } from '@/services/cognition/episodic-memory';
import { subscribeCognitionFlags } from '@/services/cognition/cognition-settings';
import { getLatestPCI } from '@/services/intelligence/predictive-crisis-index';
import type { ForecastDomain } from '@/services/mode-forecast';
import type { PressureSample } from '@/services/pressure-history';

const MAX_VISIBLE = 5;

/** Re-run episodic recall for a hypothesis at most every 5 minutes. */
const ANALOG_CACHE_TTL_MS = 5 * 60_000;
/** Hard cap on cached analog recalls (hypothesis ids churn across cycles). */
const ANALOG_CACHE_MAX = 40;

const RISK_COLORS: Record<Hypothesis['risk'], string> = {
  critical: '#c0392b',
  high: '#e67e22',
  moderate: '#f39c12',
  low: '#27ae60',
};

const DOMAIN_GLYPH = {
  finance: '$', security: '*', disaster: '!', cyber: '#',
} as const;

function ageLabel(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 1) return 'now';
  return formatDurationMinutes(mins);
}

/**
 * Replay-scrubber label. When the snapshot is current, `ageLabel` returns
 * "now" — appending " ago" produced the "now ago · 120/120" bug, so suppress
 * the suffix for the live case. `ageMs === null` (no snapshot) is also "now".
 */
export function formatScrubberLabel(ageMs: number | null, oneBasedIdx: number, total: number): string {
  const ago = ageMs === null ? 'now' : ageLabel(ageMs);
  const rel = ago === 'now' ? 'now' : `${ago} ago`;
  return `${rel} · ${oneBasedIdx}/${total}`;
}

function simButtonLabel(loading: boolean, cached: boolean, expanded: boolean): string {
  if (loading) return 'Projecting…';
  if (!cached) return '⟳ Project';
  return expanded ? '⟳ hide ▾' : '⟳ Project ▸';
}

function ensembleButtonLabel(loading: boolean, cached: boolean, expanded: boolean): string {
  if (loading) return 'perspectives…';
  if (!cached) return 'perspectives ▸';
  return expanded ? 'hide ▾' : 'perspectives ▾';
}

function superforecastButtonLabel(loading: boolean, cached: boolean, expanded: boolean): string {
  if (loading) return 'forecasting…';
  if (!cached) return 'deep forecast ▸';
  return expanded ? 'hide ▾' : 'deep forecast ▾';
}

/**
 * True when a non-global key should be swallowed because the user is typing
 * in a field. Escape and Tab never route through this — they must work even
 * when focus sits on the replay-scrubber range input or a settings checkbox
 * (the live-repro cause of "Esc sometimes doesn't close the HUD").
 */
function shouldIgnoreKey(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

export class AnalystHUD {
  private readonly root: HTMLElement;
  /** localStorage key for remembering the HUD's open/closed state across boots
   *  so it doesn't surprise-open — only user-initiated show/hide persist; the
   *  egress-disclosure auto-show passes persist:false so it never sticks. */
  private static readonly OPEN_STATE_KEY = 'cb:analyst-hud-open';

  private snapshot: AnalystSnapshot | null = null;
  private forecast: ForecastSnapshot | null = null;
  private briefs: Record<string, AutoBrief | undefined> = {};
  private pressure: Record<ForecastDomain, PressureSample[]>;
  private visible = false;
  private expandedSkeptic = new Set<string>();
  private expandedAlternative = new Set<string>();
  private expandedQuestion = new Set<string>();
  private loadingQuestion = new Set<string>();
  private loadingProjection = new Set<string>();
  private expandedProjection = new Set<string>();
  private loadingEnsemble = new Set<string>();
  private expandedEnsemble = new Set<string>();
  private loadingSuperforecast = new Set<string>();
  private expandedSuperforecast = new Set<string>();
  private exportedFlash: { id: string; at: number } | null = null;
  private outcomeSubmitted = new Set<string>();
  // ── Cognition surfacing (Wave 5a) ─────────────────────────────────────────
  /** EVOI "What to check next" memo — recomputed when the snapshot changes. */
  private evoiMemo: { key: string; items: CollectionAction[] } | null = null;
  /** Episodic analog recalls keyed by hypothesis id (async, size-capped). */
  private readonly analogCache = new Map<string, { recalls: Recall[]; loadedAt: number }>();
  private readonly loadingAnalogs = new Set<string>();
  private readonly expandedAnalogs = new Set<string>();
  /** `${hypId}||${episodeId}` keys with the detail disclosure open. */
  private readonly expandedAnalogDetail = new Set<string>();
  // Anchor the replay position to a SNAPSHOT TIMESTAMP, not an index.
  // Index-based replay drifts silently when the archive evicts the oldest
  // snapshots (120-slot ring buffer): what the user had as index 5 before
  // eviction becomes a different snapshot after eviction. Timestamps stay
  // stable across evictions; we resolve them to an index at render time
  // via findNearestSnapshot. `null` = live.
  private replayAtTimestamp: number | null = null;
  private selectedHypothesisIndex = 0;
  private settingsOpen = false;
  private renderScheduled = false;
  /** Wall-clock ms of the last show/hide transition — used to debounce
   *  double-fired toggle events that would re-open right after a close. */
  private lastVisibilityChangeAt = 0;
  /** Element focused before the HUD opened; restored on close. */
  private previouslyFocused: HTMLElement | null = null;
  private readonly _cleanups: (() => void)[] = [];

  private readonly onExportCopied = (e: Event): void => {
    const ce = e as CustomEvent<{ hypothesisId: string }>;
    this.exportedFlash = { id: ce.detail.hypothesisId, at: Date.now() };
    this.scheduleRender();
  };

  // When llm-adapter blocks a cloud call because disclosure hasn't been
  // acknowledged yet, show the disclosure banner in the HUD.
  private readonly onEgressDisclosure = (): void => {
    // NEVER force-open the HUD. auto-brief / analyst-loop call generateText on
    // cadences, and every blocked cloud call (egress undisclosed) fires this;
    // force-opening re-opened the HUD immediately after the user closed it, so
    // Esc/X looked dead. The banner still renders (render() gates on
    // isLlmEgressDisclosed) whenever the user opens the HUD via ⌘⇧A / toggle.
    if (this.visible) this.scheduleRender();
  };

  private persistOpenState(open: boolean): void {
    try { localStorage.setItem(AnalystHUD.OPEN_STATE_KEY, open ? '1' : '0'); } catch { /* best effort */ }
  }

  private readonly onToggle = (e: Event): void => {
    // Guard against double-fire re-open races: a second toggle landing
    // within 250ms of an open/close transition would instantly undo it
    // (user closes HUD → stray duplicate event re-opens it).
    const sinceTransition = Date.now() - this.lastVisibilityChangeAt;
    if (sinceTransition < 250) {
      const source = (e as CustomEvent<{ source?: string }>).detail?.source ?? 'unknown';
      logDebug({
        level: 'warn',
        category: 'hud',
        source: 'AnalystHUD',
        message: `ignored toggle ${sinceTransition}ms after last visibility transition`,
        data: { source },
      });
      return;
    }
    this.toggle();
  };

  private readonly onFeedback = (): void => { if (this.visible) this.render(); };

  private readonly onKeydown = (e: KeyboardEvent): void => this.handleKeydown(e);

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'analyst-hud';
    this.root.hidden = true;
    // Dialog semantics + focusable container so Esc lands here after open.
    this.root.tabIndex = -1;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Analyst HUD');
    // Every control here is delegated on the stable root: render() rebuilds
    // each card via replaceChildren on every one of the HUD's ~16
    // subscriptions, so a background re-render between pointerdown and
    // pointerup orphans a directly-bound node and the browser never
    // synthesizes the click. State travels in data-* attributes read back at
    // click time. Split across helpers to keep each dispatcher legible.
    this.root.addEventListener('click', (e) => this.onRootClick(e));
    this.snapshot = getAnalystSnapshot();
    this.forecast = getForecastSnapshot();
    this.briefs = getLatestBriefs();
    this.pressure = getPressureHistory();
  }

  mount(parent: HTMLElement): void {
    parent.append(this.root);
    // All event-driven re-renders go through scheduleRender() to coalesce
    // bursts (e.g. analyst-hypotheses + auto-brief + question-answered all
    // arriving in the same tick) into a single rAF-aligned render.
    const unsubAnalyst = subscribeAnalyst((snap) => {
      this.snapshot = snap;
      // Record recurrence ONCE per snapshot (not once per render) —
      // otherwise event bursts cause recurrenceCount to balloon by 10-30×
      // per actual cycle, polluting playbooks + hammering IDB writes.
      for (const h of snap.hypotheses.slice(0, MAX_VISIBLE)) noteRecurrence(h);
      this.scheduleRender();
    });
    const unsubModeAdvisory = subscribeModeAdvisory((f) => {
      this.forecast = f;
      this.scheduleRender();
    });
    const unsubAutoBrief = subscribeAutoBrief((brief) => {
      this.briefs[brief.domain] = brief;
      this.scheduleRender();
    });
    const unsubPressureHistory = subscribePressureHistory((h) => {
      this.pressure = h;
      this.scheduleRender();
    });
    const unsubSkeptic = subscribeSkeptic(() => { this.scheduleRender(); });
    const unsubAlternatives = subscribeAlternatives(() => { this.scheduleRender(); });
    const unsubQuestionAnswered = subscribeQuestionAnswered(() => { this.scheduleRender(); });
    const unsubBriefingArchive = subscribeBriefingArchive(() => { this.scheduleRender(); });
    const unsubProjection = subscribeProjection(() => { this.scheduleRender(); });
    document.addEventListener('cb:hypothesis-export-copied', this.onExportCopied);
    const unsubBudget = subscribeBudget(() => { this.scheduleRender(); });
    const unsubDebug = subscribeDebug((entry) => {
      // Only re-render on errors (to refresh the footer counter) — info
      // and warn entries are too chatty.
      if (entry.level === 'error') this.scheduleRender();
    });
    const unsubSnapshotArchive = subscribeSnapshotArchive(() => {
      // Only scroll the view on new archived snapshots when we're live.
      // When replayed, the user's anchor timestamp resolves to the same
      // snapshot regardless, so no re-render is needed.
      if (this.replayAtTimestamp === null) this.scheduleRender();
    });
    const unsubEnsemble = subscribeEnsemble(() => { this.scheduleRender(); });
    const unsubCognitionFlags = subscribeCognitionFlags(() => {
      // Kill-switch flips must reflect immediately: drop the EVOI memo and
      // analog caches so disabled surfaces empty on the next render.
      this.evoiMemo = null;
      this.analogCache.clear();
      this.scheduleRender();
    });
    const unsubLlmEgressChange = subscribeLlmEgressChange(() => { this.scheduleRender(); });
    document.addEventListener('cb:llm-egress-disclosure-needed', this.onEgressDisclosure);
    document.addEventListener('cb:toggle-analyst-hud', this.onToggle);
    document.addEventListener('cb:hypothesis-feedback', this.onFeedback);
    document.addEventListener('keydown', this.onKeydown);
    this._cleanups.push(
      unsubAnalyst,
      unsubModeAdvisory,
      unsubAutoBrief,
      unsubPressureHistory,
      unsubSkeptic,
      unsubAlternatives,
      unsubQuestionAnswered,
      unsubBriefingArchive,
      unsubProjection,
      unsubCognitionFlags,
      () => document.removeEventListener('cb:hypothesis-export-copied', this.onExportCopied),
      unsubBudget,
      unsubDebug,
      unsubSnapshotArchive,
      unsubEnsemble,
      unsubLlmEgressChange,
      () => document.removeEventListener('cb:llm-egress-disclosure-needed', this.onEgressDisclosure),
      () => document.removeEventListener('cb:toggle-analyst-hud', this.onToggle),
      () => document.removeEventListener('cb:hypothesis-feedback', this.onFeedback),
      () => document.removeEventListener('keydown', this.onKeydown),
    );

    // Remember last state: reopen only if the user had it open when they quit.
    // A HUD they closed stays closed on boot (no surprise auto-open); the only
    // thing that can still auto-show is a pending egress disclosure (persist:false).
    let wasOpen = false;
    try { wasOpen = localStorage.getItem(AnalystHUD.OPEN_STATE_KEY) === '1'; } catch { /* default closed */ }
    if (wasOpen) this.show();
  }

  destroy(): void {
    this.visible = false;
    for (const fn of this._cleanups) fn();
    this._cleanups.length = 0;
    this.root.remove();
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (!this.visible) return;
    // Escape + Tab are global while the HUD is open — they must work even
    // when focus sits inside an input (scrubber slider, settings toggles).
    if (e.key === 'Escape' || e.key === 'Tab') {
      this.handleGlobalKey(e);
      return;
    }
    if (shouldIgnoreKey(e)) return;
    if (this.handleGlobalKey(e)) return;
    this.handleNavigationKey(e);
  }

  private handleGlobalKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      if (this.settingsOpen) { this.settingsOpen = false; this.render(); }
      else this.hide();
      e.preventDefault();
      return true;
    }
    if (e.key === 'Tab') {
      this.trapFocus(e);
      return true;
    }
    if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
      this.settingsOpen = !this.settingsOpen;
      this.render();
      e.preventDefault();
      return true;
    }
    return false;
  }

  /** Minimal focus trap: Tab cycles within the HUD while it's open. */
  private trapFocus(e: KeyboardEvent): void {
    const focusables = [...this.root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select, textarea, [href], [tabindex]:not([tabindex="-1"])',
    )].filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    // Treat focus on the dialog root itself (show() parks focus there) as
    // "not inside a control", so the first Tab / Shift+Tab wraps to first/last
    // instead of escaping behind the modal.
    const inside = active !== null && active !== this.root && this.root.contains(active);
    if (e.shiftKey) {
      if (!inside || active === first) { last.focus(); e.preventDefault(); }
    } else if (!inside || active === last) {
      first.focus();
      e.preventDefault();
    }
  }

  private handleNavigationKey(e: KeyboardEvent): void {
    const snap = this.effectiveSnapshot();
    const count = Math.min(MAX_VISIBLE, snap?.hypotheses.length ?? 0);
    if (count === 0) return;
    if (e.key === 'ArrowDown') {
      this.selectedHypothesisIndex = Math.min(count - 1, this.selectedHypothesisIndex + 1);
      this.render();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      this.selectedHypothesisIndex = Math.max(0, this.selectedHypothesisIndex - 1);
      this.render();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const h = snap?.hypotheses[this.selectedHypothesisIndex];
      if (!h) return;
      const set = e.shiftKey ? this.expandedEnsemble : this.expandedProjection;
      this.toggleExpandedSet(set, h.id);
      this.render();
      e.preventDefault();
    }
  }

  private toggleExpandedSet(set: Set<string>, id: string): void {
    if (set.has(id)) set.delete(id);
    else set.add(id);
  }

  toggle(): void { if (this.visible) this.hide(); else this.show(); }

  /**
   * Coalesce repeat render() calls within the same frame. Multiple events
   * (e.g. analyst-hypotheses + auto-brief + question-answered) commonly
   * fire in the same tick; without this, each one would rebuild the entire
   * card.
   */
  private scheduleRender(): void {
    if (!this.visible) return;
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback): number => {
          setTimeout(() => cb(Date.now()), 16);
          return 0;
        };
    raf(() => {
      this.renderScheduled = false;
      if (this.visible) this.render();
    });
  }

  show(persist = true): void {
    if (this.visible) return;
    this.visible = true;
    if (persist) this.persistOpenState(true);
    this.lastVisibilityChangeAt = Date.now();
    this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    this.render();
    // Focus the dialog container (tabindex=-1) so Esc/Tab land inside it
    // immediately, regardless of what was focused before.
    this.root.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent<{ visible: boolean }>('cb:analyst-hud-visibility', { detail: { visible: true } }));
  }

  hide(persist = true): void {
    if (!this.visible) return;
    this.visible = false;
    if (persist) this.persistOpenState(false);
    this.lastVisibilityChangeAt = Date.now();
    this.root.hidden = true;
    document.dispatchEvent(new CustomEvent<{ visible: boolean }>('cb:analyst-hud-visibility', { detail: { visible: false } }));
    // Restore focus to wherever the user was before opening.
    if (this.previouslyFocused?.isConnected) {
      this.previouslyFocused.focus({ preventScroll: true });
    }
    this.previouslyFocused = null;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private render(): void {
    const card = document.createElement('div');
    card.className = 'analyst-hud-card';
    card.append(
      this.buildHeader(),
      this.buildAdvisorySection(),
      this.buildHotEntitiesSection(),
      this.buildHypothesesSection(),
      this.buildCheckNextSection(),
      this.buildBriefsSection(),
      this.buildTimelineSection(),
      this.buildFooter(),
    );
    if (this.settingsOpen) card.append(this.buildSettingsOverlay());
    replaceChildren(this.root, card);
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'analyst-hud-header';

    const title = document.createElement('h2');
    title.textContent = 'Analyst HUD';

    const aiBadge = document.createElement('span');
    aiBadge.className = 'analyst-hud-ai-badge';
    // Reflect the snapshot actually being displayed (live or replayed).
    const effective = this.effectiveSnapshot();
    aiBadge.textContent = effective?.aiEnriched ? 'AI' : 'templates';
    aiBadge.title = effective?.aiEnriched
      ? 'Clusters enriched by Claude agent'
      : 'Template-based reasoning (no AI)';

    const settings = document.createElement('button');
    settings.className = 'analyst-hud-settings-btn-inline';
    settings.textContent = '⚙';
    settings.title = 'Settings (⌘,)';
    settings.addEventListener('click', () => {
      this.settingsOpen = !this.settingsOpen;
      this.render();
    });

    const close = document.createElement('button');
    close.className = 'analyst-hud-close';
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Close (Esc)';
    close.setAttribute('aria-label', 'Close');
    // Click handling is delegated on this.root (survives re-renders).

    header.append(title, aiBadge, settings, close);
    return header;
  }

  private buildAdvisorySection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'analyst-hud-section';

    const h = document.createElement('h3');
    h.textContent = 'Posture Advisories';
    sec.append(h);

    const advisories = this.forecast?.advisories ?? [];
    if (advisories.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analyst-hud-empty';
      empty.textContent = 'No elevated-pressure domains.';
      sec.append(empty);
      return sec;
    }
    for (const advisory of advisories) sec.append(this.buildAdvisoryRow(advisory));
    return sec;
  }

  private buildAdvisoryRow(advisory: ModeAdvisory): HTMLElement {
    const row = document.createElement('div');
    row.className = 'analyst-hud-advisory';
    const glyph = DOMAIN_GLYPH[advisory.domain];
    const pct = (advisory.pressure * 100).toFixed(0);
    const body = document.createElement('div');
    body.className = 'analyst-hud-advisory-body';
    body.textContent = `[${glyph}] ${advisory.statement}`;

    const meterRow = document.createElement('div');
    meterRow.className = 'analyst-hud-advisory-meter-row';
    const bar = document.createElement('div');
    bar.className = 'analyst-hud-meter';
    const fill = document.createElement('div');
    fill.className = 'analyst-hud-meter-fill';
    fill.style.width = `${pct}%`;
    bar.append(fill);
    const spark = this.buildSparkline(advisory.domain);
    meterRow.append(bar, spark);

    row.append(body, meterRow);
    return row;
  }

  private buildSparkline(domain: ForecastDomain): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'analyst-hud-sparkline');
    svg.setAttribute('width', '80');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 80 18');
    const series = this.pressure[domain] ?? [];
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', buildSparklinePath(series, 80, 18));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.2');
    svg.append(path);
    return svg;
  }

  private buildHotEntitiesSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'analyst-hud-section';
    const h = document.createElement('h3');
    h.textContent = 'Hot Entities';
    sec.append(h);

    const hot = getHotEntities().slice(0, 12);
    if (hot.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analyst-hud-empty';
      empty.textContent = 'No entities span multiple hypotheses.';
      sec.append(empty);
      return sec;
    }
    const row = document.createElement('div');
    row.className = 'analyst-hud-hot-entities';
    for (const m of hot) row.append(this.buildEntityChip(m, true));
    sec.append(row);
    return sec;
  }

  private buildEntityChip(m: EntityMention, includeCount: boolean): HTMLElement {
    const chip = document.createElement('span');
    chip.className = `analyst-hud-entity-chip analyst-hud-entity-${m.kind}`;
    chip.textContent = includeCount ? `${m.entity} ×${m.hypothesisIds.length}` : m.entity;
    chip.title = `${m.kind} — appears in ${m.hypothesisIds.length} hypotheses`;
    return chip;
  }

  private effectiveSnapshot(): AnalystSnapshot | null {
    if (this.replayAtTimestamp === null) return this.snapshot;
    const history = getAllSnapshots();
    if (history.length === 0) return this.snapshot;
    // Find the nearest snapshot to the anchored timestamp. Stable across
    // archive evictions.
    let best = history[0];
    if (!best) return this.snapshot;
    let bestDelta = Math.abs(best.timestamp - this.replayAtTimestamp);
    for (const snap of history) {
      const delta = Math.abs(snap.timestamp - this.replayAtTimestamp);
      if (delta < bestDelta) { best = snap; bestDelta = delta; }
    }
    return best;
  }

  private buildHypothesesSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'analyst-hud-section';

    const h = document.createElement('h3');
    const snap = this.effectiveSnapshot();
    const isReplay = this.replayAtTimestamp !== null;
    h.textContent = isReplay && snap
      ? `Hypotheses — replay ${ageLabel(Date.now() - snap.timestamp)} ago`
      : 'Hypotheses';
    sec.append(h);

    sec.append(this.buildReplayScrubber());

    const hypotheses = snap?.hypotheses ?? [];
    const visible = hypotheses.slice(0, MAX_VISIBLE);
    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analyst-hud-empty';
      empty.textContent = 'No cross-domain convergence detected.';
      sec.append(empty);
      return sec;
    }
    // Clamp the selection if the list shrank. Use Math.max(0, …) so we
    // don't end up at -1 when the list is empty.
    if (this.selectedHypothesisIndex >= visible.length) {
      this.selectedHypothesisIndex = Math.max(0, visible.length - 1);
    }
    visible.forEach((h, i) => {
      const row = this.buildHypothesisRow(h);
      if (i === this.selectedHypothesisIndex) {
        row.classList.add('analyst-hud-hyp-selected');
      }
      sec.append(row);
    });
    return sec;
  }

  /**
   * "What to check next" — top EVOI-ranked collection actions across the
   * visible hypotheses. Rows navigate to the relevant panel when the action
   * carries a panelId (delegated on this.root via data-evoi-panel).
   */
  private buildCheckNextSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'analyst-hud-section';

    const h = document.createElement('h3');
    h.textContent = 'What to check next';
    sec.append(h);

    const items = this.checkNextItems();
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analyst-hud-empty';
      empty.textContent = 'No high-value checks right now.';
      sec.append(empty);
      return sec;
    }

    const list = document.createElement('div');
    list.className = 'analyst-hud-evoi-list';
    for (const action of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'analyst-hud-evoi-row';
      row.title = action.explanation;
      const bits = action.expectedInfoGainBits.toFixed(2);
      row.setAttribute('aria-label', `${action.label} — expected gain ${bits} bits`);
      if (action.panelId) {
        row.dataset.evoiPanel = action.panelId;
      } else {
        row.disabled = true;
        row.classList.add('analyst-hud-evoi-row-static');
      }
      const label = document.createElement('span');
      label.className = 'analyst-hud-evoi-label';
      label.textContent = action.label;
      const badge = document.createElement('span');
      badge.className = 'analyst-hud-evoi-badge';
      badge.textContent = `+${bits} bits`;
      row.append(label, badge);
      list.append(row);
    }
    sec.append(list);
    return sec;
  }

  /** Memoized EVOI items for the currently displayed snapshot. */
  private checkNextItems(): CollectionAction[] {
    const snap = this.effectiveSnapshot();
    const visible = (snap?.hypotheses ?? []).slice(0, MAX_VISIBLE);
    const key = `${snap?.timestamp ?? 0}|${visible.length}`;
    if (this.evoiMemo?.key === key) return this.evoiMemo.items;
    const forecasts = visible.length > 0 ? forecastAll(visible, getLatestPCI()) : [];
    const byId = new Map(forecasts.map(f => [f.hypothesisId, f] as const));
    const items = buildCheckNextItems(visible.map(h => ({
      kind: h.kind,
      statement: h.statement,
      probability: byId.get(h.id)?.probability ?? h.confidence,
    })));
    this.evoiMemo = { key, items };
    return items;
  }

  private buildSettingsOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'analyst-hud-settings';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.settingsOpen = false;
        this.render();
      }
    });

    const card = document.createElement('div');
    card.className = 'analyst-hud-settings-card';

    const title = document.createElement('h3');
    title.textContent = 'Analyst HUD settings';
    card.append(title);

    card.append(
      this.buildSettingToggle('Auto-generate brief on critical crossover',
        isAutoBriefEnabled(), setAutoBriefEnabled),
      this.buildSettingToggle('Run skeptic pass on high/critical hypotheses',
        isSkepticEnabled(), setSkepticEnabled),
      this.buildSettingToggle('Local model only (disable cloud LLM fallback)',
        isLocalModelOnly(), setLocalModelOnly),
      this.buildCloudCapSlider(),
    );

    const resetRow = document.createElement('div');
    resetRow.className = 'analyst-hud-settings-row';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'analyst-hud-settings-btn';
    resetBtn.textContent = 'Reset LLM budget';
    resetBtn.title = 'Zero today\'s cloud+local counters.';
    resetBtn.addEventListener('click', () => { resetBudget(); });
    resetRow.append(resetBtn);
    card.append(resetRow);

    const close = document.createElement('button');
    close.className = 'analyst-hud-settings-close';
    close.textContent = 'Close (Esc)';
    close.addEventListener('click', () => {
      this.settingsOpen = false;
      this.render();
    });
    card.append(close);

    overlay.append(card);
    return overlay;
  }

  private buildSettingToggle(label: string, checked: boolean, set: (v: boolean) => void): HTMLElement {
    const row = document.createElement('label');
    row.className = 'analyst-hud-settings-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.addEventListener('change', () => {
      set(cb.checked);
      this.render();
    });
    const span = document.createElement('span');
    span.textContent = label;
    row.append(cb, span);
    return row;
  }

  private buildCloudCapSlider(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'analyst-hud-settings-row';
    const label = document.createElement('label');
    label.textContent = 'Daily cloud-LLM cap: ';
    const budget = getBudgetStatus();
    const value = document.createElement('span');
    value.className = 'analyst-hud-settings-value';
    value.textContent = String(budget.cap);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '500';
    slider.step = '5';
    slider.value = String(budget.cap);
    slider.addEventListener('input', () => {
      value.textContent = slider.value;
    });
    slider.addEventListener('change', () => { setCloudCap(Number(slider.value)); });
    label.append(value);
    row.append(label, slider);
    return row;
  }

  private buildReplayScrubber(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-scrubber';
    const history = getAllSnapshots();
    if (history.length < 2) {
      // Nothing meaningful to replay.
      return wrap;
    }
    const max = history.length - 1;
    // Resolve the anchored timestamp to a stable index in the current
    // archive for slider position. Live view pins at max.
    let currentIdx = max;
    if (this.replayAtTimestamp !== null) {
      let bestDelta = Infinity;
      history.forEach((snap, i) => {
        const delta = Math.abs(snap.timestamp - this.replayAtTimestamp!);
        if (delta < bestDelta) { bestDelta = delta; currentIdx = i; }
      });
    }

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(max);
    slider.value = String(currentIdx);
    slider.className = 'analyst-hud-scrubber-slider';
    slider.addEventListener('input', () => {
      const idx = Number.parseInt(slider.value, 10);
      // Anchor to the selected snapshot's timestamp (null = live). Stays
      // stable as the archive evicts older snapshots.
      this.replayAtTimestamp = idx === max ? null : (history[idx]?.timestamp ?? null);
      this.render();
    });

    const live = document.createElement('button');
    live.className = 'analyst-hud-scrubber-live';
    live.dataset.scrubberLive = '1';
    live.textContent = this.replayAtTimestamp === null ? 'live' : 'go live';
    live.disabled = this.replayAtTimestamp === null;

    const label = document.createElement('span');
    label.className = 'analyst-hud-scrubber-label';
    const snap = history[currentIdx];
    label.textContent = formatScrubberLabel(
      snap ? Date.now() - snap.timestamp : null, currentIdx + 1, max + 1,
    );

    wrap.append(slider, label, live);
    return wrap;
  }

  private buildHypothesisRow(h: Hypothesis): HTMLElement {
    const row = document.createElement('div');
    row.className = 'analyst-hud-hyp';
    row.style.borderLeftColor = RISK_COLORS[h.risk];
    // Note: recurrence is recorded once per snapshot in the subscribeAnalyst
    // handler, NOT here — render can fire many times per snapshot.

    const forecasts = forecastAll([h], getLatestPCI());

    row.append(
      this.buildHypHead(h),
      ...(forecasts[0] ? [this.buildForecastBar(forecasts[0])] : []),
      this.buildHypStatement(h),
      this.buildHypPlaybook(h),
      this.buildHypEntities(h),
      this.buildHypEvidence(h),
      this.buildHypAnalogs(h),
      this.buildHypQuestions(h),
      this.buildHypSkeptic(h),
      this.buildHypAlternatives(h),
      this.buildHypProjection(h),
      this.buildHypSuperforecast(h),
      this.buildHypEnsemble(h),
      this.buildHypActions(h),
    );
    return row;
  }

  private buildHypEnsemble(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-ensemble';
    const cached = getCachedEnsemble(h);
    if (!cached || !this.expandedEnsemble.has(h.id)) return wrap;
    if (cached.takes.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analyst-hud-ensemble-empty';
      empty.textContent = cached.partial
        ? 'Ensemble partial — cloud budget exhausted or all personas failed.'
        : 'No takes returned.';
      wrap.append(empty);
      return wrap;
    }
    for (const take of cached.takes) {
      const line = document.createElement('p');
      line.className = `analyst-hud-ensemble-take analyst-hud-ensemble-${take.persona}`;
      const label = document.createElement('strong');
      label.textContent = `${take.persona}: `;
      line.append(label, document.createTextNode(take.text));
      wrap.append(line);
    }
    return wrap;
  }

  private buildHypProjection(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-projection';
    const projection = getCachedProjection(h);
    if (!projection || !this.expandedProjection.has(h.id)) return wrap;
    const body = document.createElement('p');
    body.className = 'analyst-hud-projection-body';
    body.textContent = `[${projection.provider}] ${projection.narrative}`;
    wrap.append(body);
    if (projection.cascade) {
      const cas = document.createElement('p');
      cas.className = 'analyst-hud-projection-cascade';
      cas.textContent =
        `Cascade sim: ${projection.cascade.triggerName} — ${projection.cascade.effects.length} effects, ` +
        `~${projection.cascade.estimatedRecoveryHours}h recovery, risk ${projection.cascade.riskScore}/100.`;
      wrap.append(cas);
    }
    return wrap;
  }

  private buildHypSuperforecast(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-superforecast';
    const sf = getCachedSuperforecast(h);
    if (!sf || !this.expandedSuperforecast.has(h.id)) return wrap;
    for (const text of buildSuperforecastLines(sf)) {
      const line = document.createElement('p');
      line.className = 'analyst-hud-superforecast-line';
      line.textContent = text;
      wrap.append(line);
    }
    return wrap;
  }

  private buildHypPlaybook(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-playbook';
    const book = getPlaybookFor(h);
    if (!book || book.actions.length === 0) return wrap;
    const line = document.createElement('span');
    line.className = 'analyst-hud-playbook-line';
    line.textContent = summarizePlaybook(book);
    wrap.append(line);
    return wrap;
  }

  private buildHypQuestions(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-questions';
    const questions = suggestQuestionsRanked(h);
    for (const q of questions) {
      wrap.append(this.buildQuestionChip(h, q.question, q.fromEvoi ? q.bits : null));
    }
    return wrap;
  }

  private buildQuestionChip(h: Hypothesis, question: string, evoiBits: number | null): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-question';
    const key = `${h.id}||${question}`;
    const cached = getCachedAnswer(h, question);
    const loading = this.loadingQuestion.has(key);
    const expanded = this.expandedQuestion.has(key);
    // textContent below is auto-escaping (no innerHTML) — safe for the
    // EVOI-derived bits suffix same as the rest of this chip's text.
    const suffix = evoiBits === null ? '' : ` +${evoiBits.toFixed(1)} bits`;

    const chip = document.createElement('button');
    chip.className = 'analyst-hud-question-chip';
    chip.dataset.questionHypId = h.id;
    chip.dataset.questionText = question;
    chip.textContent = loading ? `? ${question}${suffix} …` : `? ${question}${suffix}`;
    chip.disabled = loading;
    chip.title = cached
      ? 'Cached answer — click to toggle'
      : 'Ask Claude (local if configured) and cache the answer';
    wrap.append(chip);
    if (cached && expanded) {
      const body = document.createElement('p');
      body.className = 'analyst-hud-question-answer';
      body.textContent = `[${cached.provider}] ${cached.text}`;
      wrap.append(body);
    }
    return wrap;
  }

  private buildTimelineSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'analyst-hud-section';
    const h = document.createElement('h3');
    h.textContent = 'Briefing Timeline';
    sec.append(h);
    const items = getArchive().slice(0, 8);
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analyst-hud-empty';
      empty.textContent = 'No briefings archived yet.';
      sec.append(empty);
      return sec;
    }
    const list = document.createElement('div');
    list.className = 'analyst-hud-timeline';
    for (const brief of items) {
      const row = document.createElement('div');
      row.className = 'analyst-hud-timeline-row';
      const agoLabel = ageLabel(Date.now() - brief.generatedAt);
      const head = document.createElement('span');
      head.className = 'analyst-hud-timeline-head';
      const providerSuffix = brief.provider ? ` (${brief.provider})` : '';
      head.textContent = `${agoLabel} · ${brief.domain}${providerSuffix}`;
      const body = document.createElement('span');
      body.className = 'analyst-hud-timeline-body';
      body.textContent = brief.summary || brief.text.slice(0, 160);
      row.append(head, body);
      list.append(row);
    }
    sec.append(list);
    return sec;
  }

  private buildHypHead(h: Hypothesis): HTMLElement {
    const head = document.createElement('div');
    head.className = 'analyst-hud-hyp-head';
    const kind = document.createElement('span');
    kind.className = 'analyst-hud-hyp-kind';
    kind.textContent = h.kind;
    const risk = document.createElement('span');
    risk.className = 'analyst-hud-hyp-risk';
    risk.textContent = h.risk;
    risk.style.color = RISK_COLORS[h.risk];
    const conf = document.createElement('span');
    conf.className = 'analyst-hud-hyp-conf';
    conf.textContent = `${(h.confidence * 100).toFixed(0)}%`;

    const thread = getThreadFor(h);
    head.append(kind, risk, conf);

    const accuracy = getKindAccuracy();
    const kindStats = accuracy.get(h.kind);
    if (kindStats) {
      const total = kindStats.hits + kindStats.misses;
      if (total >= 3) {
        const acc = document.createElement('span');
        acc.className = 'analyst-hud-hyp-accuracy';
        acc.textContent = `${Math.round((kindStats.hits / total) * 100)}% acc`;
        acc.title = `${h.kind} accuracy: ${kindStats.hits} hits / ${total} graded`;
        head.append(acc);
      }
    }
    const fused = (h as Hypothesis & { fusedFrom?: string[] }).fusedFrom;
    if (fused && fused.length > 0) {
      const fuseBadge = document.createElement('span');
      fuseBadge.className = 'analyst-hud-fused';
      fuseBadge.textContent = `+${fused.length}`;
      fuseBadge.title = `Fused from: ${fused.join(', ')}`;
      head.append(fuseBadge);
    }
    if (thread && thread.cycleCount > 1) {
      const badge = document.createElement('span');
      badge.className = `analyst-hud-thread analyst-hud-thread-${thread.trajectory}`;
      const TRAJECTORY_ARROW = { strengthening: 'up', weakening: 'down', stable: 'flat', new: 'new' } as const;
      const arrow = TRAJECTORY_ARROW[thread.trajectory];
      badge.textContent = `${thread.cycleCount}c ${arrow}`;
      badge.title = `Thread: ${thread.cycleCount} cycles, ${thread.trajectory}, peak=${thread.peakRisk}`;
      head.append(badge);
    }
    return head;
  }

  private buildForecastBar(forecast: HypothesisForecast): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-forecast-bar';

    const pct = Math.round(forecast.probability * 100);
    const TREND_ARROW: Record<HypothesisForecast['trend'], string> = {
      rising: '↑',
      falling: '↓',
      stable: '→',
    };

    const label = document.createElement('span');
    label.className = 'analyst-hud-forecast-label';
    label.textContent = `${pct}% ${TREND_ARROW[forecast.trend]} ${forecast.horizon}`;

    const track = document.createElement('div');
    track.className = 'analyst-hud-forecast-track';
    const fill = document.createElement('div');
    fill.className = 'analyst-hud-forecast-fill';
    fill.style.width = `${pct}%`;
    track.append(fill);

    wrap.append(label, track);

    const details = document.createElement('details');
    details.className = 'analyst-hud-forecast-why';
    const summary = document.createElement('summary');
    summary.textContent = 'why';
    details.append(summary);
    for (const line of buildForecastProvenanceLines(forecast)) {
      const row = document.createElement('div');
      row.className = 'analyst-hud-forecast-why-row';
      row.textContent = line;
      details.append(row);
    }
    wrap.append(details);

    return wrap;
  }

  private buildHypStatement(h: Hypothesis): HTMLElement {
    const p = document.createElement('p');
    p.className = 'analyst-hud-hyp-statement';
    p.textContent = h.statement;
    return p;
  }

  private buildHypEntities(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-entities';
    // Prefer the live cross-hypothesis cache so cross-cutting entities
    // match what the "Hot Entities" section shows. Fall back to a
    // per-hypothesis extraction for replayed past snapshots whose IDs
    // aren't in the cache anymore.
    let mentions = entitiesForHypothesis(h.id);
    if (mentions.length === 0) mentions = entitiesFromHypothesis(h);
    for (const m of mentions.slice(0, 6)) {
      wrap.append(this.buildEntityChip(m, false));
    }
    return wrap;
  }

  private buildHypEvidence(h: Hypothesis): HTMLElement {
    const ev = document.createElement('div');
    ev.className = 'analyst-hud-hyp-evidence';
    for (const e of h.evidence.slice(0, 6)) ev.append(this.buildEvidenceChip(e));
    return ev;
  }

  private buildHypSkeptic(h: Hypothesis): HTMLElement {
    const note = getSkepticNote(h);
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-skeptic';
    if (!note) return wrap;
    const expanded = this.expandedSkeptic.has(note.signature);
    const btn = document.createElement('button');
    btn.className = 'analyst-hud-skeptic-toggle';
    btn.dataset.skepticToggle = note.signature;
    btn.textContent = expanded ? `[skeptic ▼] ${note.summary}` : `[skeptic ▶] ${note.summary.slice(0, 80)}…`;
    btn.title = 'Click to expand the skeptic\'s full critique';
    wrap.append(btn);
    if (expanded && note.text) {
      const full = document.createElement('p');
      full.className = 'analyst-hud-skeptic-full';
      full.textContent = note.text;
      wrap.append(full);
    }
    return wrap;
  }

  private buildHypAlternatives(h: Hypothesis): HTMLElement {
    const view = getAlternativeView(h);
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-alternatives';
    if (!view) return wrap;
    const expanded = this.expandedAlternative.has(view.signature);
    const summary = `alt: ${view.alternative.slice(0, 80)}${view.alternative.length > 80 ? '…' : ''}`;
    const btn = document.createElement('button');
    btn.className = 'analyst-hud-alternatives-toggle';
    btn.dataset.alternativesToggle = view.signature;
    btn.textContent = expanded ? `[alt ▼] ${summary}` : `[alt ▶] ${summary}`;
    btn.title = 'Click to expand the alternative explanation and pre-mortem';
    wrap.append(btn);
    if (expanded) {
      const altRow = document.createElement('p');
      altRow.className = 'analyst-hud-alternatives-detail';
      const confPct = `${(view.alternativeConfidence * 100).toFixed(0)}%`;
      altRow.textContent = `Alternative (${confPct} confidence): ${view.alternative}`;
      const premortRow = document.createElement('p');
      premortRow.className = 'analyst-hud-alternatives-premortem';
      premortRow.textContent = `Pre-mortem: ${view.premortem}`;
      wrap.append(altRow, premortRow);
    }
    return wrap;
  }

  /**
   * "Historical analogs" — up to 3 episodic-memory recalls for this
   * hypothesis (title/date + similarity %), each with a details disclosure.
   * Loads async on first render; hidden entirely when there are no analogs
   * (episodic recall off → recall() returns [] → nothing renders).
   * All clicks are delegated on this.root via data-analog-* attributes.
   */
  private buildHypAnalogs(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-analogs';

    const cached = this.analogCache.get(h.id);
    const stale = cached !== undefined && Date.now() - cached.loadedAt > ANALOG_CACHE_TTL_MS;
    if ((!cached || stale) && !this.loadingAnalogs.has(h.id)) {
      this.loadingAnalogs.add(h.id);
      this.pruneAnalogCache();
      void recall(h.statement, { k: 3, kinds: ['hypothesis', 'situation'] })
        .then((recalls) => { this.analogCache.set(h.id, { recalls, loadedAt: Date.now() }); })
        .catch(() => {
          // Cache the miss so a failing recall isn't retried every render.
          this.analogCache.set(h.id, { recalls: [], loadedAt: Date.now() });
        })
        .finally(() => {
          this.loadingAnalogs.delete(h.id);
          this.scheduleRender();
        });
    }

    if (!cached) {
      if (this.loadingAnalogs.has(h.id)) {
        const loading = document.createElement('span');
        loading.className = 'analyst-hud-analogs-loading';
        loading.textContent = 'analogs…';
        wrap.append(loading);
      }
      return wrap;
    }
    const recalls = cached.recalls.slice(0, 3);
    if (recalls.length === 0) return wrap;

    const expanded = this.expandedAnalogs.has(h.id);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'analyst-hud-analogs-toggle';
    toggle.dataset.analogToggle = h.id;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', `Historical analogs for this hypothesis (${recalls.length})`);
    toggle.textContent = expanded
      ? `Historical analogs (${recalls.length}) ▾`
      : `Historical analogs (${recalls.length}) ▸`;
    wrap.append(toggle);

    if (!expanded) return wrap;

    const list = document.createElement('div');
    list.className = 'analyst-hud-analog-list';
    for (const r of recalls) {
      list.append(this.buildAnalogItem(h.id, r));
    }
    wrap.append(list);
    return wrap;
  }

  private buildAnalogItem(hypId: string, r: Recall): HTMLElement {
    const item = document.createElement('div');
    item.className = 'analyst-hud-analog-item';
    const key = `${hypId}||${r.episode.id}`;
    const detailOpen = this.expandedAnalogDetail.has(key);

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'analyst-hud-analog-head';
    head.dataset.analogDetail = key;
    head.setAttribute('aria-expanded', String(detailOpen));
    const summary = r.episode.summary.length > 90
      ? `${r.episode.summary.slice(0, 90)}…`
      : r.episode.summary;
    const date = new Date(r.episode.createdAt).toLocaleDateString();
    const simPct = `${Math.round(r.similarity * 100)}%`;
    head.setAttribute('aria-label', `Analog episode from ${date}, similarity ${simPct}`);
    head.title = detailOpen ? 'Hide details' : 'Show details';

    const title = document.createElement('span');
    title.className = 'analyst-hud-analog-title';
    title.textContent = summary;
    const meta = document.createElement('span');
    meta.className = 'analyst-hud-analog-meta';
    meta.textContent = `${date} · ${simPct}`;
    head.append(title, meta);
    item.append(head);

    if (detailOpen) {
      const detail = document.createElement('div');
      detail.className = 'analyst-hud-analog-detail';
      const age = ageLabel(Date.now() - r.episode.createdAt);
      const outcome = r.episode.outcome ?? 'pending';
      const lines = [
        `${r.explanation} · ${age} ago · outcome: ${outcome}`,
        ...(r.episode.outcomeNote ? [`→ ${r.episode.outcomeNote}`] : []),
      ];
      for (const text of lines) {
        const p = document.createElement('p');
        p.className = 'analyst-hud-analog-detail-line';
        p.textContent = text;
        detail.append(p);
      }
      item.append(detail);
    }
    return item;
  }

  /** Keep the analog cache bounded — evict the oldest loads beyond the cap. */
  private pruneAnalogCache(): void {
    if (this.analogCache.size < ANALOG_CACHE_MAX) return;
    const entries = [...this.analogCache.entries()].sort((a, b) => a[1].loadedAt - b[1].loadedAt);
    for (const [id] of entries.slice(0, entries.length - ANALOG_CACHE_MAX + 1)) {
      this.analogCache.delete(id);
    }
  }

  private onRootClick(e: Event): void {
    if (e.target === this.root) { this.hide(); return; }
    const target = e.target as HTMLElement;
    if (target.closest?.('.analyst-hud-close')) { this.hide(); return; }
    // Hypothesis action row (thumbs / outcome / simulate / perspectives /
    // deep forecast / copy). The hypothesis is re-resolved by id at click time.
    const actionBtn = target.closest?.<HTMLElement>('[data-hyp-action]');
    if (actionBtn?.dataset.hypAction && actionBtn.dataset.hypId) {
      this.handleHypAction(actionBtn.dataset.hypAction, actionBtn.dataset.hypId, actionBtn);
      return;
    }
    if (this.handleToggleClick(target)) return;
    this.handleNavClick(target);
  }

  // Controls that just flip a Set keyed by a data attribute and re-render:
  // analog cards, analog detail, skeptic + alternatives toggles.
  private handleToggleClick(target: HTMLElement): boolean {
    const toggles: readonly (readonly [string, Set<string>])[] = [
      ['data-analog-toggle', this.expandedAnalogs],
      ['data-analog-detail', this.expandedAnalogDetail],
      ['data-skeptic-toggle', this.expandedSkeptic],
      ['data-alternatives-toggle', this.expandedAlternative],
    ];
    for (const [attr, set] of toggles) {
      const key = target.closest?.<HTMLElement>(`[${attr}]`)?.getAttribute(attr);
      if (key) {
        if (set.has(key)) set.delete(key);
        else set.add(key);
        this.render();
        return true;
      }
    }
    return false;
  }

  // Controls that navigate/act: EVOI + evidence panel jumps, question chips,
  // and the replay scrubber's live button.
  private handleNavClick(target: HTMLElement): void {
    const evoiRow = target.closest?.<HTMLElement>('[data-evoi-panel]');
    if (evoiRow?.dataset.evoiPanel) {
      jumpToPanel(evoiRow.dataset.evoiPanel);
      this.hide();
      return;
    }
    const evidenceChip = target.closest?.<HTMLElement>('[data-evidence-panel]');
    if (evidenceChip?.dataset.evidencePanel) {
      this.handleEvidenceJump(
        evidenceChip.dataset.evidencePanel,
        evidenceChip.dataset.evidenceId ?? '',
        evidenceChip.dataset.evidenceSource ?? '',
      );
      return;
    }
    const questionChip = target.closest?.<HTMLElement>('[data-question-hyp-id]');
    if (questionChip?.dataset.questionHypId) {
      this.handleQuestionChip(
        questionChip.dataset.questionHypId,
        questionChip.dataset.questionText ?? '',
      );
      return;
    }
    const scrubberLive = target.closest?.<HTMLElement>('[data-scrubber-live]');
    if (scrubberLive?.dataset.scrubberLive) {
      this.replayAtTimestamp = null;
      this.render();
    }
  }

  private hypothesisById(id: string): Hypothesis | undefined {
    return this.effectiveSnapshot()?.hypotheses.find((hyp) => hyp.id === id);
  }

  // Single dispatch for every delegated hypothesis action-row button. Runs on
  // the stable root, so it survives the per-render replaceChildren that would
  // otherwise swallow a click bound to the (replaced) button node.
  private handleHypAction(action: string, id: string, btn: HTMLElement): void {
    const h = this.hypothesisById(id);
    if (!h) return;
    switch (action) {
      case 'thumbs-up': {
        thumbsUp(h);
        recordAction(h, 'thumbs-up');
        btn.classList.add('analyst-hud-thumb-done');
        return;
      }
      case 'thumbs-down': {
        thumbsDown(h);
        recordAction(h, 'thumbs-down');
        btn.classList.add('analyst-hud-thumb-done');
        return;
      }
      case 'outcome-confirmed': {
        if (this.outcomeSubmitted.has(h.id)) return;
        thumbsUp(h);
        recordAction(h, 'thumbs-up');
        this.outcomeSubmitted.add(h.id);
        this.render();
        return;
      }
      case 'outcome-wrong': {
        if (this.outcomeSubmitted.has(h.id)) return;
        thumbsDown(h);
        recordAction(h, 'thumbs-down');
        this.outcomeSubmitted.add(h.id);
        this.render();
        return;
      }
      case 'simulate': {
        this.toggleOrRunProjection(h);
        return;
      }
      case 'ensemble': {
        this.toggleOrRunEnsemble(h);
        return;
      }
      case 'superforecast': {
        this.toggleOrRunSuperforecast(h);
        return;
      }
      case 'copy': {
        void exportHypothesisToClipboard(h);
        recordAction(h, 'export');
        return;
      }
    }
  }

  // Delegated question-chip dispatch. Re-resolves the hypothesis + cache state
  // by id at click time so a background render() between pointerdown and
  // pointerup can't orphan the click bound to the (replaced) chip node.
  private handleQuestionChip(id: string, question: string): void {
    const h = this.hypothesisById(id);
    if (!h) return;
    const key = `${id}||${question}`;
    if (getCachedAnswer(h, question)) {
      if (this.expandedQuestion.has(key)) this.expandedQuestion.delete(key);
      else this.expandedQuestion.add(key);
      this.render();
      return;
    }
    this.loadingQuestion.add(key);
    this.render();
    void askQuestion(h, question).finally(() => {
      this.loadingQuestion.delete(key);
      this.expandedQuestion.add(key);
      this.render();
    });
  }

  private toggleOrRunProjection(h: Hypothesis): void {
    if (getCachedProjection(h)) {
      if (this.expandedProjection.has(h.id)) this.expandedProjection.delete(h.id);
      else this.expandedProjection.add(h.id);
      this.render();
      return;
    }
    this.loadingProjection.add(h.id);
    this.render();
    void projectHypothesis(h).finally(() => {
      this.loadingProjection.delete(h.id);
      this.expandedProjection.add(h.id);
      this.render();
    });
  }

  private toggleOrRunEnsemble(h: Hypothesis): void {
    if (getCachedEnsemble(h)) {
      if (this.expandedEnsemble.has(h.id)) this.expandedEnsemble.delete(h.id);
      else this.expandedEnsemble.add(h.id);
      this.render();
      return;
    }
    this.loadingEnsemble.add(h.id);
    this.render();
    void runEnsemble(h).finally(() => {
      this.loadingEnsemble.delete(h.id);
      this.expandedEnsemble.add(h.id);
      this.render();
    });
  }

  private toggleOrRunSuperforecast(h: Hypothesis): void {
    if (getCachedSuperforecast(h)) {
      if (this.expandedSuperforecast.has(h.id)) this.expandedSuperforecast.delete(h.id);
      else this.expandedSuperforecast.add(h.id);
      this.render();
      return;
    }
    this.loadingSuperforecast.add(h.id);
    this.render();
    // Swallow pipeline rejections: the finally-block resets the loading
    // state and the un-cached button lets the user retry.
    void requestSuperforecast(h).catch(() => { /* retry via re-click */ }).finally(() => {
      this.loadingSuperforecast.delete(h.id);
      this.expandedSuperforecast.add(h.id);
      this.render();
    });
  }

  private buildHypActions(h: Hypothesis): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'analyst-hud-hyp-actions';
    const up = document.createElement('button');
    up.className = 'analyst-hud-thumb';
    up.textContent = '+';
    up.title = 'Useful';
    up.dataset.hypAction = 'thumbs-up';
    up.dataset.hypId = h.id;
    const down = document.createElement('button');
    down.className = 'analyst-hud-thumb';
    down.textContent = '-';
    down.title = 'Noise';
    down.dataset.hypAction = 'thumbs-down';
    down.dataset.hypId = h.id;

    const simulate = this.buildSimulateButton(h);
    const perspectives = this.buildEnsembleButton(h);
    const deepForecast = this.buildSuperforecastButton(h);
    const copy = this.buildCopyButton(h);

    const outcomeButtons = this.buildOutcomeButtons(h);
    actions.append(up, down, ...outcomeButtons, simulate, perspectives, deepForecast, copy);
    return actions;
  }

  private buildOutcomeButtons(h: Hypothesis): HTMLElement[] {
    if (isGhostMode()) return [];
    const already = this.outcomeSubmitted.has(h.id);

    const confirmed = document.createElement('button');
    confirmed.className = 'analyst-hud-outcome analyst-hud-outcome-confirmed';
    confirmed.textContent = '✓ Confirmed';
    confirmed.title = 'Mark this hypothesis as correct';
    confirmed.disabled = already;
    confirmed.dataset.hypAction = 'outcome-confirmed';
    confirmed.dataset.hypId = h.id;

    const wrong = document.createElement('button');
    wrong.className = 'analyst-hud-outcome analyst-hud-outcome-wrong';
    wrong.textContent = '✗ Wrong';
    wrong.title = 'Mark this hypothesis as incorrect';
    wrong.disabled = already;
    wrong.dataset.hypAction = 'outcome-wrong';
    wrong.dataset.hypId = h.id;

    return [confirmed, wrong];
  }

  private buildEnsembleButton(h: Hypothesis): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'analyst-hud-ensemble-btn';
    const cached = getCachedEnsemble(h);
    const loading = this.loadingEnsemble.has(h.id);
    const expanded = this.expandedEnsemble.has(h.id);
    btn.textContent = ensembleButtonLabel(loading, Boolean(cached), expanded);
    btn.title = cached
      ? 'Toggle the stored ensemble perspectives'
      : '3 personas (analyst / skeptic / pragmatist) take on this hypothesis';
    btn.disabled = loading;
    btn.dataset.hypAction = 'ensemble';
    btn.dataset.hypId = h.id;
    return btn;
  }

  private buildSimulateButton(h: Hypothesis): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'analyst-hud-sim-btn';
    if (isGhostMode()) {
      btn.style.display = 'none';
    }
    const loading = this.loadingProjection.has(h.id);
    const cached = getCachedProjection(h);
    const expanded = this.expandedProjection.has(h.id);
    btn.textContent = simButtonLabel(loading, Boolean(cached), expanded);
    btn.title = cached
      ? 'Toggle the stored projection'
      : 'Project 24/48h rollout via local LLM (cloud fallback)';
    btn.disabled = loading;
    btn.dataset.hypAction = 'simulate';
    btn.dataset.hypId = h.id;
    return btn;
  }

  private buildSuperforecastButton(h: Hypothesis): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'analyst-hud-superforecast-btn';
    if (isGhostMode()) {
      btn.style.display = 'none';
    }
    const loading = this.loadingSuperforecast.has(h.id);
    const cached = getCachedSuperforecast(h);
    const expanded = this.expandedSuperforecast.has(h.id);
    btn.textContent = superforecastButtonLabel(loading, Boolean(cached), expanded);
    btn.title = cached
      ? 'Toggle the stored deep forecast'
      : 'Run the calibrated superforecaster pipeline on this hypothesis';
    btn.disabled = loading;
    btn.dataset.hypAction = 'superforecast';
    btn.dataset.hypId = h.id;
    return btn;
  }

  private buildCopyButton(h: Hypothesis): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'analyst-hud-copy-btn';
    const flashed = this.exportedFlash?.id === h.id
      && Date.now() - this.exportedFlash.at < 3000;
    btn.textContent = flashed ? 'copied ✓' : 'copy ⎘';
    btn.title = 'Copy this hypothesis thread as markdown to the clipboard';
    btn.dataset.hypAction = 'copy';
    btn.dataset.hypId = h.id;
    return btn;
  }

  private buildEvidenceChip(e: HypothesisEvidence): HTMLElement {
    const chip = document.createElement('button');
    chip.className = 'analyst-hud-evidence-chip';
    chip.textContent = e.label.length > 40 ? `${e.label.slice(0, 40)}...` : e.label;
    chip.title = `${e.source} — ${e.id}`;
    if (e.panelId) {
      chip.dataset.evidencePanel = e.panelId;
      chip.dataset.evidenceId = e.id;
      chip.dataset.evidenceSource = e.source;
    } else {
      chip.disabled = true;
    }
    return chip;
  }

  private handleEvidenceJump(panelId: string, id: string, source: string): void {
    const h = this.findHypothesisForEvidence(id, source);
    jumpToPanel(panelId);
    flashPanel(panelId);
    // Only record playbook actions on live-view clicks. In replay mode the
    // user is reviewing past state, not acting on it, and mutating the
    // playbook would pollute future recurrence hints.
    if (h && this.replayAtTimestamp === null) recordAction(h, 'panel-jump', panelId);
    this.hide();
  }

  private findHypothesisForEvidence(id: string, source: string): Hypothesis | null {
    // Use the effective snapshot (live OR replayed) so the found
    // hypothesis matches the row the user actually clicked from.
    const snap = this.effectiveSnapshot();
    if (!snap) return null;
    return snap.hypotheses.find(h => h.evidence.some(ev => ev.id === id && ev.source === source)) ?? null;
  }

  private buildEgressDisclosureBanner(): HTMLElement {
    const banner = document.createElement('div');
    banner.className = 'analyst-hud-egress-banner';

    const msg = document.createElement('p');
    msg.className = 'analyst-hud-egress-msg';
    msg.textContent =
      'When no local model is available, hypothesis summaries and evidence may be ' +
      'sent to your configured cloud LLM provider (Anthropic, Groq, or OpenRouter). ' +
      'Enable ‘Local model only’ below to disable this fallback.';
    banner.append(msg);

    const ackBtn = document.createElement('button');
    ackBtn.className = 'analyst-hud-egress-ack';
    ackBtn.textContent = 'Acknowledge';
    ackBtn.addEventListener('click', () => {
      setLlmEgressDisclosed(true);
      this.render();
    });
    banner.append(ackBtn);
    return banner;
  }

  private buildBriefsSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'analyst-hud-section';
    const h = document.createElement('h3');
    h.textContent = 'Auto-Briefs';
    sec.append(h);

    if (!isLlmEgressDisclosed()) sec.append(this.buildEgressDisclosureBanner());

    const toggle = document.createElement('label');
    toggle.className = 'analyst-hud-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isAutoBriefEnabled();
    cb.addEventListener('change', () => {
      setAutoBriefEnabled(cb.checked);
    });
    const label = document.createElement('span');
    label.textContent = 'Auto-generate brief on critical crossover';
    toggle.append(cb, label);
    sec.append(toggle);

    const skepticToggle = document.createElement('label');
    skepticToggle.className = 'analyst-hud-toggle';
    const sk = document.createElement('input');
    sk.type = 'checkbox';
    sk.checked = isSkepticEnabled();
    sk.addEventListener('change', () => {
      setSkepticEnabled(sk.checked);
    });
    const skLabel = document.createElement('span');
    skLabel.textContent = 'Run skeptic pass on high/critical hypotheses';
    skepticToggle.append(sk, skLabel);
    sec.append(skepticToggle);

    const altToggle = document.createElement('label');
    altToggle.className = 'analyst-hud-toggle';
    const alt = document.createElement('input');
    alt.type = 'checkbox';
    alt.checked = isAlternativesEnabled();
    alt.addEventListener('change', () => {
      setAlternativesEnabled(alt.checked);
    });
    const altLabel = document.createElement('span');
    altLabel.textContent = 'Run alternatives pass on high/critical hypotheses';
    altToggle.append(alt, altLabel);
    sec.append(altToggle);

    const briefs = (['finance', 'security', 'disaster', 'cyber'] as const)
      .map(d => this.briefs[d])
      .filter((b): b is AutoBrief => Boolean(b))
      .sort((a, b) => b.generatedAt - a.generatedAt);

    if (briefs.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analyst-hud-empty';
      empty.textContent = 'No auto-briefs yet.';
      sec.append(empty);
      return sec;
    }
    for (const b of briefs) sec.append(this.buildBriefRow(b));
    return sec;
  }

  private buildBriefRow(brief: AutoBrief): HTMLElement {
    const row = document.createElement('div');
    row.className = 'analyst-hud-brief';
    const head = document.createElement('div');
    head.className = 'analyst-hud-brief-head';
    const d = document.createElement('span');
    d.className = 'analyst-hud-brief-domain';
    d.textContent = `[${DOMAIN_GLYPH[brief.domain]}] ${brief.domain}`;
    const ago = document.createElement('span');
    ago.className = 'analyst-hud-brief-ago';
    const mins = Math.max(0, Math.round((Date.now() - brief.generatedAt) / 60_000));
    ago.textContent = mins < 1 ? 'just now' : `${mins}m ago`;
    head.append(d, ago);

    const summary = document.createElement('p');
    summary.className = 'analyst-hud-brief-summary';
    summary.textContent = brief.summary || brief.text.slice(0, 240);
    row.append(head, summary);
    return row;
  }

  private buildFooter(): HTMLElement {
    const f = document.createElement('div');
    f.className = 'analyst-hud-footer';
    const accuracy = getKindAccuracy();
    const parts: string[] = [];
    for (const [kind, stats] of accuracy) {
      const total = stats.hits + stats.misses;
      if (total < 3) continue;
      const pct = Math.round((stats.hits / total) * 100);
      parts.push(`${kind}: ${pct}% (${total})`);
    }
    const accuracyLine = document.createElement('div');
    accuracyLine.textContent = parts.length > 0
      ? `Accuracy — ${parts.join(' · ')}`
      : 'Accuracy — insufficient data.';
    const budget = getBudgetStatus();
    const budgetLine = document.createElement('div');
    budgetLine.className = budget.exhausted ? 'analyst-hud-budget-exhausted' : 'analyst-hud-budget';
    budgetLine.textContent =
      `LLM — ${budget.cloud}/${budget.cap} cloud · ${budget.local} local today` +
      (budget.exhausted ? ' (cloud cap reached)' : '');
    budgetLine.title = 'Daily cloud-LLM cap. Local calls are uncounted. Change via the settings overlay.';
    const debugLine = document.createElement('div');
    const errors = getTotalErrorCount();
    debugLine.className = errors > 0 ? 'analyst-hud-debug-errors' : 'analyst-hud-debug-ok';
    const plural = errors === 1 ? '' : 's';
    debugLine.textContent = errors > 0
      ? `Debug — ${errors} error${plural} logged (⌘⇧D for diagnostics)`
      : 'Debug — no errors (⌘⇧D for diagnostics)';
    debugLine.title = 'Press Cmd+Shift+D for the reasoning diagnostics overlay.';
    f.append(accuracyLine, budgetLine, debugLine);
    return f;
  }
}
