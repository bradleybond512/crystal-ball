import { Math as CesiumMath, type Viewer } from 'cesium';

export class GlobeMiniMap {
  private canvas: HTMLCanvasElement | null = null;
  private rafId: number | null = null;
  private img: HTMLImageElement | null = null;
  private destroyed = false;

  constructor(private viewer: Viewer, private container: HTMLElement) {}

  mount(): void {
 const wrap = document.createElement('div');
 wrap.className = 'ge-minimap-wrap';

 const canvas = document.createElement('canvas');
 canvas.className = 'ge-minimap-canvas';
 canvas.width = 160;
 canvas.height = 80;
 wrap.append(canvas);
 this.container.append(wrap);
 this.canvas = canvas;

 const img = new Image();
 img.crossOrigin = 'anonymous';
 img.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/World_map_-_low_resolution.svg/320px-World_map_-_low_resolution.svg.png';
 img.addEventListener('load', () => { this.img = img; });

 this.loop();
  }

  destroy(): void {
 this.destroyed = true;
 if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
 this.canvas?.parentElement?.remove();
 this.canvas = null;
  }

  private loop(): void {
 if (this.destroyed) return;
 this.rafId = requestAnimationFrame(() => {
 if (this.destroyed) return;
 this.draw();
 this.loop();
 });
  }

  private draw(): void {
 const canvas = this.canvas;
 if (!canvas) return;
 const ctx = canvas.getContext('2d');
 if (!ctx) return;
 const w = canvas.width;
 const h = canvas.height;

 ctx.clearRect(0, 0, w, h);
 ctx.fillStyle = 'rgba(10,15,25,0.7)';
 ctx.fillRect(0, 0, w, h);

 if (this.img?.complete && this.img.naturalWidth > 0) {
 ctx.globalAlpha = 0.4;
 ctx.drawImage(this.img, 0, 0, w, h);
 ctx.globalAlpha = 1;
 }

 const cam = this.viewer.camera;
 const carto = cam.positionCartographic;
 const lon = CesiumMath.toDegrees(carto.longitude);
 const lat = CesiumMath.toDegrees(carto.latitude);
 const px = ((lon + 180) / 360) * w;
 const py = ((90 - lat) / 180) * h;

 ctx.beginPath();
 ctx.arc(px, py, 3, 0, Math.PI * 2);
 ctx.fillStyle = '#60a5fa';
 ctx.shadowColor = '#60a5fa';
 ctx.shadowBlur = 6;
 ctx.fill();
 ctx.shadowBlur = 0;

 const altKm = carto.height / 1000;
 const radiusDeg = Math.min(altKm / 111, 40);
 const radiusPx = (radiusDeg / 180) * h;
 ctx.beginPath();
 ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
 ctx.strokeStyle = 'rgba(96,165,250,0.3)';
 ctx.lineWidth = 1;
 ctx.stroke();
  }
}
