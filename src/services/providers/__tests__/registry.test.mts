import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVIDERS_BY_DOMAIN,
  registerProvider,
  getProvider,
  getProvidersForDomain,
  getAllActiveProviders,
  rebuildProviderIndex,
  type ProviderDefinition,
} from '../registry.ts';

function clearRegistry(): void {
  for (const k of Object.keys(PROVIDERS_BY_DOMAIN)) {
    PROVIDERS_BY_DOMAIN[k as keyof typeof PROVIDERS_BY_DOMAIN].length = 0;
  }
  rebuildProviderIndex();
}

function fixture(overrides: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    id: 'test-' + Math.random().toString(36).slice(2, 8),
    domain: 'aviation',
    name: 'Test Provider',
    auth: 'none',
    baseUrl: 'https://example.test',
    ttlMs: 60_000,
    baselineWeight: 0.7,
    fallbackPriority: 0,
    lifecycle: 'active',
    ...overrides,
  };
}

test('registerProvider rejects out-of-range baselineWeight', () => {
  clearRegistry();
  assert.throws(() => registerProvider(fixture({ baselineWeight: -0.1 })));
  assert.throws(() => registerProvider(fixture({ baselineWeight: 1.5 })));
});

test('registerProvider rejects negative fallbackPriority', () => {
  clearRegistry();
  assert.throws(() => registerProvider(fixture({ fallbackPriority: -1 })));
});

test('registerProvider rejects duplicate id within a domain', () => {
  clearRegistry();
  registerProvider(fixture({ id: 'dup-1', domain: 'aviation' }));
  assert.throws(() => registerProvider(fixture({ id: 'dup-1', domain: 'aviation' })));
});

test('getProvider lookup hits providers from any domain', () => {
  clearRegistry();
  registerProvider(fixture({ id: 'av-1', domain: 'aviation' }));
  registerProvider(fixture({ id: 'cy-1', domain: 'cyber' }));
  assert.equal(getProvider('av-1')?.domain, 'aviation');
  assert.equal(getProvider('cy-1')?.domain, 'cyber');
  assert.equal(getProvider('missing'), undefined);
});

test('getProvidersForDomain orders by fallbackPriority then baselineWeight desc', () => {
  clearRegistry();
  registerProvider(fixture({ id: 'a', domain: 'aviation', fallbackPriority: 1, baselineWeight: 0.8 }));
  registerProvider(fixture({ id: 'b', domain: 'aviation', fallbackPriority: 0, baselineWeight: 0.5 }));
  registerProvider(fixture({ id: 'c', domain: 'aviation', fallbackPriority: 0, baselineWeight: 0.9 }));
  const order = getProvidersForDomain('aviation').map((p) => p.id);
  assert.deepEqual(order, ['c', 'b', 'a']);
});

test('getProvidersForDomain hides deprecated by default', () => {
  clearRegistry();
  registerProvider(fixture({ id: 'live', domain: 'aviation', lifecycle: 'active' }));
  registerProvider(fixture({ id: 'dead', domain: 'aviation', lifecycle: 'deprecated' }));
  const active = getProvidersForDomain('aviation').map((p) => p.id);
  const all = getProvidersForDomain('aviation', { includeDeprecated: true }).map((p) => p.id);
  assert.deepEqual(active, ['live']);
  assert.equal(all.length, 2);
});

test('getAllActiveProviders returns flattened active set', () => {
  clearRegistry();
  registerProvider(fixture({ id: 'av-x', domain: 'aviation' }));
  registerProvider(fixture({ id: 'cy-x', domain: 'cyber' }));
  registerProvider(fixture({ id: 'cy-y', domain: 'cyber', lifecycle: 'deprecated' }));
  const all = getAllActiveProviders().map((p) => p.id).sort();
  assert.deepEqual(all, ['av-x', 'cy-x']);
});
