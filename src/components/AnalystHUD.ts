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
import { getPressureHistory, buildSparklinePath, subscribePressureHistory } from '@/services/pressure-history';
import { getPlaybookFor, summarizePlaybook, recordAction, noteRecurrence } from '@/services/action-memory';
import { suggestQuestions, getCachedAnswer, askQuestion, subscribeQuestionAnswered } from '@/services/question-suggester';
import { getArchive, subscribeBriefingArchive } from '@/services/briefing-archive';
import { projectHypothesis, getCachedProjection, subscribeProjection } from '@/services/hypothesis-projection';
import { exportHypothesisToClipboard } from '@/services/hypothesis-export';
import { getBudgetStatus, subscribeBudget, setCloudCap, resetBudget } from '@/services/llm-budget';
import { getTotalErrorCount, subscribeDebug } from '@/services/reasoning-debug';
import { getAllSnapshots, subscribeSnapshotArchive } from '@/services/snapshot-archive';
import { runEnsemble, getCachedEnsemble, subscribeEnsemble } from '@/services/hypothesis-ensemble';
import { forecastAll, type HypothesisForecast } from '@/services/intelligence/hypothesis-forecast';
import { getLatestPCI } from '@/services/intelligence/predictive-crisis-index';
import type { ForecastDomain } from '@/services/mode-forecast';
import type { PressureSample } from '@/services/pressure-history';
// ── Cognition PR 6 UI wiring ──────────────────────────────────────────────────
import { recall } from '@/services/cognition/episodic-memory';
import type { Recall } from '@/services/cognition/episodic-memory';
import { superforecast } from '@/services/cognition/superforecast';
import type { SuperForecast } from '@/services/cognition/superforecast';
import { logForecast } from '@/services/cognition/forecast-journal';
import { getComparison } from '@/services/cognition/forecast-journal';
import type { CalibrationComparison } from '@/services/cognition/forecast-journal';
import { planCollection, buildEvoiContext } from '@/services/cognition/evoi-planner';
import type { CollectionAction } from '@/services/cognition/evoi-planner';
import {
  cogFlags,
  wipeEpisodicMemory,
  wipeJournalEntries,
  resetOperatorModelStore,
  formatIntervalWhisker,
  formatEstimatesTable,
  formatSpreadLabel,
  formatEvoiChip,
  formatAnalogLine,
} from '@/services/cognition/ui-helpers';

const MAX_VISIBLE = 5;

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
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
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

