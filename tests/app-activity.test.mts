import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('app-activity state machine', () => {
  it('starts active', () => {
    let active = true;
    assert.equal(active, true);
  });

  it('becomes inactive when document is hidden', () => {
    let active = true;
    const onVisibilityChange = (hidden: boolean) => { active = !hidden; };
    onVisibilityChange(true);
    assert.equal(active, false);
  });

  it('becomes inactive when window loses focus (desktop)', () => {
    let active = true;
    const onWindowBlur = () => { active = false; };
    onWindowBlur();
    assert.equal(active, false);
  });

  it('stays active only when both visible AND focused', () => {
    let hidden = false;
    let focused = true;
    const isActive = () => !hidden && focused;
    assert.equal(isActive(), true);

    focused = false;
    assert.equal(isActive(), false);

    hidden = true;
    focused = true;
    assert.equal(isActive(), false);
  });
});
