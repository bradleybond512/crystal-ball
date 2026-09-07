# PR #1706 — Fresh bundle remediation cycle

## Authorization and scope

On 2026-09-07 Bradley explicitly requested merging PR #1703 and a fresh
code-remediation/review cycle for PR #1706's bundle regression. This starts a new
bounded cycle; retain the two-cycle review/repair limit and all required checks.

PR #1703 merged as `ae24db061df3da453825ea09a6668629418f5a44` at
2026-09-07 05:37:44 UTC after all required checks passed. PR #1706 was rebased
onto that main. Its old verdict is historical and cannot approve the new tip.

Classification: Standard / medium-risk packaging repair. No provider, scoring,
permission, storage, or dependency changes beyond incorporating merged main.

## Brief and design

Goal: pass the unchanged 460 KiB main-entry budget with useful margin while
preserving startup camera buffering, country image export, and story preview.

Read-only repository discovery identified only two runtime imports of the story
canvas renderer: `src/app/country-intel.ts` and `src/components/StoryModal.ts`.
The architect selected a named static `story-renderer` chunk in the existing
Vite `manualChunks` function. Match only `/src/services/story-renderer.ts`.
Both consumers and the renderer implementation remain unchanged. This partitions
the main file; it does not defer loading or establish a startup-download saving.
Inspect actual shared dependency ownership, static reachability, and precaching.

Ownership:

- ui_map_engineer: Vite ownership rule and focused bundle-artifact test.
- Parent: dependency incorporation, full build/gates, mutation evidence, PR
  metadata, and closeout.
- independent_reviewer: completed diff and evidence, without implementation.
- Claude: actual opposite-agent review of the final implementation SHA.

Acceptance: the named renderer chunk remains statically reachable from main,
preview/export retain their existing behavior, the chunk is precached, and CI
passes unchanged limits. Do not change MapContainer, consumers, renderer,
bundle-policy limits, lint rules, or global Rollup splitting options.

## Baseline evidence

Original CI run `34086830789` reported:

```text
main-CLcjgSeC.js  raw=1.61 MB  gzip=460.1 KB
Main entry main-CLcjgSeC.js gzipped is 460.1 KB > 460.0 KB limit
```

The rebased local baseline at `ec21fdba881a76939476fb8aa7d14af63ea3015c`
used Node 22.23.1, zlib 1.2.12, `npm ci --legacy-peer-deps`, and
`CRYSTALBALL_SKIP_VAULT_TEXTURES=1 npm run build:full`:

```text
main-DMxtGT72.js  raw=1.61 MB  gzip=458.2 KB
gzipBytes: 469241
```

These different build environments are not a paired performance comparison.
The local before/after measurement uses the same runtime and lockfile; the new
CI result is still required. An eight-byte isolated MapContainer micro-refactor
was rejected in design as insufficient margin.

A two-consumer lazy-loading candidate measured 466095 gzip bytes locally and
passed 14721 renderer tests plus the agentic gate on rerun. It was abandoned:
mandatory changed-file lint exposed 43 pre-existing diagnostics in those two
files, including three large-method complexity errors. Resolving them would
expand this repair into unrelated country-brief logic. The final static split
preserves application behavior without relaxing lint. Candidate-only tests and
callsite edits were removed; those results do not validate the final split.

After dependency incorporation, `npm audit --audit-level=high` exited 0 and
reported six moderate vulnerabilities. No claim of zero vulnerabilities is made.
The unchanged pending-camera test produced:

```text
# tests 4
# pass 4
# fail 0
```

## Rollback

Remove the isolated Vite ownership rule to restore the previous packaging.
No data migration is needed; preserve the startup camera fix and merged security
dependency. Reverting may exceed the bundle budget again, so rollback still
requires the repository's checks and a reviewed resolution.

## Final implementation validation

Source commit: `59b29e5ffeb37abae1c5f24b718b0a86009c94b0`.
All commands below used Node 22.23.1. Historical PR validation is documented
separately in `E2E-BASELINE-REPAIR-EVIDENCE.md`.

`bash scripts/agentic-validate.sh --tests 'test:renderer'` exited 0:

```text
# tests 14713
# pass 14713
# fail 0
Agentic validation gate passed.
Tests run: test:renderer
```

