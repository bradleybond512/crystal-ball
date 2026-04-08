import { Cartesian3, SceneTransforms, type Viewer } from 'cesium';
import type { GlobeDataManager } from '@/components/GlobeDataManager';

export class GlobeHeatmap {
  private canvas: HTMLCanvasElement | null = null;
  private rafId: number | null = null;
  private enabled = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
 private viewer: Viewer,
 private container: HTMLElement,
 private dataManager: GlobeDataManager,
  ) {}

  mount(): void {
 const canvas = document.createElement('canvas');
 canvas.style.cssText =
 'position:absolute;inset:0;pointer-events:none;z-index:5;opacity:0;transition:opacity 0.3s;';
 canvas.width = this.container.clientWidth;
 canvas.height = this.container.clientHeight;
 this.container.append(canvas);
 this.canvas = canvas;

 this.resizeObserver = new ResizeObserver(() => {
 if (!this.canvas) return;
 this.canvas.width = this.container.clientWidth;
 this.canvas.height = this.container.clientHeight;
 });
 this.resizeObserver.observe(this.container);
  }

  destroy(): void {
 if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
 this.resizeObserver?.disconnect();
 this.resizeObserver = null;
 this.canvas?.remove();
 this.canvas = null;
  }

  setEnabled(on: boolean): void {
 this.enabled = on;
 if (this.canvas) this.canvas.style.opacity = on ? '1' : '0';
 if (on) {
 this.loop();
 } else {
 if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
 }
  }

  private loop(): void {
 if (!this.enabled) return;
 this.rafId = requestAnimationFrame(() => { this.draw(); this.loop(); });
  }

  private draw(): void {
 const canvas = this.canvas;
 if (!canvas) return;
 const ctx = canvas.getContext('2d');
 if (!ctx) return;
 ctx.clearRect(0, 0, canvas.width, canvas.height);

 const alerts = this.dataManager.getTopAlerts(100).filter(
 a => a.lat !== undefined && a.lon !== undefined,
 );

 for (const alert of alerts) {
 if (alert.lat === undefined || alert.lon === undefined) continue;
 const worldPos = Cartesian3.fromDegrees(alert.lon, alert.lat, 0);
 const screenPos = SceneTransforms.worldToWindowCoordinates(
 this.viewer.scene, worldPos,
 );
 if (!screenPos) continue;
 const r = alert.severity * 6;
 const grad = ctx.createRadialGradient(
 screenPos.x, screenPos.y, 0,
 screenPos.x, screenPos.y, r,
 );
 grad.addColorStop(0, 'rgba(248,113,113,0.35)');
 grad.addColorStop(1, 'rgba(248,113,113,0)');
 ctx.beginPath();
 ctx.arc(screenPos.x, screenPos.y, r, 0, Math.PI * 2);
 ctx.fillStyle = grad;
 ctx.fill();
 }
  }
}
