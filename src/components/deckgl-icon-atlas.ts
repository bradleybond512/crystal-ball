import type { IconLayerProps } from '@deck.gl/layers';

// SVG icons as data URLs for different marker shapes
// ── Canvas-drawn icon atlas (SVG data URIs fail in WKWebView WebGL) ──
// All icons are drawn onto a single 32-tall sprite sheet using Canvas 2D API.
// Each icon occupies a 32x32 cell. `mask: true` lets DeckGL tint via getColor.
const ICON_SIZE = 32;

type IconDrawFn = (ctx: CanvasRenderingContext2D) => void;

const ICON_DRAW_FNS: Record<string, IconDrawFn> = {
  triangleUp: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 2); ctx.lineTo(30, 28); ctx.lineTo(2, 28); ctx.closePath(); ctx.fill(); },
  hexagon: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 2); ctx.lineTo(28, 9); ctx.lineTo(28, 23); ctx.lineTo(16, 30); ctx.lineTo(4, 23); ctx.lineTo(4, 9); ctx.closePath(); ctx.fill(); },
  square: (ctx) => { ctx.beginPath(); ctx.roundRect(2, 2, 28, 28, 3); ctx.fill(); },
  circle: (ctx) => { ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2); ctx.fill(); },
  diamond: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 2); ctx.lineTo(30, 16); ctx.lineTo(16, 30); ctx.lineTo(2, 16); ctx.closePath(); ctx.fill(); },
  star: (ctx) => { ctx.beginPath(); const pts = [[16,2],[20,12],[30,12],[22,19],[25,30],[16,23],[7,30],[10,19],[2,12],[12,12]]; ctx.moveTo(pts[0]![0]!, pts[0]![1]!); for (let i = 1; i < pts.length; i++) { ctx.lineTo(pts[i]![0]!, pts[i]![1]!); } ctx.closePath(); ctx.fill(); },
  airplane: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 1); ctx.lineTo(14, 10); ctx.lineTo(4, 18); ctx.lineTo(4, 20); ctx.lineTo(14, 17); ctx.lineTo(14, 25); ctx.lineTo(10, 28); ctx.lineTo(10, 30); ctx.lineTo(16, 28); ctx.lineTo(22, 30); ctx.lineTo(22, 28); ctx.lineTo(18, 25); ctx.lineTo(18, 17); ctx.lineTo(28, 20); ctx.lineTo(28, 18); ctx.lineTo(18, 10); ctx.closePath(); ctx.fill(); },
  fighter: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 1); ctx.lineTo(14, 8); ctx.lineTo(2, 16); ctx.lineTo(2, 18); ctx.lineTo(14, 15); ctx.lineTo(13, 22); ctx.lineTo(8, 26); ctx.lineTo(8, 28); ctx.lineTo(14, 25); ctx.lineTo(14, 29); ctx.lineTo(16, 31); ctx.lineTo(18, 29); ctx.lineTo(18, 25); ctx.lineTo(24, 28); ctx.lineTo(24, 26); ctx.lineTo(19, 22); ctx.lineTo(18, 15); ctx.lineTo(30, 18); ctx.lineTo(30, 16); ctx.lineTo(18, 8); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(12, 10); ctx.lineTo(10, 12); ctx.lineTo(14, 11); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(20, 10); ctx.lineTo(22, 12); ctx.lineTo(18, 11); ctx.closePath(); ctx.fill(); },
  ship: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 3); ctx.lineTo(20, 10); ctx.lineTo(21, 24); ctx.lineTo(19, 29); ctx.lineTo(13, 29); ctx.lineTo(11, 24); ctx.lineTo(12, 10); ctx.closePath(); ctx.fill(); },
  satellite: (ctx) => { ctx.beginPath(); ctx.roundRect(13, 8, 6, 16, 1); ctx.fill(); ctx.beginPath(); ctx.roundRect(2, 12, 10, 8, 1); ctx.fill(); ctx.beginPath(); ctx.roundRect(20, 12, 10, 8, 1); ctx.fill(); },
  earthquake: (ctx) => { ctx.beginPath(); ctx.moveTo(4, 16); ctx.lineTo(8, 8); ctx.lineTo(12, 22); ctx.lineTo(16, 6); ctx.lineTo(20, 26); ctx.lineTo(24, 10); ctx.lineTo(28, 16); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); },
  fire: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 2); ctx.bezierCurveTo(16, 2, 24, 12, 24, 20); ctx.bezierCurveTo(24, 24.4, 20.4, 28, 16, 28); ctx.bezierCurveTo(11.6, 28, 8, 24.4, 8, 20); ctx.bezierCurveTo(8, 12, 16, 2, 16, 2); ctx.fill(); },
  lightning: (ctx) => { ctx.beginPath(); ctx.moveTo(18, 2); ctx.lineTo(10, 18); ctx.lineTo(15, 18); ctx.lineTo(14, 30); ctx.lineTo(22, 14); ctx.lineTo(17, 14); ctx.closePath(); ctx.fill(); },
  rocket: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 2); ctx.bezierCurveTo(16, 2, 22, 8, 22, 18); ctx.lineTo(25, 22); ctx.lineTo(25, 25); ctx.lineTo(20, 22); ctx.lineTo(20, 26); ctx.lineTo(18, 28); ctx.lineTo(16, 26); ctx.lineTo(14, 28); ctx.lineTo(12, 26); ctx.lineTo(12, 22); ctx.lineTo(7, 25); ctx.lineTo(7, 22); ctx.lineTo(10, 18); ctx.bezierCurveTo(10, 8, 16, 2, 16, 2); ctx.fill(); ctx.beginPath(); ctx.arc(16, 15, 3, 0, Math.PI * 2); ctx.globalCompositeOperation = 'destination-out'; ctx.fill(); ctx.globalCompositeOperation = 'source-over'; },
  anchor: (ctx) => { ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(16, 8, 3, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(16, 11); ctx.lineTo(16, 27); ctx.stroke(); ctx.beginPath(); ctx.moveTo(11, 17); ctx.lineTo(21, 17); ctx.stroke(); ctx.beginPath(); ctx.moveTo(10, 22); ctx.quadraticCurveTo(10, 29, 16, 29); ctx.stroke(); ctx.beginPath(); ctx.moveTo(22, 22); ctx.quadraticCurveTo(22, 29, 16, 29); ctx.stroke(); },
  crosshair: (ctx) => { ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(16, 16, 8, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(16, 16, 3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(16, 4); ctx.lineTo(16, 8); ctx.moveTo(16, 24); ctx.lineTo(16, 28); ctx.moveTo(4, 16); ctx.lineTo(8, 16); ctx.moveTo(24, 16); ctx.lineTo(28, 16); ctx.stroke(); },
  biohazard: (ctx) => { ctx.beginPath(); ctx.arc(16, 16, 3, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(16, 10, 8, Math.PI * 0.7, Math.PI * 1.1); ctx.stroke(); ctx.beginPath(); ctx.arc(22, 20, 8, Math.PI * 1.2, Math.PI * 1.7); ctx.stroke(); ctx.beginPath(); ctx.arc(10, 20, 8, -Math.PI * 0.2, Math.PI * 0.3); ctx.stroke(); },
  shield: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 3); ctx.lineTo(4, 8); ctx.lineTo(4, 16); ctx.quadraticCurveTo(4, 26, 16, 30); ctx.quadraticCurveTo(28, 26, 28, 16); ctx.lineTo(28, 8); ctx.closePath(); ctx.fill(); },
  cloud: (ctx) => { ctx.beginPath(); ctx.arc(12, 16, 6, 0, Math.PI * 2); ctx.arc(20, 15, 7, 0, Math.PI * 2); ctx.arc(8, 19, 4, 0, Math.PI * 2); ctx.arc(24, 18, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(6, 16, 20, 8); ctx.beginPath(); ctx.fillRect(15, 11, 2, 6); ctx.fill(); ctx.beginPath(); ctx.arc(16, 10, 1, 0, Math.PI * 2); ctx.fill(); },
  turbine: (ctx) => { ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(16, 13); ctx.lineTo(16, 28); ctx.moveTo(12, 28); ctx.lineTo(20, 28); ctx.stroke(); ctx.beginPath(); ctx.arc(16, 10, 3, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(16, 10); ctx.lineTo(16, 2); ctx.moveTo(16, 10); ctx.lineTo(23, 16); ctx.moveTo(16, 10); ctx.lineTo(9, 16); ctx.stroke(); },
  chart: (ctx) => { ctx.beginPath(); ctx.roundRect(5, 18, 4, 10, 1); ctx.fill(); ctx.beginPath(); ctx.roundRect(11, 12, 4, 16, 1); ctx.fill(); ctx.beginPath(); ctx.roundRect(17, 6, 4, 22, 1); ctx.fill(); ctx.beginPath(); ctx.roundRect(23, 14, 4, 14, 1); ctx.fill(); },
  bank: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 3); ctx.lineTo(28, 10); ctx.lineTo(28, 12); ctx.lineTo(4, 12); ctx.lineTo(4, 10); ctx.closePath(); ctx.fill(); ctx.fillRect(6, 13, 3, 12); ctx.fillRect(11, 13, 3, 12); ctx.fillRect(18, 13, 3, 12); ctx.fillRect(23, 13, 3, 12); ctx.beginPath(); ctx.roundRect(4, 26, 24, 3, 1); ctx.fill(); },
};


let _iconAtlas: HTMLCanvasElement | null = null;
let _iconMapping: Record<string, { x: number; y: number; width: number; height: number; anchorX: number; anchorY: number; mask: boolean }> | null = null;

// DeckGL's image prop converts browser canvases to textures, but IconLayerProps
// omits canvas inputs. The return casts adapt that declaration without converting the canvas.

export function getIconAtlas(): NonNullable<IconLayerProps['iconAtlas']> {
  if (_iconAtlas) return _iconAtlas as unknown as NonNullable<IconLayerProps['iconAtlas']>;
  const names = Object.keys(ICON_DRAW_FNS);
  const canvas = document.createElement('canvas');
  canvas.width = names.length * ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'white';
  const mapping: typeof _iconMapping = {};
  for (const [i, name] of names.entries()) {
    ctx.save();
    ctx.translate(i * ICON_SIZE, 0);
    ICON_DRAW_FNS[name!]!(ctx);
    ctx.restore();
    // Anchor each icon at its center, not the DeckGL default of bottom-center.
    // Without explicit anchorY, every icon (planes, cyclones, fires, …) is
    // drawn with its bottom edge at the geo point — visually offset upward
    // by half the icon height. The displacement is in screen pixels, so it
    // looks larger at low zoom and becomes obvious once you pan in close
    // enough to compare planes against runways.
    mapping[name!] = {
      x: i * ICON_SIZE, y: 0,
      width: ICON_SIZE, height: ICON_SIZE,
      anchorX: ICON_SIZE / 2, anchorY: ICON_SIZE / 2,
      mask: true,
    };
  }
  _iconAtlas = canvas;
  _iconMapping = mapping;
  return canvas as unknown as NonNullable<IconLayerProps['iconAtlas']>;
}

export function getIconMapping(): Record<string, { x: number; y: number; width: number; height: number; anchorX: number; anchorY: number; mask: boolean }> {
  if (!_iconMapping) getIconAtlas();
  return _iconMapping!;
}
