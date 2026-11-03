# UX-054 — Audit subproject dependencies

Proposed November 3, 2026 against main `cd459dfec`. The roadmap selected UX-054 at priority S with no blockers. This is a high-assurance change to the repository's security checks.

## Reproduced gap

The required `npm-audit` job installs and audits the repository root, including a separate registry-signature check. It does not audit the five independent subproject locks. A lockfile-only scan on Node 22.23.1 / npm 10.9.8, including dev, optional and peer dependencies, found the following on main. Each project was also scanned in isolation with a fixed public registry and fresh npm configuration.

| Locked project | Dependencies reported | Low | Moderate | High | Critical |
| --- | ---: | ---: | ---: | ---: | ---: |
| Root web/desktop app | 1,041 | 2 | 19 | 0 | 0 |
| Marketing site and its build tools | 626 | 0 | 23 | 2 | 0 |
| Railway relay scripts | 47 | 0 | 1 | 0 | 0 |
| Local MCP server | 93 | 0 | 0 | 0 | 0 |
| CB control server | 41 | 0 | 0 | 0 | 0 |
| CI Codex tooling | 7 | 0 | 0 | 0 | 0 |

Counts are per affected package as reported by npm. The regular checkout reported 17 moderate root packages, while isolation with explicit dependency classes reported 19. Both runs passed the high threshold at root and failed it for marketing. Omitting dev dependencies masked both marketing high findings. The historical MCP advisory in the roadmap review did not reproduce.

The marketing lock pins Undici 7.29.1 through both Miniflare versions and Zod 4.4.3 through lint tooling. Miniflare uses Undici for local development/preview. The ESLint plugin invokes Zod on compiler configuration. Neither path demonstrated an exploit through a public Worker request. GitHub's four open high Dependabot alerts refer to advisories for the same marketing Undici package. [Undici advisory](https://github.com/advisories/GHSA-xjj6-f33q-929c). [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

## Proposed policy

1. Keep `npm-audit` as one required check. Report each locked project separately. High or critical findings fail the check, as do absent, malformed or incomplete results and registry failures. Low and moderate findings stay visible for reachability triage. A project with missing evidence cannot pass as clean. [npm audit severity and reporting](https://docs.npmjs.com/cli/v10/commands/npm-audit/).
2. Scan tracked regular Git blobs. Classify all six lock roots, their two parent-owned vendored manifests and the dependency-free sidecar marker. A newly introduced unclassified lock or independently installable dependency graph requires an explicit policy update. Keep Cargo under its existing audit/deny controls. Inventory hash-pinned zizmor, Buf schemas, skills and external MCP tool definitions separately from npm advisory coverage. Draft #1781 already owns floating external MCP pins.
3. Include fork PRs **only for the lockfile advisory scan**. Use ordinary read-only PR events, hosted runners, isolated temporary inputs, a fixed public npm registry and known CLI. Ignore candidate npm configuration and scripts. Do not pass registry credentials, workflow secrets, user npm configuration or inherited Node options to this scan. Preserve the existing trusted-event boundary for root installation and signature verification. Protect the checker through CODEOWNERS and the existing dependency-change review policy.
4. Use the exact trusted event base for checker policy on PRs. For its first introduction, use an explicitly reviewed, digest-pinned bootstrap for the identified rollout base. A missing or mismatched evaluator must fail closed. Cover main pushes and merge groups as well. Avoid executing an arbitrary checker from the candidate, or returning success when the base checker is missing.
5. Patch both marketing high findings. Prefer compatible patched transitive resolutions, using a narrow reviewed override only where the two Miniflare parents pin a vulnerable version. Verify advisory ranges, the resulting dependency tree and existing parent overrides. No new dependency is needed for the checker. Keep severity and signature rules intact.
6. Record reachability and ownership for the remaining findings. The relay uses GramJS without the optional SOCKS proxy path identified in the `ip-address` review. Draft #1825 updates this package, and #1790 touches overlapping locks. Verify the actual resulting versions before attributing a fix to either draft. If further externally reachable lower-severity issues are confirmed, remediate them in scope or identify the exact blocking dependency. Reconcile workflow overlap with #1798 and #1781 separately.

## Work and acceptance

* **CI and security owner** — implement the protected inventory and evaluator. Test a high finding in a subproject, an unclassified lock, invalid or zero coverage, registry outage, malformed JSON, hostile PR npm configuration, and attempted lifecycle-script execution. Prove the signature and Rust checks still run on their original events.
* **Dependency owner** — verify patched versions for both Miniflare trees and Zod using public registry metadata. Validate the marketing build, tests, lint and type checking in an isolated development checkout. Repeat full and production-only audits and record the residual report by project. Packaging or publishing the site is outside this task.
* **Verification owner** — run focused suites and repository validation, mutate each policy guard, and obtain independent code and SHA-pinned reviews. Exercise the bootstrap and steady-state paths. Preserve operator control over the existing dependency-change approval label.
* **Rollback** — revert the workflow and checker together, including their ownership entries. The marketing dependency fixes can be retained if independently valid. No change to installed app data or running services is required.

Draft claim publication and local implementation follow operator design approval. Installation of the app, auto-merge and delivery remain paused.
