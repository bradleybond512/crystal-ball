import { strict as assert } from 'node:assert';
import test from 'node:test';
import handler from './og-story.js';

function renderOgStory(query = '', requestPath = 'https://crystalball.app/api/og-story') {
  const req = {
 url: `${requestPath}${query ? `?${query}` : ''}`,
 headers: { host: 'crystalball.app' },
  };

  let statusCode = 0;
  let body = '';
  const headers = {};

  const res = {
 setHeader(name, value) {
 headers[String(name).toLowerCase()] = String(value);
 },
 status(code) {
 statusCode = code;
 return this;
 },
 send(payload) {
 body = String(payload);
 },
  };

  handler(req, res);
  return { statusCode, body, headers };
}

test('normalizes unsupported level values to prevent SVG script injection', () => {
  const injectedLevel = encodeURIComponent('</text><script>alert(1)</script><text>');
  const response = renderOgStory(`c=US&s=50&l=${injectedLevel}`);

  assert.equal(response.statusCode, 200);
  assert.equal(/<script/i.test(response.body), false);
  assert.match(response.body, />NORMAL<\/text>/);
});

test('uses a known level when it is allowlisted', () => {
  const response = renderOgStory('c=US&s=88&l=critical');

  assert.equal(response.statusCode, 200);
  assert.match(response.body, />CRITICAL<\/text>/);
  assert.match(response.body, /#ef4444/);
});

test('relative request URLs render scored and overview SVGs without the retired watermark', () => {
  const cases = [
    { query: 'c=US&s=88&l=critical', hasArc: true, hasScore: true },
    { query: 'c=US&s=0&l=low', hasArc: false, hasScore: true },
    { query: 'c=US', hasArc: false, hasScore: false },
  ];

  for (const { query, hasArc, hasScore } of cases) {
    const response = renderOgStory(query, '/api/og-story');
    assert.equal(response.statusCode, 200, query);
    assert.equal(response.headers['content-type'], 'image/svg+xml', query);
    assert.match(response.body, /^<svg\s/, query);
    assert.match(response.body, />UNITED STATES<\/text>/, query);
    assert.match(response.body, />Crystal Ball · \d{4}-\d{2}-\d{2} · Free &amp; open source<\/text>/, query);
    assert.doesNotMatch(response.body, /crystalball[.]app/i, query);
    if (hasArc) {
      assert.match(response.body, /<!-- Arc fill -->\s*<path\b/, query);
    } else {
      assert.doesNotMatch(response.body, /<!-- Arc fill -->\s*<path\b/, query);
    }
    if (hasScore) {
      assert.match(response.body, />INSTABILITY INDEX<\/text>/, query);
    } else {
      assert.match(response.body, />Real-time intelligence analysis<\/text>/, query);
    }
  }
});
