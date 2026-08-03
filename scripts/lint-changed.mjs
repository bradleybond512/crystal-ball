#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { runEslint } from './run-eslint.mjs';

const eslintFilePattern = /\.(?:[cm]?[jt]sx?)$/u;
const ignoredPrefixes = [
  'node_modules/',
  'dist/',
  'src-tauri/target/',
  '.agent/',
  '.agents/',
  '.claude/',
  '.worktrees/',
  'convex/',
];

const runCapture = (command, args) =>
  spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

const baseCandidates = [
  process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : '',
  process.env.GITHUB_BASE_REF || '',
  'origin/main',
  'main',
].filter(Boolean);

const findBaseRef = () => {
  for (const candidate of baseCandidates) {
    const result = runCapture('git', ['rev-parse', '--verify', candidate]);
    if ((result.status ?? 1) === 0) return candidate;
  }
  return '';
};

const isLintableFile = (filePath) =>
  eslintFilePattern.test(filePath) && !ignoredPrefixes.some((prefix) => filePath.startsWith(prefix));

const baseRef = findBaseRef();

if (baseRef) {
  const diff = runCapture('git', ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${baseRef}...HEAD`]);
  if ((diff.status ?? 1) === 0) {
    const files = diff.stdout
      .split(/\r?\n/u)
      .filter(Boolean)
      .filter((filePath) => isLintableFile(filePath));
    if (files.length === 0) {
      console.log('[lint:ci] No changed JavaScript or TypeScript files to lint.');
    } else {
      console.log(`[lint:ci] Linting ${files.length} changed file(s).`);
      const result = await runEslint(files);
      process.exitCode = result.exitCode;
    }
  } else {
    console.error((diff.stderr || diff.stdout || '').trim() || '[lint:ci] Failed to list changed files.');
    process.exitCode = diff.status ?? 1;
  }
} else {
  console.error('[lint:ci] Unable to find a base ref for changed-file linting.');
  process.exitCode = 1;
}
