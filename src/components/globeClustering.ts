import { Color, type CustomDataSource, type Entity } from 'cesium';
import { LruCache } from '@/utils/lru-cache';

export interface ClusterOptions {
  pixelRange: number;
  minimumClusterSize: number;
  categoryColor: Color;
}

const DEFAULTS = {
  pixelRange: 80,
  minimumClusterSize: 3,
};

const imageCache = new LruCache<string, string>(300);

function colorHex(c: Color): string {
  const r = Math.round(c.red * 255);
  const g = Math.round(c.green * 255);
  const b = Math.round(c.blue * 255);
  return `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function formatCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) return (count / 1000).toFixed(1) + 'k';
  return Math.floor(count / 1000) + 'k';
}

function getClusterImage(count: number, color: Color): string {
  const hex = colorHex(color);
  const key = `${count}-${hex}`;
  const cached = imageCache.get(key);
  if (cached) return cached;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 3;

  const r = Math.round(color.red * 255);
  const g = Math.round(color.green * 255);
  const b = Math.round(color.blue * 255);

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatCount(count), cx, cy);

  const dataUrl = canvas.toDataURL();
  imageCache.set(key, dataUrl);
  return dataUrl;
}

interface ClusterVisuals {
  billboard?: { show?: boolean; image?: string; width?: number; height?: number };
  label?: { show?: boolean };
  point?: { show?: boolean };
}

export function applyClustering(
  dataSource: CustomDataSource,
  opts: Partial<ClusterOptions> & { categoryColor: Color },
): void {
  const pixelRange = opts.pixelRange ?? DEFAULTS.pixelRange;
  const minimumClusterSize = opts.minimumClusterSize ?? DEFAULTS.minimumClusterSize;
  const color = opts.categoryColor;

  const clustering = dataSource.clustering;
  clustering.enabled = true;
  clustering.pixelRange = pixelRange;
  clustering.minimumClusterSize = minimumClusterSize;

  clustering.clusterEvent.addEventListener(
 (clusteredEntities: Entity[], cluster: ClusterVisuals) => {
 if (cluster.label) cluster.label.show = false;
 if (cluster.point) cluster.point.show = false;
 if (cluster.billboard) {
 cluster.billboard.show = true;
 cluster.billboard.image = getClusterImage(clusteredEntities.length, color);
 cluster.billboard.width = 48;
 cluster.billboard.height = 48;
 }
 },
  );
}
