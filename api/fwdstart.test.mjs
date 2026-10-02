import { strict as assert } from 'node:assert';
import test from 'node:test';
import { parseArchiveItems, renderRss } from './fwdstart.js';

const NOW = new Date('2026-10-01T12:00:00Z');

function slide({ href = '/p/first-post', alt = 'A useful post title', date = 'Sep 30, 2026', subtitle = 'A subtitle long enough to be kept as text' } = {}) {
  return `embla__slide"><a href="${href}"><img alt="${alt}"></a><time>${date}</time><div class="line-clamp-3"><span>${subtitle}</span></div>`;
}

test('parses unique items with dates and descriptions', () => {
  const html = slide() + slide() + slide({ href: '/p/second', alt: 'Second post title', date: 'no date' });
  const items = parseArchiveItems(html, NOW);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: 'A useful post title',
    link: 'https://www.fwdstart.me/p/first-post',
    date: new Date('Sep 30, 2026').toISOString(),
    description: 'A subtitle long enough to be kept as text',
  });
  assert.equal(items[1].date, NOW.toISOString());
});

test('skips blocks without a post link or with a short title', () => {
  assert.deepEqual(parseArchiveItems(slide({ href: '/x/not-a-post' }) + slide({ alt: 'tiny' }), NOW), []);
});

test('scraped values cannot break out of CDATA or elements', () => {
  const xml = renderRss([{
    title: 'evil ]]><script>alert(1)</script>',
    link: 'https://www.fwdstart.me/p/a<b>&"',
    date: NOW.toISOString(),
    description: 'x ]]><img src=x onerror=alert(1)>',
  }], 'https://bradleybond512.github.io/api/fwdstart?a=1&b=<2>', NOW);
  assert.doesNotMatch(xml, /\]\]><script>|\]\]><img/);
  assert.match(xml, /<title><!\[CDATA\[evil \]\]\]\]><!\[CDATA\[><script>alert\(1\)<\/script>\]\]><\/title>/);
  assert.match(xml, /<link>https:\/\/www\.fwdstart\.me\/p\/a&lt;b&gt;&amp;&quot;<\/link>/);
  assert.match(xml, /<atom:link href="https:\/\/bradleybond512\.github\.io\/api\/fwdstart\?a=1&amp;b=&lt;2&gt;"/);
});

test('caps the feed at 30 items', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ title: `Title ${i}`, link: `https://www.fwdstart.me/p/${i}`, date: NOW.toISOString(), description: '' }));
  assert.equal(renderRss(items, 'https://bradleybond512.github.io/api/fwdstart', NOW).match(/<item>/g).length, 30);
});
