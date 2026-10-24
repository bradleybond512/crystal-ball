import assert from 'node:assert/strict';
import test from 'node:test';
import handler from './story.js';

test('retired public story route never redirects users or advertises crawler links', () => {
  for (const userAgent of ['Mozilla/5.0', 'Twitterbot', 'Slackbot']) {
    const headers = {};
    let status;
    let body;
    const response = {
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      status(value) { status = value; return this; },
      send(value) { body = value; },
      writeHead() { assert.fail('a disabled story must never redirect'); },
    };
    handler({ url: '/api/story?c=US&t=brief', headers: { 'user-agent': userAgent } }, response);
    assert.equal(status, 410);
    assert.equal(headers.location, undefined);
    assert.equal(headers['cache-control'], 'no-store');
    assert.doesNotMatch(body, /https?:\/\/|crystalball[.]app/i);
  }
});
