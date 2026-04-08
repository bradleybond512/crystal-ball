import { Panel } from './Panel';
import type { RadarState } from '@/services/rainviewer-radar';
import { getRadarFrameTime } from '@/services/rainviewer-radar';

export class WeatherRadarPanel extends Panel {
  private radarState: RadarState | null = null;
  private animating = false;
  private animationTimer: number | null = null;
  private currentFrame = 0;
  private onFrameChange: ((frameIndex: number) => void) | null = null;

  constructor() {
 super({
 id: 'weather-radar',
 title: 'Weather Radar',
 showCount: false,
 trackActivity: true,
 infoTooltip: 'Global weather radar from RainViewer. Use controls to animate radar loop.',
 });
 this.showLoading('Fetching radar frames...');
  }

  public setOnFrameChange(cb: (frameIndex: number) => void): void {
 this.onFrameChange = cb;
  }

  public update(state: RadarState): void {
 this.radarState = state;
 this.currentFrame = state.currentIndex;
 this.render();
  }

  private render(): void {
 if (!this.radarState) {
 this.setContent('<div class="panel-empty">No radar data available.</div>');
 return;
 }

 const frameTime = getRadarFrameTime(this.radarState, this.currentFrame);
 const timeLabel = frameTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
 const frame = this.radarState.frames[this.currentFrame];
 const typeLabel = frame?.type === 'forecast' ? 'FORECAST' : 'OBSERVED';
 const totalFrames = this.radarState.frames.length;
 const playLabel = this.animating ? 'Pause' : 'Play';

 this.setContent(`
 <div class="radar-panel-content">
 <div class="radar-controls">
 <button class="radar-btn radar-prev" title="Previous frame">&laquo;</button>
 <button class="radar-btn radar-play">${playLabel}</button>
 <button class="radar-btn radar-next" title="Next frame">&raquo;</button>
 </div>
 <div class="radar-timeline">
 <input type="range" class="radar-slider" min="0" max="${String(totalFrames - 1)}" value="${String(this.currentFrame)}">
 </div>
 <div class="radar-info">
 <span class="radar-time">${timeLabel}</span>
 <span class="radar-type ${frame?.type === 'forecast' ? 'radar-forecast' : ''}">${typeLabel}</span>
 <span class="radar-frame">${String(this.currentFrame + 1)}/${String(totalFrames)}</span>
 </div>
 <div class="fires-footer">
 <span class="fires-source">RainViewer &middot; Global radar composite</span>
 </div>
 </div>
 `);

 this.attachHandlers();
  }

  private attachHandlers(): void {
 const el = this.getContentElement();

 el.querySelector('.radar-prev')?.addEventListener('click', () => this.stepFrame(-1));
 el.querySelector('.radar-next')?.addEventListener('click', () => this.stepFrame(1));
 el.querySelector('.radar-play')?.addEventListener('click', () => this.toggleAnimation());

 const slider = el.querySelector('.radar-slider') as HTMLInputElement | null;
 if (slider) {
 slider.addEventListener('input', () => {
 this.currentFrame = Number.parseInt(slider.value, 10);
 this.onFrameChange?.(this.currentFrame);
 this.render();
 });
 }
  }

  private stepFrame(delta: number): void {
 if (!this.radarState) return;
 const total = this.radarState.frames.length;
 this.currentFrame = (this.currentFrame + delta + total) % total;
 this.onFrameChange?.(this.currentFrame);
 this.render();
  }

  private toggleAnimation(): void {
 if (this.animating) {
 this.stopAnimation();
 } else {
 this.startAnimation();
 }
 this.render();
  }

  private startAnimation(): void {
 this.animating = true;
 this.animationTimer = window.setInterval(() => {
 this.stepFrame(1);
 }, 500);
  }

  private stopAnimation(): void {
 this.animating = false;
 if (this.animationTimer != null) {
 clearInterval(this.animationTimer);
 this.animationTimer = null;
 }
  }

  public destroy(): void {
 this.stopAnimation();
  }
}
