#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCommandWithProgress } from './run-eslint.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'scripts', 'lint-baseline.json');

const normalizePath = (filePath, root) =>
  path.relative(root, filePath).split(path.sep).join('/');

const messageKey = (message) => {
  const severity = message.severity === 2 ? 'error' : 'warning';
  if (message.ruleId) return `${severity}:${message.ruleId}`;
  if (message.message.startsWith('Unused eslint-disable directive')) {
    return `${severity}:eslint-unused-disable`;
  }
  return `${severity}:eslint-unclassified`;
};

export function summarizeLintResults(results, root = repoRoot) {
  const counts = {};
  const fatalMessages = [];

  for (const result of results) {
    const file = normalizePath(result.filePath, root);
    for (const message of result.messages) {
      if (message.fatal) {
        fatalMessages.push({ file, message: message.message });
        continue;
      }
      const key = messageKey(message);
      counts[file] ??= {};
      counts[file][key] = (counts[file][key] ?? 0) + 1;
    }
  }

  return { counts, fatalMessages };
}

export function compareLintCounts(current, baseline) {
  const violations = [];
  for (const file of Object.keys(current).sort()) {
    for (const key of Object.keys(current[file]).sort()) {
      const currentCount = current[file][key];
      const baselineCount = baseline[file]?.[key] ?? 0;
      if (currentCount > baselineCount) {
        violations.push({
          file,
          key,
          baseline: baselineCount,
          current: currentCount,
        });
      }
    }
  }
  return violations;
}

const loadBaseline = () => {
  if (!fs.existsSync(baselinePath)) return {};
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8')).files ?? {};
};

const sortedCounts = (counts) => {
  const sorted = {};
  for (const file of Object.keys(counts).sort()) {
    sorted[file] = {};
    for (const key of Object.keys(counts[file]).sort()) {
      sorted[file][key] = counts[file][key];
    }
  }
  return sorted;
};

const countFindings = (counts) =>
  Object.values(counts).reduce(
    (total, rules) => total + Object.values(rules).reduce((sum, count) => sum + count, 0),
    0,
  );

const printFatalMessages = (fatalMessages) => {
  console.error('[lint:baseline] Fatal ESLint parser/configuration failures:');
  for (const finding of fatalMessages) {
    console.error(`  ${finding.file}: ${finding.message}`);
  }
};

const printViolations = (violations) => {
  console.error('[lint:baseline] ESLint debt increased:');
  for (const violation of violations) {
    console.error(
      `  ${violation.file} ${violation.key}: ${violation.current} (baseline ${violation.baseline})`,
    );
  }
};

const loadResults = async (resultsPath) => {
  if (resultsPath) {
    return JSON.parse(fs.readFileSync(path.resolve(resultsPath), 'utf8'));
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crystalball-eslint-baseline-'));
  const outputPath = path.join(tempDir, 'results.json');
  const eslintBin = path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');
  try {
    const result = await runCommandWithProgress(
      process.execPath,
      [eslintBin, '.', '--format', 'json', '--output-file', outputPath],
      { label: 'Repository ESLint baseline', stdio: 'inherit' },
    );
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`ESLint exited with code ${result.exitCode}`);
    }
    return JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

async function runCli() {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const force = args.includes('--force');
  const resultsIndex = args.indexOf('--results');
  const resultsPath = resultsIndex === -1 ? null : args[resultsIndex + 1];
  if (resultsIndex !== -1 && !resultsPath) {
    console.error('[lint:baseline] --results requires a JSON file path.');
    process.exitCode = 1;
    return;
  }

  console.log('[lint:baseline] Scanning the full repository with ESLint.');
  const results = await loadResults(resultsPath);
  const { counts, fatalMessages } = summarizeLintResults(results);
  if (fatalMessages.length > 0) {
    printFatalMessages(fatalMessages);
    process.exitCode = 1;
    return;
  }

  const baseline = loadBaseline();
  const violations = compareLintCounts(counts, baseline);

  if (update) {
    if (violations.length > 0 && !force) {
      printViolations(violations);
      console.error('[lint:baseline] Refusing to raise the baseline. Use --force only for an intentional initial reset.');
      process.exitCode = 1;
      return;
    }
    const files = sortedCounts(counts);
    fs.writeFileSync(
      baselinePath,
      `${JSON.stringify({
        note: 'Per-file ESLint finding counts. Managed by scripts/lint-baseline.mjs --update. Counts may only decrease.',
        files,
      }, null, 2)}\n`,
    );
    console.log(`[lint:baseline] Baseline written: ${Object.keys(files).length} files, ${countFindings(files)} findings.`);
    process.exitCode = 0;
    return;
  }

  if (violations.length > 0) {
    printViolations(violations);
    console.error('[lint:baseline] Fix the new findings; do not raise the baseline.');
    process.exitCode = 1;
    return;
  }

  const findingCount = countFindings(counts);
  const baselineCount = countFindings(baseline);
  const improvement = baselineCount - findingCount;
  const suffix = improvement > 0
    ? ` Debt dropped by ${improvement}; run npm run lint:baseline:update to ratchet it down.`
    : '';
  console.log(`[lint:baseline] OK — ${findingCount} existing findings, no increases.${suffix}`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) await runCli();
