/**
 * GlobePlayback — three cinematic playback engines for God's Eye 4D.
 *
 * Modes:
 *   • documentary — steady time advancement at the user's selected
 *     speed multiplier; camera stays where the user placed it.
 *   • director    — speed is steady but AutoFollowEngine drives the
 *     camera to the highest-priority targets in view.
 *   • heartbeat   — speed adapts to event density: dense buckets slow
 *     playback (linger), sparse gaps fast-forward.
 *
 * Drives time via {@link GlobeTimeMachine.setTime}. Hosts a
 * requestAnimationFrame loop that scales `dt` by the current effective
 * speed, so the swimlane / globe layers update through the existing
 * TimeMachine debounce.
 *
 * Plan: docs/superpowers/plans/2026-04-13-gods-eye-4d.md (Task 5)
 */

import type { GlobeTimeMachine } from '@/components/GlobeTimeMachine';
import type { AutoFollowEngine } from '@/components/gods-vision/AutoFollowEngine';
import type { EventBlock } from '@/components/GlobeDataManager';

export type PlaybackMode = 'documentary' | 'director' | 'heartbeat';

interface HeartbeatWindow {
  startMs: number;
  endMs: number;
  density: number; // events overlapping this window
}

const HB_MIN_SPEED = 0.5;       // dense windows clamp at 0.5× user speed
const HB_MAX_SPEED = 8;         // sparse gaps cap at 8× user speed
const HB_WINDOW_MS = 3_600_000; // 1h density buckets
const HB_DENSITY_FULL = 8;      // density at which we hit MIN speed

export class GlobePlayback {
  private timeMachine: GlobeTimeMachine;
  private autoFollow: AutoFollowEngine | null;
  private modeValue: PlaybackMode = 'documentary';
  private rafId: number | null = null;
  private lastFrame = 0;
  private playingValue = false;
  private destroyed = false;
  private eventBlocks: EventBlock[] = [];
  private heartbeatWindows: HeartbeatWindow[] = [];

  private onModeChangeCb: ((mode: PlaybackMode) => void) | null = null;
  private onPlayStateCb: ((playing: boolean) => void) | null = null;

  constructor(timeMachine: GlobeTimeMachine, autoFollow: AutoFollowEngine | null) {
    this.timeMachine = timeMachine;
    this.autoFollow = autoFollow;
  }

  get mode(): PlaybackMode { return this.modeValue; }
  get playing(): boolean { return this.playingValue; }

  setOnModeChange(cb: (mode: PlaybackMode) => void): void { this.onModeChangeCb = cb; }
  setOnPlayState(cb: (playing: boolean) => void): void { this.onPlayStateCb = cb; }

  setMode(mode: PlaybackMode): void {
    if (this.modeValue === mode) return;
    const wasPlaying = this.playingValue;
    if (wasPlaying) this.pause();
    this.modeValue = mode;
    this.onModeChangeCb?.(mode);
    if (wasPlaying) this.play();
  }

  updateEventBlocks(blocks: EventBlock[]): void {
    this.eventBlocks = blocks;
    this.computeHeartbeatWindows();
  }

  play(): void {
    if (this.playingValue || this.destroyed) return;
    this.playingValue = true;
    this.lastFrame = performance.now();

    if (this.modeValue === 'director' && this.autoFollow) {
      this.autoFollow.start();
    }

    const tick = (now: number): void => {
      if (!this.playingValue || this.destroyed) return;
      const dt = now - this.lastFrame;
      this.lastFrame = now;

      const baseSpeed = this.timeMachine.getSpeed();
      const speedMultiplier = this.modeValue === 'heartbeat'
        ? this.heartbeatSpeed(this.timeMachine.getCurrentMs())
        : 1;
      const effectiveSpeed = baseSpeed * speedMultiplier;

      const nextMs = this.timeMachine.getCurrentMs() + dt * effectiveSpeed;
      this.timeMachine.setTime(nextMs);

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
    this.onPlayStateCb?.(true);
  }

  pause(): void {
    if (!this.playingValue) return;
    this.playingValue = false;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.modeValue === 'director' && this.autoFollow) {
      this.autoFollow.stop();
    }
    this.onPlayStateCb?.(false);
  }

  toggle(): void {
    if (this.playingValue) this.pause();
    else this.play();
  }

  destroy(): void {
    this.destroyed = true;
    this.pause();
    this.eventBlocks = [];
    this.heartbeatWindows = [];
  }

  /**
   * Look up the speed multiplier for the current time based on event density.
   * High density → slow (close to HB_MIN_SPEED), low density → fast (HB_MAX_SPEED).
   * Returns 1 when no window contains the time (treats it as average density).
   */
  private heartbeatSpeed(currentMs: number): number {
    for (const win of this.heartbeatWindows) {
      if (currentMs >= win.startMs && currentMs < win.endMs) {
        if (win.density === 0) return HB_MAX_SPEED;
        const normalized = Math.min(win.density / HB_DENSITY_FULL, 1);
        return HB_MAX_SPEED * (1 - normalized) + HB_MIN_SPEED * normalized;
      }
    }
    return 1;
  }

  private computeHeartbeatWindows(): void {
    if (this.eventBlocks.length === 0) {
      this.heartbeatWindows = [];
      return;
    }
    let minMs = Number.POSITIVE_INFINITY;
    let maxMs = Number.NEGATIVE_INFINITY;
    for (const b of this.eventBlocks) {
      if (b.startMs < minMs) minMs = b.startMs;
      if (b.endMs > maxMs) maxMs = b.endMs;
    }
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || maxMs <= minMs) {
      this.heartbeatWindows = [];
      return;
    }
    // Clamp to a reasonable upper bound on window count to avoid pathological
    // ranges (e.g. one ancient block + one future block creating thousands of
    // empty buckets between them).
    const totalSpan = maxMs - minMs;
    const windowCount = Math.min(Math.ceil(totalSpan / HB_WINDOW_MS), 720);
    const stepMs = totalSpan / windowCount;

    const windows: HeartbeatWindow[] = [];
    for (let i = 0; i < windowCount; i++) {
      const start = minMs + i * stepMs;
      const end = start + stepMs;
      let count = 0;
      for (const b of this.eventBlocks) {
        if (b.startMs < end && b.endMs > start) count++;
      }
      windows.push({ startMs: start, endMs: end, density: count });
    }
    this.heartbeatWindows = windows;
  }
}
