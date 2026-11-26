import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractDeclarations, scanRepository, reconcileInventory } from '../scripts/lint-stacking.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const cli = path.join(repoRoot, 'scripts/lint-stacking.mjs');

function fixture(t, files = { 'src/overlay.css': '.overlay { z-index: 42; }' }) {
  const root = mkdtempSync(path.join(tmpdir(), 'stacking-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), source);
  }
  return root;
}

function extract(source, file = 'src/overlay.ts') {
  const result = extractDeclarations(source, { path: file });
  assert.deepEqual(result.errors, [], 'valid syntax must extract without errors');
  return result.declarations;
}

function inventoryFor(scan) {
  return {
    version: 1,
    entries: scan.declarations.map(({ path, kind, anchor, expression, count, bindings }) => ({
      path, kind, anchor, expression, count, bindings,
      classification: kind === 'unsupported' ? 'unsupported' : 'dom',
      owner: 'Fixture overlay',
      context: 'Unknown parent stacking context',
      rationale: 'Reviewed fixture declaration',
      evidence: [{ path, anchor, fact: 'The declaration appears at this structural anchor' }],
    })),
  };
}

function writeInventory(root, inventory) {
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  writeFileSync(path.join(root, 'scripts/stacking-inventory.json'), JSON.stringify(inventory));
}

function runCli(root, args = []) {
  return spawnSync(process.execPath, [cli, '--root', root, ...args], {
    cwd: repoRoot, encoding: 'utf8', timeout: 15000,
  });
}

function rejects(errors, message) {
  assert.ok(errors.length > 0, message);
  assert.ok(errors.every(error => typeof error === 'string' && error.trim()), 'diagnostics must be actionable strings');
}

test('CSS extraction preserves nested selectors, tokens, values and priority', () => {
  const rows = extract(':root { --z-modal: 1200; } @media (min-width: 1px) { .shell { .dialog { z-index: var(--z-modal) !important; } } }', 'src/a.css');
  assert.equal(rows.length, 2);
  const token = rows.find(row => row.kind === 'css-token');
  const overlay = rows.find(row => row.kind === 'css-z-index');
  assert.equal(token.expression, '1200');
  assert.match(overlay.anchor, /@media.*\.shell.*\.dialog/);
  assert.match(overlay.expression, /var\(--z-modal\).* !important/);
  assert.deepEqual(overlay.tokens, ['--z-modal']);
});

test('CSS property escapes are decoded without counting comments or quoted values', () => {
  const rows = extract(String.raw`.a { z-\69 ndex: -1; content: "z-index: 900"; } /* .b { z-index: 99; } */`, 'src/a.css');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'css-z-index');
  assert.equal(rows[0].expression, '-1');
});

test('CSS numeric zero, auto and calc expressions remain distinct declarations', () => {
  const rows = extract('.zero { z-index: 0; } .auto { z-index: auto; } .calc { z-index: calc(var(--z-modal) + 1); }', 'src/a.css');
  assert.deepEqual(rows.map(row => row.expression).sort(), ['0', 'auto', 'calc(var(--z-modal) + 1)'].sort());
});

for (const [label, source] of [
  ['object key', 'const overlay = { zIndex: 7 };'],
  ['quoted object key', 'const overlay = { "z-index": 7 };'],
  ['literal computed object key', 'const overlay = { ["zIndex"]: 7 };'],
  ['escaped property', String.raw`const overlay = { z\u0049ndex: 7 };`],
  ['dot assignment', 'overlay.style.zIndex = "7";'],
  ['literal bracket assignment', 'overlay.style["z-index"] = "7";'],
  ['setProperty', 'overlay.style.setProperty("z-index", "7");'],
  ['escaped setProperty', String.raw`overlay.style.setProperty("z-\u0069ndex", "7");`],
]) {
  test(`JavaScript recognizes ${label}`, () => {
    const rows = extract(source);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'js-z-index');
    assert.match(rows[0].expression, /7/);
    assert.equal(rows[0].count, 1);
  });
}

