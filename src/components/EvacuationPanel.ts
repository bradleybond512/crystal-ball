import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getSavedPlaces, subscribeSavedPlaces, type SavedPlace } from '@/services/saved-places';
import {
  planRoute,
  getSavedRoutes,
  deleteRoute,
  getHomePlace,
  getBugoutPlace,
  subscribeEvacRoutes,
  getEvacRouteDisclosure,
  type EvacRoute,
  type LatLon,
} from '@/services/evacuation-router';
import {
  canonicalEvacRouteFingerprint,
  evacuationHazardExposureStore,
  type EvacuationHazardExposure,
  type EvacuationHazardExposureSnapshot,
  type EvacuationHazardExposureStore,
  type HazardExposureEvidence,
  type HazardExposureReason,
  type HazardExposureTruth,
} from '@/services/weather/evacuation-hazard-exposure';

// ── SVG icons ────────────────────────────────────────────────────────────────

const ROUTE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
const DELETE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const MAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`;

export class EvacuationPanel extends Panel {
  private places: SavedPlace[] = [];
  private routes: EvacRoute[] = [];
  private routeFingerprints = new Map<EvacRoute, string>();
  private unsubPlaces: (() => void) | null = null;
  private unsubRoutes: (() => void) | null = null;
  private unsubHazardExposure: (() => void) | null = null;
  private hazardExposureSnapshot: EvacuationHazardExposureSnapshot;
  private planning = false;
  private planningError: string | null = null;
  private expandedRouteId: string | null = null;

  constructor(
 private readonly hazardExposureStore: EvacuationHazardExposureStore = evacuationHazardExposureStore,
  ) {
 super({
 id: 'evacuation',
 title: 'Evacuation Routes',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Plan OSRM driving-graph estimates between saved places with offline-cached directions. Current road conditions are not verified.',
 });

 this.content.addEventListener('click', (e) => this.handleClick(e));

 this.hazardExposureSnapshot = this.hazardExposureStore.getSnapshot();

 this.unsubPlaces = subscribeSavedPlaces(() => this.refresh());
 this.unsubRoutes = subscribeEvacRoutes(() => this.refresh());
 this.unsubHazardExposure = this.hazardExposureStore.subscribe((snapshot) => {
 this.hazardExposureSnapshot = snapshot;
 this.renderContent();
 });

 this.refresh();
  }

  override destroy(): void {
 this.unsubPlaces?.();
 this.unsubRoutes?.();
 this.unsubHazardExposure?.();
 this.unsubPlaces = null;
 this.unsubRoutes = null;
 this.unsubHazardExposure = null;
 this.hazardExposureStore.setRoutes([]);
 super.destroy();
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  public refresh(): void {
 this.places = getSavedPlaces();
 this.routes = getSavedRoutes();
 this.routeFingerprints = new Map(
 this.routes.map((route) => [route, canonicalEvacRouteFingerprint(route)]),
 );
 this.hazardExposureStore.setRoutes(this.routes);
 this.setCount(this.routes.length);
 this.renderContent();
  }

  private renderContent(): void {
 const focused = this.captureFocusedControl();
 const customRouteSelections = this.captureCustomRouteSelections();
 const parts: string[] = [];

 if (this.planningError) {
 parts.push(`<div class="evac-error" role="alert">${escapeHtml(this.planningError)}</div>`);
 }

 // Quick Route section
 parts.push(this.renderQuickRoute());

 // Custom Route builder
 parts.push(this.renderCustomRoute());

 // Saved Routes list
 if (this.routes.length > 0) {
 parts.push(this.renderSavedRoutes());
 }

 this.content.innerHTML = parts.join('');
 this.restoreCustomRouteSelections(customRouteSelections);
 this.restoreFocusedControl(focused);
  }

  private renderQuickRoute(): string {
 const home = getHomePlace();
 const bugout = getBugoutPlace();
 const canRoute = home && bugout;

 return `
 <div class="evac-section">
 <div class="evac-section-title">Quick Route</div>
 ${canRoute
 ? `<button class="evac-btn evac-btn-primary" data-evac-action="quick-bugout" ${this.planning ? 'disabled' : ''}>
 ${ROUTE_SVG} Route to Bug-out
 </button>
 <div class="evac-hint">${escapeHtml(home.name)} &rarr; ${escapeHtml(bugout.name)}</div>`
 : `<div class="evac-hint evac-hint-warn">Tag a place as "home" and another as "bugout" in Saved Places to enable quick routing.</div>`
 }
 </div>`;
  }

  private renderCustomRoute(): string {
 const placeOptions = this.places
 .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
 .join('');

 return `
 <div class="evac-section">
 <div class="evac-section-title">Custom Route</div>
 <div class="evac-custom-form">
 <label class="evac-label">From
 <select class="evac-select" data-evac-field="from">
 <option value="">-- select place --</option>
 ${placeOptions}
 </select>
 </label>
 <label class="evac-label">To
 <select class="evac-select" data-evac-field="to">
 <option value="">-- select place --</option>
 ${placeOptions}
 </select>
 </label>
 <button class="evac-btn evac-btn-secondary" data-evac-action="plan-custom" ${this.planning ? 'disabled' : ''}>
 ${ROUTE_SVG} Plan Route
 </button>
 </div>
 </div>`;
  }

  private renderSavedRoutes(): string {
 const items = this.routes.map((r) => {
 const age = this.formatAge(r.cachedAt);
 const dist = r.distanceKm < 1 ? `${(r.distanceKm * 1000).toFixed(0)} m` : `${r.distanceKm.toFixed(1)} km`;
 const dur = r.durationMinutes < 1 ? '<1 min' : `${Math.round(r.durationMinutes)} min`;
 const expanded = this.expandedRouteId === r.id;
 const exposure = this.hazardExposureSnapshot.results.find((candidate) => (
 candidate.routeId === r.id
 && candidate.routeFingerprint === this.routeFingerprints.get(r)
 ));

 let stepsHtml = '';
 if (expanded && r.steps.length > 0) {
 const stepItems = r.steps
 .map((s) => {
 const sDist = s.distanceKm < 1 ? `${(s.distanceKm * 1000).toFixed(0)} m` : `${s.distanceKm.toFixed(1)} km`;
 return `<li class="evac-step">${escapeHtml(s.instruction)} <span class="evac-step-meta">(${sDist})</span></li>`;
 })
 .join('');
 stepsHtml = `<ol class="evac-steps">${stepItems}</ol>`;
 }

 return `
 <div class="evac-route-card" data-evac-route-id="${escapeHtml(r.id)}">
 <div class="evac-route-header">
 <div class="evac-route-label" data-evac-action="toggle-steps">${escapeHtml(r.from.label)} &rarr; ${escapeHtml(r.to.label)}</div>
 <div class="evac-route-actions">
 <button class="evac-btn-icon" data-evac-action="show-map" title="Show graph route on map" aria-label="Show ${escapeHtml(r.from.label)} to ${escapeHtml(r.to.label)} graph route on map">${MAP_SVG}</button>
 <button class="evac-btn-icon evac-btn-danger" data-evac-action="delete" title="Delete route" aria-label="Delete ${escapeHtml(r.from.label)} to ${escapeHtml(r.to.label)} route">${DELETE_SVG}</button>
 </div>
 </div>
 <div class="evac-route-meta">${dist} &middot; graph estimate ${dur} &middot; cached ${age}</div>
 <div class="evac-hint evac-hint-warn">${escapeHtml(getEvacRouteDisclosure())}</div>
 ${this.renderHazardExposure(r, exposure)}
 <div class="evac-cache-status">Route cached &#10003; &mdash; available offline</div>
 ${stepsHtml}
 </div>`;
 }).join('');

 return `
 <div class="evac-section">
 <div class="evac-section-title">Saved Routes (${this.routes.length})</div>
 ${items}
 </div>`;
  }

  private renderHazardExposure(route: EvacRoute, exposure?: EvacuationHazardExposure): string {
 const titleId = `evac-hazard-title-${escapeHtml(route.id)}`;
 if (!exposure) {
 return `<section class="evac-hazard-evidence evac-hazard-evidence-loading" data-evac-hazard-status role="status" aria-live="polite" aria-busy="true" aria-labelledby="${titleId}">
 <div class="evac-hazard-title" id="${titleId}">Current hazard and closure evidence</div>
 <div class="evac-hazard-loading">Evaluating current NWS hazard exposure...</div>
 <div class="evac-hazard-disclosure">Hazard evidence does not verify road closure, passability, reachability, or route safety.</div>
 </section>`;
 }

 return `<section class="evac-hazard-evidence" data-evac-hazard-status role="status" aria-live="polite" aria-busy="false" aria-labelledby="${titleId}">
 <div class="evac-hazard-title" id="${titleId}">Current hazard and closure evidence</div>
 <div class="evac-hazard-grid">
 ${this.renderRouteTruth(exposure.route)}
 ${this.renderEndpointTruth('A', exposure.endpoints.from)}
 ${this.renderEndpointTruth('B', exposure.endpoints.to)}
 <div class="evac-hazard-item evac-hazard-unknown">
 <div class="evac-hazard-item-title">Road closure evidence unknown</div>
 <div>No closure feed is configured.</div>
 </div>
 </div>
 <div class="evac-hazard-disclosure">Hazard evidence does not verify road closure, passability, reachability, or route safety.</div>
 </section>`;
  }

  private renderRouteTruth(truth: HazardExposureTruth): string {
 if (truth.status === 'reported_intersection') {
 return `<div class="evac-hazard-item evac-hazard-reported">
 <div class="evac-hazard-item-title">Reported NWS alert-area intersection</div>
 <div>NWS reports ${escapeHtml(truth.evidence.event)} intersecting this graph route.</div>
 ${this.renderEvidence(truth.evidence)}
 </div>`;
 }
 return `<div class="evac-hazard-item evac-hazard-unknown">
 <div class="evac-hazard-item-title">Route hazard exposure unknown</div>
 <div>Current NWS coverage was not proven for the full graph route.</div>
 </div>`;
  }

  private renderEndpointTruth(label: 'A' | 'B', truth: HazardExposureTruth): string {
 if (truth.status === 'reported_intersection') {
 const basis = truth.evidence.basis === 'polygon'
 ? 'alert polygon'
 : `UGC zone ${escapeHtml(truth.evidence.ugcZone ?? '')}`;
 return `<div class="evac-hazard-item evac-hazard-reported">
 <div class="evac-hazard-item-title">Reported NWS impact at endpoint ${label}</div>
 <div>NWS reports ${escapeHtml(truth.evidence.event)} by ${basis}.</div>
 ${this.renderEvidence(truth.evidence)}
 </div>`;
 }
 if (truth.status === 'no_reported_intersection') {
 return `<div class="evac-hazard-item evac-hazard-covered-negative">
 <div class="evac-hazard-item-title">No reported NWS Severe/Extreme alert intersection at endpoint ${label}</div>
 <div>Within current NWS point jurisdiction as of ${this.renderTime(truth.retrievedAt)}. This point check does not cover the route corridor.</div>
 </div>`;
 }
 return `<div class="evac-hazard-item evac-hazard-unknown">
 <div class="evac-hazard-item-title">Endpoint ${label} hazard exposure unknown</div>
 <div>${this.unknownReason(truth.reason)}</div>
 </div>`;
  }

  private renderEvidence(evidence: HazardExposureEvidence): string {
 const coverage = evidence.basis === 'polygon'
 ? 'alert polygon'
 : `UGC zone ${escapeHtml(evidence.ugcZone ?? '')}`;
 const onset = evidence.onsetAt === null
 ? '<span>Onset: not provided</span>'
 : `<span>Onset: ${this.renderTime(evidence.onsetAt)}</span>`;
 return `<div class="evac-hazard-details">
 <span>Source: ${escapeHtml(evidence.source)}</span>
 <span>Reported: ${this.renderTime(evidence.sentAt)}</span>
 <span>Effective: ${this.renderTime(evidence.effectiveAt)}</span>
 ${onset}
 <span>Retrieved: ${this.renderTime(evidence.retrievedAt)}</span>
 <span>Expires: ${this.renderTime(evidence.expiresAt)}</span>
 <span>Coverage: ${coverage}</span>
 </div>`;
  }

  private renderTime(timestamp: number): string {
 const date = new Date(timestamp);
 const iso = date.toISOString();
 return `<time datetime="${escapeHtml(iso)}">${escapeHtml(date.toLocaleString())}</time>`;
  }

  private unknownReason(reason: HazardExposureReason): string {
 switch (reason) {
 case 'feed_not_current': return 'Feed not current.';
 case 'jurisdiction_unknown': return 'Jurisdiction unknown.';
 case 'outside_jurisdiction': return 'Outside NWS point jurisdiction.';
 case 'alert_unevaluable': return 'Alert evidence could not be completely evaluated.';
 case 'evaluation_limit': return 'Evaluation limit reached.';
 case 'route_coverage_unproven': return 'Coverage unknown.';
 }
  }

  private captureFocusedControl(): { action?: string; field?: string; routeId?: string } | null {
 const focused = document.activeElement as HTMLElement | null;
 if (!focused || !this.content.contains(focused)) return null;
 const action = focused.dataset.evacAction;
 const field = focused.dataset.evacField;
 if (!action && !field) return null;
 return {
 ...(action ? { action } : {}),
 ...(field ? { field } : {}),
 routeId: focused.closest<HTMLElement>('[data-evac-route-id]')?.dataset.evacRouteId,
 };
  }

  private restoreFocusedControl(focused: { action?: string; field?: string; routeId?: string } | null): void {
 if (!focused) return;
 const controls = this.content.querySelectorAll<HTMLElement>('[data-evac-action], [data-evac-field]');
 for (const control of controls) {
 const routeId = control.closest<HTMLElement>('[data-evac-route-id]')?.dataset.evacRouteId;
 if (
 control.dataset.evacAction === focused.action
 && control.dataset.evacField === focused.field
 && routeId === focused.routeId
 ) {
 control.focus();
 return;
 }
 }
  }

  private captureCustomRouteSelections(): { from: string; to: string } {
 const from = this.content.querySelector<HTMLSelectElement>('[data-evac-field="from"]')?.value ?? '';
 const to = this.content.querySelector<HTMLSelectElement>('[data-evac-field="to"]')?.value ?? '';
 return { from, to };
  }

  private restoreCustomRouteSelections(selections: { from: string; to: string }): void {
 const from = this.content.querySelector<HTMLSelectElement>('[data-evac-field="from"]');
 const to = this.content.querySelector<HTMLSelectElement>('[data-evac-field="to"]');
 if (from) from.value = selections.from;
 if (to) to.value = selections.to;
  }

  // ── Event handling ───────────────────────────────────────────────────────

  private handleClick(e: MouseEvent): void {
 const target = e.target as HTMLElement | null;
 if (!target) return;

 const actionEl = target.closest<HTMLElement>('[data-evac-action]');
 if (!actionEl) return;

 const action = actionEl.dataset.evacAction;
 const routeCard = actionEl.closest<HTMLElement>('[data-evac-route-id]');
 const routeId = routeCard?.dataset.evacRouteId;

 switch (action) {
 case 'quick-bugout': {
 this.planQuickBugout();
 break;
 }
 case 'plan-custom': {
 this.planCustomRoute();
 break;
 }
 case 'show-map': {
 if (routeId) this.showRouteOnMap(routeId);
 break;
 }
 case 'delete': {
 if (routeId) {
 deleteRoute(routeId);
 // refresh will happen via subscription
 }
 break;
 }
 case 'toggle-steps': {
 if (routeId) {
 this.expandedRouteId = this.expandedRouteId === routeId ? null : routeId;
 this.renderContent();
 }
 break;
 }
 }
  }

  private async planQuickBugout(): Promise<void> {
 const home = getHomePlace();
 const bugout = getBugoutPlace();
 if (!home || !bugout) return;
 await this.doPlan({ lat: home.lat, lon: home.lon }, { lat: bugout.lat, lon: bugout.lon });
  }

  private async planCustomRoute(): Promise<void> {
 const fromSelect = this.content.querySelector<HTMLSelectElement>('[data-evac-field="from"]');
 const toSelect = this.content.querySelector<HTMLSelectElement>('[data-evac-field="to"]');
 if (!fromSelect?.value || !toSelect?.value) return;

 const fromPlace = this.places.find((p) => p.id === fromSelect.value);
 const toPlace = this.places.find((p) => p.id === toSelect.value);
 if (!fromPlace || !toPlace) return;
 if (fromPlace.id === toPlace.id) return;

 await this.doPlan({ lat: fromPlace.lat, lon: fromPlace.lon }, { lat: toPlace.lat, lon: toPlace.lon });
  }

  private async doPlan(from: LatLon, to: LatLon): Promise<void> {
 if (this.planning) return;
 this.planning = true;
 this.planningError = null;
 this.renderContent();

 try {
 await planRoute(from, to);
 // refresh happens via subscription
 } catch (error) {
 console.error('[evacuation] route planning failed:', error);
 this.planningError = `Route planning failed: ${error instanceof Error ? error.message : 'unknown error'}. No current road-condition conclusion can be drawn; verify an alternate route source.`;
 } finally {
 this.planning = false;
 this.renderContent();
 }
  }

  private showRouteOnMap(routeId: string): void {
 const route = this.routes.find((r) => r.id === routeId);
 if (!route) return;
 document.dispatchEvent(
 new CustomEvent('wm:show-evac-route', { detail: { route } }),
 );
  }

  // ── Utilities ────────────────────────────────────────────────────────────

  private formatAge(timestamp: number): string {
 const diffMs = Date.now() - timestamp;
 const mins = Math.floor(diffMs / 60_000);
 if (mins < 1) return 'just now';
 if (mins < 60) return `${mins}m ago`;
 const hours = Math.floor(mins / 60);
 if (hours < 24) return `${hours}h ago`;
 const days = Math.floor(hours / 24);
 return `${days}d ago`;
  }
}
