import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveWebcamPick } from '../webcam-pick.ts';
import type { WebcamFeed } from '../webcam-types.ts';

function feed(over: Partial<WebcamFeed> = {}): WebcamFeed {
  return {
    id: 'HAZECAM:acadia', source: 'HAZECAM', name: 'Acadia', lat: 44.377, lon: -68.261,
    snapshotUrl: 'https://hazecam.net/images/large/acadia_left.jpg', refreshIntervalSec: 600,
    category: 'nature', metadata: {}, ...over,
  };
}

const byId = new Map<string, WebcamFeed>([['HAZECAM:acadia', feed()]]);

test('resolveWebcamPick: a clustered pin (array of entities) routes to zoom', () => {
  const r = resolveWebcamPick([{ id: 'a' }, { id: 'b' }], byId);
  assert.equal(r?.kind, 'cluster');
  assert.equal((r as { entities: unknown[] }).entities.length, 2);
});

test('resolveWebcamPick: an individual pin with a known feed routes to select', () => {
  const r = resolveWebcamPick({ id: 'HAZECAM:acadia' }, byId);
  assert.equal(r?.kind, 'feed');
  assert.equal((r as { feed: WebcamFeed }).feed.id, 'HAZECAM:acadia');
});

test('resolveWebcamPick: an individual pin with an unknown id is a miss (no dead-click zoom)', () => {
  assert.equal(resolveWebcamPick({ id: 'NPS:unknown' }, byId), null);
});

test('resolveWebcamPick: non-object / non-string-id picks are misses', () => {
  assert.equal(resolveWebcamPick(undefined, byId), null);
  assert.equal(resolveWebcamPick('HAZECAM:acadia', byId), null); // bare string, not an entity
  assert.equal(resolveWebcamPick({ id: 42 }, byId), null);
  assert.equal(resolveWebcamPick({}, byId), null);
});

test('resolveWebcamPick: cluster check wins even if the array is empty', () => {
  const r = resolveWebcamPick([], byId);
  assert.equal(r?.kind, 'cluster');
});
