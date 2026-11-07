import assert from 'node:assert/strict';
import test from 'node:test';
import '../../../tests/panels/register-hook.mjs';
import { happyWindow, POST_MOUNT_ERRORS } from '../../../tests/panels/setup-dom.mts';
import { LiveNewsPanel, type LiveChannel } from '../LiveNewsPanel';

// Exercise the real output methods without constructing a player or invoking providers.
type ErrorSurface = {
  content: HTMLElement;
  activeChannel: LiveChannel;
  destroyPlayer(): void;
  showEmbedError(channel: LiveChannel, code: number): void;
  showBotCheckPrompt(): void;
};
const render = (method: 'showEmbedError' | 'showBotCheckPrompt', channel: LiveChannel) => {
  const panel = Object.create(LiveNewsPanel.prototype) as ErrorSurface;
  panel.content = document.createElement('div');
  panel.activeChannel = channel;
  panel.destroyPlayer = () => {};
  if (method === 'showEmbedError') panel.showEmbedError(channel, 101);
  else panel.showBotCheckPrompt();
  return panel.content;
};
for (const method of ['showEmbedError', 'showBotCheckPrompt'] as const) {
  test(`${method} rejects markup and unsafe destination components`, () => {
    const content = render(method, { id: 'custom', name: 'Custom', handle: '@bad" onclick="alert(1)' });
    assert.equal(content.querySelectorAll('[onclick]').length, 0);
    for (const a of content.querySelectorAll('a')) assert.equal(a.href, 'https://www.youtube.com/');
  });
  test(`${method} fails closed for malformed persisted handles and preserves valid video links`, () => {
    for (const handle of ['//evil.example', '@a/b', '@a?x=y', '@a#fragment', '@a\\b', '@a%2fb', '@a\ud800', '@a\n']) {
      const content = render(method, { id: 'custom', name: 'Custom', handle });
      const a = content.querySelector('a');
      assert.ok(a);
      assert.equal(a.href, 'https://www.youtube.com/');
      assert.equal(content.querySelectorAll('script, img, [onclick]').length, 0);
      if (method === 'showBotCheckPrompt') {
        assert.ok(content.querySelector('.bot-check-signin'));
        assert.ok(content.querySelector('.bot-check-retry'));
      }
    }
    const content = render(method, { id: 'video', name: 'Video', handle: '//evil.example', videoId: 'aB1yRz0HhdY' });
    assert.equal(content.querySelector('a')?.href, 'https://www.youtube.com/watch?v=aB1yRz0HhdY');
  });
  test(`${method} preserves the configured Unicode channel destination`, () => {
    const content = render(method, { id: 'cti', name: 'News', handle: '@中天新聞CtiNews' });
    const a = content.querySelector('a');
    assert.ok(a);
    assert.equal(new URL(a.href).origin, 'https://www.youtube.com');
    assert.equal(decodeURIComponent(new URL(a.href).pathname), '/@中天新聞CtiNews');
    assert.equal(a.target, '_blank');
    assert.equal(a.rel, 'noopener noreferrer');
  });
}
test.after(async () => { assert.deepEqual(POST_MOUNT_ERRORS, []); await happyWindow.happyDOM.close(); });
