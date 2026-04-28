# Panel Smoke Harness

Boots every panel id from `src/config/panels.ts`, fires its first refresh,
and records whether the DOM produced output. Designed to catch silent
rendering regressions — panels that throw quietly, render nothing, or
show stale data without a banner.

## Run it

```bash
npm run test:panels:smoke
```

Output:

- `tests/panels/.last-report.md` — human-readable table (gitignored).
- `tests/panels/.last-report.json` — machine-readable per-panel state.
- `tests/panels/.last-routes-audit.md` — sidecar route inventory.
- Exit 0 if no NEW panels are silent/errored vs the baseline.
- Exit 1 with a list of new offenders otherwise.

## States

| State | Meaning |
|---|---|
| `rendered` | Non-empty content with ≥ N chars (acceptable). |
| `degraded` | Visible "no data" / loading / error banner (acceptable contract). |
| `silent`   | Empty content AND no banner — likely broken. |
| `errored`  | Constructor or refresh threw — broken. |
| `skipped`  | No factory in `panel-smoke-registry.mts` yet — gap audit. |

## Architecture

| File | Role |
|---|---|
| `panel-inventory.mts` | Parses `src/config/panels.ts` for the canonical id list across all four variants (full/tech/finance/happy). |
| `panel-smoke-registry.mts` | id → factory map. Each entry returns a freshly constructed panel. |
| `setup-dom.mts` | Installs happy-dom + a deterministic fetch mock + an `import.meta.env` shim. |
| `loader-hook.mjs` | Node loader hook: stubs `services/i18n.ts` and `services/analytics.ts`, strips Vite `?worker`/`?url` query suffixes, rewrites `import.meta.env` reads to a global. |
| `register-hook.mjs` | Registers the loader via `node:module` so it runs in the worker context. |
| `panel-smoke.test.mts` | Per-panel `node:test` runner. |
| `sidecar-routes-audit.test.mts` | Cross-checks every `/api/*` call site in `src/` against handlers in `src-tauri/sidecar/local-api-server.mjs` + `api/*.js`. |
| `run-harness.mjs` | Wrapper that interprets the JSON report directly, applying the `baseline.json` allow-list. |
| `baseline.json` | Known-broken panels that don't gate the build. Remove an id when you fix it. |
| `stubs/` | Minimal stand-ins for Vite-only modules (i18n, analytics) and Vite asset imports. |

## Adding a panel

If a panel reports `skipped: no factory in registry`, add an entry to
`panel-smoke-registry.mts`. Most panels with a no-arg constructor need
just a one-liner:

```ts
'my-panel': wrap(async () => {
  const m = await import('@/components/MyPanel');
  return new m.MyPanel();
}),
```

Panels that need fixtures can register them via `installFixture(...)`
from `fixture-store.mts` before the harness mounts them. (The default
fetch mock returns `{ ok: true, items: [], data: [] }` for anything not
explicitly fixtured.)

## Why a baseline?

Some pre-existing silent renders predate this harness. Adding their ids
to `baseline.json` lets the harness ship as a regression gate without
blocking unrelated PRs. The Markdown report still lists them, so they
remain visible.

To force the gate to fail on every offender (no baseline allowance):

```bash
PANEL_SMOKE_FAIL_ON=silent,errored npm run test:panels:smoke
# Then delete baseline.json before running.
```

To run in pure report mode:

```bash
PANEL_SMOKE_FAIL_ON=never npm run test:panels:smoke
```
