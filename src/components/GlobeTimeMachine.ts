import { JulianDate, type Viewer } from 'cesium';
import type { GlobeDataManager } from '@/components/GlobeDataManager';

const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_MS = 48 * 60 * 60 * 1000;
const DEBOUNCE_MS = 250;
const SPEEDS = [1, 4, 16, 64] as const;

export class GlobeTimeMachine {
  private viewer: Viewer;
  private dataManager: GlobeDataManager;
  private container: HTMLElement;
  private root: HTMLDivElement | null = null;
  private slider: HTMLInputElement | null = null;
  private timeLabel: HTMLSpanElement | null = null;
  private liveIndicator: HTMLSpanElement | null = null;
  private playBtn: HTMLButtonElement | null = null;
  private speedPills: HTMLButtonElement[] = [];

  private currentMs: number;
  private playing = false;
  private speed = 1;
  private live = true;
  private rafId: number | null = null;
  private lastFrame = 0;
  private debounceId: number | null = null;

  constructor(viewer: Viewer, dataManager: GlobeDataManager, container: HTMLElement) {
 this.viewer = viewer;
 this.dataManager = dataManager;
 this.container = container;
 this.currentMs = Date.now();
  }

  mount(): void {
 const root = document.createElement('div');
 root.className = 'godsvision-time-machine';

 const liveWrap = document.createElement('div');
 liveWrap.className = 'gtm-live-wrap';
 const liveDot = document.createElement('span');
 liveDot.className = 'gtm-live-dot';
 this.liveIndicator = document.createElement('span');
 this.liveIndicator.className = 'gtm-live-text';
 this.liveIndicator.textContent = 'LIVE';
 liveWrap.append(liveDot, this.liveIndicator);

 this.playBtn = document.createElement('button');
 this.playBtn.type = 'button';
 this.playBtn.className = 'gtm-btn gtm-play';
 this.playBtn.textContent = 'Play';
 this.playBtn.addEventListener('click', () => {
 if (this.playing) this.pause();
 else this.play();
 });

 const slider = document.createElement('input');
 slider.type = 'range';
 slider.className = 'gtm-slider';
 slider.step = '60000'; // 1-minute steps
 slider.addEventListener('input', () => {
 this.setTime(Number(slider.value));
 });
 this.slider = slider;
 this.refreshSliderBounds();

 this.timeLabel = document.createElement('span');
 this.timeLabel.className = 'gtm-time-label';

 const speedWrap = document.createElement('div');
 speedWrap.className = 'gtm-speed-wrap';
 for (const s of SPEEDS) {
 const pill = document.createElement('button');
 pill.type = 'button';
 pill.className = 'gtm-pill';
 pill.textContent = `${s}x`;
 pill.dataset.speed = String(s);
 pill.addEventListener('click', () => this.setSpeed(s));
 speedWrap.append(pill);
 this.speedPills.push(pill);
 }

 const nowBtn = document.createElement('button');
 nowBtn.type = 'button';
 nowBtn.className = 'gtm-btn gtm-now';
 nowBtn.textContent = 'Now';
 nowBtn.addEventListener('click', () => this.snapToNow());

 root.append(liveWrap, this.playBtn, slider, this.timeLabel, speedWrap, nowBtn);
 this.container.append(root);
 this.root = root;

 this.updateUi();
  }

  destroy(): void {
 this.pause();
 if (this.debounceId != null) { clearTimeout(this.debounceId); this.debounceId = null; }
 this.root?.remove();
 this.root = null;
 this.slider = null;
 this.timeLabel = null;
 this.liveIndicator = null;
 this.playBtn = null;
 this.speedPills = [];
 // Ensure layers return to unfiltered state
 this.dataManager.applyTimeFilter(null);
  }

  private refreshSliderBounds(): void {
 if (!this.slider) return;
 const now = Date.now();
 this.slider.min = String(now - DAY_MS);
 this.slider.max = String(now + FUTURE_MS);
 if (!this.slider.value || Number(this.slider.value) < now - DAY_MS) {
 this.slider.value = String(this.currentMs);
 }
  }

  setTime(ms: number): void {
 const now = Date.now();
 const min = now - DAY_MS;
 const max = now + FUTURE_MS;
 const clamped = Math.max(min, Math.min(max, ms));
 this.currentMs = clamped;
 this.live = Math.abs(clamped - now) < 60_000;
 this.viewer.clock.currentTime = JulianDate.fromDate(new Date(clamped));
 if (this.slider) this.slider.value = String(clamped);
 this.scheduleFilter();
 this.updateUi();
  }

  play(): void {
 if (this.playing) return;
 this.playing = true;
 this.viewer.clock.shouldAnimate = true;
 this.lastFrame = performance.now();
 const tick = (now: number) => {
 if (!this.playing) return;
 const dt = now - this.lastFrame;
 this.lastFrame = now;
 let next = this.currentMs + dt * this.speed;
 if (next >= Date.now() + FUTURE_MS) {
 next = Date.now() + FUTURE_MS;
 this.setTime(next);
 this.pause();
 return;
 }
 this.setTime(next);
 this.rafId = requestAnimationFrame(tick);
 };
 this.rafId = requestAnimationFrame(tick);
 this.updateUi();
  }

  pause(): void {
 this.playing = false;
 this.viewer.clock.shouldAnimate = false;
 if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
 this.updateUi();
  }

  togglePlay(): void {
 if (this.playing) this.pause();
 else this.play();
  }

  setSpeed(multiplier: number): void {
 this.speed = multiplier;
 this.viewer.clock.multiplier = multiplier;
 this.updateUi();
  }

  snapToNow(): void {
 this.pause();
 this.currentMs = Date.now();
 this.live = true;
 this.refreshSliderBounds();
 if (this.slider) this.slider.value = String(this.currentMs);
 this.viewer.clock.currentTime = JulianDate.fromDate(new Date(this.currentMs));
 this.dataManager.applyTimeFilter(null);
 this.updateUi();
  }

  private scheduleFilter(): void {
 if (this.debounceId != null) clearTimeout(this.debounceId);
 this.debounceId = window.setTimeout(() => {
 this.debounceId = null;
 this.dataManager.applyTimeFilter(this.live ? null : this.currentMs);
 }, DEBOUNCE_MS);
  }

  private updateUi(): void {
 if (this.timeLabel) {
 const d = new Date(this.currentMs);
 const fmt = new Intl.DateTimeFormat(undefined, {
 month: 'short',
 day: 'numeric',
 hour: '2-digit',
 minute: '2-digit',
 hour12: false,
 timeZoneName: 'short',
 });
 this.timeLabel.textContent = fmt.format(d);
 }
 if (this.liveIndicator) {
 const isForecast = this.currentMs > Date.now() + 60_000;
 this.liveIndicator.textContent = isForecast ? 'FORECAST' : 'LIVE';
 this.liveIndicator.classList.toggle('gtm-forecast-mode', isForecast);
 }
 if (this.playBtn) this.playBtn.textContent = this.playing ? 'Pause' : 'Play';
 if (this.root) this.root.classList.toggle('gtm-scrubbing', !this.live);
 for (const pill of this.speedPills) {
 pill.classList.toggle('gtm-pill-active', Number(pill.dataset.speed) === this.speed);
 }
  }
}
