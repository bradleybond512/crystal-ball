# UX-066 — bounded cookie repair and draft reconciliation

Approved November 28: High Assurance continuation of existing draft #1902,
including local implementation, isolated dependency testing and reconciliation.
This is not a new roadmap claim. Publication/history replacement requires a
separate reviewed-tip approval; all merge and delivery holds remain.

## Verified need and existing owners

Main `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda` locks cookie 0.18.1. Tauri,
tauri-runtime and wry consume it, with cached parent manifests requiring `0.18`.
No direct application cookie calls were found; that is not proof of absence of
exposure through frameworks. [RUSTSEC-2026-0594](https://rustsec.org/advisories/RUSTSEC-2026-0594.html)
identifies 0.18.3 as patched for private-cookie nonce reuse after a process fork.

[Registry metadata](https://crates.io/api/v1/crates/cookie/0.18.3) reports:

- Published `2026-11-23T07:45:48.068974Z`; not yanked.
- License `MIT OR Apache-2.0`; declared Rust minimum 1.56.
- SHA256 `d55f2d6c30eeec7d5c6f98bd4395d4abb1895629eab97ee6522d340623615f8a`.

These are metadata claims, not yet verified downloaded package contents. Before
executing package code, verify the archive checksum and inspect upstream changes,
dependencies and build scripts in isolation. No new runtime dependency is added;
the transitive security patch retains the existing major/minor line. Confirm
actual lock resolution, feature compatibility, build impact and license files.

| Existing PR | Verified scope | Action in this continuation |
| --- | --- | --- |
| #1902 at `d7a2221bd7376dad572bbd5e21aeb46c91373fbc` | UX-066 Zizmor 1.32.0 pin/docs and an older test-clock repair | Continue this claim; reconcile on current main before final publication |
| #1904 at `8c0b6f9847bee31153e64b3d7e6d3533d444748d` | React, ReactDOM and RSC coherently pinned to 19.2.9 | Leave held fix untouched; no duplicate marketing implementation |
| #1920 at `a4081788ca1832a9c6ea7bdc94fe516b28859bc5` | URL 2.5.9, cookie still 0.18.1 | Leave its explicitly exempted workflow/auto-merge and code untouched |
| #1892 / #1893 | Broader Tauri/clipboard updates; cookie remains 0.18.1 | No replay or unrelated framework refresh |
| #1901 | RSC 19.3.1 alone; candidate peers require React/DOM ^19.3.1 | No broader React-line update or change to this PR |

The [React advisory](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3) includes
19.2.9 as a patch. The [URL advisory](https://rustsec.org/advisories/RUSTSEC-2026-0592.html)
identifies 2.5.9 as patched. Neither existing repair is merged. This continuation
will remove the cookie finding only; it cannot make all shared audits green while
the other fixes remain undelivered. No other PR will be closed or marked superseded.

## Allowed changes and reconciliation

Use the fresh `codex/ux066-audit-repair-nov27` worktree based on current main.
Preserve #1902's reviewed Zizmor 1.32.0 requirements exactly and carry its evidence
as historical. Retain main's existing current-publication-date SPC test fix;
do not replay the obsolete conflicting clock edit. Revalidate the main test and
Zizmor pin. Record the exact surviving diff and any evidence superseded by the new
base; never reuse old SHA-pinned reviews for the reconciled tip.

Use a targeted Cargo update for cookie 0.18.3, rather than manually rewriting the
lockfile. Expected new dependency scope is its version/checksum in
`src-tauri/Cargo.lock`. Unexpected additional dependency changes require assessment
before proceeding. Keep Cargo.toml, native source, features, npm manifests, audit
thresholds/ignores, dependency policy and release/install code unchanged.

Allowed files: Cargo.lock; the existing Zizmor requirements pin/evidence being
reconciled; this brief/design; a new bounded QA report; UX-066 tracker metadata.
If an added behavioral regression file is necessary, the test engineer must first
identify its narrow scope and detecting mutation; no generic validation-rule edit.

## Owners and execution order

1. Repository analyst and architect: completed read-only path/ownership discovery
   and this design. No dependency edits or package execution have occurred.
2. Security specialist, after approval: reconcile the allowed existing #1902
   changes, assess/download the exact cookie archive in a disposable location,
   verify integrity and build scripts, and perform the targeted locked update.
3. Test engineer: record baseline and candidate against the same pinned advisory
   database revision, then a clean-tree mutation/restoration proof. Reverting only
   the cookie entry must restore its advisory; quote actual finding counts and
   matching checksums. The remaining URL advisory must remain visible.
4. Parent: run relevant checks, record actual results, update the existing claim's
   evidence, and obtain fresh independent Sol and actual Sonnet reviews. No more
   than two automatic review/repair cycles. Final publication request must name
   the exact new tip and explain any history replacement with a lease on #1902.

## Validation and limits

Use existing Cargo/audit/deny tools, which are available locally; no global tool
installation. Isolated Cargo dependency fetch/build/test outputs must stay outside
the application install/profile. Verify package code before execution. Native
compilation may use `cargo test --manifest-path src-tauri/Cargo.toml --locked --no-run`;
this compiles tests without executing the application. Any additional executable
tests must be isolated library/fixture checks with no real Keychain or profile
access. Record unavailable compilation honestly rather than weakening checks.

Run Cargo audit with the pinned database, `cargo deny check sources bans`, the
existing six-lock `npm run audit:locks`, `test:spc-angle`,
`test:supply-chain-gates`, `test:workflow-security`, roadmap checks, all selected
suites, `npm run typecheck:all` and the full named validation gate. Preserve and
report the known marketing/URL audit failures; require cookie's finding to be
removed and reproducibly restored by the mutation. Prove the restored tree clean.
Existing scripts/tool prerequisites must be read before execution.

Cookie 0.18.3 is below the seven-day dependency-age threshold on November 27; it
reaches seven days on November 30 at 07:45:48 UTC. No age label is applied now.
If publication precedes eligibility, document the security rationale and complete
the technical assessment before using the existing delegated
`dependency-age-reviewed` permission. Otherwise use the ordinary age gate. The
separate dependency-change approval gate remains. Install-script approval remains
human-only if required; do not bypass it. Marketing's age-check coverage gap is
recorded, not changed by this repair.

No app launch, installation, production-data access, release dispatch, deployment,
merge, auto-merge arming or cleanup is permitted. The unsafe cleanup workflow stays
disabled. No mutations of #1920, other PR settings or shared user environments.

## Rollback and remaining acceptance

Rollback of the dependency patch restores a vulnerable version: keep the security
failure visible and delivery blocked. No storage or migration rollback is needed.
Full UX-066 dependency-backlog acceptance, marketing/URL delivery and installed
verification remain open. Successful local checks are not shipped acceptance.
