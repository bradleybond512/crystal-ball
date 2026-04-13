import { Cartesian3, SceneTransforms, type Viewer } from 'cesium';
import type { GlobeDataManager } from '@/components/GlobeDataManager';
import { unifiedAlertStore } from '@/services/unified-alerts';
import { scoreAlert } from '@/services/alert-routing';
import { isAppActive, onActivityChange } from '@/services/app-activity';

const SEV_COLORS: Record<string, [number, number, number]> = {
  critical: [239, 68, 68],
  high:     [249, 115, 22],
  medium:   [234, 179, 8],
  low:      [34, 197, 94],
  info:     [96, 165, 250],
};

export class GlobeHeatmap {
  private canvas: HTMLCanvasElement | null = null;
  private rafId: number | null = null;
  private enabled = false;
  private resizeObserver: ResizeObserver | null = null;
  private unsubActivity: (() => void) | null = null;

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
 this.unsubActivity = onActivityChange((active) => {
 if (active && this.enabled) this.loop();
 });
  }

  destroy(): void {
 this.unsubActivity?.();
 this.unsubActivity = null;
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
 if (!this.enabled || !isAppActive()) return;
 this.rafId = requestAnimationFrame(() => { this.draw(); this.loop(); });
  }

  private draw(): void {
 const canvas = this.canvas;
 if (!canvas) return;
 const ctx = canvas.getContext('2d');
 if (!ctx) return;
 ctx.clearRect(0, 0, canvas.width, canvas.height);

 // Primary: data manager alerts (globe layer entities).
 const dmAlerts = this.dataManager.getTopAlerts(100).filter(
 a => a.lat !== undefined && a.lon !== undefined,
 );
 for (const alert of dmAlerts) {
 if (alert.lat === undefined || alert.lon === undefined) continue;
 const worldPos = Cartesian3.fromDegrees(alert.lon, alert.lat, 0);
 const screenPos = SceneTransforms.worldToWindowCoordinates(
 this.viewer.scene, worldPos,
 );
 if (!screenPos) continue;
 const r = Math.max(20, alert.severity * 8);
 this.drawBlob(ctx, screenPos.x, screenPos.y, r, [248, 113, 113]);
 }

 // Secondary: unified alert store (severity-weighted).
 const unified = unifiedAlertStore.getAll().filter(a => a.location && !a.acknowledged);
 for (const a of unified) {
 if (!a.location) continue;
 const worldPos = Cartesian3.fromDegrees(a.location.lon, a.location.lat, 0);
 const screenPos = SceneTransforms.worldToWindowCoordinates(
 this.viewer.scene, worldPos,
 );
 if (!screenPos) continue;
 const score = scoreAlert(a);
 const r = Math.max(15, Math.min(80, score * 0.8));
 const rgb: [number, number, number] = SEV_COLORS[a.severity] ?? [96, 165, 250];
 this.drawBlob(ctx, screenPos.x, screenPos.y, r, rgb);
 }
  }

  private drawBlob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: [number, number, number]): void {
 const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
 grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`);
 grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
 ctx.beginPath();
 ctx.arc(x, y, r, 0, Math.PI * 2);
 ctx.fillStyle = grad;
 ctx.fill();
  }
}
