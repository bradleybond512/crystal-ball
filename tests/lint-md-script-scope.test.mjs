import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldLintMarkdown } from '../scripts/lint-markdown.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));
const lintMdScript = packageJson.scripts?.['lint:md'] ?? '';

describe('markdown lint script scope', () => {
  it('excludes non-product markdown trees from lint target', () => {
 assert.equal(lintMdScript, 'node scripts/lint-markdown.mjs');

 const excluded = [
   '.agent/instructions.md',
   '.agents/skills/review.md',
   '.claude/instructions.md',
   '.claude.local.md',
   '.factory/instructions.md',
   '.windsurf/instructions.md',
   'CLAUDE.md',
   'docs/Docs_To_Review/draft.md',
   'docs/archive/retired.md',
   'docs/internal/notes.md',
   'node_modules/package/README.md',
   'packages/example/node_modules/package/README.md',
   'skills/review/SKILL.md',
   'src-tauri/target/report.md',
   'test-results/report.md',
   'tests/panels/.last-run.md',
   'tools/mcp-server/README.md',
 ];

 for (const file of excluded) {
   assert.equal(shouldLintMarkdown(file), false, file);
 }
 assert.equal(shouldLintMarkdown('README.md'), true);
 assert.equal(shouldLintMarkdown('docs/architecture/overview.md'), true);
  });
});
