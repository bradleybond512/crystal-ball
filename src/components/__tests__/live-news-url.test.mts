import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { youtubeWatchUrl } from '../live-news-url';

const HOME = 'https://www.youtube.com/';
test('prefers a valid video ID over the channel handle', () => {
  assert.equal(youtubeWatchUrl({ videoId: 'aB1yRz0HhdY', handle: '@NASA' }), `${HOME}watch?v=aB1yRz0HhdY`);
});
test('all configured handles remain exact channel paths', () => {
  const source = readFileSync(new URL('../LiveNewsPanel.ts', import.meta.url), 'utf8');
  const handles = [...source.matchAll(/handle: '([^']+)'/g)].map(match => match[1]!);
  assert.ok(handles.length > 40);
  for (const handle of handles) {
    const url = new URL(youtubeWatchUrl({ handle }));
    assert.equal(url.origin, 'https://www.youtube.com');
    assert.equal(decodeURIComponent(url.pathname), `/${handle}`);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  }
});
test('unsafe and malformed handles cannot become channel paths', () => {
  for (const handle of [undefined, null, 1, {}, '', '@', '@a/b', '@a\\b', '..', '@../x',
    'https://evil.example', '//evil.example', 'javascript:alert(1)', 'data:text/html,x',
    '@a?next=evil', '@a#fragment', '@a%2fb', '@a%252fb', '@a" onclick="alert(1)',
    '@a<img src=x>', '@a b', '@a\n', '@a\t', '@a\0', '@a\ud800', 'NASA', '@@NASA', '@' + 'a'.repeat(101)]) {
    assert.equal(youtubeWatchUrl({ handle }), HOME, String(handle));
  }
});
test('invalid external video IDs fall back safely to a valid handle', () => {
  for (const videoId of [undefined, null, 1, {}, '', 'short', 'aB1yRz0HhdYx', 'aB1yRz0Hhd"',
    'javascript:', '//evil.test', 'abc?x=y&z=w', '\ud800', 'aB1yRz0HhdY\n', 'aB1yRz0Hhd\n']) {
    assert.equal(youtubeWatchUrl({ videoId, handle: '@NASA' }), `${HOME}@NASA`, String(videoId));
  }
});
test('invalid inputs fail closed without mutating stored channel data', () => {
  const input = Object.freeze({ videoId: '" onmouseover="x', handle: '//evil.example' });
  assert.equal(youtubeWatchUrl(input), HOME);
  assert.equal(input.handle, '//evil.example');
});
test('encodes Unicode path components and keeps valid punctuation', () => {
  assert.equal(youtubeWatchUrl({ handle: '@中天新聞CtiNews' }), `${HOME}@%E4%B8%AD%E5%A4%A9%E6%96%B0%E8%81%9ECtiNews`);
  assert.equal(youtubeWatchUrl({ handle: '@Cafe\u0301-News_1.2' }), `${HOME}@Cafe%CC%81-News_1.2`);
  assert.equal(youtubeWatchUrl({ handle: '@' + 'a'.repeat(100) }), `${HOME}@${'a'.repeat(100)}`);
});
