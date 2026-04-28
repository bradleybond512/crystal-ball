#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildReleaseTag, assertSupportedReleaseVariant } from './release-metadata.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const packageJsonPath = path.join(repoRoot, 'package.json');
const packageLockPath = path.join(repoRoot, 'package-lock.json');
const tauriConfPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(repoRoot, 'src-tauri', 'Cargo.toml');
const cargoLockPath = path.join(repoRoot, 'src-tauri', 'Cargo.lock');

function parseArgs(argv) {
  const options = {
 allowExistingTargetRelease: false,
 remote: '',
 variant: 'full',
  };

  for (let i = 0; i < argv.length; i += 1) {
 const arg = argv[i];
 if (arg === '--allow-existing-target-release') {
 options.allowExistingTargetRelease = true;
 continue;
 }
 if (arg === '--remote') {
 options.remote = argv[i + 1] ?? '';
 i += 1;
 continue;
 }
 if (arg.startsWith('--remote=')) {
 options.remote = arg.slice('--remote='.length);
 continue;
 }
 if (arg === '--variant') {
 options.variant = argv[i + 1] ?? '';
 i += 1;
 continue;
 }
 if (arg.startsWith('--variant=')) {
 options.variant = arg.slice('--variant='.length);
 continue;
 }
 throw new Error(`Unknown argument: ${arg}`);
  }

  assertSupportedReleaseVariant(options.variant);
  return options;
}

export function parseCargoPackageMetadata(cargoToml) {
  const packageSectionRegex = /\[package\][\s\S]*?(?=\n\[|$)/;
  const packageSectionMatch = cargoToml.match(packageSectionRegex);
  if (!packageSectionMatch) {
 throw new Error('Could not find [package] section in src-tauri/Cargo.toml');
  }

  const nameMatch = packageSectionMatch[0].match(/^name\s*=\s*"([^"]+)"\s*$/m);
  if (!nameMatch) {
 throw new Error('Could not find package name in src-tauri/Cargo.toml');
  }

  const versionMatch = packageSectionMatch[0].match(/^version\s*=\s*"([^"]+)"\s*$/m);
  if (!versionMatch) {
 throw new Error('Could not find package version in src-tauri/Cargo.toml');
  }

  return {
 name: nameMatch[1],
 version: versionMatch[1],
  };
}

export function parseCargoLockVersion(cargoLock, packageName) {
  const escapedPackageName = packageName.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const packageBlockRegex = new RegExp(String.raw`\[\[package\]\]\nname = "${escapedPackageName}"\nversion = "([^"]+)"`, 'm');
  const versionMatch = cargoLock.match(packageBlockRegex);
  if (!versionMatch) {
 throw new Error(`Could not find ${packageName} package version in src-tauri/Cargo.lock`);
  }
  return versionMatch[1];
}

function buildTargetTag(version, variant = 'full') {
  return buildReleaseTag(version, variant);
}

export function findVersionMismatches(versionsByFile) {
  const targetVersion = versionsByFile['package.json'];
  if (typeof targetVersion !== 'string' || targetVersion.trim() === '') {
 throw new Error('package.json is missing a valid version');
  }

  return Object.entries(versionsByFile)
 .filter(([filePath]) => filePath !== 'package.json')
 .filter(([, version]) => version !== targetVersion)
 .map(([filePath, version]) => `${filePath} (${version} != ${targetVersion})`);
}

export function findDuplicateDraftReleaseTags(releases) {
  const draftCounts = new Map();

  for (const release of releases) {
 if (!release?.isDraft || typeof release.tagName !== 'string') {
 continue;
 }
 draftCounts.set(release.tagName, (draftCounts.get(release.tagName) ?? 0) + 1);
  }

  return [...draftCounts.entries()]
 .filter(([, count]) => count > 1)
 .map(([tagName]) => tagName)
 .sort();
}

export function findReleaseStateIssues({
  targetTag,
  remoteTags,
  releases,
  allowExistingTargetRelease = false,
  // When the strict-mode caller can prove the existing tag points at the
  // current HEAD AND a non-draft release exists for it, that's the
  // healthy "we just shipped this version" state, not a stale-tag
  // failure. The flag stays opt-in so older callers don't change shape.
  tagPointsAtHead = false,
}) {
  const issues = [];
  const hasRemoteTargetTag = remoteTags.has(targetTag);
  const releasesForTarget = releases.filter((release) => release?.tagName === targetTag);
  const hasPublishedReleaseForTarget = releasesForTarget.some((release) => release && release.isDraft !== true);
  const duplicateDraftTags = findDuplicateDraftReleaseTags(releases);

  // The just-shipped state: tag exists AND points at HEAD AND a published
  // (non-draft) GitHub release for that tag exists. Treat as healthy.
  const justShipped = hasRemoteTargetTag && tagPointsAtHead && hasPublishedReleaseForTarget;

  if (hasRemoteTargetTag && !allowExistingTargetRelease && !justShipped) {
 issues.push(`Remote tag already exists for target release: ${targetTag}`);
  }

  if (hasRemoteTargetTag && releasesForTarget.length === 0 && !allowExistingTargetRelease) {
 issues.push(`Remote tag exists without a GitHub release for target tag: ${targetTag}`);
  }

  for (const duplicateTag of duplicateDraftTags) {
 issues.push(`Multiple draft releases exist for tag: ${duplicateTag}`);
  }

  return issues;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
 cwd: repoRoot,
 encoding: 'utf8',
 ...options,
  });

  if (result.status !== 0) {
 const stderr = result.stderr?.trim();
 throw new Error(stderr || `${command} ${args.join(' ')} failed`);
  }

  return result.stdout.trim();
}

