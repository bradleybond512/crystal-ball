import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import {
  getPrimarySavedPlace,
  getSavedPlace,
  getSavedPlaces,
  subscribeSavedPlaces,
  type SavedPlace,
} from '@/services/saved-places';
import {
  buildLocalLogisticsFingerprint,
  fetchLocalLogistics,
  LOCAL_LOGISTICS_CATEGORIES,
  LOCAL_LOGISTICS_CATEGORY_LABELS,
  selectTopLocalLogisticsNodes,
  type LocalLogisticsSnapshot,
  type LogisticsCategory,
  type LogisticsNode,
} from '@/services/local-logistics';
import { buildLifelinesPlaceMatchSignature } from './disaster-lifelines-map-helpers';
import {
  applyExpiredLifelineEvidenceTransition,
  LifelineEvidenceExpiryScheduler,
} from './lifeline-evidence-expiry';
import {
  getLifelinePackReadinessForPlace,
  getRecentLifelineChangesForPlace,
} from '@/services/lifelines/lifeline-runtime';
import { deleteRoute, getEvacRouteDisclosure, planRoute } from '@/services/evacuation-router';

interface LocalLogisticsPanelOptions {
  focusNode: (lat: number, lon: number) => void;
}

type LocalLogisticsFilter = 'all' | LogisticsCategory;
const DEFAULT_LIFELINES_RADIUS_KM = 25;