test('JSX style objects are inventoried', () => {
  const rows = extract('const Panel = () => <div style={{ zIndex: 4 }} />;', 'src/Panel.tsx');
  assert.equal(rows.length, 1);
  assert.match(rows[0].anchor, /Panel/);
});

test('comments and type-only zIndex members do not become declarations', () => {
  const rows = extract('interface Style { zIndex: number; } type Level = { "z-index": string }; // zIndex: 999\n/* el.style.zIndex = 333; */ const text = "z-index is a property";');
  assert.deepEqual(rows, []);
});

test('CSS strings and interpolated templates preserve stacking expressions', () => {
  const rows = extract('const styles = `.dialog { z-index: ${active ? 100 : 200}; }`; const plain = ".tip { z-index: 9; }";');
  assert.equal(rows.length, 2);
  assert.ok(rows.some(row => /active/.test(row.expression) && /100/.test(row.expression) && /200/.test(row.expression)));
  assert.ok(rows.some(row => row.expression === '9'));
});

test('HTML style attributes and style blocks are inventoried', () => {
  const rows = extract('<style>.dialog { z-index: 10; }</style><div style="position:fixed; z-index: 11"></div>', 'src/shell.html');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.expression).sort(), ['10', '11']);
});

test('local constant dependencies include initializer fingerprints', () => {
  const rows = extract('const BASE = 40; const LEVEL = BASE + 2; overlay.style.zIndex = String(LEVEL);');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].bindings.some(binding => /LEVEL/.test(binding.name) && /BASE/.test(binding.expression)));
  assert.ok(rows[0].bindings.some(binding => /BASE/.test(binding.name) && /40/.test(binding.expression)));
});

test('same-named constants in different lexical scopes keep their own values', () => {
  const rows = extract('function first() { const LEVEL = 10; overlay.style.zIndex = String(LEVEL); } function second() { const LEVEL = 20; overlay.style.zIndex = String(LEVEL); }');
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].anchor, rows[1].anchor);
  for (const [name, value] of [['first', '10'], ['second', '20']]) {
    const row = rows.find(row => row.anchor.includes(name));
    assert.ok(row.bindings.some(binding => binding.expression === value));
  }
});

test('line shifts and comments preserve declaration identity', t => {
  const root = fixture(t);
  const before = scanRepository(root);
  writeFileSync(path.join(root, 'src/overlay.css'), '\n/* explanatory comment */\n.overlay { z-index: 42; }');
  const after = scanRepository(root);
  assert.notEqual(after.declarations[0].line, before.declarations[0].line);
  assert.deepEqual(reconcileInventory(after, inventoryFor(before), { root }), []);
});

test('exact inventory accepts reviewed declarations', t => {
  const root = fixture(t);
  const scan = scanRepository(root);
  assert.deepEqual(scan.errors, []);
  assert.deepEqual(reconcileInventory(scan, inventoryFor(scan), { root }), []);
});

for (const [label, before, after] of [
  ['same-count replacement', '.a { z-index: 1; }', '.a { z-index: 2; }'],
  ['selector replacement', '.a { z-index: 1; }', '.b { z-index: 1; }'],
  ['priority change', '.a { z-index: 1; }', '.a { z-index: 1 !important; }'],
  ['nested context change', '@media print { .a { z-index: 1; } }', '@media screen { .a { z-index: 1; } }'],
  ['duplicate addition', '.a { z-index: 1; }', '.a { z-index: 1; z-index: 1; }'],
  ['duplicate removal', '.a { z-index: 1; z-index: 1; }', '.a { z-index: 1; }'],
  ['stale allowance', '.a { z-index: 1; }', '.a { color: red; }'],
]) {
  test(`inventory rejects ${label}`, t => {
    const root = fixture(t, { 'src/a.css': before });
    const inventory = inventoryFor(scanRepository(root));
    writeFileSync(path.join(root, 'src/a.css'), after);
    rejects(reconcileInventory(scanRepository(root), inventory, { root }), label);
  });
}

