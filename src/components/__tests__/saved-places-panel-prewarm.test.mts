import assert from 'node:assert/strict';
import test from 'node:test';

import '../../../tests/panels/setup-dom.mts';
import '../../../tests/panels/register-hook.mjs';

const { SavedPlacesPanel } = await import('../SavedPlacesPanel.ts');

test('prewarm announcements keep one stable live-region node across refreshes', () => {
  const panel = new SavedPlacesPanel({ focusPlace: () => {} });
  document.body.append(panel.getElement());
  const first = panel.getContentElement().querySelector('[aria-live="polite"]');
  assert.ok(first);

  panel.refresh();
  const second = panel.getContentElement().querySelector('[aria-live="polite"]');

  assert.ok(second === first, 'refresh should move the same live-region node');
  assert.equal(panel.getContentElement().querySelectorAll('[aria-live="polite"]').length, 1);
  panel.destroy();
});
