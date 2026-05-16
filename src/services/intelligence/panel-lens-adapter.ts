/**
 * Panel Lens Adapter — DOM glue that lets any panel opt into the
 * LensContext without having to know how the service works.
 *
 *   mountLensBanner(host, panelId) → injects a compact situation banner
 *   at the top of the host element, re-renders on lens changes, and
 *   returns an unmount function for the panel's destroy() path.
 *
 *   filterForLens(items, ctx) → utility filter on shape-loose items
 *   (anything with optional domain + location + observedAt). Used by
 *   panels whose data is not strictly an ObservationEvent.
 */

import {
  getLensContextService,
  type LensContext,
  type LensContextService,
} from './lens-context';

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface LensFilterable {
  domain?: string;
  location?: { lat: number; lon: number } | null;
  observedAt?: Date | number | null;
}

/** Pure filter — works on any item with optional domain / location /
 *  observedAt. Returns input unchanged when the lens is inactive. */
export function filterForLens<T extends LensFilterable>(
  items: readonly T[],
  context: LensContext,
  now: number = Date.now(),
): T[] {
  if (context.activeSituationId === null) return [...items];
  return items.filter((item) => {
    if (context.focusDomains.length > 0 && item.domain
      && !context.focusDomains.includes(item.domain)) {
      return false;
    }
    if (context.focusLocation && item.location) {
      const dist = haversineKm(
        context.focusLocation.lat, context.focusLocation.lon,
        item.location.lat, item.location.lon,
      );
      if (dist > context.focusLocation.radiusKm) return false;
    }
    if (item.observedAt) {
      const t = item.observedAt instanceof Date
        ? item.observedAt.getTime()
        : item.observedAt;
      if (now - t > context.focusTimeWindowMs) return false;
    }
    return true;
  });
}

export type LensSubscription = (ctx: LensContext) => void;

export function subscribeLens(cb: LensSubscription): () => void {
  return getLensContextService().subscribe(cb);
}

// ── DOM banner ────────────────────────────────────────────────────────────

const BANNER_CLASS = 'wm-lens-banner';
const SEVERITY_COLOR: Record<string, string> = {
  critical: '#a626a4', high: '#e94f37', medium: '#f5a524', low: '#9ca3af',
};

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cssText = 'padding:2px 8px;background:transparent;color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:2px;cursor:pointer;font-size:10px;';
  btn.addEventListener('click', onClick);
  return btn;
}

function buildBannerNode(ctx: LensContext, svc: LensContextService): HTMLElement | null {
  if (!ctx.activeSituation) return null;
  const sit = ctx.activeSituation;

  const banner = document.createElement('div');
  banner.className = BANNER_CLASS;
  banner.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;background:rgba(74,158,255,0.08);border-bottom:1px solid rgba(74,158,255,0.2);border-radius:2px;margin-bottom:6px;';

  const left = document.createElement('div');
  left.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;gap:8px;font-size:11px;color:#ddd;';
  const sevBadge = document.createElement('span');
  sevBadge.textContent = sit.severity;
  sevBadge.style.cssText = `background:${SEVERITY_COLOR[sit.severity] ?? '#9ca3af'};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;`;
  const name = document.createElement('span');
  name.textContent = sit.name;
  name.style.fontWeight = '600';
  const focus = document.createElement('span');
  focus.textContent = `— focus: ${ctx.focusDomains.join(', ')}`;
  focus.style.opacity = '0.6';
  left.append(sevBadge, name, focus);

  const right = document.createElement('div');
  right.style.cssText = 'display:flex;gap:4px;';
  right.append(
    makeButton(ctx.isPinned ? 'Unpin' : 'Pin', () => {
      if (svc.getContext().isPinned) svc.unpin(); else svc.pin();
    }),
    makeButton('Global view', () => {
      if (svc.getContext().isPinned) svc.unpin();
      svc.setActiveSituation(null);
    }),
  );

  banner.append(left, right);
  return banner;
}

/** Mount a lens banner at the top of `host`. The banner auto-shows/hides
 *  as the lens context changes. Returns an unmount function callers
 *  should invoke in their panel's destroy(). Safe in environments
 *  without document (returns a no-op unmount). */
const NOOP_UNMOUNT = (): void => { /* no-op: nothing was mounted */ };

export function mountLensBanner(host: HTMLElement, panelId: string): () => void {
  if (typeof document === 'undefined') return NOOP_UNMOUNT;
  const svc = getLensContextService();

  const slot = document.createElement('div');
  slot.dataset.lensSlot = panelId;
  host.prepend(slot);

  const render = (): void => {
    while (slot.firstChild) slot.firstChild.remove();
    const node = buildBannerNode(svc.getContext(), svc);
    if (node) slot.append(node);
  };
  render();

  const unsubscribe = svc.subscribe(() => render());

  return () => {
    unsubscribe();
    slot.remove();
  };
}
