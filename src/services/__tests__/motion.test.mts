import assert from 'node:assert/strict';
import test from 'node:test';

// Stub the DOM bits the motion module touches at import / call time.
class StubElement {
  textContent = '';
}

const stubBody = { classList: { contains: () => false } };
const stubDoc = { body: stubBody };
const stubMql = { matches: false };
const stubWindow = { matchMedia: () => stubMql };

(globalThis as unknown as { window: typeof stubWindow }).window = stubWindow;
(globalThis as unknown as { document: typeof stubDoc }).document = stubDoc;
(globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = ((cb: FrameRequestCallback) => {
  cb(performance.now() + 16);
  return 0;
}) as typeof requestAnimationFrame;

const { prefersReducedMotion, animateNumber } = await import('../motion');

test('prefersReducedMotion returns false when neither media query nor body class indicates reduced motion', () => {
  stubMql.matches = false;
  stubBody.classList.contains = () => false;
  assert.equal(prefersReducedMotion(), false);
});

test('prefersReducedMotion respects the prefers-reduced-motion media query', () => {
  stubMql.matches = true;
  stubBody.classList.contains = () => false;
  assert.equal(prefersReducedMotion(), true);
  stubMql.matches = false;
});

test('prefersReducedMotion respects the body.animations-paused class', () => {
  stubMql.matches = false;
  stubBody.classList.contains = (c: string) => c === 'animations-paused';
  assert.equal(prefersReducedMotion(), true);
  stubBody.classList.contains = () => false;
});

test('animateNumber writes the final value immediately when reduced motion is active', () => {
  stubMql.matches = true;
  const el = new StubElement();
  animateNumber(el as unknown as Element, 0, 42);
  assert.equal(el.textContent, '42');
  stubMql.matches = false;
});

test('animateNumber is a no-op when from === to', () => {
  const el = new StubElement();
  el.textContent = 'untouched';
  animateNumber(el as unknown as Element, 7, 7);
  assert.equal(el.textContent, '7');
});
