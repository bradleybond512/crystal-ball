import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { TOOL_CATALOG } from '../../tools/mcp-server/tool-catalog.mjs';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const data = JSON.parse(await readFile(new URL('../data/generated.json', import.meta.url), 'utf8'));
const read = (path) => readFile(new URL(path, root), 'utf8');

test('shared panel counts are derived from actual variant catalogs', async () => {
  const source = await read('src/config/panels.ts');
  const parsed = ts.createSourceFile('panels.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(parsed.parseDiagnostics.length, 0, 'panel source parses without errors');
  const catalogs = new Map();
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) catalogs.set(declaration.name.text, declaration.initializer);
    }
  }
  const actual = {};
  for (const variant of Object.keys(data.counts.panels)) {
    const catalog = catalogs.get(`${variant.toUpperCase()}_PANELS`);
    assert.ok(catalog && ts.isObjectLiteralExpression(catalog), `${variant} catalog is an object literal`);
    const names = catalog.properties.map((property) => {
      assert.ok(ts.isPropertyAssignment(property), `${variant} entries must be explicit properties`);
      assert.ok(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name), `${variant} entry has a static name`);
      return property.name.text;
    });
    assert.equal(new Set(names).size, names.length, `${variant} panel names are unique`);
    actual[variant] = names.length;
  }
  assert.deepEqual(data.counts.panels, actual);
});

test('shared MCP counts match actual registry and read-only annotations', async () => {
  const tools = Object.values(TOOL_CATALOG);
  const mutating = tools.filter(tool => !tool.annotations.readOnlyHint);
  assert.deepEqual(data.counts.mcp, {
    total: tools.length,
    read: tools.length - mutating.length,
    analyst: mutating.length,
    categories: new Set(tools.map(tool => tool.category)).size,
  });
});

test('source references exist at the pinned revision and license agrees', async () => {
  assert.match(data.sourceSha, /^[a-f0-9]{40}$/);
  const template = await readFile(new URL('../lib/render.ts', import.meta.url), 'utf8');
  const paths = new Set(['src/config/panels.ts', 'tools/mcp-server/tool-registry.mjs', ...[...template.matchAll(/source\('([^']+)'/g)].map((m) => m[1])]);
  for (const path of paths) {
    await access(new URL(path, root));
    execFileSync('git', ['cat-file', '-e', `${data.sourceSha}:${path}`], { cwd: fileURLToPath(root), stdio: 'pipe' });
  }
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.license.replace(/-only$/, ''), data.license);
});

test('edition examples belong to each actual catalog and assistant examples name registered tools', async () => {
 const {default:worker}=await import('../dist/server/index.js');
 const html=await (await worker.fetch(new Request('https://crystalball.example/'),{},{})).text();
 const parsed=ts.createSourceFile('panels.ts',await read('src/config/panels.ts'),ts.ScriptTarget.Latest,true);
 const catalogs=new Map();
 for(const statement of parsed.statements) if(ts.isVariableStatement(statement)) {
  for(const declaration of statement.declarationList.declarations) {
   if(!ts.isIdentifier(declaration.name)||!declaration.name.text.endsWith('_PANELS')||!declaration.initializer||!ts.isObjectLiteralExpression(declaration.initializer)) continue;
   catalogs.set(declaration.name.text,new Set(declaration.initializer.properties.map(entry=>entry.initializer?.properties?.find(p=>p.name?.getText(parsed)==='name')?.initializer?.text).filter(Boolean)));
  }
 }
 const section=html.match(/<section[^>]*id="variants"[\s\S]*?<\/section>/)[0];
 for(const [,edition,body] of section.matchAll(/<article><h3>(\w+) edition\.<\/h3>([\s\S]*?)<\/article>/g)) {
  const examples=[...body.matchAll(/<li>(.*?)<\/li>/g)].map(m=>m[1].replace(/<span class="release-label">[^<]*<\/span>/g,'').replaceAll('&amp;','&'));
  assert.ok(examples.length>=4&&examples.length<=5,edition);
  for(const name of examples) assert.ok(catalogs.get(`${edition.toUpperCase()}_PANELS`).has(name),`${edition}: ${name}`);
 }
 const names=Object.keys(TOOL_CATALOG);
 const prompts=html.match(/<div class="prompt-examples">[\s\S]*?<\/div>/)[0];
 const tools=[...prompts.matchAll(/<code>(.*?)<\/code>/g)].map(m=>m[1]);
 assert.ok(tools.length>=3&&tools.length<=4);
 for(const tool of tools) assert.ok(names.includes(tool),tool);
});