for (const [label, before, after] of [
  ['changed conditional branch', 'el.style.zIndex = ready ? "4" : "5";', 'el.style.zIndex = ready ? "4" : "6";'],
  ['changed constant initializer', 'const LEVEL = 40; el.style.zIndex = String(LEVEL);', 'const LEVEL = 41; el.style.zIndex = String(LEVEL);'],
  ['changed transitive initializer', 'const BASE = 40; const LEVEL = BASE + 2; el.style.zIndex = String(LEVEL);', 'const BASE = 41; const LEVEL = BASE + 2; el.style.zIndex = String(LEVEL);'],
  ['changed setProperty priority', 'el.style.setProperty("z-index", "4");', 'el.style.setProperty("z-index", "4", "important");'],
  ['changed literal contents', 'el.style.zIndex = "1 2";', 'el.style.zIndex = "12";'],
  ['changed template branch', 'const css = `.a { z-index: ${ready ? 4 : 5}; }`;', 'const css = `.a { z-index: ${ready ? 4 : 6}; }`;'],
]) {
  test(`inventory rejects ${label}`, t => {
    const root = fixture(t, { 'src/a.ts': before });
    const inventory = inventoryFor(scanRepository(root));
    writeFileSync(path.join(root, 'src/a.ts'), after);
    rejects(reconcileInventory(scanRepository(root), inventory, { root }), label);
  });
}

test('repeated identical declarations carry exact multiplicity', () => {
  const rows = extract('.a { z-index: 1; z-index: 1; }', 'src/a.css');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
});

for (const [label, mutate] of [
  ['missing version', inventory => { delete inventory.version; }],
  ['unknown version', inventory => { inventory.version = 2; }],
  ['non-array entries', inventory => { inventory.entries = {}; }],
  ['duplicate entries', inventory => { inventory.entries.push(structuredClone(inventory.entries[0])); }],
  ['zero count', inventory => { inventory.entries[0].count = 0; }],
  ['fractional count', inventory => { inventory.entries[0].count = 1.5; }],
  ['unknown classification', inventory => { inventory.entries[0].classification = 'skip'; }],
  ['empty owner', inventory => { inventory.entries[0].owner = ''; }],
  ['missing context', inventory => { delete inventory.entries[0].context; }],
  ['missing rationale', inventory => { delete inventory.entries[0].rationale; }],
  ['missing evidence', inventory => { inventory.entries[0].evidence = []; }],
  ['missing evidence file', inventory => { inventory.entries[0].evidence[0].path = 'src/missing.ts'; }],
  ['missing evidence anchor', inventory => { inventory.entries[0].evidence[0].anchor = 'nonexistent-anchor'; }],
  ['outside evidence path', inventory => { inventory.entries[0].evidence[0].path = '../outside.ts'; }],
  ['outside declaration path', inventory => { inventory.entries[0].path = '../outside.ts'; }],
  ['invalid bindings', inventory => { inventory.entries[0].bindings = [{ name: 'LEVEL' }]; }],
]) {
  test(`inventory fails closed on ${label}`, t => {
    const root = fixture(t);
    const scan = scanRepository(root);
    const inventory = inventoryFor(scan);
    mutate(inventory);
    rejects(reconcileInventory(scan, inventory, { root }), label);
  });
}

test('non-dom classification cannot waive another declaration', t => {
  const root = fixture(t, { 'src/lens.ts': 'const metadata = { zIndex: 4 };' });
  const inventory = inventoryFor(scanRepository(root));
  inventory.entries[0].classification = 'non-dom';
  assert.deepEqual(reconcileInventory(scanRepository(root), inventory, { root }), []);
  writeFileSync(path.join(root, 'src/lens.ts'), 'const metadata = { zIndex: 4 }; overlay.style.zIndex = "5";');
  rejects(reconcileInventory(scanRepository(root), inventory, { root }), 'non-dom waiver must be declaration-scoped');
});

test('overlay token references require inventoried definitions', t => {
  const root = fixture(t, { 'src/a.css': '.a { z-index: var(--z-missing); }' });
  const scan = scanRepository(root);
  rejects(reconcileInventory(scan, inventoryFor(scan), { root }), 'undefined overlay token');
});

