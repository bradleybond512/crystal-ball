// src/components/TimeScrubberHud.ts
/**
 * World Stage time-scrubber HUD (Grand-Strategy Survival OS, E4c mount). A thin,
 * self-contained overlay: a track slider (replay ⟵ now ⟶ projected), a play/pause
 * button, a zone badge and a cursor label. All state + formatting lives in the
 * pure, tested `time-scrubber` / `scrubber-view` modules; this file only builds
 * DOM and drives a RENDER-GATED playback loop.
 *
 * Idle-CPU discipline (the map-render lesson): the rAF loop advances only when
 * `shouldTick` allows (playing AND the document is visible AND past the throttle
 * interval). Paused/hidden burns nothing, and the rAF is always cancelled on
 * `destroy()` so no loop leaks.
 */
import {
  createScrubber, advance, togglePlay, seekFraction, shouldTick,
  type ScrubberState,
} from '@/services/survival/time-scrubber';
import {
  scrubberCursorLabel, scrubberZoneLabel, scrubberThumbFraction, playButtonLabel,
} from '@/services/survival/scrubber-view';

export interface TimeScrubberHudOptions {
  /** Anchor "now", ms. Defaults to Date.now(). */
  nowMs?: number;
  pastSpanMs?: number;
  futureSpanMs?: number;
  /** Playback throttle: min wall-ms between cursor advances. Default 200ms (5fps
   *  is plenty for a scrubbing timeline and stays light). */
  minTickMs?: number;
  /** Called whenever the cursor moves (drag or playback) with the timeline ms. */
  onCursor?: (cursorMs: number) => void;
}

const HOUR = 3_600_000;

export class TimeScrubberHud {
  private readonly el: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly zoneBadge: HTMLElement;
  private readonly cursorLabel: HTMLElement;

  private state: ScrubberState;
  private rafId: number | null = null;
  private lastTickMs: number | null = null;
  private lastFrameMs = 0;
  private readonly minTickMs: number;
  private readonly onCursor?: (cursorMs: number) => void;
  private destroyed = false;

  constructor(parent: HTMLElement, opts: TimeScrubberHudOptions = {}) {
    const now = opts.nowMs ?? Date.now();
    this.state = createScrubber(now, {
      pastSpanMs: opts.pastSpanMs ?? 24 * HOUR,
      futureSpanMs: opts.futureSpanMs ?? 48 * HOUR,
    });
    this.minTickMs = opts.minTickMs ?? 200;
    this.onCursor = opts.onCursor;

    this.el = document.createElement('div');
    this.el.className = 'time-scrubber-hud';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Time scrubber: replay, now, projected');

    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button';
    this.playBtn.className = 'time-scrubber-hud__play';
    this.playBtn.addEventListener('click', () => this.onTogglePlay());

    this.zoneBadge = document.createElement('span');
    this.zoneBadge.className = 'time-scrubber-hud__zone';

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.className = 'time-scrubber-hud__track';
    this.slider.min = '0';
    this.slider.max = '1000';
    this.slider.step = '1';
    this.slider.setAttribute('aria-label', 'Timeline position');
    this.slider.addEventListener('input', () => this.onScrub());

    this.cursorLabel = document.createElement('span');
    this.cursorLabel.className = 'time-scrubber-hud__cursor';

    this.el.append(this.playBtn, this.zoneBadge, this.slider, this.cursorLabel);
    parent.append(this.el);
    this.render();
  }

  /** Root element, in case a host wants to reposition it. */
  get element(): HTMLElement {
    return this.el;
  }

  /** Current cursor position on the timeline (ms since epoch). */
  get cursorMs(): number {
    return this.state.cursorMs;
  }

  private onTogglePlay(): void {
    this.state = togglePlay(this.state);
    if (this.state.playing) this.startLoop();
    else this.stopLoop();
    this.render();
  }

  private onScrub(): void {
    // Dragging pauses playback so the user stays in control.
    const fraction = Number(this.slider.value) / 1000;
    this.state = { ...seekFraction(this.state, fraction), playing: false };
    this.stopLoop();
    this.render();
    this.onCursor?.(this.state.cursorMs);
  }

  private startLoop(): void {
    if (this.rafId !== null || this.destroyed) return;
    this.lastFrameMs = 0;
    this.lastTickMs = null; // fresh (re)start: first tick isn't throttled and advances 0
    const frame = (tMs: number): void => {
      if (this.destroyed) return;
      this.rafId = requestAnimationFrame(frame);
      const nowMs = Date.now();
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      // Paused or hidden: drop the frame baseline so a resume/reveal starts fresh
      // and never advances by the accumulated hidden gap (no catch-up jump).
      if (!this.state.playing || !visible) {
        this.lastFrameMs = 0;
        return;
      }
      // Throttle by minTickMs (via shouldTick) WITHOUT resetting the baseline, so a
      // throttled frame just defers and the next tick advances by the real elapsed.
      if (!shouldTick(this.state, { visible, nowMs, lastTickMs: this.lastTickMs, minIntervalMs: this.minTickMs })) return;
      // First tick after a (re)start records the baseline and advances 0.
      const wallElapsed = this.lastFrameMs === 0 ? 0 : tMs - this.lastFrameMs;
      this.lastFrameMs = tMs;
      this.lastTickMs = nowMs;
      this.state = advance(this.state, wallElapsed);
      this.render();
      this.onCursor?.(this.state.cursorMs);
      if (!this.state.playing) this.stopLoop(); // advance() pinned to the end
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastFrameMs = 0;
  }

  private render(): void {
    this.playBtn.textContent = playButtonLabel(this.state);
    this.playBtn.setAttribute('aria-pressed', String(this.state.playing));
    this.zoneBadge.textContent = scrubberZoneLabel(this.state);
    this.zoneBadge.dataset.zone = scrubberZoneLabel(this.state).toLowerCase();
    this.cursorLabel.textContent = scrubberCursorLabel(this.state);
    // Reflect state into the slider without retriggering `input`.
    this.slider.value = String(Math.round(scrubberThumbFraction(this.state) * 1000));
  }

  /** Tear down: cancel the loop and remove the element (no leaked rAF). */
  destroy(): void {
    this.destroyed = true;
    this.stopLoop();
    this.el.remove();
  }
}
