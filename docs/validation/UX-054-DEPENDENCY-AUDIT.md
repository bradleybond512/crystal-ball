# UX-054 dependency audit coverage

The named `npm-audit` check covers the six independently locked npm projects. Its advisory scan includes production and development packages. The existing root signature check has its own trusted-event restriction. Cargo advisory and source-policy checks stay separate.

## Why the change matters

The previous root-only audit passed at the high threshold even though a live scan of the marketing lock identified Undici and Zod as high severity. Scanning only production dependencies also missed both. Undici is imported through the two Miniflare versions used for local Cloudflare tooling. Zod is used by the React Hooks ESLint plugin on compiler configuration. The marketing Worker serves a static OpenGraph image. The audit identified vulnerable installed versions. Public Worker exploitation remains unconfirmed.

The update scopes Undici 7.30.1 to Miniflare and locks Zod 4.6.6 within the existing consumer range. The only marketing lock value replacements are the package versions, registry tarball URLs and integrity hashes for those two packages. Both advisories were verified against the published records. [Undici advisory](https://github.com/advisories/GHSA-xjj6-f33q-929c). [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

## Inventory and remaining exposure

| Tracked input | How it is used |
| --- | --- |
| Root npm lock | Web/desktop app, build and tooling. The root vendor package for texture compression is represented in this lock. |
| Marketing npm lock | Site build, lint, local preview and Worker packaging. Its local braces vendor package belongs to this graph. |
| Relay scripts npm lock | Node HTTP/WebSocket relay and Telegram operator tooling. |
| MCP server npm lock | Local stdio server and command-line tools. |
| CB control npm lock | Operator HTTP/WebSocket process with PTY and SQLite. |
| CI Codex npm lock | Pinned CI review tool. |
| Sidecar package manifest | Dependency-free module marker with no separate installable graph on this revision. |
| Tauri Cargo manifest and lock | Existing Rust audit/deny checks. |
| Zizmor requirements | Python tool pin verified by exact version and wheel hashes. |
| Buf and skills locks | Schema references and agent skills, respectively. Neither represents an npm install. |
| MCP definitions | External Docker, npx and uvx pins are separate from the local npm server lock. Draft #1781 owns that hardening. |

The root's lower-severity transitive advisories include build and lint dependencies. The marketing lock also has residual advisory paths through tooling and rendering libraries. The relay's `ip-address` finding is visible at moderate severity. GramJS's optional SOCKS path is unused in the two examined entry points. A separate audit of the actual lock proposed by #1825 reported 47 dependencies and zero findings, with `ip-address` at 10.7.5. That fix belongs to its open draft. Historical MCP findings did not reproduce in the current six-root scan.

## Manual verification and rollback

Run the lock audit on a committed candidate with the supported Node/npm toolchain. Confirm an outcome for each expected graph, including marketing and CI tooling. In a disposable checkout substitute the pre-repair marketing lock, rerun, then restore the original object. Exercise the actual workflow shell with a fork candidate and a missing or modified checker. Confirm that root signature verification still runs on its previous event scope. Check the original Rust jobs separately.

Revert the workflow, checker, CI mappings and ownership rules together if reverting coverage. The two marketing dependency fixes can stand independently if their tests continue to pass. Reconcile future workflow changes in #1798 and #1781 against the actual resulting base and reverify the bootstrap condition. There are no application-state migrations.

## Merge policy

GitHub's branch protection listed seven required checks on November 3. They were type checking, secret scanning, actionlint, integrity checks, release doctor, cross-agent review and targeted tests. The repository's npm audit workflow reports its own failing status. Its name is not in that branch-protection list. Dependency-sensitive PRs also have the existing operator-controlled approval-label policy. No repository settings or labels were modified.

## Verification scope

Fork verification uses disposable Git histories carrying hostile package scripts, npm configuration and a substituted candidate checker. The test executes the same Bash as the workflow. GitHub-hosted jobs on the implementation tip require publication and remain a separate acceptance step.

The root signature check was exercised with an isolated, physical root install on Node 22. A first trial against the shared development checkout's symlinked dependency directory failed when npm tried to find the local vendored texture compressor on the registry. Repeating the workflow against a clean install succeeded:

```text
932 packages have verified registry signatures
127 packages have verified attestations
```

The audit population includes dev and optional package records across supported platforms. The signature population consists of packages physically installed for this runner. The counts measure different things.

## Fork and registry boundaries

The job compares the checked-out candidate to the event SHA. On a PR or merge group it reads the checker from the exact trusted base Git object. The single rollout base that predates the checker may use candidate bytes only when they match the reviewed SHA-256. A push to main uses its checked-in checker. Git blobs must be regular files. The candidate is data for the advisory scan. The workflow does not execute its scripts, read its npm credentials, or restore an npm cache on forks. The workflow YAML itself is evaluated by GitHub from its normal event context. Workflow integrity relies on the platform’s event permissions and the separate base-owned change policy.

Each graph is checked before npm runs. The checker stages recognized manifests and locks only, validates registry identities and the dependency census, reads advisories from the fixed public registry with a timeout and response-size bound, and checks applicable ranges against installed versions. It compares those findings with npm's own audit report, including npm's inherited advisories. A malformed, unavailable, foreign or contradictory response fails the job. npm alone can produce a zero-finding report for a null bulk response or omit an unversioned entry while its census still counts it. A valid empty response is trusted as the registry's current answer. Coverage depends on the advisories known to the registry.

## Live evidence

The original checkout failed only on the marketing high threshold. With the repaired lock and the isolated checker, the full root reported 1,041 dependency locations, two low and 19 moderate affected packages. Marketing reported 626 locations and 20 moderate. Relay scripts reported 47 locations and one moderate. CI Codex, CB control and the MCP server reported 7, 41 and 93 locations respectively and zero findings. All six reported zero high or critical. These are report-time observations.

The advisory probe posted the affected and patched Undici and Zod versions to the public npm bulk advisory endpoint. Its JSON object returned eight Undici advisory records and one Zod record. IDs, severities, titles and vulnerable version ranges were used to evaluate the two locked versions. Zod advisory 1243066 returned `high` with the range `<4.6.6`. [Public bulk advisory endpoint](https://registry.npmjs.org/-/npm/v1/security/advisories/bulk).

The checker uses the npm distribution shipped with the selected Node toolchain for lock resolution and semver, adding no project dependency. A future incompatible npm release must pass the positive six-project and hostile-input controls before acceptance.

On the reachable implementation `aae7d345f45ecef1adc398641e4ef6d22d1b0d46`, the controlled adversarial suite passed 32/32. For each project, the set of submitted registry package names and versions agreed between the independent scan and npm's actual submission. In the root, 1,021 unique name/version pairs represented 1,041 package locations. No candidate script executed and no credentials were forwarded to the isolated audit process. [Inputs, controls and observed boundaries](UX-054-ADVERSARIAL.json).

The marketing clean dependency install verified both patched Miniflare paths and the Zod consumer versions. The production build and all 42 project tests passed, as did lint and type checking. [Dependency paths, public registry responses and isolated build results](UX-054-MARKETING.json).

The previously uncovered marketing lock was tested both ways. With just the old Undici restored, the report identified Undici as high. With just the old Zod restored, it identified Zod as high. Restoring the patched lock cleared the high findings in both cases. These checks use the existing high-severity policy for development dependencies as well as production.

## Executed checks

The repository gate ran focused audit tests, workflow-security and supply-chain regressions, lockfile checks, strict lint, type checking, secret scans, roadmap validation and the production application build. The final test-only commit `991b6dc7600f7ebd267f709c5173062fadd8b0fc` added stronger positive controls. Production files match `aae7d345f`. The trusted selector used the canonical main runner. The affected suite was repeated on the final fixtures.

```text
Agentic validation gate passed.
Tests run: test:ux054 test:workflow-security test:supply-chain-gates
[targeted-tests] 9 script(s) passed.
# tests 16
# pass 16
# fail 0
```

Actionlint 1.7.8 exited 0. Pinned zizmor 1.30.1 reported `No findings to report. Good job! (7 suppressed)` on the changed workflow. The suppressions were part of the tool's effective policy.

A live first-introduction replay initially reported marketing audit evidence unavailable while several local scans were running and correctly exited nonzero. An isolated repeat of the same tree passed all six. The steady-state fork replay also passed. A substituted bootstrap digest and the pre-repair marketing versions both failed as intended, without executing the candidate sentinel. Registry availability remains a dependency of this job. [Live fork rehearsal and retry](UX-054-FORK-REPLAY.json).

All 75 individual reversals triggered the intended failure. They comprise 48 checker cases, 25 workflow and ownership cases, and the two independent live dependency regressions. Restored suites returned to 11/0 and 5/0. Four initially ineffective test cases were strengthened and rerun. [Applied diffs, observed assertions, pass/fail counts and restored checksums](UX-054-MUTATIONS.json).

## November 7 integration preflight and dependency assessment

The six-lock audit was rerun on committed head `110db9bfcaa8cad9c96d572e3bda1f9a5e7f8da8` using Node 22. It exited 0: root 1,041 dependencies (2 low, 13 moderate); marketing 626 (12 moderate); relay 47 (1 moderate); CI Codex 7, CB control 41 and MCP server 93 (zero findings each). All six reported zero high or critical. These are fresh registry observations, not a claim that lower-severity exposure is resolved.

Fresh preflight tests returned `# pass 16` / `# fail 0` for UX-054, `# pass 61` / `# fail 0` for workflow security, and `# pass 21` / `# fail 0` for supply-chain gates. The existing checker, lockfiles and workflow bytes were unchanged by the subsequent clean main integration. Final bootstrap-pin validation and exact-head review remain separate steps.

The marketing changes add no package: Undici 7.29.1 becomes 7.30.1 under the existing Miniflare consumers, and Zod 4.4.3 becomes 4.6.6 under its existing consumer range. The public npm registry reports MIT licenses for both, Undici Node >=20.18.1, and no deprecation flag for either. Release timestamps are 2026-10-15T14:18:31.283Z and 2026-10-11T16:18:23.878Z respectively, both older than seven days at this assessment. No dependency-age exception is needed. Existing clean marketing build, lint, typecheck and 42-test evidence remains documented above; no new dependency or application migration is introduced.

The sensitive change includes the security-audit workflow, protected checker, ownership/policy entries and marketing dependency locks. It preserves read-only fork permissions, isolated fixed-registry inputs, the high-severity threshold and trusted-event signature checks. Bradley's October 24 standing delegation allows the assistant to apply the dependency-change approval label after technical assessment. This does not authorize weakening a gate or broadening credentials or security permissions.
