#!/usr/bin/env node
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseCargoPackageMetadata, parseCargoLockVersion } from './release-doctor.mjs';
import {
  buildReleaseName,
  buildReleaseTag,
  getReleaseProductName,
  parseReleaseRef,
} from './release-metadata.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const VALUE_FLAGS = new Map([
  ['--event', 'event'],
  ['--ref', 'ref'],
  ['--variant', 'variant'],
  ['--sha', 'sha'],
  ['--github-output', 'githubOutput'],
  ['--publish-mode', 'publishMode'],
]);

const BOOLEAN_FLAGS = new Map([
  ['--no-enforce-main', { key: 'enforceMain', value: false }],
]);

function readValueFlag(arg, nextArg) {
  if (VALUE_FLAGS.has(arg)) {
 return { key: VALUE_FLAGS.get(arg), value: nextArg ?? '', consumedNext: true };
  }
  for (const [flag, key] of VALUE_FLAGS) {
 const prefix = `${flag}=`;
 if (arg.startsWith(prefix)) {
 return { key, value: arg.slice(prefix.length), consumedNext: false };
 }
  }
  return null;
}

function parseArgs(argv) {
  const options = {
 event: '',
 ref: '',
 variant: '',
 sha: '',
 githubOutput: '',
 enforceMain: true,
 publishMode: 'build',
  };

  for (let i = 0; i < argv.length; i += 1) {
 const arg = argv[i];
 const valueFlag = readValueFlag(arg, argv[i + 1]);
 if (valueFlag) {
 options[valueFlag.key] = valueFlag.value;
 if (valueFlag.consumedNext) i += 1;
 continue;
 }
 const boolFlag = BOOLEAN_FLAGS.get(arg);
 if (boolFlag) {
 options[boolFlag.key] = boolFlag.value;
 continue;
 }
 throw new Error(`Unknown argument: ${arg}`);
  }

  validateParsedOptions(options);
  return options;
}

function validateParsedOptions(options) {
  if (!['push', 'workflow_dispatch'].includes(options.event)) {
 throw new Error(`Unsupported release event: ${options.event}`);
  }
  if (!options.sha) {
 throw new Error('Missing --sha');
  }
  if (options.event === 'workflow_dispatch' && options.publishMode !== 'publish') {
 options.variant = options.variant || 'full';
 return;
  }
  if (!options.ref) {
 const context = options.event === 'push' ? 'tag-driven release context' : 'publish-mode workflow_dispatch';
 throw new Error(`Missing --ref for ${context}`);
  }
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
 cwd: repoRoot,
 encoding: 'utf8',
  });

  if ((result.status ?? 1) !== 0) {
 throw new Error(result.stderr?.trim() || `${command} ${args.join(' ')} failed`);
  }

  return result.stdout.trim();
}

export async function readSynchronizedVersions() {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const tauriConfPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');
  const cargoTomlPath = path.join(repoRoot, 'src-tauri', 'Cargo.toml');
  const cargoLockPath = path.join(repoRoot, 'src-tauri', 'Cargo.lock');
  const infoPlistPath = path.join(repoRoot, 'src-tauri', 'Info.plist');

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const tauriConf = JSON.parse(await readFile(tauriConfPath, 'utf8'));
  const cargoToml = await readFile(cargoTomlPath, 'utf8');
  const cargoLock = await readFile(cargoLockPath, 'utf8');
  const infoPlist = await readFile(infoPlistPath, 'utf8');
  const cargoPackage = parseCargoPackageMetadata(cargoToml);
  const infoPlistVersionMatch = infoPlist.match(/<key>CFBundleGetInfoString<\/key>\s*<string>Crystal Ball ([^<]+)<\/string>/);

  return {
 packageVersion: packageJson.version,
 tauriVersion: tauriConf.version,
 cargoVersion: cargoPackage.version,
 cargoLockVersion: parseCargoLockVersion(cargoLock, cargoPackage.name),
 infoPlistVersion: infoPlistVersionMatch?.[1] ?? '',
  };
}

