#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from 'markdownlint/sync';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

const config = {
  default: false,
  MD009: true,
  MD010: true,
  MD012: true,
  MD018: true,
  MD019: true,
  MD022: true,
  MD023: true,
  MD031: true,
  MD032: true,
  MD037: true,
  MD038: true,
  MD039: true,
  MD047: true,
};

const excludedPrefixes = [
  '.agent/',
  '.agents/',
  '.claude/',
  '.factory/',
  '.planning/',
  '.windsurf/',
  '.worktrees/',
  'dist/',
  'docs/Docs_To_Review/',
  'docs/archive/',
  'docs/internal/',
  'docs/superpowers/',
  'node_modules/',
  'research/',
  'skills/',
  'src-tauri/target/',
  'test-results/',
  'tools/',
];

const excludedFiles = new Set([
  '.claude.local.md',
  'CLAUDE.md',
]);

function normalizePath(filePath) {
  return filePath.replaceAll(path.sep, '/').replace(/^\.\//, '');
}

export function shouldLintMarkdown(filePath) {
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPath.endsWith('.md') || excludedFiles.has(normalizedPath)) {
    return false;
  }
  if (normalizedPath.split('/').includes('node_modules')) {
    return false;
  }
  if (excludedPrefixes.some((prefix) => normalizedPath.startsWith(prefix))) {
    return false;
  }
  return !/^tests\/panels\/\.last-[^/]*\.md$/.test(normalizedPath);
}

function listMarkdownFiles(requestedFiles) {
  const files = requestedFiles.length > 0
    ? requestedFiles
    : execFileSync('/usr/bin/git', [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      '*.md',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).split('\n');

  return [...new Set(files
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => normalizePath(path.relative(repoRoot, path.resolve(repoRoot, file))))
    .filter((file) => file !== '..' && !file.startsWith('../'))
    .filter((file) => shouldLintMarkdown(file))
    .filter((file) => existsSync(path.join(repoRoot, file))))]
    .sort();
}

function formatError(file, error) {
  const column = error.errorRange?.[0] ?? 1;
  const rule = error.ruleNames.join('/');
  const detail = error.errorDetail ? `: ${error.errorDetail}` : '';
  const context = error.errorContext ? ` [Context: "${error.errorContext}"]` : '';
  return `${file}:${error.lineNumber}:${column} ${rule} ${error.ruleDescription}${detail}${context}`;
}

function main() {
  const files = listMarkdownFiles(process.argv.slice(2));
  if (files.length === 0) {
    console.log('[lint:md] No Markdown files found.');
    return;
  }

  const results = lint({ files, config });
  const failures = Object.entries(results)
    .flatMap(([file, errors]) => errors.map((error) => formatError(file, error)));

  if (failures.length > 0) {
    console.error('[lint:md] Markdown issues detected:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[lint:md] Checked ${files.length} Markdown file(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
