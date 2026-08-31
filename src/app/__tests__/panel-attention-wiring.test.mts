import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('panel layout owns review-trail startup, lazy refresh, and teardown', async () => {
  const source = await readFile(new URL('../panel-layout.ts', import.meta.url), 'utf8');

  assert.match(source, /import type \{ SidebarHeatController \} from '@\/services\/sidebar-heat';/);
  assert.doesNotMatch(source, /import \{[^}]*startSidebarHeat[^}]*\} from '@\/services\/sidebar-heat';/);
  assert.match(source, /private sidebarHeat: SidebarHeatController \| null = null;/);
  assert.match(
    source,
    /import\('@\/services\/sidebar-heat'\)[\s\S]*?if \(this\.destroyed\) return;[\s\S]*?this\.sidebarHeat = startSidebarHeat\(notificationStack\.element\);/,
  );
  assert.match(source, /this\.sidebarHeat\?\.refresh\(\);/);
  assert.match(source, /this\.sidebarHeat\?\.destroy\(\);\s*this\.sidebarHeat = null;/);
});
