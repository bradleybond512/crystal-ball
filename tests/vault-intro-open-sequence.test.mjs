import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const src = readFileSync(path.join(repoRoot, 'src', 'app', 'vault-intro.ts'), 'utf8');

test('vault intro overlay builds a video scene with scanner and status controls', () => {
  assert.match(
 src,
 /interface VideoScene \{[\s\S]*idleVideo:\s+HTMLVideoElement;[\s\S]*openVideo:\s+HTMLVideoElement;[\s\S]*fpCanvas:\s+HTMLCanvasElement;/m,
 'video scene should keep references to idle/open footage and the scanner overlay canvas',
  );
  assert.match(
 src,
 /const idleVideo = makeVideo\('vault-idle\.mp4', true\);[\s\S]*const openVideo = makeVideo\('vault-open\.mp4', false\);/m,
 'scene should preload both idle and open vault videos',
  );
  assert.match(
 src,
 /container\.append\(idleVideo, openVideo, fpCanvas, scanBtn, statusEl, quitBtn, flashEl\);/m,
 'scene should mount scanner controls and status UI on top of the video stack',
  );
  assert.match(
 src,
 /return \{ container, idleVideo, openVideo, fpCanvas, statusEl, scanBtn, quitBtn, flashEl \};/m,
 'overlay builder should return the full scene refs used by the intro lifecycle',
  );
});

test('vault intro open sequence swaps to open footage, fades scanner overlay, and exits cleanly', () => {
  assert.match(
 src,
 /scene\.openVideo\.currentTime = 0;[\s\S]*void scene\.openVideo\.play\(\);[\s\S]*scene\.openVideo\.style\.opacity = '1';[\s\S]*scene\.idleVideo\.style\.opacity = '0';/m,
 'open sequence should swap from idle to open footage immediately after success',
  );
  assert.match(
 src,
 /const fpFadeStart = Date\.now\(\);[\s\S]*ctx\.globalAlpha = 1 - t;[\s\S]*drawFrame\(canvas, st, Date\.now\(\)\);/m,
 'fingerprint overlay should fade while the open footage plays',
  );
  assert.match(
 src,
 /await sleep\(2800\);[\s\S]*scene\.flashEl\.style\.opacity = '0\.75';[\s\S]*scene\.container\.style\.transition = 'opacity 0\.55s ease';/m,
 'open sequence should respect timing gates, flash, and then fade the full overlay',
  );
  assert.match(
 src,
 /appReady\(\);[\s\S]*scene\.container\.remove\(\);/m,
 'open sequence should notify readiness and remove the intro container at completion',
  );
});
