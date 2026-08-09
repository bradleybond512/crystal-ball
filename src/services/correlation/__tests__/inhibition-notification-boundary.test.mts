import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';

const servicesRoot = new URL('../../', import.meta.url);

test('production alert and notification modules cannot import learned inhibition', () => {
  const offenders: string[] = [];
  for (const file of productionTypeScriptFiles(servicesRoot.pathname)) {
    const relative = file.slice(servicesRoot.pathname.length);
    const name = basename(file).toLowerCase();
    if (
      !name.includes('alert')
      && !name.includes('notification')
      && !relative.includes('/notifications/')
    ) continue;
    const source = readFileSync(file, 'utf8');
    if (/from\s+['"][^'"]*(?:correlation\/)?inhibition(?:\.ts)?['"]/.test(source)) {
      offenders.push(relative);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `notification delivery must stay independent of learned inhibition: ${offenders.join(', ')}`,
  );
});

function productionTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...productionTypeScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}
