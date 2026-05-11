/**
 * GlobeHeatmapToggle
 * -----------------
 * Toggle row + opacity slider for the per-domain heatmap layers built
 * by `services/globe/heatmap-layers.ts` (PR #336).
 *
 * Mounts a 4-button radio row (Seismic / Fire / Cyber / Conflict) plus
 * an opacity slider into the GodsVisionView container. Selection state
 * is local; on change, dispatches `wm:globe-heatmap-changed` so the
 * deck.gl-on-Cesium overlay (follow-up) can pick up the active config
 * and (re-)render the layer.
 *
 * Decoupling the UI from the renderer keeps this component testable
 * without WebGL — the pure config builder + this UI talk via a typed
 * event payload, not a direct deck.gl handle.
 */

import {
  buildAllHeatmapLayers,
  listPalettes,
  type HeatmapDomain,
  type HeatmapLayerConfig,
  type HeatmapPoint,
} from '@/services/globe/heatmap-layers';

export interface HeatmapState {
  selected: HeatmapDomain | null;
  opacity: number;
  /** Per-domain point arrays the renderer should consume. The toggle
   *  doesn't fetch data; callers feed it via `setPoints()`. */
  points: Partial<Record<HeatmapDomain, readonly HeatmapPoint[]>>;
}

export interface GlobeHeatmapChangedEvent extends CustomEvent {
  detail: { state: HeatmapState; configs: HeatmapLayerConfig[] };
}

const CHANGED_EVENT = 'wm:globe-heatmap-changed';
const DEFAULT_OPACITY = 0.6;

export class GlobeHeatmapToggle {
  private container: HTMLElement;
  private root: HTMLDivElement | null = null;
  private buttons = new Map<HeatmapDomain, HTMLButtonElement>();
  private state: HeatmapState = {
    selected: null,
    opacity: DEFAULT_OPACITY,
    points: {},
  };

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const root = document.createElement('div');
    root.className = 'globe-heatmap-toggle';
    root.style.cssText = [
      'position:absolute',
      'top:88px',
      'right:12px',
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'padding:8px 10px',
      'border-radius:8px',
      'background:rgba(0,0,0,0.55)',
      'backdrop-filter:blur(10px)',
      'color:#fff',
      'font:11px/1.2 -apple-system,BlinkMacSystemFont,sans-serif',
      'z-index:8',
      'min-width:140px',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'opacity:0.7;letter-spacing:0.05em;text-transform:uppercase;font-size:9px;';
    header.textContent = 'Heatmap';
    root.append(header);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
    for (const palette of listPalettes()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.domain = palette.domain;
      btn.textContent = palette.label.replace(/ Density$| Incidents$| Events$/, '');
      btn.style.cssText = [
        'padding:3px 7px',
        'border-radius:6px',
        'border:1px solid rgba(255,255,255,0.15)',
        'background:transparent',
        'color:#fff',
        'cursor:pointer',
        'font-size:10px',
      ].join(';');
      btn.addEventListener('click', () => this.toggle(palette.domain));
      this.buttons.set(palette.domain, btn);
      row.append(btn);
    }
    root.append(row);

    const sliderLabel = document.createElement('label');
    sliderLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:10px;opacity:0.85;';
    sliderLabel.append('Opacity ');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(DEFAULT_OPACITY * 100));
    slider.style.cssText = 'flex:1;accent-color:#3b82f6;';
    slider.addEventListener('input', () => {
      this.state.opacity = Number(slider.value) / 100;
      this.emit();
    });
    sliderLabel.append(slider);
    root.append(sliderLabel);

    this.container.append(root);
    this.root = root;
    this.repaintButtons();
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
    this.buttons.clear();
  }

  /** Update the underlying point data for one or more domains. The
   *  renderer should call this whenever its data sources tick. */
  setPoints(points: Partial<Record<HeatmapDomain, readonly HeatmapPoint[]>>): void {
    this.state.points = { ...this.state.points, ...points };
    this.emit();
  }

  /** Public accessor for tests + downstream consumers. */
  getState(): HeatmapState {
    return { ...this.state, points: { ...this.state.points } };
  }

  /** Toggle a domain. Clicking the active domain turns it off (matches
   *  the "single active at a time" rule from the spec). */
  private toggle(domain: HeatmapDomain): void {
    this.state.selected = this.state.selected === domain ? null : domain;
    this.repaintButtons();
    this.emit();
  }

  private repaintButtons(): void {
    for (const [domain, btn] of this.buttons) {
      const active = this.state.selected === domain;
      btn.style.background = active ? 'rgba(59,130,246,0.35)' : 'transparent';
      btn.style.borderColor = active ? '#3b82f6' : 'rgba(255,255,255,0.15)';
      btn.style.fontWeight = active ? '600' : '400';
    }
  }

  private emit(): void {
    const configs = buildAllHeatmapLayers({
      selected: this.state.selected,
      points: this.state.points,
      opacity: this.state.opacity,
    });
    document.dispatchEvent(new CustomEvent(CHANGED_EVENT, {
      detail: { state: this.getState(), configs },
    }));
  }
}

export const GLOBE_HEATMAP_CHANGED_EVENT = CHANGED_EVENT;
