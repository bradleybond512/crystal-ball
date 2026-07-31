import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPATIBILITY,
  compatibilityVerdict,
} from '../server-meta.mjs';
import {
  TOOL_CATALOG,
  permissionFromAnnotations,
} from '../tool-registry.mjs';

test('compatibility reports stable verdicts without treating missing versions as healthy', () => {
  assert.equal(compatibilityVerdict({ serverVersion: '0.3.0', skillContractVersion: 1 }).verdict, 'compatible');
  assert.equal(compatibilityVerdict({ serverVersion: '0.4.0', skillContractVersion: 1 }).verdict, 'warning');
  assert.equal(compatibilityVerdict({ serverVersion: '1.0.0', skillContractVersion: 1 }).verdict, 'incompatible');
  assert.equal(compatibilityVerdict({}).verdict, 'unknown');
  assert.equal(COMPATIBILITY.protocol, '2025-03-26');
});

test('permission labels are deterministic projections of canonical MCP annotations', () => {
  assert.deepEqual(permissionFromAnnotations({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  }), {
    code: 'read_external',
    label: 'Reads live intelligence',
    detail: 'Reads local Crystal Ball data that may come from external providers; it does not change state.',
  });

  for (const [name, metadata] of Object.entries(TOOL_CATALOG)) {
    assert.equal(typeof metadata.permission.code, 'string', name);
    assert.equal(typeof metadata.permission.label, 'string', name);
    assert.deepEqual(metadata.permission, permissionFromAnnotations(metadata.annotations), name);
  }
  assert.equal(TOOL_CATALOG.watchlist_manage.permission.code, 'manage_local');
  assert.equal(TOOL_CATALOG.run_monitor_cycle.permission.code, 'act_external');
});
