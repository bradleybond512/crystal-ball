import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import {
  getPrimarySavedPlace,
  getSavedPlace,
  getSavedPlaces,
  confirmSavedPlacePersistence,
  subscribeSavedPlaces,
  updateSavedPlace,
  type SavedPlace,
} from '@/services/saved-places';
import {
  buildLocalLogisticsFingerprint,
  fetchLocalLogistics,
  initialLocalLogisticsRadiusKm,
  LOCAL_LOGISTICS_CATEGORIES,
  LOCAL_LOGISTICS_CATEGORY_LABELS,
  LOCAL_LOGISTICS_RADIUS_CHOICES_KM,
  projectLocalLogisticsCoverage,
  selectRepresentativeLocalLogisticsNodes,
  type LifelineCategoryCoverage,
  type LifelineProviderCoverage,
  type LocalLogisticsSnapshot,
  type LocalLogisticsRadiusChoiceKm,
  type LogisticsCategory,
  type LogisticsNode,
} from '@/services/local-logistics';
import {
  buildExternalMapsUrl,
  buildLifelineCallHref,
  buildLifelinesPlaceMatchSignature,
} from './disaster-lifelines-map-helpers';
import {
  applyLifelineExpiryTransition,
  LifelineEvidenceExpiryScheduler,
  type LifelineExpiryKind,
} from './lifeline-evidence-expiry';
import {
  getLifelinePackReadinessForPlace,
  getRecentLifelineChangesForPlace,
} from '@/services/lifelines/lifeline-runtime';
import {
  lifelinePrewarmCoordinator,
  type LifelinePrewarmCoordinator,
  type LifelinePrewarmState,
} from '@/services/lifelines/lifeline-prewarm';
import { deleteRoute, getEvacRouteDisclosure, planRoute } from '@/services/evacuation-router';

interface LocalLogisticsPanelOptions {
  focusNode: (lat: number, lon: number) => void;
  fetchSnapshot?: typeof fetchLocalLogistics;
  prewarmCoordinator?: LifelinePrewarmCoordinator;
}

type LocalLogisticsFilter = 'all' | LogisticsCategory;

