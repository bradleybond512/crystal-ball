# UX-074 — bounded payload inventory and verification design

Status: approved bounded documentation-only draft claim and local completion;
user instructed continuation after the approval request. High Assurance.
Source examined: `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`.

## Goal and acceptance

Document how declared desktop payloads could be reconciled with software bills
of materials (SBOMs). This checkpoint produces a source-to-payload evidence
matrix and a future artifact-verification protocol. It does not produce or
certify a shipped SBOM. Full UX-074 remains open until separately authorized
release-artifact inspection proves coverage.

The declared build matrix is full, tech and finance across macOS ARM64/x64,
Windows x64 and Linux x64/ARM64: fifteen combinations in
`.github/workflows/build-desktop.yml`. Record each combination explicitly in the
completion evidence, with uninspected artifact coverage marked unverified.

## Source evidence and gaps

| Payload | Declared producer/root | Evidence still needed |
| --- | --- | --- |
| Renderer and copied Cesium assets | Vite `dist/`; `vite.config.ts` copies Workers, ThirdParty, Assets and Widgets | Actual emitted/copied files, including WASM; component membership after tree shaking |
| Generated API bundle | `scripts/build-sidecar-sebuf.mjs`; `api/[domain]/v1/[rpc].js` | Component attribution in actual bundles; packaged `api` or `_up_/api` root |
| XMPP bundle | `scripts/build-sidecar-xmpp.mjs`; `sidecar/s2u-xmpp.bundle.mjs` | Bundled component membership, not the complete npm lock graph |
| Sidecar modules and resources | `src-tauri/tauri.conf.json` resource list; data, configuration and Little Snitch tools | Actual files, hashes, executable classification and platform-specific resource locations |
| Rust executable/native libraries | Cargo target/features and Tauri; Linux AppImage enables `bundleMediaFramework` | Linked Rust/native components and bundled media libraries; distinguish external OS dependencies |
| Node runtime | `scripts/download-node.sh`; `sidecar/node`; binary hashing in `src-tauri/build.rs` | Actual packaged binary digest and upstream component evidence |
| Optional wgrib2 | Conditional local macOS `scripts/desktop-package.mjs` and `scripts/vendor-wgrib2.sh` | Presence/absence, binary identity and native dependencies; hosted workflow does not invoke this vendoring step |

`src-tauri/build.rs` also prunes duplicate frontend assets. The resource list is
a declaration, not proof that each path survives packaging unchanged.
`scripts/release-manifest.mjs` binds whole installer names, sizes and hashes to
source, variant, platform and version; macOS includes measured native identity.
Existing provenance attestation verifies source/artifact association, not package
membership. No configured SBOM generator was found. A lockfile includes resolved
dependencies that may never be shipped and cannot establish coverage alone.

## Future verification contract

Bind every evidence record to exact source SHA, variant, OS/architecture, build
configuration and installer SHA256. After separate authorization, inspect the
specified artifact without executing it. Record internal paths, file types,
sizes and hashes; constrain archive paths and symlinks before extraction. Match
each executable/bundle to component evidence and classify external OS libraries
separately. Reject source/artifact or variant mismatches and missing required
payloads. Record optional absence, extra files, unsupported scanning and unknown
components explicitly; unresolved attribution prevents a completeness claim.

Candidate formats are CycloneDX JSON and SPDX JSON. Neither is selected here and
no standard-compliance claim is made. Later selection must demonstrate component
identity, relationships, artifact hashes and coverage-gap representation against
representative actual payloads. No evidence establishes one generator covers
JavaScript bundles, Rust linkage and vendored binaries together. Tool adoption
requires pinned provenance, integrity, dependency-age and install-script checks.

## Scope, boundaries and alternatives

Documentation only: no new tools, dependencies, workflow/schema changes, runtime
logic, permissions, secrets, desktop build, artifact download or inspection, signing,
installed-app/profile access or production-data access. Existing checks remain
intact. Do not run `desktop:build:full`: it invokes local installation. Merging,
auto-merge, releases, deployment and installation remain paused; #1920 retains
its separate workflow. Generator adoption and release-artifact verification need
their own bounded approval. The ordinary web build within the required validation
gate is permitted; it neither packages nor installs a desktop application.

A manifest-only SBOM would overstate coverage. Installing a general scanner now
would select tooling before confirming required evidence. The documentation
checkpoint avoids both, with unknown coverage explicitly unverified. It changes
no runtime performance, storage or migration behavior.

## Bounded tasks and validation

1. Parent prepares the brief/design; repository analyst traces packaging and
   architect reviews the evidence boundaries (completed discovery, read-only).
2. After approval and draft claim, documentation owner records the fifteen-case
   matrix, evidence references and gaps in `docs/validation/UX-074-SBOM-PAYLOAD-INVENTORY.md`.
   Allowed files: this design, its brief, the evidence document and UX-074 tracker
   metadata in `docs/USABILITY_UPLIFT_FOR_CODEX.md`. Reconcile stale UX-076 merge
   metadata only; its packaged acceptance remains open.
3. Validate matrix claims against source, links and roadmap metadata. Run
   `npm run test:roadmap-controller`, `npm run docs:check -- --changelog-advisory`,
   `npm run typecheck:all` and the required named validation gate. These checks
   validate documentation/source consistency, not shipped coverage. No artificial
   mutation proof for prose; future verifier tests must detect tampered digests,
   missing/extra payloads, variant mismatch, archive traversal and incomplete
   attribution.
4. Independent Sol and actual Sonnet review the completed documentation before
   a separately approved completion push. Do not mark full UX-074 complete.

Rollback removes the checkpoint documents and restores the prior tracker row;
there is no runtime change to revert. Manual shipped-artifact acceptance stays
pending under the current holds.
