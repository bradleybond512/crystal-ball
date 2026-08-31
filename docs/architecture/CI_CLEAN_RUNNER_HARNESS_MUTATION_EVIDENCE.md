# Clean-Runner CI Harness Mutation Evidence

Recorded: 2026-08-31
Branch: `codex/ci-clean-runner-harness`
Baseline implementation commit: `fdf5ca51`

## Test-first contract red

Before the harness implementation, the two new source contracts were run with:

```text
node --test --test-name-pattern='UX-010 native gate gives Cargo|Home Shell browser harness scopes' tests/agentic-pipeline.test.mjs
```

Observed result: `0 pass / 2 fail`. The failures identified the missing owned
temporary Tauri frontend resource and the missing row-scoped exact-zero browser
predicate. After implementation the same command reported `2 pass / 0 fail`.

## Native clean-runner behavior

File mutated: `tests/ux010-native-gate.test.mjs`

Stable checksum before mutation:

```text
c5d38829c59722a1e2d9de1368d9bf23cc51c2d28a9ba38f0d1a3d733d729394
```

The repository had no `dist` directory. The mutation removed only the
child-process `TAURI_CONFIG` line. `git diff` confirmed that exact one-line
deletion before running:

```text
node --test tests/ux010-native-gate.test.mjs
```

Observed red result: `0 pass / 1 fail`. Cargo exited `101` at
`tauri::generate_context!()` with:

```text
The `frontendDist` configuration is set to `"../dist"` but this path doesn't exist
```

After restoring the line, the checksum returned to the value above, the working
tree was clean, and the same command reported `1 pass / 0 fail` with all nine
Rust contract tests passing.

## Exact-zero browser behavior

File mutated: `e2e/home-shell-boot.spec.ts`

Stable checksum before mutation:

```text
0f5ac272cb6b7270b2f5fecf943af4d6d3a73651e489bb7486e2385a17c8549c
```

The mutation replaced only the anchored exact-zero matcher with the prior broad
`/working now.*0 items/i` matcher. `git diff` confirmed that exact one-line
change before running:

```text
VITE_VARIANT=full npx playwright test e2e/home-shell-boot.spec.ts --grep "browser harness only"
```

Observed red result: `0 passed / 1 failed`. The deterministic `10 items` case
returned `true` where `false` was required. After restoring the anchored matcher,
the checksum returned to the value above, the working tree was clean, and the
same Playwright command reported `1 passed / 0 failed`.
