import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveFrameUrl, needsFrameResolve } from '../frame-resolver.ts';

function stubFetch(impl: (url: string) => { ok: boolean; json?: () => Promise<unknown> }): () => void {
  const orig = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = ((url: string) => Promise.resolve(impl(url))) as typeof fetch;
  return () => { (globalThis as unknown as { fetch: unknown }).fetch = orig; };
}

test('absolute https URLs are returned unchanged (no resolve step)', async () => {
  const u = 'https://cwwp2.dot.ca.gov/data/d10/cctv/image/x.jpg';
  assert.equal(await resolveFrameUrl(u), u);
  assert.equal(needsFrameResolve(u), false);
});

test('empty / missing snapshotUrl resolves to null', async () => {
  assert.equal(await resolveFrameUrl(undefined), null);
  assert.equal(await resolveFrameUrl(''), null);
});

test('relative /api/ resolver returns the JSON imageUrl', async () => {
  assert.equal(needsFrameResolve('/api/faa-camera-image?cameraId=11526'), true);
  const restore = stubFetch(() => ({ ok: true, json: () => Promise.resolve({ imageUrl: 'https://images.wcams-static.faa.gov/x.jpg', frames: [] }) }));
  try {
    assert.equal(await resolveFrameUrl('/api/faa-camera-image?cameraId=11526'), 'https://images.wcams-static.faa.gov/x.jpg');
  } finally { restore(); }
});

test('falls back to frames[0].imageUrl when imageUrl is absent', async () => {
  const restore = stubFetch(() => ({ ok: true, json: () => Promise.resolve({ frames: [{ imageUrl: 'https://f/first.jpg' }] }) }));
  try {
    assert.equal(await resolveFrameUrl('/api/faa-camera-image?cameraId=1'), 'https://f/first.jpg');
  } finally { restore(); }
});

test('degraded upstream (imageUrl null, no frames) → null, not a broken src', async () => {
  const restore = stubFetch(() => ({ ok: true, json: () => Promise.resolve({ imageUrl: null, frames: [], degraded: true }) }));
  try {
    assert.equal(await resolveFrameUrl('/api/faa-camera-image?cameraId=1'), null);
  } finally { restore(); }
});

test('non-ok response resolves to null', async () => {
  const restore = stubFetch(() => ({ ok: false }));
  try {
    assert.equal(await resolveFrameUrl('/api/faa-camera-image?cameraId=1'), null);
  } finally { restore(); }
});