function resolveRemoteName(preferredRemote = 'origin') {
  const remotes = runCommand('git', ['remote'])
 .split('\n')
 .map((line) => line.trim())
 .filter(Boolean);

  if (remotes.includes(preferredRemote)) {
 return preferredRemote;
  }

  if (remotes.includes('macos')) {
 return 'macos';
  }

  if (remotes.length > 0) {
 return remotes[0];
  }

  throw new Error('No git remotes are configured');
}

function normalizeRepoSlug(remoteUrl) {
  const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) {
 return sshMatch[1];
  }

  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
 return httpsMatch[1];
  }

  throw new Error(`Unsupported origin remote URL: ${remoteUrl}`);
}

async function readVersionFiles() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const packageLock = JSON.parse(await readFile(packageLockPath, 'utf8'));
  const tauriConf = JSON.parse(await readFile(tauriConfPath, 'utf8'));
  const cargoToml = await readFile(cargoTomlPath, 'utf8');
  const cargoLock = await readFile(cargoLockPath, 'utf8');
  const cargoPackage = parseCargoPackageMetadata(cargoToml);

  return {
 'package.json': packageJson.version,
 'package-lock.json': packageLock.version ?? packageLock.packages?.['']?.version ?? '',
 'src-tauri/tauri.conf.json': tauriConf.version,
 'src-tauri/Cargo.toml': cargoPackage.version,
 'src-tauri/Cargo.lock': parseCargoLockVersion(cargoLock, cargoPackage.name),
  };
}

async function fetchRemoteReleaseState(targetTag, remoteName = 'origin') {
  const resolvedRemote = resolveRemoteName(remoteName);
  const repoSlug = process.env.GITHUB_REPOSITORY
 || normalizeRepoSlug(runCommand('git', ['remote', 'get-url', resolvedRemote]));

  // ls-remote also dereferences annotated tags via `--tags --refs`. The
  // first column is the SHA; the second is the ref. For an annotated
  // tag we ask for `refs/tags/<tag>^{}` (the dereferenced commit), which
  // tells us the commit the tag actually labels.
  const remoteTagOutput = runCommand('git', ['ls-remote', '--tags', resolvedRemote, `refs/tags/${targetTag}`, `refs/tags/${targetTag}^{}`]);
  const remoteTags = new Set(remoteTagOutput ? [targetTag] : []);

  // Pick the dereferenced (peeled) SHA when present; otherwise the
  // lightweight-tag SHA (which already points at the commit).
  let tagCommitSha = '';
  for (const line of remoteTagOutput.split('\n')) {
 const trimmed = line.trim();
 if (!trimmed) continue;
 const [sha, ref] = trimmed.split(/\s+/, 2);
 if (ref === `refs/tags/${targetTag}^{}`) {
 tagCommitSha = sha;
 break;
 }
 if (ref === `refs/tags/${targetTag}` && !tagCommitSha) {
 tagCommitSha = sha;
 }
  }

  // Resolve the SHA we're auditing against. CI sets GITHUB_SHA on push
  // events; locally we fall back to HEAD.
  const headSha = (process.env.GITHUB_SHA?.trim() || runCommand('git', ['rev-parse', 'HEAD'])).trim();
  const tagPointsAtHead = Boolean(tagCommitSha) && tagCommitSha === headSha;

  const releases = JSON.parse(
 runCommand('gh', ['api', `repos/${repoSlug}/releases?per_page=100`])
  ).map((release) => ({
 tagName: release.tag_name,
 isDraft: release.draft === true,
  }));

  return { remoteTags, releases, tagPointsAtHead };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const versionsByFile = await readVersionFiles();
  const targetVersion = versionsByFile['package.json'];
  const targetTag = buildTargetTag(targetVersion, options.variant);

  const issues = [
 ...findVersionMismatches(versionsByFile),
  ];

  const { remoteTags, releases, tagPointsAtHead } = await fetchRemoteReleaseState(targetTag, options.remote || 'origin');
  issues.push(
 ...findReleaseStateIssues({
 targetTag,
 remoteTags,
 releases,
 allowExistingTargetRelease: options.allowExistingTargetRelease,
 tagPointsAtHead,
 }),
  );

  if (issues.length > 0) {
 console.error(`[release:doctor] Blocked for ${targetTag}:`);
 for (const issue of issues) {
 console.error(`- ${issue}`);
 }
 process.exit(1);
  }

  console.log(`[release:doctor] OK for ${targetTag}.`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  // eslint-disable-next-line unicorn/prefer-top-level-await -- wrapped in isCli guard so top-level await would run during imports
  main().catch((error) => {
 console.error(`[release:doctor] Failed: ${error instanceof Error ? error.message : String(error)}`);
 process.exit(1);
  });
}
