# UX-071 — safe merge reconciliation

November 28 preparation for existing [draft #1904](https://github.com/bradleybond512/crystal-ball/pull/1904).
The user now authorizes protected merging of safe work and a new Mac build and
installation. Public releases, deployment and destructive cleanup remain held.
Earlier reports retain their historical delivery holds; this addendum records
the current authorization without changing their observed results.

## Source and preserved boundaries

Reviewed source: `8c0b6f9847bee31153e64b3d7e6d3533d444748d`. The local
reconciliation at `0b81cb728b40ceea17b8be9d0d1ef51369323d46` sits on the
published #1902 candidate `c5969753324deb6236aa57caf3613bc63a8beb06`.
That parent has not yet become main. Rebase or tree-equivalence verification
against actual merged main remains required before publication.

All 35 imported files match the reviewed source byte-for-byte: native source,
workflow, driver/inventory, tests, package scripts/mapping and historical
plans/reports. Only the UX-071 tracker row was transplanted. Eight old UX-071
verdict files were excluded; an inherited parent verdict does not review this
new branch. Fresh independent Sol/Sonnet review and an exact-tip verdict remain
required. No new native behavior or policy was introduced by reconciliation.

The parent supplies the [dependency repairs](UX-066-SECURITY-INTEGRATION.md):
cookie 0.18.3, URL 2.5.9, form_urlencoded 1.2.3 and coherent marketing
React/DOM/RSC 19.2.9. Its Cargo lock, marketing manifest/lock, root npm lock,
Zizmor pin and current SPC clock test remain byte-identical. Newer UX-066 and
UX-076 tracker notes are preserved. The old #1904 worktree and #1920 remain
untouched.

## Current local validation

The following six scripts ran on the identical reconciled code before the
documentation-only parent rebase, using Node 22.23.1. These are current local
results, separate from the historical hosted Rust results.

| Command | Actual output |
| --- | --- |
| `npm run test:native-ci-driver` | `# pass 21` / `# fail 0` |
| `npm run test:native-boundaries` | `# pass 54` / `# fail 0` |
| `npm run test:native-crypto-boundary` | `# pass 3` / `# fail 0` |
| `npm run test:native-ci-workflow` | `# pass 4` / `# fail 0` |
| `npm run test:workflow-security` | `# pass 96` / `# fail 0` |
| `npm run test:roadmap-controller` | `# pass 135` / `# fail 0` |

`bash scripts/agentic-validate.sh --tests "test:native-ci-driver test:native-boundaries test:native-crypto-boundary test:native-ci-workflow test:workflow-security test:roadmap-controller"`
exited 0 and printed `Agentic validation gate passed.` This included
lockfile/lint checks, `typecheck:all`, `secrets:scan`, documentation, roadmap
and build checks. `npm run lint:strict` and `git diff --check` also exited 0.
The original reconciliation commit's normal hooks passed. After rebasing,
`npm run docs:check -- --changelog-advisory` exited 0 and printed
`[docs:check] Documentation appears fresh.`; `npm run typecheck:all` exited 0;
`npm run lint:md` exited 0 with `Checked 349 Markdown file(s).`; and the
roadmap suite again printed `# pass 135` / `# fail 0`.

Raw logs and per-file SHA256 identity receipts are retained locally in
`/tmp/ux071-safe-merge-nov28/`: `validation-gate.log`, targeted suite logs,
`reconciliation.json`, `postcommit-identity.json`, `rebase-identity.json`,
`rebase-docs.log`, `rebase-types.log`, `rebase-roadmap.log` and `commit.log`.
Identical root-lock verification allowed existing Node dependencies to be
reused. No new native build/cache or dependency installation ran here.

## Remaining acceptance and rollback

[Historical hosted acceptance](UX-071-CI-ACCEPTANCE.md) retains Linux 269/0,
macOS ARM64 272/0, strict Clippy and all eight/nine detecting controls for its
recorded source. Those are not fresh results for this parent dependency graph.
No new mutation proof is claimed for a byte-preserving reconciliation.
Current hosted native execution, strict Clippy, mutation controls, final CI,
reviews and exact-main delivery qualification remain pending.

Installed acceptance is also pending. No application build/install/launch,
user-profile access, real-Keychain operation or GUI verification ran in this
preparation. Preserve the final checkout's stable-signing, identity and hash
checks; failed qualification blocks installation. Rollback removes this
bounded native reconciliation while retaining the parent's dependency fixes;
historical evidence remains available. Do not roll back security repairs to
make an older native result appear current.
