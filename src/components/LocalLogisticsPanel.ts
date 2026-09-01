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
  fetchEphemeralLocalLogistics,
  fetchLocalLogistics,
  initialLocalLogisticsRadiusKm,
  LOCAL_LOGISTICS_CATEGORIES,
  LOCAL_LOGISTICS_CATEGORY_LABELS,
  LOCAL_LOGISTICS_RADIUS_CHOICES_KM,
  projectLocalLogisticsCoverage,
  projectLocalLogisticsOutageCoverage,
  selectRepresentativeLocalLogisticsNodes,
  type LifelineCategoryCoverage,
  type LifelineProviderCoverage,
  type LocalLogisticsOutageCoverage,
  type LocalLogisticsOutageClaim,
  type LocalLogisticsSnapshot,
  type LocalLogisticsRadiusChoiceKm,
  type LogisticsCategory,
  type LogisticsNode,
} from '@/services/local-logistics';
import { requestCurrentLocation, type LocationFix } from '@/services/location';
import {
  buildExternalMapsUrl,
  buildLifelineCallHref,
  buildLifelinesPlaceMatchSignature,
  getLifelineMarkerPresentation,
} from './disaster-lifelines-map-helpers';
import {
  applyLifelineExpiryTransition,
  LifelineEvidenceExpiryScheduler,
  type LifelineExpiryKind,
} from './lifeline-evidence-expiry';
import {
  getExactLifelinePackReadinessForPlace,
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
  fetchEphemeralSnapshot?: typeof fetchEphemeralLocalLogistics;
  requestLocation?: () => Promise<LocationFix>;
  openSaveCurrentLocation?: (
    prefill: { latitude: number; longitude: number; radiusKm: LocalLogisticsRadiusChoiceKm },
    onConfirmed: (place: SavedPlace) => void,
  ) => void;
  prewarmCoordinator?: LifelinePrewarmCoordinator;
  getExactPackReadiness?: typeof getExactLifelinePackReadinessForPlace;
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

function formatCurrentLocationAccuracy(fix: LocationFix | null): string {
  if (!fix) return 'awaiting fix';
  if (fix.accuracy < 1000) return `${Math.round(fix.accuracy).toLocaleString()} m`;
  return `${(fix.accuracy / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
}

function formatStatus(node: LogisticsNode, now: number): string {
  if (node.expiresAt.getTime() <= now) return 'expired — status unknown';
  if (node.directoryOnly) return 'Directory listing only';
  return node.verification === 'official' ? 'Official report' : 'Status unverified';
}

function renderNodeCapabilities(node: LogisticsNode): string {
  const labels: string[] = [];
  if (node.capabilities.generatorOnsite) labels.push('Generator listed');
  if (node.capabilities.pets) labels.push('Pets accepted');
  if (node.capabilities.ada) labels.push('ADA');
  if (node.capabilities.wheelchairAccessible) labels.push('Wheelchair accessible');
  if (Number.isFinite(node.capabilities.postImpactCapacity)) {
    labels.push(`Capacity ${node.capabilities.postImpactCapacity}`);
  }
  if (labels.length === 0) return '';
  return `<div class="watchlist-scenario">${escapeHtml(labels.join(' • '))}</div>`;
}

function renderNodePhone(
  node: LogisticsNode,
  requiresHotelConfirmation: boolean,
  callHref: string | null,
): string {
  if (requiresHotelConfirmation) {
    if (!callHref) return '<div class="watchlist-scenario">No callable public phone published.</div>';
    return `<div class="watchlist-scenario">Public phone: ${escapeHtml(node.publicPhone ?? '')}</div>`;
  }
  if (!node.publicPhone) return '';
  return `<div class="watchlist-scenario">Public phone: ${escapeHtml(node.publicPhone)}</div>`;
}

function renderNodeRetrieval(node: LogisticsNode, requiresHotelConfirmation: boolean): string {
  if (!requiresHotelConfirmation) return '';
  return `<div class="watchlist-scenario">Retrieved ${renderEvidenceTime(node.retrievedAt ?? node.observedAt, 'Unknown')}</div>`;
}

function renderNodeCallAction(
  node: LogisticsNode,
  requiresHotelConfirmation: boolean,
  callHref: string | null,
): string {
  if (!callHref) return '';
  const escapedId = escapeHtml(node.id);
  const escapedName = escapeHtml(node.name);
  if (requiresHotelConfirmation) {
    return `<button class="sa-refresh-btn" data-logistics-call="${escapedId}" type="button" aria-label="Call ${escapedName} to confirm vacancy, current operation, power, and access">Call to confirm</button>`;
  }
  return `<button class="sa-refresh-btn" data-logistics-call="${escapedId}" type="button" aria-label="Call ${escapedName}">Call</button>`;
}

function formatNodeOperational(node: LogisticsNode, now: number): string {
  return node.expiresAt.getTime() <= now ? 'unknown' : node.operational;
}

function formatState(value: string): string {
  return value.replace(/[-_]/g, ' ');
}

function renderEvidenceTime(date: Date | null, unavailable = 'Unknown'): string {
  if (!date) return escapeHtml(unavailable);
  return `<time datetime="${escapeHtml(date.toISOString())}">${escapeHtml(formatRetrievedAt(date))}</time>`;
}

function renderEvidenceCount(value: number | null): string {
  return value === null ? 'Unknown' : value.toLocaleString();
}

function formatPackStatus(status: ReturnType<typeof getExactLifelinePackReadinessForPlace>['status']): string {
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
  private readonly fetchEphemeralSnapshot: typeof fetchEphemeralLocalLogistics;
  private readonly requestLocation: () => Promise<LocationFix>;
  private readonly prewarmCoordinator: LifelinePrewarmCoordinator;
  private readonly getExactPackReadiness: typeof getExactLifelinePackReadinessForPlace;
  private activePlaceId: string | null = null;
  private activeFilter: LocalLogisticsFilter = 'all';
  private activeRadiusKm: LocalLogisticsRadiusChoiceKm | null = null;
  private radiusPlaceSignature: string | null = null;
  private snapshot: LocalLogisticsSnapshot | null = null;
  private error: string | null = null;
  private loading = false;
  private pendingRadiusFocusKm: LocalLogisticsRadiusChoiceKm | null = null;
  private pendingPrewarmFocus = false;
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
  private anchorMode: 'saved' | 'ephemeral' = 'saved';
  private currentLocationState: 'idle' | 'requesting' | 'fetching' | 'ready' | 'error' = 'idle';
  private currentLocationFix: LocationFix | null = null;
  private currentLocationError: string | null = null;
  private currentLocationGeneration = 0;
  private currentLocationAbort: AbortController | null = null;
  private pendingCurrentLocationFocus: 'use' | 'update' | 'clear' | null = null;
  private readonly nodeLookup = new Map<string, LogisticsNode>();
  private readonly evidenceExpiryScheduler = new LifelineEvidenceExpiryScheduler({
 onExpiry: (snapshot, expiresAt, kind) => this.transitionExpiredEvidence(snapshot, expiresAt, kind),
  });
  private readonly onLifelineSituationUpdated = (event: Event) => {
 if (this.anchorMode === 'ephemeral') return;
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
 this.fetchEphemeralSnapshot = options.fetchEphemeralSnapshot ?? fetchEphemeralLocalLogistics;
 this.requestLocation = options.requestLocation ?? requestCurrentLocation;
 this.prewarmCoordinator = options.prewarmCoordinator ?? lifelinePrewarmCoordinator;
 this.getExactPackReadiness = options.getExactPackReadiness ?? getExactLifelinePackReadinessForPlace;
 this.render();

 this.content.addEventListener('click', (event) => this.handleContentClick(event));

 this.unsubscribeSavedPlaces = subscribeSavedPlaces(() => this.handleSavedPlacesChanged());
 this.unsubscribeLifelinePrewarm = this.prewarmCoordinator.subscribe((state) => {
   if (this.anchorMode === 'ephemeral') return;
   if (state.placeId !== this.getActivePlaceId()) return;
   this.prewarmState = state;
   this.render();
 });
 document.addEventListener('wm:lifeline-situation-updated', this.onLifelineSituationUpdated);
  }

  private handleContentClick(event: MouseEvent): void {
 const target = event.target as HTMLElement | null;
 if (!target) return;
 if (target.closest('[data-logistics-use-current-location]')) { void this.acquireCurrentLocation(); return; }
 if (target.closest('[data-logistics-update-location]')) { void this.acquireCurrentLocation(); return; }
 if (target.closest('[data-logistics-clear-location]')) { this.clearCurrentLocation(); return; }
 if (target.closest('[data-logistics-save-location]')) { this.saveCurrentLocation(); return; }
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
 if (this.anchorMode === 'ephemeral') void this.refreshEphemeral();
 else void this.refresh();
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
 if (this.anchorMode === 'ephemeral') return true;
 const routeNode = this.nodeLookup.get(routeButton.dataset.logisticsRoute ?? '');
 if (routeNode) void this.routeToNode(routeNode);
 return true;
  }

  private handleNodeFocusClick(target: HTMLElement): void {
 if (this.anchorMode === 'ephemeral') return;
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
 this.resetCurrentLocationOwnership();
 this.anchorMode = 'saved';
 this.setAiSummaryEnabled(true);
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
 if (this.anchorMode === 'ephemeral') return null;
 const place = this.resolvePlace();
 return place?.id ?? null;
  }

  override destroy(): void {
 const destroyingCurrentLocation = this.anchorMode === 'ephemeral';
 this.currentLocationGeneration += 1;
 this.currentLocationAbort?.abort();
 this.currentLocationAbort = null;
 this.currentLocationFix = null;
 if (destroyingCurrentLocation) {
   this.anchorMode = 'saved';
   this.activeRadiusKm = null;
   this.radiusPlaceSignature = null;
   this.currentLocationState = 'idle';
   this.currentLocationError = null;
   this.pendingCurrentLocationFocus = null;
   this.pendingRadiusFocusKm = null;
   this.snapshot = null;
   this.snapshotPlaceSignature = null;
   this.nodeLookup.clear();
   this.loading = false;
   this.error = null;
 }
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
 if (this.anchorMode === 'ephemeral') {
   await this.refreshEphemeral();
   return;
 }
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
 this.render();
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

  private resetCurrentLocationOwnership(): void {
 this.currentLocationGeneration += 1;
 this.currentLocationAbort?.abort();
 this.currentLocationAbort = null;
 this.currentLocationFix = null;
 this.currentLocationState = 'idle';
 this.currentLocationError = null;
 this.pendingCurrentLocationFocus = null;
  }

  private async acquireCurrentLocation(): Promise<void> {
 const priorSavedSnapshot = this.anchorMode === 'saved' ? this.snapshot : null;
 if (priorSavedSnapshot) this.requestOverlayClear(priorSavedSnapshot);
 const generation = ++this.currentLocationGeneration;
 this.currentLocationAbort?.abort();
 this.currentLocationAbort = null;
 this.anchorMode = 'ephemeral';
 this.setAiSummaryEnabled(false);
 this.currentLocationFix = null;
 this.currentLocationState = 'requesting';
 this.pendingCurrentLocationFocus = 'clear';
 this.currentLocationError = null;
 this.snapshot = null;
 this.snapshotPlaceSignature = null;
 this.evidenceExpiryScheduler.track(null);
 this.nodeLookup.clear();
 this.loading = false;
 this.error = null;
 this.routeGeneration += 1;
 this.routingNodeId = null;
 this.routeFeedback = null;
 this.render();
 try {
   const fix = await this.requestLocation();
   if (generation !== this.currentLocationGeneration || this.anchorMode !== 'ephemeral') return;
   this.currentLocationFix = fix;
   this.activeRadiusKm ??= 10;
   await this.fetchCurrentLocationSnapshot(fix, generation);
 } catch (error) {
   if (generation !== this.currentLocationGeneration || this.anchorMode !== 'ephemeral') return;
   this.currentLocationState = 'error';
   this.currentLocationError = this.currentLocationFailureMessage(error);
   this.pendingCurrentLocationFocus = 'update';
   this.render();
 }
  }

  private async refreshEphemeral(): Promise<void> {
 const fix = this.currentLocationFix;
 if (!fix) return;
 const generation = ++this.currentLocationGeneration;
 await this.fetchCurrentLocationSnapshot(fix, generation);
  }

  private async fetchCurrentLocationSnapshot(fix: LocationFix, generation: number): Promise<void> {
 const radiusKm = this.activeRadiusKm ?? 10;
 this.activeRadiusKm = radiusKm;
 this.currentLocationAbort?.abort();
 const controller = new AbortController();
 this.currentLocationAbort = controller;
 this.currentLocationState = 'fetching';
 this.currentLocationError = null;
 this.snapshot = null;
 this.evidenceExpiryScheduler.track(null);
 this.nodeLookup.clear();
 this.render();
 try {
   const snapshot = await this.fetchEphemeralSnapshot(
     { latitude: fix.lat, longitude: fix.lon },
     { radiusKm, signal: controller.signal },
   );
   if (controller.signal.aborted || generation !== this.currentLocationGeneration
     || this.anchorMode !== 'ephemeral' || this.currentLocationFix !== fix
     || this.activeRadiusKm !== radiusKm) return;
   if (snapshot.placeId !== 'session-current-location'
     || snapshot.placeName !== 'Current location'
     || snapshot.queryFingerprint !== 'session-lifelines'
     || snapshot.effectiveRadiusKm !== radiusKm
     || snapshot.source !== 'network') {
     throw new Error('private Lifelines response mismatch');
   }
   this.snapshot = snapshot;
   this.currentLocationState = 'ready';
   this.currentLocationError = null;
   this.pendingCurrentLocationFocus = 'update';
   this.evidenceExpiryScheduler.track(snapshot);
 } catch {
   if (controller.signal.aborted || generation !== this.currentLocationGeneration
     || this.anchorMode !== 'ephemeral') return;
   this.snapshot = null;
   this.currentLocationState = 'error';
   this.currentLocationError = 'Lifelines are temporarily unavailable. Try again.';
   this.pendingCurrentLocationFocus = 'update';
 } finally {
   if (this.currentLocationAbort === controller) this.currentLocationAbort = null;
 }
 this.render();
  }

  private currentLocationFailureMessage(error: unknown): string {
 const code = error && typeof error === 'object' && 'code' in error
   ? String((error as { code: unknown }).code)
   : 'unavailable';
 const messages: Record<string, string> = {
   denied: 'Location permission was denied. Enable location access in system or browser settings, then try again.',
   restricted: 'Location access is restricted by this device.',
   disabled: 'Location Services are disabled. Enable them, then try again.',
   timeout: 'The one-shot location request timed out. Try again where GPS or Wi-Fi is available.',
   unavailable: 'A current location is unavailable. Check GPS or Wi-Fi and try again.',
   stale: 'The device returned an old location fix. Try Update Location again.',
   inaccurate: 'The reported location was too imprecise to use safely.',
   busy: 'Another location request is already active. Try again shortly.',
   invalid: 'The device returned an invalid location fix.',
   unsupported: 'Current location is not supported in this environment.',
 };
 return messages[code] ?? messages.unavailable ?? 'A current location is unavailable.';
  }

  private clearCurrentLocation(): void {
 if (this.anchorMode !== 'ephemeral') return;
 this.resetCurrentLocationOwnership();
 this.anchorMode = 'saved';
 this.setAiSummaryEnabled(true);
 this.snapshot = null;
 this.snapshotPlaceSignature = null;
 this.nodeLookup.clear();
 this.evidenceExpiryScheduler.track(null);
 this.activeRadiusKm = null;
 this.radiusPlaceSignature = null;
 this.pendingCurrentLocationFocus = 'use';
 void this.refresh();
  }

  private saveCurrentLocation(): void {
 const fix = this.currentLocationFix;
 const radiusKm = this.activeRadiusKm;
 const openSave = this.options.openSaveCurrentLocation;
 if (this.anchorMode !== 'ephemeral' || !fix || radiusKm === null || !openSave) return;
 const generation = this.currentLocationGeneration;
 openSave(
   { latitude: fix.lat, longitude: fix.lon, radiusKm },
   (place) => {
     if (generation !== this.currentLocationGeneration || this.anchorMode !== 'ephemeral'
       || this.currentLocationFix !== fix) return;
     const readback = getSavedPlace(place.id);
     if (readback?.lat !== fix.lat || readback.lon !== fix.lon
       || readback.radiusKm !== radiusKm) return;
     this.setPlaceId(readback.id);
   },
 );
  }

  private handleSavedPlacesChanged(): void {
 if (this.anchorMode === 'ephemeral') return;
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
 if (this.anchorMode === 'ephemeral') {
   if (this.snapshot === snapshot) this.render();
   return;
 }
 applyLifelineExpiryTransition(snapshot, kind, {
   isCurrent: (identity) => {
     const place = this.resolvePlace();
     return Boolean(place && this.snapshot === snapshot
       && identity.placeId === this.activePlaceId
       && identity.queryFingerprint === snapshot.queryFingerprint
       && this.snapshotPlaceSignature === buildLifelinesPlaceMatchSignature(place)
       && this.snapshotMatchesPlace(snapshot, place));
   },
   // The render pass captures one clock value for nodes and outage coverage,
   // so repainting at the deadline removes the accepted claim consistently.
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
 if (this.anchorMode === 'ephemeral') return null;
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
 this.pendingPrewarmFocus = true;
 this.prewarmCoordinator.enqueue({ place: confirmed, radiusKm, trigger: 'manual' });
  }

  private retryPrewarm(): void {
 const state = this.prewarmState;
 if (state?.phase !== 'failed') return;
 this.pendingPrewarmFocus = true;
 this.prewarmCoordinator.retry(state.placeId, state.queryFingerprint);
  }

  private render(): void {
 if (this.anchorMode === 'ephemeral') {
   this.renderCurrentLocation();
   return;
 }
 this.setAiSummaryEnabled(true);
 const place = this.resolvePlace();
 if (!place) {
 this.setCount(0);
 this.setContent(`
 <div class="sa-panel-content local-logistics-content" data-local-logistics-content="1" aria-busy="false">
 ${this.renderCurrentLocationDisclosure()}
 <div class="panel-empty">Save a place to keep nearby logistics available across sessions.</div>
 </div>
 `, () => this.restoreCurrentLocationFocus());
 return;
 }

 const now = Date.now();
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

 const packHtml = this.renderPackStatus(place, requestedRadiusKm);

 const outageCoverage = this.snapshot ? projectLocalLogisticsOutageCoverage(this.snapshot, now) : null;
 const outageHtml = outageCoverage ? this.renderOutageCoverage(outageCoverage) : '';
 const coverage = this.snapshot ? projectLocalLogisticsCoverage(this.snapshot, now) : null;
 const facilityProviders = coverage?.providers.filter((provider) => provider.scope === 'facilities') ?? [];
 const providerHtml = coverage ? this.renderProviderCoverage(facilityProviders) : '';

 const filtersHtml = this.renderFilters(categories);
 const listHtml = this.renderNodeList(nodes, coverage?.categories ?? [], now);

 const routeFeedbackHtml = this.routeFeedback
 ? `<div class="panel-empty" style="margin-top:10px;" role="status">${escapeHtml(this.routeFeedback)}</div>`
 : '';

 const html = `
 <div class="sa-panel-content local-logistics-content" data-local-logistics-content="1" aria-busy="${this.loading}">
 ${headerHtml}
 ${this.renderCurrentLocationDisclosure()}
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
 this.setContent(html, () => {
   this.restoreRadiusFocus();
   this.restoreCurrentLocationFocus();
 });
  }

  private renderCurrentLocationDisclosure(): string {
 return `
 <section class="local-logistics-current-location" aria-label="Current-location Lifelines">
 <div class="watchlist-country">Use current location for this session</div>
 <p>Crystal Ball requests one location fix only after you choose this action and keeps it only in this Lifelines panel for session-only use.</p>
 <p>The fix is sent to the Crystal Ball Lifelines endpoint and the necessary Overpass, FEMA, Census, and ODIN paths. Crystal Ball does not persist it, but third-party provider access-log retention cannot be guaranteed. Your OS or browser may remember the permission grant.</p>
 <button class="sa-refresh-btn" data-logistics-use-current-location="1" type="button">Use current location</button>
 </section>
 `;
  }

  private renderCurrentLocation(): void {
 this.setAiSummaryEnabled(false);
 const fix = this.currentLocationFix;
 const radiusKm = this.activeRadiusKm ?? 10;
 const nodes = this.displayNodes();
 this.setCount(nodes.length);
 this.nodeLookup.clear();
 for (const node of this.snapshot?.nodes ?? []) this.nodeLookup.set(node.id, node);
 const busy = this.currentLocationState === 'requesting' || this.currentLocationState === 'fetching';
 let statusHtml = '';
 if (this.currentLocationState === 'requesting') {
   statusHtml = '<div class="panel-empty local-logistics-status" role="status" aria-live="polite">Requesting one current-location fix…</div>';
 } else if (this.currentLocationState === 'fetching') {
   statusHtml = '<div class="panel-empty local-logistics-status" role="status" aria-live="polite">Loading session-only Lifelines…</div>';
 } else if (this.currentLocationState === 'error') {
   statusHtml = `<div class="panel-empty local-logistics-status" role="alert">${escapeHtml(this.currentLocationError ?? 'Current-location Lifelines are unavailable.')}</div>`;
 }
 const uncertaintyWarning = fix && fix.accuracy / 1000 > radiusKm
   ? `<div class="panel-empty local-logistics-location-warning" role="status">Location uncertainty exceeds the selected ${radiusKm.toLocaleString()} km coverage. Results may not cover your actual position.</div>`
   : '';
 const outageCoverage = this.snapshot ? projectLocalLogisticsOutageCoverage(this.snapshot, Date.now()) : null;
 const coverage = this.snapshot ? projectLocalLogisticsCoverage(this.snapshot, Date.now()) : null;
 const facilityProviders = coverage?.providers.filter((provider) => provider.scope === 'facilities') ?? [];
 const html = `
 <div class="sa-panel-content local-logistics-content local-logistics-content--ephemeral" data-local-logistics-content="1" aria-busy="${busy}">
 ${this.renderCurrentLocationHeader(fix, busy)}
 ${statusHtml}
 ${uncertaintyWarning}
 ${this.renderRadiusControls(radiusKm)}
 ${outageCoverage ? this.renderOutageCoverage(outageCoverage) : ''}
 ${coverage ? this.renderProviderCoverage(facilityProviders) : ''}
 ${this.renderFilters(this.displayCategories())}
 ${this.renderNodeList(nodes, coverage?.categories ?? [], Date.now())}
 </div>
 `;
 this.setContent(html, () => {
   this.restoreRadiusFocus();
   this.restoreCurrentLocationFocus();
 });
  }

 private renderCurrentLocationHeader(
 fix: LocationFix | null,
 busy: boolean,
  ): string {
 const accuracy = formatCurrentLocationAccuracy(fix);
 const observed = fix ? formatRetrievedAt(new Date(fix.timestamp)) : 'not available';
 const disabledAttribute = busy ? 'disabled' : '';
 const saveButton = fix && this.options.openSaveCurrentLocation
   ? `<button class="sa-refresh-btn" data-logistics-save-location="1" type="button" ${disabledAttribute}>Save as place…</button>`
   : '';
 const refreshButton = fix
   ? `<button class="sa-refresh-btn" data-logistics-refresh="1" type="button" ${disabledAttribute}>Refresh Lifelines</button>`
   : '';
 const updateLabel = fix ? 'Update Location' : 'Try location again';
 return `
 <div class="watchlist-card-top local-logistics-header local-logistics-current-header">
 <div>
 <div class="watchlist-country">Current location</div>
 <div class="watchlist-scenario">Accuracy ${escapeHtml(accuracy)} • Observed ${escapeHtml(observed)} • Session only</div>
 </div>
 <div class="watchlist-card-bottom">
 ${refreshButton}
 <button class="sa-refresh-btn" data-logistics-update-location="1" type="button" ${disabledAttribute}>${updateLabel}</button>
 <button class="sa-refresh-btn" data-logistics-clear-location="1" type="button">Clear location</button>
 ${saveButton}
 </div>
 </div>
 `;
  }

  private restoreCurrentLocationFocus(): void {
 const target = this.pendingCurrentLocationFocus;
 if (!target) return;
 const selectors: Record<NonNullable<typeof target>, string> = {
   update: '[data-logistics-update-location]',
   clear: '[data-logistics-clear-location]',
   use: '[data-logistics-use-current-location]',
 };
 const selector = selectors[target];
 const button = this.content.querySelector<HTMLButtonElement>(selector);
 if (!button) return;
 this.pendingCurrentLocationFocus = null;
 button.focus();
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

  private renderPackStatus(place: SavedPlace, radiusKm: LocalLogisticsRadiusChoiceKm): string {
 if (!this.snapshot) return '';
 const readiness = this.getExactPackReadiness(place, radiusKm);
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

  private renderNodeList(
 nodes: LogisticsNode[],
 coverage: LifelineCategoryCoverage[],
 now: number,
  ): string {
 if (!this.snapshot) return '';
 if (nodes.length === 0) {
   return this.renderCategoryEmptyState(coverage, this.snapshot.effectiveRadiusKm);
 }
 return `
 <div class="watchlist-list">
 ${nodes.map((node) => this.renderNode(node, now)).join('')}
 </div>
 `;
  }

  private restoreRadiusFocus(): void {
 const radiusKm = this.pendingRadiusFocusKm;
 if (radiusKm === null || radiusKm !== this.activeRadiusKm) {
   this.restorePrewarmFocus();
   return;
 }
 const button = this.content.querySelector<HTMLButtonElement>(
   `[data-logistics-radius="${radiusKm}"]`,
 );
 if (!button) return;
 this.pendingRadiusFocusKm = null;
 button.focus();
 this.restorePrewarmFocus();
  }

  private restorePrewarmFocus(): void {
 if (!this.pendingPrewarmFocus) return;
 const button = this.content.querySelector<HTMLButtonElement>('[data-lifeline-prewarm]');
 if (!button) return;
 this.pendingPrewarmFocus = false;
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

  private renderNode(node: LogisticsNode, now: number): string {
 const expired = node.expiresAt.getTime() <= now;
 const presentation = getLifelineMarkerPresentation(node, now);
 const requiresHotelConfirmation = presentation.isHotelDirectory;
 const callHref = buildLifelineCallHref(node.publicPhone);
 const operational = formatNodeOperational(node, now);
 const capabilities = renderNodeCapabilities(node);
 const phone = renderNodePhone(node, requiresHotelConfirmation, callHref);
 const retrieval = renderNodeRetrieval(node, requiresHotelConfirmation);
 const callAction = renderNodeCallAction(node, requiresHotelConfirmation, callHref);
 const chips = [
 `<span class="watchlist-panel-chip">${escapeHtml(LOCAL_LOGISTICS_CATEGORY_LABELS[node.category])}</span>`,
 `<span class="watchlist-panel-chip">Operational: ${escapeHtml(formatState(
   presentation.isHotelDirectory ? presentation.status.operational : operational,
 ))}</span>`,
 `<span class="watchlist-panel-chip">Inventory: ${escapeHtml(formatState(presentation.status.inventory))}</span>`,
 `<span class="watchlist-panel-chip">Power: ${escapeHtml(formatState(presentation.status.power))}</span>`,
 `<span class="watchlist-panel-chip">Access: ${escapeHtml(formatState(presentation.status.access))}</span>`,
 ].filter(Boolean).join('');

 const expiry = expired
 ? `Verification expired ${escapeHtml(formatUpdatedAt(node.expiresAt))}`
 : `Status expires ${escapeHtml(formatUpdatedAt(node.expiresAt))}`;
 const savedPlaceActions = this.renderSavedPlaceActions(node);

 return `
 <article class="watchlist-card local-logistics-node-card" data-logistics-node-card="${escapeHtml(node.id)}">
 <div class="watchlist-card-top">
 <div>
 <div class="watchlist-country">${escapeHtml(node.name)}</div>
 <div class="watchlist-scenario">${escapeHtml(formatDistance(node.distanceKm))} • ${escapeHtml(node.hazardCompatibility)}</div>
 </div>
 </div>
 <div class="watchlist-summary">${escapeHtml(node.address ?? 'No street address published')}</div>
 ${capabilities}
 ${phone}
 <div class="watchlist-card-bottom">
 <div class="watchlist-panels">${chips}</div>
 </div>
 <div class="watchlist-scenario">${escapeHtml(requiresHotelConfirmation ? presentation.evidenceLabel : formatStatus(node, now))} • ${expiry} • ${escapeHtml(node.source)}</div>
 ${retrieval}
 <div class="watchlist-card-bottom">
 ${savedPlaceActions}
 <button class="sa-refresh-btn" data-logistics-external-map="${escapeHtml(node.id)}" type="button" aria-label="Open ${escapeHtml(node.name)} in external maps">Open in Maps</button>
 ${callAction}
 <button class="sa-refresh-btn" data-logistics-source="${escapeHtml(node.id)}" type="button" aria-label="Open source for ${escapeHtml(node.name)}">Source</button>
 </div>
 </article>
 `;
  }

  private renderSavedPlaceActions(node: LogisticsNode): string {
 if (this.anchorMode !== 'saved') return '';
 const disabledAttribute = this.routingNodeId ? 'disabled' : '';
 const routeLabel = this.routingNodeId === node.id ? 'Routing…' : 'Graph route';
 return `<button class="sa-refresh-btn" data-logistics-focus="1" data-logistics-node-id="${escapeHtml(node.id)}" type="button" aria-label="Focus ${escapeHtml(node.name)} on map">Show on map</button>
 <button class="sa-refresh-btn" data-logistics-route="${escapeHtml(node.id)}" type="button" aria-label="Plan an unverified road-graph route to ${escapeHtml(node.name)}" ${disabledAttribute}>${routeLabel}</button>`;
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

  private renderOutageCoverage(coverage: LocalLogisticsOutageCoverage): string {
 const summaryByState: Record<LocalLogisticsOutageCoverage['state'], string> = {
   'reported-current': `${coverage.currentContributedRows.toLocaleString()} current exact-county outage report${coverage.currentContributedRows === 1 ? '' : 's'} available.`,
   'reported-current-partial': `${coverage.currentContributedRows.toLocaleString()} current exact-county outage report${coverage.currentContributedRows === 1 ? '' : 's'} available with partial provider coverage.`,
   'unknown-geography': 'County outage coverage unknown because exact county FIPS is unavailable.',
   'unknown-no-contributions': 'County outage coverage unknown. ORNL ODIN contributed no current accepted outage reports.',
   'unknown-expired': 'County outage coverage unknown. Only expired ORNL ODIN reports are retained as expired evidence.',
   'unknown-unavailable': 'County outage coverage unknown because ORNL ODIN is unavailable.',
 };
 const claimsHtml = coverage.claims.length > 0
   ? this.renderOutageClaims(coverage.claims)
   : '<p class="local-logistics-outage-empty">No individual outage reports are available. This is not zero outages.</p>';
 return `
 <section
 class="local-logistics-outage-coverage"
 data-outage-coverage-matrix="1"
 aria-labelledby="local-logistics-outage-heading"
 >
 <h3 id="local-logistics-outage-heading">County outage evidence</h3>
 <p class="local-logistics-outage-summary">${escapeHtml(summaryByState[coverage.state])} This is not zero outages and does not mean power is on.</p>
 <p class="local-logistics-outage-disclosure">${escapeHtml(coverage.sourceLabel)} is a single source and is not independently corroborated. Exact-county context is not facility power or status. Individual reports are never summed.</p>
 ${this.renderOutageProviderTelemetry(coverage)}
 ${claimsHtml}
 </section>
 `;
  }

  private renderOutageProviderTelemetry(coverage: LocalLogisticsOutageCoverage): string {
 return `
 <div class="local-logistics-table-scroll" role="region" aria-label="ORNL ODIN provider telemetry" tabindex="0">
 <table class="local-logistics-outage-table">
 <caption>ORNL ODIN provider telemetry</caption>
 <thead><tr>
 <th scope="col">Source</th>
 <th scope="col">Exact county FIPS</th>
 <th scope="col">Coverage state</th>
 <th scope="col">Accepted before final reconciliation</th>
 <th scope="col">Dropped / rejected</th>
 <th scope="col">Contributed</th>
 <th scope="col">Current unexpired</th>
 <th scope="col">Retrieved</th>
 <th scope="col">Source observation</th>
 <th scope="col">Freshness expiry</th>
 <th scope="col">Independent corroboration</th>
 </tr></thead>
 <tbody><tr>
 <th scope="row">${escapeHtml(coverage.sourceLabel)}</th>
 <td>${escapeHtml(coverage.queryCountyFips ?? 'Unknown')}</td>
 <td>${escapeHtml(formatState(coverage.state))}</td>
 <td>Unavailable — ${escapeHtml(coverage.acceptedRowsAvailability.replace('-', ' '))}</td>
 <td>${escapeHtml(renderEvidenceCount(coverage.droppedRows))}</td>
 <td>${escapeHtml(renderEvidenceCount(coverage.contributedRows))}</td>
 <td>${coverage.currentContributedRows.toLocaleString()}</td>
 <td>${renderEvidenceTime(coverage.providerRetrievedAt)}</td>
 <td>${renderEvidenceTime(coverage.providerSourceObservedAt, 'Not published')}</td>
 <td>${renderEvidenceTime(coverage.providerFreshnessExpiresAt)}</td>
 <td>No — single source</td>
 </tr></tbody>
 </table>
 </div>
 `;
  }

  private renderOutageClaims(claims: LocalLogisticsOutageClaim[]): string {
 return `
 <div class="local-logistics-table-scroll" role="region" aria-label="Individual outage reports" tabindex="0">
 <table class="local-logistics-outage-table local-logistics-outage-report-table">
 <caption>Individual outage reports — never summed</caption>
 <thead><tr>
 <th scope="col">Source</th>
 <th scope="col">County</th>
 <th scope="col">FIPS</th>
 <th scope="col">Utility</th>
 <th scope="col">Customers reported out</th>
 <th scope="col">Retrieved</th>
 <th scope="col">Source observation</th>
 <th scope="col">Expiry</th>
 <th scope="col">Freshness</th>
 </tr></thead>
 <tbody>
 ${claims.map((claim) => {
   const utility = claim.utilityName ?? 'Utility not identified by source';
   const utilityId = claim.utilityId ? ` (${claim.utilityId})` : '';
   return `<tr>
 <th scope="row">${escapeHtml(claim.sourceLabel)}</th>
 <td>${escapeHtml(`${claim.county}, ${claim.state}`)}</td>
 <td>${escapeHtml(claim.countyFips)}</td>
 <td>${escapeHtml(`${utility}${utilityId}`)}</td>
 <td>${claim.customersOut.toLocaleString()}</td>
 <td>${renderEvidenceTime(claim.retrievedAt)}</td>
 <td>${renderEvidenceTime(claim.sourceObservedAt, 'Not published')}</td>
 <td>${renderEvidenceTime(claim.expiresAt)}</td>
 <td>${claim.freshness === 'current' ? 'Current' : 'Expired'}</td>
 </tr>`;
 }).join('')}
 </tbody>
 </table>
 </div>
 `;
  }
}
