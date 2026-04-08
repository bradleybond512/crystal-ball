import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface ThreeOverlayOptions {
  container: HTMLElement;
  enableBloom?: boolean;
}

export class ThreeOverlay {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private container: HTMLElement;

  constructor(private readonly options: ThreeOverlayOptions) {
 this.container = options.container;
 this.scene = new THREE.Scene();
 this.camera = new THREE.PerspectiveCamera(60, 1, 0.001, 100);
  }

  initialize(): void {
 const canvas = document.createElement('canvas');
 canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;width:100%;height:100%;';
 this.container.append(canvas);

 this.renderer = new THREE.WebGLRenderer({
 canvas,
 alpha: true,
 antialias: false,
 powerPreference: 'low-power',
 });
 this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
 this.renderer.setClearColor(0x00_00_00, 0);
 this.updateSize();

 if (this.options.enableBloom) {
 this.setupPostProcessing();
 }
  }

  private setupPostProcessing(): void {
 if (!this.renderer) return;
 const size = this.renderer.getSize(new THREE.Vector2());
 this.composer = new EffectComposer(this.renderer);
 this.composer.addPass(new RenderPass(this.scene, this.camera));

 const bloomPass = new UnrealBloomPass(size, 0.8, 0.4, 0.85);
 this.composer.addPass(bloomPass);
  }

  syncCamera(
 viewMatrix: ArrayLike<number>,
 _projectionMatrix: ArrayLike<number>,
 fov: number,
 aspect: number,
 near: number,
 far: number,
  ): void {
 this.camera.fov = fov;
 this.camera.aspect = aspect;
 this.camera.near = near;
 this.camera.far = far;
 this.camera.updateProjectionMatrix();

 const m = viewMatrix;
 this.camera.matrixAutoUpdate = false;
 this.camera.matrix.set(
 Number(m[0]), Number(m[4]), Number(m[8]), Number(m[12]),
 Number(m[1]), Number(m[5]), Number(m[9]), Number(m[13]),
 Number(m[2]), Number(m[6]), Number(m[10]), Number(m[14]),
 Number(m[3]), Number(m[7]), Number(m[11]), Number(m[15]),
 );
 this.camera.matrixWorldNeedsUpdate = true;
  }

  get threeScene(): THREE.Scene {
 return this.scene;
  }

  get threeCamera(): THREE.PerspectiveCamera {
 return this.camera;
  }

  render(): void {
 if (this.composer) {
 this.composer.render();
 } else {
 this.renderer?.render(this.scene, this.camera);
 }
  }

  updateSize(): void {
 if (!this.renderer) return;
 const { clientWidth, clientHeight } = this.container;
 this.renderer.setSize(clientWidth, clientHeight, false);
 this.camera.aspect = clientWidth / clientHeight;
 this.camera.updateProjectionMatrix();
 this.composer?.setSize(clientWidth, clientHeight);
  }

  addToScene(object: THREE.Object3D): void {
 this.scene.add(object);
  }

  removeFromScene(object: THREE.Object3D): void {
 this.scene.remove(object);
  }

  destroy(): void {
 this.scene.traverse((object) => {
 const mesh = object as THREE.Mesh;
 if (mesh.geometry) mesh.geometry.dispose();
 const material = mesh.material;
 if (Array.isArray(material)) {
 material.forEach((m: THREE.Material) => m.dispose());
 } else if (material) {
 (material as THREE.Material).dispose();
 }
 });
 this.composer?.dispose();
 this.renderer?.dispose();
 this.renderer = null;
 this.composer = null;
  }
}
