import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStorage } from '../storage.mjs';
import { makeStatefulTools } from '../tools/stateful.mjs';

function mockClient(overrides = {}) {
  return {
    get: async (route, params) => {
      const key = params ? `${route}?${JSON.stringify(params)}` : route;
      return overrides[key] || overrides[route] || { data: [], _mock: true };
    },
  };
}

describe('watchlist_manage', () => {
  let tmp, storage, tools;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cb-stateful-wl-'));
    storage = createStorage(tmp);
    tools = makeStatefulTools(mockClient(), storage);
  });

  after(() => rmSync(tmp, { recursive: true }));

  test('create a watchlist', async () => {
    const result = await tools.watchlist_manage({
      action: 'create',
      name: 'my-ips',
      type: 'ip',
      items: ['1.2.3.4', '5.6.7.8'],
    });
    assert.ok(result.summary.includes('Created'));
    assert.equal(result.data.name, 'my-ips');
    assert.equal(result.data.items.length, 2);
  });

  test('list watchlists includes created one', async () => {
    const result = await tools.watchlist_manage({ action: 'list' });
    assert.ok(result.data.watchlists.length >= 1);
    const found = result.data.watchlists.find(w => w.name === 'my-ips');
    assert.ok(found);
    assert.equal(found.type, 'ip');
    assert.equal(found.count, 2);
  });

  test('get a watchlist', async () => {
    const result = await tools.watchlist_manage({ action: 'get', name: 'my-ips' });
    assert.equal(result.data.name, 'my-ips');
    assert.equal(result.data.items.length, 2);
  });

  test('add_items increases count and deduplicates', async () => {
    const result = await tools.watchlist_manage({
      action: 'add_items',
      name: 'my-ips',
      items: ['5.6.7.8', '9.10.11.12'],
    });
    assert.equal(result.data.items.length, 3);
  });

  test('remove_items decreases count', async () => {
    const result = await tools.watchlist_manage({
      action: 'remove_items',
      name: 'my-ips',
      items: ['1.2.3.4'],
    });
    assert.equal(result.data.items.length, 2);
    const values = result.data.items.map(i => i.value);
    assert.ok(!values.includes('1.2.3.4'));
  });

  test('delete removes the watchlist', async () => {
    await tools.watchlist_manage({ action: 'delete', name: 'my-ips' });
    const result = await tools.watchlist_manage({ action: 'list' });
    const found = result.data.watchlists.find(w => w.name === 'my-ips');
    assert.equal(found, undefined);
  });
});

describe('alert_rules_manage', () => {
  let tmp, storage, tools;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cb-stateful-ar-'));
    storage = createStorage(tmp);
    tools = makeStatefulTools(mockClient(), storage);
  });

  after(() => rmSync(tmp, { recursive: true }));

  test('create a rule', async () => {
    const result = await tools.alert_rules_manage({
      action: 'create',
      rule: {
        id: 'spy-drop',
        domain: 'markets',
        metric: 'spy_price',
        operator: 'lt',
        threshold: 400,
        message: 'SPY dropped below 400',
      },
    });
    assert.ok(result.summary.includes('Created'));
    assert.equal(result.data.id, 'spy-drop');
  });

  test('list rules', async () => {
    const result = await tools.alert_rules_manage({ action: 'list' });
    assert.ok(result.data.rules.length >= 1);
    assert.equal(result.data.rules[0].id, 'spy-drop');
  });

  test('get a specific rule', async () => {
    const result = await tools.alert_rules_manage({
      action: 'get',
      rule: { id: 'spy-drop' },
    });
    assert.equal(result.data.id, 'spy-drop');
    assert.equal(result.data.threshold, 400);
  });

  test('update a rule', async () => {
    const result = await tools.alert_rules_manage({
      action: 'update',
      rule: { id: 'spy-drop', threshold: 380 },
    });
    assert.equal(result.data.threshold, 380);
  });

  test('delete a rule', async () => {
    await tools.alert_rules_manage({
      action: 'delete',
      rule: { id: 'spy-drop' },
    });
    const result = await tools.alert_rules_manage({ action: 'list' });
    assert.equal(result.data.rules.length, 0);
  });
});

describe('alert_check', () => {
  let tmp, storage, tools;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cb-stateful-ac-'));
    storage = createStorage(tmp);
    const client = mockClient({
      '/api/market-quotes': {
        quotes: [{ symbol: 'SPY', price: 390 }],
      },
    });
    tools = makeStatefulTools(client, storage);
    // seed a rule
    storage.writeJSON('watchlists/_rules.json', [{
      id: 'spy-drop',
      domain: 'markets',
      metric: 'spy_price',
      operator: 'lt',
      threshold: 400,
      message: 'SPY dropped below 400',
    }]);
  });

  after(() => rmSync(tmp, { recursive: true }));

  test('triggers rule when threshold met', async () => {
    const result = await tools.alert_check({});
    assert.ok(result.data.triggered.length >= 1);
    const hit = result.data.triggered.find(t => t.rule_id === 'spy-drop');
    assert.ok(hit);
    assert.equal(hit.current_value, 390);
    assert.equal(hit.threshold, 400);
    assert.ok(hit.triggered);
  });

  test('checks specific rule by id', async () => {
    const result = await tools.alert_check({ rule_id: 'spy-drop' });
    assert.equal(result.data.triggered.length, 1);
    assert.equal(result.data.triggered[0].rule_id, 'spy-drop');
  });
});

describe('watchlist_check', () => {
  let tmp, storage, tools;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cb-stateful-wc-'));
    storage = createStorage(tmp);
    const client = mockClient({
      [`/api/greynoise-lookup?${JSON.stringify({ ip: '1.2.3.4' })}`]: {
        classification: 'malicious',
      },
    });
    tools = makeStatefulTools(client, storage);
    // seed a watchlist with null last_seen
    storage.writeJSON('watchlists/test-ips.json', {
      name: 'test-ips',
      type: 'ip',
      items: [{ value: '1.2.3.4', last_seen: null, last_status: null }],
      created: new Date().toISOString(),
    });
  });

  after(() => rmSync(tmp, { recursive: true }));

  test('detects new activity on first check (last_seen null)', async () => {
    const result = await tools.watchlist_check({ name: 'test-ips' });
    assert.ok(result.data.hits.length >= 1);
    const hit = result.data.hits[0];
    assert.equal(hit.value, '1.2.3.4');
    assert.equal(hit.reason, 'first_check');
  });

  test('no hits on second check with same status', async () => {
    const result = await tools.watchlist_check({ name: 'test-ips' });
    assert.equal(result.data.hits.length, 0);
  });
});
