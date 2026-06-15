// Tests for the /api/webhook-dispatch request validator. Renderer webhook
// delivery now routes through the sidecar (not a direct renderer fetch) so it
// survives the tightened CSP connect-src; the sidecar validates the target with
// isSafeUrl() + pins the IP (SSRF). parseWebhookDispatchRequest() is the pure
// input-shaping gate that runs before any network call.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { parseWebhookDispatchRequest } from '../local-api-server.mjs';

test('accepts a well-formed request with url + body', () => {
  const r = parseWebhookDispatchRequest({ url: 'https://hooks.example.com/x', body: '{"text":"hi"}' });
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://hooks.example.com/x');
  assert.equal(r.body, '{"text":"hi"}');
  assert.equal(r.secret, undefined);
});

test('passes through an optional string secret', () => {
  const r = parseWebhookDispatchRequest({ url: 'https://h/x', body: '{}', secret: 's3cr3t' });
  assert.equal(r.ok, true);
  assert.equal(r.secret, 's3cr3t');
});

test('drops a non-string secret rather than forwarding garbage', () => {
  const r = parseWebhookDispatchRequest({ url: 'https://h/x', body: '{}', secret: 123 });
  assert.equal(r.ok, true);
  assert.equal(r.secret, undefined);
});

test('rejects a missing or non-string url', () => {
  assert.equal(parseWebhookDispatchRequest({ body: '{}' }).ok, false);
  assert.equal(parseWebhookDispatchRequest({ url: '', body: '{}' }).ok, false);
  assert.equal(parseWebhookDispatchRequest({ url: 42, body: '{}' }).ok, false);
});

test('rejects a missing or non-string body', () => {
  assert.equal(parseWebhookDispatchRequest({ url: 'https://h/x' }).ok, false);
  assert.equal(parseWebhookDispatchRequest({ url: 'https://h/x', body: { a: 1 } }).ok, false);
});

test('rejects non-object input', () => {
  assert.equal(parseWebhookDispatchRequest(null).ok, false);
  assert.equal(parseWebhookDispatchRequest(undefined).ok, false);
  assert.equal(parseWebhookDispatchRequest('string').ok, false);
});

test('a rejected request carries a string error reason', () => {
  const r = parseWebhookDispatchRequest({ body: '{}' });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, 'string');
});
