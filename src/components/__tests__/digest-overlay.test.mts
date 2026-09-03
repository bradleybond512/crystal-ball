import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
Object.assign(globalThis as unknown as Record<string, unknown>, {
  window: happyWindow,
  document: happyWindow.document,
  HTMLElement: happyWindow.HTMLElement,
  HTMLButtonElement: happyWindow.HTMLButtonElement,
  Element: happyWindow.Element,
  Node: happyWindow.Node,
  Event: happyWindow.Event,
  MouseEvent: happyWindow.MouseEvent,
  KeyboardEvent: happyWindow.KeyboardEvent,
  CustomEvent: happyWindow.CustomEvent,
});

const { DigestOverlay } = await import('../DigestOverlay.ts');
const mountedOverlays: InstanceType<typeof DigestOverlay>[] = [];

interface DigestStoryCard {
  id: string;
  alertIds: string[];
  headline: string;
  narrative: string;
  locationText: string;
  impactText: string;
  impactStatus: 'likely' | 'possible' | 'no_reported_overlap' | 'unknown' | 'not_evaluated';
  evaluatedAt: number;
}

function card(overrides: Partial<DigestStoryCard> = {}): DigestStoryCard {
  return {
    id: 'story-1',
    alertIds: ['alert-1'],
    headline: 'Red Flag Warning',
    narrative: 'Dry fuels and winds increase fire danger.',
    locationText: 'Location: Test County (NWS alert area).',
    impactText: 'Saved-place impact: Possible — Home is near the reported alert area.',
    impactStatus: 'possible',
    evaluatedAt: Date.parse('2026-09-03T12:00:00.000Z'),
    ...overrides,
  };
}

function mount(): InstanceType<typeof DigestOverlay> {
  const overlay = new DigestOverlay();
  overlay.mount(document.body);
  mountedOverlays.push(overlay);
  return overlay;
}

function root(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.digest-overlay');
  assert.ok(element, 'digest overlay must be mounted');
  return element;
}

function showCards(overlay: InstanceType<typeof DigestOverlay>, cards: DigestStoryCard[]): void {
  assert.doesNotThrow(
    () => overlay.show(cards as never),
    'DigestOverlay.show must accept structured locally projected cards',
  );
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  for (const overlay of mountedOverlays.splice(0)) overlay.destroy();
});

test('overlay is a labeled modal dialog with an accessible close control', () => {
  mount();
  const overlay = root();
  const title = overlay.querySelector('h2');
  const close = overlay.querySelector<HTMLButtonElement>('.digest-close');

  assert.equal(overlay.getAttribute('role'), 'dialog');
  assert.equal(overlay.getAttribute('aria-modal'), 'true');
  assert.ok(title?.id, 'dialog heading needs a stable id');
  assert.equal(overlay.getAttribute('aria-labelledby'), title?.id);
  assert.equal(close?.getAttribute('aria-label'), 'Close since-you-last-looked brief');
});

test('every structured story is an article with mandatory local location and impact rows', () => {
  const overlay = mount();
  showCards(overlay, [card(), card({ id: 'story-2', alertIds: ['alert-2'], impactStatus: 'unknown' })]);

  const articles = root().querySelectorAll('article');
  assert.equal(articles.length, 2);
  for (const article of articles) {
    assert.ok(article.querySelector('h3'), 'each story needs its own heading');
    assert.match(article.querySelector('[data-digest-location]')?.textContent ?? '', /^Location:/);
    assert.match(article.querySelector('[data-digest-impact]')?.textContent ?? '', /^Saved-place impact:/);
  }
  assert.equal(root().querySelector('[aria-live="polite"]') !== null, true, 'local reprojections need polite announcement');
});

test('provider and model HTML-like text stays inert', () => {
  const overlay = mount();
  showCards(overlay, [card({
    headline: '<img src=x onerror="globalThis.pwned=true">',
    narrative: '<script>globalThis.pwned=true</script>',
    locationText: 'Location: <svg onload="globalThis.pwned=true">.',
    impactText: 'Saved-place impact: Unknown — <b>untrusted</b>.',
  })]);

  assert.equal(root().querySelector('img, script, svg, b'), null);
  assert.match(root().textContent ?? '', /<img src=x/);
  assert.match(root().textContent ?? '', /<script>/);
  assert.match(root().textContent ?? '', /<svg onload/);
  assert.match(root().textContent ?? '', /<b>untrusted<\/b>/);
});

test('show moves focus into the dialog and Tab remains trapped', () => {
  const opener = document.createElement('button');
  opener.textContent = 'Open digest';
  document.body.append(opener);
  opener.focus();
  const overlay = mount();
  showCards(overlay, [card()]);
  const close = root().querySelector<HTMLButtonElement>('.digest-close');

  assert.equal(document.activeElement, close, 'focus should enter at the close control');
  close?.dispatchEvent(new happyWindow.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  assert.equal(document.activeElement, close, 'Shift+Tab may not escape a one-control dialog');
  close?.dispatchEvent(new happyWindow.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(document.activeElement, close, 'Tab may not escape a one-control dialog');
});

test('hide restores the element focused before the dialog opened', () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const overlay = mount();
  showCards(overlay, [card()]);
  overlay.hide();

  assert.equal(document.activeElement, opener);
});

test('user dismissal notifies the owner after hiding the overlay', () => {
  let dismissals = 0;
  const OverlayWithDismiss = DigestOverlay as unknown as new (
    options: { onDismiss: () => void },
  ) => InstanceType<typeof DigestOverlay>;
  const overlay = new OverlayWithDismiss({ onDismiss: () => { dismissals += 1; } });
  overlay.mount(document.body);
  mountedOverlays.push(overlay);
  showCards(overlay, [card()]);

  root().querySelector<HTMLButtonElement>('.digest-close')?.click();

  assert.equal(root().hidden, true, 'dismissal must hide before notifying the owner');
  assert.equal(dismissals, 1, 'one user dismissal must invalidate one pending request');
});

test('destroying a visible overlay tears down without reporting a user dismissal', () => {
  let dismissals = 0;
  const overlay = new DigestOverlay({ onDismiss: () => { dismissals += 1; } });
  overlay.mount(document.body);
  mountedOverlays.push(overlay);
  showCards(overlay, [card()]);

  overlay.destroy();

  assert.equal(dismissals, 0);
  assert.equal(document.querySelector('.digest-overlay'), null);
});

test('Escape, close, and backdrop retain dismissal behavior', async (t) => {
  await t.test('Escape', () => {
    mount();
    root().hidden = false;
    document.dispatchEvent(new happyWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(root().hidden, true);
  });

  document.body.replaceChildren();
  await t.test('close button', () => {
    mount();
    root().hidden = false;
    root().querySelector<HTMLButtonElement>('.digest-close')?.click();
    assert.equal(root().hidden, true);
  });

  document.body.replaceChildren();
  await t.test('backdrop', () => {
    mount();
    root().hidden = false;
    root().dispatchEvent(new happyWindow.MouseEvent('click', { bubbles: true }));
    assert.equal(root().hidden, true);
  });
});
