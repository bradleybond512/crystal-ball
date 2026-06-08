 
/**
 * EntityHeatRail — shows the top-entities mentioned across all feeds in the
 * last 6h as compact chips. Clicking a chip filters to alerts mentioning
 * that entity via the `cb:entity-filter` event.
 */

import { unifiedAlertStore } from '@/services/unified-alerts';
import { computeEntityHeat, type EntityMention } from '@/services/entity-heat';
import { getAnomalies } from '@/services/anomaly-baselines';

const MAX_CHIPS = 8;
const REFRESH_MS = 30_000;

export class EntityHeatRail {
  private element: HTMLElement;
  private timer: number | null = null;
  private unsub: (() => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'entity-heat-rail';
    this.element.id = 'entityHeatRail';
  }

  mount(parent: HTMLElement): void {
    parent.append(this.element);
    this.render();
    this.timer = window.setInterval(() => this.render(), REFRESH_MS);
    this.unsub = unifiedAlertStore.subscribe(() => this.render());
  }

  destroy(): void {
    if (this.timer != null) window.clearInterval(this.timer);
    this.unsub?.();
    this.element.remove();
  }

  getElement(): HTMLElement { return this.element; }

  private render(): void {
    const ents = computeEntityHeat().slice(0, MAX_CHIPS);
    const anomalies = getAnomalies().slice(0, 3);
    this.element.textContent = '';
    if (ents.length === 0 && anomalies.length === 0) {
      this.element.hidden = true;
      return;
    }
    this.element.hidden = false;

    if (ents.length > 0) {
      const label = document.createElement('span');
      label.className = 'ehr-label';
      label.textContent = 'Who';
      this.element.append(label);
      for (const e of ents) this.element.append(this.buildEntityChip(e));
    }
    if (anomalies.length > 0) {
      const label = document.createElement('span');
      label.className = 'ehr-label ehr-anomaly-label';
      label.textContent = 'Anomaly';
      this.element.append(label);
      for (const a of anomalies) {
        const chip = document.createElement('span');
        chip.className = `ehr-chip ehr-anomaly ehr-anomaly-${a.status}`;
        const dot = document.createElement('span'); dot.className = 'ehr-dot';
        const name = document.createElement('span'); name.className = 'ehr-name'; name.textContent = a.source;
        const count = document.createElement('span'); count.className = 'ehr-count';
        count.textContent = a.status === 'burst' ? `↑${a.current}` : '○';
        chip.title = `${a.source}: ${a.current}/hr vs ${a.mean.toFixed(1)}/hr baseline (z=${a.zScore.toFixed(1)})`;
        chip.append(dot, name, count);
        this.element.append(chip);
      }
    }
  }

  private buildEntityChip(e: EntityMention): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'ehr-chip';
    chip.dataset.entity = e.name;
    const dot = document.createElement('span'); dot.className = 'ehr-dot';
    const name = document.createElement('span'); name.className = 'ehr-name'; name.textContent = e.name;
    const count = document.createElement('span'); count.className = 'ehr-count'; count.textContent = String(e.count);
    chip.append(dot, name, count);
    chip.title = `${e.count} mentions across ${e.alertIds.length} alerts (last 6h)`;
    chip.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('cb:entity-filter', { detail: { entity: e.name, alertIds: e.alertIds } }));
    });
    return chip;
  }
}
