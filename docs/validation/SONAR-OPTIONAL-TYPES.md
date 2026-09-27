# Sonar 4.2 prerequisite: optional declarations

Risk: Low; repository workflow: Standard. This is a bounded prerequisite to dependency PR #1652, not completion of that upgrade. Four erased type declarations now exclude redundant top-level undefined while retaining their optional markers and relationships to source types. The webcam exclusion wraps the whole Derive type, preserving callbacks that return undefined. No runtime code, imports, tests, dependencies, compiler settings, lint rules or baselines changed.

## Scope and design

Affected declarations: recent algorithm outcome, playback fade overrides, structured log fields and webcam stream derivation. Preserve omitted properties, explicit undefined under current compiler settings, all valid values and rejection of invalid values. Exclude removes only undefined; NonNullable would also remove null. User authorization to fix delivery blockers covers this Standard cleanup after analyst and architect review. No prediction logic, warning policy, data-provider parsing or privileged boundary changed.

## Actual checks

Existing four-file targeted suite: `# pass 47` / `# fail 0`, exit 0. It covers algorithm diagnostics, playback, structured logging and webcam configuration.

`bash scripts/agentic-validate.sh --tests 'test:algorithms test:playback test:webcams'` exited 0:

```text
# pass 307
# fail 0
# pass 14
# fail 0
# pass 235
# fail 0
# pass 9
# fail 0
Agentic validation gate passed.
```

Total 565 pass / 0 fail. All TypeScript configurations, strict lint, lockfile, secrets, documentation, roadmap and production build passed. Bundle check reported `✓ All bundle-size policies satisfied.`

A fresh focused Sonar 4.2.0 probe against the four current files produced:

```text
Target findings: 4; unrelated probe diagnostics: 1
Target findings: 0; unrelated probe diagnostics: 1
```

The one unrelated diagnostic is an unused no-console suppression because this external probe enables only no-redundant-optional. It is disclosed separately; the unchanged full repository lint gate passes. Sonar 4.2 is read from the existing isolated diagnostic installation, with no dependency changes in this branch. This is not a claim that all Sonar 4.2 rules pass repository-wide.

A real TypeScript program using the current tsconfig and a temporary virtual fixture compiled before and after with `Type contract diagnostics: 0`. It checks omitted properties, explicit undefined, valid concrete values, webcam callbacks returning a stream type or undefined, and four invalid-value rejection cases via checked ts-expect-error directives. Runtime tsx tests alone do not establish this contract.

Identical configured transpilation (without source maps) produced byte-identical JavaScript for every edited file. SHA256 values for both before and after:

| File | Emitted JavaScript SHA256 |
| --- | --- |
| src/services/algorithms/algorithm-diagnostics.ts | `7e624082f6670f8e128558db5263eb816307f1d6130d3843a84711d43d1f61e4` |
| src/services/playback/timeline-cursor.ts | `6a1ed67ba545e23b33be2bff26e6151e6e27a8a60df4827347e0a34dd1e013b3` |
| src/services/structured-log.ts | `2c6177152855fd44b0062fafa41a8ee17a117fe0703f4c65d952b75037ff6046` |
| src/services/webcams/webcam-config-loader.ts | `e8d366cdd4dac37b85e94184131c2ed12ca320a217fda8791c3723c2f1d762d0` |

## Type-contract mutation

Code candidate: `3e47b9162138a4825059d2cbc24510b8b303254c`. In a clean dedicated worktree, changed only:

```diff
- streamType?: Exclude<Derive<WebcamStreamType | undefined>, undefined>;
+ streamType?: Derive<WebcamStreamType>;
```

Inspected the applied git diff. Actual compiler diagnostics: 0 → 1 → 0. The mutated run exited 1 with TS2322 on `streamType: () => undefined`; restored compilation exited 0. Original and restored source SHA256 both `96b5b52f244cd39a47640e09d31f4e0cf442cf1499d1d8ede95caf7d2b2b4dfb`; restored git status empty. This is compiler-contract evidence, not a runtime mutation claim for erased annotations.

## Review and delivery

Independent review found no code issue in the four-line change and audited compiler fixtures, emitted-code equality and gate output. Fresh actual Claude review, exact-tip verdict and required CI govern delivery through scripts/pr-closeout.sh. The branch is held until those gates pass.

## Limits, manual checks and rollback

No native install or manual UI verification performed; emitted runtime JavaScript is unchanged. Optional manual check: load a configured webcam with no derived stream type and verify its existing fallback behavior. No migration or user-data changes; rollback by reverting the declaration commit through a reviewed PR.

The previous inventory's 95 regex findings and exact-alpha comparison are separate work; their old counts are not presented as a fresh full-repository lint result. #1652 remains blocked until the other findings are resolved. Raw probes, scripts, compiler fixture, logs and mutation JSON are retained at `~/.crystalball-diagnostics/sonar-optional-types-20260927/`.
