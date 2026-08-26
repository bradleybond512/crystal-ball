import { Panel } from './Panel';
import { getSavedPlaces, subscribeSavedPlaces, type SavedPlace, type SavedPlaceTag } from '@/services/saved-places';
import { getSavedPlaceBrief, computePlaceBriefsBatch, type PlaceBrief } from '@/services/place-briefs';
import { computeDistanceKm, unifiedAlertStore, type UnifiedAlert } from '@/services/unified-alerts';
import { getLifelinePackReadinessForPlace } from '@/services/lifelines/lifeline-runtime';
import {
  lifelinePrewarmCoordinator,
  type LifelinePrewarmState,
} from '@/services/lifelines/lifeline-prewarm';

interface SavedPlacesPanelOptions {
  focusPlace: (placeId: string) => void;
  editPlace?: (placeId: string) => void;
  createPlace?: () => void;
}

const TAG_LABELS: Record<SavedPlaceTag, string> = {
  home: 'Home',
  work: 'Work',
  family: 'Family',
  bugout: 'Bug-out',
  travel: 'Travel',
  medical: 'Medical',
  supply: 'Supply',
  concern: 'Concern',
  school: 'School',
  shelter: 'Shelter',
  critical: 'Critical',
  data_center: 'Data Center',
};

const PENCIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

const MAX_PLACES = 20;

type LifelinePackStatus = ReturnType<typeof getLifelinePackReadinessForPlace>['status'];

function lifelinePackLabel(status: LifelinePackStatus | null): string {
  switch (status) {
    case 'ready': { return 'Lifelines Ready'; }
    case 'partial': { return 'Lifelines Partial'; }
    case 'expired': { return 'Lifelines Expired'; }
    case 'not-saved': { return 'Lifelines Not Saved'; }
    default: { return ''; }
  }
}

function prewarmLabel(state: LifelinePrewarmState | null): string {
  if (!state) return '';
  const radius = `${state.radiusKm} km`;
  switch (state.phase) {
    case 'queued': { return `Lifelines queued for ${radius}`; }
    case 'fetching': { return `Lifelines fetching for ${radius}`; }
    case 'verifying': { return `Lifelines verifying for ${radius}`; }
    case 'ready': { return `Lifelines ready for ${radius}`; }
    case 'partial': { return `Lifelines partial for ${radius}`; }
    case 'failed': { return `Lifelines failed for ${radius}`; }
    case 'cooldown': { return `Lifelines recently prepared for ${radius}`; }
  }
}

function createPrewarmLiveRegion(): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = '<div class="sr-only" aria-live="polite" aria-atomic="true"></div>';
  return container.firstElementChild as HTMLElement;
}

interface PlaceThreatSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
}

const SEVERITY_COLOR: Record<UnifiedAlert['severity'], string> = {
  critical: '#ef4444',
  high:     '#fb923c',
  medium:   '#fde68a',
  low:      '#86efac',
  info:     '#9ca3af',
};

export class SavedPlacesPanel extends Panel {
  private options: SavedPlacesPanelOptions;
  private unsubscribeSavedPlaces: (() => void) | null = null;
  private unsubscribeAlerts: (() => void) | null = null;
  private unsubscribeLifelinePrewarm: (() => void) | null = null;
  private readonly prewarmLiveRegion = createPrewarmLiveRegion();
  private readonly boundRefresh: () => void;
  private places: SavedPlace[] = [];
  private refreshPending = false;

