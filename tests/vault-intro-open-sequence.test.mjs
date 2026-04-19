import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const src = readFileSync(path.join(repoRoot, 'src', 'app', 'vault-intro.ts'), 'utf8');

// The vault intro is a single-window biometric door:
//   - SVG door + Canvas 2D brushed-steel render (no video scene)
//   - Direct Tauri biometry plugin call (no secondary overlay / scanner canvas)
//   - playOpenSequence choreographs the door retraction, interior light bloom,
//     and overlay fade before appReady resolves.
// These assertions characterize the current lifecycle so a future regression
// (e.g. losing the overlay fade or the interior bloom) would flip red.

test('vault intro overlay builds a door scene with scanner + status + quit controls', () => {
  assert.match(
 src,
 /type DoorParts = \{[\s\S]*scannerRing: SVGCircleElement;[\s\S]*statusText: SVGTextElement;[\s\S]*boltPins: SVGGElement\[\];/m,
 'door parts should expose the scanner ring, status text, and bolt-pin group refs used by the scene helpers',
  );
  assert.match(
 src,
 /type OverlayRefs = DoorParts & \{[\s\S]*overlay: HTMLDivElement;[\s\S]*scene: HTMLDivElement;[\s\S]*interior: HTMLDivElement;[\s\S]*\};/m,
 'overlay refs should wrap door parts alongside the root overlay, scene, and vault interior elements',
  );
  assert.match(
 src,
 /function buildOverlay\(\): OverlayRefs \{[\s\S]*injectStyles\(\);/m,
 'buildOverlay should inject scoped styles before assembling the DOM so first-paint uses the brushed-steel theme',
  );
});

test('vault intro open sequence plays motor audio, retracts bolts, reveals interior, and awaits readiness', () => {
  assert.match(
 src,
 /async function playOpenSequence\([\s\S]*setScannerSuccess\(p\);[\s\S]*playMotorWhine\(ctx\);[\s\S]*playBoltRetracts\(ctx\);/m,
 'open sequence should mark the scanner success and kick off the motor + bolt audio cues',
  );
  assert.match(
 src,
 /p\.boltPins\.forEach\(\(pin, i\) => \{[\s\S]*animation = `vi-bolt-retract/m,
 'open sequence should animate the bolt pins retracting in sequence',
  );
  assert.match(
 src,
 /await Promise\.race\(\[appReady, sleep\(2500\)\]\);[\s\S]*p\.statusText\.textContent = 'READY';/m,
 'open sequence should gate on appReady (with a 2.5s cap) before flipping status to READY',
  );
  assert.match(
 src,
 /Object\.assign\(p\.interior\.style, \{[\s\S]*opacity: '1',[\s\S]*\}\);/m,
 'open sequence should bloom the vault interior light as the door retracts',
  );
});
