import { strict as assert } from 'node:assert';
import test from 'node:test';
import { validateApiKey } from './_api-key.js';

function makeRequest(headersInit = {}) {
  return new Request('https://crystalball.app/api/test', {
 headers: new Headers(headersInit),
  });
}

test('rejects trusted referer without browser fetch metadata', () => {
  const result = validateApiKey(makeRequest({
 Referer: 'https://crystalball.app/dashboard',
  }));

  assert.equal(result.valid, false);
  assert.equal(result.required, true);
  assert.match(result.error || '', /API key required/);
});

test('rejects missing Origin even when referer and browser fetch metadata are present', () => {
  const result = validateApiKey(makeRequest({
 Referer: 'https://crystalball.app/dashboard',
 'Sec-Fetch-Site': 'same-origin',
 'Sec-Fetch-Mode': 'cors',
  }));

  assert.equal(result.valid, false);
  assert.equal(result.required, true);
  assert.match(result.error || '', /API key required/);
});

test('allows trusted browser origin when fetch metadata is present', () => {
  const result = validateApiKey(makeRequest({
 Origin: 'https://crystalball.app',
 'Sec-Fetch-Site': 'same-origin',
 'Sec-Fetch-Mode': 'cors',
  }));

  assert.equal(result.valid, true);
  assert.equal(result.required, false);
});

test('allows enumerated crystalball.app subdomains', () => {
  for (const subdomain of ['tech', 'finance', 'happy', 'api']) {
 const result = validateApiKey(makeRequest({
 Origin: `https://${subdomain}.crystalball.app`,
 'Sec-Fetch-Site': 'same-site',
 'Sec-Fetch-Mode': 'cors',
 }));
 assert.equal(result.valid, true, `should allow ${subdomain}.crystalball.app`);
  }
});

test('allows bare crystalball.app origin', () => {
  const result = validateApiKey(makeRequest({
 Origin: 'https://crystalball.app',
 'Sec-Fetch-Site': 'same-origin',
 'Sec-Fetch-Mode': 'cors',
  }));
  assert.equal(result.valid, true);
});

test('rejects non-enumerated crystalball.app subdomains', () => {
  const result = validateApiKey(makeRequest({
 Origin: 'https://evil.crystalball.app',
 'Sec-Fetch-Site': 'same-site',
 'Sec-Fetch-Mode': 'cors',
  }));
  assert.equal(result.valid, false);
});

test('allows Vercel preview deploy origins', () => {
  const validPreviews = [
 'https://crystalball-my-branch-bradleybond512.vercel.app',
 'https://crystal-ball-fix-123-bradleybond512.vercel.app',
 'https://crystalball-pr-42-elie-abc123.vercel.app',
  ];
  for (const origin of validPreviews) {
 const result = validateApiKey(makeRequest({
 Origin: origin,
 'Sec-Fetch-Site': 'same-site',
 'Sec-Fetch-Mode': 'cors',
 }));
 assert.equal(result.valid, true, `should allow ${origin}`);
  }
});

test('rejects unrelated third-party Vercel projects that share the crystal-ball prefix', () => {
  const invalidPreviews = [
 'https://crystalball-anyproject.vercel.app',
 'https://crystalball-evilorg.vercel.app',
 'https://crystal-ball-foo.vercel.app',
  ];
  for (const origin of invalidPreviews) {
 const result = validateApiKey(makeRequest({
 Origin: origin,
 'Sec-Fetch-Site': 'same-site',
 'Sec-Fetch-Mode': 'cors',
 }));
 assert.equal(result.valid, false, `should reject ${origin}`);
  }
});

test('rejects origins with wrong protocol or port tricks', () => {
  const invalid = [
 'http://crystalball.app',
 'https://crystalball.app.evil.com',
  ];
  for (const origin of invalid) {
 const result = validateApiKey(makeRequest({
 Origin: origin,
 'Sec-Fetch-Site': 'same-site',
 'Sec-Fetch-Mode': 'cors',
 }));
 assert.equal(result.valid, false, `should reject ${origin}`);
  }
});

test('requires API key for trusted browser non-read requests', () => {
  const request = new Request('https://crystalball.app/api/news/v1/summarize-article', {
 method: 'POST',
 headers: new Headers({
 Origin: 'https://crystalball.app',
 'Sec-Fetch-Site': 'same-origin',
 'Sec-Fetch-Mode': 'cors',
 'Content-Type': 'application/json',
 }),
 body: JSON.stringify({ headlines: ['a', 'b'] }),
  });
  const result = validateApiKey(request);

  assert.equal(result.valid, false);
  assert.equal(result.required, true);
  assert.match(result.error || '', /non-read requests/i);
});
