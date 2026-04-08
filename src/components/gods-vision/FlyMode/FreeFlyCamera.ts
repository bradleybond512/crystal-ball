import type { Viewer } from 'cesium';
import { FLY_SENSITIVITY } from './flyModeKeybinds';

// Minimum altitude to prevent clipping through the globe (meters above ellipsoid)
const MIN_ALT_M = 100;
// Maximum speed cap regardless of altitude (m/s)
const MAX_SPEED_MS = 50_000;

interface KeyState {
  w: boolean; s: boolean; a: boolean; d: boolean;
  q: boolean; e: boolean;
  shift: boolean; ctrl: boolean;
}

export class FreeFlyCamera {
  protected viewer: Viewer;
  protected canvas: HTMLCanvasElement;
  private keys: KeyState = { w:false, s:false, a:false, d:false, q:false, e:false, shift:false, ctrl:false };
  private rightMouseDown = false;

  private cleanupFns: (() => void)[] = [];

  private readonly boundKeyDown = (e: KeyboardEvent) => { this.onKeyDown(e); };
  private readonly boundKeyUp = (e: KeyboardEvent) => { this.onKeyUp(e); };
  private readonly boundMouseMove = (e: MouseEvent) => { this.onMouseMove(e); };
  private readonly boundMouseDown = (e: MouseEvent) => { if (e.button === 2) this.rightMouseDown = true; };
  private readonly boundMouseUp = (e: MouseEvent) => { if (e.button === 2) this.rightMouseDown = false; };
  private readonly boundContextMenu = (e: Event) => { e.preventDefault(); };

  constructor(viewer: Viewer, canvas: HTMLCanvasElement) {
 this.viewer = viewer;
 this.canvas = canvas;
  }

  activate(): void {
 document.addEventListener('keydown', this.boundKeyDown);
 document.addEventListener('keyup', this.boundKeyUp);
 document.addEventListener('mousemove', this.boundMouseMove);
 document.addEventListener('mousedown', this.boundMouseDown);
 document.addEventListener('mouseup', this.boundMouseUp);
 this.canvas.addEventListener('contextmenu', this.boundContextMenu);

 this.cleanupFns = [
 () => { document.removeEventListener('keydown', this.boundKeyDown); },
 () => { document.removeEventListener('keyup', this.boundKeyUp); },
 () => { document.removeEventListener('mousemove', this.boundMouseMove); },
 () => { document.removeEventListener('mousedown', this.boundMouseDown); },
 () => { document.removeEventListener('mouseup', this.boundMouseUp); },
 () => { this.canvas.removeEventListener('contextmenu', this.boundContextMenu); },
 ];
  }

  deactivate(): void {
 for (const fn of this.cleanupFns) fn();
 this.cleanupFns = [];
 this.rightMouseDown = false;
 this.keys = { w:false, s:false, a:false, d:false, q:false, e:false, shift:false, ctrl:false };
  }

  update(dt: number): void {
 const camera = this.viewer.camera;
 const alt = Math.max(1, camera.positionCartographic.height);

 // Power-law speed: feels natural across 100m → 10,000km range.
 // pow(alt/1000, 0.6) * 100 gives:
 // 100m → ~25 m/s 10km → ~400 m/s 1000km → ~6.3 km/s
 const base = Math.min(Math.pow(alt / 1000, 0.6) * 100, MAX_SPEED_MS);
 const speed = base
 * (this.keys.shift ? 10 : 1)
 * (this.keys.ctrl ? 0.1 : 1);
 const dist = speed * dt;

 if (this.keys.w) camera.moveForward(dist);
 if (this.keys.s) camera.moveBackward(dist);
 if (this.keys.a) camera.moveLeft(dist);
 if (this.keys.d) camera.moveRight(dist);
 if (this.keys.q) camera.moveUp(dist);
 if (this.keys.e) camera.moveDown(dist);

 // Altitude floor — prevent going underground and triggering pink/black globe
 const currentAlt = camera.positionCartographic.height;
 if (currentAlt < MIN_ALT_M) {
 camera.moveUp(MIN_ALT_M - currentAlt);
 }
  }

  private onKeyDown(e: KeyboardEvent): void {
 switch (e.code) {
 case 'KeyW': { this.keys.w = true; e.preventDefault(); break;
 }
 case 'KeyS': { this.keys.s = true; e.preventDefault(); break;
 }
 case 'KeyA': { this.keys.a = true; e.preventDefault(); break;
 }
 case 'KeyD': { this.keys.d = true; e.preventDefault(); break;
 }
 case 'KeyQ': { this.keys.q = true; e.preventDefault(); break;
 }
 case 'KeyE': { this.keys.e = true; e.preventDefault(); break;
 }
 case 'ShiftLeft': case 'ShiftRight': { this.keys.shift = true; break;
 }
 case 'ControlLeft': case 'ControlRight': { this.keys.ctrl = true; break;
 }
 }
  }

  private onKeyUp(e: KeyboardEvent): void {
 switch (e.code) {
 case 'KeyW': { this.keys.w = false; break;
 }
 case 'KeyS': { this.keys.s = false; break;
 }
 case 'KeyA': { this.keys.a = false; break;
 }
 case 'KeyD': { this.keys.d = false; break;
 }
 case 'KeyQ': { this.keys.q = false; break;
 }
 case 'KeyE': { this.keys.e = false; break;
 }
 case 'ShiftLeft': case 'ShiftRight': { this.keys.shift = false; break;
 }
 case 'ControlLeft': case 'ControlRight': { this.keys.ctrl = false; break;
 }
 }
  }

  private onMouseMove(e: MouseEvent): void {
 if (!this.rightMouseDown) return;
 const camera = this.viewer.camera;
 const dx = e.movementX * FLY_SENSITIVITY;
 const dy = e.movementY * FLY_SENSITIVITY;
 if (dx !== 0) camera.lookRight(dx);
 if (dy !== 0) camera.lookDown(dy);
  }
}
