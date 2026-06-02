import { Panel } from './Panel';
import {
  DEFAULT_INPUTS,
  aggregateConcernCount,
  renderAll,
} from './nuclear-nonproliferation-helpers';
import type { NonproliferationInputs } from './nuclear-nonproliferation-helpers';

// ── Constants ─────────────────────────────────────────────────────────────

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

// ── Helpers ─────────────────────────────────────────────────────────────────

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

// ── Panel ─────────────────────────────────────────────────────────────────

export class NuclearNonproliferationPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private inputs: NonproliferationInputs = DEFAULT_INPUTS;

  constructor() {
    super({ id: 'nuclear-nonproliferation', title: 'Nuclear Nonproliferation', showCount: true, trackActivity: true });
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => { this.render(); }, REFRESH_MS);
    }
  }

  /** Inject live data; unspecified sections fall back to the static datasets. */
  public setInputs(partial: Partial<NonproliferationInputs>): void {
    this.inputs = { ...this.inputs, ...partial };
    this.render();
  }

  private render(): void {
    const html = safe(() => renderAll(this.inputs)) ?? '<div class="nnp-empty">Unable to render.</div>';
    const count = safe(() => aggregateConcernCount(this.inputs)) ?? 0;
    this.setContent(html);
    this.setCount(count);
    this.markFresh();
  }

  override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}
