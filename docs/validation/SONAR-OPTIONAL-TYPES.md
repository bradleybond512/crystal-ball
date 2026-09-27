# Sonar 4.2 prerequisite: optional declarations

Risk: Low; repository workflow: Standard. This is a bounded prerequisite to dependency PR #1652, not completion of that upgrade. Five erased type declarations now exclude redundant top-level undefined while retaining their optional markers and relationships to source types. The webcam exclusion wraps the whole Derive type, preserving callbacks that return undefined. No runtime code, imports, tests, dependencies, compiler settings, lint rules or baselines changed.

## Scope and design

Affected declarations: recent algorithm outcome, playback fade overrides, structured log fields webcam stream derivation and alert-store identity-limit options. Preserve omitted properties, explicit undefined under current compiler settings, all valid values and rejection of invalid values. Exclude removes only undefined; NonNullable would also remove null. User authorization to fix delivery blockers covers this Standard cleanup after analyst and architect review. No prediction logic, warning policy, data-provider parsing or privileged boundary changed.

## Actual checks

Existing four-file targeted suite: `# pass 47` / `# fail 0`, exit 0. It covers algorithm diagnostics, playback, structured logging and webcam configuration.

`bash scripts/agentic-validate.sh --tests 'test:algorithms test:playback test:webcams test:acc509'` exited 0:

```text
# pass 307
# fail 0
# pass 14
# fail 0
# pass 235
# fail 0
# pass 9
# fail 0
# pass 107
# fail 0
Agentic validation gate passed.
```

Total 672 pass / 0 fail. All TypeScript configurations, strict lint, lockfile, secrets, documentation, roadmap and production build passed. Bundle check reported `✓ All bundle-size policies satisfied.`

The original four-file Sonar 4.2.0 probe produced four findings, then zero after repair. A subsequent full scan discovered one additional instance in the recently changed alert-store constructor. The expanded five-file probe produced:

```text
Target findings: 1; unrelated probe diagnostics: 1
Target findings: 0; unrelated probe diagnostics: 1
```

The one unrelated diagnostic is an unused no-console suppression because this external probe enables only no-redundant-optional. It is disclosed separately; the unchanged full repository lint gate passes. Sonar 4.2 is read from the existing isolated diagnostic installation, with no dependency changes in this branch. This is not a claim that all Sonar 4.2 rules pass repository-wide.

A real TypeScript program using the current tsconfig and a temporary virtual fixture compiled before and after with `Type contract diagnostics: 0`. It checks omitted properties, explicit undefined, valid concrete values, webcam callbacks returning a stream type or undefined, optional constructor limits/defaults, and five invalid-value rejection cases via checked ts-expect-error directives. Runtime tsx tests alone do not establish this contract.

Identical configured transpilation (without source maps) produced byte-identical JavaScript for every edited file. SHA256 values for both before and after:

| File | Emitted JavaScript SHA256 |
| --- | --- |
| src/services/algorithms/algorithm-diagnostics.ts | `7e624082f6670f8e128558db5263eb816307f1d6130d3843a84711d43d1f61e4` |
| src/services/playback/timeline-cursor.ts | `6a1ed67ba545e23b33be2bff26e6151e6e27a8a60df4827347e0a34dd1e013b3` |
| src/services/structured-log.ts | `2c6177152855fd44b0062fafa41a8ee17a117fe0703f4c65d952b75037ff6046` |
| src/services/webcams/webcam-config-loader.ts | `e8d366cdd4dac37b85e94184131c2ed12ca320a217fda8791c3723c2f1d762d0` |
| src/services/unified-alerts.ts | `f94fd62b0a44a13caa5928ea1342ae4e4f96cb0153caa9ac222c6115a38c8d79` |

## Type-contract mutation

Code candidate: `3e47b9162138a4825059d2cbc24510b8b303254c`. In a clean dedicated worktree, changed only:

```diff
- streamType?: Exclude<Derive<WebcamStreamType | undefined>, undefined>;
+ streamType?: Derive<WebcamStreamType>;
```

Inspected the applied git diff. Actual compiler diagnostics: 0 → 1 → 0. The mutated run exited 1 with TS2322 on `streamType: () => undefined`; restored compilation exited 0. Original and restored source SHA256 both `96b5b52f244cd39a47640e09d31f4e0cf442cf1499d1d8ede95caf7d2b2b4dfb`; restored git status empty. This is compiler-contract evidence, not a runtime mutation claim for erased annotations.

At final code candidate `67a588ff818ea2818881342f63e452579d5af33a`, a second clean-worktree mutation replaced the constructor option with `identityLimits?: undefined`. The inspected applied diff preserved all runtime statements. The valid concrete-limit assignment then produced one TS2322 diagnostic: 0 → 1 → 0 after restoration. Original/restored source SHA256 both `20ae2eab1a011b00df2690e5935a75c66e500733cfdef804c1e6f9baf8e38e5f`; restored git status empty. The webcam declaration remains byte-identical to its earlier proof candidate.

## Review and delivery

Independent review found no code issue in the five-declaration change and audited compiler fixtures, emitted-code equality and gate output. Fresh actual Claude review, exact-tip verdict and required CI govern delivery through scripts/pr-closeout.sh. The branch is held until those gates pass.

## Limits, manual checks and rollback

No native install or manual UI verification performed; emitted runtime JavaScript is unchanged. Optional manual check: load a configured webcam with no derived stream type and verify its existing fallback behavior. No migration or user-data changes; rollback by reverting the declaration commit through a reviewed PR.

The refreshed full Sonar scan at `3e47b9162` found 94 additional regex findings across 49 files, one exact-alpha comparison, one optional-type finding in the constructor (now fixed here), and 40 additional unused-suppression warnings relative to the existing lint baseline. No baseline was changed. The full scan was not repeated after the fifth annotation; the final focused probe verifies all five optional declarations. #1652 remains blocked on the remaining parser and exact-alpha work. Raw probes, scripts, compiler fixture, logs and mutation JSON are retained at `~/.crystalball-diagnostics/sonar-optional-types-20260927/`.
