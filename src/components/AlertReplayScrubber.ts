 
/**
 * AlertReplayScrubber — time-machine slider that lets users scrub
 * backward through the last 24h of alert history using lifecycle
 * sample data. Shows a ghost overlay of the alert landscape at
 * any selected point in time.
 *
 * Toggled via `cb:toggle-replay` event or the TriageBar replay button.
 */

import { unifiedAlertStore } from '@/services/unified-alerts';

const SCRUB_RANGE_MS = 24 * 60 * 60_000;
const TICK_MS = 5 * 60_000;

export class AlertReplayScrubber {
  private element: HTMLElement;
  private slider: HTMLInputElement | null = null;
  private label: HTMLElement | null = null;
  private visible = false;
  private currentOffsetMs = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'replay-scrubber';
    this.element.hidden = true;
  }

  mount(parent: HTMLElement): void {
    parent.append(this.element);
    document.addEventListener('cb:toggle-replay', () => this.toggle());
    this.buildUI();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.element.hidden = !this.visible;
    if (this.visible) {
      this.currentOffsetMs = 0;
      this.updateLabel();
      this.dispatchSnapshot();
    } else {
      document.dispatchEvent(new CustomEvent('cb:replay-exit'));
    }
  }

  private buildUI(): void {
    const title = document.createElement('span');
    title.className = 'replay-title';
    title.textContent = 'Alert Replay';

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.className = 'replay-slider';
    this.slider.min = '0';
    this.slider.max = String(SCRUB_RANGE_MS);
    this.slider.value = '0';
    this.slider.step = String(TICK_MS);
    this.slider.setAttribute('aria-label', 'Replay time');
    this.slider.addEventListener('input', () => {
      this.currentOffsetMs = Number(this.slider!.value);
      this.updateLabel();
      this.dispatchSnapshot();
    });

    this.label = document.createElement('span');
    this.label.className = 'replay-label';

    const close = document.createElement('button');
    close.className = 'replay-close';
    close.textContent = '\u2715';
    close.setAttribute('aria-label', 'Close alert replay');
    close.addEventListener('click', () => this.toggle());

    this.element.append(title, this.slider, this.label, close);
  }

  private updateLabel(): void {
    if (!this.label) return;
    if (this.currentOffsetMs === 0) {
      this.label.textContent = 'NOW';
    } else {
      const min = Math.round(this.currentOffsetMs / 60_000);
      this.label.textContent = min < 60 ? `${min}m ago` : `${(min / 60).toFixed(1)}h ago`;
    }
  }

  private dispatchSnapshot(): void {
    const targetTime = Date.now() - this.currentOffsetMs;
    const all = unifiedAlertStore.getAll();
    const snapshot = all.filter(a => a.timestamp <= targetTime);
    document.dispatchEvent(new CustomEvent('cb:replay-snapshot', {
      detail: { targetTime, alerts: snapshot, offsetMs: this.currentOffsetMs },
    }));
  }
}
