import { after } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const server = new URL('../../dist/server/', import.meta.url);
const config = JSON.parse(await readFile(new URL('wrangler.json', server), 'utf8'));
const instances = new Map();
const files = (await readdir(server, { recursive: true })).filter((name) => /\.m?js$/.test(name));
const modules = [config.main, ...files.filter((name) => name !== config.main)].map((name) => ({ type: 'ESModule', path: fileURLToPath(new URL(name, server)) }));

// Exercise the real Workers artifact, including cloudflare: built-ins. The
// no-assets instance deliberately has no ASSETS binding for the sitemap guard.
export async function requestWorker(url, init = {}, { assets = true } = {}) {
  let runtime = instances.get(assets);
  if (!runtime) {
    runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'marketing-test',
      modules,
      modulesRoot: fileURLToPath(server),
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      ...(assets ? { assets: {
        directory: fileURLToPath(new URL('../../dist/client/', import.meta.url)),
        binding: 'ASSETS',
        run_worker_first: true,
      } } : {}),
    }] }));
    instances.set(assets, runtime);
  }
  const worker = await runtime.getWorker('marketing-test');
  return worker.fetch(url, init);
}

after(async () => {
  await Promise.all([...instances.values()].map((runtime) => runtime.dispose()));
  instances.clear();
});
