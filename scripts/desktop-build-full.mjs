#!/usr/bin/env node
// `npm run desktop:build:full [-- <packaging flags>]` (R4-SEC-002).
//
// Replaces the predesktop:/postdesktop:build:full npm hooks, which
// ignore-scripts=true silently skips. The steps run in order and stop at the
// first failure, so the app is installed only after packaging succeeded:
//   1. download-vault-textures.mjs                 (no arguments)
//   2. desktop-package.mjs --os macos --variant full <every forwarded flag>
//   3. local-install.mjs                           (no arguments)
// Every argument npm appends after `--` goes to packaging, as it did when
// packaging was the npm script itself (for example --sign or --app-only).
// --help, --h or -h prints packaging help only: no download, build or install.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ARGS = Object.freeze(['--os', 'macos', '--variant', 'full']);
const HELP_FLAGS = new Set(['--help', '--h', '-h']);

/** The child scripts to run, in order, for the arguments npm forwarded. */
function buildSteps(forwarded) {
  if (forwarded.some((arg) => HELP_FLAGS.has(arg))) {
    return [{ script: 'desktop-package.mjs', args: [...PACKAGE_ARGS, '--help'] }];
  }
  return [
    { script: 'download-vault-textures.mjs', args: [] },
    { script: 'desktop-package.mjs', args: [...PACKAGE_ARGS, ...forwarded] },
    { script: 'local-install.mjs', args: [] },
  ];
}

function runStep({ script, args }) {
  const result = spawnSync(process.execPath, [path.join(scriptDir, script), ...args], { stdio: 'inherit' });
  if (result.error) {
    console.error(`[desktop:build:full] could not start ${script}: ${result.error.message}`);
    return 1;
  }
  if (result.status === null) {
    console.error(`[desktop:build:full] ${script} was terminated by ${result.signal}`);
    return 1;
  }
  return result.status;
}

/** Runs the steps in order; returns the first non-zero exit code, or 0. */
function runSteps(steps, run = runStep) {
  for (const step of steps) {
    const code = run(step);
    if (code !== 0) {
      console.error(`[desktop:build:full] ${step.script} exited ${code}; stopping before any later step.`);
      return code;
    }
  }
  return 0;
}

// No "is this the entry module?" guard: it compares paths, and through a
// symlinked path (macOS /var -> /private/var) it would skip every step and exit
// 0. Nothing imports this file; running it always runs the build.
process.exitCode = runSteps(buildSteps(process.argv.slice(2)));