function formatUpdatedAt(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatRetrievedAt(date: Date | null): string {
  if (!date) return 'unknown';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDistance(distanceKm: number): string {
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km`;
  return `${Math.round(distanceKm)} km`;
}

function formatStatus(node: LogisticsNode): string {
  if (node.expiresAt.getTime() <= Date.now()) return 'expired — status unknown';
  if (node.directoryOnly) return 'Directory listing only';
  return node.verification === 'official' ? 'Official report' : 'Status unverified';
}

function formatState(value: string): string {
  return value.replace(/_/g, ' ');
}

function formatPackStatus(status: ReturnType<typeof getLifelinePackReadinessForPlace>['status']): string {
  if (status === 'ready') return 'saved for this exact place';
  if (status === 'partial') return 'partial — some required content is missing';
  if (status === 'expired') return 'expired — refresh before relying on it';
  return 'not saved for this exact place';
}

function renderStaleSnapshot(snapshot: LocalLogisticsSnapshot): string {
  if (!snapshot.isStale) return '';
  const message = snapshot.isExpired
    ? 'Cached Lifeline Pack expired; all current availability must be reconfirmed.'
    : `Showing stale cached Lifeline Pack from ${escapeHtml(formatUpdatedAt(snapshot.fetchedAt))}.`;
  return `<div class="panel-empty" style="margin-bottom:10px;">${message}</div>`;
}

export class LocalLogisticsPanel extends Panel {
  private readonly options: LocalLogisticsPanelOptions;
  private readonly fetchSnapshot: typeof fetchLocalLogistics;
  private readonly prewarmCoordinator: LifelinePrewarmCoordinator;
  private activePlaceId: string | null = null;
  private activeFilter: LocalLogisticsFilter = 'all';
  private activeRadiusKm: LocalLogisticsRadiusChoiceKm | null = null;
  private radiusPlaceSignature: string | null = null;
  private snapshot: LocalLogisticsSnapshot | null = null;
  private error: string | null = null;
  private loading = false;
  private pendingRadiusFocusKm: LocalLogisticsRadiusChoiceKm | null = null;
  private routeFeedback: string | null = null;
  private routingNodeId: string | null = null;
  private routeGeneration = 0;
  private refreshGeneration = 0;
  private placeGeneration = 0;
  private activePlaceSignature: string | null = null;
  private snapshotPlaceSignature: string | null = null;
  private unsubscribeSavedPlaces: (() => void) | null = null;
  private unsubscribeLifelinePrewarm: (() => void) | null = null;
  private prewarmState: LifelinePrewarmState | null = null;
  private readonly nodeLookup = new Map<string, LogisticsNode>();
  private readonly evidenceExpiryScheduler = new LifelineEvidenceExpiryScheduler({
 onExpiry: (snapshot, expiresAt, kind) => this.transitionExpiredEvidence(snapshot, expiresAt, kind),
  });
  private readonly onLifelineSituationUpdated = (event: Event) => {
 const detail = (event as CustomEvent<unknown>).detail;
 if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return;
 const value = detail as Record<string, unknown>;
 if (value.placeId !== this.activePlaceId
   || value.queryFingerprint !== this.snapshot?.queryFingerprint) return;
 this.render();
  };

  constructor(options: LocalLogisticsPanelOptions) {
 super({
 id: 'local-logistics',
 title: 'Disaster Lifelines',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Nearby shelter, hotel, care, fuel, water, FEMA recovery centers, and county outage context. Every dynamic status shows its own evidence and expiry.',
 });
 this.options = options;
 this.fetchSnapshot = options.fetchSnapshot ?? fetchLocalLogistics;
 this.prewarmCoordinator = options.prewarmCoordinator ?? lifelinePrewarmCoordinator;
 this.showLoading('Loading disaster lifelines…');

 this.content.addEventListener('click', (event) => this.handleContentClick(event));

 this.unsubscribeSavedPlaces = subscribeSavedPlaces(() => this.handleSavedPlacesChanged());
 this.unsubscribeLifelinePrewarm = this.prewarmCoordinator.subscribe((state) => {
   if (state.placeId !== this.getActivePlaceId()) return;
   this.prewarmState = state;
   this.render();
 });
 document.addEventListener('wm:lifeline-situation-updated', this.onLifelineSituationUpdated);
  }

  private handleContentClick(event: MouseEvent): void {
 const target = event.target as HTMLElement | null;
 if (!target) return;
 if (this.handleRadiusClick(target)) return;
 if (this.handleFilterClick(target)) return;
 if (target.closest('[data-lifeline-prewarm]')) { this.prepareOffline(); return; }
 if (target.closest('[data-lifeline-prewarm-retry]')) { this.retryPrewarm(); return; }
 if (target.closest('[data-logistics-refresh]')) { void this.refresh(); return; }
 if (target.closest('[data-logistics-map]')) { this.showCurrentOverlay(); return; }
 if (this.handleSourceClick(target)) return;
 if (this.handleExternalMapClick(target)) return;
 if (this.handleCallClick(target)) return;
 if (this.handleRouteClick(target)) return;
 this.handleNodeFocusClick(target);
  }

  private handleRadiusClick(target: HTMLElement): boolean {
 const radiusButton = target.closest<HTMLElement>('[data-logistics-radius]');
 if (!radiusButton) return false;
 const rawRadius = radiusButton.dataset.logisticsRadius;
 const radiusKm = LOCAL_LOGISTICS_RADIUS_CHOICES_KM.find((choice) => String(choice) === rawRadius);
 if (radiusKm === undefined) return true;
 this.activeRadiusKm = radiusKm;
 this.pendingRadiusFocusKm = radiusKm;
 void this.refresh();
 return true;
  }

  private handleFilterClick(target: HTMLElement): boolean {
 const filterButton = target.closest<HTMLElement>('[data-logistics-filter]');
 if (!filterButton) return false;
 this.activeFilter = (filterButton.dataset.logisticsFilter ?? 'all') as LocalLogisticsFilter;
 this.render();
 return true;
  }

  private handleSourceClick(target: HTMLElement): boolean {
 const sourceButton = target.closest<HTMLElement>('[data-logistics-source]');
 if (!sourceButton) return false;
 const sourceNode = this.nodeLookup.get(sourceButton.dataset.logisticsSource ?? '');
 const safeUrl = sourceNode ? sanitizeUrl(sourceNode.sourceUrl ?? sourceNode.url ?? '') : '';
 if (safeUrl && safeUrl !== '#') window.open(safeUrl, '_blank', 'noopener,noreferrer');
 return true;
  }

  private handleExternalMapClick(target: HTMLElement): boolean {
 const externalMapButton = target.closest<HTMLElement>('[data-logistics-external-map]');
 if (!externalMapButton) return false;
 const node = this.nodeLookup.get(externalMapButton.dataset.logisticsExternalMap ?? '');
 if (node) window.open(buildExternalMapsUrl(node), '_blank', 'noopener,noreferrer');
 return true;
  }

  private handleCallClick(target: HTMLElement): boolean {
 const callButton = target.closest<HTMLElement>('[data-logistics-call]');
 if (!callButton) return false;
 const node = this.nodeLookup.get(callButton.dataset.logisticsCall ?? '');
 const callHref = buildLifelineCallHref(node?.publicPhone);
 if (callHref) window.open(callHref, '_self');
 return true;
  }

  private handleRouteClick(target: HTMLElement): boolean {
 const routeButton = target.closest<HTMLElement>('[data-logistics-route]');
 if (!routeButton) return false;
 const routeNode = this.nodeLookup.get(routeButton.dataset.logisticsRoute ?? '');
 if (routeNode) void this.routeToNode(routeNode);
 return true;
  }

  private handleNodeFocusClick(target: HTMLElement): void {
 const nodeButton = target.closest<HTMLElement>('[data-logistics-focus]');
 const nodeId = nodeButton?.dataset.logisticsNodeId;
 if (!nodeId) return;
 const node = this.nodeLookup.get(nodeId);
 if (!node) return;
 this.options.focusNode(node.lat, node.lon);
  }

  private showCurrentOverlay(): void {
 const snapshot = this.snapshot;
 const place = this.resolvePlace();
 if (!snapshot || !place || snapshot.placeId !== this.activePlaceId
   || this.snapshotPlaceSignature !== buildLifelinesPlaceMatchSignature(place)
   || !this.snapshotMatchesPlace(snapshot, place)) return;
 document.dispatchEvent(new CustomEvent('wm:show-lifelines-overlay', { detail: { snapshot } }));
  }

  public setPlaceId(placeId: string | null): void {
 const priorSnapshot = this.snapshot;
 this.activePlaceId = placeId;
 this.activePlaceId = this.getActivePlaceId();
 this.placeGeneration += 1;
 this.activeRadiusKm = null;
 this.radiusPlaceSignature = null;
 // Reselecting the same saved-place ID still supersedes the accepted exact
 // snapshot. Clear that overlay before dropping either snapshot or timer
 // ownership so its expiry transition cannot be orphaned on the map.
 if (priorSnapshot) this.requestOverlayClear(priorSnapshot);
 this.evidenceExpiryScheduler.track(null);
 this.activePlaceSignature = null;
 this.snapshotPlaceSignature = null;
 this.snapshot = null;
 this.loading = false;
 this.error = null;
 this.routeFeedback = null;
 this.routingNodeId = null;
 this.routeGeneration += 1;
 this.prewarmState = placeId ? this.prewarmCoordinator.getState(placeId) : null;
 this.announceActivePlaceChanged();
 void this.refresh();
  }

  /** Selected place context used by adjacent panels to ignore background prewarms. */
  public getActivePlaceId(): string | null {
 const place = this.resolvePlace();
 return place?.id ?? null;
  }

  override destroy(): void {
 this.refreshGeneration += 1;
 this.placeGeneration += 1;
 this.routeGeneration += 1;
 this.routingNodeId = null;
 this.evidenceExpiryScheduler.destroy();
 document.removeEventListener('wm:lifeline-situation-updated', this.onLifelineSituationUpdated);
 this.unsubscribeSavedPlaces?.();
 this.unsubscribeSavedPlaces = null;
 this.unsubscribeLifelinePrewarm?.();
 this.unsubscribeLifelinePrewarm = null;
 super.destroy();
  }

  public async refresh(): Promise<void> {
 const generation = ++this.refreshGeneration;
 const place = this.resolvePlace();
 this.nodeLookup.clear();
 this.evidenceExpiryScheduler.track(null);
 const priorSnapshot = this.snapshot;
 if (priorSnapshot) this.requestOverlayClear(priorSnapshot);
 // A displayed overlay is an explicit view of one accepted snapshot. Once a
 // refresh starts, that evidence is superseded even when the place and query
 // fingerprint remain unchanged; require a fresh explicit Map action.
 this.snapshot = null;
 this.snapshotPlaceSignature = null;
 if (!place) {
 this.activePlaceSignature = null;
 this.error = null;
 this.loading = false;
 this.setCount(0);
 this.setContent('<div class="panel-empty">Save a place to unlock nearby logistics.</div>');
 return;
 }

 this.activePlaceId = place.id;
 const placeSignature = buildLifelinesPlaceMatchSignature(place);
 if (this.activeRadiusKm === null || this.radiusPlaceSignature !== placeSignature) {
 this.activeRadiusKm = initialLocalLogisticsRadiusKm(place.radiusKm);
 this.radiusPlaceSignature = placeSignature;
 }
 const requestedRadiusKm = this.activeRadiusKm;
 const expectedFingerprint = buildLocalLogisticsFingerprint(
 place,
 requestedRadiusKm,
 [...LOCAL_LOGISTICS_CATEGORIES],
 );
 const expectedPlaceGeneration = this.placeGeneration;
 this.activePlaceSignature = placeSignature;
 this.error = null;
 this.loading = true;
 this.render();
 try {
 const snapshot = await this.fetchSnapshot(place, { radiusKm: requestedRadiusKm });
 const currentPlace = this.resolvePlace();
 if (!this.requestMatchesCurrentState(
   generation,
   expectedPlaceGeneration,
   place,
   placeSignature,
   requestedRadiusKm,
   expectedFingerprint,
   currentPlace,
 )) return;
 if (!this.snapshotMatchesPlace(snapshot, currentPlace, requestedRadiusKm, expectedFingerprint)) {
   throw new Error('Lifeline results did not match the current saved place');
 }
 this.snapshot = snapshot;
 this.snapshotPlaceSignature = placeSignature;
 this.evidenceExpiryScheduler.track(snapshot);
 this.error = null;
 this.loading = false;
 document.dispatchEvent(new CustomEvent('wm:active-local-logistics-snapshot-updated', {
   detail: { snapshot: this.snapshot },
 }));
 } catch (error) {
 const currentPlace = this.resolvePlace();
 if (!this.requestMatchesCurrentState(
   generation,
   expectedPlaceGeneration,
   place,
   placeSignature,
   requestedRadiusKm,
   expectedFingerprint,
   currentPlace,
 )) return;
 // fetchLocalLogistics already performs an exact-fingerprint fallback. A
 // place-only lookup here could surface a cache for old coordinates/options.
 this.snapshot = null;
 this.snapshotPlaceSignature = null;
 this.error = error instanceof Error ? error.message : 'Failed to load disaster lifelines';
 this.loading = false;
 }

 this.render();
  }

  private handleSavedPlacesChanged(): void {
 const place = this.resolvePlace();
 const nextSignature = place ? buildLifelinesPlaceMatchSignature(place) : null;
 if (nextSignature === this.activePlaceSignature) return;
 if (this.snapshot) this.requestOverlayClear(this.snapshot);
 this.activePlaceId = place?.id ?? null;
 this.placeGeneration += 1;
 this.activeRadiusKm = null;
 this.radiusPlaceSignature = null;
 this.snapshot = null;
 this.loading = false;
 this.snapshotPlaceSignature = null;
 this.activePlaceSignature = nextSignature;
 this.routeFeedback = null;
 this.routingNodeId = null;
 this.routeGeneration += 1;
 this.prewarmState = place ? this.prewarmCoordinator.getState(place.id) : null;
 this.announceActivePlaceChanged();
 void this.refresh();
  }

  private announceActivePlaceChanged(): void {
 document.dispatchEvent(new CustomEvent('wm:local-logistics-active-place-changed', {
   detail: { placeId: this.getActivePlaceId() },
 }));
  }

  private requestOverlayClear(snapshot: LocalLogisticsSnapshot): void {
 document.dispatchEvent(new CustomEvent('wm:clear-lifelines-overlay', {
   detail: { placeId: snapshot.placeId, queryFingerprint: snapshot.queryFingerprint },
 }));
  }

  private transitionExpiredEvidence(
 snapshot: LocalLogisticsSnapshot,
 _expiresAt: number,
  kind: LifelineExpiryKind,
  ): void {
 applyLifelineExpiryTransition(snapshot, kind, {
   isCurrent: (identity) => {
     const place = this.resolvePlace();
     return Boolean(place && this.snapshot === snapshot
       && identity.placeId === this.activePlaceId
       && identity.queryFingerprint === snapshot.queryFingerprint
       && this.snapshotPlaceSignature === buildLifelinesPlaceMatchSignature(place)
       && this.snapshotMatchesPlace(snapshot, place));
   },
   // renderNode() and renderOutageContext() already fail closed against
   // Date.now(), so repainting at the deadline removes the accepted claim.
   renderAtExpiry: () => this.render(),
   clearExactOverlay: () => this.requestOverlayClear(snapshot),
   // Tactical Comms listens to this existing event and recomputes the exact
   // cached snapshot against Date.now(); an expired ODIN row becomes unknown.
   publishSnapshot: (current) => document.dispatchEvent(new CustomEvent(
     'wm:local-logistics-updated',
     { detail: current },
   )),
 });
  }

  private requestMatchesCurrentState(
 generation: number,
 expectedPlaceGeneration: number,
 place: SavedPlace,
 placeSignature: string,
 requestedRadiusKm: LocalLogisticsRadiusChoiceKm,
  expectedFingerprint: string,
  currentPlace: SavedPlace | null,
  ): currentPlace is SavedPlace {
 if (!currentPlace) return false;
 return generation === this.refreshGeneration
   && expectedPlaceGeneration === this.placeGeneration
   && this.activePlaceId === place.id
   && this.activeRadiusKm === requestedRadiusKm
   && this.radiusPlaceSignature === placeSignature
   && buildLifelinesPlaceMatchSignature(currentPlace) === placeSignature
   && buildLocalLogisticsFingerprint(
     currentPlace,
     requestedRadiusKm,
     [...LOCAL_LOGISTICS_CATEGORIES],
   ) === expectedFingerprint;
  }

  private snapshotMatchesPlace(
 snapshot: LocalLogisticsSnapshot,
 place: SavedPlace,
 radiusKm = this.activeRadiusKm,
 expectedFingerprint = radiusKm === null
   ? null
   : buildLocalLogisticsFingerprint(place, radiusKm, [...LOCAL_LOGISTICS_CATEGORIES]),
  ): boolean {
 if (radiusKm === null || expectedFingerprint === null) return false;
 return snapshot.placeId === place.id
   && snapshot.placeName === place.name
   && snapshot.queryFingerprint === expectedFingerprint
   && snapshot.effectiveRadiusKm === radiusKm;
  }

  private resolvePlace() {
 if (this.activePlaceId) {
 const active = getSavedPlace(this.activePlaceId);
 if (active) return active;
 }
 return getPrimarySavedPlace() ?? getSavedPlaces()[0] ?? null;
  }

  private prepareOffline(): void {
 const place = this.resolvePlace();
 const radiusKm = this.activeRadiusKm ?? initialLocalLogisticsRadiusKm(place?.radiusKm ?? 25);
 if (!place) return;
 const persisted = place.offlinePinned ? place : updateSavedPlace(place.id, { offlinePinned: true });
 const confirmed = persisted ? confirmSavedPlacePersistence(persisted) : null;
 if (!confirmed?.offlinePinned) return;
 this.prewarmCoordinator.enqueue({ place: confirmed, radiusKm, trigger: 'manual' });
  }

  private retryPrewarm(): void {
 const state = this.prewarmState;
 if (state?.phase !== 'failed') return;
 this.prewarmCoordinator.retry(state.placeId, state.queryFingerprint);
  }

  private render(): void {
 const place = this.resolvePlace();
 if (!place) {
 this.setCount(0);
 this.setContent('<div class="panel-empty">Save a place to unlock nearby logistics.</div>');
 return;
 }

 const requestedRadiusKm = this.activeRadiusKm ?? initialLocalLogisticsRadiusKm(place.radiusKm);
 const categories = this.displayCategories();
 const nodes = this.displayNodes();
 this.setCount(nodes.length);
 for (const node of this.snapshot?.nodes ?? []) {
 this.nodeLookup.set(node.id, node);
 }

 const headerHtml = this.renderHeader(place, requestedRadiusKm);
 const prewarmHtml = this.renderPrewarmStatus(place, requestedRadiusKm);
 const statusHtml = this.renderLoadStatus(place);

 const staleHtml = this.snapshot ? renderStaleSnapshot(this.snapshot) : '';

 const packHtml = this.renderPackStatus(place);

 const outageHtml = this.snapshot ? this.renderOutageContext() : '';
 const coverage = this.snapshot ? projectLocalLogisticsCoverage(this.snapshot) : null;
 const providerHtml = coverage ? this.renderProviderCoverage(coverage.providers) : '';

 const filtersHtml = this.renderFilters(categories);
 const listHtml = this.renderNodeList(nodes, coverage?.categories ?? []);

 const routeFeedbackHtml = this.routeFeedback
 ? `<div class="panel-empty" style="margin-top:10px;" role="status">${escapeHtml(this.routeFeedback)}</div>`
 : '';

 const html = `
 <div class="sa-panel-content local-logistics-content" data-local-logistics-content="1" aria-busy="${this.loading}">
 ${headerHtml}
 ${prewarmHtml}
 ${statusHtml}
 ${staleHtml}
 ${packHtml}
 ${outageHtml}
 ${providerHtml}
 ${filtersHtml}
 ${listHtml}
 ${routeFeedbackHtml}
 </div>
 `;
 if (this.error) {
   this.setErrorContent(html, this.error, () => this.restoreRadiusFocus());
   return;
 }
 this.setContent(html, () => this.restoreRadiusFocus());
  }

  private displayCategories(): LogisticsCategory[] {
 const categories = this.snapshot?.categories ?? [];
 return categories.length > 0 ? categories : [...LOCAL_LOGISTICS_CATEGORIES];
  }

  private displayNodes(): LogisticsNode[] {
 if (!this.snapshot) return [];
 const limit = this.activeFilter === 'all' ? 12 : 6;
 return selectRepresentativeLocalLogisticsNodes(this.snapshot, this.activeFilter, limit);
  }

  private renderRadiusControls(requestedRadiusKm: LocalLogisticsRadiusChoiceKm): string {
 return `
 <fieldset class="local-logistics-radius" aria-label="Lifeline search radius">
 <legend>Search radius</legend>
 <div class="local-logistics-radius__choices">
 ${LOCAL_LOGISTICS_RADIUS_CHOICES_KM.map((radiusKm) => `
 <button
 class="sa-filter local-logistics-radius__button ${requestedRadiusKm === radiusKm ? 'sa-filter-active' : ''}"
 data-logistics-radius="${radiusKm}"
 type="button"
 aria-pressed="${requestedRadiusKm === radiusKm}"
 >${radiusKm} km</button>
 `).join('')}
 </div>
 </fieldset>
 `;
  }

  private renderHeader(place: SavedPlace, requestedRadiusKm: LocalLogisticsRadiusChoiceKm): string {
 const returnedRadiusHtml = this.snapshot
   ? ` • Returned radius ${this.snapshot.effectiveRadiusKm.toLocaleString()} km`
   : '';
 const updatedHtml = this.snapshot
   ? ` • Updated ${escapeHtml(formatUpdatedAt(this.snapshot.fetchedAt))}`
   : '';
 const mapDisabled = !this.snapshot || this.snapshot.nodes.length === 0;
 return `
 <div class="watchlist-card-top local-logistics-header">
 <div>
 <div class="watchlist-country">${escapeHtml(place.name)}</div>
 <div class="watchlist-scenario">Requested radius ${requestedRadiusKm.toLocaleString()} km${returnedRadiusHtml}${updatedHtml}</div>
 </div>
 <div class="watchlist-card-bottom">
 <button
 class="sa-refresh-btn"
 data-logistics-map="1"
 type="button"
 aria-label="Show ${escapeHtml((this.snapshot?.nodes.length ?? 0).toLocaleString())} disaster lifelines near ${escapeHtml(place.name)} on the map"
 ${mapDisabled ? 'disabled' : ''}
 >Map</button>
 <button class="sa-refresh-btn" data-logistics-refresh="1" type="button" aria-label="Refresh disaster lifelines near ${escapeHtml(place.name)}">Refresh</button>
 <button class="sa-refresh-btn" data-lifeline-prewarm="1" type="button">Prepare offline</button>
 </div>
 </div>
 ${this.renderRadiusControls(requestedRadiusKm)}
 `;
  }

  private renderPrewarmStatus(place: SavedPlace, radiusKm: LocalLogisticsRadiusChoiceKm): string {
 const state = this.prewarmState?.placeId === place.id ? this.prewarmState : null;
 if (!state) return '';
 const preparedRadiusKm = state.radiusKm ?? radiusKm;
 const labels: Record<LifelinePrewarmState['phase'], string> = {
   queued: `Offline preparation queued for ${preparedRadiusKm} km.`,
   fetching: `Fetching Lifelines for ${preparedRadiusKm} km…`,
   verifying: `Verifying the saved ${preparedRadiusKm} km Lifelines snapshot…`,
   ready: `Offline Lifelines ready for ${preparedRadiusKm} km.`,
   partial: `Offline Lifelines partially ready for ${preparedRadiusKm} km.`,
   failed: state.error ?? 'Offline Lifelines preparation failed.',
   cooldown: `Offline Lifelines for ${preparedRadiusKm} km were prepared recently.`,
 };
 return `
 <div class="panel-empty local-logistics-prewarm-status" data-lifeline-prewarm-status="${state.phase}">
 ${escapeHtml(labels[state.phase])}
 ${state.phase === 'failed'
   ? '<button class="sa-refresh-btn" data-lifeline-prewarm-retry="1" type="button">Retry</button>'
   : ''}
 </div>
 `;
  }

  private renderLoadStatus(place: SavedPlace): string {
 if (this.loading) {
   return `<div class="panel-empty local-logistics-status" role="status">Loading lifelines near ${escapeHtml(place.name)}…</div>`;
 }
 if (this.error) {
   return `<div class="panel-empty local-logistics-status" role="alert">${escapeHtml(this.error)}</div>`;
 }
 return '';
  }

  private renderPackStatus(place: SavedPlace): string {
 if (!this.snapshot) return '';
 const readiness = getLifelinePackReadinessForPlace(place);
 const latestChange = getRecentLifelineChangesForPlace(place)[0] ?? null;
 let changeHtml = '';
 if (latestChange) {
   changeHtml = `<br>Recent evidence change (review-only): ${escapeHtml(formatState(latestChange.attribute))} ${escapeHtml(String(latestChange.from ?? 'unknown'))} → ${escapeHtml(String(latestChange.to ?? 'unknown'))}, ${escapeHtml(formatUpdatedAt(latestChange.observedAt))}.`;
 }
 return `
 <div class="panel-empty" style="margin-bottom:10px;">
 Offline Lifelines: ${escapeHtml(formatPackStatus(readiness.status))}.
 ${changeHtml}
 </div>
 `;
  }

  private renderFilters(categories: LogisticsCategory[]): string {
 return `
 <div class="sa-filters">
 <button class="sa-filter ${this.activeFilter === 'all' ? 'sa-filter-active' : ''}" data-logistics-filter="all" type="button" aria-pressed="${this.activeFilter === 'all'}">All</button>
 ${categories.map((category) => `
 <button
 class="sa-filter ${this.activeFilter === category ? 'sa-filter-active' : ''}"
 data-logistics-filter="${escapeHtml(category)}"
 type="button"
 aria-pressed="${this.activeFilter === category}"
 >${escapeHtml(LOCAL_LOGISTICS_CATEGORY_LABELS[category])}</button>
 `).join('')}
 </div>
 `;
  }

  private renderNodeList(nodes: LogisticsNode[], coverage: LifelineCategoryCoverage[]): string {
 if (!this.snapshot) return '';
 if (nodes.length === 0) {
   return this.renderCategoryEmptyState(coverage, this.snapshot.effectiveRadiusKm);
 }
 return `
 <div class="watchlist-list">
 ${nodes.map((node) => this.renderNode(node)).join('')}
 </div>
 `;
  }

  private restoreRadiusFocus(): void {
 const radiusKm = this.pendingRadiusFocusKm;
 if (radiusKm === null || radiusKm !== this.activeRadiusKm) return;
 const button = this.content.querySelector<HTMLButtonElement>(
   `[data-logistics-radius="${radiusKm}"]`,
 );
 if (!button) return;
 this.pendingRadiusFocusKm = null;
 button.focus();
  }

  private renderProviderCoverage(providers: LifelineProviderCoverage[]): string {
 if (providers.length === 0) {
 return '<div class="panel-empty local-logistics-coverage">Provider coverage unavailable; results may be incomplete.</div>';
 }
 const labels: Record<LifelineProviderCoverage['providerId'], string> = {
   osm: 'OSM',
   fema: 'FEMA',
   'fema-open-shelters': 'FEMA Open Shelters',
   'fema-recovery-centers': 'FEMA Recovery Centers',
   'ornl-odin': 'ODIN',
 };
 return `
 <section class="local-logistics-coverage" aria-label="Provider coverage">
 <div class="watchlist-country">Provider coverage</div>
 <div class="local-logistics-provider-list">
 ${providers.map((provider) => `
 <div class="local-logistics-provider-row">
 <strong>${escapeHtml(labels[provider.providerId])}</strong>
 <span>${escapeHtml(provider.state.replace(/[-_]/g, ' '))}</span>
 <span>Retrieved ${escapeHtml(formatRetrievedAt(provider.retrievedAt))}</span>
 <span>Projected expiry ${escapeHtml(formatRetrievedAt(provider.projectedExpiresAt))}</span>
 <span>${provider.acceptedRows.toLocaleString()} accepted • ${provider.droppedRows.toLocaleString()} dropped</span>
 <span>${provider.scope === 'county-outage-context'
   ? 'county outage context; not facility coverage'
   : 'facility coverage'}</span>
 </div>
 `).join('')}
 </div>
 </section>
 `;
  }

  private renderCategoryEmptyState(
 coverage: LifelineCategoryCoverage[],
 returnedRadiusKm: number,
  ): string {
 const categories = this.activeFilter === 'all'
   ? (this.snapshot?.categories ?? [...LOCAL_LOGISTICS_CATEGORIES])
   : [this.activeFilter];
 return `<div class="local-logistics-empty-list">
 ${categories.map((category) => {
   const label = LOCAL_LOGISTICS_CATEGORY_LABELS[category];
   const categoryCoverage = coverage.find((item) => item.category === category);
   if (categoryCoverage?.state === 'proven-current' && categoryCoverage.expiresAt) {
     return `<div class="panel-empty">None reported within the current returned ${returnedRadiusKm.toLocaleString()} km coverage for ${escapeHtml(label)}. Coverage expires at ${escapeHtml(formatRetrievedAt(categoryCoverage.expiresAt))}.</div>`;
   }
   return `<div class="panel-empty">No ${escapeHtml(label)} results displayed. Current provider coverage is incomplete or expired; this does not mean none exist.</div>`;
 }).join('')}
 </div>`;
  }

  private renderNode(node: LogisticsNode): string {
 const capabilityLabels = [
 node.capabilities.generatorOnsite ? 'Generator listed' : '',
 node.capabilities.pets ? 'Pets accepted' : '',
 node.capabilities.ada ? 'ADA' : '',
 node.capabilities.wheelchairAccessible ? 'Wheelchair accessible' : '',
 Number.isFinite(node.capabilities.postImpactCapacity) ? `Capacity ${node.capabilities.postImpactCapacity}` : '',
 ].filter(Boolean);
 const chips = [
 `<span class="watchlist-panel-chip">${escapeHtml(LOCAL_LOGISTICS_CATEGORY_LABELS[node.category])}</span>`,
 `<span class="watchlist-panel-chip">Operational: ${escapeHtml(formatState(node.expiresAt.getTime() <= Date.now() ? 'unknown' : node.operational))}</span>`,
 `<span class="watchlist-panel-chip">Inventory: ${escapeHtml(formatState(node.expiresAt.getTime() <= Date.now() ? 'unknown' : node.inventory))}</span>`,
 `<span class="watchlist-panel-chip">Power: ${escapeHtml(formatState(node.expiresAt.getTime() <= Date.now() ? 'unknown' : node.power))}</span>`,
 `<span class="watchlist-panel-chip">Access: ${escapeHtml(formatState(node.expiresAt.getTime() <= Date.now() ? 'unknown' : node.access))}</span>`,
 ].filter(Boolean).join('');

 const expiry = node.expiresAt.getTime() <= Date.now()
 ? `Verification expired ${escapeHtml(formatUpdatedAt(node.expiresAt))}`
 : `Status expires ${escapeHtml(formatUpdatedAt(node.expiresAt))}`;

 return `
 <article class="watchlist-card local-logistics-node-card" data-logistics-node-card="${escapeHtml(node.id)}">
 <div class="watchlist-card-top">
 <div>
 <div class="watchlist-country">${escapeHtml(node.name)}</div>
 <div class="watchlist-scenario">${escapeHtml(formatDistance(node.distanceKm))} • ${escapeHtml(node.hazardCompatibility)}</div>
 </div>
 </div>
 <div class="watchlist-summary">${escapeHtml(node.address ?? 'No street address published')}</div>
 ${capabilityLabels.length > 0 ? `<div class="watchlist-scenario">${escapeHtml(capabilityLabels.join(' • '))}</div>` : ''}
 ${node.publicPhone ? `<div class="watchlist-scenario">Public phone: ${escapeHtml(node.publicPhone)}</div>` : ''}
 <div class="watchlist-card-bottom">
 <div class="watchlist-panels">${chips}</div>
 </div>
 <div class="watchlist-scenario">${escapeHtml(formatStatus(node))} • ${expiry} • ${escapeHtml(node.source)}</div>
 <div class="watchlist-card-bottom">
 <button class="sa-refresh-btn" data-logistics-focus="1" data-logistics-node-id="${escapeHtml(node.id)}" type="button" aria-label="Focus ${escapeHtml(node.name)} on map">Show on map</button>
 <button class="sa-refresh-btn" data-logistics-external-map="${escapeHtml(node.id)}" type="button" aria-label="Open ${escapeHtml(node.name)} in external maps">Open in Maps</button>
 ${buildLifelineCallHref(node.publicPhone)
   ? `<button class="sa-refresh-btn" data-logistics-call="${escapeHtml(node.id)}" type="button" aria-label="Call ${escapeHtml(node.name)}">Call</button>`
   : ''}
 <button class="sa-refresh-btn" data-logistics-route="${escapeHtml(node.id)}" type="button" aria-label="Plan an unverified road-graph route to ${escapeHtml(node.name)}" ${this.routingNodeId ? 'disabled' : ''}>${this.routingNodeId === node.id ? 'Routing…' : 'Graph route'}</button>
 <button class="sa-refresh-btn" data-logistics-source="${escapeHtml(node.id)}" type="button" aria-label="Open source for ${escapeHtml(node.name)}">Source</button>
 </div>
 </article>
 `;
  }

  private async routeToNode(node: LogisticsNode): Promise<void> {
 if (this.routingNodeId) return;
 const place = this.resolvePlace();
 const snapshot = this.snapshot;
 if (!place || !snapshot || !this.snapshotMatchesPlace(snapshot, place)) return;
 const placeSignature = buildLifelinesPlaceMatchSignature(place);
 const queryFingerprint = snapshot.queryFingerprint;
 const routeGeneration = ++this.routeGeneration;
 const isCurrentRouteTarget = () => {
 const currentPlace = this.resolvePlace();
 const currentNode = this.snapshot?.nodes.find((candidate) => candidate.id === node.id);
 return Boolean(currentPlace && currentNode
   && buildLifelinesPlaceMatchSignature(currentPlace) === placeSignature
   && this.snapshot?.queryFingerprint === queryFingerprint
   && currentNode.lat === node.lat && currentNode.lon === node.lon);
 };
 this.routingNodeId = node.id;
 this.routeFeedback = null;
 this.render();
 try {
 const route = await planRoute(
 { lat: place.lat, lon: place.lon },
 { lat: node.lat, lon: node.lon },
 );
 if (routeGeneration !== this.routeGeneration || !isCurrentRouteTarget()) {
 deleteRoute(route.id);
 return;
 }
 this.routeFeedback = `Graph route to ${node.name} displayed and cached. ${getEvacRouteDisclosure()}.`;
 document.dispatchEvent(new CustomEvent('wm:show-evac-route', { detail: { route } }));
 } catch (error) {
 if (routeGeneration !== this.routeGeneration || !isCurrentRouteTarget()) return;
 this.routeFeedback = `Route unavailable: ${error instanceof Error ? error.message : 'unknown error'}. No road-condition conclusion can be drawn.`;
 } finally {
 if (routeGeneration === this.routeGeneration && this.routingNodeId === node.id) {
 this.routingNodeId = null;
 this.render();
 }
 }
  }

  private renderOutageContext(): string {
 const provider = this.snapshot?.providers.find((item) => item.id === 'ornl-odin');
 const conditions = (this.snapshot?.areaConditions ?? [])
 .filter((condition) => condition.coverage === 'reported' && condition.expiresAt.getTime() > Date.now());
 if (!provider || provider.state === 'error') {
 return '<div class="panel-empty" style="margin-bottom:10px;">County power-outage coverage unknown. This does not mean power is on.</div>';
 }
 if (conditions.length === 0) {
 return `<div class="panel-empty" style="margin-bottom:10px;">County outage feed: ${escapeHtml(provider.state)}. No current accepted outage rows; local power remains unknown.</div>`;
 }
 const customersOut = conditions.reduce((sum, item) => sum + item.customersOut, 0);
 const first = conditions[0];
 return `<div class="panel-empty" style="margin-bottom:10px;">${escapeHtml(first?.county ?? 'County')} outage context: ${customersOut.toLocaleString()} customers reported out. Facility power must still be verified independently.</div>`;
  }
}