test('overlay token definitions and references reconcile together', t => {
  const root = fixture(t, { 'src/a.css': ':root { --z-modal: 100; } .a { z-index: var(--z-modal); }' });
  const scan = scanRepository(root);
  assert.deepEqual(reconcileInventory(scan, inventoryFor(scan), { root }), []);
  writeFileSync(path.join(root, 'src/a.css'), ':root { --z-modal: 101; } .a { z-index: var(--z-modal); }');
  rejects(reconcileInventory(scanRepository(root), inventoryFor(scan), { root }), 'definition changes require review');
});

test('unsupported recognizable syntax cannot silently pass an empty inventory', t => {
  const root = fixture(t, { 'src/a.ts': 'const styles = { get zIndex() { return 99; } };' });
  const scan = scanRepository(root);
  assert.ok(scan.errors.length || scan.declarations.some(row => row.kind === 'unsupported'));
  rejects(reconcileInventory(scan, { version: 1, entries: [] }, { root }), 'getter must fail closed');
});

for (const [file, source] of [
  ['src/a.ts', 'const style = { zIndex: ;'],
  ['src/a.css', '.a { z-index: 7;'],
]) {
  test(`malformed ${path.extname(file)} source fails closed`, t => {
    const root = fixture(t, { [file]: source });
    const scan = scanRepository(root);
    assert.ok(scan.errors.length > 0);
    rejects(reconcileInventory(scan, { version: 1, entries: [] }, { root }), 'parse errors must survive reconciliation');
  });
}

test('repository traversal is sorted and excludes tests and declarations', t => {
  const root = fixture(t, {
    'src/z.ts': 'el.style.zIndex = "2";',
    'src/a.css': '.a { z-index: 1; }',
    'src/types.d.ts': 'interface Style { zIndex: number; }',
    'src/a.test.ts': 'el.style.zIndex = "999";',
    'src/__tests__/b.ts': 'el.style.zIndex = "998";',
  });
  const scan = scanRepository(root);
  assert.deepEqual(scan.errors, []);
  assert.deepEqual(scan.declarations.map(row => row.path), ['src/a.css', 'src/z.ts']);
});

test('source symlinks outside the repository fail closed', t => {
  const root = fixture(t, {});
  const outside = fixture(t, { 'outside.css': '.a { z-index: 900; }' });
  symlinkSync(path.join(outside, 'outside.css'), path.join(root, 'src/escape.css'));
  const scan = scanRepository(root);
  assert.ok(scan.errors.length > 0, 'external symlink must not be read or silently skipped');
});

test('CLI succeeds read-only with a valid inventory', t => {
  const root = fixture(t);
  writeInventory(root, inventoryFor(scanRepository(root)));
  const before = readFileSync(path.join(root, 'scripts/stacking-inventory.json'), 'utf8');
  const result = runCli(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /1/);
  assert.equal(readFileSync(path.join(root, 'scripts/stacking-inventory.json'), 'utf8'), before);
  assert.deepEqual(readdirSync(path.join(root, 'scripts')), ['stacking-inventory.json']);
});

test('CLI diagnostics are deterministic for identical invalid input', t => {
  const root = fixture(t, { 'src/z.css': '.z { z-index: 2; }', 'src/a.css': '.a { z-index: 1; }' });
  writeInventory(root, { version: 1, entries: [] });
  const first = runCli(root);
  const second = runCli(root);
  assert.notEqual(first.status, 0);
  assert.equal(second.status, first.status);
  assert.equal(second.stderr, first.stderr);
  assert.equal(second.stdout, first.stdout);
  assert.match(first.stdout + first.stderr, /src\/a\.css/);
  assert.match(first.stdout + first.stderr, /src\/z\.css/);
});

for (const [label, inventory] of [['missing', undefined], ['invalid JSON', '{'], ['null', 'null']]) {
  test(`CLI rejects ${label} inventory`, t => {
    const root = fixture(t);
    if (inventory !== undefined) {
      mkdirSync(path.join(root, 'scripts'));
      writeFileSync(path.join(root, 'scripts/stacking-inventory.json'), inventory);
    }
    const result = runCli(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /inventory|JSON|schema/i);
  });
}