export function resolveReleaseContext({ event, refName, inputVariant, packageVersion, sha, publishMode = 'build' }) {
  const shortSha = sha.slice(0, 12);

  // Workflow dispatch with publish_mode=publish is the recovery path when the
  // tag-push trigger was suppressed (e.g. tag pushed by GITHUB_TOKEN from
  // auto-tag.yml, which per GitHub anti-loop rules does not fire downstream
  // workflows). The workflow gets dispatched with --ref <tag> and
  // -f publish_mode=publish; from here it's indistinguishable from a real
  // tag push.
  if (event === 'workflow_dispatch' && publishMode === 'publish') {
 const parsed = parseReleaseRef(refName);
 if (parsed.version !== packageVersion) {
 throw new Error(`Tag ${parsed.tag} does not match package version ${packageVersion}`);
 }
 return {
 publish: true,
 variant: parsed.variant,
 version: parsed.version,
 tag: parsed.tag,
 releaseName: buildReleaseName(parsed.version, parsed.variant),
 productName: getReleaseProductName(parsed.variant),
 commitSha: sha,
 shortSha,
 };
  }

  if (event === 'workflow_dispatch') {
 const variant = inputVariant;
 return {
 publish: false,
 variant,
 version: packageVersion,
 tag: buildReleaseTag(packageVersion, variant),
 releaseName: buildReleaseName(packageVersion, variant),
 productName: getReleaseProductName(variant),
 commitSha: sha,
 shortSha,
 };
  }

  const parsed = parseReleaseRef(refName);
  if (parsed.version !== packageVersion) {
 throw new Error(`Tag ${parsed.tag} does not match package version ${packageVersion}`);
  }

  return {
 publish: true,
 variant: parsed.variant,
 version: parsed.version,
 tag: parsed.tag,
 releaseName: buildReleaseName(parsed.version, parsed.variant),
 productName: getReleaseProductName(parsed.variant),
 commitSha: sha,
 shortSha,
  };
}

export function validateVersionSync(versions) {
  const expected = versions.packageVersion;
  const mismatches = [];
  for (const [label, value] of Object.entries({
 'src-tauri/tauri.conf.json': versions.tauriVersion,
 'src-tauri/Cargo.toml': versions.cargoVersion,
 'src-tauri/Cargo.lock': versions.cargoLockVersion,
 'src-tauri/Info.plist': versions.infoPlistVersion,
  })) {
 if (value !== expected) mismatches.push(`${label} (${value} != ${expected})`);
  }
  return mismatches;
}

export function commitIsOnRemoteMain(branchListOutput) {
  return branchListOutput
 .split('\n')
 .map((line) => line.trim())
 .filter(Boolean)
 .some((line) => line === 'origin/main' || line.endsWith('/origin/main'));
}

async function writeGithubOutputs(outputPath, context) {
  if (!outputPath) return;
  const lines = Object.entries(context)
 .map(([key, value]) => `${key}=${String(value)}`);
  await appendFile(outputPath, `${lines.join('\n')}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const versions = await readSynchronizedVersions();
  const mismatches = validateVersionSync(versions);
  if (mismatches.length > 0) {
 throw new Error(`Version files are out of sync: ${mismatches.join(', ')}`);
  }

  const context = resolveReleaseContext({
 event: options.event,
 refName: options.ref,
 inputVariant: options.variant,
 packageVersion: versions.packageVersion,
 sha: options.sha,
 publishMode: options.publishMode,
  });

  if (options.enforceMain && context.publish) {
 const branches = runCommand('git', ['branch', '-r', '--contains', options.sha]);
 if (!commitIsOnRemoteMain(branches)) {
 throw new Error(`Tagged commit ${options.sha} is not on origin/main`);
 }
 const tagType = runCommand('git', ['cat-file', '-t', context.tag]);
 if (tagType !== 'tag') {
 throw new Error(`Release tag ${context.tag} must be annotated`);
 }
  }

  await writeGithubOutputs(options.githubOutput, context);
  console.log(JSON.stringify(context, null, 2));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  try {
 await main();
  } catch (error) {
 console.error(`[release-context] Failed: ${error instanceof Error ? error.message : String(error)}`);
 process.exit(1);
  }
}