  constructor(options: SavedPlacesPanelOptions) {
    super({
      id: 'saved-places',
      title: 'Saved Places',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Personal locations prioritized for place-first monitoring, fast map focus, and later place briefs.',
    });
    this.options = options;

    if (options.createPlace) {
      const addBtn = document.createElement('button');
      addBtn.className = 'spm-header-add';
      addBtn.title = 'Add place';
      addBtn.type = 'button';
      addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
      addBtn.addEventListener('click', () => options.createPlace?.());
      this.header.append(addBtn);
    }

    this.content.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const createButton = target?.closest<HTMLElement>('[data-saved-place-create]');
      if (createButton) {
        this.options.createPlace?.();
        return;
      }

      const editButton = target?.closest<HTMLElement>('[data-saved-place-edit]');
      if (editButton) {
        event.stopPropagation();
        const placeId = editButton.dataset.savedPlaceEdit;
        if (placeId) this.options.editPlace?.(placeId);
        return;
      }

      const retryButton = target?.closest<HTMLElement>('[data-saved-place-prewarm-retry]');
      if (retryButton) {
        event.stopPropagation();
        const placeId = retryButton.dataset.savedPlacePrewarmRetry;
        const state = placeId ? lifelinePrewarmCoordinator.getState(placeId) : null;
        if (state?.phase === 'failed') {
          lifelinePrewarmCoordinator.retry(state.placeId, state.queryFingerprint);
        }
        return;
      }

      const placeCard = target?.closest<HTMLElement>('[data-saved-place-id]');
      const placeId = placeCard?.dataset.savedPlaceId;
      if (!placeId) return;
      this.options.focusPlace(placeId);
    });

    // Coalesce burst events into one deferred render.  requestIdleCallback
    // explicitly yields to user interactions (clicks, key presses) before
    // running background work — setTimeout(0) does not guarantee that
    // ordering.  500 ms timeout ensures the panel stays reasonably fresh
    // even during sustained interaction.
    this.boundRefresh = () => {
      if (this.refreshPending) return;
      this.refreshPending = true;
      if (typeof requestIdleCallback === 'undefined') {
        setTimeout(() => { this.refreshPending = false; this.refresh(); }, 0);
      } else {
        // No timeout — never preempt user input to run a background panel update.
        requestIdleCallback(() => { this.refreshPending = false; this.refresh(); });
      }
    };
    document.addEventListener('wm:breaking-news', this.boundRefresh);
    document.addEventListener('wm:intelligence-updated', this.boundRefresh);
    document.addEventListener('wm:local-logistics-updated', this.boundRefresh);
    document.addEventListener('wm:lifeline-situation-updated', this.boundRefresh);
    document.addEventListener('wm:saved-place-weather-updated', this.boundRefresh);
    document.addEventListener('wm:storm-data-updated', this.boundRefresh);
    this.unsubscribeSavedPlaces = subscribeSavedPlaces(() => this.boundRefresh());
    this.unsubscribeAlerts = unifiedAlertStore.subscribe(() => this.boundRefresh());
    this.unsubscribeLifelinePrewarm = lifelinePrewarmCoordinator.subscribe((state) => {
      const place = getSavedPlaces().find((candidate) => candidate.id === state.placeId);
      this.prewarmLiveRegion.textContent = place
        ? `${place.name}: ${prewarmLabel(state)}.`
        : prewarmLabel(state);
      this.boundRefresh();
    });
    this.refresh();
  }

  override destroy(): void {
    document.removeEventListener('wm:breaking-news', this.boundRefresh);
    document.removeEventListener('wm:intelligence-updated', this.boundRefresh);
    document.removeEventListener('wm:local-logistics-updated', this.boundRefresh);
    document.removeEventListener('wm:lifeline-situation-updated', this.boundRefresh);
    document.removeEventListener('wm:saved-place-weather-updated', this.boundRefresh);
    document.removeEventListener('wm:storm-data-updated', this.boundRefresh);
    this.unsubscribeSavedPlaces?.();
    this.unsubscribeSavedPlaces = null;
    this.unsubscribeAlerts?.();
    this.unsubscribeAlerts = null;
    this.unsubscribeLifelinePrewarm?.();
    this.unsubscribeLifelinePrewarm = null;
    super.destroy();
  }

  /** Count alerts whose location falls inside a saved place's radius,
   *  grouped by severity tier. Used to render the threat badges on
   *  each place card. The caller passes a pre-fetched alerts snapshot
   *  so getAll() is called once per render instead of once per place. */
  private summarizeThreats(place: SavedPlace, alerts: UnifiedAlert[]): PlaceThreatSummary {
    const summary: PlaceThreatSummary = { total: 0, critical: 0, high: 0, medium: 0 };
    for (const alert of alerts) {
      if (!alert.location) continue;
      if (alert.acknowledged) continue;
      const distKm = computeDistanceKm(place.lat, place.lon, alert.location.lat, alert.location.lon);
      if (distKm > place.radiusKm) continue;
      summary.total += 1;
      if (alert.severity === 'critical') summary.critical += 1;
      else if (alert.severity === 'high') summary.high += 1;
      else if (alert.severity === 'medium') summary.medium += 1;
    }
    return summary;
  }

  /** Pick the worst severity tier represented in a summary so the
   *  badge color tracks the most-critical alert in the radius. */
  private worstSeverity(summary: PlaceThreatSummary): UnifiedAlert['severity'] {
    if (summary.critical > 0) return 'critical';
    if (summary.high > 0) return 'high';
    if (summary.medium > 0) return 'medium';
    return 'low';
  }

  /** Build a colored severity-count badge for a place. Returns null when
   *  there are no threats — saving vertical space. */
  private buildThreatBadge(summary: PlaceThreatSummary): HTMLElement | null {
    if (summary.total === 0) return null;
    const color = SEVERITY_COLOR[this.worstSeverity(summary)];
    const tooltip = `${summary.total} alert${summary.total === 1 ? '' : 's'} in radius`
      + (summary.critical > 0 ? ` · ${summary.critical} critical` : '')
      + (summary.high > 0 ? ` · ${summary.high} high` : '');
    const span = document.createElement('span');
    span.className = 'watchlist-panel-chip spm-threat-chip';
    span.title = tooltip;
    span.style.cssText = `background:${color};color:#0a0a0c;font-weight:600`;
    span.textContent = `⚠ ${summary.total}`;
    return span;
  }

  public refresh(): void {
    this.places = getSavedPlaces();
    this.setCount(this.places.length);

    if (this.places.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'watchlist-empty';
      const titleEl = document.createElement('div');
      titleEl.className = 'watchlist-empty-title';
      titleEl.textContent = 'No saved places yet';
      const copyEl = document.createElement('div');
      copyEl.className = 'watchlist-empty-copy';
      copyEl.textContent = 'Add home, work, family, or bug-out locations so the app can prioritize what matters near you.';
      emptyEl.append(titleEl, copyEl);
      if (this.options.createPlace) {
        const firstBtn = document.createElement('button');
        firstBtn.className = 'watchlist-card';
        firstBtn.dataset.savedPlaceCreate = '1';
        firstBtn.type = 'button';
        firstBtn.textContent = 'Add your first place';
        emptyEl.append(firstBtn);
      }
      this.content.replaceChildren(emptyEl, this.prewarmLiveRegion);
      return;
    }

    const visible = this.places.slice(0, MAX_PLACES);
    // Compute briefs and alerts once for all visible places so the shared
    // inputs (getRecentBreakingAlerts, getRecentSignals, getAll) are called
    // once instead of once-per-place.
    const briefs = computePlaceBriefsBatch(visible);
    const allAlerts = unifiedAlertStore.getAll();

    const listEl = document.createElement('div');
    listEl.className = 'watchlist-list';
    for (const place of visible) {
      listEl.append(this.renderCardEl(place, briefs.get(place.id) ?? getSavedPlaceBrief(place.id), allAlerts));
    }
    if (this.places.length < MAX_PLACES && this.options.createPlace) {
      const addBtn = document.createElement('button');
      addBtn.className = 'spm-add-inline';
      addBtn.dataset.savedPlaceCreate = '1';
      addBtn.type = 'button';
      addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add place`;
      listEl.append(addBtn);
    }
    this.content.replaceChildren(listEl, this.prewarmLiveRegion);
  }

  private renderCardEl(place: SavedPlace, brief: PlaceBrief | null, allAlerts: UnifiedAlert[]): HTMLElement {
    const hasStormPosture = brief?.items.some((item) => item.kind === 'preparedness');
    const hasForecastRisk = brief?.items.some((item) => item.kind === 'forecast');
    const threats = this.summarizeThreats(place, allAlerts);

    const wrapper = document.createElement('div');
    wrapper.className = 'spm-card-wrapper';

    const card = document.createElement('button');
    card.className = 'watchlist-card';
    card.dataset.savedPlaceId = place.id;
    card.type = 'button';

    const top = document.createElement('div');
    top.className = 'watchlist-card-top';
    const nameGroup = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'watchlist-country';
    nameEl.textContent = place.name;
    const radiusEl = document.createElement('div');
    radiusEl.className = 'watchlist-scenario';
    radiusEl.textContent = `${place.radiusKm.toLocaleString()} km radius`;
    nameGroup.append(nameEl, radiusEl);
    top.append(nameGroup);

    const summary = document.createElement('div');
    summary.className = 'watchlist-summary';
    summary.textContent = brief?.headline ?? this.renderSubtitle(place);

    const bottom = document.createElement('div');
    bottom.className = 'watchlist-card-bottom';
    const panelsRow = document.createElement('div');
    panelsRow.className = 'watchlist-panels';

    const threatBadge = this.buildThreatBadge(threats);
    if (threatBadge) panelsRow.append(threatBadge);

    const packStatus = place.offlinePinned
      ? getLifelinePackReadinessForPlace(place).status
      : null;
    const packLabel = lifelinePackLabel(packStatus);
    const prewarmState = lifelinePrewarmCoordinator.getState(place.id);
    const currentPrewarmLabel = prewarmLabel(prewarmState);
    const chips: string[] = [
      place.primary ? 'Primary' : '',
      packLabel,
      currentPrewarmLabel,
      brief?.isStale ? 'Cached' : '',
      hasStormPosture ? 'Storm' : '',
      hasForecastRisk ? 'Forecast' : '',
    ].filter(Boolean);
    for (const label of chips) {
      const chip = document.createElement('span');
      chip.className = 'watchlist-panel-chip';
      chip.textContent = label;
      panelsRow.append(chip);
    }
    for (const tag of place.tags) {
      const chip = document.createElement('span');
      chip.className = 'watchlist-panel-chip';
      chip.textContent = TAG_LABELS[tag] ?? tag;
      panelsRow.append(chip);
    }

    bottom.append(panelsRow);
    card.append(top, summary, bottom);
    wrapper.append(card);

    if (this.options.editPlace) {
      const editBtn = document.createElement('button');
      editBtn.className = 'spm-card-edit';
      editBtn.dataset.savedPlaceEdit = place.id;
      editBtn.type = 'button';
      editBtn.title = 'Edit place';
      editBtn.innerHTML = PENCIL_SVG;
      wrapper.append(editBtn);
    }


    if (prewarmState?.phase === 'failed') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'sa-refresh-btn';
      retryBtn.dataset.savedPlacePrewarmRetry = place.id;
      retryBtn.type = 'button';
      retryBtn.textContent = 'Retry Lifelines';
      wrapper.append(retryBtn);
    }

    return wrapper;
  }

  private renderSubtitle(place: SavedPlace): string {
    return `${place.lat.toFixed(2)}, ${place.lon.toFixed(2)}`;
  }
}
