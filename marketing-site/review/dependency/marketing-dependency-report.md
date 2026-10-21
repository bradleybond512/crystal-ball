# Marketing dependency remediation — 2026-10-18

The reported stack-exhaustion issue is locally mitigated with a vendored braces 3.0.3 security patch. No upstream patched release exists. This is a maintained local fork, not upstream advisory closure. There is no audit suppression, fabricated version, framework downgrade, or application runtime migration.

## Changed files

- `marketing-site/vendor/braces/`: MIT license, upstream 3.0.3 source with only the PR #87 security changes, production patch, source hashes, and provenance.
- Marketing package and lock files: explicit local development dependency and `$braces` override make every transitive caller use the same reviewed source.
- `tests/braces-security.test.mjs`: bounded child processes with a reduced stack verify parsed nesting, supplied ASTs, child and parent cycles, ordinary globs, lower-only depth limits, and actual micromatch resolution.

The shared dependency directory was untouched. Its node_modules symlink was replaced by an isolated local installation. The temporary invalid installation was removed.

## Actual validation

| Check | Result | Evidence |
| --- | --- | --- |
| Original full audit | 8 high; all other severities 0 | `marketing-audit-before.json` |
| Original production audit | 0 vulnerabilities | `marketing-audit-production.json` |
| Original security regressions | 0 pass / 3 fail | `braces-regression-red.txt` |
| Patched regressions, including caller resolution | 4 pass / 0 fail | `braces-regression-green.txt` |
| Exact final source upstream suite | 778 passing / 0 failing | `braces-final-upstream-tests.txt` |
| Fresh `npm ci --ignore-scripts` | Exit 0; 491 packages added, 493 audited | `marketing-patched-ci.txt` |
| Final full audit | 0 vulnerabilities | `marketing-audit-patched.json` |
| Final production audit | 0 vulnerabilities | `marketing-audit-patched-production.json` |
| Installed dependency tree | All micromatch callers resolve local braces 3.0.3 | `braces-resolution.txt` |

The original installed package reproduced `Maximum call stack size exceeded` when compiling 3,500 nested braces and expanding 4,500 nested braces. Thresholds vary with JIT state. Tests enforce rejection with the explicit guard error, not an arbitrary exception or process failure.

Earlier testing of the upstream PR head yielded 908 passing tests, but its base included unrelated unreleased changes. Those changes were excluded. Only the 778-test result from upstream 3.0.3 plus the security patch qualifies the final vendored source.

npm may omit local file dependencies from advisory matching. Audit 0 is therefore not proof of patch safety: bounded regressions, actual caller resolution, the upstream suite, and independent review remain necessary.

## Provenance and tradeoffs

Official advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm. Affected versions are <=3.0.3; patched versions: None. Registry queries confirmed latest braces 3.0.3, micromatch 4.0.8 and fast-glob 3.3.3 still retain the affected chain. Latest vinext 1.2.1 also retains it. npm's proposed major downgrades were not applied.

Security patch: https://github.com/micromatch/braces/pull/87 at d44b9b1ee12e7804d4232d5a47a4a0c61d2fbefe, applied onto upstream tag 3.0.3. Shipped JavaScript matches only that bounded security patch. Package metadata excludes upstream development dependencies and scripts to prevent installing its test tooling into the site. The MIT license and package identity remain intact. See the tracked PROVENANCE.md, security.patch and SHA256SUMS.json.

The hard limit of 100 rejects pathological patterns previously accepted. Callers must handle validation errors. This addresses structural recursion, not arbitrary regex execution or Cartesian expansion bounds. The upstream PR is unmerged. Keep the local fork documented and replace it only after an official fix passes these regressions and site validation.

Independent security review and the site's type checks, lint, build, and full validation gate are parent-agent integration responsibilities. No commit, push, merge, deployment, or application installation was performed by this agent.
