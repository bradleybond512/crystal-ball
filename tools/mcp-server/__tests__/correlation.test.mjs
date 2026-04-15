import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEntities, correlate as correlateData } from '../correlation.mjs';

describe('extractEntities', () => {
  test('extracts countries from conflict data', () => {
    const data = { events: [{ country: 'Sudan', region: 'Eastern Africa' }, { country: 'Ukraine', region: 'Europe' }] };
    const entities = extractEntities('conflicts', data);
    assert.ok(entities.countries.has('Sudan'));
    assert.ok(entities.countries.has('Ukraine'));
    assert.ok(entities.regions.has('Eastern Africa'));
  });

  test('extracts actors from conflict data', () => {
    const data = { events: [{ actor1: 'Military Forces', actor2: 'Rebel Group', country: 'Sudan', event_date: '2024-01-15' }] };
    const entities = extractEntities('conflicts', data);
    assert.ok(entities.actors.has('Military Forces'));
    assert.ok(entities.actors.has('Rebel Group'));
    assert.ok(entities.dates.has('2024-01-15'));
  });

  test('extracts tickers from market data', () => {
    const data = { quotes: [{ symbol: 'SPY', price: 425 }, { symbol: 'BTC-USD', price: 65000 }] };
    const entities = extractEntities('markets', data);
    assert.ok(entities.tickers.has('SPY'));
    assert.ok(entities.tickers.has('BTC-USD'));
  });

  test('extracts countries from market macro data', () => {
    const data = { macro: [{ country: 'US' }, { country: 'China' }] };
    const entities = extractEntities('markets', data);
    assert.ok(entities.countries.has('US'));
    assert.ok(entities.countries.has('China'));
  });

  test('extracts IPs from cyber data', () => {
    const data = { iocs: [{ ioc: '1.2.3.4:8080', ioc_type: 'ip:port' }], kevs: [{ cveID: 'CVE-2024-1234' }] };
    const entities = extractEntities('cyber', data);
    assert.ok(entities.ips.has('1.2.3.4'));
    assert.ok(entities.cves.has('CVE-2024-1234'));
  });

  test('extracts countries from cyber pulse tags', () => {
    const data = { pulses: [{ tags: ['UA', 'malware', 'RU'] }] };
    const entities = extractEntities('cyber', data);
    assert.ok(entities.countries.has('UA'));
    assert.ok(entities.countries.has('RU'));
    assert.equal(entities.countries.has('malware'), false);
  });

  test('extracts from weather data', () => {
    const data = { cities: [{ country: 'Ukraine', name: 'Kyiv' }], alerts: [{ senderName: 'Europe Weather Service' }] };
    const entities = extractEntities('weather', data);
    assert.ok(entities.countries.has('Ukraine'));
    assert.ok(entities.regions.has('Kyiv'));
    assert.ok(entities.regions.has('Europe Weather Service'));
  });

  test('extracts from military data', () => {
    const data = { aircraft: [{ country: 'Russia' }], vessels: [{ flag: 'China' }] };
    const entities = extractEntities('military', data);
    assert.ok(entities.countries.has('Russia'));
    assert.ok(entities.countries.has('China'));
  });

  test('extracts from health data with outbreaks', () => {
    const data = { outbreaks: [{ country: 'Congo' }] };
    const entities = extractEntities('health', data);
    assert.ok(entities.countries.has('Congo'));
  });

  test('extracts from health data with items', () => {
    const data = { items: [{ country: 'Brazil' }] };
    const entities = extractEntities('health', data);
    assert.ok(entities.countries.has('Brazil'));
  });

  test('returns empty sets for unknown domain', () => {
    const entities = extractEntities('unknown', { foo: 'bar' });
    assert.equal(entities.countries.size, 0);
    assert.equal(entities.regions.size, 0);
    assert.equal(entities.actors.size, 0);
    assert.equal(entities.dates.size, 0);
    assert.equal(entities.tickers.size, 0);
    assert.equal(entities.ips.size, 0);
    assert.equal(entities.cves.size, 0);
  });

  test('handles missing/null data gracefully', () => {
    const entities = extractEntities('conflicts', {});
    assert.equal(entities.countries.size, 0);
    const entities2 = extractEntities('conflicts', null);
    assert.equal(entities2.countries.size, 0);
  });
});

describe('correlateData', () => {
  test('finds country overlap between conflicts and weather', () => {
    const domainData = {
      conflicts: { events: [{ country: 'Ukraine', region: 'Europe' }] },
      weather: { cities: [{ country: 'Ukraine', name: 'Kyiv' }] },
    };
    const results = correlateData(domainData, ['conflicts', 'weather']);
    const countryCorrelation = results.find(r => r.entity_type === 'countries');
    assert.ok(countryCorrelation);
    assert.ok(countryCorrelation.shared_entities.includes('Ukraine'));
    assert.ok(countryCorrelation.score > 0);
  });

  test('returns empty array when no overlap', () => {
    const domainData = {
      conflicts: { events: [{ country: 'Sudan' }] },
      markets: { quotes: [{ symbol: 'SPY' }] },
    };
    const results = correlateData(domainData, ['conflicts', 'markets']);
    assert.ok(Array.isArray(results));
    assert.equal(results.length, 0);
  });

  test('results are sorted by score descending', () => {
    const domainData = {
      conflicts: { events: [{ country: 'Ukraine' }, { country: 'Sudan' }] },
      cyber: { iocs: [], kevs: [], pulses: [{ tags: ['UA'] }] },
      weather: { cities: [{ country: 'Ukraine', name: 'Kyiv' }, { country: 'Sudan', name: 'Khartoum' }] },
    };
    const results = correlateData(domainData, ['conflicts', 'cyber', 'weather']);
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i].score <= results[i - 1].score);
    }
  });

  test('correlation result has correct shape', () => {
    const domainData = {
      conflicts: { events: [{ country: 'Ukraine' }] },
      weather: { cities: [{ country: 'Ukraine', name: 'Kyiv' }] },
    };
    const results = correlateData(domainData, ['conflicts', 'weather']);
    const r = results.find(r => r.entity_type === 'countries');
    assert.ok(r);
    assert.equal(typeof r.domain_a, 'string');
    assert.equal(typeof r.domain_b, 'string');
    assert.equal(typeof r.entity_type, 'string');
    assert.ok(Array.isArray(r.shared_entities));
    assert.equal(typeof r.overlap_count, 'number');
    assert.equal(typeof r.score, 'number');
  });
});
