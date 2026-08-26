import {
  getVerifiedLifelinesReceiptForPlace,
  type VerifiedLifelinesReceipt,
} from '@/services/lifelines/lifeline-runtime.ts';
import {
  getSavedPlaces,
  getPrimarySavedPlace,
  subscribeSavedPlaces,
  type SavedPlace,
} from '@/services/saved-places.ts';
import {
  EMERGENCY_PACK_OPTIONAL_KINDS,
  EMERGENCY_PACK_REQUIRED_KINDS,
  type EmergencyPackArtifactKind,
  type EmergencyPackStatus,
} from '@/services/emergency-pack/emergency-pack-schema.ts';
import {
  getStormSnapshot,
  hydrateStormPosture,
  subscribeStormPosture,
} from '@/services/survival/storm-posture-state.ts';
import type { WorldSnapshot } from '@/services/survival/survival-types.ts';
import { Panel } from './Panel.ts';
import {
  EmergencyReadinessDeadlineScheduler,
  type EmergencyPackCaptureState,
  type EmergencyPackReadinessInput,
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
  getPlaces: () => SavedPlace[];
  subscribeSavedPlaces: (callback: () => void) => () => void;
  subscribeEmergencyPack: (callback: () => void) => () => void;
  hydrate: () => Promise<void>;
  getReceipt: (place: LifelinesReceiptPlace) => VerifiedLifelinesReceipt | null;
  getEmergencyPackState: (place: SavedPlace) => EmergencyPackReadinessInput & {
    profileFingerprint: string;
  };
  captureEmergencyPack: (
    place: SavedPlace,
    contactConsent: boolean,
  ) => Promise<{ ok: boolean; packId?: string; failedKind?: string }>;
  now: () => number;
  deadlineScheduler?: ReadinessDeadlineScheduler;
}

const DEFAULT_DEPENDENCIES: Omit<EmergencyReadinessPanelDependencies, 'deadlineScheduler'> = {
  getSnapshot: getStormSnapshot,
  subscribe: subscribeStormPosture,
  getPrimaryPlace: getPrimarySavedPlace,
  getPlaces: getSavedPlaces,
  subscribeSavedPlaces,
  subscribeEmergencyPack: subscribeEmergencyPackUnavailable,
  hydrate: hydrateStormPosture,
  getReceipt: getVerifiedLifelinesReceiptForPlace,
  getEmergencyPackState: (place) => ({
    status: 'not-saved',
    packId: null,
    profileFingerprint: place.id,
    requiredKinds: [...EMERGENCY_PACK_REQUIRED_KINDS],
    optionalKinds: [...EMERGENCY_PACK_OPTIONAL_KINDS],
    receipts: [],
    missingKinds: [...EMERGENCY_PACK_REQUIRED_KINDS],
    expiredKinds: [],
  }),
  captureEmergencyPack: () => Promise.resolve({ ok: false, failedKind: 'unavailable' }),
  now: Date.now,
};

function subscribeEmergencyPackUnavailable(): () => void {
  return unsubscribeEmergencyPackUnavailable;
}

function unsubscribeEmergencyPackUnavailable(): undefined {
  return undefined;
}

function captureMessage(readiness: EmergencyPackReadinessInput, missing: number): string {
  if (readiness.status === 'ready') return 'All required artifacts are current.';
  if (readiness.status === 'expired') return 'Required artifacts have expired.';
  if (readiness.status === 'partial') {
    return `${missing} required ${missing === 1 ? 'artifact is' : 'artifacts are'} missing.`;
  }
  return 'No verified Emergency Pack is saved.';
}

function idleCaptureState(readiness: EmergencyPackReadinessInput): EmergencyPackCaptureState {
  const expired = new Set<EmergencyPackArtifactKind>(readiness.expiredKinds);
  const currentKinds = new Set(readiness.receipts
    .filter((receipt) => !expired.has(receipt.kind))
    .map((receipt) => receipt.kind));
  const completed = readiness.requiredKinds.filter((kind) => currentKinds.has(kind)).length;
  const missing = Math.max(0, readiness.requiredKinds.length - completed);
  return {
    status: 'idle',
    completed,
    total: readiness.requiredKinds.length,
    message: captureMessage(readiness, missing),
  };
}

