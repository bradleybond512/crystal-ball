// Test-only finite admission: read exact locked tarballs by SRI, never cache indexes.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmCli } from './mcp-runtime-fixture.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function inside(parent, child) {
  const name = relative(parent, child);
  return name !== '' && name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name);
}
export function lockedTarballs(lock) {
  if (lock.name !== 'crystalball-mcp' || lock.lockfileVersion !== 3 || lock.packages?.['']?.name !== lock.name
      || lock.packages[''].version !== lock.version) throw new Error('Expected the current MCP version-3 lock.');
  return Object.entries(lock.packages).filter(([location]) => location !== '').map(([location, entry]) => {
    if (!/^(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/.test(location)
        || entry.link || typeof entry.version !== 'string' || typeof entry.resolved !== 'string'
        || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? '')) throw new Error(`Unsupported locked tarball: ${location}`);
    const url = new URL(entry.resolved);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password
        || url.search || url.hash || !url.pathname.endsWith('.tgz') || url.href !== entry.resolved) throw new Error(`Non-public locked tarball: ${location}`);
    return { location, version: entry.version, resolved: entry.resolved, integrity: entry.integrity };
  });
}
export async function prepareLockedCache({ source, destination, lockfile }) {
  const cli = npmCli(); const requireNpm = createRequire(cli);
  const cacache = requireNpm('cacache'); const ssri = requireNpm('ssri');
  const sourceCache = realpathSync(source); const cache = realpathSync(destination);
  if (!lstatSync(sourceCache).isDirectory() || !lstatSync(cache).isDirectory() || lstatSync(destination).isSymbolicLink()
      || sourceCache === cache || inside(sourceCache, cache) || inside(cache, sourceCache) || readdirSync(cache).length) {
    throw new Error('Tarball admission requires separate source and fresh empty fixture cache directories.');
  }
  const lockBytes = readFileSync(lockfile); const tuples = lockedTarballs(JSON.parse(lockBytes));
  const bodies = new Map();
  for (const tuple of tuples) {
    if (bodies.has(tuple.integrity)) continue;
    let bytes;
    try { bytes = await cacache.get.byDigest(join(sourceCache, '_cacache'), tuple.integrity, { integrity: tuple.integrity, memoize: false }); }
    catch (cause) { throw new Error(`Missing/corrupt exact locked resource: ${tuple.location}@${tuple.version} ${tuple.integrity}`, { cause }); }
    if (!Buffer.isBuffer(bytes) || !ssri.checkData(bytes, tuple.integrity, { algorithms: ['sha512'] })) throw new Error(`Tarball SRI mismatch: ${tuple.location}`);
    bodies.set(tuple.integrity, { bytes, sha256: hash(bytes), size: bytes.length });
    // The lock's content digest is pacote's primary cache lookup. This finite
    // admission key makes no claim about upstream response headers/signatures.
    await cacache.put(join(cache, '_cacache'), `locked-mcp-tarball:${tuple.integrity}`, bytes, { integrity: tuple.integrity, memoize: false, metadata: { admission: 'current-lock-verified-body' } });
  }
  const manifest = {
    schemaVersion: 1, lockSha256: hash(lockBytes), node: process.version,
    npm: { cli, version: JSON.parse(readFileSync(join(dirname(cli), '../package.json'), 'utf8')).version },
    cacacheVersion: requireNpm('cacache/package.json').version,
    sourceCache, nodeCount: tuples.length, uniqueBodyCount: bodies.size,
    tuples: tuples.map((tuple) => ({ ...tuple, bytes: bodies.get(tuple.integrity).size, sha256: bodies.get(tuple.integrity).sha256 })),
    noNetwork: true, noSourceWrites: true, admission: 'exact-current-lock-SHA512-only; no index/config/log/packument copying',
  };
  const encoded = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(join(cache, 'locked-tarballs.json'), encoded);
  writeFileSync(join(cache, 'locked-tarballs.sha256'), hash(Buffer.from(encoded)) + '\n');
  await verifyLockedCache({ destination: cache, lockfile });
  return manifest;
}
export async function verifyLockedCache({ destination, lockfile }) {
  const requireNpm = createRequire(npmCli()); const cacache = requireNpm('cacache'); const ssri = requireNpm('ssri');
  const bytes = readFileSync(join(destination, 'locked-tarballs.json'));
  if (hash(bytes) !== readFileSync(join(destination, 'locked-tarballs.sha256'), 'utf8').trim()) throw new Error('Resource manifest checksum mismatch.');
  const manifest = JSON.parse(bytes); const lockBytes = readFileSync(lockfile); const tuples = lockedTarballs(JSON.parse(lockBytes));
  if (manifest.lockSha256 !== hash(lockBytes) || manifest.nodeCount !== tuples.length || manifest.tuples.length !== tuples.length
      || manifest.uniqueBodyCount !== new Set(tuples.map((tuple) => tuple.integrity)).size) throw new Error('Resource manifest does not match the current lock graph.');
  for (let i = 0; i < tuples.length; i += 1) {
    const tuple = tuples[i]; const selected = manifest.tuples[i];
    for (const key of ['location', 'version', 'resolved', 'integrity']) if (tuple[key] !== selected[key]) throw new Error('Resource manifest widened the locked graph.');
    const body = await cacache.get.byDigest(join(destination, '_cacache'), tuple.integrity, { integrity: tuple.integrity, memoize: false });
    if (!ssri.checkData(body, tuple.integrity, { algorithms: ['sha512'] }) || hash(body) !== selected.sha256 || body.length !== selected.bytes) throw new Error(`Prepared resource changed: ${tuple.location}`);
  }
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, destination, lockfile] = process.argv.slice(2);
  if (!source || !destination || !lockfile) throw new Error('Expected source cache, fresh fixture cache, current lockfile.');
  const result = await prepareLockedCache({ source, destination, lockfile });
  console.log(JSON.stringify({ lockSha256: result.lockSha256, nodeCount: result.nodeCount, uniqueBodyCount: result.uniqueBodyCount, noNetwork: true, noSourceWrites: true }));
}