function formatUpdatedAt(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

export class LocalLogisticsPanel extends Panel {
  private readonly options: LocalLogisticsPanelOptions;
  private activePlaceId: string | null = null;
  private activeFilter: LocalLogisticsFilter = 'all';
  private snapshot: LocalLogisticsSnapshot | null = null;
  private error: string | null = null;
  private routeFeedback: string | null = null;
  private routingNodeId: string | null = null;
  private routeGeneration = 0;
  private refreshGeneration = 0;
  private activePlaceSignature: string | null = null;
  private snapshotPlaceSignature: string | null = null;
  private unsubscribeSavedPlaces: (() => void) | null = null;
  private readonly nodeLookup = new Map<string, LogisticsNode>();
  private readonly evidenceExpiryScheduler = new LifelineEvidenceExpiryScheduler({
 onExpiry: (snapshot) => this.transitionExpiredEvidence(snapshot),
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
 this.showLoading('Loading disaster lifelines…');

 this.content.addEventListener('click', (event) => {
 const target = event.target as HTMLElement | null;
 const filterButton = target?.closest<HTMLElement>('[data-logistics-filter]');
 if (filterButton) {
 this.activeFilter = (filterButton.dataset.logisticsFilter ?? 'all') as LocalLogisticsFilter;
 this.render();
 return;
 }

 if (target?.closest('[data-logistics-refresh]')) {
 void this.refresh();
 return;
 }

 const mapButton = target?.closest<HTMLElement>('[data-logistics-map]');
 if (mapButton) {
 const snapshot = this.snapshot;
 const place = this.resolvePlace();
 if (!snapshot || !place || snapshot.placeId !== this.activePlaceId
   || this.snapshotPlaceSignature !== buildLifelinesPlaceMatchSignature(place)
   || !this.snapshotMatchesPlace(snapshot, place)) return;
 document.dispatchEvent(new CustomEvent('wm:show-lifelines-overlay', { detail: { snapshot } }));
 return;
 }

 const sourceButton = target?.closest<HTMLElement>('[data-logistics-source]');
 if (sourceButton) {
 const sourceNode = this.nodeLookup.get(sourceButton.dataset.logisticsSource ?? '');
 const safeUrl = sourceNode ? sanitizeUrl(sourceNode.sourceUrl || sourceNode.url || '') : '';
 if (safeUrl && safeUrl !== '#') window.open(safeUrl, '_blank', 'noopener,noreferrer');
 return;
 }

 const routeButton = target?.closest<HTMLElement>('[data-logistics-route]');
 if (routeButton) {
 const routeNode = this.nodeLookup.get(routeButton.dataset.logisticsRoute ?? '');
 if (routeNode) void this.routeToNode(routeNode);
 return;
 }

 const nodeButton = target?.closest<HTMLElement>('[data-logistics-focus]');
 const nodeId = nodeButton?.dataset.logisticsNodeId;
 if (!nodeId) return;
 const node = this.nodeLookup.get(nodeId);
 if (!node) return;
 this.options.focusNode(node.lat, node.lon);
 });

 this.unsubscribeSavedPlaces = subscribeSavedPlaces(() => this.handleSavedPlacesChanged());
 document.addEventListener('wm:lifeline-situation-updated', this.onLifelineSituationUpdated);
  }

  public setPlaceId(placeId: string | null): void {
 const priorSnapshot = this.snapshot;
 this.activePlaceId = placeId;
 this.activePlaceId = this.getActivePlaceId();
 // Reselecting the same saved-place ID still supersedes the accepted exact
 // snapshot. Clear that overlay before dropping either snapshot or timer
 // ownership so its expiry transition cannot be orphaned on the map.
 if (priorSnapshot) this.requestOverlayClear(priorSnapshot);
 this.evidenceExpiryScheduler.track(null);
 this.activePlaceSignature = null;
 this.snapshotPlaceSignature = null;
 this.snapshot = null;
 this.routeFeedback = null;
 this.routingNodeId = null;
 this.routeGeneration += 1;
 this.announceActivePlaceChanged();
 void this.refresh();
  }

  /** Selected place context used by adjacent panels to ignore background prewarms. */
  public getActivePlaceId(): string | null {
 const place = this.resolvePlace();
 return place?.id ?? null;
  }

  override destroy(): void {
 this.routeGeneration += 1;
 this.routingNodeId = null;
 this.evidenceExpiryScheduler.destroy();
 document.removeEventListener('wm:lifeline-situation-updated', this.onLifelineSituationUpdated);
 this.unsubscribeSavedPlaces?.();
 this.unsubscribeSavedPlaces = null;
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
 this.setCount(0);
 this.setContent('<div class="panel-empty">Save a place to unlock nearby logistics.</div>');
 return;
 }

 this.activePlaceId = place.id;
 const placeSignature = buildLifelinesPlaceMatchSignature(place);
 this.activePlaceSignature = placeSignature;
 this.showLoading(`Loading lifelines near ${place.name}…`);
 try {
 const snapshot = await fetchLocalLogistics(place);
 const currentPlace = this.resolvePlace();
 if (generation !== this.refreshGeneration || this.activePlaceId !== place.id
   || !currentPlace || buildLifelinesPlaceMatchSignature(currentPlace) !== placeSignature) return;
 if (!this.snapshotMatchesPlace(snapshot, currentPlace)) {
   throw new Error('Lifeline results did not match the current saved place');
 }
 this.snapshot = snapshot;
 this.snapshotPlaceSignature = placeSignature;
 this.evidenceExpiryScheduler.track(snapshot);
 this.error = null;
 document.dispatchEvent(new CustomEvent('wm:active-local-logistics-snapshot-updated', {
   detail: { snapshot: this.snapshot },
 }));
 } catch (error) {
 const currentPlace = this.resolvePlace();
 if (generation !== this.refreshGeneration || this.activePlaceId !== place.id
   || !currentPlace || buildLifelinesPlaceMatchSignature(currentPlace) !== placeSignature) return;
 // fetchLocalLogistics already performs an exact-fingerprint fallback. A
 // place-only lookup here could surface a cache for old coordinates/options.
 this.snapshot = null;
 this.snapshotPlaceSignature = null;
 this.error = error instanceof Error ? error.message : 'Failed to load disaster lifelines';
 }

 this.render();
  }

  private handleSavedPlacesChanged(): void {
 const place = this.resolvePlace();
 const nextSignature = place ? buildLifelinesPlaceMatchSignature(place) : null;
 if (nextSignature === this.activePlaceSignature) return;
 if (this.snapshot) this.requestOverlayClear(this.snapshot);
 this.activePlaceId = place?.id ?? null;
 this.snapshot = null;
 this.snapshotPlaceSignature = null;
 this.activePlaceSignature = nextSignature;
 this.routeFeedback = null;
 this.routingNodeId = null;
 this.routeGeneration += 1;
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

  private transitionExpiredEvidence(snapshot: LocalLogisticsSnapshot): void {
 applyExpiredLifelineEvidenceTransition(snapshot, {
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

  private snapshotMatchesPlace(snapshot: LocalLogisticsSnapshot, place: SavedPlace): boolean {
 const radiusKm = Math.max(1, Math.min(place.radiusKm, DEFAULT_LIFELINES_RADIUS_KM));
 const expectedFingerprint = buildLocalLogisticsFingerprint(
   place,
   radiusKm,
   [...LOCAL_LOGISTICS_CATEGORIES],
 );
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

  private render(): void {
 const place = this.resolvePlace();
 if (!place) {
 this.setCount(0);
 this.setContent('<div class="panel-empty">Save a place to unlock nearby logistics.</div>');
 return;
 }

 if (!this.snapshot) {
 if (this.error) {
 this.showError(this.error);
 return;
 }
 this.showLoading(`Loading lifelines near ${place.name}…`);
 return;
 }

 const categories = this.snapshot.categories.length > 0
 ? this.snapshot.categories
 : [...LOCAL_LOGISTICS_CATEGORIES];
 const nodes = selectTopLocalLogisticsNodes(this.snapshot, this.activeFilter, this.activeFilter === 'all' ? 12 : 6);
 this.setCount(nodes.length);
 for (const node of this.snapshot.nodes) {
 this.nodeLookup.set(node.id, node);
 }

 const headerHtml = `
 <div class="watchlist-card-top" style="margin-bottom:10px;">
 <div>
 <div class="watchlist-country">${escapeHtml(place.name)}</div>
 <div class="watchlist-scenario">Radius ${this.snapshot.effectiveRadiusKm.toLocaleString()} km • Updated ${escapeHtml(formatUpdatedAt(this.snapshot.fetchedAt))}</div>
 </div>
 <div class="watchlist-card-bottom">
 <button
 class="sa-refresh-btn"
 data-logistics-map="1"
 type="button"
 aria-label="Show ${escapeHtml(this.snapshot.nodes.length.toLocaleString())} disaster lifelines near ${escapeHtml(place.name)} on the map"
 ${this.snapshot.nodes.length === 0 ? 'disabled' : ''}
 >Map</button>
 <button class="sa-refresh-btn" data-logistics-refresh="1" type="button" aria-label="Refresh disaster lifelines near ${escapeHtml(place.name)}">Refresh</button>
 </div>
 </div>
 `;

 const staleHtml = this.snapshot.isStale
 ? `<div class="panel-empty" style="margin-bottom:10px;">${this.snapshot.isExpired ? 'Cached Lifeline Pack expired; all current availability must be reconfirmed.' : `Showing stale cached Lifeline Pack from ${escapeHtml(formatUpdatedAt(this.snapshot.fetchedAt))}.`}</div>`
 : '';

 const readiness = getLifelinePackReadinessForPlace(place);
 const latestChange = getRecentLifelineChangesForPlace(place)[0] ?? null;
 const packHtml = `
 <div class="panel-empty" style="margin-bottom:10px;">
 Offline Lifelines: ${escapeHtml(formatPackStatus(readiness.status))}.
 ${latestChange
   ? `<br>Recent evidence change (review-only): ${escapeHtml(formatState(latestChange.attribute))} ${escapeHtml(String(latestChange.from ?? 'unknown'))} → ${escapeHtml(String(latestChange.to ?? 'unknown'))}, ${escapeHtml(formatUpdatedAt(latestChange.observedAt))}.`
   : ''}
 </div>
 `;

 const outageHtml = this.renderOutageContext();

 const filtersHtml = `
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

 const listHtml = nodes.length === 0
 ? '<div class="panel-empty">No nearby logistics nodes matched this place yet. Try refresh or widen the place radius.</div>'
 : `
 <div class="watchlist-list">
 ${nodes.map((node) => this.renderNode(node)).join('')}
 </div>
 `;

 const errorHtml = this.error
 ? `<div class="watchlist-scenario" style="margin-top:10px;">${escapeHtml(this.error)}</div>`
 : '';
 const routeFeedbackHtml = this.routeFeedback
 ? `<div class="panel-empty" style="margin-top:10px;" role="status">${escapeHtml(this.routeFeedback)}</div>`
 : '';

 this.setContent(`
 <div class="sa-panel-content">
 ${headerHtml}
 ${staleHtml}
 ${packHtml}
 ${outageHtml}
 ${filtersHtml}
 ${listHtml}
 ${routeFeedbackHtml}
 ${errorHtml}
 </div>
 `);
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
 <article class="watchlist-card">
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