export class EmergencyReadinessPanel extends Panel {
  private readonly dependencies: EmergencyReadinessPanelDependencies;
  private readonly deadlineScheduler: ReadinessDeadlineScheduler;
  private readonly unsubscribeSnapshot: () => void;
  private readonly unsubscribeSavedPlaces: () => void;
  private readonly unsubscribeEmergencyPack: () => void;
  private active = true;
  private generation = 0;
  private captureGeneration = 0;
  private selectedPlaceId: string | null = null;
  private contactConsent = false;
  private captureState: EmergencyPackCaptureState | null = null;
  private pendingFocusControl: string | null = null;
  private readonly onLifelineSituationUpdated = () => this.requestRender();
  private readonly onContentChange = (event: Event) => this.handleContentChange(event);
  private readonly onContentClick = (event: Event) => this.handleContentClick(event);

  constructor(dependencies: Partial<EmergencyReadinessPanelDependencies> = {}) {
    super({
      id: 'emergency-readiness',
      title: 'Emergency Readiness',
      className: 'emergency-readiness-panel',
      trackActivity: true,
      infoTooltip: 'Four independent offline capability checks plus an exact, place-scoped Emergency Pack capture workflow.',
    });
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies };
    this.deadlineScheduler = this.dependencies.deadlineScheduler
      ?? new EmergencyReadinessDeadlineScheduler({
        now: this.dependencies.now,
        onDeadline: () => this.renderWhenVisible(() => this.render()),
      });
    this.unsubscribeSnapshot = this.dependencies.subscribe(() => this.requestRender());
    this.unsubscribeSavedPlaces = this.dependencies.subscribeSavedPlaces(() => this.requestRender());
    this.unsubscribeEmergencyPack = this.dependencies.subscribeEmergencyPack(() => this.requestRender());
    this.content.addEventListener('change', this.onContentChange);
    this.content.addEventListener('click', this.onContentClick);
    document.addEventListener('wm:lifeline-situation-updated', this.onLifelineSituationUpdated);
    this.start();
  }

  public override destroy(): void {
    if (!this.active) return;
    this.active = false;
    this.generation += 1;
    this.captureGeneration += 1;
    this.unsubscribeSnapshot();
    this.unsubscribeSavedPlaces();
    this.unsubscribeEmergencyPack();
    this.content.removeEventListener('change', this.onContentChange);
    this.content.removeEventListener('click', this.onContentClick);
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
    this.pendingFocusControl = this.focusedPackControl() ?? this.pendingFocusControl;
    this.renderWhenVisible(() => this.render());
  }

  private resolveSelectedPlace(places: readonly SavedPlace[], primary: SavedPlace | null): SavedPlace | null {
    const selected = places.find((place) => place.id === this.selectedPlaceId)
      ?? (primary ? places.find((place) => place.id === primary.id) : null)
      ?? places[0]
      ?? null;
    this.selectedPlaceId = selected?.id ?? null;
    return selected;
  }

  private handleContentChange(event: Event): void {
    if (!this.active) return;
    const target = event.target as HTMLInputElement | HTMLSelectElement | null;
    if (target?.name === 'emergency-pack-place') {
      this.captureGeneration += 1;
      this.selectedPlaceId = target.value || null;
      this.contactConsent = false;
      this.captureState = null;
      this.requestRender();
      return;
    }
    if (target?.name === 'emergency-pack-contact-consent') {
      this.contactConsent = Boolean((target as HTMLInputElement).checked);
      this.requestRender();
    }
  }

  private handleContentClick(event: Event): void {
    if (!this.active || this.captureState?.status === 'capturing') return;
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== 'function' || !target.closest('[data-pack-action]')) return;
    const place = this.dependencies.getPlaces().find((candidate) => candidate.id === this.selectedPlaceId);
    if (!place) return;
    void this.capture(place);
  }

  private async capture(place: SavedPlace): Promise<void> {
    const generation = ++this.captureGeneration;
    const selectedPlaceId = place.id;
    this.captureState = {
      status: 'capturing',
      completed: 0,
      total: EMERGENCY_PACK_REQUIRED_KINDS.length,
      message: 'Capturing and verifying required artifacts.',
    };
    this.requestRender();
    let result: { ok: boolean; packId?: string; failedKind?: string };
    try {
      result = await this.dependencies.captureEmergencyPack(place, this.contactConsent);
    } catch {
      result = { ok: false, failedKind: 'capture' };
    }
    if (!this.active || generation !== this.captureGeneration || selectedPlaceId !== this.selectedPlaceId) return;
    this.captureState = result.ok
      ? {
        status: 'complete',
        completed: EMERGENCY_PACK_REQUIRED_KINDS.length,
        total: EMERGENCY_PACK_REQUIRED_KINDS.length,
        message: 'Required pack captured. Verifying authoritative state.',
      }
      : {
        status: 'error',
        completed: 0,
        total: EMERGENCY_PACK_REQUIRED_KINDS.length,
        message: result.failedKind
          ? `Capture stopped at ${result.failedKind}; the last known good pack was preserved.`
          : 'Capture failed; the last known good pack was preserved.',
      };
    this.requestRender();
  }

  private focusedPackControl(): string | null {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !this.content.contains(active)) return null;
    return this.packControlSelector(active);
  }

  private packControlSelector(control: HTMLElement | null): string | null {
    if (!control) return null;
    if (control.hasAttribute('data-pack-action')) return '[data-pack-action]';
    if (control.getAttribute('name') === 'emergency-pack-place') return '[name="emergency-pack-place"]';
    if (control.getAttribute('name') === 'emergency-pack-contact-consent') {
      return '[name="emergency-pack-contact-consent"]';
    }
    return null;
  }

  private render(): void {
    if (!this.active) return;
    const snapshot = this.dependencies.getSnapshot();
    const primaryPlace = this.dependencies.getPrimaryPlace();
    const places = this.dependencies.getPlaces();
    const selectedPlace = this.resolveSelectedPlace(places, primaryPlace);
    const receiptPlace = primaryPlace && typeof primaryPlace.radiusKm === 'number'
      && Number.isFinite(primaryPlace.radiusKm) && primaryPlace.radiusKm > 0
      ? { id: primaryPlace.id, lat: primaryPlace.lat, lon: primaryPlace.lon, radiusKm: primaryPlace.radiusKm }
      : null;
    const lifelines = primaryPlace
      ? { placeLabel: primaryPlace.name, receipt: receiptPlace ? this.dependencies.getReceipt(receiptPlace) : null }
      : null;
    const readiness = selectedPlace
      ? this.dependencies.getEmergencyPackState(selectedPlace)
      : {
        status: 'not-saved' as EmergencyPackStatus,
        packId: null,
        profileFingerprint: '',
        requiredKinds: [...EMERGENCY_PACK_REQUIRED_KINDS],
        optionalKinds: [...EMERGENCY_PACK_OPTIONAL_KINDS],
        receipts: [],
        missingKinds: [...EMERGENCY_PACK_REQUIRED_KINDS],
        expiredKinds: [],
      };
    const captureState = this.captureState ?? idleCaptureState(readiness);
    const focusedControl = this.focusedPackControl() ?? this.pendingFocusControl;
    const view = projectEmergencyReadiness(snapshot, lifelines, {
      now: this.dependencies.now(),
      emergencyPack: {
        places: places.map((place) => ({ id: place.id, name: place.name })),
        selectedPlaceId: selectedPlace?.id ?? null,
        readiness,
        contactConsent: this.contactConsent,
        captureState,
      },
    });
    this.deadlineScheduler.track(view.deadlinesMs);
    this.setContent(renderEmergencyReadiness(view), () => {
      if (!this.active || !focusedControl) return;
      this.content.querySelector<HTMLElement>(focusedControl)?.focus();
      this.pendingFocusControl = null;
    });
  }
}
