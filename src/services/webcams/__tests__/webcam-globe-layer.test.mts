import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Entity } from 'cesium';
import { configureWebcamCluster } from '../webcam-globe-layer.ts';
import { resolveWebcamPick } from '../webcam-pick.ts';

test('visible Cesium cluster point carries the entities used by click routing', () => {
  const entities = [new Entity({ id: 'cam-a' }), new Entity({ id: 'cam-b' })];
  const point: { id?: unknown } & Record<string, unknown> = {};
  const cluster = { billboard: {}, label: {}, point };

  configureWebcamCluster(entities, cluster as never);

  assert.equal(point.id, entities);
  assert.equal(resolveWebcamPick(point.id, new Map())?.kind, 'cluster');
});

test('GlobeWebcamLayer wires cluster presentation and picked ids into click routing', () => {
  const source = readFileSync(new URL('../webcam-globe-layer.ts', import.meta.url), 'utf8');
  assert.match(source, /clusterEvent\.addEventListener\(configureWebcamCluster\)/);
  assert.match(source, /resolveWebcamPick\(entityId, this\.feedById\)/);
});
