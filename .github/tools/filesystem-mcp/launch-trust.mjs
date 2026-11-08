import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fixedToolRoot, validateWorkspace, verifyContent, buildSpawnSpec } from './launch-contract.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = /^[a-f0-9]{64}$/;
export function validateRuntimeManifest(value) {
  const keys = ['schemaVersion', 'nodeVersion', 'packageVersion', 'platform', 'arch', 'contentManifestSha256', 'runtimeSha256', 'packageSha256', 'lockSha256'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== keys.sort().join('\0')
      || value.schemaVersion !== 1 || value.nodeVersion !== '24.22.2' || value.packageVersion !== '2.2.0'
      || value.platform !== 'darwin' || value.arch !== 'arm64'
      || ['contentManifestSha256', 'runtimeSha256', 'packageSha256', 'lockSha256'].some((key) => typeof value[key] !== 'string' || !digest.test(value[key]))) {
    throw new Error('Invalid trusted runtime manifest schema/version/platform/digest');
  }
}
export function validateTrustedBytes(runtime, content, pkg, lock) {
  validateRuntimeManifest(runtime);
  for (const [bytes, key] of [[content, 'contentManifestSha256'], [pkg, 'packageSha256'], [lock, 'lockSha256']]) {
    if (hash(bytes) !== runtime[key]) throw new Error(`Trusted ${key} identity mismatch`);
  }
  return JSON.parse(content.toString('utf8'));
}
// These parameters are an internal test seam, not a CLI/config/environment override.
// Production launch.mjs supplies actual process identity and os.homedir directly.
export function prepareLaunch({ argv, home, platform, arch, bootstrapVersion, env }) {
  if (!/^22\.\d+\.\d+$/.test(bootstrapVersion)) throw new Error('Filesystem launcher requires the project Node 22 bootstrap');
  const workspace = validateWorkspace(argv);
  const runtime = JSON.parse(readFileSync(path.join(directory, 'runtime-manifest.json'), 'utf8'));
  const content = readFileSync(path.join(directory, 'content-manifest.json'));
  const pkg = readFileSync(path.join(directory, 'package.json')), lock = readFileSync(path.join(directory, 'package-lock.json'));
  const manifest = validateTrustedBytes(runtime, content, pkg, lock);
  if (platform !== runtime.platform || arch !== runtime.arch) throw new Error('Unsupported filesystem runtime platform');
  const root = fixedToolRoot({ home, platform, arch, contentSha256: runtime.contentManifestSha256 });
  verifyContent(root, manifest);
  const binary = path.join(root, 'runtime/bin/node');
  if (hash(readFileSync(binary)) !== runtime.runtimeSha256
      || hash(readFileSync(path.join(root, 'server/package.json'))) !== runtime.packageSha256
      || hash(readFileSync(path.join(root, 'server/package-lock.json'))) !== runtime.lockSha256) {
    throw new Error('Installed runtime/package/lock identity mismatch');
  }
  return buildSpawnSpec({ runtime: binary, server: path.join(root, 'server/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js'), workspace, env });
}
