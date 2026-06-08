import { Panel } from './Panel';
import {
  COUNTER_METRICS,
  getCounterValue,
  formatCounterValue,
  type CounterMetric,
} from '@/services/humanity-counters';
import { isAppActive, onActivityChange } from '@/services/app-activity';

/**
 * CountersPanel -- Worldometer-style ticking counters showing positive global metrics.
 *
 * Displays 6 metrics (births, trees, vaccines, graduates, books, renewable MW)
 * with values ticking at 60fps via requestAnimationFrame. Values are calculated
 * from absolute time (seconds since midnight UTC * per-second rate) to avoid
 * drift across tabs, throttling, or background suspension.
 *
 * No API calls needed -- all data derived from hardcoded annual rates.
 */
export class CountersPanel extends Panel {
  private animFrameId: number | null = null;
  private valueElements = new Map<string, HTMLElement>();
  private _unsubActivity: (() => void) | null = null;

  constructor() {
 super({ id: 'counters', title: 'Live Counters', trackActivity: false });
 this.createCounterGrid();
 this.startTicking();
 // Resume the 60fps tick when the window regains focus/visibility — the
 // tick stops itself while inactive (counters recompute from absolute time).
 this._unsubActivity = onActivityChange((active) => {
 if (active) this.startTicking();
 });
  }

  /**
 * Build the 6 counter cards and insert them into the panel content area.
 */
  private createCounterGrid(): void {
 const grid = document.createElement('div');
 grid.className = 'counters-grid';

 for (const metric of COUNTER_METRICS) {
 const card = this.createCounterCard(metric);
 grid.append(card);
 }

 // Clear loading state and append the grid
 this.content.innerHTML = '';
 this.content.append(grid);
  }

  /**
 * Create a single counter card with icon, value, label, and source.
 */
  private createCounterCard(metric: CounterMetric): HTMLElement {
 const card = document.createElement('div');
 card.className = 'counter-card';

 const icon = document.createElement('div');
 icon.className = 'counter-icon';
 icon.textContent = metric.icon;

 const value = document.createElement('div');
 value.className = 'counter-value';
 value.dataset.counter = metric.id;
 // Set initial value from absolute time
 value.textContent = formatCounterValue(
 getCounterValue(metric),
 metric.formatPrecision,
 );

 const label = document.createElement('div');
 label.className = 'counter-label';
 label.textContent = metric.label;

 const source = document.createElement('div');
 source.className = 'counter-source';
 source.textContent = metric.source;

 card.append(icon);
 card.append(value);
 card.append(label);
 card.append(source);

 // Store reference for fast 60fps updates
 this.valueElements.set(metric.id, value);

 return card;
  }

  /**
 * Start the requestAnimationFrame animation loop.
 * Each frame recalculates all counter values from absolute time.
 */
  public startTicking(): void {
 if (this.animFrameId !== null) return; // Already ticking
 this.animFrameId = requestAnimationFrame(this.tick);
  }

  /**
 * Animation tick -- arrow function for correct `this` binding.
 * Updates all 6 counter values using textContent (not innerHTML)
 * to avoid layout thrashing at 60fps.
 */
  private tick = (): void => {
 // Pause when the window is hidden/blurred — stop re-scheduling so the
 // loop idles entirely (constructor's activity listener restarts it).
 if (!isAppActive()) {
 this.animFrameId = null;
 return;
 }
 for (const metric of COUNTER_METRICS) {
 const el = this.valueElements.get(metric.id);
 if (el) {
 const value = getCounterValue(metric);
 el.textContent = formatCounterValue(value, metric.formatPrecision);
 }
 }
 this.animFrameId = requestAnimationFrame(this.tick);
  };

  /**
 * Clean up animation frame and call parent destroy.
 */
  public destroy(): void {
 if (this.animFrameId !== null) {
 cancelAnimationFrame(this.animFrameId);
 this.animFrameId = null;
 }
 if (this._unsubActivity) {
 this._unsubActivity();
 this._unsubActivity = null;
 }
 this.valueElements.clear();
 super.destroy();
  }
}