test('CLI refuses update, unknown flags and outside inventory paths', t => {
  const root = fixture(t);
  writeInventory(root, inventoryFor(scanRepository(root)));
  for (const args of [['--update'], ['--unknown'], ['--inventory', '../outside.json'], ['--inventory']]) {
    const result = runCli(root, args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.ok((result.stdout + result.stderr).trim());
  }
});

test('strict lint and static-lint enforce stacking without removing existing gates', () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['lint:stacking'], 'node scripts/lint-stacking.mjs');
  assert.equal(pkg.scripts['test:stacking'], 'node --test tests/lint-stacking.test.mjs');
  for (const gate of ['conflicts', 'json', 'yaml', 'shell', 'md', 'colors', 'stacking']) {
    assert.ok(pkg.scripts['lint:strict'].split(' && ').includes(`npm run lint:${gate}`));
  }
  const workflow = readFileSync(path.join(repoRoot, '.github/workflows/lint.yml'), 'utf8');
  assert.match(workflow, /\n  pull_request:/);
  assert.match(workflow, /\n  merge_group:/);
  assert.match(workflow, /static-lint:[\s\S]*- run: npm run test:stacking\s+- run: npm run lint:stacking/);
  for (const gate of ['conflicts', 'json', 'yaml', 'shell', 'colors']) {
    assert.ok(workflow.includes(`- run: npm run lint:${gate}`));
  }
  const overrides = JSON.parse(readFileSync(path.join(repoRoot, 'scripts/targeted-tests-overrides.json'), 'utf8'));
  for (const file of ['scripts/lint-stacking.mjs', 'scripts/stacking-inventory.json', 'tests/lint-stacking.test.mjs', '.github/workflows/lint.yml']) {
    assert.ok(overrides[file]?.includes('test:stacking'), file);
  }
});

test('null and non-object inventory inputs produce diagnostics rather than exceptions', t => {
  const root = fixture(t);
  const scan = scanRepository(root);
  for (const inventory of [null, [], 'inventory', 1, true]) {
    rejects(reconcileInventory(scan, inventory, { root }), 'invalid root schema');
  }
});

test('an unsupported allowance covers only its exact fingerprint', t => {
  const root = fixture(t, { 'src/a.ts': 'const styles = { get zIndex() { return 99; } };' });
  const scan = scanRepository(root);
  assert.ok(scan.declarations.some(row => row.kind === 'unsupported'));
  const inventory = inventoryFor(scan);
  assert.deepEqual(reconcileInventory(scan, inventory, { root }), []);
  writeFileSync(path.join(root, 'src/a.ts'), 'const styles = { get zIndex() { return 100; } };');
  rejects(reconcileInventory(scanRepository(root), inventory, { root }), 'changed unsupported getter');
});

test('comments in HTML do not create stacking declarations', () => {
  assert.deepEqual(extract('<!-- <div style="z-index: 99"></div><style>.x { z-index: 98; }</style> --><p>content</p>', 'src/a.html'), []);
});

test('all supported source extensions are scanned', t => {
  const sources = Object.fromEntries(['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx'].map(extension => [`src/a.${extension}`, 'const a = { zIndex: 5 };']));
  const root = fixture(t, sources);
  const scan = scanRepository(root);
  assert.deepEqual(scan.errors, []);
  assert.equal(scan.declarations.length, Object.keys(sources).length);
});

test('a source tree that is missing or not a directory fails closed', t => {
  const root = fixture(t, {});
  rmSync(path.join(root, 'src'), { recursive: true });
  assert.ok(scanRepository(root).errors.length > 0);
  writeFileSync(path.join(root, 'src'), 'not a source directory');
  assert.ok(scanRepository(root).errors.length > 0);
});

