import { test } from 'node:test';
import assert from 'node:assert';
import {
  countryEntitySlugs,
  countryIso3Slug,
  slugifyEntity,
} from '../entity-slug';

test('slug table', () => {
  assert.equal(slugifyEntity('Suez Canal'), 'suez-canal');
  assert.equal(slugifyEntity('AAPL'), 'aapl');
  assert.equal(slugifyEntity('CVE-2026-1234'), 'cve-2026-1234');
  assert.equal(slugifyEntity('  Fukushima  Daiichi  '), 'fukushima-daiichi');
  assert.equal(slugifyEntity('Ürümqi'), 'urumqi');
  assert.equal(slugifyEntity(''), '');
});

test('country slugs converge names and ISO-3 codes', () => {
  assert.deepEqual(countryEntitySlugs('Ukraine'), ['ukraine', 'ukr']);
  assert.deepEqual(countryEntitySlugs('UKR'), ['ukr']);
  assert.equal(countryIso3Slug('Sudan'), 'sdn');
  assert.equal(countryIso3Slug('SDN'), 'sdn');
  assert.equal(countryIso3Slug('Bay'), undefined);
});
