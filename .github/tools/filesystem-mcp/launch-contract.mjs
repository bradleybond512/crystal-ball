import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';

const sha256 = /^[a-f0-9]{64}$/;
const placeholder = /\$\{|\{\{|\$workspaceFolder|%workspaceFolder%/;
function absolute(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\0') || placeholder.test(value) || !path.isAbsolute(value)) {
    throw new Error(`Invalid ${label}: expected an explicit absolute path without placeholders`);
  }
  return value;
}
function directory(value, label) {
  const supplied = absolute(value, label);
  try {
    const canonical = realpathSync(supplied);
    if (!lstatSync(canonical).isDirectory()) throw new Error(`Invalid ${label}: expected directory`);
    return canonical;
  } catch (cause) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(cause?.code)) {
      throw new Error(`Invalid ${label}: directory lookup failed (${cause.code})`, { cause });
    }
    throw cause;
  }
}
export function validateWorkspace(argv) {
  if (!Array.isArray(argv) || argv.length !== 1) throw new Error('Exactly one workspace argument is required');
  return directory(argv[0], 'workspace');
}
export function fixedToolRoot({ home, platform, arch, contentSha256 }) {
  if (platform !== 'darwin' || arch !== 'arm64') throw new Error('Unsupported filesystem runtime platform');
  if (typeof contentSha256 !== 'string' || !sha256.test(contentSha256)) throw new Error('Invalid content digest');
  const canonicalHome = directory(home, 'home');
  if (canonicalHome === path.parse(canonicalHome).root) throw new Error('Invalid home root');
  return path.join(canonicalHome, '.local/share/crystalball/tools/filesystem-mcp/2.2.0-node24.22.2/darwin-arm64', contentSha256);
}
export function buildSpawnSpec({ runtime, server, workspace, env }) {
  absolute(runtime, 'runtime'); absolute(server, 'server');
  const allowed = {};
  for (const key of ['LANG', 'LC_ALL', 'TMPDIR']) {
    const value = env?.[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || value.includes('\0')) throw new Error(`Invalid child environment ${key}`);
      allowed[key] = value;
    }
  }
  return {
    command: runtime,
    args: [server, '--confine-roots', '--', validateWorkspace([workspace])],
    options: { shell: false, detached: false, stdio: ['inherit', 'inherit', 'inherit'], env: allowed },
  };
}
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw new Error('Malformed content manifest');
}
function relativeMember(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')
      || path.posix.isAbsolute(value) || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid manifest member path');
  }
  return value;
}
export function verifyContent(root, manifest) {
  const canonicalRoot = directory(root, 'payload root');
  exactKeys(manifest, ['schemaVersion', 'files', 'symlinks']);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length || !Array.isArray(manifest.symlinks)) {
    throw new Error('Malformed content manifest');
  }
  const entries = new Map(), directories = new Set();
  function register(entry, kind) {
    exactKeys(entry, kind === 'file' ? ['path', 'bytes', 'sha256'] : ['path', 'target']);
    const name = relativeMember(entry.path);
    if (entries.has(name)) throw new Error('Duplicate manifest member');
    entries.set(name, { ...entry, kind });
    let parent = path.posix.dirname(name);
    while (parent !== '.') { directories.add(parent); parent = path.posix.dirname(parent); }
  }
  for (const entry of manifest.files) {
    register(entry, 'file');
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || typeof entry.sha256 !== 'string' || !sha256.test(entry.sha256)) {
      throw new Error('Malformed file identity');
    }
  }
  for (const entry of manifest.symlinks) {
    register(entry, 'symlink');
    if (typeof entry.target !== 'string' || !entry.target || entry.target.includes('\0') || entry.target.includes('\\') || path.posix.isAbsolute(entry.target)) {
      throw new Error('Invalid symlink target');
    }
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entry.path), entry.target));
    if (resolved === '..' || resolved.startsWith('../')) throw new Error('Escaping symlink');
  }
  for (const dir of directories) if (entries.has(dir)) throw new Error('Manifest directory/member collision');
  const seen = new Set();
  function walk(dir, prefix = '') {
    for (const name of readdirSync(dir)) {
      const member = prefix ? `${prefix}/${name}` : name, full = path.join(dir, name), stat = lstatSync(full);
      if (stat.isDirectory()) {
        if (!directories.has(member)) throw new Error(`Unexpected directory: ${member}`);
        walk(full, member);
        continue;
      }
      const entry = entries.get(member);
      if (!entry) throw new Error(`Unexpected payload member: ${member}`);
      if (entry.kind === 'file') {
        if (!stat.isFile() || stat.size !== entry.bytes) throw new Error(`Changed file identity: ${member}`);
        const hash = createHash('sha256').update(readFileSync(full)).digest('hex');
        if (hash !== entry.sha256) throw new Error(`Changed file hash: ${member}`);
      } else {
        if (!stat.isSymbolicLink() || readlinkSync(full) !== entry.target) throw new Error(`Changed symlink: ${member}`);
        const resolved = realpathSync(full);
        if (!resolved.startsWith(canonicalRoot + path.sep)) throw new Error(`Escaping symlink: ${member}`);
        const target = entries.get(path.relative(canonicalRoot, resolved).split(path.sep).join('/'));
        if (!target || target.kind !== 'file') throw new Error(`Unenumerated symlink target: ${member}`);
      }
      seen.add(member);
    }
  }
  walk(canonicalRoot);
  if (seen.size !== entries.size) throw new Error('Missing payload member');
}
