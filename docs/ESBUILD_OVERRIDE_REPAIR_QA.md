# esbuild override maintenance repair (2026-11-07)

## Brief, discovery and design

Goal: allow Dependabot to update the direct esbuild requirement without npm
rejecting the root override. This is Standard metadata maintenance, affecting
all variants' development tooling, not runtime behavior or a dependency upgrade.
Read-only repository analysis and the parent-approved design precede this
isolated implementation. Acceptance criteria: retain the current direct floor,
lockfile bytes and all lifecycle/security controls; prove exact and caret updater
specifications work, and older transitive requests remain constrained.

[Dependabot run 42403610857](https://github.com/bradleybond512/crystal-ball/actions/runs/42403610857)
used npm 12.2.0 to run `npm install esbuild@0.28.2 --force --ignore-scripts
--package-lock-only --allow-git=all --allow-remote=all --min-release-age=7`.
It failed with `EOVERRIDE: Override for esbuild@0.28.2 conflicts with direct
dependency`. The direct dependency and override previously duplicated `^0.28.1`;
npm requires direct-dependency override specifications to match exactly.

Use npm's `$esbuild` reference instead of a second literal. The direct requirement
remains `^0.28.1`; the reference also constrains transitive esbuild requests.
Synchronizing two literals would recreate the same failure on the next update;
removing the override would lose the transitive floor. No schema, runtime,
workflow, permission, migration or release/install changes are needed. No package
is added or upgraded, so maintenance, licensing and bundle contents are unchanged.
Existing age, provenance, lockfile and lifecycle-script checks remain mandatory.

## Bounded plan and validation

The implementation/test specialist owns only `package.json`, the new
`tests/dependency-overrides.test.mjs` and this note. Add behavior tests first,
then change the override and include the tests in both existing supply-chain and
workflow-security scripts. The latter is already selected for package.json changes.
The coordinator owns aggregate validation, independent review and publication.

Fixtures invoke real npm `ls --all --package-lock-only --json --offline
--ignore-scripts` in temporary directories. They contain synthetic lock trees,
not downloaded or installed packages. npm's virtual-tree loader enforces direct
override consistency and reports invalid below-floor resolutions. Tests cover:

- Existing `^0.28.1` floor and older `^0.24.0` transitive requests.
- Rejection of a lock tree resolved below the floor.
- Simulated direct `0.28.2` and `^0.28.2` updates with the repository override.
- Negative controls restoring the former literal, producing real `EOVERRIDE`.

Local qualification uses Node 22 and npm 10.9.8. `npm run test:supply-chain-gates`
reported `# tests 26`, `# pass 26`, `# fail 0`. This does not claim that npm 12.2.0's
hosted updater has rerun successfully; its next run remains the end-to-end check.
Initial test-first execution reproduced both updater conflicts, and exposed a
fixture assertion error: npm reports `overridden` on the top-level node rather
than its deduplicated child. That assertion was corrected before qualification.
The coordinator must retain clean-tree mutation evidence and run
`bash scripts/agentic-validate.sh --tests "test:supply-chain-gates test:workflow-security"`
and independent review before reporting completion.

The standalone #1862 change preserved main's package-lock SHA-256,
`fa0fc7a76d31ce38c5b03b52e88b4c61956e444dc5171e89fab9a105e02e147f`.
The #1838 integration preserves that branch's existing happy-dom lockfile instead;
its SHA-256 is `5466eee89b22fc5ccf1af96878380e196241dee47671c596ceea75fd3220ca8c`.
No new security exception or dependency-age exception is requested. Release tag
integrity is a separate known issue, outside this repair. Rollback is reverting
this metadata/test change; no persistent data migration is involved. Merging,
release, deployment and installation retain their existing authorization gates.