function shouldIgnoreKey(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

export class AnalystHUD {
  private readonly root: HTMLElement;
  private snapshot: AnalystSnapshot | null = null;
  private forecast: ForecastSnapshot | null = null;
  private briefs: Record<string, AutoBrief | undefined> = {};
  private pressure: Record<ForecastDomain, PressureSample[]>;
  private visible = false;
  private expandedSkeptic = new Set<string>();
  private expandedQuestion = new Set<string>();
  private loadingQuestion = new Set<string>();
  private loadingProjection = new Set<string>();
  private expandedProjection = new Set<string>();
  private loadingEnsemble = new Set<string>();
  private expandedEnsemble = new Set<string>();
  private exportedFlash: { id: string; at: number } | null = null;
  private outcomeSubmitted = new Set<string>();
  // ── Cognition PR 6 state ──────────────────────────────────────────────────
  /** Cached analog recalls keyed by hypothesis id. */
  private analogCache = new Map<string, { recalls: Recall[]; loadedAt: number }>();
  private loadingAnalogs = new Set<string>();
  private expandedAnalogs = new Set<string>();
  /** Cached superforecasts keyed by hypothesis id. */
  private superforecastCache = new Map<string, SuperForecast>();
  private loadingSuperforecast = new Set<string>();
  private expandedSuperforecast = new Set<string>();
  /** Journal comparison keyed by hypothesis id. */
  private journalComparisonCache = new Map<string, CalibrationComparison>();
  /** Pending journal input value keyed by hypothesis id (0–99 integer). */
  private journalInputValue = new Map<string, number>();
  /** Submitted journal entries keyed by hypothesis id (to show confirmation). */
  private journalSubmitted = new Set<string>();
  /** Cached EVOI actions keyed by hypothesis id. */
  private evoiCache = new Map<string, CollectionAction[]>();
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

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'analyst-hud';
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
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
    subscribeAnalyst((snap) => {
      this.snapshot = snap;
      // Record recurrence ONCE per snapshot (not once per render) —
      // otherwise event bursts cause recurrenceCount to balloon by 10-30×
      // per actual cycle, polluting playbooks + hammering IDB writes.
      for (const h of snap.hypotheses.slice(0, MAX_VISIBLE)) noteRecurrence(h);
      this.scheduleRender();
    });
    subscribeModeAdvisory((f) => {
      this.forecast = f;
      this.scheduleRender();
    });
    subscribeAutoBrief((brief) => {
      this.briefs[brief.domain] = brief;
      this.scheduleRender();
    });
    subscribePressureHistory((h) => {
      this.pressure = h;
      this.scheduleRender();
    });
    subscribeSkeptic(() => { this.scheduleRender(); });
    subscribeQuestionAnswered(() => { this.scheduleRender(); });
    subscribeBriefingArchive(() => { this.scheduleRender(); });
    subscribeProjection(() => { this.scheduleRender(); });
    document.addEventListener('cb:hypothesis-export-copied', (e: Event) => {
      const ce = e as CustomEvent<{ hypothesisId: string }>;
      this.exportedFlash = { id: ce.detail.hypothesisId, at: Date.now() };
      this.scheduleRender();
    });
    subscribeBudget(() => { this.scheduleRender(); });
    subscribeDebug((entry) => {
      // Only re-render on errors (to refresh the footer counter) — info
      // and warn entries are too chatty.
      if (entry.level === 'error') this.scheduleRender();
    });
    subscribeSnapshotArchive(() => {
      // Only scroll the view on new archived snapshots when we're live.
      // When replayed, the user's anchor timestamp resolves to the same
      // snapshot regardless, so no re-render is needed.
      if (this.replayAtTimestamp === null) this.scheduleRender();
    });
    subscribeEnsemble(() => { this.scheduleRender(); });
    document.addEventListener('cb:toggle-analyst-hud', () => this.toggle());
    document.addEventListener('cb:hypothesis-feedback', () => {
      if (this.visible) this.render();
    });
    document.addEventListener('keydown', (e: KeyboardEvent) => this.handleKeydown(e));
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (!this.visible) return;
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
    if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
      this.settingsOpen = !this.settingsOpen;
      this.render();
      e.preventDefault();
      return true;
    }
    return false;
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

  show(): void {
    this.visible = true;
    this.root.hidden = false;
    this.render();
    document.dispatchEvent(new CustomEvent<{ visible: boolean }>('cb:analyst-hud-visibility', { detail: { visible: true } }));
  }

  hide(): void {
    this.visible = false;
    this.root.hidden = true;
    document.dispatchEvent(new CustomEvent<{ visible: boolean }>('cb:analyst-hud-visibility', { detail: { visible: false } }));
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
    close.textContent = 'x';
    close.title = 'Close (Esc)';
    close.addEventListener('click', () => this.hide());

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
      this.buildCloudCapSlider(),
    );

    card.append(this.buildCognitionSettings());

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

  // ── Cognition PR 6: Cognition settings section ────────────────────────────

  private buildCognitionSettings(): HTMLElement {

    const section = document.createElement('div');
    section.className = 'analyst-hud-settings-section';

    const title = document.createElement('div');
    title.className = 'analyst-hud-settings-section-title';
    title.textContent = 'Cognition (learning features)';
    section.append(title);

    // Feature toggles.
    const epToggle = this.buildCognitionToggle(
      'Episodic memory (past analogs)',
      cogFlags.get('episodic-memory'),
      (v) => { cogFlags.set('episodic-memory', v); this.render(); },
    );
    const persToggle = this.buildCognitionToggle(
      'Personalization (operator model)',
      cogFlags.get('personalization'),
      (v) => { cogFlags.set('personalization', v); this.render(); },
    );
    const sfToggle = this.buildCognitionToggle(
      'Superforecaster pipeline (cloud budget)',
      cogFlags.get('superforecast'),
      (v) => { cogFlags.set('superforecast', v); this.render(); },
    );
    section.append(epToggle, persToggle, sfToggle);

    // Destructive actions.
    const actionsRow = document.createElement('div');
    actionsRow.className = 'analyst-hud-settings-row analyst-hud-settings-destructive-row';

    const wipeMemBtn = this.buildDestructiveButton('Wipe episodic memory', () => {
      wipeEpisodicMemory();
      this.analogCache.clear();
      this.render();
    });
    const wipeJrnBtn = this.buildDestructiveButton('Reset forecast journal', () => {
      wipeJournalEntries();
      this.journalComparisonCache.clear();
      this.journalSubmitted.clear();
      this.render();
    });
    const resetOpBtn = this.buildDestructiveButton('Reset operator model', () => {
      resetOperatorModelStore();
      this.render();
    });

    actionsRow.append(wipeMemBtn, wipeJrnBtn, resetOpBtn);
    section.append(actionsRow);
    return section;
  }

  private buildCognitionToggle(label: string, checked: boolean, set: (v: boolean) => void): HTMLElement {
    const row = document.createElement('label');
    row.className = 'analyst-hud-settings-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.addEventListener('change', () => set(cb.checked));
    const span = document.createElement('span');
    span.textContent = label;
    row.append(cb, span);
    return row;
  }

  private buildDestructiveButton(label: string, action: () => void): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'analyst-hud-settings-btn analyst-hud-settings-btn-destructive';
    btn.textContent = label;
    btn.title = `${label} — requires confirmation`;
    let confirmPending = false;
    btn.addEventListener('click', () => {
      if (!confirmPending) {
        confirmPending = true;
        btn.textContent = `Confirm: ${label}`;
        btn.classList.add('analyst-hud-confirm-pending');
        // Auto-cancel after 5 s.
        setTimeout(() => {
          confirmPending = false;
          btn.textContent = label;
          btn.classList.remove('analyst-hud-confirm-pending');
        }, 5000);
      } else {
        action();
        confirmPending = false;
        btn.textContent = label;
        btn.classList.remove('analyst-hud-confirm-pending');
      }
    });
    return btn;
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
    live.textContent = this.replayAtTimestamp === null ? 'live' : 'go live';
    live.disabled = this.replayAtTimestamp === null;
    live.addEventListener('click', () => {
      this.replayAtTimestamp = null;
      this.render();
    });

    const label = document.createElement('span');
    label.className = 'analyst-hud-scrubber-label';
    const snap = history[currentIdx];
    const ago = snap ? ageLabel(Date.now() - snap.timestamp) : 'now';
    label.textContent = `${ago} ago · ${currentIdx + 1}/${max + 1}`;

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
      this.buildHypQuestions(h),
      this.buildHypSkeptic(h),
      this.buildHypProjection(h),
      this.buildHypEnsemble(h),
      // ── Cognition PR 6 surfaces ─────────────────────────────────────────
      this.buildHypAnalogs(h),
      this.buildHypSuperforecast(h),
      this.buildHypJournal(h),
      this.buildHypEvoi(h),
      // ────────────────────────────────────────────────────────────────────
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
    const questions = suggestQuestions(h);
    for (const q of questions) wrap.append(this.buildQuestionChip(h, q));
    return wrap;
  }

  private buildQuestionChip(h: Hypothesis, question: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-question';
    const key = `${h.id}||${question}`;
    const cached = getCachedAnswer(h, question);
    const loading = this.loadingQuestion.has(key);
    const expanded = this.expandedQuestion.has(key);

    const chip = document.createElement('button');
    chip.className = 'analyst-hud-question-chip';
    chip.textContent = loading ? `? ${question} …` : `? ${question}`;
    chip.disabled = loading;
    chip.title = cached
      ? 'Cached answer — click to toggle'
      : 'Ask Claude (local if configured) and cache the answer';
    chip.addEventListener('click', () => {
      if (cached) {
        if (expanded) this.expandedQuestion.delete(key);
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
    });
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
    btn.textContent = expanded ? `[skeptic ▼] ${note.summary}` : `[skeptic ▶] ${note.summary.slice(0, 80)}…`;
    btn.title = 'Click to expand the skeptic\'s full critique';
    btn.addEventListener('click', () => {
      if (expanded) this.expandedSkeptic.delete(note.signature);
      else this.expandedSkeptic.add(note.signature);
      this.render();
    });
    wrap.append(btn);
    if (expanded && note.text) {
      const full = document.createElement('p');
      full.className = 'analyst-hud-skeptic-full';
      full.textContent = note.text;
      wrap.append(full);
    }
    return wrap;
  }

  private buildHypActions(h: Hypothesis): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'analyst-hud-hyp-actions';
    const up = document.createElement('button');
    up.className = 'analyst-hud-thumb';
    up.textContent = '+';
    up.title = 'Useful';
    up.addEventListener('click', () => {
      thumbsUp(h);
      recordAction(h, 'thumbs-up');
      up.classList.add('analyst-hud-thumb-done');
    });
    const down = document.createElement('button');
    down.className = 'analyst-hud-thumb';
    down.textContent = '-';
    down.title = 'Noise';
    down.addEventListener('click', () => {
      thumbsDown(h);
      recordAction(h, 'thumbs-down');
      down.classList.add('analyst-hud-thumb-done');
    });

    const simulate = this.buildSimulateButton(h);
    const perspectives = this.buildEnsembleButton(h);
    const copy = this.buildCopyButton(h);

    const outcomeButtons = this.buildOutcomeButtons(h);
    actions.append(up, down, ...outcomeButtons, simulate, perspectives, copy);
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
    confirmed.addEventListener('click', () => {
      thumbsUp(h);
      recordAction(h, 'thumbs-up');
      this.outcomeSubmitted.add(h.id);
      this.render();
    });

    const wrong = document.createElement('button');
    wrong.className = 'analyst-hud-outcome analyst-hud-outcome-wrong';
    wrong.textContent = '✗ Wrong';
    wrong.title = 'Mark this hypothesis as incorrect';
    wrong.disabled = already;
    wrong.addEventListener('click', () => {
      thumbsDown(h);
      recordAction(h, 'thumbs-down');
      this.outcomeSubmitted.add(h.id);
      this.render();
    });

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
    btn.addEventListener('click', () => {
      if (cached) {
        if (expanded) this.expandedEnsemble.delete(h.id);
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
    });
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
    btn.addEventListener('click', () => {
      if (cached) {
        if (expanded) this.expandedProjection.delete(h.id);
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
    });
    return btn;
  }

  private buildCopyButton(h: Hypothesis): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'analyst-hud-copy-btn';
    const flashed = this.exportedFlash?.id === h.id
      && Date.now() - this.exportedFlash.at < 3000;
    btn.textContent = flashed ? 'copied ✓' : 'copy ⎘';
    btn.title = 'Copy this hypothesis thread as markdown to the clipboard';
    btn.addEventListener('click', () => {
      void exportHypothesisToClipboard(h);
      recordAction(h, 'export');
    });
    return btn;
  }

  private buildEvidenceChip(e: HypothesisEvidence): HTMLElement {
    const chip = document.createElement('button');
    chip.className = 'analyst-hud-evidence-chip';
    chip.textContent = e.label.length > 40 ? `${e.label.slice(0, 40)}...` : e.label;
    chip.title = `${e.source} — ${e.id}`;
    if (e.panelId) {
      chip.addEventListener('click', () => {
        const h = this.findHypothesisForEvidence(e);
        if (e.panelId) {
          jumpToPanel(e.panelId);
          flashPanel(e.panelId);
          // Only record playbook actions on live-view clicks. In replay
          // mode the user is reviewing past state, not acting on it, and
          // mutating the playbook would pollute future recurrence hints.
          if (h && this.replayAtTimestamp === null) recordAction(h, 'panel-jump', e.panelId);
        }
        this.hide();
      });
    } else {
      chip.disabled = true;
    }
    return chip;
  }

  private findHypothesisForEvidence(e: HypothesisEvidence): Hypothesis | null {
    // Use the effective snapshot (live OR replayed) so the found
    // hypothesis matches the row the user actually clicked from.
    const snap = this.effectiveSnapshot();
    if (!snap) return null;
    return snap.hypotheses.find(h => h.evidence.some(ev => ev.id === e.id && ev.source === e.source)) ?? null;
  }

  // ── Cognition PR 6: Past analogs ──────────────────────────────────────────

  /**
   * "Past analogs" block — top recall() results with outcome badges,
   * similarity %, and explanation line. Async load, graceful empty state.
   * Only shown when the episodic-memory flag is on.
   */
  private buildHypAnalogs(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-cognition-block';

    if (!cogFlags.get('episodic-memory')) return wrap;

    const cached = this.analogCache.get(h.id);
    const loading = this.loadingAnalogs.has(h.id);
    const expanded = this.expandedAnalogs.has(h.id);

    // Trigger async load on first render for this hypothesis.
    if (!cached && !loading) {
      this.loadingAnalogs.add(h.id);
      void recall(h.statement, { k: 3, kinds: ['hypothesis', 'situation'] })
        .then(recalls => {
          this.analogCache.set(h.id, { recalls, loadedAt: Date.now() });
          this.scheduleRender();
        })
        .catch(() => {
          // Store an empty result so we don't retry on every render.
          this.analogCache.set(h.id, { recalls: [], loadedAt: Date.now() });
        })
        .finally(() => {
          this.loadingAnalogs.delete(h.id);
          this.scheduleRender();
        });
    }

    // Header button to toggle.
    const btn = document.createElement('button');
    btn.className = 'analyst-hud-cognition-btn';
    if (loading) {
      btn.textContent = 'analogs …';
      btn.disabled = true;
    } else if (!cached) {
      btn.textContent = 'analogs …';
      btn.disabled = true;
    } else {
      const n = cached.recalls.length;
      btn.textContent = n === 0
        ? 'analogs: none'
        : expanded ? `analogs (${n}) ▾` : `analogs (${n}) ▸`;
      btn.disabled = n === 0;
      btn.addEventListener('click', () => {
        if (this.expandedAnalogs.has(h.id)) this.expandedAnalogs.delete(h.id);
        else this.expandedAnalogs.add(h.id);
        this.render();
      });
    }
    wrap.append(btn);

    if (expanded && cached && cached.recalls.length > 0) {
      const list = document.createElement('div');
      list.className = 'analyst-hud-cognition-list';
      for (const r of cached.recalls) {
        const item = document.createElement('div');
        item.className = 'analyst-hud-cognition-item';
        if (r.episode.contradictory) item.classList.add('analyst-hud-cognition-contradictory');
        const line = document.createTextNode(formatAnalogLine(r));
        item.append(line);
        if (r.episode.outcomeNote) {
          const note = document.createElement('span');
          note.className = 'analyst-hud-cognition-note';
          note.textContent = ` → ${r.episode.outcomeNote}`;
          item.append(note);
        }
        list.append(item);
      }
      wrap.append(list);
    }
    return wrap;
  }

  // ── Cognition PR 6: Superforecast provenance ───────────────────────────────

  /**
   * "Forecast provenance" — on-demand Superforecast button rendering the
   * estimates table, spread, conformal interval whisker, llmTier, and
   * recalibration explanation line. Only shown when superforecast flag is on.
   */
  private buildHypSuperforecast(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-cognition-block';

    if (!cogFlags.get('superforecast')) return wrap;

    const cached = this.superforecastCache.get(h.id);
    const loading = this.loadingSuperforecast.has(h.id);
    const expanded = this.expandedSuperforecast.has(h.id);

    const btn = document.createElement('button');
    btn.className = 'analyst-hud-cognition-btn';
    if (loading) {
      btn.textContent = 'superforecast …';
      btn.disabled = true;
    } else if (!cached) {
      btn.textContent = 'superforecast ▸';
      btn.addEventListener('click', () => {
        this.loadingSuperforecast.add(h.id);
        this.render();
        void superforecast(h)
          .then(sf => {
            this.superforecastCache.set(h.id, sf);
            this.expandedSuperforecast.add(h.id);
          })
          .catch(() => { /* budget exhausted or unavailable — silent */ })
          .finally(() => {
            this.loadingSuperforecast.delete(h.id);
            this.scheduleRender();
          });
      });
    } else {
      btn.textContent = expanded ? 'superforecast ▾' : 'superforecast ▸';
      btn.addEventListener('click', () => {
        if (this.expandedSuperforecast.has(h.id)) this.expandedSuperforecast.delete(h.id);
        else this.expandedSuperforecast.add(h.id);
        this.render();
      });
    }
    wrap.append(btn);

    if (expanded && cached) {
      const detail = document.createElement('div');
      detail.className = 'analyst-hud-cognition-detail';

      // Probability + interval whisker.
      const pLine = document.createElement('div');
      pLine.className = 'analyst-hud-cognition-p';
      const iv = cached.interval;
      pLine.textContent = formatIntervalWhisker(
        cached.probability,
        iv?.lo,
        iv?.hi,
      ) + ` · ${formatSpreadLabel(cached.spread)} · ${cached.llmTier}`;
      detail.append(pLine);

      // Estimates table.
      const estLines = formatEstimatesTable(cached.estimates);
      for (const line of estLines) {
        const est = document.createElement('div');
        est.className = 'analyst-hud-cognition-est';
        est.textContent = line;
        detail.append(est);
      }

      // Recalibration explanation (last paragraph of explanation chain).
      if (cached.explanation) {
        const expEl = document.createElement('div');
        expEl.className = 'analyst-hud-cognition-exp';
        expEl.textContent = cached.explanation;
        detail.append(expEl);
      }

      wrap.append(detail);
    }
    return wrap;
  }

  // ── Cognition PR 6: Operator forecast journal ──────────────────────────────

  /**
   * "Your call" — probability input (0–99%) + log button calling logForecast.
   * Shows "you vs system" Brier line from getComparison when available.
   * Suppressed in Ghost Mode (logForecast no-ops there anyway).
   */
  private buildHypJournal(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-cognition-block';

    if (isGhostMode()) return wrap;
    if (!cogFlags.get('personalization')) return wrap;

    const submitted = this.journalSubmitted.has(h.id);
    const comparison = this.journalComparisonCache.get(h.id);

    const row = document.createElement('div');
    row.className = 'analyst-hud-journal-row';

    if (submitted) {
      const confirm = document.createElement('span');
      confirm.className = 'analyst-hud-journal-confirm';
      confirm.textContent = 'Your call logged.';
      row.append(confirm);
    } else {
      const label = document.createElement('label');
      label.className = 'analyst-hud-journal-label';
      label.textContent = 'Your call: ';

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '99';
      input.step = '1';
      input.className = 'analyst-hud-journal-input';
      input.placeholder = '0–99%';
      const storedVal = this.journalInputValue.get(h.id);
      if (storedVal !== undefined) input.value = String(storedVal);
      input.addEventListener('input', () => {
        const v = parseInt(input.value, 10);
        if (!isNaN(v)) this.journalInputValue.set(h.id, Math.max(0, Math.min(99, v)));
      });

      const logBtn = document.createElement('button');
      logBtn.className = 'analyst-hud-journal-btn';
      logBtn.textContent = 'Log';
      logBtn.title = 'Record your probability forecast for this hypothesis';
      logBtn.addEventListener('click', () => {
        const raw = parseInt(input.value, 10);
        if (isNaN(raw)) return;
        const p = Math.max(0, Math.min(99, raw)) / 100;
        // logForecast needs signature and domain — read from hypothesis.
        const hLike = {
          id: h.id,
          signature: (h as Hypothesis & { signature?: string }).signature ?? h.id,
          domain: (h as Hypothesis & { domain?: string }).domain as import('@/services/intelligence/types').FactDomain ?? 'security',
          statement: h.statement,
        };
        logForecast(hLike, p);
        this.journalSubmitted.add(h.id);
        // Kick off an async comparison load.
        void getComparison().then(cmp => {
          this.journalComparisonCache.set(h.id, cmp);
          this.scheduleRender();
        }).catch(() => { /* unavailable */ });
        this.render();
      });

      row.append(label, input, logBtn);
    }
    wrap.append(row);

    // "You vs system" Brier line when available.
    if (comparison) {
      const cmpLine = document.createElement('div');
      cmpLine.className = 'analyst-hud-journal-comparison';
      // Use the helper to generate the comparison line but format it inline.
      const opB = comparison.operator.brier.toFixed(3);
      const sysB = comparison.system.brier.toFixed(3);
      const edge = comparison.humanEdge;
      if (edge !== null) {
        const sign = edge > 0 ? '+' : '';
        cmpLine.textContent = `You: Brier ${opB} · System: Brier ${sysB} · edge ${sign}${edge.toFixed(3)}`;
      } else {
        cmpLine.textContent = `You: Brier ${opB} (n=${comparison.operator.n}) · System: Brier ${sysB} (n=${comparison.system.n})`;
      }
      wrap.append(cmpLine);
    }

    return wrap;
  }

  // ── Cognition PR 6: EVOI "What to check next" chips ───────────────────────

  /**
   * Top-3 EVOI planCollection actions as chips with expectedInfoGainBits
   * + explanation tooltip. Clicking a chip with panelId jumps to panel.
   */
  private buildHypEvoi(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-cognition-block';

    // Build EVOI on first render for this hypothesis (synchronous).
    if (!this.evoiCache.has(h.id)) {
      try {
        const forecasts = forecastAll([h], getLatestPCI());
        const p = forecasts[0]?.probability ?? h.confidence;
        // buildEvoiContext(probability, negEvidence?, providerReport?, gaps?)
        // We pass null for the optional context sources — EVOI still works
        // purely from the prior probability when no provider/gap data is
        // available at this call site.
        const ctx = buildEvoiContext(p, null, null, []);
        const actions = planCollection(
          { kind: h.kind, statement: h.statement, confidence: h.confidence },
          ctx,
        );
        this.evoiCache.set(h.id, actions.slice(0, 3));
      } catch {
        this.evoiCache.set(h.id, []);
      }
    }

    const actions = this.evoiCache.get(h.id) ?? [];
    if (actions.length === 0) return wrap;

    const header = document.createElement('div');
    header.className = 'analyst-hud-cognition-label';
    header.textContent = 'What to check next:';
    wrap.append(header);

    const chipRow = document.createElement('div');
    chipRow.className = 'analyst-hud-evoi-chips';
    for (const action of actions) {
      const chip = document.createElement('button');
      chip.className = 'analyst-hud-evoi-chip';
      chip.textContent = formatEvoiChip(action);
      chip.title = action.explanation;
      if (action.panelId) {
        chip.addEventListener('click', () => {
          if (action.panelId) {
            jumpToPanel(action.panelId);
            this.hide();
          }
        });
      } else {
        chip.disabled = action.effort === 'task';
        chip.classList.add('analyst-hud-evoi-no-link');
      }
      chipRow.append(chip);
    }
    wrap.append(chipRow);
    return wrap;
  }

  private buildBriefsSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'analyst-hud-section';
    const h = document.createElement('h3');
    h.textContent = 'Auto-Briefs';
    sec.append(h);

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
