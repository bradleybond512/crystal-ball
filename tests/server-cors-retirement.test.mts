import assert from 'node:assert/strict';
import test from 'node:test';
import { getCorsHeaders, isDisallowedOrigin } from '../server/cors';

test('server CORS rejects retired origins and supplies no permissive fallback', () => {
  for (const origin of [
    'https://crystalball.app', 'https://tech.crystalball.app',
    'https://finance.crystalball.app', 'https://happy.crystalball.app',
    'https://api.crystalball.app', 'https://CRYSTALBALL.APP.',
    'https://other.crystalball.app', 'null',
  ]) {
    const request = new Request('http://localhost/api/test', { headers: { Origin: origin } });
    assert.equal(isDisallowedOrigin(request), true, origin);
    assert.equal(getCorsHeaders(request)['Access-Control-Allow-Origin'], undefined, origin);
  }
});

test('server CORS retains the existing Tauri and anchored preview origins', () => {
  for (const origin of ['tauri://localhost', 'https://crystalball-main-bradleybond512.vercel.app']) {
    const request = new Request('http://localhost/api/test', { headers: { Origin: origin } });
    assert.equal(isDisallowedOrigin(request), false, origin);
    assert.equal(getCorsHeaders(request)['Access-Control-Allow-Origin'], origin);
  }
});
