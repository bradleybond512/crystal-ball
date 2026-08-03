export function resolveManifestChunkFile(manifest, chunkName) {
  const matches = Object.values(manifest).filter((entry) => (
    entry?.name === chunkName
    && typeof entry.file === 'string'
    && entry.file.endsWith('.js')
  ));

  if (matches.length !== 1) {
    throw new Error(`Expected exactly one manifest chunk named "${chunkName}"; found ${matches.length}`);
  }

  return matches[0].file;
}
