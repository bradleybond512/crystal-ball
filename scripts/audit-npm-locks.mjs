#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const projects = ['.', '.github/tools/codex', 'marketing-site', 'scripts', 'tools/cb-control', 'tools/mcp-server'];
const vendors = new Map([['.', ['texture-compressor', 'vendor/texture-compressor-safe']], ['marketing-site', ['braces', 'vendor/braces']]]);
const sidecar = 'src-tauri/sidecar/package.json';
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const npmBin = path.join(path.dirname(process.execPath), 'npm');
// Use the same trusted parser, graph resolver and semver as the npm binary running the audit.
const npmRequire = createRequire(realpathSync(npmBin));
const Arborist = npmRequire('@npmcli/arborist');
const semver = npmRequire('semver');
const npa = npmRequire('npm-package-arg');
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const registry = 'https://registry.npmjs.org/';
const maxBytes = 8 * 1024 * 1024;

class AuditFailure extends Error {}
function check(ok, message) {
  if (!ok) throw new AuditFailure(message);
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function git(repo, args) {
  return execFileSync('/usr/bin/git', args, {
    cwd: repo, encoding: 'utf8', timeout: 30_000, maxBuffer: maxBytes,
    env: { PATH: '/usr/bin:/bin', GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function inventory(repo) {
  const expected = new Set([sidecar]);
  for (const project of projects) {
    expected.add(path.join(project, 'package.json'));
    expected.add(path.join(project, 'package-lock.json'));
    const vendor = vendors.get(project);
    if (vendor) expected.add(path.join(project, vendor[1], 'package.json'));
  }
  const blobs = new Map();
  const tree = git(repo, ['ls-tree', '-rz', '--full-tree', 'HEAD']);
  for (const entry of tree.split('\0')) {
    const tab = entry.indexOf('\t');
    const file = entry.slice(tab + 1);
    if (!/^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/i.test(path.basename(file))) continue;
    check(expected.has(file), 'unclassified manifest or lockfile');
    const [mode, type, sha] = entry.slice(0, tab).split(' ');
    check(type === 'blob' && (mode === '100644' || mode === '100755'), 'manifest or lockfile is not a regular Git blob');
    blobs.set(file, sha);
  }
  check(blobs.size === expected.size, 'required manifest or lockfile is missing');
  return file => JSON.parse(git(repo, ['cat-file', 'blob', blobs.get(file)]));
}

function validateSpec(name, spec, vendor) {
  check(packageName.test(name) && typeof spec === 'string', 'invalid dependency identity or spec');
  if (vendor && name === vendor[0] && spec === 'file:' + vendor[1]) return;
  const parsed = npa.resolve(name, spec);
  check(parsed.registry && (parsed.type !== 'alias' || (parsed.subSpec?.registry && packageName.test(parsed.subSpec.name))),
    'nonregistry dependency spec');
}

function validateManifest(manifest, locked, vendor) {
  check(object(manifest) && object(locked) && typeof manifest.name === 'string' && packageName.test(manifest.name)
    && (!Object.hasOwn(locked, 'name') || locked.name === manifest.name)
    && typeof manifest.version === 'string' && semver.valid(manifest.version) === manifest.version && manifest.version === locked.version,
    'inconsistent project identity');
  check(!Object.hasOwn(manifest, 'workspaces') && !Object.hasOwn(locked, 'workspaces'), 'unclassified workspace graph');
  for (const field of dependencyFields) {
    check(isDeepStrictEqual(manifest[field] ?? {}, locked[field] ?? {}), 'manifest dependency declarations differ from lock');
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) validateSpec(name, spec, vendor);
  }
}

function checkOverrides(overrides, vendor) {
  check(object(overrides), 'invalid override graph');
  for (const [selector, replacement] of Object.entries(overrides)) {
    const key = npa(selector === '.' ? 'self' : selector);
    check(key.registry && packageName.test(key.name), 'invalid override selector');
    if (object(replacement)) checkOverrides(replacement, vendor);
    else if (typeof replacement === 'string' && replacement.startsWith('$')) {
      check(packageName.test(replacement.slice(1)), 'invalid override reference');
    } else validateSpec(key.name, replacement, vendor);
  }
}

function validateEntry(location, pkg, vendor) {
  check(object(pkg), 'invalid lockfile package');
  for (const field of dependencyFields) {
    check(object(pkg[field] ?? {}), 'invalid dependency map');
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) validateSpec(name, spec, vendor);
  }
  if (location === '') return;
  const isVendor = vendor && location === vendor[1];
  const segments = location.split('node_modules/');
  check(isVendor || (segments.shift() === '' && segments.every((segment, i) => {
    const last = i === segments.length - 1;
    return (last || segment.endsWith('/')) && packageName.test(last ? segment : segment.slice(0, -1));
  })), 'unexpected package location');
  if (pkg.link === true) {
    check(vendor && location === 'node_modules/' + vendor[0] && pkg.resolved === vendor[1], 'unexpected package link');
    return;
  }
  const name = pkg.name ?? (isVendor ? vendor[0] : segments.at(-1));
  check(typeof name === 'string' && packageName.test(name) && typeof pkg.version === 'string' && semver.valid(pkg.version) === pkg.version, 'invalid package name or version');
  if (isVendor) return;
  const tarball = registry + name + '/-/' + path.basename(name) + '-' + pkg.version + '.tgz';
  check(pkg.resolved === tarball || (pkg.inBundle === true && !pkg.resolved && location.includes('/node_modules/')),
    'package tarball does not match registry identity');
}

function writeJson(dir, file, value) {
  const dest = path.join(dir, file);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(value));
}

async function prepare(project, read, dir) {
  const manifest = read(path.join(project, 'package.json'));
  const lock = read(path.join(project, 'package-lock.json'));
  const vendor = vendors.get(project);
  check(lock.lockfileVersion === 3 && object(lock.packages) && lock.name === manifest.name
    && lock.version === manifest.version && lock.packages['']?.name === manifest.name, 'unsupported or inconsistent npm lockfile');
  validateManifest(manifest, lock.packages[''], vendor);
  if (manifest.overrides) checkOverrides(manifest.overrides, vendor);
  const locations = Object.keys(lock.packages);
  check(locations.length > 1, 'empty dependency graph');
  for (const [location, pkg] of Object.entries(lock.packages)) validateEntry(location, pkg, vendor);
  if (vendor) {
    const vendorFile = path.join(vendor[1], 'package.json');
    const vendored = read(path.join(project, vendorFile));
    check(vendored.name === vendor[0] && lock.packages['node_modules/' + vendor[0]]?.resolved === vendor[1], 'vendored package is not linked by parent lock');
    validateManifest(vendored, lock.packages[vendor[1]]);
    writeJson(dir, vendorFile, vendored);
  }
  writeJson(dir, 'package.json', manifest);
  writeJson(dir, 'package-lock.json', lock);
  const tree = await new Arborist({ path: dir, offline: true, ignoreScripts: true, packageLockOnly: true, legacyPeerDeps: project === '.' }).loadVirtual();
  check(tree.inventory.size === locations.length, 'incomplete virtual dependency tree');
  const versions = new Map();
  for (const node of tree.inventory.values()) {
    if (!node.isRoot) {
      const installed = versions.get(node.packageName) ?? new Set();
      installed.add(node.version);
      versions.set(node.packageName, installed);
    }
    if (!node.isRoot && !node.isLink && node.packageName !== node.name && node.location !== vendor?.[1]) {
      const edges = [...node.edgesIn];
      check(edges.length > 0 && edges.every(edge => npa.resolve(edge.name, edge.spec).subSpec?.name === node.packageName),
        'uncorroborated package alias');
    }
    for (const edge of node.edgesOut.values()) {
      check(!edge.error && (edge.to || edge.type === 'peerOptional'), 'missing or inconsistent dependency edge');
    }
  }
  return { packages: lock.packages, versions };
}

// npm can normalize malformed bulk JSON (including null) into a successful empty report.
// Check the registry independently against the actual locked versions, then retain npm's
// own report as well: npm additionally computes vulnerabilities inherited by dependents.
async function directFindings(versions, registryFetch) {
  const payload = Object.fromEntries([...versions].map(([name, installed]) => [name, [...installed]]));
  const response = await registryFetch(registry + '-/npm/v1/security/advisories/bulk', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    redirect: 'error', signal: AbortSignal.timeout(60_000),
  });
  check(response.status === 200 && response.body, 'bulk advisory service unavailable');
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    check(size <= maxBytes, 'bulk advisory response too large');
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  check(object(body), 'invalid bulk advisory response');
  const matches = new Map();
  for (const [name, advisories] of Object.entries(body)) {
    const installed = versions.get(name);
    check(installed && Array.isArray(advisories) && advisories.length > 0, 'unexpected bulk advisory entry');
    for (const item of advisories) {
      check(Number.isSafeInteger(item?.id) && item.id > 0 && typeof item.title === 'string' && item.title.length > 0
        && severities.includes(item.severity) && typeof item.vulnerable_versions === 'string'
        && item.vulnerable_versions.length > 0 && semver.validRange(item.vulnerable_versions), 'malformed bulk advisory');
      if ([...installed].some(version => semver.satisfies(version, item.vulnerable_versions, { includePrerelease: true }))) {
        const rank = severities.indexOf(item.severity);
        matches.set(name, Math.max(matches.get(name) ?? -1, rank));
      }
    }
  }
  return matches;
}

function findings(result, packages, direct) {
  check(!result.error && !result.signal && (result.status === 0 || result.status === 1), 'npm audit unavailable');
  const report = JSON.parse(result.stdout);
  const counts = report?.metadata?.vulnerabilities;
  check(report?.auditReportVersion === 2 && !report.error && object(report.vulnerabilities) && object(counts),
    'invalid npm audit report');
  check(report.metadata.dependencies?.total === Object.keys(packages).length - 1, 'incomplete npm dependency census');
  const census = report.metadata.dependencies;
  for (const group of ['prod', 'dev', 'optional', 'peer', 'peerOptional']) {
    check(Number.isSafeInteger(census[group]) && census[group] >= 0 && census[group] <= census.total + 1,
      'invalid dependency class counts');
  }
  const records = Object.entries(report.vulnerabilities);
  for (const [name, detail] of records) {
    check(packageName.test(name) && detail?.name === name && severities.includes(detail.severity)
      && Array.isArray(detail.via) && detail.via.length > 0 && Array.isArray(detail.nodes) && detail.nodes.length > 0
      && detail.nodes.every(location => typeof location === 'string' && location !== '' && Object.hasOwn(packages, location)), 'incomplete advisory detail');
  }
  for (const severity of severities) {
    check(counts[severity] === records.filter(([, detail]) => detail.severity === severity).length, 'inconsistent severity counts');
  }
  check(counts.total === records.length, 'inconsistent vulnerability total');
  for (const [name, rank] of direct) {
    const npmRank = severities.indexOf(report.vulnerabilities[name]?.severity);
    check(npmRank >= rank, 'npm omitted or downgraded direct bulk finding ' + name + ':' + severities[rank]);
  }
  const blocked = counts.high + counts.critical > 0;
  check(result.status === Number(blocked), 'npm exit status contradicts advisory report');
  return { blocked, counts, records };
}

export async function auditLocks(repo, runNpm = spawnSync, log = console.log, registryFetch = fetch) {
  const temp = mkdtempSync(path.join(tmpdir(), 'cb-npm-audit-'));
  try {
    const read = inventory(repo);
    const marker = read(sidecar);
    check(object(marker) && marker.name === 'sidecar' && marker.type === 'module'
      && typeof marker.version === 'string' && semver.valid(marker.version) === marker.version
      && Object.keys(marker).every(key => ['name', 'version', 'type'].includes(key)), 'sidecar is no longer a marker-only manifest');
    const userconfig = path.join(temp, 'user.npmrc'), globalconfig = path.join(temp, 'global.npmrc');
    writeFileSync(userconfig, ''); writeFileSync(globalconfig, '');
    let ok = true;
    for (const project of projects) {
      try {
        const dir = path.join(temp, String(projects.indexOf(project)));
        const { packages, versions } = await prepare(project, read, dir);
        const direct = await directFindings(versions, registryFetch);
        const result = runNpm(npmBin, [
          'audit', '--package-lock-only', '--ignore-scripts', '--include=dev', '--include=optional', '--include=peer',
          '--audit-level=high', '--json', '--registry=' + registry, '--userconfig=' + userconfig, '--globalconfig=' + globalconfig,
        ], { cwd: dir, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: temp },
          timeout: 120_000, maxBuffer: maxBytes, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const { blocked, counts, records } = findings(result, packages, direct);
        log('[npm-audit] ' + project + ': ' + (Object.keys(packages).length - 1) + ' dependencies; ' +
          severities.map(level => counts[level] + ' ' + level).join(', ') +
          (records.length ? ' (' + records.map(([name, v]) => name + ':' + v.severity).join(', ') + ')' : ''));
        if (blocked) ok = false;
      } catch (error) {
        ok = false;
        log('[npm-audit] ' + project + ': unavailable — ' + (error instanceof AuditFailure ? error.message : 'cannot validate lockfile or registry response'));
      }
    }
    return ok;
  } catch (error) {
    log('[npm-audit] inventory unavailable — ' + (error instanceof AuditFailure ? error.message : 'cannot read tracked Git blobs'));
    return false;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  process.exitCode = await auditLocks(process.cwd()) ? 0 : 1;
}
