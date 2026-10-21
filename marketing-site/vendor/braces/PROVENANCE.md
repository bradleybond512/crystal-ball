# Local braces security patch

Upstream: https://github.com/micromatch/braces, MIT license retained in LICENSE.
Version: 3.0.3, unchanged. Unreleased patch: https://github.com/micromatch/braces/pull/87
Security patch commit: d44b9b1ee12e7804d4232d5a47a4a0c61d2fbefe. Base: upstream tag3.0.3 (483836c3484f6bd0ff6db6e00d1dc35505efda15).

The shipped source is upstream tag3.0.3 with only the security commit changes to lib/ and README.md applied. Unrelated upstream unreleased changes are excluded. Package metadata retains identity, license, entry point, engines and runtime dependency; upstream development dependencies and scripts are omitted to prevent installing upstream test tooling into the site. security.patch records the production changes relative to upstream tag 3.0.3. SHA256SUMS.json records shipped source/document/patch hashes.

This local fork bounds brace/parenthesis nesting and recursive AST traversal to 100 levels; maxDepth can lower but cannot raise the limit. Expansion also rejects cyclic parent chains. Inputs beyond the limit now raise explicit validation errors. This mitigates the structural stack-exhaustion advisory GHSA-vfj7-8cjw-p6xm; it does not make arbitrary globs or Cartesian expansion safe.

No upstream patched release exists as of 2026-10-18, and the PR is not merged. Package version remains honest; this is a maintained local patch, not upstream advisory closure. npm audit may omit file dependencies or continue flagging 3.0.3. Review this code and test evidence independently. Replace the override with an upstream fixed release only after the same regression suite, upstream tests, and marketing build pass.

Full upstream tests are executed from the pinned temporary checkout, without vendoring its development dependencies. The marketing regression tests use bounded child processes and a reduced stack to verify rejection, supplied ASTs, cycles, normal patterns, and the hard cap.