test('CSS interpolation dependencies cannot hide changed constants', t => {
  const root = fixture(t, { 'src/a.ts': 'const LEVEL = 50; const css = `.a { z-index: ${LEVEL}; }`;' });
  const before = scanRepository(root);
  assert.ok(before.declarations[0].bindings.some(binding => /LEVEL/.test(binding.name) && binding.expression === '50'));
  const inventory = inventoryFor(before);
  assert.deepEqual(reconcileInventory(before, inventory, { root }), []);
  writeFileSync(path.join(root, 'src/a.ts'), 'const LEVEL = 51; const css = `.a { z-index: ${LEVEL}; }`;');
  rejects(reconcileInventory(scanRepository(root), inventory, { root }), 'template constant initializer changed');
});

test('evidence symlinks cannot escape the repository', t => {
  const root = fixture(t);
  const outside = fixture(t, { 'evidence.md': 'outside evidence' });
  symlinkSync(path.join(outside, 'evidence.md'), path.join(root, 'evidence.md'));
  const scan = scanRepository(root);
  const inventory = inventoryFor(scan);
  inventory.entries[0].evidence = [{ path: 'evidence.md', anchor: 'file', fact: 'Outside file must be rejected' }];
  rejects(reconcileInventory(scan, inventory, { root }), 'symlink evidence must be rejected');
});

test('CLI refuses an inventory symlink outside the repository', t => {
  const root = fixture(t);
  const outside = fixture(t, {});
  writeInventory(outside, inventoryFor(scanRepository(root)));
  mkdirSync(path.join(root, 'scripts'));
  symlinkSync(path.join(outside, 'scripts/stacking-inventory.json'), path.join(root, 'scripts/stacking-inventory.json'));
  const result = runCli(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink|unsafe|outside/i);
});

test('unresolved and circular required constants fail closed', t => {
  for (const source of [
    'el.style.zIndex = String(MISSING_LEVEL);',
    'const LEVEL = OTHER; const OTHER = LEVEL; el.style.zIndex = String(LEVEL);',
  ]) {
    const root = fixture(t, { 'src/a.ts': source });
    const scan = scanRepository(root);
    assert.ok(scan.errors.length > 0);
    rejects(reconcileInventory(scan, inventoryFor(scan), { root }), 'invalid constant dependency');
  }
});

test('source scanning never executes source code or resolves external imports', t => {
  const root = fixture(t, { 'src/a.ts': 'import LEVEL from "../../../not-a-real-file.js"; throw new Error("must not execute"); el.style.zIndex = String(LEVEL);' });
  const scan = scanRepository(root);
  assert.deepEqual(scan.errors, []);
  assert.equal(scan.declarations.length, 1);
  assert.match(scan.declarations[0].expression, /LEVEL/);
});

test('stale expression is rejected even when its structural anchor still exists', t => {
  const root = fixture(t, { 'src/a.css': '.a { z-index: 1; z-index: 2; }' });
  const inventory = inventoryFor(scanRepository(root));
  writeFileSync(path.join(root, 'src/a.css'), '.a { z-index: 2; }');
  rejects(reconcileInventory(scanRepository(root), inventory, { root }), 'removed expression must be stale independently of evidence validation');
});

test('CSS string concatenation fingerprints local constant dependencies', t => {
  const root = fixture(t, { 'src/a.ts': 'const LEVEL = 5; const css = "z-index:" + LEVEL + ";";' });
  const before = scanRepository(root);
  assert.deepEqual(before.errors, []);
  assert.equal(before.declarations.length, 1);
  assert.ok(before.declarations[0].bindings.some(binding => /LEVEL/.test(binding.name) && binding.expression === '5'));
  const inventory = inventoryFor(before);
  assert.deepEqual(reconcileInventory(before, inventory, { root }), []);
  writeFileSync(path.join(root, 'src/a.ts'), 'const LEVEL = 6; const css = "z-index:" + LEVEL + ";";');
  rejects(reconcileInventory(scanRepository(root), inventory, { root }), 'concatenated level changed');
});

