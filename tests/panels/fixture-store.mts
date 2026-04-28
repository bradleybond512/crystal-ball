/**
 * In-memory fixture store. The fetch mock in setup-dom.mts looks up
 * registrations by URL substring; the first match wins. Tests register
 * fixtures before mounting a panel so the panel sees deterministic data.
 *
 * Keeping this in its own module avoids a setup-dom <-> registry cycle.
 */

export interface FixtureBody {
  status?: number;
  body: unknown;
}

interface FixtureEntry {
  pattern: string;
  method: string;
  body: unknown;
  status: number;
}

const fixtures: FixtureEntry[] = [];

export function installFixture(
  urlPattern: string,
  body: unknown,
  options: { method?: string; status?: number } = {},
): void {
  fixtures.push({
    pattern: urlPattern,
    method: (options.method ?? 'GET').toUpperCase(),
    body,
    status: options.status ?? 200,
  });
}

export function clearFixtures(): void {
  fixtures.length = 0;
}

export function getFixture(url: string, method: string): { body: unknown; status: number } | null {
  const upper = method.toUpperCase();
  for (const entry of fixtures) {
    if (entry.method !== upper) continue;
    if (url.includes(entry.pattern)) return { body: entry.body, status: entry.status };
  }
  return null;
}
