/**
 * Generates minimal placeholder .glb files for aircraft models.
 * These are simple arrow-shaped meshes that will be replaced with
 * real CC0 models from NASA/Sketchfab later.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const { join } = path;

// Arrow shape: 5 vertices forming a simple delta-wing silhouette
// Pointing along +Y axis (forward), symmetric around Y axis
const positions = new Float32Array([
  // Nose
  0, 1, 0,
  // Left wing tip
  -0.5, -0.5, 0,
  // Left fuselage
  -0.1, -0.8, 0,
  // Right fuselage
  0.1, -0.8, 0,
  // Right wing tip
  0.5, -0.5, 0,
]);

// 3 triangles forming the arrow
const indices = new Uint16Array([
  0, 1, 2,  // Left wing
  0, 2, 3,  // Center body
  0, 3, 4,  // Right wing
]);

function createGlb() {
  const positionBuffer = Buffer.from(positions.buffer);
  const indexBuffer = Buffer.from(indices.buffer);

  // Pad to 4-byte alignment
  const posByteLength = positionBuffer.length;
  const idxByteLength = indexBuffer.length;
  const idxPadding = (4 - (idxByteLength % 4)) % 4;

  const totalBufferLength = posByteLength + idxByteLength + idxPadding;
  const binBuffer = Buffer.alloc(totalBufferLength);
  positionBuffer.copy(binBuffer, 0);
  indexBuffer.copy(binBuffer, posByteLength);

  const gltf = {
 asset: { version: '2.0', generator: 'crystalball-placeholder' },
 scene: 0,
 scenes: [{ nodes: [0] }],
 nodes: [{ mesh: 0 }],
 meshes: [{
 primitives: [{
 attributes: { POSITION: 0 },
 indices: 1,
 mode: 4, // TRIANGLES
 }],
 }],
 accessors: [
 {
 bufferView: 0,
 componentType: 5126, // FLOAT
 count: 5,
 type: 'VEC3',
 max: [0.5, 1, 0],
 min: [-0.5, -0.8, 0],
 },
 {
 bufferView: 1,
 componentType: 5123, // UNSIGNED_SHORT
 count: 9,
 type: 'SCALAR',
 max: [4],
 min: [0],
 },
 ],
 bufferViews: [
 {
 buffer: 0,
 byteOffset: 0,
 byteLength: posByteLength,
 target: 34_962, // ARRAY_BUFFER
 },
 {
 buffer: 0,
 byteOffset: posByteLength,
 byteLength: idxByteLength,
 target: 34_963, // ELEMENT_ARRAY_BUFFER
 },
 ],
 buffers: [{ byteLength: totalBufferLength }],
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonBuffer = Buffer.from(jsonStr);
  const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
  const paddedJsonBuffer = Buffer.alloc(jsonBuffer.length + jsonPadding, 0x20); // pad with spaces
  jsonBuffer.copy(paddedJsonBuffer);

  // GLB header: magic(4) + version(4) + length(4) = 12
  // JSON chunk: length(4) + type(4) + data
  // BIN chunk: length(4) + type(4) + data
  const headerLength = 12;
  const jsonChunkLength = 8 + paddedJsonBuffer.length;
  const binChunkLength = 8 + totalBufferLength;
  const totalLength = headerLength + jsonChunkLength + binChunkLength;

  const glb = Buffer.alloc(totalLength);
  let offset = 0;

  // Header
  glb.writeUInt32LE(0x46_54_6C_67, offset); offset += 4; // magic "glTF"
  glb.writeUInt32LE(2, offset); offset += 4; // version
  glb.writeUInt32LE(totalLength, offset); offset += 4;  // total length

  // JSON chunk
  glb.writeUInt32LE(paddedJsonBuffer.length, offset); offset += 4;
  glb.writeUInt32LE(0x4E_4F_53_4A, offset); offset += 4; // "JSON"
  paddedJsonBuffer.copy(glb, offset); offset += paddedJsonBuffer.length;

  // BIN chunk
  glb.writeUInt32LE(totalBufferLength, offset); offset += 4;
  glb.writeUInt32LE(0x00_4E_49_42, offset); offset += 4; // "BIN\0"
  binBuffer.copy(glb, offset);

  return glb;
}

const modelsDir = join(process.cwd(), 'public', 'models', 'aircraft');
mkdirSync(modelsDir, { recursive: true });

const modelFiles = [
  'f16.glb', 'f35.glb', 'b52.glb', 'c17.glb', 'c130.glb',
  'kc135.glb', 'e3.glb', 'blackhawk.glb', 'apache.glb', 'mq9.glb',
  'b737.glb', 'a320.glb', 'generic-widebody.glb',
  'generic-jet.glb', 'generic-arrow.glb',
];

const glb = createGlb();

for (const file of modelFiles) {
  const path = join(modelsDir, file);
  writeFileSync(path, glb);
  console.log(`  Created ${file} (${glb.length} bytes)`);
}

console.log(`\nGenerated ${modelFiles.length} placeholder models.`);