test('unrelated CSS template interpolation does not alter stacking identity', t => {
  const root = fixture(t, { 'src/a.ts': 'const COLOR = "red"; const LEVEL = 5; const css = `.a { color: ${COLOR}; z-index: ${LEVEL}; }`;' });
  const before = scanRepository(root);
  assert.deepEqual(before.errors, []);
  assert.equal(before.declarations.length, 1);
  assert.ok(before.declarations[0].bindings.some(binding => /LEVEL/.test(binding.name)));
  assert.ok(before.declarations[0].bindings.every(binding => !/COLOR/.test(binding.name)));
  writeFileSync(path.join(root, 'src/a.ts'), 'const COLOR = "blue"; const LEVEL = 5; const css = `.a { color: ${COLOR}; z-index: ${LEVEL}; }`;');
  assert.deepEqual(reconcileInventory(scanRepository(root), inventoryFor(before), { root }), []);
});

test('array-joined style changes preserve unrelated stacking identity', t => {
  const root = fixture(t, { 'src/a.ts': 'const css = ["color:red", "z-index:5"].join(";");' });
  const before = scanRepository(root);
  assert.deepEqual(before.errors, []);
  assert.equal(before.declarations.length, 1);
  writeFileSync(path.join(root, 'src/a.ts'), 'const css = ["color:blue", "z-index:5"].join(";");');
  assert.deepEqual(reconcileInventory(scanRepository(root), inventoryFor(before), { root }), []);
});

test('unquoted HTML style attributes cannot silently escape inventory', t => {
  const root = fixture(t, { 'src/a.html': '<div style=z-index:7></div>' });
  const scan = scanRepository(root);
  assert.ok(scan.declarations.length > 0 || scan.errors.length > 0, 'unquoted style requires extraction or explicit unsupported diagnostics');
  rejects(reconcileInventory(scan, { version: 1, entries: [] }, { root }), 'unquoted style is not an empty source');
});

test('unterminated HTML style blocks fail closed', t => {
  const root = fixture(t, { 'src/a.html': '<style>.a { z-index: 7; }' });
  const scan = scanRepository(root);
  assert.ok(scan.errors.length > 0 || scan.declarations.length > 0, 'incomplete style block cannot disappear');
  rejects(reconcileInventory(scan, { version: 1, entries: [] }, { root }), 'unterminated style block');
});

test('existing evidence outside the repository remains forbidden', t => {
  const root = fixture(t);
  const outside = fixture(t, { 'evidence.md': 'outside evidence' });
  const scan = scanRepository(root);
  const inventory = inventoryFor(scan);
  inventory.entries[0].evidence = [{ path: path.relative(root, path.join(outside, 'evidence.md')), anchor: 'file', fact: 'Existing outside evidence must be rejected' }];
  rejects(reconcileInventory(scan, inventory, { root }), 'existing outside evidence');
});

test('CLI rejects an existing valid inventory outside the repository', t => {
  const root = fixture(t);
  const outside = fixture(t, {});
  writeInventory(outside, inventoryFor(scanRepository(root)));
  const result = runCli(root, ['--inventory', path.relative(root, path.join(outside, 'scripts/stacking-inventory.json'))]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe|outside|path/i);
});

for (const property of ['z&#45;index', '&#122;-index', 'z&#x2d;index']) {
  for (const file of ['src/a.html', 'src/a.ts']) {
    test(`HTML entity property ${property} in ${path.extname(file)} cannot escape inventory`, t => {
      const markup = `<div style="${property}:9"></div>`;
      const source = file.endsWith('.html') ? markup : `const template = ${JSON.stringify(markup)};`;
      const root = fixture(t, { [file]: source });
      const scan = scanRepository(root);
      assert.ok(scan.declarations.length > 0 || scan.errors.length > 0, 'browser-active entity property cannot disappear');
      rejects(reconcileInventory(scan, { version: 1, entries: [] }, { root }), 'entity-encoded stacking declaration');
    });
  }
}

test('named HTML entities in interpolated templates cannot escape inventory', t => {
  const root = fixture(t, { 'src/a.ts': 'const template = `<div style="z&hyphen;index:9">${body}</div>`;' });
  const scan = scanRepository(root);
  assert.ok(scan.declarations.length > 0 || scan.errors.length > 0, 'named entity template requires explicit extraction or unsupported handling');
  rejects(reconcileInventory(scan, { version: 1, entries: [] }, { root }), 'interpolated entity-encoded stacking declaration');
});

