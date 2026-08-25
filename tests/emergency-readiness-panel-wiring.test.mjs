import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const panelsSource = readFileSync(resolve(root, 'src/config/panels.ts'), 'utf8');
const metadataSource = readFileSync(resolve(root, 'src/config/panel-metadata.ts'), 'utf8');
const layoutSource = readFileSync(resolve(root, 'src/app/panel-layout.ts'), 'utf8');
const smokeSource = readFileSync(resolve(root, 'tests/panels/panel-smoke-registry.mts'), 'utf8');
const contractsSource = readFileSync(resolve(root, 'tests/panels/panel-data-contracts.mts'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function objectBody(name) {
  const match = panelsSource.match(new RegExp(`const ${name}:[\\s\\S]*?= \\{([\\s\\S]*?)\\n\\};`));
  assert.ok(match, `expected ${name}`);
  return match[1];
}

test('registers Emergency Readiness in the full variant only and existing intelligence category', () => {
  assert.match(objectBody('FULL_PANELS'), /'emergency-readiness':\s*\{[^}]*name:\s*'Emergency Readiness'[^}]*enabled:\s*true/);
  for (const variant of ['TECH_PANELS', 'FINANCE_PANELS', 'HAPPY_PANELS']) {
    assert.doesNotMatch(objectBody(variant), /'emergency-readiness'/, `${variant} must not expose the panel`);
  }
  assert.match(
    panelsSource,
    /intelligence:\s*\{[\s\S]*panelKeys:\s*\[[^\]]*'local-logistics',\s*'emergency-readiness'/,
    'classic sidebar reachability should stay in the existing full intelligence category',
  );
});

test('features Emergency Readiness in the Personal Safety library and command-palette metadata registry', () => {
  assert.match(
    metadataSource,
    /'emergency-readiness':\s*\{\s*domain:\s*'personal-safety',[^}]*tier:\s*'library',[^}]*featured:\s*true[^}]*\}/,
  );
});

test('constructs the panel in full layout and registers its smoke/data contracts', () => {
  assert.match(layoutSource, /import \{ EmergencyReadinessPanel \} from '@\/components\/EmergencyReadinessPanel';/);
  assert.match(layoutSource, /this\.ctx\.panels\['emergency-readiness'\]\s*=\s*new EmergencyReadinessPanel\(\);/);
  assert.match(smokeSource, /'emergency-readiness':\s*\{[\s\S]*EmergencyReadinessPanel[\s\S]*waitMs:\s*200/);
  assert.match(contractsSource, /'emergency-readiness':\s*\{\s*contract:\s*'static-local'/);
});

test('exposes a focused npm validation script for the unit and wiring surface', () => {
  const script = packageJson.scripts?.['test:emergency-readiness'];
  assert.equal(typeof script, 'string');
  assert.match(script, /emergency-readiness-view\.test\.mts/);
  assert.match(script, /emergency-readiness-panel\.test\.mts/);
  assert.match(script, /emergency-readiness-panel-wiring\.test\.mjs/);
  assert.match(script, /snapshot-store\.test\.mts/);
  assert.match(script, /lifeline-runtime\.test\.mts/);
  assert.match(script, /register-hook\.mjs/);
});
