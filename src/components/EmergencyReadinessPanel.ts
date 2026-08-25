import {
  getVerifiedLifelinesReceiptForPlace,
  type VerifiedLifelinesReceipt,
} from '@/services/lifelines/lifeline-runtime.ts';
import {
  getPrimarySavedPlace,
  subscribeSavedPlaces,
  type SavedPlace,
} from '@/services/saved-places.ts';
import {
  getStormSnapshot,
  hydrateStormPosture,
  subscribeStormPosture,
} from '@/services/survival/storm-posture-state.ts';
import type { WorldSnapshot } from '@/services/survival/survival-types.ts';
import { Panel } from './Panel.ts';
import {
  EmergencyReadinessDeadlineScheduler,
  projectEmergencyReadiness,
  renderEmergencyReadiness,
} from './emergency-readiness-view.ts';

interface ReadinessDeadlineScheduler {
  track(deadlines: readonly number[]): void;
  destroy(): void;
}

type LifelinesReceiptPlace = Pick<SavedPlace, 'id' | 'lat' | 'lon' | 'radiusKm'>;

interface EmergencyReadinessPanelDependencies {
  getSnapshot: () => WorldSnapshot | null;
  subscribe: (callback: () => void) => () => void;
  getPrimaryPlace: () => SavedPlace | null;
  subscribeSavedPlaces: (callback: () => void) => () => void;
  hydrate: () => Promise<void>;
  getReceipt: (place: LifelinesReceiptPlace) => VerifiedLifelinesReceipt | null;
  now: () => number;
  deadlineScheduler?: ReadinessDeadlineScheduler;
}

const DEFAULT_DEPENDENCIES: Omit<EmergencyReadinessPanelDependencies, 'deadlineScheduler'> = {
  getSnapshot: getStormSnapshot,
  subscribe: subscribeStormPosture,
  getPrimaryPlace: getPrimarySavedPlace,
  subscribeSavedPlaces,
  hydrate: hydrateStormPosture,
  getReceipt: getVerifiedLifelinesReceiptForPlace,
  now: Date.now,
};

export class EmergencyReadinessPanel extends Panel {
  private readonly dependencies: EmergencyReadinessPanelDependencies;
  private readonly deadlineScheduler: ReadinessDeadlineScheduler;
  private readonly unsubscribeSnapshot: () => void;
  private readonly unsubscribeSavedPlaces: () => void;
  private active = true;
  private generation = 0;
  private readonly onLifelineSituationUpdated = () => this.requestRender();

  constructor(dependencies: Partial<EmergencyReadinessPanelDependencies> = {}) {
    super({
      id: 'emergency-readiness',
      title: 'Emergency Readiness',
      className: 'emergency-readiness-panel',
      trackActivity: true,
      infoTooltip: 'Read-only offline status for grid-down visibility, staged playbooks, communications fallback, and the exact saved Lifelines snapshot receipt.',
    });
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies };
    this.deadlineScheduler = this.dependencies.deadlineScheduler
      ?? new EmergencyReadinessDeadlineScheduler({
        now: this.dependencies.now,
        onDeadline: () => this.renderWhenVisible(() => this.render()),
      });
    this.unsubscribeSnapshot = this.dependencies.subscribe(() => this.requestRender());
    this.unsubscribeSavedPlaces = this.dependencies.subscribeSavedPlaces(() => this.requestRender());
    document.addEventListener('wm:lifeline-situation-updated', this.onLifelineSituationUpdated);
    this.start();
  }

  public override destroy(): void {
    if (!this.active) return;
    this.active = false;
    this.generation += 1;
    this.unsubscribeSnapshot();
    this.unsubscribeSavedPlaces();
    document.removeEventListener('wm:lifeline-situation-updated', this.onLifelineSituationUpdated);
    this.deadlineScheduler.destroy();
    super.destroy();
  }

  private start(): void {
    const generation = ++this.generation;
    void this.dependencies.hydrate().then(
      () => this.renderHydrated(generation),
      () => this.renderHydrated(generation),
    );
  }

  private renderHydrated(generation: number): void {
    if (!this.active || generation !== this.generation) return;
    this.requestRender();
  }

  private requestRender(): void {
    if (!this.active) return;
    this.renderWhenVisible(() => this.render());
  }

  private render(): void {
    if (!this.active) return;
    const snapshot = this.dependencies.getSnapshot();
    const place = this.dependencies.getPrimaryPlace();
    const receiptPlace = place && typeof place.radiusKm === 'number'
      && Number.isFinite(place.radiusKm) && place.radiusKm > 0
      ? { id: place.id, lat: place.lat, lon: place.lon, radiusKm: place.radiusKm }
      : null;
    const lifelines = place
      ? { placeLabel: place.name, receipt: receiptPlace ? this.dependencies.getReceipt(receiptPlace) : null }
      : null;
    const view = projectEmergencyReadiness(snapshot, lifelines, { now: this.dependencies.now() });
    this.deadlineScheduler.track(view.deadlinesMs);
    this.setContent(renderEmergencyReadiness(view));
  }
}
