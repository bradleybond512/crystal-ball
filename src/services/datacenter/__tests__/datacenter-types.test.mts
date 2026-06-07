import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dcLevelRank, mapThreatLevelToDc, type DcLevel } from '../datacenter-types.ts';

test('dcLevelRank orders the ladder normal<watch<advisory<warning<critical', () => {
  const order: DcLevel[] = ['normal', 'watch', 'advisory', 'warning', 'critical'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(dcLevelRank(order[i]!) > dcLevelRank(order[i - 1]!));
  }
});

test('mapThreatLevelToDc bridges weather ThreatLevel onto DcLevel', () => {
  assert.equal(mapThreatLevelToDc('none'), 'normal');
  assert.equal(mapThreatLevelToDc('watch'), 'watch');
  assert.equal(mapThreatLevelToDc('advisory'), 'advisory');
  assert.equal(mapThreatLevelToDc('warning'), 'warning');
  assert.equal(mapThreatLevelToDc('emergency'), 'critical');
});