That gate executed lockfile checks, strict lint, both TypeScript configurations,
secret scanning, cross-agent tooling checks, documentation/roadmap checks, and
the generic build. Its build output is not the full-variant size measurement.
Scoped raw ESLint on `vite.config.ts`, the new config test, and the modified
artifact test exited 0 with no diagnostics. Commit hooks also passed.

`CRYSTALBALL_SKIP_VAULT_TEXTURES=1 npm run build:full` was run separately after
restoring the mutation. Both compared builds below use the same source commit,
runtime, lockfile, and full variant; only the ownership rule differs.

| Measurement | Rule removed | Rule restored |
|---|---:|---:|
| Main gzip bytes | 469245 | 465863 |
| Renderer gzip bytes | inline | 3515 |
| Total JS gzip bytes | 5146260 | 5146402 |
| JS chunks | 107 | 108 |

Main shrank by 3382 bytes and has 5177 bytes of headroom under 460 KiB.
Total compressed JS increased by 142 bytes: this is partitioning, not a total
payload reduction. `npm run bundle:check` exited 0:

```text
main-DrMhZvlT.js  raw=1.60 MB  gzip=454.9 KB
✓ All bundle-size policies satisfied.
```

`node --test tests/bundle-size.test.mjs` after restoration exited 0:

```text
# tests 18
# pass 18
# fail 0
```

The full manifest identifies `assets/story-renderer-D0HRWf5T.js`, statically
reachable from main, importing the existing `panels-cOn_mD5b.js` shared chunk.
Its existing translation functions remain in that shared chunk; no new cycle
returns to the renderer. The generated service worker precaches the renderer.
A production-browser invocation of its actual exported renderer returned:

```json
{
  "renderer": "assets/story-renderer-D0HRWf5T.js",
  "result": {
    "width": 1080,
    "height": 1920,
    "pngPrefix": "data:image/png;base64,",
    "pngLength": 122462
  },
  "pageErrors": []
}
```

This exercises the built canvas renderer, not a full manual click-through of both
unchanged consumers. A separate generic-build app startup smoke had no page
errors with external requests blocked. Runtime E2E rerun: `12 passed (14.7s)`.
No desktop installation or release was performed.

## Clean-tree mutation proof

Started at the source commit above with empty `git status --short`.
File: `vite.config.ts`; SHA-256 before and after restoration:
`4dd943ed5d6566d56d8bc642375fc0003eca689718735eeeac0c75c7385766e6`.
The inspected applied diff removed exactly:

```diff
- if (id.endsWith('/src/services/story-renderer.ts')) return 'story-renderer';
```

`npx tsx --test src/config/__tests__/story-renderer-chunk.test.mts` changed from
3 pass / 0 fail to 2 pass / 1 fail (`undefined` instead of `story-renderer`), then
returned to 3 pass / 0 fail after restoration.

Raw config-test failure excerpt:

```text
    Expected values to be strictly equal:
    + actual - expected
    
    + undefined
    - 'story-renderer'
```

Raw config-test mutation totals:

```text
# tests 3
# suites 0
# pass 2
# fail 1
```

Rebuilt the full variant with the rule removed. Running
`node --test --test-name-pattern='story renderer' tests/bundle-size.test.mjs`
changed from 1 pass / 0 fail to:

```text
error: 'Expected exactly one manifest chunk named "story-renderer"; found 0'
# tests 1
# pass 0
# fail 1
```

After restoring, checksum equality and empty Git status were verified before
the full rebuild. All 18 artifact tests passed on the restored output. The
mutation's local size still passes the budget, so the named-artifact assertion
is the relevant red proof; size alone would not prove this test catches removal.

Raw local logs use `/tmp/pr1706-static-` prefixes: `gate.log`,
`mutation-config.log`, `mutation-build.log`, `mutation-artifact.log`,
`mutation-restored.json`, `restored-build.log`, `restored-artifacts.log`,
`restored-policy.log`, and `restored-bundle.json`.

## Review and remaining limits

The independent reviewer checked the entire original PR and new packaging
change, finding no production blocker. A nonblocking follow-up is to strengthen
the existing runtime E2E fallback mock: compare the configured cloud origin and
query explicitly, rather than accepting any nonlocal origin. Runtime production
code is unchanged in this PR.

The actual Claude conclusion must be recorded in a new SHA-pinned verdict-only
commit after final review. Required GitHub checks and closeout remain necessary;
local results do not establish that CI passed or that the PR merged.
