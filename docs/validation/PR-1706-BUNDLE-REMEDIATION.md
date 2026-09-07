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

## Candidate validation

Pending completion of the fresh implementation and review cycle. Historical
PR validation is documented separately in `E2E-BASELINE-REPAIR-EVIDENCE.md`.
