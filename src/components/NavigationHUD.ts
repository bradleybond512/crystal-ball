import type { RouteStep } from '@/services/routing-engine';
import type { GpsPosition } from '@/services/gps-tracker';

export interface NavigationHUDState {
  active: boolean;
  currentStep: RouteStep | null;
  nextStep: RouteStep | null;
  distanceToTurn: number;
  eta: string;
  totalRemaining: number;
  speed: number | null;
  gpsSource: string;
  routingProvider: string;
}

const MANEUVER_ARROWS: Record<string, string> = {
  'turn-left': '\u2190',
  'turn-right': '\u2192',
  straight: '\u2191',
  'slight-left': '\u2196',
  'slight-right': '\u2197',
  'sharp-left': '\u21B0',
  'sharp-right': '\u21B1',
  uturn: '\u21BA',
  arrive: '\u2691',
  depart: '\u2690',
};

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatSpeed(ms: number | null): string {
  if (ms === null || ms < 0.5) return '--';
  return `${Math.round(ms * 2.237)} mph`;
}

const DEFAULT_STATE: NavigationHUDState = {
  active: false,
  currentStep: null,
  nextStep: null,
  distanceToTurn: 0,
  eta: '--:-- --',
  totalRemaining: 0,
  speed: null,
  gpsSource: '--',
  routingProvider: '--',
};

export class NavigationHUD {
  private container: HTMLElement;
  private root: HTMLElement | null = null;
  private state: NavigationHUDState = { ...DEFAULT_STATE };

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:absolute',
      'bottom:80px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(10,10,15,0.88)',
      'border:1px solid rgba(100,140,255,0.3)',
      'border-radius:12px',
      'backdrop-filter:blur(8px)',
      '-webkit-backdrop-filter:blur(8px)',
      'z-index:1000',
      'min-width:400px',
      'display:none',
      'pointer-events:auto',
    ].join(';');
    this.container.append(this.root);
  }

  update(state: Partial<NavigationHUDState>): void {
    Object.assign(this.state, state);
    this.render();
  }

  updateFromGps(pos: GpsPosition): void {
    this.state.speed = pos.speed;
    this.state.gpsSource = pos.source;
    this.render();
  }

  render(): void {
    if (!this.root) return;

    if (!this.state.active || !this.state.currentStep) {
      this.root.style.display = 'none';
      return;
    }

    this.root.style.display = 'flex';
    this.root.style.alignItems = 'stretch';
    this.root.style.gap = '0';

    // Clear previous content
    while (this.root.firstChild) {
      this.root.firstChild.remove();
    }

    const step = this.state.currentStep;
    const arrow = MANEUVER_ARROWS[step.maneuver] ?? '\u2191';

    // Arrow section
    const arrowDiv = document.createElement('div');
    arrowDiv.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:12px 16px',
      'font-size:32px',
      'color:#8ca8ff',
      'min-width:64px',
    ].join(';');
    arrowDiv.textContent = arrow;

    // Instruction section
    const instrDiv = document.createElement('div');
    instrDiv.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'justify-content:center',
      'padding:10px 12px',
      'flex:1',
      'min-width:0',
    ].join(';');

    const instrText = document.createElement('div');
    instrText.style.cssText = 'font-size:14px;font-weight:700;color:#e8eeff;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    instrText.textContent = step.instruction;

    const streetName = document.createElement('div');
    streetName.style.cssText = 'font-size:11px;color:rgba(140,168,255,0.7);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    streetName.textContent = step.name || '';

    instrDiv.append(instrText, streetName);

    // Distance + ETA section
    const distDiv = document.createElement('div');
    distDiv.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'justify-content:center',
      'align-items:flex-end',
      'padding:10px 16px',
      'border-left:1px solid rgba(100,140,255,0.2)',
      'min-width:100px',
    ].join(';');

    const distText = document.createElement('div');
    distText.style.cssText = 'font-size:18px;font-weight:700;color:#e8eeff;line-height:1.2;';
    distText.textContent = formatDistance(this.state.distanceToTurn);

    const etaText = document.createElement('div');
    etaText.style.cssText = 'font-size:11px;color:rgba(140,168,255,0.7);margin-top:2px;';
    etaText.textContent = this.state.eta;

    distDiv.append(distText, etaText);

    // Speed section
    const speedDiv = document.createElement('div');
    speedDiv.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'justify-content:center',
      'align-items:center',
      'padding:10px 14px',
      'border-left:1px solid rgba(100,140,255,0.2)',
      'min-width:72px',
    ].join(';');

    const speedText = document.createElement('div');
    speedText.style.cssText = 'font-size:16px;font-weight:700;color:#e8eeff;line-height:1.2;';
    speedText.textContent = formatSpeed(this.state.speed);

    const srcText = document.createElement('div');
    srcText.style.cssText = 'font-size:9px;color:rgba(140,168,255,0.5);margin-top:2px;letter-spacing:0.05em;';
    srcText.textContent = this.state.gpsSource.toUpperCase();

    speedDiv.append(speedText, srcText);

    this.root.append(arrowDiv, instrDiv, distDiv, speedDiv);
  }

  show(): void {
    this.state.active = true;
    this.render();
  }

  hide(): void {
    this.state.active = false;
    if (this.root) this.root.style.display = 'none';
  }

  destroy(): void {
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
  }
}