for (const [label, source] of [
  ['literal', 'const css = \'.dialog::before { content: "<span>"; z-index:9; }\';'],
  ['template', 'const css = `.dialog::before { content: "<span>"; color: ${color}; z-index:9; }`;'],
]) {
  test(`CSS ${label} containing quoted markup retains its stacking declaration`, t => {
    const root = fixture(t, { 'src/a.ts': source });
    const scan = scanRepository(root);
    assert.deepEqual(scan.errors, []);
    assert.equal(scan.declarations.length, 1);
    assert.equal(scan.declarations[0].kind, 'css-z-index');
    assert.equal(scan.declarations[0].expression, '9');
    rejects(reconcileInventory(scan, { version: 1, entries: [] }, { root }), 'CSS quoted markup cannot hide stacking');
  });
}

for (const [label, source, changed] of [
  ['prefix increment', '++el.style.zIndex;', '--el.style.zIndex;'],
  ['postfix increment', 'el.style["z-index"]++;', 'el.style["z-index"]--;'],
  ['prefix decrement', '--el.style["z-index"];', '++el.style["z-index"];'],
  ['postfix decrement', 'el.style.zIndex--;', 'el.style.zIndex++;'],
]) {
  test(`stacking ${label} requires an exact unsupported allowance`, t => {
    const root = fixture(t, { 'src/a.ts': source });
    const scan = scanRepository(root);
    assert.deepEqual(scan.errors, []);
    assert.equal(scan.declarations.length, 1);
    assert.equal(scan.declarations[0].kind, 'unsupported');
    assert.match(scan.declarations[0].expression, /\+\+|--/);
    rejects(reconcileInventory(scan, { version: 1, entries: [] }, { root }), 'stacking update requires review');
    const inventory = inventoryFor(scan);
    assert.deepEqual(reconcileInventory(scan, inventory, { root }), []);
    writeFileSync(path.join(root, 'src/a.ts'), changed);
    rejects(reconcileInventory(scanRepository(root), inventory, { root }), 'changed update operator requires review');
  });
}

test('runtime class heritage expressions retain stacking object properties', t => {
  const root = fixture(t, { 'src/a.ts': 'class A extends Base({ zIndex: 5 }) {}' });
  const scan = scanRepository(root);
  assert.deepEqual(scan.errors, []);
  assert.equal(scan.declarations.length, 1);
  assert.equal(scan.declarations[0].kind, 'js-z-index');
  assert.equal(scan.declarations[0].expression, '5');
  rejects(reconcileInventory(scan, { version: 1, entries: [] }, { root }), 'runtime heritage declaration requires review');
});

test('type-only class and interface heritage do not create stacking declarations', () => {
  const source = 'interface I extends Base<{ zIndex: 5 }> {} class A implements Base<{ zIndex: 6 }> {} class B extends Base<{ zIndex: 7 }> {}';
  assert.deepEqual(extract(source), []);
});

for (const [label, source] of [
  ['literal', `const html = "It's <div style='z-index:9'></div>";`],
  ['template', "const html = `It's <div style='z-index:9'>${body}</div>`;"],
]) {
  test(`HTML ${label} preceded by an apostrophe cannot hide stacking`, t => {
    const root = fixture(t, { 'src/a.ts': source });
    const scan = scanRepository(root);
    assert.ok(scan.declarations.length > 0 || scan.errors.length > 0, 'apostrophe-prefixed HTML requires extraction or explicit unsupported handling');
    rejects(reconcileInventory(scan, { version: 1, entries: [] }, { root }), 'apostrophe-prefixed HTML stacking requires review');
    if (scan.errors.length === 0) {
      const inventory = inventoryFor(scan);
      assert.deepEqual(reconcileInventory(scan, inventory, { root }), []);
      writeFileSync(path.join(root, 'src/a.ts'), source.replace('z-index:9', 'z-index:10'));
      rejects(reconcileInventory(scanRepository(root), inventory, { root }), 'changed HTML fallback fingerprint requires review');
    }
  });
}
