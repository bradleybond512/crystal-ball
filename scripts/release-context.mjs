#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseCargoPackageMetadata, parseCargoLockVersion } from './release-doctor.mjs';
import {
  buildReleaseName,
  buildReleaseTag,
  getReleaseProductName,
  getDesktopIdentity,
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
  ['--release-tag-input', 'releaseTagInput'],
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
 releaseTagInput: '',
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
  if (!['build', 'publish'].includes(options.publishMode)) {
 throw new Error(`Unsupported publish mode: ${options.publishMode}`);
  }
  if (options.event === 'workflow_dispatch' && options.publishMode === 'build' && options.releaseTagInput) {
 throw new Error('release_tag is only valid in publish mode');
  }
  if (options.event === 'workflow_dispatch' && options.publishMode === 'publish' && !options.releaseTagInput) {
 throw new Error('Missing release_tag for publish-mode workflow_dispatch');
  }
  if (options.event === 'workflow_dispatch' && options.publishMode !== 'publish') {
 options.variant = options.variant || 'full';
 return;
  }
  if (options.event === 'push' && !options.ref) {
 throw new Error('Missing --ref for tag-driven release context');
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

export function resolveAnnotatedTagCommit(tag, git = runCommand) {
  const ref = `refs/tags/${tag}`;
  if (git('git', ['cat-file', '-t', ref]) !== 'tag') {
 throw new Error(`Release tag ${tag} must be annotated`);
  }
  return git('git', ['rev-parse', `${ref}^{commit}`]);
}

export function selectReleaseSourceCommit({ event, refName, releaseTagInput = '', publishMode = 'build', sha }, resolveTag = resolveAnnotatedTagCommit) {
  if (!['push', 'workflow_dispatch'].includes(event)) throw new Error(`Unsupported release event: ${event}`);
  if (!['build', 'publish'].includes(publishMode)) throw new Error(`Unsupported publish mode: ${publishMode}`);
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Invalid event SHA');
  if (event === 'workflow_dispatch' && publishMode === 'build') {
 if (releaseTagInput) throw new Error('release_tag is only valid in publish mode');
 return sha;
  }
  const releaseRef = event === 'workflow_dispatch' ? releaseTagInput : refName;
  if (!releaseRef) throw new Error('Missing release_tag for publish-mode workflow_dispatch');
  const tag = parseReleaseRef(releaseRef).tag;
  const tagSha = resolveTag(tag);
  if (!/^[a-f0-9]{40}$/i.test(tagSha)) throw new Error('Invalid tagged commit SHA');
  if (sha.toLowerCase() !== tagSha.toLowerCase()) {
 throw new Error(event === 'push'
   ? 'Tag commit does not match event SHA'
   : 'Source commit differs from workflow event SHA; refusing misleading provenance');
  }
  return tagSha;
}

export async function readSynchronizedVersions(commitSha, readVersionFile = (sha, file) => runCommand('git', ['show', `${sha}:${file}`])) {
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error('Invalid source commit SHA');
  const read = (file) => readVersionFile(commitSha, file);
  const packageJson = JSON.parse(read('package.json'));
  const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json'));
  const cargoToml = read('src-tauri/Cargo.toml');
  const cargoLock = read('src-tauri/Cargo.lock');
  const infoPlist = read('src-tauri/Info.plist');
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
  // workflows). Recovery supplies --release-tag-input <tag>; both paths
  // resolve that annotated tag to the immutable commit used for metadata
  // and artifact builds.
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
  const checkoutSha = runCommand('git', ['rev-parse', 'HEAD']);
  if (checkoutSha.toLowerCase() !== options.sha.toLowerCase()) {
 throw new Error(`Context checkout ${checkoutSha} does not match event SHA ${options.sha}`);
  }
  const sourceSha = selectReleaseSourceCommit({
 event: options.event,
 refName: options.ref,
 releaseTagInput: options.releaseTagInput,
 publishMode: options.publishMode,
 sha: options.sha,
  });
  const versions = await readSynchronizedVersions(sourceSha);
  const mismatches = validateVersionSync(versions);
  if (mismatches.length > 0) {
 throw new Error(`Version files are out of sync: ${mismatches.join(', ')}`);
  }

  const context = resolveReleaseContext({
 event: options.event,
 refName: options.event === 'workflow_dispatch' && options.publishMode === 'publish'
   ? options.releaseTagInput : options.ref,
 inputVariant: options.variant,
 packageVersion: versions.packageVersion,
 sha: sourceSha,
 publishMode: options.publishMode,
  });

  if (options.enforceMain && context.publish) {
 const branches = runCommand('git', ['branch', '-r', '--contains', sourceSha]);
 if (!commitIsOnRemoteMain(branches)) {
 throw new Error(`Tagged commit ${sourceSha} is not on origin/main`);
 }
  }

  context.tauriConfig = getDesktopIdentity(context.variant).config;
  context.bundleIdentifier = getDesktopIdentity(context.variant).identifier;
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
